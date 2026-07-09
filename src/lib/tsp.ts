import { LatLng, Address } from './types'

const EARTH_RADIUS_M = 6_371_000

export function haversineDistanz(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const h =
    sinDLat * sinDLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinDLng *
      sinDLng
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

export function nearestNeighborTSP(startpunkt: LatLng, punkte: LatLng[]): LatLng[] {
  if (punkte.length === 0) return [startpunkt]

  const remaining = [...punkte]
  const route: LatLng[] = [startpunkt]
  let current = startpunkt

  while (remaining.length > 0) {
    let nearestIdx = 0
    let nearestDist = haversineDistanz(current, remaining[0])

    for (let i = 1; i < remaining.length; i++) {
      const dist = haversineDistanz(current, remaining[i])
      if (dist < nearestDist) {
        nearestDist = dist
        nearestIdx = i
      }
    }

    current = remaining[nearestIdx]
    route.push(current)
    remaining.splice(nearestIdx, 1)
  }

  return route
}

// Clustered TSP: first groups addresses by town (plz+ortsname),
// then routes town-by-town, minimizing long inter-town connections.
// Within each town the addresses are visited in nearest-neighbor order.
export function clusteredNearestNeighborTSP(startpunkt: LatLng, adressen: Address[]): LatLng[] {
  if (adressen.length === 0) return [startpunkt]

  // Group by plz+ortsname+ortsteil (matches the Orts-Filter grouping)
  const clusterMap = new Map<string, Address[]>()
  for (const a of adressen) {
    const key = `${a.plz}_${a.ortsname}_${a.ortsteil}`
    if (!clusterMap.has(key)) clusterMap.set(key, [])
    clusterMap.get(key)!.push(a)
  }

  // Build cluster list with centroids
  const clusters: { centroid: LatLng; adressen: Address[] }[] = []
  for (const addrs of clusterMap.values()) {
    const lat = addrs.reduce((s, a) => s + a.lat, 0) / addrs.length
    const lng = addrs.reduce((s, a) => s + a.lon, 0) / addrs.length
    clusters.push({ centroid: { lat, lng }, adressen: addrs })
  }

  // Nearest-neighbor on cluster centroids to determine town visit order
  const remaining = [...clusters]
  const orderedClusters: typeof clusters = []
  let currentPos = startpunkt

  while (remaining.length > 0) {
    let nearestIdx = 0
    let nearestDist = haversineDistanz(currentPos, remaining[0].centroid)
    for (let i = 1; i < remaining.length; i++) {
      const dist = haversineDistanz(currentPos, remaining[i].centroid)
      if (dist < nearestDist) {
        nearestDist = dist
        nearestIdx = i
      }
    }
    orderedClusters.push(remaining[nearestIdx])
    currentPos = remaining[nearestIdx].centroid
    remaining.splice(nearestIdx, 1)
  }

  // Build final route: for each cluster, run nearest-neighbor from last position
  const result: LatLng[] = [startpunkt]
  let current = startpunkt

  for (const cluster of orderedClusters) {
    const pts: LatLng[] = cluster.adressen.map((a) => ({ lat: a.lat, lng: a.lon }))
    const ordered = nearestNeighborTSP(current, pts)
    const clusterRoute = ordered.slice(1) // drop repeated start point
    result.push(...clusterRoute)
    if (clusterRoute.length > 0) {
      current = clusterRoute[clusterRoute.length - 1]
    }
  }

  return result
}

// Prim's Minimum Spanning Tree: verbindet alle Adressen in einer Baum-Struktur.
// Jede Adresse wird genau einmal mit ihrem nächsten bereits verbundenen Nachbarn
// verbunden — keine Umwege, kein Zurückfahren auf derselben Strecke.
// Verwendet quadrierte Flacherd-Distanz (kein Trig nötig, deutlich schneller).
export function mstAdressen(
  startpunkt: LatLng,
  adressen: Address[]
): Array<{ von: LatLng; zu: LatLng }> {
  if (adressen.length === 0) return []

  const punkte: LatLng[] = [startpunkt, ...adressen.map((a) => ({ lat: a.lat, lng: a.lon }))]
  const n = punkte.length
  const inTree = new Array<boolean>(n).fill(false)
  const minDist = new Array<number>(n).fill(Infinity)
  const vonIdx = new Array<number>(n).fill(-1)

  minDist[0] = 0
  const kanten: Array<{ von: LatLng; zu: LatLng }> = []

  for (let iter = 0; iter < n; iter++) {
    // Nächster noch nicht verbundener Knoten
    let u = -1
    for (let i = 0; i < n; i++) {
      if (!inTree[i] && (u === -1 || minDist[i] < minDist[u])) u = i
    }

    inTree[u] = true
    if (vonIdx[u] >= 0) {
      kanten.push({ von: punkte[vonIdx[u]], zu: punkte[u] })
    }

    // Abstände zu noch nicht verbundenen Knoten aktualisieren
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue
      const dlat = punkte[u].lat - punkte[v].lat
      const dlng = (punkte[u].lng - punkte[v].lng) * 0.7 // cos(lat) Näherung für Mitteleuropa
      const d2 = dlat * dlat + dlng * dlng
      if (d2 < minDist[v]) {
        minDist[v] = d2
        vonIdx[v] = u
      }
    }
  }

  return kanten
}

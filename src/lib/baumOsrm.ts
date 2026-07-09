import { LatLng, Address } from './types'

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving/'

async function routeSegment(von: LatLng, zu: LatLng): Promise<LatLng[]> {
  try {
    const url = `${OSRM_BASE}${von.lng},${von.lat};${zu.lng},${zu.lat}?overview=full&geometries=geojson`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const coords: [number, number][] | undefined = data.routes?.[0]?.geometry?.coordinates
    if (!coords?.length) throw new Error('leer')
    return coords.map(([lng, lat]) => ({ lat, lng }))
  } catch {
    return [von, zu]
  }
}

// Nächsten Baumknoten zu einem Zielpunkt finden (flache Näherung, sehr schnell)
function naechsterBaumknoten(treeNodes: LatLng[], ziel: LatLng): LatLng {
  const cosLat = Math.cos((ziel.lat * Math.PI) / 180)
  let best = treeNodes[0]
  let bestD = Infinity
  for (const n of treeNodes) {
    const dlat = n.lat - ziel.lat
    const dlng = (n.lng - ziel.lng) * cosLat
    const d = dlat * dlat + dlng * dlng
    if (d < bestD) { bestD = d; best = n }
  }
  return best
}

// Nearest-Neighbor-Sortierung ab Startpunkt (O(n²), für n=645 ca. 10ms)
function sortiereNaechsterNachbar(start: LatLng, adressen: Address[]): Address[] {
  const remaining = [...adressen]
  const sortiert: Address[] = []
  let current = start

  while (remaining.length > 0) {
    const cosLat = Math.cos((current.lat * Math.PI) / 180)
    let bestIdx = 0
    let bestD = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[i]
      const dlat = a.lat - current.lat
      const dlng = (a.lon - current.lng) * cosLat
      const d = dlat * dlat + dlng * dlng
      if (d < bestD) { bestD = d; bestIdx = i }
    }
    sortiert.push(remaining[bestIdx])
    current = { lat: remaining[bestIdx].lat, lng: remaining[bestIdx].lon }
    remaining.splice(bestIdx, 1)
  }

  return sortiert
}

// Baut einen Straßenbaum via OSRM ohne Overpass:
// - Adressen werden in Nearest-Neighbor-Reihenfolge verarbeitet
// - Jede Adresse verbindet sich vom nächsten bereits vorhandenen Streckenpunkt
// - OSRM sorgt dafür dass alle Verbindungen Straßen folgen
// → Keine Hin-und-Rückwege, kein Overpass, zuverlässig
export async function berechneBaumOSRM(
  start: LatLng,
  adressen: Address[],
  onProgress?: (prozent: number) => void
): Promise<LatLng[][]> {
  if (adressen.length === 0) return []

  const sortiert = sortiereNaechsterNachbar(start, adressen)
  const treeNodes: LatLng[] = [start]
  const pfade: LatLng[][] = []

  const BATCH = 8
  const total = sortiert.length

  for (let i = 0; i < total; i += BATCH) {
    const batch = sortiert.slice(i, i + BATCH)

    // Für alle Adressen im Batch: nächsten Baumknoten zum aktuellen Zeitpunkt finden
    const aufgaben = batch.map((a) => {
      const ziel: LatLng = { lat: a.lat, lng: a.lon }
      const von = naechsterBaumknoten(treeNodes, ziel)
      return { von, zu: ziel }
    })

    // Parallel routen
    const ergebnisse = await Promise.all(aufgaben.map(({ von, zu }) => routeSegment(von, zu)))

    // Alle Routenpunkte dem Baum hinzufügen (für nächste Iteration)
    for (const route of ergebnisse) {
      if (route.length >= 2) {
        pfade.push(route)
        for (const p of route) treeNodes.push(p)
      }
    }

    onProgress?.(Math.round(((i + batch.length) / total) * 100))
    if (i + BATCH < total) await new Promise<void>((r) => setTimeout(r, 300))
  }

  return pfade
}

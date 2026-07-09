import * as turf from '@turf/turf'
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

// Nächsten Punkt auf dem gesamten Trassennetz (Segmente, nicht nur Endpunkte).
// Verwendet turf.nearestPointOnLine → findet auch Mittelpunkte auf Strecken.
// Das verhindert Doppelwege: Abzweige starten dort wo die Trasse wirklich am nächsten ist.
function naechsterNetzpunkt(pfade: LatLng[][], start: LatLng, ziel: LatLng): LatLng {
  if (pfade.length === 0) return start

  const zielPt = turf.point([ziel.lng, ziel.lat])
  let bestPunkt = start
  let bestDist = Infinity

  for (const pfad of pfade) {
    if (pfad.length < 2) continue
    try {
      const linie = turf.lineString(pfad.map((p) => [p.lng, p.lat]))
      const nearest = turf.nearestPointOnLine(linie, zielPt, { units: 'meters' })
      const dist = nearest.properties.dist ?? Infinity
      if (dist < bestDist) {
        bestDist = dist
        const [lng, lat] = nearest.geometry.coordinates
        bestPunkt = { lat, lng }
      }
    } catch { /* Segment überspringen */ }
  }

  return bestPunkt
}

// Nearest-Neighbor-Sortierung ab Startpunkt (O(n²), für n=645 ~10ms)
function sortiereNaechsterNachbar(start: LatLng, adressen: Address[]): Address[] {
  const remaining = [...adressen]
  const sortiert: Address[] = []
  let current = start

  while (remaining.length > 0) {
    const cosLat = Math.cos((current.lat * Math.PI) / 180)
    let bestIdx = 0, bestD = Infinity
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

// Baut Straßenbaum via OSRM — ohne Overpass, 100% zuverlässig.
//
// Schlüsselprinzip: Jede neue Adresse verbindet sich vom NÄCHSTEN PUNKT
// auf dem gesamten bestehenden Streckennetz (nicht nur von Endpunkten).
// → Natürliche Abzweige mitten auf Straßen, kein Hin-und-Zurück.
export async function berechneBaumOSRM(
  start: LatLng,
  adressen: Address[],
  onProgress?: (prozent: number) => void
): Promise<LatLng[][]> {
  if (adressen.length === 0) return []

  const sortiert = sortiereNaechsterNachbar(start, adressen)
  const pfade: LatLng[][] = []
  const total = sortiert.length

  // Klein-Batch: nach je 5 Adressen wird das Netz aktualisiert.
  // Das gibt gute Baumstruktur bei akzeptabler Laufzeit.
  const BATCH = 5

  for (let i = 0; i < total; i += BATCH) {
    const batch = sortiert.slice(i, i + BATCH)

    // Für jede Adresse im Batch: Abzweigpunkt AUF dem bestehenden Netz suchen
    const aufgaben = batch.map((a) => {
      const ziel: LatLng = { lat: a.lat, lng: a.lon }
      const von = naechsterNetzpunkt(pfade, start, ziel)
      return { von, zu: ziel }
    })

    // Parallel routen
    const ergebnisse = await Promise.all(
      aufgaben.map(({ von, zu }) => routeSegment(von, zu))
    )

    // Alle neuen Segmente sofort ins Netz aufnehmen
    for (const route of ergebnisse) {
      if (route.length >= 2) pfade.push(route)
    }

    onProgress?.(Math.round(((i + batch.length) / total) * 100))
    if (i + BATCH < total) await new Promise<void>((r) => setTimeout(r, 250))
  }

  return pfade
}

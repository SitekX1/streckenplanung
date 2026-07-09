import * as turf from '@turf/turf'
import { LatLng } from './types'
import { haversineDistanz } from './tsp'

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving/'
const BATCH_SIZE = 50

async function routeBatch(waypoints: LatLng[]): Promise<LatLng[]> {
  const coords = waypoints.map((p) => `${p.lng},${p.lat}`).join(';')
  const url = `${OSRM_BASE}${coords}?overview=full&geometries=geojson`

  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`)
    const data = await res.json()
    const coordinates: [number, number][] | undefined = data.routes?.[0]?.geometry?.coordinates
    if (!coordinates || coordinates.length === 0) throw new Error('OSRM: leere Route')
    return coordinates.map(([lon, lat]) => ({ lat, lng: lon }))
  } catch (err) {
    console.warn('OSRM Routing fehlgeschlagen, nutze direkte Verbindung:', err)
    return waypoints
  }
}

export async function routeEntlangStrassen(
  waypoints: LatLng[],
  onProgress?: (prozent: number) => void
): Promise<LatLng[]> {
  if (waypoints.length < 2) return waypoints

  const batches: LatLng[][] = []

  for (let i = 0; i < waypoints.length; i += BATCH_SIZE - 1) {
    // Overlap: letzter Punkt des vorigen Batch = erster Punkt des nächsten
    const end = Math.min(i + BATCH_SIZE, waypoints.length)
    batches.push(waypoints.slice(i, end))
    if (end === waypoints.length) break
  }

  const result: LatLng[] = []

  for (let i = 0; i < batches.length; i++) {
    const segment = await routeBatch(batches[i])

    // Ersten Punkt des Folge-Batch weglassen, da er identisch mit dem letzten des aktuellen ist
    if (i === 0) {
      result.push(...segment)
    } else {
      result.push(...segment.slice(1))
    }

    onProgress?.(Math.round(((i + 1) / batches.length) * 100))
  }

  return result
}

// Routet eine einzelne MST-Kante (Punkt A → Punkt B) entlang von Straßen.
async function routeKante(von: LatLng, zu: LatLng): Promise<LatLng[]> {
  const url = `${OSRM_BASE}${von.lng},${von.lat};${zu.lng},${zu.lat}?overview=full&geometries=geojson`
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const coords: [number, number][] | undefined = data.routes?.[0]?.geometry?.coordinates
    if (!coords?.length) throw new Error('Keine Route')
    const wegpunkte = coords.map(([lon, lat]) => ({ lat, lng: lon }))
    // Plausibilitäts-Check: Route darf nicht mehr als 15× die Luftlinie betragen
    const luftlinie = haversineDistanz(von, zu)
    const routenLaenge = wegpunkte.reduce(
      (sum, p, i) => (i === 0 ? 0 : sum + haversineDistanz(wegpunkte[i - 1], p)),
      0
    )
    if (routenLaenge > luftlinie * 15) return [von, zu]
    // Douglas-Peucker ~10m Toleranz: gerade Abschnitte auf 2 Punkte reduzieren
    if (wegpunkte.length > 4) {
      try {
        const line = turf.lineString(wegpunkte.map((p) => [p.lng, p.lat]))
        const simplified = turf.simplify(line, { tolerance: 0.0001, highQuality: false })
        return (simplified.geometry.coordinates as [number, number][]).map(([lng, lat]) => ({ lat, lng }))
      } catch { /* original behalten */ }
    }
    return wegpunkte
  } catch {
    return [von, zu]
  }
}

// Routet alle MST-Kanten entlang von Straßen (parallel in Batches).
// Gibt ein Array von Pfaden zurück — einen Pfad pro MST-Kante.
export async function routeMSTKanten(
  kanten: Array<{ von: LatLng; zu: LatLng }>,
  onProgress?: (prozent: number) => void
): Promise<LatLng[][]> {
  const BATCH = 10
  const pfade: LatLng[][] = []

  for (let i = 0; i < kanten.length; i += BATCH) {
    const batch = kanten.slice(i, i + BATCH)
    const ergebnisse = await Promise.all(batch.map((k) => routeKante(k.von, k.zu)))
    pfade.push(...ergebnisse)
    onProgress?.(Math.round(((i + batch.length) / kanten.length) * 100))
    if (i + BATCH < kanten.length) await new Promise<void>((r) => setTimeout(r, 350))
  }

  return pfade
}

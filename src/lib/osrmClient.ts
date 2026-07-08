import { LatLng } from './types'

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

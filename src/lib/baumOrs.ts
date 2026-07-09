import * as turf from '@turf/turf'
import { LatLng, Address } from './types'

// ORS erlaubt 50 Waypoints — 45 mit Puffer
const MAX_WAYPOINTS = 45

async function routeOrs(waypoints: LatLng[]): Promise<LatLng[]> {
  const body = JSON.stringify({
    coordinates: waypoints.map((p) => [p.lng, p.lat]),
  })

  const res = await fetch('/api/ors-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`)
  }

  const data = await res.json()
  const coords = data.features?.[0]?.geometry?.coordinates as [number, number][] | undefined
  if (!coords?.length) throw new Error('ORS: leere Antwort')
  return coords.map(([lng, lat]) => ({ lat, lng }))
}

// Nächsten Punkt auf dem gesamten Trassennetz finden (auch Mittelpunkte von Segmenten)
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

// Nearest-Neighbor-Sortierung ab Startpunkt
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

// ORS-Baum: bis zu 45 Adressen pro API-Aufruf → wesentlich weniger Anfragen als OSRM.
// Jeder Batch startet vom nächsten Punkt auf dem bestehenden Netz (Abzweig mitten auf Straßen).
// ORS routet dann optimal durch alle Adressen im Batch — kein Hin-und-Zurück.
export async function berechneBaumORS(
  start: LatLng,
  adressen: Address[],
  onProgress?: (prozent: number) => void
): Promise<LatLng[][]> {
  if (adressen.length === 0) return []

  const sortiert = sortiereNaechsterNachbar(start, adressen)
  const pfade: LatLng[][] = []

  const batches: Address[][] = []
  for (let i = 0; i < sortiert.length; i += MAX_WAYPOINTS) {
    batches.push(sortiert.slice(i, i + MAX_WAYPOINTS))
  }

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]

    const erstesZiel: LatLng = { lat: batch[0].lat, lng: batch[0].lon }
    const branch = naechsterNetzpunkt(pfade, start, erstesZiel)

    const waypoints: LatLng[] = [
      branch,
      ...batch.map((a) => ({ lat: a.lat, lng: a.lon })),
    ]

    try {
      const route = await routeOrs(waypoints)
      if (route.length >= 2) pfade.push(route)
    } catch (e) {
      // Fallback: direkte Verbindungslinie wenn ORS fehlschlägt
      console.warn(`ORS Batch ${b + 1} fehlgeschlagen:`, e)
      pfade.push(waypoints)
    }

    onProgress?.(Math.round(((b + 1) / batches.length) * 100))
  }

  return pfade
}

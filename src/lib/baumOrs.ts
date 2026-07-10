import * as turf from '@turf/turf'
import { LatLng, Address } from './types'

const MAX_WAYPOINTS = 45
const RATE_LIMIT_DELAY_MS = 1700 // ~35 req/min — sicher unter ORS-Limit von 40/min

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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
function naechsterNetzpunkt(pfade: LatLng[][], ziel: LatLng, fallback: LatLng): LatLng {
  if (pfade.length === 0) return fallback

  const zielPt = turf.point([ziel.lng, ziel.lat])
  let bestPunkt = fallback
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

// Nearest-Neighbor-Sortierung innerhalb eines Dorfes ab Einstiegspunkt
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

function zentrum(adressen: Address[]): LatLng {
  const lat = adressen.reduce((s, a) => s + a.lat, 0) / adressen.length
  const lng = adressen.reduce((s, a) => s + a.lon, 0) / adressen.length
  return { lat, lng }
}

function distanzQuadrat(a: LatLng, b: LatLng): number {
  const dlat = a.lat - b.lat
  const dlng = a.lng - b.lng
  return dlat * dlat + dlng * dlng
}

// ORS-Baum: Dorf für Dorf — jedes Dorf bekommt seinen eigenen Ast ab Ortseingang.
// Rate-Limit: 1,7s Delay zwischen Batches → max ~35 Anfragen/Min (ORS-Limit: 40/Min).
// vorhandenePfade: für "Trasse erweitern" — neue Äste docken ans bestehende Netz an.
export async function berechneBaumORS(
  start: LatLng,
  adressen: Address[],
  onProgress?: (prozent: number) => void,
  vorhandenePfade?: LatLng[][]
): Promise<LatLng[][]> {
  if (adressen.length === 0) return []

  // 1. Adressen nach Dorf gruppieren (PLZ + Ortsname + Ortsteil)
  const dorfMap = new Map<string, Address[]>()
  for (const a of adressen) {
    const key = `${a.plz}_${a.ortsname}_${a.ortsteil ?? ''}`
    if (!dorfMap.has(key)) dorfMap.set(key, [])
    dorfMap.get(key)!.push(a)
  }

  // 2. Dörfer nach Entfernung zum Startpunkt sortieren (Nearest-Neighbor über Zentren)
  const restDörfer = Array.from(dorfMap.values())
  const sortierteDörfer: Address[][] = []
  let aktuellerPunkt = start

  while (restDörfer.length > 0) {
    let bestIdx = 0
    let bestD = Infinity
    for (let i = 0; i < restDörfer.length; i++) {
      const d = distanzQuadrat(aktuellerPunkt, zentrum(restDörfer[i]))
      if (d < bestD) { bestD = d; bestIdx = i }
    }
    sortierteDörfer.push(restDörfer[bestIdx])
    aktuellerPunkt = zentrum(restDörfer[bestIdx])
    restDörfer.splice(bestIdx, 1)
  }

  // Gesamt-Batch-Anzahl für Fortschrittsanzeige
  const gesamtBatches = sortierteDörfer.reduce(
    (s, d) => s + Math.ceil(d.length / MAX_WAYPOINTS), 0
  )
  let batchCounter = 0

  const pfade: LatLng[][] = vorhandenePfade ? [...vorhandenePfade] : []
  const neuePfade: LatLng[][] = []
  let fehlerAnzahl = 0
  let letzterFehler = ''

  // 3. Dorf für Dorf routen — jedes Dorf als eigener Ast
  for (const dorfAdressen of sortierteDörfer) {
    const dorfZentrum = zentrum(dorfAdressen)

    // Einstieg: nächster Punkt auf bestehendem Netz oder Startpunkt
    const einstieg = pfade.length > 0
      ? naechsterNetzpunkt(pfade, dorfZentrum, start)
      : start

    // Adressen im Dorf ab Einstiegspunkt nearest-neighbor sortieren
    const sortiertAdressen = sortiereNaechsterNachbar(einstieg, dorfAdressen)

    // In ORS-Batches aufteilen (max 45 Wegpunkte)
    const batches: Address[][] = []
    for (let i = 0; i < sortiertAdressen.length; i += MAX_WAYPOINTS) {
      batches.push(sortiertAdressen.slice(i, i + MAX_WAYPOINTS))
    }

    let dorfEinstieg = einstieg

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b]
      const waypoints: LatLng[] = [
        dorfEinstieg,
        ...batch.map((a) => ({ lat: a.lat, lng: a.lon })),
      ]

      // Rate-Limit-Delay vor jedem Aufruf außer dem ersten
      if (batchCounter > 0) {
        await sleep(RATE_LIMIT_DELAY_MS)
      }

      try {
        const route = await routeOrs(waypoints)
        if (route.length >= 2) {
          pfade.push(route)
          neuePfade.push(route)
          // Nächster Batch startet am Routenende
          dorfEinstieg = route[route.length - 1]
        }
      } catch (e) {
        fehlerAnzahl++
        letzterFehler = e instanceof Error ? e.message : String(e)
        console.warn(`ORS Batch ${batchCounter + 1} fehlgeschlagen:`, letzterFehler)
        // Fallback: Luftlinie (sichtbar durch orangefarbene Warnung in UI)
        pfade.push(waypoints)
        neuePfade.push(waypoints)
        dorfEinstieg = { lat: batch[batch.length - 1].lat, lng: batch[batch.length - 1].lon }
      }

      batchCounter++
      onProgress?.(Math.round((batchCounter / gesamtBatches) * 100))
    }
  }

  if (fehlerAnzahl === gesamtBatches) {
    throw new Error(`ORS nicht verfügbar: ${letzterFehler}`)
  }

  return neuePfade
}

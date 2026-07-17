import * as turf from '@turf/turf'
import { LatLng, Address } from './types'

// Mapbox Directions API: max. 25 Koordinaten/Request, 300 Requests/Minute
// (deutlich grosszuegiger als ORS' 40 Requests/Minute) — Marge eingebaut.
const MAX_WAYPOINTS = 23
const RATE_LIMIT_DELAY_MS = 250
const SPRUNG_SCHWELLE_M = 500 // Sprung > 500m zwischen NN-Adressen → eigene Abzweigung

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const MAPBOX_MAX_RETRIES = 2
const MAPBOX_RETRY_DELAY_MS = 2500

async function routeOrs(waypoints: LatLng[], versuch = 0): Promise<LatLng[]> {
  const body = JSON.stringify({ coordinates: waypoints.map((p) => [p.lng, p.lat]) })
  const res = await fetch('/api/mapbox-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    const message = (err as { error?: string }).error ?? `HTTP ${res.status}`
    // 429 (Rate Limit) und 502/503/504 (voruebergehende Serverprobleme) — kurz
    // warten und erneut versuchen, statt das Segment sofort auf eine Luftlinie
    // zurueckfallen zu lassen.
    if ((res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) && versuch < MAPBOX_MAX_RETRIES) {
      await sleep(MAPBOX_RETRY_DELAY_MS * (versuch + 1))
      return routeOrs(waypoints, versuch + 1)
    }
    throw new Error(message)
  }
  const data = await res.json()
  const coords = data.routes?.[0]?.geometry?.coordinates as [number, number][] | undefined
  if (!coords?.length) throw new Error('Mapbox: leere Antwort')
  return coords.map(([lng, lat]) => ({ lat, lng }))
}

function haversineDistanz(a: LatLng, b: LatLng): number {
  const R = 6_371_000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const sa = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(sa), Math.sqrt(1 - sa))
}

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

// Teile NN-sortierte Adressen bei großen Sprüngen auf.
// Ausreißer (isolierte Gehöfte etc.) werden als eigene Gruppe behandelt
// und bekommen ihren eigenen Einstieg vom nächstgelegenen Netzpunkt.
function teileBeispruenge(sortiert: Address[]): Address[][] {
  if (sortiert.length === 0) return []
  const gruppen: Address[][] = []
  let aktuelleGruppe: Address[] = [sortiert[0]]
  for (let i = 1; i < sortiert.length; i++) {
    const prev = sortiert[i - 1]
    const curr = sortiert[i]
    const dist = haversineDistanz(
      { lat: prev.lat, lng: prev.lon },
      { lat: curr.lat, lng: curr.lon }
    )
    if (dist > SPRUNG_SCHWELLE_M) {
      gruppen.push(aktuelleGruppe)
      aktuelleGruppe = [curr]
    } else {
      aktuelleGruppe.push(curr)
    }
  }
  gruppen.push(aktuelleGruppe)
  return gruppen
}

// Gruppiert Adressen eines Dorfes nach Straße. Adressen ohne Straßennamen
// bekommen ihre eigene Einzel-Gruppe (kein künstliches Zusammenwürfeln).
function gruppiereNachStrasse(adressen: Address[]): Address[][] {
  const map = new Map<string, Address[]>()
  for (const a of adressen) {
    const key = a.strasse || `_${a.uuid}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(a)
  }
  return Array.from(map.values())
}

// Reduziert eine Adressgruppe auf die für ORS nötigen Stützpunkte: die zwei am
// weitesten voneinander entfernten Adressen (Durchmesser der Gruppe) statt einfach
// Anfang/Ende der NN-Sortierung — die NN-Reihenfolge kann bei einem seitlichen
// Einstiegspunkt zickzacken, wodurch "Anfang" und "Ende" nah beieinander liegen
// und große Teile der Straße gar nicht mehr von der Trasse abgedeckt würden.
// ORS folgt zwischen den zwei Stützpunkten ohnehin dem echten Straßenverlauf —
// die Häuser dazwischen werden per Hausanschluss angebunden. Reihenfolge der
// beiden Punkte: näher an `nah` (Anschlusspunkt ans bisherige Netz) zuerst.
function reduziereAufStuetzpunkte(gruppe: Address[], nah: LatLng): Address[] {
  if (gruppe.length <= 2) return gruppe
  let bestI = 0, bestJ = 1, bestDist = -1
  for (let i = 0; i < gruppe.length; i++) {
    for (let j = i + 1; j < gruppe.length; j++) {
      const d = haversineDistanz(
        { lat: gruppe[i].lat, lng: gruppe[i].lon },
        { lat: gruppe[j].lat, lng: gruppe[j].lon }
      )
      if (d > bestDist) { bestDist = d; bestI = i; bestJ = j }
    }
  }
  const a = gruppe[bestI], b = gruppe[bestJ]
  const dA = haversineDistanz(nah, { lat: a.lat, lng: a.lon })
  const dB = haversineDistanz(nah, { lat: b.lat, lng: b.lon })
  return dA <= dB ? [a, b] : [b, a]
}

// Plant für ein Dorf die Reihenfolge der (nach Straße gruppierten, auf Stützpunkte
// reduzierten) ORS-Wegpunkt-Gruppen. Reine Distanz-/Gruppierungslogik ohne Netzwerk-
// Zustand — wird sowohl für die Batch-Zählung (Progress) als auch als Blaupause für
// die eigentliche Ausführung verwendet (dort wird der Einstieg je Gruppe live per
// naechsterNetzpunkt() auf das bereits gebaute Netz neu bestimmt).
function planeDorfGruppen(dorfAdressen: Address[], dorfEinstieg: LatLng): Address[][] {
  const restStrassen = gruppiereNachStrasse(dorfAdressen)
  const sortierteStrassen: Address[][] = []
  let sortierPunkt = dorfEinstieg
  while (restStrassen.length > 0) {
    let bestIdx = 0, bestD = Infinity
    for (let i = 0; i < restStrassen.length; i++) {
      const d = distanzQuadrat(sortierPunkt, zentrum(restStrassen[i]))
      if (d < bestD) { bestD = d; bestIdx = i }
    }
    sortierteStrassen.push(restStrassen[bestIdx])
    sortierPunkt = zentrum(restStrassen[bestIdx])
    restStrassen.splice(bestIdx, 1)
  }

  const gruppen: Address[][] = []
  let laufpunkt = dorfEinstieg
  for (const strassenAdressen of sortierteStrassen) {
    const sortiert = sortiereNaechsterNachbar(laufpunkt, strassenAdressen)
    for (const teil of teileBeispruenge(sortiert)) {
      gruppen.push(reduziereAufStuetzpunkte(teil, laufpunkt))
    }
    const letzte = sortiert[sortiert.length - 1]
    laufpunkt = { lat: letzte.lat, lng: letzte.lon }
  }
  return gruppen
}

export async function berechneBaumORS(
  start: LatLng,
  adressen: Address[],
  onProgress?: (prozent: number) => void,
  vorhandenePfade?: LatLng[][]
): Promise<LatLng[][]> {
  if (adressen.length === 0) return []

  const dorfMap = new Map<string, Address[]>()
  for (const a of adressen) {
    const key = `${a.plz}_${a.ortsname}_${a.ortsteil ?? ''}`
    if (!dorfMap.has(key)) dorfMap.set(key, [])
    dorfMap.get(key)!.push(a)
  }

  const restDörfer = Array.from(dorfMap.values())
  const sortierteDörfer: Address[][] = []
  let aktuellerPunkt = start
  while (restDörfer.length > 0) {
    let bestIdx = 0, bestD = Infinity
    for (let i = 0; i < restDörfer.length; i++) {
      const d = distanzQuadrat(aktuellerPunkt, zentrum(restDörfer[i]))
      if (d < bestD) { bestD = d; bestIdx = i }
    }
    sortierteDörfer.push(restDörfer[bestIdx])
    aktuellerPunkt = zentrum(restDörfer[bestIdx])
    restDörfer.splice(bestIdx, 1)
  }

  const gesamtBatches = sortierteDörfer.reduce(
    (s, d) => s + planeDorfGruppen(d, zentrum(d)).reduce(
      (s2, g) => s2 + Math.ceil(g.length / MAX_WAYPOINTS), 0
    ), 0
  )
  let batchCounter = 0
  const pfade: LatLng[][] = vorhandenePfade ? [...vorhandenePfade] : []
  const neuePfade: LatLng[][] = []
  let fehlerAnzahl = 0
  let letzterFehler = ''

  for (const dorfAdressen of sortierteDörfer) {
    const dorfZentrum = zentrum(dorfAdressen)
    const dorfEinstieg = pfade.length > 0 ? naechsterNetzpunkt(pfade, dorfZentrum, start) : start
    const gruppen = planeDorfGruppen(dorfAdressen, dorfEinstieg)

    for (let g = 0; g < gruppen.length; g++) {
      const gruppe = gruppen[g]
      const gruppenEinstieg = g === 0
        ? dorfEinstieg
        : (pfade.length > 0 ? naechsterNetzpunkt(pfade, zentrum(gruppe), start) : start)

      const batches: Address[][] = []
      for (let i = 0; i < gruppe.length; i += MAX_WAYPOINTS) {
        batches.push(gruppe.slice(i, i + MAX_WAYPOINTS))
      }

      let batchEinstieg = gruppenEinstieg
      for (let b = 0; b < batches.length; b++) {
        const batch = batches[b]
        const waypoints: LatLng[] = [batchEinstieg, ...batch.map((a) => ({ lat: a.lat, lng: a.lon }))]
        if (batchCounter > 0) await sleep(RATE_LIMIT_DELAY_MS)
        try {
          const route = await routeOrs(waypoints)
          if (route.length >= 2) {
            pfade.push(route); neuePfade.push(route)
            batchEinstieg = route[route.length - 1]
          }
        } catch (e) {
          fehlerAnzahl++
          letzterFehler = e instanceof Error ? e.message : String(e)
          console.warn(`ORS Batch ${batchCounter + 1} fehlgeschlagen:`, letzterFehler)
          pfade.push(waypoints); neuePfade.push(waypoints)
          batchEinstieg = { lat: batch[batch.length - 1].lat, lng: batch[batch.length - 1].lon }
        }
        batchCounter++
        onProgress?.(Math.round((batchCounter / gesamtBatches) * 100))
      }
    }
  }

  if (fehlerAnzahl === gesamtBatches && gesamtBatches > 0) {
    throw new Error(`ORS nicht verfügbar: ${letzterFehler}`)
  }
  return neuePfade
}

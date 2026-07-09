import * as turf from '@turf/turf'
import { LatLng, Address, Hausstich } from './types'

function toLatLng(coord: number[]): LatLng {
  return { lat: coord[1], lng: coord[0] }
}

async function routeHausanschlussOSRM(
  haus: LatLng,
  ziel: LatLng
): Promise<{ wegpunkte: LatLng[]; laengeMeter: number }> {
  const straightLine = turf.distance(
    turf.point([haus.lng, haus.lat]),
    turf.point([ziel.lng, ziel.lat]),
    { units: 'meters' }
  )

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${haus.lng},${haus.lat};${ziel.lng},${ziel.lat}?overview=full&geometries=geojson`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as Record<string, unknown>
    const routes = data.routes as Array<{ geometry: { coordinates: [number, number][] }; distance: number }> | undefined
    const coords = routes?.[0]?.geometry?.coordinates
    if (!coords || coords.length === 0) throw new Error('Keine Route')
    const laengeMeter = routes![0].distance

    if (laengeMeter > straightLine * 10 || laengeMeter < 1) {
      return { wegpunkte: [haus, ziel], laengeMeter: straightLine }
    }

    return { wegpunkte: coords.map(toLatLng), laengeMeter }
  } catch {
    return { wegpunkte: [haus, ziel], laengeMeter: straightLine }
  }
}

// Findet den nächsten Punkt auf dem gesamten Trassen-Netzwerk (alle Pfade).
// Bei MST-Trasse: jeder der 645 Pfade wird geprüft, der global nächste Punkt gewinnt.
function findNearestOnNetzwerk(
  linien: ReturnType<typeof turf.lineString>[],
  hausPoint: ReturnType<typeof turf.point>
): LatLng {
  let nearestPunkt: LatLng | null = null
  let nearestDist = Infinity

  for (const linie of linien) {
    try {
      const nearest = turf.nearestPointOnLine(linie, hausPoint, { units: 'meters' })
      const dist = nearest.properties.dist ?? Infinity
      if (dist < nearestDist) {
        nearestDist = dist
        nearestPunkt = toLatLng(nearest.geometry.coordinates)
      }
    } catch {
      // einzelnen Pfad überspringen
    }
  }

  return nearestPunkt ?? toLatLng(hausPoint.geometry.coordinates)
}

export async function berechneHausanschluesse(
  trassePfade: LatLng[][],
  adressen: Address[],
  onProgress?: (percent: number) => void
): Promise<Hausstich[]> {
  const gueltigePfade = trassePfade.filter((p) => p.length >= 2)
  if (gueltigePfade.length === 0) return []

  // Turf-Linien einmalig vorberechnen (nicht für jeden Punkt neu bauen)
  const linien = gueltigePfade.map((pfad) =>
    turf.lineString(pfad.map((p) => [p.lng, p.lat]))
  )

  const BATCH = 10
  const ergebnisse: Hausstich[] = []

  for (let i = 0; i < adressen.length; i += BATCH) {
    const batch = adressen.slice(i, i + BATCH)

    const batchResults = await Promise.all(
      batch.map(async (adresse): Promise<Hausstich> => {
        const hausPoint = turf.point([adresse.lon, adresse.lat])
        const trassenPunkt = findNearestOnNetzwerk(linien, hausPoint)
        const hausKoordinate: LatLng = { lat: adresse.lat, lng: adresse.lon }

        const { wegpunkte, laengeMeter } = await routeHausanschlussOSRM(hausKoordinate, trassenPunkt)

        return {
          id: crypto.randomUUID(),
          addressUuid: adresse.uuid,
          trassenPunkt,
          hausKoordinate,
          laengeMeter,
          wegpunkte,
        }
      })
    )

    ergebnisse.push(...batchResults)
    onProgress?.(Math.round(((i + batch.length) / adressen.length) * 100))

    if (i + BATCH < adressen.length) {
      await new Promise<void>((r) => setTimeout(r, 50))
    }
  }

  return ergebnisse
}

export function berechneLaengen(
  trassePfade: LatLng[][],
  hausanschluesse: Hausstich[]
): { trassenLaenge: number; hausanschluesseLaenge: number; gesamt: number } {
  const trassenLaenge = trassePfade
    .filter((p) => p.length >= 2)
    .reduce((sum, pfad) => {
      try {
        return sum + turf.length(turf.lineString(pfad.map((p) => [p.lng, p.lat])), { units: 'meters' })
      } catch {
        return sum
      }
    }, 0)

  const hausanschluesseLaenge = hausanschluesse.reduce((sum, h) => sum + h.laengeMeter, 0)

  return {
    trassenLaenge,
    hausanschluesseLaenge,
    gesamt: trassenLaenge + hausanschluesseLaenge,
  }
}

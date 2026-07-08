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

    // Sanity check: discard if route is implausibly long (>10x straight line)
    if (laengeMeter > straightLine * 10 || laengeMeter < 1) {
      return { wegpunkte: [haus, ziel], laengeMeter: straightLine }
    }

    return { wegpunkte: coords.map(toLatLng), laengeMeter }
  } catch {
    return { wegpunkte: [haus, ziel], laengeMeter: straightLine }
  }
}

export async function berechneHausanschluesse(
  trasse: LatLng[],
  adressen: Address[],
  onProgress?: (percent: number) => void
): Promise<Hausstich[]> {
  if (trasse.length < 2) return []

  const linie = turf.lineString(trasse.map((p) => [p.lng, p.lat]))
  const BATCH = 10
  const ergebnisse: Hausstich[] = []

  for (let i = 0; i < adressen.length; i += BATCH) {
    const batch = adressen.slice(i, i + BATCH)

    const batchResults = await Promise.all(
      batch.map(async (adresse): Promise<Hausstich> => {
        const hausPoint = turf.point([adresse.lon, adresse.lat])
        const nearest = turf.nearestPointOnLine(linie, hausPoint, { units: 'meters' })
        const trassenPunkt = toLatLng(nearest.geometry.coordinates)
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
  trasse: LatLng[],
  hausanschluesse: Hausstich[]
): { trassenLaenge: number; hausanschluesseLaenge: number; gesamt: number } {
  const trassenLaenge =
    trasse.length >= 2
      ? turf.length(turf.lineString(trasse.map((p) => [p.lng, p.lat])), { units: 'meters' })
      : 0

  const hausanschluesseLaenge = hausanschluesse.reduce((sum, h) => sum + h.laengeMeter, 0)

  return {
    trassenLaenge,
    hausanschluesseLaenge,
    gesamt: trassenLaenge + hausanschluesseLaenge,
  }
}

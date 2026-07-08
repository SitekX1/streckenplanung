import * as turf from '@turf/turf'
import { LatLng, Address, Hausstich } from './types'

function toTurfPoint(p: LatLng) {
  return turf.point([p.lng, p.lat])
}

function toLatLng(coord: number[]): LatLng {
  return { lat: coord[1], lng: coord[0] }
}

export function berechneHausanschluesse(
  trasse: LatLng[],
  adressen: Address[]
): Hausstich[] {
  if (trasse.length < 2) return []

  const linie = turf.lineString(trasse.map((p) => [p.lng, p.lat]))

  return adressen.map((adresse) => {
    const hausPoint = toTurfPoint({ lat: adresse.lat, lng: adresse.lon })
    const nearest = turf.nearestPointOnLine(linie, hausPoint, { units: 'meters' })
    const trassenPunkt = toLatLng(nearest.geometry.coordinates)
    const hausKoordinate: LatLng = { lat: adresse.lat, lng: adresse.lon }
    const laengeMeter = turf.distance(hausPoint, nearest, { units: 'meters' })

    return {
      id: crypto.randomUUID(),
      addressUuid: adresse.uuid,
      trassenPunkt,
      hausKoordinate,
      laengeMeter,
    }
  })
}

export function berechneLaengen(
  trasse: LatLng[],
  hausanschluesse: Hausstich[]
): { trassenLaenge: number; hausanschluesseLaenge: number; gesamt: number } {
  const trassenLaenge =
    trasse.length >= 2
      ? turf.length(turf.lineString(trasse.map((p) => [p.lng, p.lat])), {
          units: 'meters',
        })
      : 0

  const hausanschluesseLaenge = hausanschluesse.reduce(
    (sum, h) => sum + h.laengeMeter,
    0
  )

  return {
    trassenLaenge,
    hausanschluesseLaenge,
    gesamt: trassenLaenge + hausanschluesseLaenge,
  }
}

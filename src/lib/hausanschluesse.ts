import * as turf from '@turf/turf'
import { LatLng, Address, Hausstich } from './types'

function toLatLng(coord: number[]): LatLng {
  return { lat: coord[1], lng: coord[0] }
}

// Findet den nächsten Punkt auf dem gesamten Trassen-Netzwerk (alle Pfade).
function findNearestOnNetzwerk(
  linien: ReturnType<typeof turf.lineString>[],
  hausPoint: ReturnType<typeof turf.point>
): { punkt: LatLng; distMeter: number } {
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

  const fallback = toLatLng(hausPoint.geometry.coordinates)
  return { punkt: nearestPunkt ?? fallback, distMeter: nearestDist === Infinity ? 0 : nearestDist }
}

export async function berechneHausanschluesse(
  trassePfade: LatLng[][],
  adressen: Address[],
  onProgress?: (percent: number) => void
): Promise<Hausstich[]> {
  const gueltigePfade = trassePfade.filter((p) => p.length >= 2)
  if (gueltigePfade.length === 0) return []

  // Turf-Linien einmalig vorberechnen
  const linien = gueltigePfade.map((pfad) =>
    turf.lineString(pfad.map((p) => [p.lng, p.lat]))
  )

  // Hausanschlüsse = gerade Linie Haus → nächster Trassen-Punkt.
  // KEIN OSRM: Glasfaser-Hausanschlüsse verlaufen direkt durch den Garten/unter dem
  // Bürgersteig — keine Straßenführung notwendig oder korrekt.
  const CHUNK = 50
  const ergebnisse: Hausstich[] = []

  for (let i = 0; i < adressen.length; i += CHUNK) {
    const chunk = adressen.slice(i, i + CHUNK)

    const chunkResults: Hausstich[] = chunk.map((adresse): Hausstich => {
      const hausPoint = turf.point([adresse.lon, adresse.lat])
      const { punkt: trassenPunkt, distMeter } = findNearestOnNetzwerk(linien, hausPoint)
      const hausKoordinate: LatLng = { lat: adresse.lat, lng: adresse.lon }

      return {
        id: crypto.randomUUID(),
        addressUuid: adresse.uuid,
        trassenPunkt,
        hausKoordinate,
        laengeMeter: distMeter,
        wegpunkte: [hausKoordinate, trassenPunkt],
      }
    })

    ergebnisse.push(...chunkResults)
    onProgress?.(Math.round(((i + chunk.length) / adressen.length) * 100))
    // Kurze Pause damit React re-rendern kann
    await new Promise<void>((r) => setTimeout(r, 0))
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

import * as turf from '@turf/turf'
import { LatLng, WegKind } from './types'

// Zerlegt Trassen-Pfade an den gegebenen Punkten (z.B. NVT-Standorten) in
// kleinere Segmente. Jeder Punkt wird auf den wirklich naechstgelegenen Pfad
// projiziert (nicht irgendeinen, an dem er zufaellig auch anliegt) und dort
// geschnitten — am Ende deckt jedes Segment genau den Abschnitt zwischen zwei
// benachbarten Schnittpunkten (oder Pfadanfang/-ende) ab. Macht die Segmente
// fuer den Export nutzbar (ein Segment = eine NVT-Zustaendigkeit), statt dass
// sie unstrukturiert quer durchs Dorf laufen.
export function segmentiereAnPunkten(
  pfade: LatLng[][],
  kinds: WegKind[],
  punkte: LatLng[]
): { pfade: LatLng[][]; kinds: WegKind[] } {
  if (punkte.length === 0) return { pfade, kinds }

  const schnitteProPfad: number[][] = pfade.map(() => [])
  for (const punkt of punkte) {
    let bestPfadIdx = -1
    let bestIndex = 0
    let bestDist = Infinity
    pfade.forEach((pfad, pfadIdx) => {
      if (pfad.length < 2) return
      const line = turf.lineString(pfad.map((p) => [p.lng, p.lat]))
      const nearest = turf.nearestPointOnLine(line, turf.point([punkt.lng, punkt.lat]))
      const dist = nearest.properties.dist ?? Infinity
      if (dist < bestDist) {
        bestDist = dist
        bestPfadIdx = pfadIdx
        bestIndex = nearest.properties.index ?? 0
      }
    })
    if (bestPfadIdx !== -1) schnitteProPfad[bestPfadIdx].push(bestIndex)
  }

  const paare: { pfad: LatLng[]; kind: WegKind }[] = []
  pfade.forEach((pfad, pfadIdx) => {
    const schnitte = [...new Set(schnitteProPfad[pfadIdx])]
      .sort((a, b) => a - b)
      .filter((i) => i > 0 && i < pfad.length - 1)

    if (schnitte.length === 0 || pfad.length < 3) {
      paare.push({ pfad, kind: kinds[pfadIdx] })
      return
    }
    let start = 0
    for (const schnitt of schnitte) {
      paare.push({ pfad: pfad.slice(start, schnitt + 1), kind: kinds[pfadIdx] })
      start = schnitt
    }
    paare.push({ pfad: pfad.slice(start), kind: kinds[pfadIdx] })
  })

  const gueltig = paare.filter((p) => p.pfad.length >= 2)
  return { pfade: gueltig.map((p) => p.pfad), kinds: gueltig.map((p) => p.kind) }
}

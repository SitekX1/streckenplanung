import * as turf from '@turf/turf'
import { LatLng, WegKind } from './types'

// Gemeinsame Schneide-Logik: erhält pro Pfad eine Liste von Schnitt-Indizes
// (im Punkte-Array des jeweiligen Pfads) und zerlegt jeden Pfad an diesen
// Stellen in mehrere Teil-Pfade. Segmentende + neues Segment beginnen am
// selben Punkt, keine Lücke in der Geometrie.
function schneidePfadeAnIndizes(
  pfade: LatLng[][],
  kinds: WegKind[],
  schnitteProPfad: number[][]
): { pfade: LatLng[][]; kinds: WegKind[] } {
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

  return schneidePfadeAnIndizes(pfade, kinds, schnitteProPfad)
}

// Trennt Segmente zusätzlich an Stellen, wo sich zwei UNTERSCHIEDLICHE Pfade
// berühren oder kreuzen (echte Straßenkreuzungen), die der Steiner-Baum nicht
// selbst als Abzweig erkannt hat — z.B. weil zwei Wege in den OSM-Rohdaten an
// der Kreuzung keinen gemeinsamen Knoten teilen (häufige Datenlücke bei
// Nebenstraßen/Feldwegen) oder weil ein nachgelagerter Dedup-Schritt die vom
// Baum vorgegebene Aufteilung wieder verworfen hat. Deckt zwei Fälle ab:
// 1) T-Kreuzung: der Endpunkt eines Pfads liegt auf der Länge eines anderen
//    Pfads (nicht nur an dessen eigenem Anfang/Ende) → der andere Pfad wird
//    dort geschnitten.
// 2) Echte Kreuzung: zwei Pfade schneiden sich in ihrem Inneren (X-Kreuzung)
//    → beide werden am Schnittpunkt geschnitten.
export function segmentiereAnKreuzungen(
  pfade: LatLng[][],
  kinds: WegKind[],
  toleranzMeter = 3
): { pfade: LatLng[][]; kinds: WegKind[] } {
  if (pfade.length < 2) return { pfade, kinds }

  const lines = pfade.map((p) => (p.length >= 2 ? turf.lineString(p.map((pt) => [pt.lng, pt.lat])) : null))
  const istEndpunkt = (pfad: LatLng[], idx: number) => idx <= 0 || idx >= pfad.length - 1

  const schnitteProPfad: number[][] = pfade.map(() => [])
  // Arbeitskopie — an den Schnittstellen wird der getroffene Vertex exakt
  // auf den jeweils anderen Pfad "eingeschnappt" (siehe Erklärung unten),
  // nie das Original-Array mutieren.
  const arbeitsPfade = pfade.map((p) => p.map((pt) => ({ ...pt })))

  // WICHTIG (2026-08-21, Alex: "Backbone sollte nie unterbrochen sein" /
  // "X-Marker fehlt komplett"), ZWEI Probleme in einem:
  // 1) turf.nearestPointOnLine liefert nur den nächstgelegenen
  //    EXISTIERENDEN Vertex von Pfad J, der bis zu toleranzMeter von Pfad
  //    I's Endpunkt entfernt sein darf — geometrisch sehen beide Pfade auf
  //    der Karte durchgehend verbunden aus, sind es numerisch aber NICHT
  //    (zwei verschiedene Koordinaten). Jede knotenbasierte Berechnung
  //    (baueGraph in nvt.ts für Backbone/Hausanschluss-Zählung,
  //    trassenKnotenPunkte in MapView.tsx) rundet nur auf ~1m genau und
  //    hält die beiden Punkte deshalb fälschlich für getrennte Knoten.
  // 2) `nearest.properties.index` ist laut turf-Dokumentation der
  //    SEGMENT-Index (die wievielte Kante), NICHT der Vertex-Index —
  //    wurde vorher aber direkt als Vertex-Index zum Schneiden verwendet.
  //    Liegt der Treffpunkt näher am ENDE eines Segments (nahe Vertex
  //    segmentIndex+1) statt am Anfang, zeigte der alte Code auf den
  //    FALSCHEN, oft schon vorhandenen Endpunkt-Vertex — die
  //    !istEndpunkt-Prüfung verwarf den Schnitt dann sogar komplett,
  //    obwohl real eine Kreuzung vorlag (verifiziert per Test-Skript: turf
  //    lieferte index=0 für einen Punkt, der geometrisch exakt auf Vertex 1
  //    lag). Fix: explizit den NÄHEREN der beiden Segment-Endpunkte
  //    (segmentIndex/segmentIndex+1) bestimmen und darauf einschnappen.
  function naechsterVertexIndex(pfad: LatLng[], segmentIndex: number, ziel: LatLng): number {
    const v0 = pfad[segmentIndex]
    const v1 = pfad[segmentIndex + 1]
    if (!v1) return segmentIndex
    const d0 = turf.distance(turf.point([v0.lng, v0.lat]), turf.point([ziel.lng, ziel.lat]), { units: 'meters' })
    const d1 = turf.distance(turf.point([v1.lng, v1.lat]), turf.point([ziel.lng, ziel.lat]), { units: 'meters' })
    return d0 <= d1 ? segmentIndex : segmentIndex + 1
  }

  // Fall 1: Endpunkte jedes Pfads gegen alle ANDEREN Pfade prüfen.
  pfade.forEach((pfadI, i) => {
    if (pfadI.length < 2) return
    for (const endpunkt of [pfadI[0], pfadI[pfadI.length - 1]]) {
      const zielPt = turf.point([endpunkt.lng, endpunkt.lat])
      lines.forEach((lineJ, j) => {
        if (i === j || !lineJ) return
        const nearest = turf.nearestPointOnLine(lineJ, zielPt, { units: 'meters' })
        const dist = nearest.properties.dist ?? Infinity
        const segmentIndex = nearest.properties.index ?? 0
        const idx = naechsterVertexIndex(pfade[j], segmentIndex, endpunkt)
        if (dist <= toleranzMeter && !istEndpunkt(pfade[j], idx)) {
          schnitteProPfad[j].push(idx)
          arbeitsPfade[j][idx] = { lat: endpunkt.lat, lng: endpunkt.lng }
        }
      })
    }
  })

  // Fall 2: echte Kreuzungen zwischen je zwei Pfaden — beide Seiten werden
  // exakt auf denselben berechneten Schnittpunkt eingeschnappt (sonst
  // liefern die zwei unabhängigen nearestPointOnLine-Aufrufe für "denselben"
  // Kreuzungspunkt zwei minimal unterschiedliche existierende Vertizes).
  for (let i = 0; i < pfade.length; i++) {
    const lineI = lines[i]
    if (!lineI) continue
    for (let j = i + 1; j < pfade.length; j++) {
      const lineJ = lines[j]
      if (!lineJ) continue
      const schnittpunkte = turf.lineIntersect(lineI, lineJ)
      for (const feature of schnittpunkte.features) {
        const schnittPt = turf.point(feature.geometry.coordinates)
        const [schnittLng, schnittLat] = feature.geometry.coordinates
        const schnittLatLng: LatLng = { lat: schnittLat, lng: schnittLng }
        const nearestI = turf.nearestPointOnLine(lineI, schnittPt)
        const nearestJ = turf.nearestPointOnLine(lineJ, schnittPt)
        const idxI = naechsterVertexIndex(pfade[i], nearestI.properties.index ?? 0, schnittLatLng)
        const idxJ = naechsterVertexIndex(pfade[j], nearestJ.properties.index ?? 0, schnittLatLng)
        if (!istEndpunkt(pfade[i], idxI)) {
          schnitteProPfad[i].push(idxI)
          arbeitsPfade[i][idxI] = { lat: schnittLat, lng: schnittLng }
        }
        if (!istEndpunkt(pfade[j], idxJ)) {
          schnitteProPfad[j].push(idxJ)
          arbeitsPfade[j][idxJ] = { lat: schnittLat, lng: schnittLng }
        }
      }
    }
  }

  return schneidePfadeAnIndizes(arbeitsPfade, kinds, schnitteProPfad)
}

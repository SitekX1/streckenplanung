import { Address, Hausstich, LatLng, NvtStandort, SchachtStandort } from './types'
import { baueGraph, naechsterKnoten, dijkstraVon } from './nvt'

// Faseranzahl-Berechnung nach Materialkonzept Abschnitt 1 (RN 4): "vier Fasern
// pro Wohneinheit/Teilnehmer und zwei Fasern pro Gebäude im Minimum als
// Point-to-Point-Verbindung bis zum Kollokationspunkt" + "Kapazitätsreserve
// von mindestens 15 %". 4 Fasern/Wohneinheit deckt die 2-pro-Gebäude-Grenze
// automatisch ab, sobald ein Gebäude mindestens 1 Wohneinheit hat.
const FASERN_PRO_WOHNEINHEIT = 4
const RESERVE_ANTEIL = 0.15

function fasernFuerAdresse(adresse: Address | undefined): number {
  const wohneinheiten = Math.max(1, adresse?.hh ?? 1)
  return FASERN_PRO_WOHNEINHEIT * wohneinheiten
}

// Standard-Kabelgrößen aus GIS-NB 3.2.2.3 (Layer Verbindungen, verb_art) —
// zur Auswahl des passenden Kabeltyp-Codes für eine benötigte Faserzahl.
const GLASFASERKABEL_GROESSEN: { fasern: number; code: number }[] = [
  { fasern: 6, code: 5 },
  { fasern: 12, code: 6 },
  { fasern: 24, code: 7 },
  { fasern: 48, code: 8 },
  { fasern: 72, code: 9 },
  { fasern: 96, code: 10 },
  { fasern: 144, code: 11 },
  { fasern: 288, code: 12 },
]

// Wählt die kleinste Standardgröße, die die benötigte Faserzahl deckt — reicht
// keine Standardgröße aus (>288 Fasern auf einem Segment), wird die größte
// genommen (Grenzfall, in der Praxis bei Ortsnetzgröße nicht zu erwarten).
export function passendesKabel(benoetigteFasern: number): { fasern: number; code: number } {
  return (
    GLASFASERKABEL_GROESSEN.find((g) => g.fasern >= benoetigteFasern) ??
    GLASFASERKABEL_GROESSEN[GLASFASERKABEL_GROESSEN.length - 1]
  )
}

// Generische Bottom-up-Lastenverteilung über die Baumtopologie der Trasse:
// jedes NVT/Schacht bündelt ein Gewicht (Summe über alle ihm zugeordneten
// Hausanschlüsse, z.B. Faserzahl oder einfach Stückzahl), das entlang des
// kürzesten Pfads zum Startpunkt über alle Segmente "fließt", die auf diesem
// Weg liegen — ein Segment nah am Start trägt entsprechend mehr Last als
// eins nah an einem einzelnen NVT. Wird sowohl für die Faserzahl- als auch
// die Hausanschluss-Sammelverband-Dimensionierung genutzt (siehe unten).
function berechneLastProSegment(
  trassePfade: LatLng[][],
  startpunkt: LatLng,
  nvtStandorte: NvtStandort[],
  schachtStandorte: SchachtStandort[],
  gewichtProHausIds: (hausIds: string[]) => number
): number[] {
  const leer = trassePfade.map(() => 0)
  if (trassePfade.length === 0) return leer

  const graph = baueGraph(trassePfade)
  const startKnoten = naechsterKnoten(graph, startpunkt)
  if (!startKnoten) return leer

  const { dist: distVomStart, prev } = dijkstraVon(graph, startKnoten)

  const kantenLast = new Map<string, number>()
  function addiereEntlangPfad(zielKnoten: string, last: number) {
    if (last <= 0 || !distVomStart.has(zielKnoten)) return
    let cur = zielKnoten
    while (prev.has(cur)) {
      const vor = prev.get(cur)!
      const key = cur < vor ? `${cur}|${vor}` : `${vor}|${cur}`
      kantenLast.set(key, (kantenLast.get(key) ?? 0) + last)
      cur = vor
    }
  }

  for (const nvt of nvtStandorte) {
    const knoten = naechsterKnoten(graph, nvt.position)
    if (knoten) addiereEntlangPfad(knoten, gewichtProHausIds(nvt.hausanschlussIds))
  }
  for (const schacht of schachtStandorte) {
    const knoten = naechsterKnoten(graph, schacht.position)
    if (knoten) addiereEntlangPfad(knoten, gewichtProHausIds(schacht.hausanschlussIds))
  }

  const r = (v: number) => Math.round(v * 100000) / 100000
  const knotenKeyVon = (p: LatLng) => `${r(p.lat)},${r(p.lng)}`

  return trassePfade.map((pfad) => {
    if (pfad.length < 2) return 0
    // Alle Segmente sind dank segmentiereAnKreuzungen() an jedem Abzweig
    // getrennt — innerhalb eines Segments ist die Last auf jeder Teilkante
    // identisch, ein Sample (max über alle Teilkanten als Sicherheitsnetz
    // gegen Rundungs-/Snapping-Abweichungen) reicht.
    let last = 0
    for (let i = 0; i < pfad.length - 1; i++) {
      const a = knotenKeyVon(pfad[i])
      const b = knotenKeyVon(pfad[i + 1])
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      last = Math.max(last, kantenLast.get(key) ?? 0)
    }
    return last
  })
}

export interface SegmentFaserbedarf {
  fasernBasis: number
  fasernReserve: number
  fasernGesamt: number
}

// Faserzahl pro Trasse-Segment — siehe berechneLastProSegment().
export function berechneFaserbedarfProSegment(
  trassePfade: LatLng[][],
  startpunkt: LatLng,
  nvtStandorte: NvtStandort[],
  schachtStandorte: SchachtStandort[],
  hausanschluesse: Hausstich[],
  adressen: Address[]
): SegmentFaserbedarf[] {
  const hausById = new Map(hausanschluesse.map((h) => [h.id, h]))
  const adresseByUuid = new Map(adressen.map((a) => [a.uuid, a]))

  const gewicht = (hausIds: string[]) =>
    hausIds.reduce((summe, id) => {
      const haus = hausById.get(id)
      const adresse = haus ? adresseByUuid.get(haus.addressUuid) : undefined
      return summe + fasernFuerAdresse(adresse)
    }, 0)

  const basisProSegment = berechneLastProSegment(trassePfade, startpunkt, nvtStandorte, schachtStandorte, gewicht)
  return basisProSegment.map((basis) => {
    const reserve = Math.ceil(basis * RESERVE_ANTEIL)
    return { fasernBasis: basis, fasernReserve: reserve, fasernGesamt: basis + reserve }
  })
}

// Anzahl der Hausanschlüsse, die kumulativ über jedes Trasse-Segment
// Richtung Startpunkt versorgt werden — Grundlage für die dynamische
// Kundenanschluss-Sammelverband-Dimensionierung (siehe materialkatalog.ts
// "kundenanschlussStufen" + gisNbExport.ts Doppelbelegung): nah an einer
// Gabelung trägt ein Segment die Summe aller Hausanschlüsse dahinter (z.B.
// 24), auf dem Stich hinter der Gabelung nur noch die des jeweiligen Astes
// (z.B. 5 oder 8) — ergibt automatisch kleinere Verbände Richtung Stichende.
export function berechneHausanschlussAnzahlProSegment(
  trassePfade: LatLng[][],
  startpunkt: LatLng,
  nvtStandorte: NvtStandort[],
  schachtStandorte: SchachtStandort[]
): number[] {
  return berechneLastProSegment(trassePfade, startpunkt, nvtStandorte, schachtStandorte, (hausIds) => hausIds.length)
}

// Bestimmt pro Trasse-Segment, ob es eine echte NVT-zu-NVT- (oder
// Schacht-zu-Schacht-/gemischte) Verbindung darstellt — nur dort gehört das
// feste Backbone-Material hin (2026-08-12, Alex: "nicht jede Trasse braucht
// zwei Leerrohrsegmente, es kommt darauf an ob eine SV/NVT-zu-NVT-Verbindung
// da ist"). Ein Segment gilt als Backbone, wenn auf dem Pfad vom Startpunkt
// aus VOR diesem Segment bereits ein NVT/Schacht liegt UND HINTER diesem
// Segment (im Teilbaum) noch mindestens ein weiterer NVT/Schacht folgt —
// reine Zuführungen vom Start zum allerersten Verteiler sowie Stiche hinter
// dem letzten Verteiler (nur noch Hausanschlüsse, kein weiterer Verteiler)
// zählen NICHT als Backbone, nur der jeweilige Kundenanschluss-Sammelverband
// läuft dort (siehe berechneHausanschlussAnzahlProSegment).
//
// Bekannte Annahme (noch nicht von Alex bestätigt): die allererste
// Zuführung vom Start/PoP zum ersten Verteiler zählt NICHT als "NVT-zu-NVT"
// und bekommt daher kein Backbone-Material — falls das nicht stimmt, muss
// hier nachgebessert werden.
export function ermittleBackboneSegmente(
  trassePfade: LatLng[][],
  startpunkt: LatLng,
  nvtStandorte: NvtStandort[],
  schachtStandorte: SchachtStandort[]
): boolean[] {
  const leer = trassePfade.map(() => false)
  if (trassePfade.length === 0) return leer

  const graph = baueGraph(trassePfade)
  const startKnoten = naechsterKnoten(graph, startpunkt)
  if (!startKnoten) return leer

  const { dist: distVomStart, prev } = dijkstraVon(graph, startKnoten)

  const verteilerKnoten = new Set<string>()
  for (const nvt of nvtStandorte) {
    const k = naechsterKnoten(graph, nvt.position)
    if (k) verteilerKnoten.add(k)
  }
  for (const schacht of schachtStandorte) {
    const k = naechsterKnoten(graph, schacht.position)
    if (k) verteilerKnoten.add(k)
  }

  // Bottom-up: welche Kanten haben mindestens einen Verteiler in ihrem
  // Teilbaum (= "danach kommt noch ein NVT/Schacht")?
  const kanteHatVerteilerDahinter = new Set<string>()
  for (const verteiler of verteilerKnoten) {
    if (!distVomStart.has(verteiler)) continue
    let cur = verteiler
    while (prev.has(cur)) {
      const vor = prev.get(cur)!
      kanteHatVerteilerDahinter.add(cur < vor ? `${cur}|${vor}` : `${vor}|${cur}`)
      cur = vor
    }
  }

  // Top-down: liegt vor einem Knoten (Richtung Start) bereits ein Verteiler?
  const vorgelagerterVerteiler = new Map<string, boolean>([[startKnoten, false]])
  const knotenNachDistanzSortiert = [...distVomStart.keys()].sort(
    (a, b) => (distVomStart.get(a) ?? 0) - (distVomStart.get(b) ?? 0)
  )
  for (const knoten of knotenNachDistanzSortiert) {
    if (knoten === startKnoten) continue
    const vor = prev.get(knoten)
    if (vor === undefined) continue
    vorgelagerterVerteiler.set(knoten, (vorgelagerterVerteiler.get(vor) ?? false) || verteilerKnoten.has(vor))
  }

  const r = (v: number) => Math.round(v * 100000) / 100000
  const knotenKeyVon = (p: LatLng) => `${r(p.lat)},${r(p.lng)}`

  return trassePfade.map((pfad) => {
    if (pfad.length < 2) return false
    for (let i = 0; i < pfad.length - 1; i++) {
      const a = knotenKeyVon(pfad[i])
      const b = knotenKeyVon(pfad[i + 1])
      const distA = distVomStart.get(a) ?? 0
      const distB = distVomStart.get(b) ?? 0
      const vorKnoten = distA <= distB ? a : b
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      const nvtVor = (vorgelagerterVerteiler.get(vorKnoten) ?? false) || verteilerKnoten.has(vorKnoten)
      const nvtNach = kanteHatVerteilerDahinter.has(key)
      if (nvtVor && nvtNach) return true
    }
    return false
  })
}

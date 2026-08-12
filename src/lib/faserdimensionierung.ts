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

export interface SegmentFaserbedarf {
  fasernBasis: number
  fasernReserve: number
  fasernGesamt: number
}

// Berechnet pro Trasse-Pfad-Segment die kumulierte Faserzahl, die dieses
// Segment tragen muss — Bottom-up über die Baumtopologie: jedes NVT/Schacht
// bündelt die Fasern aller ihm zugeordneten Hausanschlüsse, diese Summe
// "fließt" entlang des kürzesten Pfads zum Startpunkt über alle Segmente,
// die auf diesem Weg liegen. Ein Segment nah am Start trägt entsprechend
// mehr als eins nah an einem einzelnen NVT.
export function berechneFaserbedarfProSegment(
  trassePfade: LatLng[][],
  startpunkt: LatLng,
  nvtStandorte: NvtStandort[],
  schachtStandorte: SchachtStandort[],
  hausanschluesse: Hausstich[],
  adressen: Address[]
): SegmentFaserbedarf[] {
  const leer = trassePfade.map(() => ({ fasernBasis: 0, fasernReserve: 0, fasernGesamt: 0 }))
  if (trassePfade.length === 0) return leer

  const graph = baueGraph(trassePfade)
  const startKnoten = naechsterKnoten(graph, startpunkt)
  if (!startKnoten) return leer

  const hausById = new Map(hausanschluesse.map((h) => [h.id, h]))
  const adresseByUuid = new Map(adressen.map((a) => [a.uuid, a]))

  function fasernFuerHausIds(hausIds: string[]): number {
    let summe = 0
    for (const id of hausIds) {
      const haus = hausById.get(id)
      const adresse = haus ? adresseByUuid.get(haus.addressUuid) : undefined
      summe += fasernFuerAdresse(adresse)
    }
    return summe
  }

  const { dist: distVomStart, prev } = dijkstraVon(graph, startKnoten)

  // Pro Kante (Knoten-Paar, normiert) die Summe aller Fasern, die über sie
  // Richtung Start fließen.
  const kantenLast = new Map<string, number>()
  function addiereEntlangPfad(zielKnoten: string, fasern: number) {
    if (fasern <= 0 || !distVomStart.has(zielKnoten)) return
    let cur = zielKnoten
    while (prev.has(cur)) {
      const vor = prev.get(cur)!
      const key = cur < vor ? `${cur}|${vor}` : `${vor}|${cur}`
      kantenLast.set(key, (kantenLast.get(key) ?? 0) + fasern)
      cur = vor
    }
  }

  for (const nvt of nvtStandorte) {
    const knoten = naechsterKnoten(graph, nvt.position)
    if (knoten) addiereEntlangPfad(knoten, fasernFuerHausIds(nvt.hausanschlussIds))
  }
  for (const schacht of schachtStandorte) {
    const knoten = naechsterKnoten(graph, schacht.position)
    if (knoten) addiereEntlangPfad(knoten, fasernFuerHausIds(schacht.hausanschlussIds))
  }

  const r = (v: number) => Math.round(v * 100000) / 100000
  const knotenKeyVon = (p: LatLng) => `${r(p.lat)},${r(p.lng)}`

  return trassePfade.map((pfad) => {
    if (pfad.length < 2) return { fasernBasis: 0, fasernReserve: 0, fasernGesamt: 0 }
    // Alle Segmente sind dank segmentiereAnKreuzungen() an jedem Abzweig
    // getrennt — innerhalb eines Segments ist die Last auf jeder Teilkante
    // identisch, ein Sample (max über alle Teilkanten als Sicherheitsnetz
    // gegen Rundungs-/Snapping-Abweichungen) reicht.
    let basis = 0
    for (let i = 0; i < pfad.length - 1; i++) {
      const a = knotenKeyVon(pfad[i])
      const b = knotenKeyVon(pfad[i + 1])
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      basis = Math.max(basis, kantenLast.get(key) ?? 0)
    }
    const reserve = Math.ceil(basis * RESERVE_ANTEIL)
    return { fasernBasis: basis, fasernReserve: reserve, fasernGesamt: basis + reserve }
  })
}

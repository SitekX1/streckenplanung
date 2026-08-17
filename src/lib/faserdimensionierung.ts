import { Address, BackboneVerbindung, Hausstich, LatLng, MaterialUebersteuerung, NvtStandort, SchachtStandort } from './types'
import { MaterialEintrag, MaterialProfil, waehleVerbandMitReserve } from './materialkatalog'
import { baueGraph, naechsterKnoten, dijkstraVon } from './nvt'

// Faseranzahl-Berechnung nach Materialkonzept Abschnitt 1 (RN 4): "vier Fasern
// pro Wohneinheit/Teilnehmer und zwei Fasern pro Gebäude im Minimum als
// Point-to-Point-Verbindung bis zum Kollokationspunkt" + "Kapazitätsreserve
// von mindestens 15 %". 4 Fasern/Wohneinheit deckt die 2-pro-Gebäude-Grenze
// automatisch ab, sobald ein Gebäude mindestens 1 Wohneinheit hat.
const FASERN_PRO_WOHNEINHEIT = 4
// GIS-NB RN 4: "Kapazitätsreserve von mindestens 15 % der kalkulierten
// Anzahl von Leerrohren" — exportiert, da materialkatalog.ts denselben
// Reserve-Anteil für die Kundenanschluss-Verband-Dimensionierung nutzt.
export const RESERVE_ANTEIL = 0.15

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
// jede "Quelle" (ein Punkt mit einem Gewicht) speist ihre Last an IHREM
// EIGENEN Ort in den Graphen ein, die dann entlang des kürzesten Pfads zum
// Startpunkt über alle Segmente "fließt", die auf diesem Weg liegen — ein
// Segment nah am Start trägt entsprechend mehr Last als eins nah am
// jeweiligen Einspeisepunkt.
//
// WICHTIG (2026-08-13, Alex-Korrektur anhand eines Gabelungsbeispiels): die
// Quelle muss der TATSÄCHLICHE Abzweigpunkt jedes einzelnen Hausanschlusses
// sein (Hausstich.trassenPunkt), NICHT die Position des zugehörigen
// NVT/Schacht — sonst wird bei einer Gabelung, wo z.B. 5 Hausanschlüsse
// desselben NVT über den einen Ast und 8 über den anderen laufen, fälschlich
// die volle Summe (13) auf BEIDEN Ästen angenommen, statt sie korrekt nach
// tatsächlicher Herkunft aufzuteilen. Für die Kapazitäts-Obergrenze
// (berechneNvtKapazitaetsbedarfProSegment) ist die NVT-Position dagegen
// weiterhin richtig, da die physische Box-Kapazität eine Eigenschaft des
// NVT-Standorts selbst ist, nicht der einzelnen Hausanschlüsse.
function berechneLastProSegment(
  trassePfade: LatLng[][],
  startpunkt: LatLng,
  quellen: { position: LatLng; gewicht: number }[],
  // Wird die Last NUR bis zum ersten Verteiler (NVT/Schacht) Richtung Start
  // gezählt statt bis ganz zum Startpunkt? Siehe berechneHausanschlussAnzahlProSegment.
  stopAnKnoten?: Set<string>
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
      // Die letzte Teilstrecke BIS ZUM Verteiler zählt noch (Kundenanschluss-
      // Kabel läuft ja tatsächlich bis in dessen Box), dahinter (Richtung
      // Start) nicht mehr — dort übernimmt der Backbone.
      if (stopAnKnoten?.has(vor)) break
      cur = vor
    }
  }

  for (const { position, gewicht } of quellen) {
    const knoten = naechsterKnoten(graph, position)
    if (knoten) addiereEntlangPfad(knoten, gewicht)
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

// Faserzahl pro Trasse-Segment — Quelle ist der tatsächliche Abzweigpunkt
// (trassenPunkt) jedes einzelnen Hausanschlusses, siehe berechneLastProSegment().
export function berechneFaserbedarfProSegment(
  trassePfade: LatLng[][],
  startpunkt: LatLng,
  hausanschluesse: Hausstich[],
  adressen: Address[]
): SegmentFaserbedarf[] {
  const adresseByUuid = new Map(adressen.map((a) => [a.uuid, a]))
  const quellen = hausanschluesse.map((h) => ({
    position: h.trassenPunkt,
    gewicht: fasernFuerAdresse(adresseByUuid.get(h.addressUuid)),
  }))

  const basisProSegment = berechneLastProSegment(trassePfade, startpunkt, quellen)
  return basisProSegment.map((basis) => {
    const reserve = Math.ceil(basis * RESERVE_ANTEIL)
    return { fasernBasis: basis, fasernReserve: reserve, fasernGesamt: basis + reserve }
  })
}

// Anzahl der Hausanschlüsse, die kumulativ über jedes Trasse-Segment
// Richtung Startpunkt versorgt werden — Quelle ist der tatsächliche
// Abzweigpunkt (trassenPunkt) jedes einzelnen Hausanschlusses (NICHT die
// Position des zugehörigen NVT, siehe Erklärung bei berechneLastProSegment).
// Grundlage für die dynamische Kundenanschluss-Sammelverband-Dimensionierung
// (siehe materialkatalog.ts waehleVerbandMitReserve): nah an einer Gabelung
// trägt ein Segment die Summe aller Hausanschlüsse dahinter (z.B. 13 = 5+8),
// auf dem Stich hinter der Gabelung nur noch die des jeweiligen Astes (5
// oder 8) — ergibt automatisch kleinere Verbände Richtung Stichende.
//
// WICHTIG (2026-08-17, Alex-Korrektur: "zwischen Dorf und Dorf brauch ich
// keinen 24x7 mitverlegen, weil jedes Dorf seinen eigenen NVT hat"): die
// Zählung läuft NICHT bis zum Startpunkt durch, sondern stoppt am jeweils
// ERSTEN Verteiler (NVT/Schacht), den ein Hausanschluss auf seinem Weg
// Richtung Start passiert — dort wird das Kundenanschluss-Kabel ja
// tatsächlich physisch aufgesplittet/terminiert. Ohne diesen Stopp wurde
// z.B. die gesamte Hausanschluss-Anzahl von Dorf B fälschlich auch auf der
// reinen Backbone-Zuführung zwischen Dorf A und Dorf B mitgezählt, was dort
// zusätzlich zum Backbone einen (unnötigen) Kundenanschluss-Sammelverband
// ausgelöst hat (Doppelbelegung, siehe ermittleMaterialProSegment).
export function berechneHausanschlussAnzahlProSegment(
  trassePfade: LatLng[][],
  startpunkt: LatLng,
  hausanschluesse: Hausstich[],
  nvtStandorte: NvtStandort[],
  schachtStandorte: SchachtStandort[]
): number[] {
  const quellen = hausanschluesse.map((h) => ({ position: h.trassenPunkt, gewicht: 1 }))
  const graph = baueGraph(trassePfade)
  const verteilerKnoten = new Set<string>()
  for (const nvt of nvtStandorte) {
    const k = naechsterKnoten(graph, nvt.position)
    if (k) verteilerKnoten.add(k)
  }
  for (const schacht of schachtStandorte) {
    const k = naechsterKnoten(graph, schacht.position)
    if (k) verteilerKnoten.add(k)
  }
  return berechneLastProSegment(trassePfade, startpunkt, quellen, verteilerKnoten)
}

// Physische NVT-Kapazität als Obergrenze je Segment — HIER ist die
// NVT-Position (nicht der einzelne Hausanschluss) die richtige Quelle, da
// die Box-Kapazität eine Eigenschaft des Standorts selbst ist ("der Kasten
// hat nur 120 Plätze, mehr geht nicht"), unabhängig davon, über welchen Ast
// die einzelnen Hausanschlüsse tatsächlich anfahren. Schacht hat keine
// Kapazitätsgrenze (siehe types.ts), daher dort die tatsächliche Belegung.
export function berechneNvtKapazitaetsbedarfProSegment(
  trassePfade: LatLng[][],
  startpunkt: LatLng,
  nvtStandorte: NvtStandort[],
  schachtStandorte: SchachtStandort[]
): number[] {
  const quellen = [
    ...nvtStandorte.map((nvt) => ({ position: nvt.position, gewicht: nvt.kapazitaet })),
    ...schachtStandorte.map((s) => ({ position: s.position, gewicht: s.hausanschlussIds.length })),
  ]
  return berechneLastProSegment(trassePfade, startpunkt, quellen)
}

// Liefert pro Trasse-Segment die IDs genau der Hausanschlüsse, deren
// tatsächlicher Abzweigpunkt (trassenPunkt) über dieses Segment Richtung
// Start läuft — Grundlage für die Karten-Klickinfo (2026-08-13, Alex: "ich
// möchte sehen, auf welchem Segment welche Kunden hängen"). Analog zu
// berechneLastProSegment(), aber mit ID-Mengen statt Zahlen, damit man nicht
// nur die Anzahl, sondern die konkreten Adressen anzeigen/hervorheben kann.
//
// WICHTIG (2026-08-21, dieselbe Korrektur wie bei berechneHausanschlussAnzahlProSegment):
// stoppt am jeweils ERSTEN Verteiler (NVT/Schacht) Richtung Start — sonst
// tauchte ein Hausanschluss auch auf der reinen Backbone-Zuführung hinter
// seinem eigenen NVT wieder in der Liste auf, obwohl dort physisch gar kein
// Kundenanschluss-Kabel mehr liegt (nur noch Backbone). Wird u.a. für die
// Verband-Hervorhebung gebraucht (ermittleVerbandSegmente) — die Hausliste
// muss exakt zum tatsächlich dort verlegten Material passen.
export function ermittleHausanschluesseProSegment(
  trassePfade: LatLng[][],
  startpunkt: LatLng,
  hausanschluesse: Hausstich[],
  nvtStandorte: NvtStandort[] = [],
  schachtStandorte: SchachtStandort[] = []
): string[][] {
  const leer = trassePfade.map(() => [] as string[])
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

  const kantenHausIds = new Map<string, Set<string>>()
  for (const h of hausanschluesse) {
    const knoten = naechsterKnoten(graph, h.trassenPunkt)
    if (!knoten || !distVomStart.has(knoten)) continue
    let cur = knoten
    while (prev.has(cur)) {
      const vor = prev.get(cur)!
      const key = cur < vor ? `${cur}|${vor}` : `${vor}|${cur}`
      if (!kantenHausIds.has(key)) kantenHausIds.set(key, new Set())
      kantenHausIds.get(key)!.add(h.id)
      if (verteilerKnoten.has(vor)) break
      cur = vor
    }
  }

  const r = (v: number) => Math.round(v * 100000) / 100000
  const knotenKeyVon = (p: LatLng) => `${r(p.lat)},${r(p.lng)}`

  return trassePfade.map((pfad) => {
    if (pfad.length < 2) return []
    // Vereinigung über alle Teilkanten des Segments (statt nur eine Kante zu
    // nehmen) als Sicherheitsnetz gegen Rundungs-/Snapping-Abweichungen —
    // im Normalfall ist die Menge auf jeder Teilkante ohnehin identisch.
    const ids = new Set<string>()
    for (let i = 0; i < pfad.length - 1; i++) {
      const a = knotenKeyVon(pfad[i])
      const b = knotenKeyVon(pfad[i + 1])
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      for (const id of kantenHausIds.get(key) ?? []) ids.add(id)
    }
    return [...ids]
  })
}

// Bestimmt pro Trasse-Segment, ob es eine echte Backbone-Verbindung
// darstellt (Startpunkt-zu-Verteiler oder Verteiler-zu-Verteiler) — nur dort
// gehört das feste Backbone-Material hin (2026-08-12, Alex: "nicht jede
// Trasse braucht zwei Leerrohrsegmente, es kommt darauf an ob eine
// SV/NVT-zu-NVT-Verbindung da ist"; klargestellt: "vom Startpunkt bis zum
// nächstliegenden NVT ist immer Backbone", der Startpunkt zählt hier also
// selbst als Verteiler-Ende — daher unten mit in verteilerKnoten
// aufgenommen). Ein Segment gilt als Backbone, wenn auf dem Pfad vom
// Startpunkt aus VOR diesem Segment bereits ein Verteiler (Start, NVT oder
// Schacht) liegt UND HINTER diesem Segment (im Teilbaum) noch mindestens ein
// weiterer NVT/Schacht folgt — nur Stiche HINTER dem letzten Verteiler (nur
// noch Hausanschlüsse, kein weiterer Verteiler mehr) zählen NICHT als
// Backbone, dort läuft nur noch der Kundenanschluss-Sammelverband (siehe
// berechneHausanschlussAnzahlProSegment) — ggf. überlagert mit dem Backbone
// auf Segmenten, wo beides zutrifft (Doppelbelegung).
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

  // Startpunkt zählt selbst als Verteiler-Ende (siehe Erklärung oben) —
  // dadurch ist automatisch jede Zuführung vom Start zum jeweils
  // nächstliegenden NVT/Schacht auf jedem abgehenden Ast Backbone.
  const verteilerKnoten = new Set<string>([startKnoten])
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

// Liefert pro Trasse-Segment das manuell gewählte Material einer
// Backbone-Verbindung (siehe BackboneVerbindung in types.ts), falls das
// Segment auf dem kürzesten Pfad zwischen deren "von"/"nach"-Standorten
// liegt — sonst null (automatische Zuordnung greift wie bisher). Bewusst
// jedes Mal frisch aus der aktuellen Trasse-Geometrie abgeleitet (Dijkstra
// zwischen den beiden gespeicherten Positionen) statt über gespeicherte
// Segment-Indizes, da segmentiereAnKreuzungen() die Trasse bei jeder
// Änderung neu aufteilen kann — Indizes wären sofort wieder falsch.
export function ermittleUeberschriebenesMaterialProSegment(
  trassePfade: LatLng[][],
  verbindungen: BackboneVerbindung[]
): Array<MaterialEintrag | null> {
  const ergebnis: Array<MaterialEintrag | null> = trassePfade.map(() => null)
  if (trassePfade.length === 0 || verbindungen.length === 0) return ergebnis

  const graph = baueGraph(trassePfade)
  const r = (v: number) => Math.round(v * 100000) / 100000
  const knotenKeyVon = (p: LatLng) => `${r(p.lat)},${r(p.lng)}`

  for (const verbindung of verbindungen) {
    const vonKnoten = naechsterKnoten(graph, verbindung.von)
    const nachKnoten = naechsterKnoten(graph, verbindung.nach)
    if (!vonKnoten || !nachKnoten || vonKnoten === nachKnoten) continue

    const { prev } = dijkstraVon(graph, vonKnoten)
    if (!prev.has(nachKnoten)) continue // nicht (mehr) über die Trasse verbunden

    const kantenAufPfad = new Set<string>()
    let cur = nachKnoten
    while (prev.has(cur)) {
      const vor = prev.get(cur)!
      kantenAufPfad.add(cur < vor ? `${cur}|${vor}` : `${vor}|${cur}`)
      cur = vor
    }

    trassePfade.forEach((pfad, i) => {
      if (ergebnis[i] || pfad.length < 2) return
      for (let j = 0; j < pfad.length - 1; j++) {
        const a = knotenKeyVon(pfad[j])
        const b = knotenKeyVon(pfad[j + 1])
        const key = a < b ? `${a}|${b}` : `${b}|${a}`
        if (kantenAufPfad.has(key)) { ergebnis[i] = verbindung.material; break }
      }
    })
  }

  return ergebnis
}

export interface SegmentMaterial {
  haupt: MaterialEintrag // Kundenanschluss-Sammelverband, sonst Backbone
  zusatz: MaterialEintrag | null // NUR bei Doppelbelegung gesetzt (beides läuft aufs Segment)
}

// Einzige Quelle für "welches Material läuft auf welchem Trasse-Segment" —
// von MapView.tsx (Kartenfarbe + Klick-Info) UND KalkulationModal.tsx
// (Material-Kosten nach tatsächlich verlegter Länge je Typ) genutzt, damit
// beide garantiert dieselbe Zuordnung zeigen statt zweier Implementierungen,
// die mit der Zeit auseinanderlaufen könnten. Ohne mindestens einen
// Verteiler (NVT/Schacht) liefert sie überall null zurück — vor dem ersten
// NVT/Schacht ist noch kein Verbund sinnvoll bestimmbar (siehe
// ermittleBackboneSegmente/berechneNvtKapazitaetsbedarfProSegment, die beide
// von dessen Position abhängen).
export function ermittleMaterialProSegment(
  trassePfade: LatLng[][],
  startpunkt: LatLng | null,
  nvtStandorte: NvtStandort[],
  schachtStandorte: SchachtStandort[],
  hausanschluesse: Hausstich[],
  materialProfil: MaterialProfil,
  backboneVerbindungen: BackboneVerbindung[],
  materialUebersteuerungen: MaterialUebersteuerung[] = []
): Array<SegmentMaterial | null> {
  if (!startpunkt || trassePfade.length === 0 || (nvtStandorte.length === 0 && schachtStandorte.length === 0)) {
    return trassePfade.map(() => null)
  }
  const backbone = ermittleBackboneSegmente(trassePfade, startpunkt, nvtStandorte, schachtStandorte)
  const bedarfProSegment = berechneHausanschlussAnzahlProSegment(trassePfade, startpunkt, hausanschluesse, nvtStandorte, schachtStandorte)
  const kapazitaetsObergrenzeProSegment = berechneNvtKapazitaetsbedarfProSegment(trassePfade, startpunkt, nvtStandorte, schachtStandorte)
  const ueberschriebenProSegment = ermittleUeberschriebenesMaterialProSegment(trassePfade, backboneVerbindungen)
  const manuellProSegment = ermittleMaterialUebersteuerungProSegment(trassePfade, materialUebersteuerungen)

  return trassePfade.map((_, i): SegmentMaterial | null => {
    const bedarf = bedarfProSegment[i] ?? 0
    const kundeAuto = bedarf > 0 ? waehleVerbandMitReserve(materialProfil, bedarf, kapazitaetsObergrenzeProSegment[i] || undefined) : null
    // Manuelle Übersteuerung (2026-08-21, Alex: "im Nachhinein kann ich
    // aber keinen einzigen Verbund bearbeiten") gewinnt immer gegen die
    // automatische Stufenwahl für dieses Segment.
    const kunde = manuellProSegment[i] ?? kundeAuto
    const back = ueberschriebenProSegment[i] ?? (backbone[i] ? materialProfil.trasse : null)
    if (kunde && back) return { haupt: kunde, zusatz: back }
    if (kunde) return { haupt: kunde, zusatz: null }
    if (back) return { haupt: back, zusatz: null }
    return null
  })
}

// Liefert pro Trasse-Segment das manuell gewählte Material, falls für dessen
// eigene Endpunkte eine Übersteuerung hinterlegt ist (siehe
// MaterialUebersteuerung in types.ts) — sonst null (automatische Wahl greift
// wie bisher). Anders als ermittleUeberschriebenesMaterialProSegment (für
// BackboneVerbindung, die einen ganzen PFAD zwischen zwei Verteilern
// überschreibt) reicht hier ein reiner Endpunkt-Abgleich ohne Pfadsuche —
// eine Material-Übersteuerung bezieht sich immer auf GENAU EIN
// Trasse-Segment. Ein längerer, mehrsegmentiger Verband bekommt beim
// Übersteuern entsprechend mehrere Einträge, einen je Segment (siehe
// handleMaterialUebersteuern in page.tsx).
export function ermittleMaterialUebersteuerungProSegment(
  trassePfade: LatLng[][],
  uebersteuerungen: MaterialUebersteuerung[]
): Array<MaterialEintrag | null> {
  const ergebnis: Array<MaterialEintrag | null> = trassePfade.map(() => null)
  if (uebersteuerungen.length === 0) return ergebnis

  const r = (v: number) => Math.round(v * 100000) / 100000
  const nk = (p: LatLng) => `${r(p.lat)},${r(p.lng)}`

  const lookup = new Map<string, MaterialEintrag>()
  for (const u of uebersteuerungen) {
    const a = nk(u.von), b = nk(u.nach)
    lookup.set(a < b ? `${a}|${b}` : `${b}|${a}`, u.material)
  }

  trassePfade.forEach((pfad, i) => {
    if (pfad.length < 2) return
    const a = nk(pfad[0]), b = nk(pfad[pfad.length - 1])
    const treffer = lookup.get(a < b ? `${a}|${b}` : `${b}|${a}`)
    if (treffer) ergebnis[i] = treffer
  })

  return ergebnis
}

// Liefert die Indizes aller Trasse-Segmente, die zur selben zusammen-
// hängenden Kundenanschluss-Sammelverband-Instanz gehören wie das übergebene
// Start-Segment — Grundlage für die Karten-Hervorhebung "kompletter Verlauf
// dieses Verbands" (2026-08-21, Alex: "möchte den Verlauf des Verbands
// sehen, auch bei einer Gabelung, wo sich z.B. ein 24x7 in zwei 12x7
// aufteilt"). Zwei benachbarte Segmente (teilen sich einen Endpunkt) gehören
// zur selben Instanz, solange beide DASSELBE Material tragen UND tatsächlich
// eigene Hausanschlüsse darauf hängen — ein reines Backbone-Segment ohne
// Kundenanschluss-Bedarf (z.B. hinter dem letzten Verteiler Richtung Start)
// zählt nicht dazu und bildet automatisch die Grenze, ebenso wie die Stelle,
// an der sich ein Verband durch eine Gabelung in eine kleinere Stufe
// aufteilt. `hausanschluesseProSegment` muss aus derselben (verteiler-
// stoppenden) Berechnung wie `materialProSegment` stammen, sonst passt die
// "hat Hausanschlüsse"-Grenzbedingung nicht zur tatsächlichen Material-Logik.
export function ermittleVerbandSegmente(
  trassePfade: LatLng[][],
  materialProSegment: Array<SegmentMaterial | null>,
  hausanschluesseProSegment: string[][],
  startSegmentIdx: number
): number[] {
  const zielMaterial = materialProSegment[startSegmentIdx]?.haupt
  if (!zielMaterial || (hausanschluesseProSegment[startSegmentIdx]?.length ?? 0) === 0) {
    return [startSegmentIdx]
  }
  const zielKey = zielMaterial.bezeichnungFirma || `${zielMaterial.lrArt}-${zielMaterial.lrAnzahl}`

  const r = (v: number) => Math.round(v * 100000) / 100000
  const nk = (p: LatLng) => `${r(p.lat)},${r(p.lng)}`
  const endpunkte = trassePfade.map((pfad) => (pfad.length >= 2 ? [nk(pfad[0]), nk(pfad[pfad.length - 1])] : null))

  const anKnoten = new Map<string, number[]>()
  endpunkte.forEach((eps, i) => {
    if (!eps) return
    for (const k of eps) {
      if (!anKnoten.has(k)) anKnoten.set(k, [])
      anKnoten.get(k)!.push(i)
    }
  })

  function gehoertZurInstanz(i: number): boolean {
    if ((hausanschluesseProSegment[i]?.length ?? 0) === 0) return false
    const m = materialProSegment[i]?.haupt
    if (!m) return false
    return (m.bezeichnungFirma || `${m.lrArt}-${m.lrAnzahl}`) === zielKey
  }

  const besucht = new Set<number>([startSegmentIdx])
  const stapel = [startSegmentIdx]
  while (stapel.length > 0) {
    const cur = stapel.pop()!
    const eps = endpunkte[cur]
    if (!eps) continue
    for (const k of eps) {
      for (const nachbar of anKnoten.get(k) ?? []) {
        if (besucht.has(nachbar) || !gehoertZurInstanz(nachbar)) continue
        besucht.add(nachbar)
        stapel.push(nachbar)
      }
    }
  }
  return [...besucht]
}

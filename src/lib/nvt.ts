import { LatLng, Hausstich, NvtStandort } from './types'

function haversine(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(sa))
}

// ~1m Rundung für Knoten-Deduplizierung — gemeinsame Endpunkte verschiedener
// trassePfade-Segmente (z.B. nach mehreren "Trasse erweitern"-Läufen) teilen
// sich exakt denselben Ursprungspunkt und müssen im Graph zu einem Knoten
// zusammenfallen, sonst zerfällt der Baum künstlich in Inseln.
const rundung = (v: number) => Math.round(v * 100000) / 100000
const knotenKey = (p: LatLng) => `${rundung(p.lat)},${rundung(p.lng)}`

interface Knoten {
  coord: LatLng
  nachbarn: Array<{ zu: string; dist: number }>
}

function baueGraph(trassePfade: LatLng[][]): Map<string, Knoten> {
  const graph = new Map<string, Knoten>()
  function knoten(p: LatLng): string {
    const k = knotenKey(p)
    if (!graph.has(k)) graph.set(k, { coord: p, nachbarn: [] })
    return k
  }
  for (const pfad of trassePfade) {
    for (let i = 0; i < pfad.length - 1; i++) {
      const a = knoten(pfad[i]), b = knoten(pfad[i + 1])
      if (a === b) continue
      const d = haversine(pfad[i], pfad[i + 1])
      graph.get(a)!.nachbarn.push({ zu: b, dist: d })
      graph.get(b)!.nachbarn.push({ zu: a, dist: d })
    }
  }
  return graph
}

// Lineare Suche reicht — läuft nur einmalig pro Nutzer-Klick auf "NVT
// generieren", nicht in einer heißen Schleife wie beim OSM-Routing.
function naechsterKnoten(graph: Map<string, Knoten>, coord: LatLng): string | null {
  let bestKey: string | null = null
  let bestDist = Infinity
  for (const [key, k] of graph) {
    const d = haversine(coord, k.coord)
    if (d < bestDist) { bestDist = d; bestKey = key }
  }
  return bestKey
}

// Dijkstra von einer Quelle zu allen erreichbaren Knoten — Distanzen + Vorgänger
// (für Pfad-Rekonstruktion). Einfache lineare Prioritätssuche: pro Dorf sind
// das üblicherweise einige hundert Knoten, nicht die zehntausende eines
// OSM-Straßennetzes — ein Min-Heap lohnt den Zusatzaufwand hier nicht.
function dijkstraVon(graph: Map<string, Knoten>, start: string): { dist: Map<string, number>; prev: Map<string, string> } {
  const dist = new Map<string, number>([[start, 0]])
  const prev = new Map<string, string>()
  const visited = new Set<string>()
  while (true) {
    let u: string | null = null
    let ud = Infinity
    for (const [k, d] of dist) { if (!visited.has(k) && d < ud) { u = k; ud = d } }
    if (u === null) break
    visited.add(u)
    for (const { zu, dist: d } of graph.get(u)?.nachbarn ?? []) {
      const nd = ud + d
      if (!dist.has(zu) || nd < dist.get(zu)!) { dist.set(zu, nd); prev.set(zu, u) }
    }
  }
  return { dist, prev }
}

function dijkstraMultiQuelle(graph: Map<string, Knoten>, quellen: string[]): Map<string, number> {
  const dist = new Map<string, number>()
  for (const q of quellen) dist.set(q, 0)
  const visited = new Set<string>()
  while (true) {
    let u: string | null = null
    let ud = Infinity
    for (const [k, d] of dist) { if (!visited.has(k) && d < ud) { u = k; ud = d } }
    if (u === null) break
    visited.add(u)
    for (const { zu, dist: d } of graph.get(u)?.nachbarn ?? []) {
      const nd = ud + d
      if (!dist.has(zu) || nd < dist.get(zu)!) dist.set(zu, nd)
    }
  }
  return dist
}

// Zählt, wie viele der (noch unversorgten) Terminals innerhalb distanzLimitMeter
// von "von" liegen — und liefert gleich deren Hausstich-IDs mit.
function reichweite(
  graph: Map<string, Knoten>,
  von: string,
  unversorgt: Map<string, string>,
  distanzLimitMeter: number
): string[] {
  const { dist } = dijkstraVon(graph, von)
  const erreichte: string[] = []
  for (const [hausId, knoten] of unversorgt) {
    if ((dist.get(knoten) ?? Infinity) <= distanzLimitMeter) erreichte.push(hausId)
  }
  return erreichte
}

export interface NvtErgebnis {
  standorte: NvtStandort[]
  // Hausstich-IDs, die in keinem gemeinsamen Netzteilstück mit dem Startpunkt
  // liegen (analog zu den "nicht angebundenen Adressen" beim Trasse generieren)
  // — konnten daher nicht bewertet/versorgt werden, bitte manuell prüfen.
  nichtErreichbar: string[]
}

// Platziert NVT-Standorte auf dem Trassen-Baum, sodass kein Hausanschluss (aus
// hausanschluesse) weiter als distanzLimitMeter (entlang der Leitung, nicht
// Luftlinie) von seinem NVT entfernt ist UND kein NVT mehr Hausanschlüsse
// trägt, als seine Kapazität zulässt. Aussiedlerhöfe sollen VOR dem Aufruf
// bereits aus hausanschluesse herausgefiltert sein (siehe page.tsx) — die
// Abstandsregel gilt für sie explizit nicht.
//
// WICHTIG: In der Praxis stehen nie zwei NVT nebeneinander am selben
// Standort — bei zu hoher Verdichtung wird stattdessen die Fläche geografisch
// aufgeteilt (jeder Standort bedient eine eigene, klar abgegrenzte Zone).
// "Cover-and-remove"-Greedy:
// 1. Nimm den am weitesten von jedem bisherigen Standort entfernten (noch
//    unversorgten) Hausanschluss.
// 2. Laufe von dort den (eindeutigen, da Baum) Pfad Richtung Startpunkt, so
//    weit wie möglich, ohne distanzLimitMeter zu überschreiten.
// 3. Zähle an diesem Punkt, wie viele unversorgte Hausanschlüsse insgesamt in
//    Reichweite liegen (nicht nur der eine) — das ist die natürliche Zonengröße.
// 4. Wähle die kleinste erlaubte Kapazität, die diese Zonengröße noch fasst;
//    reicht selbst die größte nicht, wird der Standort so weit Richtung
//    Hausanschluss zurückgeschoben, bis die Zone in die größte erlaubte
//    Kapazität passt — das verkleinert die Zone geografisch, statt eine
//    zweite Box an denselben Punkt zu stellen.
// 5. Alle so versorgten Hausanschlüsse werden aus dem "unversorgt"-Topf
//    entfernt, weiter mit dem nächsten am weitesten entfernten Rest.
export function berechneNvtStandorte(
  trassePfade: LatLng[][],
  hausanschluesse: Hausstich[],
  startpunkt: LatLng,
  distanzLimitMeter: number,
  erlaubteKapazitaeten: number[]
): NvtErgebnis {
  if (hausanschluesse.length === 0 || erlaubteKapazitaeten.length === 0) {
    return { standorte: [], nichtErreichbar: [] }
  }
  const kapazitaetenAufsteigend = [...erlaubteKapazitaeten].sort((a, b) => a - b)
  const maxKapazitaet = kapazitaetenAufsteigend[kapazitaetenAufsteigend.length - 1]

  const graph = baueGraph(trassePfade)
  const startKnoten = graph.size > 0 ? naechsterKnoten(graph, startpunkt) : null
  if (!startKnoten) {
    return { standorte: [], nichtErreichbar: hausanschluesse.map((h) => h.id) }
  }

  const terminalKnoten = new Map<string, string>() // Hausstich.id -> Knoten-Key
  for (const h of hausanschluesse) {
    const k = naechsterKnoten(graph, h.trassenPunkt)
    if (k) terminalKnoten.set(h.id, k)
  }

  // Erreichbarkeit vom Startpunkt aus einmalig prüfen (getrennte Teilgraphen
  // z.B. bei Luftlinien-Verbindungen oder Dorf-Inseln ohne durchgehende Trasse)
  const { dist: distVomStart } = dijkstraVon(graph, startKnoten)
  const nichtErreichbar: string[] = []
  const unversorgt = new Map<string, string>()
  for (const [hausId, knoten] of terminalKnoten) {
    if (distVomStart.has(knoten)) unversorgt.set(hausId, knoten)
    else nichtErreichbar.push(hausId)
  }

  const ergebnisStandorte: NvtStandort[] = []
  const standortKnoten: string[] = []
  const maxIterationen = unversorgt.size + 1

  for (let iter = 0; iter < maxIterationen && unversorgt.size > 0; iter++) {
    const abdeckung = dijkstraMultiQuelle(graph, standortKnoten)

    let schlechtesterHausId: string | null = null
    let schlechtesterKnoten: string | null = null
    let schlechtesteDist = -1
    for (const [hausId, knoten] of unversorgt) {
      const d = abdeckung.get(knoten) ?? Infinity
      if (d > schlechtesteDist) { schlechtesteDist = d; schlechtesterHausId = hausId; schlechtesterKnoten = knoten }
    }
    if (schlechtesterKnoten === null) break
    // Bereits alle innerhalb des Limits vom bisherigen Baum aus versorgt? Dann
    // fehlt nur noch der Fall "gar keine Standorte, aber alles schon nah am
    // Start" — regulär trotzdem einen ersten Standort setzen, siehe unten.
    if (standortKnoten.length > 0 && schlechtesteDist <= distanzLimitMeter) break

    // Eindeutiger Baum-Pfad vom schlechtesten Hausanschluss zurück zum Startpunkt
    const { prev } = dijkstraVon(graph, schlechtesterKnoten)
    const pfad: string[] = [schlechtesterKnoten]
    let cur = schlechtesterKnoten
    while (prev.has(cur)) { cur = prev.get(cur)!; pfad.push(cur) }
    // pfad[0] = Hausanschluss-Knoten, pfad[letztes] = Startpunkt-Knoten

    // So weit wie möglich (max. distanzLimitMeter) vom Hausanschluss weg laufen.
    let kumuliert = 0
    let weitesterIdx = 0
    for (let i = 0; i < pfad.length - 1; i++) {
      const kante = graph.get(pfad[i])!.nachbarn.find((n) => n.zu === pfad[i + 1])
      const kantenLaenge = kante?.dist ?? 0
      if (kumuliert + kantenLaenge > distanzLimitMeter) break
      kumuliert += kantenLaenge
      weitesterIdx = i + 1
    }

    // Natürliche Zonengröße am weitesten entfernten gültigen Punkt ermitteln,
    // dann bei Bedarf Richtung Hausanschluss zurückschieben, bis die Zone in
    // die größte erlaubte Kapazität passt (statt zwei Standorte übereinander).
    let standortIdx = weitesterIdx
    let versorgteIds = reichweite(graph, pfad[standortIdx], unversorgt, distanzLimitMeter)
    while (versorgteIds.length > maxKapazitaet && standortIdx > 0) {
      standortIdx--
      versorgteIds = reichweite(graph, pfad[standortIdx], unversorgt, distanzLimitMeter)
    }
    // Absicherung gegen einen pathologischen Fall (extrem viele Hausanschlüsse
    // exakt am selben Punkt): harte Kappung, damit die Schleife terminiert.
    if (versorgteIds.length > maxKapazitaet) {
      versorgteIds = versorgteIds.slice(0, maxKapazitaet)
    }
    if (!versorgteIds.includes(schlechtesterHausId!)) versorgteIds.push(schlechtesterHausId!)

    const kapazitaet = kapazitaetenAufsteigend.find((k) => k >= versorgteIds.length) ?? maxKapazitaet
    const standortKnotenId = pfad[standortIdx]

    ergebnisStandorte.push({ position: graph.get(standortKnotenId)!.coord, kapazitaet, belegung: versorgteIds.length })
    standortKnoten.push(standortKnotenId)
    for (const id of versorgteIds) unversorgt.delete(id)
  }

  return { standorte: ergebnisStandorte, nichtErreichbar }
}

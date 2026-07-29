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

// Wie dijkstraMultiQuelle, verfolgt zusätzlich mit, über welche Quelle (Index
// in quellen) jeder Knoten am kürzesten erreicht wurde — für die Zuordnung
// "welcher Hausanschluss hängt an welchem NVT-Standort".
function dijkstraMultiQuelleMitIndex(
  graph: Map<string, Knoten>,
  quellen: string[]
): { dist: Map<string, number>; quelle: Map<string, number> } {
  const dist = new Map<string, number>()
  const quelle = new Map<string, number>()
  for (let i = 0; i < quellen.length; i++) { dist.set(quellen[i], 0); quelle.set(quellen[i], i) }
  const visited = new Set<string>()
  while (true) {
    let u: string | null = null
    let ud = Infinity
    for (const [k, d] of dist) { if (!visited.has(k) && d < ud) { u = k; ud = d } }
    if (u === null) break
    visited.add(u)
    for (const { zu, dist: d } of graph.get(u)?.nachbarn ?? []) {
      const nd = ud + d
      if (!dist.has(zu) || nd < dist.get(zu)!) { dist.set(zu, nd); quelle.set(zu, quelle.get(u)!) }
    }
  }
  return { dist, quelle }
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
// Luftlinie) von seinem nächsten NVT entfernt ist UND kein NVT mehr als
// kapazitaet Hausanschlüsse trägt (z.B. 96er/120er-Rohr). Aussiedlerhöfe
// sollen VOR dem Aufruf bereits aus hausanschluesse herausgefiltert sein
// (siehe page.tsx) — die Abstandsregel gilt für sie explizit nicht.
//
// Zweistufig:
// 1. Greedy-Abstandsdeckung: Solange ein Hausanschluss weiter als das Limit
//    vom nächsten bereits gesetzten NVT-Standort entfernt ist, wird ein neuer
//    Standort auf dem (eindeutigen, da Baum) Pfad von diesem Hausanschluss
//    zurück zum Startpunkt gesetzt — so weit wie möglich vom Hausanschluss
//    weg, ohne das Limit zu überschreiten. Minimiert die Standort-Anzahl
//    nicht zwingend optimal, garantiert aber zuverlässig die Abstandsregel.
// 2. Kapazitäts-Aufteilung: Jedem Standort werden die ihm nächstgelegenen
//    Hausanschlüsse zugeordnet. Übersteigt das die Kapazität, wird an genau
//    diesem Standort einfach eine weitere NVT-Box aufgestellt (in der Praxis:
//    zweiter Kasten am selben Schrank/Standort) — Abstand bleibt dadurch
//    unverändert korrekt, nur die Kapazität wird aufgeteilt.
export function berechneNvtStandorte(
  trassePfade: LatLng[][],
  hausanschluesse: Hausstich[],
  startpunkt: LatLng,
  distanzLimitMeter: number,
  kapazitaet: number
): NvtErgebnis {
  if (hausanschluesse.length === 0) return { standorte: [], nichtErreichbar: [] }

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
  const gueltigeTerminals = new Map<string, string>()
  for (const [hausId, knoten] of terminalKnoten) {
    if (distVomStart.has(knoten)) gueltigeTerminals.set(hausId, knoten)
    else nichtErreichbar.push(hausId)
  }

  const standorte: string[] = []
  const maxIterationen = gueltigeTerminals.size + 1
  for (let iter = 0; iter < maxIterationen; iter++) {
    const abdeckung = dijkstraMultiQuelle(graph, standorte)

    let schlechtesterKnoten: string | null = null
    let schlechtesteDist = -1
    for (const knoten of gueltigeTerminals.values()) {
      const d = abdeckung.get(knoten) ?? Infinity
      if (d > schlechtesteDist) { schlechtesteDist = d; schlechtesterKnoten = knoten }
    }

    if (schlechtesterKnoten === null || schlechtesteDist <= distanzLimitMeter) break

    // Eindeutiger Baum-Pfad vom schlechtesten Hausanschluss zurück zum Startpunkt
    const { prev } = dijkstraVon(graph, schlechtesterKnoten)
    const pfad: string[] = [schlechtesterKnoten]
    let cur = schlechtesterKnoten
    while (prev.has(cur)) { cur = prev.get(cur)!; pfad.push(cur) }
    // pfad[0] = Hausanschluss-Knoten, pfad[letztes] = Startpunkt-Knoten

    // So weit wie möglich (max. distanzLimitMeter) vom Hausanschluss weg laufen —
    // konservativ am letzten Knoten VOR Überschreiten des Limits stehen bleiben.
    let kumuliert = 0
    let neuerStandort = pfad[0]
    for (let i = 0; i < pfad.length - 1; i++) {
      const kante = graph.get(pfad[i])!.nachbarn.find((n) => n.zu === pfad[i + 1])
      const kantenLaenge = kante?.dist ?? 0
      if (kumuliert + kantenLaenge > distanzLimitMeter) break
      kumuliert += kantenLaenge
      neuerStandort = pfad[i + 1]
    }

    standorte.push(neuerStandort)
  }

  if (standorte.length === 0) return { standorte: [], nichtErreichbar }

  // Zuordnung: jeder Hausanschluss zu seinem nächstgelegenen Standort
  const { quelle: naechsterStandortIdx } = dijkstraMultiQuelleMitIndex(graph, standorte)
  const gruppenProStandort: string[][] = standorte.map(() => [])
  for (const [hausId, knoten] of gueltigeTerminals) {
    const idx = naechsterStandortIdx.get(knoten) ?? 0
    gruppenProStandort[idx].push(hausId)
  }

  // Kapazität durchsetzen: pro Standort in Kapazitäts-Häppchen aufteilen —
  // jedes Häppchen wird eine eigene physische NVT-Box an derselben Position.
  const ergebnisStandorte: NvtStandort[] = []
  standorte.forEach((knoten, i) => {
    const gruppe = gruppenProStandort[i]
    const position = graph.get(knoten)!.coord
    if (gruppe.length === 0) {
      ergebnisStandorte.push({ position, kapazitaet, belegung: 0 })
      return
    }
    for (let offset = 0; offset < gruppe.length; offset += kapazitaet) {
      const belegung = Math.min(kapazitaet, gruppe.length - offset)
      ergebnisStandorte.push({ position, kapazitaet, belegung })
    }
  })

  return {
    standorte: ergebnisStandorte,
    nichtErreichbar,
  }
}

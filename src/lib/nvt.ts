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

export interface NvtErgebnis {
  standorte: NvtStandort[]
  // Hausstich-IDs, die in keinem gemeinsamen Netzteilstück mit dem Startpunkt
  // liegen (analog zu den "nicht angebundenen Adressen" beim Trasse generieren)
  // — konnten daher nicht bewertet/versorgt werden, bitte manuell prüfen.
  nichtErreichbar: string[]
}

interface Terminal { hausId: string; knoten: string }
interface Zone { zentrum: string; terminals: Terminal[]; maxDist: number }

// Findet die zwei Terminals, die im Baum am weitesten voneinander entfernt
// liegen ("Durchmesser" der von den Terminals aufgespannten Teilfläche) —
// Standardtrick: von einem beliebigen Terminal aus das am weitesten entfernte
// suchen (= ein Durchmesser-Ende), von dort erneut das am weitesten entfernte
// suchen (= das andere Ende).
function durchmesserEndpunkte(graph: Map<string, Knoten>, terminals: Terminal[]): [Terminal, Terminal] {
  const irgendeins = terminals[0]
  const { dist: distVonIrgendeinem } = dijkstraVon(graph, irgendeins.knoten)
  let a = irgendeins
  let bestDist = -1
  for (const t of terminals) {
    const d = distVonIrgendeinem.get(t.knoten) ?? -1
    if (d > bestDist) { bestDist = d; a = t }
  }
  const { dist: distVonA } = dijkstraVon(graph, a.knoten)
  let b = a
  bestDist = -1
  for (const t of terminals) {
    const d = distVonA.get(t.knoten) ?? -1
    if (d > bestDist) { bestDist = d; b = t }
  }
  return [a, b]
}

// Zentraler Standort für eine Gruppe von Terminals: der Mittelpunkt (nach
// Streckenlänge) auf dem eindeutigen Baum-Pfad zwischen den beiden am
// weitesten auseinanderliegenden Terminals. Das ist der klassische "Baum-
// Zentrum"-Algorithmus — minimiert die maximale Distanz zu jedem Terminal in
// der Gruppe, nicht nur zu den beiden Endpunkten.
function findeZentrum(graph: Map<string, Knoten>, terminals: Terminal[]): Zone {
  if (terminals.length === 1) {
    return { zentrum: terminals[0].knoten, terminals, maxDist: 0 }
  }
  const [a, b] = durchmesserEndpunkte(graph, terminals)
  const { dist: distVonA, prev } = dijkstraVon(graph, a.knoten)
  const pfad: string[] = [b.knoten]
  let cur = b.knoten
  while (prev.has(cur)) { cur = prev.get(cur)!; pfad.push(cur) }
  pfad.reverse() // a.knoten -> ... -> b.knoten

  const gesamtLaenge = distVonA.get(b.knoten) ?? 0
  const halbeLaenge = gesamtLaenge / 2

  let kumuliert = 0
  let zentrum = pfad[0]
  for (let i = 0; i < pfad.length - 1; i++) {
    const kante = graph.get(pfad[i])!.nachbarn.find((n) => n.zu === pfad[i + 1])
    const naechsteKumuliert = kumuliert + (kante?.dist ?? 0)
    // Am Knoten stehen bleiben, der der Mitte am nächsten ist
    if (Math.abs(kumuliert - halbeLaenge) <= Math.abs(naechsteKumuliert - halbeLaenge)) {
      zentrum = pfad[i]
      break
    }
    kumuliert = naechsteKumuliert
    zentrum = pfad[i + 1]
  }

  const { dist: distVonZentrum } = dijkstraVon(graph, zentrum)
  let maxDist = 0
  for (const t of terminals) {
    maxDist = Math.max(maxDist, distVonZentrum.get(t.knoten) ?? Infinity)
  }
  return { zentrum, terminals, maxDist }
}

// Teilt eine Terminal-Gruppe in zwei geografisch getrennte Hälften — "einmal
// zentral links, einmal zentral rechts" wie in der Praxis. Jedes Terminal
// geht zu der Seite (Durchmesser-Ende), zu der es näher liegt.
function teileAuf(graph: Map<string, Knoten>, terminals: Terminal[]): [Terminal[], Terminal[]] {
  const [a, b] = durchmesserEndpunkte(graph, terminals)
  const { dist: distA } = dijkstraVon(graph, a.knoten)
  const { dist: distB } = dijkstraVon(graph, b.knoten)
  const links = terminals.filter((t) => (distA.get(t.knoten) ?? Infinity) <= (distB.get(t.knoten) ?? Infinity))
  const rechts = terminals.filter((t) => !links.includes(t))
  if (links.length === 0 || rechts.length === 0) {
    // Sicherheitsnetz (z.B. alle Terminals zufällig näher an a): nach Distanz
    // zu a sortiert stur in der Mitte teilen, damit garantiert Fortschritt
    // entsteht statt einer Endlosschleife.
    const sortiert = [...terminals].sort((x, y) => (distA.get(x.knoten) ?? 0) - (distA.get(y.knoten) ?? 0))
    const mitte = Math.ceil(sortiert.length / 2)
    return [sortiert.slice(0, mitte), sortiert.slice(mitte)]
  }
  return [links, rechts]
}

// Teilt eine Terminal-Gruppe rekursiv in möglichst wenige, geografisch
// zentrale Zonen auf — "zentral links, zentral rechts" statt vieler kleiner,
// distanzgetrieben verteilter Standorte. Ein neuer Standort wird nur dann
// zusätzlich nötig, wenn entweder die Kapazität nicht reicht ODER die Gruppe
// trotz passender Kapazität geografisch zu weit auseinanderliegt.
function partitioniere(
  graph: Map<string, Knoten>,
  terminals: Terminal[],
  maxKapazitaet: number,
  distanzLimitMeter: number
): Zone[] {
  if (terminals.length === 0) return []

  if (terminals.length <= maxKapazitaet) {
    const zone = findeZentrum(graph, terminals)
    if (zone.maxDist <= distanzLimitMeter) return [zone]
  }

  const [links, rechts] = teileAuf(graph, terminals)
  return [
    ...partitioniere(graph, links, maxKapazitaet, distanzLimitMeter),
    ...partitioniere(graph, rechts, maxKapazitaet, distanzLimitMeter),
  ]
}

// Die Top-down-Aufteilung schneidet an geografischen Extrempunkten (Durchmesser)
// und kann dadurch unnötig viele, halbleere Zonen erzeugen (z.B. 22/96 und
// 62/96 direkt nebeneinander, obwohl beide zusammen locker in einen einzigen
// 120er passen würden). Dieser Nachlauf prüft nachträglich jedes Zonen-Paar:
// passt die Vereinigung in die größte erlaubte Kapazität UND bleibt dabei
// innerhalb des Distanzlimits, werden die beiden zu einer Zone verschmolzen.
// Wiederholt, bis keine Verschmelzung mehr möglich ist — reduziert die
// NVT-Anzahl auf das tatsächlich nötige Minimum, ohne die Regeln zu verletzen.
function legeZusammen(
  graph: Map<string, Knoten>,
  zonen: Zone[],
  maxKapazitaet: number,
  distanzLimitMeter: number
): Zone[] {
  let ergebnis = zonen
  let geaendert = true
  while (geaendert) {
    geaendert = false
    for (let i = 0; i < ergebnis.length && !geaendert; i++) {
      for (let j = i + 1; j < ergebnis.length && !geaendert; j++) {
        const kombiniert = [...ergebnis[i].terminals, ...ergebnis[j].terminals]
        if (kombiniert.length > maxKapazitaet) continue
        const zone = findeZentrum(graph, kombiniert)
        if (zone.maxDist > distanzLimitMeter) continue
        ergebnis = [...ergebnis.slice(0, i), zone, ...ergebnis.slice(i + 1, j), ...ergebnis.slice(j + 1)]
        geaendert = true
      }
    }
  }
  return ergebnis
}

// Die rekursive Bisektion (teileAuf) weist jedes Terminal beim Aufsplitten
// der jeweils näheren der beiden DURCHMESSER-Endpunkte zu — das ist nur eine
// Näherung für "gehört zur linken/rechten Zone", nicht dasselbe wie "liegt
// näher am tatsächlichen finalen Zentrum". Grenzfall-Hausanschlüsse können
// dadurch einer weiter entfernten Zone zugeteilt werden, obwohl eine
// benachbarte Zone (mit noch freier Kapazität) tatsächlich näher liegt.
// Dieser Nachlauf behebt genau das: pro Durchlauf wird für jedes Terminal
// per Netzdistanz zu ALLEN aktuellen Zentren geprüft, ob eine andere Zone
// näher liegt UND noch Kapazität frei hat — falls ja, wird umgehängt.
// Wiederholt (mit Zentren-Neuberechnung nach jeder Runde), bis sich nichts
// mehr ändert oder das Iterationslimit erreicht ist (Lloyd-artige
// Verfeinerung nach der anfänglichen heuristischen Aufteilung).
function verfeinereZuweisung(
  graph: Map<string, Knoten>,
  zonenInput: Zone[],
  maxKapazitaet: number,
  distanzLimitMeter: number
): Zone[] {
  if (zonenInput.length <= 1) return zonenInput

  const terminalListen: Terminal[][] = zonenInput.map((z) => [...z.terminals])
  const distanzenProZone: Map<string, number>[] = zonenInput.map((z) => dijkstraVon(graph, z.zentrum).dist)

  // Zentrum + Distanzkarte einer Zone neu berechnen — wird nach JEDER
  // einzelnen Verschiebung sofort für die beiden betroffenen Zonen
  // aufgerufen (nicht erst am Ende eines ganzen Durchlaufs). Batch-weise
  // Neuberechnung (nur einmal pro Durchlauf) blieb in der Praxis in einem
  // lokalen Optimum hängen: eine Zone konnte ihr Zentrum erst im NÄCHSTEN
  // Durchlauf in Richtung eines Grenzfall-Terminals verschieben, wodurch der
  // Umzug dieses Terminals nie geprüft wurde, weil zu dem Zeitpunkt, als es
  // an der Reihe war, das Zentrum noch am alten Platz lag.
  function aktualisiereZone(zi: number) {
    if (terminalListen[zi].length === 0) {
      distanzenProZone[zi] = new Map()
      return
    }
    const zone = findeZentrum(graph, terminalListen[zi])
    distanzenProZone[zi] = dijkstraVon(graph, zone.zentrum).dist
  }

  for (let iteration = 0; iteration < 30; iteration++) {
    let geaendert = false

    for (let zi = 0; zi < terminalListen.length; zi++) {
      for (let ti = terminalListen[zi].length - 1; ti >= 0; ti--) {
        const terminal = terminalListen[zi][ti]
        const eigeneDist = distanzenProZone[zi].get(terminal.knoten) ?? Infinity
        let besterZi = -1
        let besteDist = eigeneDist
        for (let zj = 0; zj < terminalListen.length; zj++) {
          if (zj === zi) continue
          if (terminalListen[zj].length >= maxKapazitaet) continue // Zone bereits voll
          const d = distanzenProZone[zj].get(terminal.knoten) ?? Infinity
          if (d < besteDist && d <= distanzLimitMeter) { besteDist = d; besterZi = zj }
        }
        if (besterZi !== -1) {
          terminalListen[zi].splice(ti, 1)
          terminalListen[besterZi].push(terminal)
          geaendert = true
          aktualisiereZone(zi)
          aktualisiereZone(besterZi)
        }
      }
    }

    if (!geaendert) break
  }

  return terminalListen
    .filter((terminals) => terminals.length > 0)
    .map((terminals) => findeZentrum(graph, terminals))
}

// Platziert NVT-Standorte zentral im versorgten Gebiet: für jedes Dorf/jede
// Auswahl möglichst wenige Standorte, die jeweils eine geografisch
// zusammenhängende Zone bedienen (kein Verteilen einzelner Standorte entlang
// des Rückwegs zum Startpunkt der Gesamttrasse — der Startpunkt ist für die
// NVT-Lage irrelevant, er wird nur zur Erreichbarkeitsprüfung genutzt).
// Aussiedlerhöfe sollen VOR dem Aufruf bereits aus hausanschluesse
// herausgefiltert sein (siehe page.tsx) — die Abstandsregel gilt für sie
// explizit nicht.
export function berechneNvtStandorte(
  trassePfade: LatLng[][],
  hausanschluesse: Hausstich[],
  startpunkt: LatLng,
  distanzLimitMeter: number,
  erlaubteKapazitaeten: number[],
  // Reserve pro Standort (z.B. 50 bei einem 120er → nur 70 tatsächlich
  // belegt) — wirkt nur auf die Platzierungs-Logik (Zonengröße), die
  // ausgewiesene "kapazitaet" bleibt die reale Rohr-/Boxgröße, damit im UI
  // weiterhin z.B. "70/120" angezeigt wird, nicht "70/70".
  kapazitaetsReserve = 0
): NvtErgebnis {
  if (hausanschluesse.length === 0 || erlaubteKapazitaeten.length === 0) {
    return { standorte: [], nichtErreichbar: [] }
  }
  const kapazitaetenAufsteigend = [...erlaubteKapazitaeten].sort((a, b) => a - b)
  const effektiveKapazitaeten = kapazitaetenAufsteigend.map((k) => Math.max(1, k - kapazitaetsReserve))
  const maxKapazitaet = effektiveKapazitaeten[effektiveKapazitaeten.length - 1]

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
  const terminals: Terminal[] = []
  for (const [hausId, knoten] of terminalKnoten) {
    if (distVomStart.has(knoten)) terminals.push({ hausId, knoten })
    else nichtErreichbar.push(hausId)
  }

  const rohZonen = partitioniere(graph, terminals, maxKapazitaet, distanzLimitMeter)
  const zusammengelegt = legeZusammen(graph, rohZonen, maxKapazitaet, distanzLimitMeter)
  const zonen = verfeinereZuweisung(graph, zusammengelegt, maxKapazitaet, distanzLimitMeter)

  const standorte: NvtStandort[] = zonen.map((zone) => {
    const passenderIdx = effektiveKapazitaeten.findIndex((k) => k >= zone.terminals.length)
    return {
      position: graph.get(zone.zentrum)!.coord,
      kapazitaet: passenderIdx === -1 ? kapazitaetenAufsteigend[kapazitaetenAufsteigend.length - 1] : kapazitaetenAufsteigend[passenderIdx],
      belegung: zone.terminals.length,
      hausanschlussIds: zone.terminals.map((t) => t.hausId),
    }
  })

  return { standorte, nichtErreichbar }
}

// Ordnet jeden bereits einem NVT zugeordneten Hausanschluss neu dem (Netz-,
// nicht Luftlinien-)nächsten der AKTUELLEN NVT-Standorte zu — gedacht als
// Werkzeug nach manuellem Verschieben/Löschen einzelner NVT, damit man nicht
// jeden Hausanschluss einzeln von Hand neu zuweisen muss. Nutzt dieselbe
// Netzdistanz-Metrik wie berechneNvtStandorte/verfeinereZuweisung (vorher
// nutzte der Sidebar-Button eine reine Luftlinien-Näherung, was auf einem
// echten Straßennetz zu abweichenden — und für den Nutzer überraschenden —
// Ergebnissen führen konnte).
export function weiseHausanschluesseNeuZu(
  trassePfade: LatLng[][],
  hausanschluesse: Hausstich[],
  nvtStandorte: NvtStandort[]
): NvtStandort[] {
  if (nvtStandorte.length === 0) return nvtStandorte

  const graph = baueGraph(trassePfade)
  if (graph.size === 0) return nvtStandorte

  const hausById = new Map(hausanschluesse.map((h) => [h.id, h]))
  const alleZugeordnetenIds = new Set(nvtStandorte.flatMap((n) => n.hausanschlussIds))

  const nvtKnoten = nvtStandorte.map((n) => naechsterKnoten(graph, n.position))
  const distanzenProNvt = nvtKnoten.map((k) => (k ? dijkstraVon(graph, k).dist : new Map<string, number>()))

  interface Kandidat { hausId: string; distanzen: number[]; naechsteDist: number }
  const kandidaten: Kandidat[] = []
  for (const hausId of alleZugeordnetenIds) {
    const haus = hausById.get(hausId)
    if (!haus) continue
    const hausKnoten = naechsterKnoten(graph, haus.trassenPunkt)
    if (!hausKnoten) continue
    const distanzen = distanzenProNvt.map((dist) => dist.get(hausKnoten) ?? Infinity)
    kandidaten.push({ hausId, distanzen, naechsteDist: Math.min(...distanzen) })
  }

  // Eindeutige Fälle (Haus klar am nächsten an einem Standort) zuerst
  // zuweisen, damit knappe Grenzfälle erst entscheiden, wenn der
  // Auslastungsstand der Standorte schon halbwegs feststeht.
  kandidaten.sort((a, b) => a.naechsteDist - b.naechsteDist)

  const gruppenProNvt: string[][] = nvtStandorte.map(() => [])
  for (const { hausId, distanzen } of kandidaten) {
    let bestIdx = -1
    let besteKosten = Infinity
    distanzen.forEach((d, i) => {
      if (gruppenProNvt[i].length >= nvtStandorte[i].kapazitaet) return
      // Je voller ein Standort relativ zu seiner eigenen Kapazität schon ist,
      // desto unattraktiver wird er zusätzlich zur reinen Distanz — sonst
      // läuft eine kleinere Box knapp an ihre Kapazitätsgrenze, während eine
      // Nachbar-Box mit mehr Luft für dasselbe Haus fast genauso nah wäre.
      // Reine Distanzzuweisung (vorher) ignorierte die Auslastung komplett.
      const auslastung = gruppenProNvt[i].length / nvtStandorte[i].kapazitaet
      const kosten = d * (1 + auslastung)
      if (kosten < besteKosten) { besteKosten = kosten; bestIdx = i }
    })
    if (bestIdx === -1) {
      // Alle Standorte voll (praktisch nicht erwartet, da Kapazitäten zur
      // Hausanschluss-Anzahl passen sollten) — Fallback: nächster Standort
      // unabhängig von Kapazität, damit kein Haus unzugewiesen bleibt.
      bestIdx = distanzen.indexOf(Math.min(...distanzen))
    }
    gruppenProNvt[bestIdx].push(hausId)
  }

  return nvtStandorte.map((nvt, i) => ({ ...nvt, hausanschlussIds: gruppenProNvt[i], belegung: gruppenProNvt[i].length }))
}

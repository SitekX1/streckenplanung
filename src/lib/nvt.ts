import { LatLng, Hausstich, NvtStandort, SchachtStandort } from './types'

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

export interface Knoten {
  coord: LatLng
  nachbarn: Array<{ zu: string; dist: number }>
}

export function baueGraph(trassePfade: LatLng[][]): Map<string, Knoten> {
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
export function naechsterKnoten(graph: Map<string, Knoten>, coord: LatLng): string | null {
  let bestKey: string | null = null
  let bestDist = Infinity
  for (const [key, k] of graph) {
    const d = haversine(coord, k.coord)
    if (d < bestDist) { bestDist = d; bestKey = key }
  }
  return bestKey
}

// Binäre Min-Heap für Dijkstra (2026-08-14, Alex: NVT generieren hängt sich
// bei einem großen Mehr-Ortsteil-Projekt — Dresden, ~1100 Adressen — den
// Browser-Tab minutenlang auf). Vorher: lineare Suche nach dem nächsten
// Knoten, O(V) pro Schritt, O(V²) pro kompletten Dijkstra-Lauf — bei
// "einigen hundert Knoten pro Dorf" (Kommentar der Vorversion) vertretbar,
// aber berechneNvtStandorte ruft dijkstraVon über die rekursive
// Zonen-Aufteilung, das Zusammenlegen und die iterative Verfeinerung hinweg
// potenziell hunderte Male auf — bei einem Straßennetz mit mehreren
// tausend Knoten (mehrere Stadtteile) summiert sich das zu Milliarden
// Operationen. Mit Heap: O((V+E) log V) pro Lauf, decrease-key per
// Index-Tracking statt Neueinfügen.
class MinHeap {
  private heap: Array<{ key: string; dist: number }> = []
  private indexVon = new Map<string, number>()

  get size(): number { return this.heap.length }

  private tausche(i: number, j: number) {
    ;[this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]]
    this.indexVon.set(this.heap[i].key, i)
    this.indexVon.set(this.heap[j].key, j)
  }

  private hochBlubbern(i: number) {
    while (i > 0) {
      const eltern = (i - 1) >> 1
      if (this.heap[eltern].dist <= this.heap[i].dist) break
      this.tausche(eltern, i)
      i = eltern
    }
  }

  private runterBlubbern(i: number) {
    const n = this.heap.length
    while (true) {
      const l = 2 * i + 1, r = 2 * i + 2
      let kleinstes = i
      if (l < n && this.heap[l].dist < this.heap[kleinstes].dist) kleinstes = l
      if (r < n && this.heap[r].dist < this.heap[kleinstes].dist) kleinstes = r
      if (kleinstes === i) break
      this.tausche(i, kleinstes)
      i = kleinstes
    }
  }

  // Fügt neu ein ODER verringert die Distanz eines bereits enthaltenen
  // Knotens (decrease-key) — Dijkstra ruft push() bei jeder verbesserten
  // Kantenrelaxation auf, ein Knoten kann daher mehrfach mit sinkender
  // Distanz reinkommen.
  push(key: string, dist: number) {
    const bestehenderIdx = this.indexVon.get(key)
    if (bestehenderIdx !== undefined) {
      if (dist < this.heap[bestehenderIdx].dist) {
        this.heap[bestehenderIdx].dist = dist
        this.hochBlubbern(bestehenderIdx)
      }
      return
    }
    this.heap.push({ key, dist })
    this.indexVon.set(key, this.heap.length - 1)
    this.hochBlubbern(this.heap.length - 1)
  }

  popMin(): { key: string; dist: number } | undefined {
    if (this.heap.length === 0) return undefined
    const min = this.heap[0]
    const letztes = this.heap.pop()!
    this.indexVon.delete(min.key)
    if (this.heap.length > 0) {
      this.heap[0] = letztes
      this.indexVon.set(letztes.key, 0)
      this.runterBlubbern(0)
    }
    return min
  }
}

// Dijkstra von einer Quelle zu allen erreichbaren Knoten — Distanzen + Vorgänger
// (für Pfad-Rekonstruktion).
export function dijkstraVon(graph: Map<string, Knoten>, start: string): { dist: Map<string, number>; prev: Map<string, string> } {
  const dist = new Map<string, number>([[start, 0]])
  const prev = new Map<string, string>()
  const besucht = new Set<string>()
  const heap = new MinHeap()
  heap.push(start, 0)

  while (heap.size > 0) {
    const min = heap.popMin()!
    if (besucht.has(min.key)) continue // veralteter Heap-Eintrag (vor decrease-key), ignorieren
    besucht.add(min.key)
    for (const { zu, dist: d } of graph.get(min.key)?.nachbarn ?? []) {
      const nd = min.dist + d
      if (!dist.has(zu) || nd < dist.get(zu)!) {
        dist.set(zu, nd)
        prev.set(zu, min.key)
        heap.push(zu, nd)
      }
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
// suchen (= das andere Ende). Gibt die volle Dijkstra-Karte ab "a" mit
// zurück (2026-08-14, Performance-Fix) — sowohl findeZentrum als auch
// teileAuf brauchten diese Karte ohnehin direkt danach nochmal und haben sie
// bisher redundant ein zweites Mal berechnet.
function durchmesserEndpunkte(
  graph: Map<string, Knoten>,
  terminals: Terminal[]
): { a: Terminal; b: Terminal; vonA: { dist: Map<string, number>; prev: Map<string, string> } } {
  const irgendeins = terminals[0]
  const { dist: distVonIrgendeinem } = dijkstraVon(graph, irgendeins.knoten)
  let a = irgendeins
  let bestDist = -1
  for (const t of terminals) {
    const d = distVonIrgendeinem.get(t.knoten) ?? -1
    if (d > bestDist) { bestDist = d; a = t }
  }
  const vonA = dijkstraVon(graph, a.knoten)
  let b = a
  bestDist = -1
  for (const t of terminals) {
    const d = vonA.dist.get(t.knoten) ?? -1
    if (d > bestDist) { bestDist = d; b = t }
  }
  return { a, b, vonA }
}

// Zentraler Standort für eine Gruppe von Terminals: der Mittelpunkt (nach
// Streckenlänge) auf dem eindeutigen Baum-Pfad zwischen den beiden am
// weitesten auseinanderliegenden Terminals. Das ist der klassische "Baum-
// Zentrum"-Algorithmus — minimiert die maximale Distanz zu jedem Terminal in
// der Gruppe, nicht nur zu den beiden Endpunkten. Gibt zusätzlich die
// Distanzkarte ab dem gefundenen Zentrum zurück (2026-08-14,
// Performance-Fix) — aktualisiereZone() in verfeinereZuweisung brauchte
// genau diese Karte bisher redundant ein zweites Mal.
function findeZentrumMitDistanzen(
  graph: Map<string, Knoten>,
  terminals: Terminal[]
): { zone: Zone; distVonZentrum: Map<string, number> } {
  if (terminals.length === 1) {
    const { dist } = dijkstraVon(graph, terminals[0].knoten)
    return { zone: { zentrum: terminals[0].knoten, terminals, maxDist: 0 }, distVonZentrum: dist }
  }
  const { b, vonA } = durchmesserEndpunkte(graph, terminals)
  const { dist: distVonA, prev } = vonA
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
  return { zone: { zentrum, terminals, maxDist }, distVonZentrum }
}

function findeZentrum(graph: Map<string, Knoten>, terminals: Terminal[]): Zone {
  return findeZentrumMitDistanzen(graph, terminals).zone
}

// Teilt eine Terminal-Gruppe in zwei geografisch getrennte Hälften — "einmal
// zentral links, einmal zentral rechts" wie in der Praxis. Jedes Terminal
// geht zu der Seite (Durchmesser-Ende), zu der es näher liegt.
function teileAuf(graph: Map<string, Knoten>, terminals: Terminal[]): [Terminal[], Terminal[]] {
  const { b, vonA } = durchmesserEndpunkte(graph, terminals)
  const distA = vonA.dist
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

// Zählt Aufrufe für periodisches Yielden in der Rekursion unten — als
// Funktionsparameter statt Modul-Variable durchgereicht, damit zwei
// (theoretisch) gleichzeitige NVT-Generierungen sich nicht gegenseitig den
// Zähler verfälschen.
interface RekursionsZaehler { wert: number }

// Teilt eine Terminal-Gruppe rekursiv in möglichst wenige, geografisch
// zentrale Zonen auf — "zentral links, zentral rechts" statt vieler kleiner,
// distanzgetrieben verteilter Standorte. Ein neuer Standort wird nur dann
// zusätzlich nötig, wenn entweder die Kapazität nicht reicht ODER die Gruppe
// trotz passender Kapazität geografisch zu weit auseinanderliegt.
// 2026-08-14: bisher komplett synchron — bei einem großen Mehr-Ortsteil-
// Projekt (Alex: Dresden, ~1100 Adressen) lief die Rekursion allein schon
// über 10 Sekunden am Stück durch, ohne dem Browser-Tab je die Kontrolle
// zurückzugeben (Stresstest bestätigt). Jetzt async mit periodischem Yield.
async function partitioniere(
  graph: Map<string, Knoten>,
  terminals: Terminal[],
  maxKapazitaet: number,
  distanzLimitMeter: number,
  zaehler: RekursionsZaehler
): Promise<Zone[]> {
  if (terminals.length === 0) return []

  if (++zaehler.wert % 10 === 0) await yieldAnBrowser()

  if (terminals.length <= maxKapazitaet) {
    const zone = findeZentrum(graph, terminals)
    if (zone.maxDist <= distanzLimitMeter) return [zone]
  }

  const [links, rechts] = teileAuf(graph, terminals)
  const linksZonen = await partitioniere(graph, links, maxKapazitaet, distanzLimitMeter, zaehler)
  const rechtsZonen = await partitioniere(graph, rechts, maxKapazitaet, distanzLimitMeter, zaehler)
  return [...linksZonen, ...rechtsZonen]
}

// Die Top-down-Aufteilung schneidet an geografischen Extrempunkten (Durchmesser)
// und kann dadurch unnötig viele, halbleere Zonen erzeugen (z.B. 22/96 und
// 62/96 direkt nebeneinander, obwohl beide zusammen locker in einen einzigen
// 120er passen würden). Dieser Nachlauf prüft nachträglich jedes Zonen-Paar:
// passt die Vereinigung in die größte erlaubte Kapazität UND bleibt dabei
// innerhalb des Distanzlimits, werden die beiden zu einer Zone verschmolzen.
// Wiederholt, bis keine Verschmelzung mehr möglich ist — reduziert die
// NVT-Anzahl auf das tatsächlich nötige Minimum, ohne die Regeln zu verletzen.
async function legeZusammen(
  graph: Map<string, Knoten>,
  zonen: Zone[],
  maxKapazitaet: number,
  distanzLimitMeter: number,
  startZeit: number
): Promise<Zone[]> {
  let ergebnis = zonen
  let geaendert = true
  let teureChecksSeitYield = 0
  while (geaendert && !budgetUeberschritten(startZeit)) {
    geaendert = false
    for (let i = 0; i < ergebnis.length && !geaendert; i++) {
      for (let j = i + 1; j < ergebnis.length && !geaendert; j++) {
        const kombiniert = [...ergebnis[i].terminals, ...ergebnis[j].terminals]
        if (kombiniert.length > maxKapazitaet) continue
        // Günstiger Vorfilter per Luftlinie zwischen den beiden Zentren, BEVOR
        // die teure Baum-Zentrum-Suche (findeZentrum, mehrere Dijkstra-
        // Aufrufe) versucht wird (2026-08-14, Alex: großes Mehr-Ortsteil-
        // Projekt ließ den Browser-Tab minutenlang hängen) — bei vielen
        // kleinen Zonen (z.B. 261 nach partitioniere) prüft diese Schleife
        // sonst jedes einzelne Paar mit passender Kapazität exakt, auch
        // offensichtlich viel zu weit auseinanderliegende. Die Netzdistanz
        // ist immer mindestens die Luftlinie — liegt die schon deutlich über
        // dem Limit, kann die exakte Prüfung nur schlechter ausfallen, nie
        // besser, der Faktor 3 ist Sicherheitsmarge für Umwege im echten
        // Straßennetz.
        const zentrumI = graph.get(ergebnis[i].zentrum)?.coord
        const zentrumJ = graph.get(ergebnis[j].zentrum)?.coord
        if (zentrumI && zentrumJ && haversine(zentrumI, zentrumJ) > distanzLimitMeter * 3) continue
        const zone = findeZentrum(graph, kombiniert)
        // Auch OHNE Fund: bei vielen Zonen können genug Paare den günstigen
        // Vorfilter passieren, dass allein die teuren Prüfungen innerhalb
        // EINES Durchlaufs den Tab blockieren würden — Yield nicht erst nach
        // einem kompletten Durchlauf (siehe unten), sondern schon zwischendurch.
        if (++teureChecksSeitYield >= 20) { teureChecksSeitYield = 0; await yieldAnBrowser() }
        if (budgetUeberschritten(startZeit)) return ergebnis
        if (zone.maxDist > distanzLimitMeter) continue
        ergebnis = [...ergebnis.slice(0, i), zone, ...ergebnis.slice(i + 1, j), ...ergebnis.slice(j + 1)]
        geaendert = true
      }
    }
    if (geaendert) await yieldAnBrowser()
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
async function verfeinereZuweisung(
  graph: Map<string, Knoten>,
  zonenInput: Zone[],
  maxKapazitaet: number,
  distanzLimitMeter: number,
  startZeit: number
): Promise<Zone[]> {
  if (zonenInput.length <= 1) return zonenInput

  const terminalListen: Terminal[][] = zonenInput.map((z) => [...z.terminals])
  const zentren: string[] = zonenInput.map((z) => z.zentrum)
  const distanzenProZone: Map<string, number>[] = zentren.map((z) => dijkstraVon(graph, z).dist)

  // Nach einer einzelnen Verschiebung nur die Distanzkarte NEU VOM
  // BESTEHENDEN Zentrum aus berechnen (1 Dijkstra-Aufruf) — hält die
  // Distanzinformationen für die Bewertung weiterer Terminals in diesem
  // Durchlauf sofort aktuell (das war der Grund, warum reines Batch-Update
  // einmal pro Durchlauf früher in einem lokalen Optimum hängen blieb: "eine
  // Zone konnte ihr Zentrum erst im NÄCHSTEN Durchlauf verschieben, wodurch
  // der Umzug eines Grenzfall-Terminals nie geprüft wurde"). OHNE dabei bei
  // JEDER einzelnen Verschiebung zusätzlich das Zentrum selbst neu zu
  // suchen (findeZentrumMitDistanzen, mehrere teure Dijkstra-Aufrufe) — das
  // passiert stattdessen einmal pro Durchlauf für alle veränderten Zonen
  // zusammen (siehe unten). 2026-08-14, Alex: bei einem großen
  // Mehr-Ortsteil-Projekt (~1100 Adressen) blieb die alte Variante (Zentrum
  // bei JEDER Verschiebung neu suchen) den Browser-Tab minutenlang hängen —
  // Stresstest bestätigt: mit der alten Variante nach 90s immer noch nicht
  // fertig, mit dieser Aufteilung in Sekunden.
  function aktualisiereDistanzkarte(zi: number) {
    distanzenProZone[zi] = terminalListen[zi].length === 0 ? new Map() : dijkstraVon(graph, zentren[zi]).dist
  }

  for (let iteration = 0; iteration < 30 && !budgetUeberschritten(startZeit); iteration++) {
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
          aktualisiereDistanzkarte(zi)
          aktualisiereDistanzkarte(besterZi)
        }
      }
    }

    if (!geaendert) break

    // Zentren einmal pro kompletten Durchlauf neu optimieren (teuer, aber
    // nur einmal je Zone statt einmal je Verschiebung).
    for (let zi = 0; zi < terminalListen.length; zi++) {
      if (terminalListen[zi].length === 0) continue
      const { zone, distVonZentrum } = findeZentrumMitDistanzen(graph, terminalListen[zi])
      zentren[zi] = zone.zentrum
      distanzenProZone[zi] = distVonZentrum
    }

    await yieldAnBrowser()
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
// Gibt kurz die Kontrolle an den Event-Loop zurück (2026-08-14, Alex: großes
// Mehr-Ortsteil-Projekt lässt den Browser-Tab minutenlang einfrieren) —
// zusätzliches Sicherheitsnetz zur eigentlichen Ursache (siehe MinHeap oben):
// selbst mit schnellerem Dijkstra bleibt berechneNvtStandorte damit
// unterbrechbar statt in einem einzigen langen synchronen Block zu laufen.
function yieldAnBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// Hartes Zeitbudget für die Optimierungs-Nachläufe (legeZusammen,
// verfeinereZuweisung) — 2026-08-14, Alex: großes Mehr-Ortsteil-Projekt mit
// vielen weit auseinanderliegenden, distanzlimit-getriebenen Zonen (im
// Stresstest z.B. ~270 Zonen aus 1100 Hausanschlüssen) ließ diese Nachläufe
// trotz aller Einzeloptimierungen oben (Heap-Dijkstra, Vorfilter,
// reduzierte Neuberechnungen) nicht in vertretbarer Zeit fertig werden —
// die Zahl möglicher Zonen-Paare/Verschiebungen wächst bei so vielen Zonen
// schlicht zu schnell. partitioniere() liefert bereits ein für sich gültiges
// (Kapazität + Distanzlimit eingehalten) Ergebnis; legeZusammen und
// verfeinereZuweisung sind Qualitäts-Nachläufe (weniger/besser platzierte
// Standorte), keine Korrektheitsvoraussetzung — bei Zeitüberschreitung wird
// mit dem bis dahin besten Zwischenstand abgebrochen, statt unbegrenzt
// weiterzurechnen. Dank der Yield-Punkte oben bleibt der Tab währenddessen
// durchgehend bedienbar, das eigentliche Symptom (eingefrorene Seite) ist
// damit so oder so behoben — das Budget sorgt zusätzlich dafür, dass die
// Berechnung auch bei sehr großen/weiträumigen Projekten in überschaubarer
// Zeit fertig wird.
const OPTIMIERUNGS_ZEITBUDGET_MS = 20_000

function budgetUeberschritten(startZeit: number): boolean {
  return performance.now() - startZeit > OPTIMIERUNGS_ZEITBUDGET_MS
}

export async function berechneNvtStandorte(
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
): Promise<NvtErgebnis> {
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
  for (let i = 0; i < hausanschluesse.length; i++) {
    const k = naechsterKnoten(graph, hausanschluesse[i].trassenPunkt)
    if (k) terminalKnoten.set(hausanschluesse[i].id, k)
    if (i % 200 === 0) await yieldAnBrowser()
  }
  await yieldAnBrowser()

  // Erreichbarkeit vom Startpunkt aus einmalig prüfen (getrennte Teilgraphen
  // z.B. bei Luftlinien-Verbindungen oder Dorf-Inseln ohne durchgehende Trasse)
  const { dist: distVomStart } = dijkstraVon(graph, startKnoten)
  const nichtErreichbar: string[] = []
  const terminals: Terminal[] = []
  for (const [hausId, knoten] of terminalKnoten) {
    if (distVomStart.has(knoten)) terminals.push({ hausId, knoten })
    else nichtErreichbar.push(hausId)
  }

  // Gemeinsamer Startzeitpunkt für das Optimierungs-Zeitbudget (siehe
  // OPTIMIERUNGS_ZEITBUDGET_MS oben) — deckt legeZusammen + verfeinereZuweisung
  // zusammen ab, nicht jede Phase einzeln, damit eine schnelle erste Phase
  // der zweiten mehr Spielraum lässt.
  const optimierungsStart = performance.now()
  const rohZonen = await partitioniere(graph, terminals, maxKapazitaet, distanzLimitMeter, { wert: 0 })
  await yieldAnBrowser()
  const zusammengelegt = await legeZusammen(graph, rohZonen, maxKapazitaet, distanzLimitMeter, optimierungsStart)
  await yieldAnBrowser()
  const zonen = await verfeinereZuweisung(graph, zusammengelegt, maxKapazitaet, distanzLimitMeter, optimierungsStart)

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

export interface HausanschlussZuordnung {
  nvtNr: number | null
  schachtNr: number | null
}

// Für Export-Layer (KML/Shapefile) gedacht: liefert je Hausanschluss-ID die
// menschenlesbare Nummer (1-basiert, wie im Plan/UI angezeigt) des NVT oder
// Schacht, dem er zugeordnet ist — fehlt ein Eintrag, ist der Hausanschluss
// (noch) keinem Standort zugeordnet.
export function ermittleZuordnungen(
  nvtStandorte: NvtStandort[],
  schachtStandorte: SchachtStandort[]
): Map<string, HausanschlussZuordnung> {
  const map = new Map<string, HausanschlussZuordnung>()
  nvtStandorte.forEach((nvt, i) => {
    for (const hausId of nvt.hausanschlussIds) map.set(hausId, { nvtNr: i + 1, schachtNr: null })
  })
  schachtStandorte.forEach((schacht, i) => {
    for (const hausId of schacht.hausanschlussIds) map.set(hausId, { nvtNr: null, schachtNr: i + 1 })
  })
  return map
}

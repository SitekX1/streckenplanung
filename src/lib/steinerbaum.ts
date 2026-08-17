import { RoadGraph } from './roadGraph'
import { LatLng, WegKind } from './types'

export interface SteinerErgebnis {
  pfade: LatLng[][]
  gesamtLaengeMeter: number
  nichtErreichbareNodeIds: number[]
  // Straße/Feldweg-Klassifizierung parallel zu pfade (gleicher Index = gleiches
  // Segment). Jedes pfade[i] ist in sich homogen — Kettenaufbau in
  // kantenzuPfade() bricht ein Segment an Kind-Wechseln bewusst auf.
  pfadeKinds: WegKind[]
}

// Ab welcher Länge eine Ringschluss-Kante (s.u.) gar nicht erst in Betracht
// gezogen wird — bewusst klein, das soll nur die "letzten paar Meter"
// schließen, kein zweites Straßenstück parallel bauen.
const RINGSCHLUSS_MAX_METER = 50
// Ein Ringschluss wird nur tatsächlich gebaut, wenn er den bisherigen
// Baum-Umweg zwischen den beiden Punkten um mindestens diesen Faktor
// verkürzt — sonst würden auch zwei zufällig benachbarte, aber inhaltlich
// unabhängige Straßen verbunden, ohne dass das real einen Umweg spart.
const RINGSCHLUSS_MIN_FAKTOR = 3

// 2026-08-20, Alex (Chef-Feedback, konkretes Beispiel Burgau): eine
// Stichstraße, die oben UND unten an eine querlaufende Straße anschließt
// (kein echter Sackgasse), wird vom (bewusst schleifenfreien) Steiner-Baum
// nur über EINE der beiden Verbindungen erschlossen — die andere, real
// existierende kurze Verbindung bleibt ungenutzt. Weil nvt.ts seinen
// Distanz-Graph direkt aus der fertigen Trasse baut, macht das Häuser am
// "falschen" Ende des Stichs künstlich weit vom nächsten Verteiler entfernt
// → unnötige zusätzliche NVT-Box (bei Burgau z.B. 5 statt 4 im selben Dorf).
// Fix: NACH dem eigentlichen Baumaufbau kurze, tatsächlich existierende
// Straßenkanten zwischen zwei bereits im Baum enthaltenen Punkten ergänzen —
// aber nur, wenn sie den bisherigen Baum-Umweg deutlich verkürzen. Alex
// explizit: "keine Hin- und Rückwege, dass zwei Striche auf einer Straße
// sind" — deshalb kein Duplizieren eines ganzen Stichs, nur das kurze,
// tatsächlich fehlende Schlussstück (z.B. die letzten 20m zur Parallelstraße).
function fuegeKurzeRingschluesseHinzu(
  graph: RoadGraph,
  treeNodes: Set<number>,
  usedEdges: Set<string>
) {
  // Gewichtete Baum-Adjazenz — für die Umweg-Prüfung weiter unten, viel
  // kleiner als der volle Straßengraph.
  const treeAdj = new Map<number, Array<{ to: number; dist: number }>>()
  function treeAddEdge(a: number, b: number, dist: number) {
    if (!treeAdj.has(a)) treeAdj.set(a, [])
    if (!treeAdj.has(b)) treeAdj.set(b, [])
    treeAdj.get(a)!.push({ to: b, dist })
    treeAdj.get(b)!.push({ to: a, dist })
  }
  const kantenDistanz = (a: number, b: number): number =>
    graph.adjacency.get(a)?.find((e) => e.to === b)?.dist ??
    graph.adjacency.get(b)?.find((e) => e.to === a)?.dist ?? 0
  for (const key of usedEdges) {
    const [aStr, bStr] = key.split('_')
    const a = parseInt(aStr), b = parseInt(bStr)
    treeAddEdge(a, b, kantenDistanz(a, b))
  }

  // Baum-Umweg zwischen zwei Punkten, mit fester Abbruchgrenze.
  function baumDistanz(von: number, bis: number, obergrenze: number): number {
    const dist = new Map<number, number>([[von, 0]])
    const besucht = new Set<number>()
    while (true) {
      let cur = -1
      let curDist = Infinity
      for (const [k, d] of dist) {
        if (!besucht.has(k) && d < curDist) { curDist = d; cur = k }
      }
      if (cur === -1 || curDist > obergrenze) return Infinity
      if (cur === bis) return curDist
      besucht.add(cur)
      for (const { to, dist: kantenDist } of treeAdj.get(cur) ?? []) {
        const nd = curDist + kantenDist
        if (!dist.has(to) || nd < dist.get(to)!) dist.set(to, nd)
      }
    }
  }

  // Blätter des Baums (genau ein Baum-Nachbar) = Stich-Enden — die
  // typischen Kandidaten für eine übersehene zweite Anbindung. Bewusst nicht
  // von JEDEM Baumknoten aus gesucht (unnötig teuer, ein Knoten mitten in
  // der Trasse hat seine Nachbarn ja bereits).
  const blaetter = [...treeAdj.entries()].filter(([, n]) => n.length === 1).map(([id]) => id)

  for (const blatt of blaetter) {
    // Begrenzter Dijkstra über den VOLLEN Straßengraph ab diesem Blatt-Ende
    // — sucht den nächsten ANDEREN Baum-Knoten über echte (nicht
    // synthetische) Straßenkanten, unabhängig davon, ob die Zwischenpunkte
    // selbst schon Teil des Baums sind (z.B. ein kurzer unbenutzter
    // Verbindungsweg zur Parallelstraße).
    const dist = new Map<number, number>([[blatt, 0]])
    const prev = new Map<number, number>()
    const besucht = new Set<number>()
    const gefundeneZiele: Array<{ id: number; dist: number }> = []
    while (true) {
      let cur = -1
      let curDist = Infinity
      for (const [k, d] of dist) {
        if (!besucht.has(k) && d < curDist) { curDist = d; cur = k }
      }
      if (cur === -1 || curDist > RINGSCHLUSS_MAX_METER) break
      besucht.add(cur)
      if (cur !== blatt && treeNodes.has(cur)) gefundeneZiele.push({ id: cur, dist: curDist })
      for (const { to, dist: kantenDist, synthetic } of graph.adjacency.get(cur) ?? []) {
        if (synthetic) continue
        const nd = curDist + kantenDist
        if (nd > RINGSCHLUSS_MAX_METER) continue
        if (!dist.has(to) || nd < dist.get(to)!) { dist.set(to, nd); prev.set(to, cur) }
      }
    }
    if (gefundeneZiele.length === 0) continue

    // Nächstliegendes Ziel zuerst probieren — meist das sinnvollste
    // (z.B. der direkte Anschluss an die Parallelstraße statt ein
    // zufälliger, weiter entfernter Baumknoten).
    gefundeneZiele.sort((x, y) => x.dist - y.dist)
    for (const { id: ziel, dist: kurzDist } of gefundeneZiele) {
      // Trivialfall (Ziel ist der ohnehin schon direkt verbundene
      // Baum-Nachbar dieses Blatts) fällt hier automatisch raus, da der
      // Baum-Umweg dann exakt kurzDist entspricht, nie > kurzDist * Faktor.
      const umweg = baumDistanz(blatt, ziel, kurzDist * RINGSCHLUSS_MIN_FAKTOR)
      if (umweg <= kurzDist * RINGSCHLUSS_MIN_FAKTOR) continue

      // Spart spürbar Umweg → den kurzen Realpfad zurückverfolgen und alle
      // seine Kanten in den Baum übernehmen (keine Luftlinie, echte Straße).
      let cur = ziel
      while (prev.has(cur)) {
        const vor = prev.get(cur)!
        const key = cur < vor ? `${cur}_${vor}` : `${vor}_${cur}`
        usedEdges.add(key)
        treeAddEdge(cur, vor, kantenDistanz(cur, vor))
        cur = vor
      }
      break
    }
  }
}

// Steiner-Baum-Approximation via wiederholtem Multi-Source-Dijkstra.
// Startet vom Startpunkt, fügt in jedem Schritt den nächsten unverbundenen Terminal hinzu.
// Jede Straßen-Kante wird NUR EINMAL in den Baum aufgenommen → kein Hin-und-Rückweg.
// async: gibt alle 50 Iterationen die UI-Kontrolle zurück (Progress-Bar bleibt reaktiv).
export async function berechneSteinerBaum(
  graph: RoadGraph,
  startNodeIds: number | number[],
  terminalNodeIds: number[],
  onProgress?: (prozent: number) => void
): Promise<SteinerErgebnis> {
  // Mehrere Start-Knoten = bereits vorhandene Trasse (z.B. bei "Trasse
  // erweitern") wird komplett als vorverbundener Baum vorgegeben, statt nur
  // von einem einzelnen Punkt aus neu zu rechnen.
  const startSet = new Set(Array.isArray(startNodeIds) ? startNodeIds : [startNodeIds])
  const uniqueTerminals = [...new Set(terminalNodeIds)].filter((id) => !startSet.has(id))
  if (uniqueTerminals.length === 0) {
    return { pfade: [], gesamtLaengeMeter: 0, nichtErreichbareNodeIds: [], pfadeKinds: [] }
  }

  const treeNodes = new Set<number>(startSet)
  const usedEdges = new Set<string>() // normiert: "min_max"
  const remaining = new Set<number>(uniqueTerminals)
  const total = remaining.size
  let done = 0
  let letzteFreigabe = performance.now()

  while (remaining.size > 0) {
    const result = graph.dijkstraVomBaum(treeNodes, remaining)

    // Kein verbleibendes Terminal vom bisherigen Baum aus über das (Straßen-
    // /Feldweg-)Netz erreichbar → der Rest liegt in einem getrennten
    // Teilgraphen (z.B. Siedlung ohne öffentliche Wegeanbindung). Früher wurde
    // hier automatisch eine geometrisch oft falsche Luftlinie gezogen — jetzt
    // werden diese Terminals unverändert als "nicht erreichbar" zurückgegeben,
    // der Aufrufer entscheidet (Markierung + Hinweis für den Nutzer statt
    // stiller/falscher Verbindung).
    if (!result) break

    for (let i = 0; i < result.path.length - 1; i++) {
      const a = result.path[i], b = result.path[i + 1]
      usedEdges.add(`${Math.min(a, b)}_${Math.max(a, b)}`)
      treeNodes.add(a)
      treeNodes.add(b)
    }
    treeNodes.add(result.targetId)
    remaining.delete(result.targetId)

    done++
    onProgress?.(Math.round((done / total) * 100))

    // Event-Loop zeitbasiert freigeben (statt nach fester Iterationszahl) —
    // bei wenigen Terminals (< 50) lief die Schleife sonst komplett synchron
    // durch und React konnte nie zwischen den Progress-Updates neu rendern:
    // der Ladebalken sprang sichtbar von seinem letzten Stand direkt auf 100%.
    const jetzt = performance.now()
    if (jetzt - letzteFreigabe > 32) {
      letzteFreigabe = jetzt
      await new Promise<void>((r) => setTimeout(r, 0))
    }
  }

  fuegeKurzeRingschluesseHinzu(graph, treeNodes, usedEdges)

  const ergebnis = kantenzuPfade(graph, usedEdges)
  return { ...ergebnis, nichtErreichbareNodeIds: [...remaining] }
}

// Wandelt die verwendeten Kanten (als Set normierter Strings) in LatLng-Pfade um.
// Kanten mit Grad ≠ 2 (Abzweige, Blätter) sind Startpunkte für neue Pfadsegmente.
// Ketten von Grad-2-Knoten werden zu einzelnen langen Polylinien zusammengefasst —
// zusätzlich wird an jedem Straße/Feldweg-Wechsel ein neues Segment begonnen,
// damit jedes zurückgegebene pfade[i] eindeutig EINER Kind-Klasse angehört.
function kantenzuPfade(
  graph: RoadGraph,
  usedEdges: Set<string>
): { pfade: LatLng[][]; gesamtLaengeMeter: number; pfadeKinds: WegKind[] } {
  if (usedEdges.size === 0) return { pfade: [], gesamtLaengeMeter: 0, pfadeKinds: [] }

  const adj = new Map<number, number[]>()
  let gesamtLaenge = 0

  for (const key of usedEdges) {
    const [aStr, bStr] = key.split('_')
    const a = parseInt(aStr), b = parseInt(bStr)
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a)!.push(b)
    adj.get(b)!.push(a)

    const ca = graph.coordinates.get(a)
    const cb = graph.coordinates.get(b)
    if (ca && cb) {
      const dLat = ((cb.lat - ca.lat) * Math.PI) / 180
      const dLng = ((cb.lng - ca.lng) * Math.PI) / 180
      const sa =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((ca.lat * Math.PI) / 180) * Math.cos((cb.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2
      gesamtLaenge += 2 * 6_371_000 * Math.asin(Math.sqrt(sa))
    }
  }

  function coord(id: number): LatLng {
    return graph.coordinates.get(id) ?? { lat: 0, lng: 0 }
  }

  const visitedEdges = new Set<string>()
  const pfade: LatLng[][] = []
  const pfadeKinds: WegKind[] = []

  // Pfade von Blättern (Grad 1) und Abzweigpunkten (Grad ≠ 2) aus aufbauen
  const startNodes = [...adj.keys()].filter((id) => adj.get(id)!.length !== 2)
  if (startNodes.length === 0) {
    const first = adj.keys().next().value
    if (typeof first === 'number') startNodes.push(first)
  }

  // Läuft eine Kette entlang Grad-2-Knoten ab und bricht sie in homogene
  // Kind-Abschnitte auf (Segmentende + neues Segment startet am selben Punkt,
  // keine Lücke in der Geometrie).
  function verfolge(von: number, zu: number): Array<{ punkte: LatLng[]; kind: WegKind }> {
    const segmente: Array<{ punkte: LatLng[]; kind: WegKind }> = []
    let punkte: LatLng[] = [coord(von)]
    let aktuellerKind: WegKind = graph.edgeKind(von, zu)
    let prev = von, curr = zu

    while (true) {
      const k = `${Math.min(prev, curr)}_${Math.max(prev, curr)}`
      if (visitedEdges.has(k)) break
      visitedEdges.add(k)

      const kantenKind = graph.edgeKind(prev, curr)
      if (kantenKind !== aktuellerKind) {
        segmente.push({ punkte, kind: aktuellerKind })
        punkte = [coord(prev)]
        aktuellerKind = kantenKind
      }
      punkte.push(coord(curr))

      const weiter = (adj.get(curr) ?? []).filter((n) => {
        const nk = `${Math.min(curr, n)}_${Math.max(curr, n)}`
        return !visitedEdges.has(nk)
      })

      // Blatt oder Abzweig → Segment beenden
      if (weiter.length === 0 || adj.get(curr)!.length !== 2) break

      prev = curr
      curr = weiter[0]
    }

    segmente.push({ punkte, kind: aktuellerKind })
    return segmente
  }

  for (const startId of startNodes) {
    for (const neighbor of adj.get(startId) ?? []) {
      const k = `${Math.min(startId, neighbor)}_${Math.max(startId, neighbor)}`
      if (visitedEdges.has(k)) continue
      for (const seg of verfolge(startId, neighbor)) {
        if (seg.punkte.length >= 2) { pfade.push(seg.punkte); pfadeKinds.push(seg.kind) }
      }
    }
  }

  // Verbleibende Kanten (bei Zyklen)
  for (const key of usedEdges) {
    if (visitedEdges.has(key)) continue
    const [aStr, bStr] = key.split('_')
    const a = parseInt(aStr), b = parseInt(bStr)
    const ca = graph.coordinates.get(a)
    const cb = graph.coordinates.get(b)
    if (ca && cb) { pfade.push([ca, cb]); pfadeKinds.push(graph.edgeKind(a, b)) }
  }

  return { pfade, gesamtLaengeMeter: gesamtLaenge, pfadeKinds }
}

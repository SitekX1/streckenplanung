import { OsmNetz } from './overpassClient'
import { LatLng, WegKind } from './types'

// Binärer Min-Heap für Dijkstra (O((V+E) log V))
class MinHeap {
  private h: Array<[number, number]> = []

  push(priority: number, nodeId: number) {
    this.h.push([priority, nodeId])
    this._up(this.h.length - 1)
  }

  pop(): [number, number] | undefined {
    if (this.h.length === 0) return undefined
    const top = this.h[0]
    const last = this.h.pop()!
    if (this.h.length > 0) { this.h[0] = last; this._down(0) }
    return top
  }

  get size() { return this.h.length }

  private _up(i: number) {
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.h[p][0] <= this.h[i][0]) break
      ;[this.h[p], this.h[i]] = [this.h[i], this.h[p]]
      i = p
    }
  }

  private _down(i: number) {
    while (true) {
      let s = i
      const l = 2 * i + 1, r = 2 * i + 2
      if (l < this.h.length && this.h[l][0] < this.h[s][0]) s = l
      if (r < this.h.length && this.h[r][0] < this.h[s][0]) s = r
      if (s === i) break
      ;[this.h[s], this.h[i]] = [this.h[i], this.h[s]]
      i = s
    }
  }
}

function haversine(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(sa))
}

// Feldweg wird gegenüber einer gleich langen Straße künstlich verteuert, damit
// Dijkstra ihn nur nimmt, wenn er tatsächlich spürbar kürzer ist (wirtschaftlich
// sinnvoll) — nicht schon bei ein paar Metern Unterschied. Wirkt NUR auf die
// Pfad-Auswahl; die ausgewiesene Länge wird in kantenzuPfade() immer aus der
// echten Geometrie neu berechnet, bleibt also exakt.
const FELDWEG_KOSTEN_FAKTOR = 1.15

export class RoadGraph {
  adjacency: Map<number, Array<{ to: number; dist: number; weight: number; kind: WegKind; synthetic: boolean }>> = new Map()
  coordinates: Map<number, LatLng> = new Map()
  private naechsteVirtuelleId = -1

  addNode(id: number, coord: LatLng) {
    this.coordinates.set(id, coord)
    if (!this.adjacency.has(id)) this.adjacency.set(id, [])
  }

  // synthetic = true nur für die automatisch generierten Verbindungsbrücken aus
  // verbindeGetrennteTeilnetze() (s.u.) — echte OSM-Kanten sind immer false.
  // Wichtig für nearestPointOnGraph(): eine Brücke ist eine reine
  // Luftlinien-Annahme zwischen zwei sonst getrennten Netzteilen, KEIN
  // tatsächlich begehbarer Weg mit eigener Mitte — ein Haus, das zufällig
  // näher an der Mitte einer Brücke liegt als an seiner echten Straße, darf
  // dort nicht andocken, sonst "klaut" die Brücke einem Nachbarhaus dessen
  // bis dahin funktionierenden (echten) Anschlusspunkt.
  addEdge(a: number, b: number, dist: number, oneway: boolean, kind: WegKind = 'paved', synthetic = false) {
    const weight = kind === 'track' ? dist * FELDWEG_KOSTEN_FAKTOR : dist
    this.adjacency.get(a)?.push({ to: b, dist, weight, kind, synthetic })
    if (!oneway) this.adjacency.get(b)?.push({ to: a, dist, weight, kind, synthetic })
  }

  // Für Kartenfärbung/Längenaufschlüsselung (Straße vs. Feldweg): welcher Art
  // war die Kante zwischen zwei Knoten ursprünglich. Fällt auf 'paved' zurück,
  // falls die Kante (z.B. bei oneway) nur in einer Richtung gespeichert ist.
  edgeKind(a: number, b: number): WegKind {
    const viaA = this.adjacency.get(a)?.find((e) => e.to === b)
    if (viaA) return viaA.kind
    return this.adjacency.get(b)?.find((e) => e.to === a)?.kind ?? 'paved'
  }

  private removeEdge(a: number, b: number) {
    const listA = this.adjacency.get(a)
    if (listA) this.adjacency.set(a, listA.filter((e) => e.to !== b))
    const listB = this.adjacency.get(b)
    if (listB) this.adjacency.set(b, listB.filter((e) => e.to !== a))
  }

  // Nächsten Graphknoten zu einer Koordinate finden.
  // Flache Erdnäherung (kein Trig) → sehr schnell auch bei 20k+ Knoten.
  nearestNode(coord: LatLng): number {
    let bestId = -1
    let bestDist = Infinity
    const cosLat = Math.cos((coord.lat * Math.PI) / 180)
    for (const [id, c] of this.coordinates) {
      const dlat = c.lat - coord.lat
      const dlng = (c.lng - coord.lng) * cosLat
      const d2 = dlat * dlat + dlng * dlng
      if (d2 < bestDist) { bestDist = d2; bestId = id }
    }
    return bestId
  }

  // Nächsten Punkt auf dem GESAMTEN Straßennetz finden (nicht nur auf
  // existierenden Knoten) — bei Bedarf wird mitten auf einer Kante ein neuer
  // virtueller Knoten eingefügt. Ohne das würde nearestNode() ein Haus an
  // einer nur grob digitalisierten Straße (wenige OSM-Knoten) fälschlich an
  // den nächstgelegenen BELIEBIGEN Knoten anhängen — und das kann eine private
  // Einfahrt oder eine ganz andere Straße sein, wenn die eigene Straße zufällig
  // weiter entfernte Stützpunkte hat. Ergebnis: die Trasse "erreicht" das Haus
  // zwar (kein Fehler, kein Luftlinien-Fallback), aber über die falsche Straße.
  nearestPointOnGraph(coord: LatLng): number {
    const cosLat = Math.cos((coord.lat * Math.PI) / 180)
    let bestDist2 = Infinity
    let bestA = -1
    let bestB = -1
    let bestT = 0
    const gesehen = new Set<string>()

    for (const [a, kanten] of this.adjacency) {
      for (const { to: b, synthetic } of kanten) {
        if (synthetic) continue // reine Luftlinien-Brücke, kein gültiger Andockpunkt (s.o.)
        const key = a < b ? `${a}_${b}` : `${b}_${a}`
        if (gesehen.has(key)) continue
        gesehen.add(key)

        const ca = this.coordinates.get(a)
        const cb = this.coordinates.get(b)
        if (!ca || !cb) continue

        // Flache Projektion auf das Liniensegment a→b
        const bx = (cb.lng - ca.lng) * cosLat
        const by = cb.lat - ca.lat
        const px = (coord.lng - ca.lng) * cosLat
        const py = coord.lat - ca.lat
        const len2 = bx * bx + by * by
        let t = len2 > 0 ? (px * bx + py * by) / len2 : 0
        t = Math.max(0, Math.min(1, t))
        const dx = px - t * bx
        const dy = py - t * by
        const dist2 = dx * dx + dy * dy

        if (dist2 < bestDist2) {
          bestDist2 = dist2
          bestA = a
          bestB = b
          bestT = t
        }
      }
    }

    if (bestA === -1) return this.nearestNode(coord)
    // Nahe genug an einem vorhandenen Endpunkt → keinen neuen Knoten anlegen
    if (bestT < 1e-4) return bestA
    if (bestT > 1 - 1e-4) return bestB

    const ca = this.coordinates.get(bestA)!
    const cb = this.coordinates.get(bestB)!
    const projCoord: LatLng = {
      lat: ca.lat + bestT * (cb.lat - ca.lat),
      lng: ca.lng + bestT * (cb.lng - ca.lng),
    }

    const warBeidseitig = (this.adjacency.get(bestB) ?? []).some((e) => e.to === bestA)
    const kind = (this.adjacency.get(bestA) ?? []).find((e) => e.to === bestB)?.kind ?? 'paved'
    const neueId = this.naechsteVirtuelleId--
    this.addNode(neueId, projCoord)
    this.removeEdge(bestA, bestB)
    this.addEdge(bestA, neueId, haversine(ca, projCoord), false, kind)
    this.addEdge(neueId, bestB, haversine(projCoord, cb), false, kind)
    if (!warBeidseitig) {
      // urspruengliche Kante war nur a→b (oneway) → Rueckrichtung entfernen,
      // Reihenfolge a→neueId→b bleibt erhalten
      this.removeEdge(neueId, bestA)
      this.removeEdge(bestB, neueId)
    }
    return neueId
  }

  // Multi-Source-Dijkstra: startet von ALLEN Baumknoten gleichzeitig.
  // Findet den nächsten unbesuchten Terminal und gibt den Pfad dorthin zurück.
  // Kern des Steiner-Baum-Algorithmus — verhindert Hin-und-Rückwege.
  dijkstraVomBaum(
    treeNodes: Set<number>,
    terminals: Set<number>
  ): { targetId: number; path: number[] } | null {
    const dist = new Map<number, number>()
    const prev = new Map<number, number>()
    const pq = new MinHeap()

    for (const src of treeNodes) {
      dist.set(src, 0)
      pq.push(0, src)
    }

    const visited = new Set<number>()

    while (pq.size > 0) {
      const entry = pq.pop()
      if (!entry) break
      const [d, u] = entry
      if (visited.has(u)) continue
      visited.add(u)

      // Unbesuchter Terminal gefunden → Pfad rekonstruieren
      if (terminals.has(u) && !treeNodes.has(u)) {
        const path: number[] = [u]
        let cur = u
        while (prev.has(cur)) { cur = prev.get(cur)!; path.unshift(cur) }
        return { targetId: u, path }
      }

      for (const edge of this.adjacency.get(u) ?? []) {
        const nd = d + edge.weight
        if (!dist.has(edge.to) || nd < dist.get(edge.to)!) {
          dist.set(edge.to, nd)
          prev.set(edge.to, u)
          pq.push(nd, edge.to)
        }
      }
    }

    return null
  }
}

// Toleranz fürs Knoten-Snapping in Grad (~1.5-2m). OSM-Wege werden oft
// unabhängig voneinander digitalisiert und teilen sich an echten Kreuzungen/
// Einmündungen dadurch nicht immer denselben Node — obwohl sie sich am
// selben Punkt treffen. Ohne Snapping zerfällt der Graph dort künstlich in
// viele kleine, eigentlich verbundene Inseln (sichtbar als Häuser-Cluster
// ganz ohne Trasse, obwohl direkt neben einer Straße liegend).
const SNAP_TOLERANZ_GRAD = 0.00002

// Führt Knoten, die innerhalb der Toleranz beieinander liegen, auf einen
// gemeinsamen kanonischen Knoten zusammen (3x3-Grid-Nachbarschaftssuche,
// damit Punkte nahe einer Zellgrenze nicht fälschlich getrennt bleiben).
function snappeKnoten(netz: OsmNetz): Map<number, number> {
  const grid = new Map<string, number[]>()
  const kanonisch = new Map<number, number>()
  const koordinaten = new Map<number, LatLng>()

  for (const [id, node] of netz.nodeMap) {
    const cx = Math.floor(node.lat / SNAP_TOLERANZ_GRAD)
    const cy = Math.floor(node.lng / SNAP_TOLERANZ_GRAD)
    let gefunden: number | null = null

    for (let dx = -1; dx <= 1 && gefunden === null; dx++) {
      for (let dy = -1; dy <= 1 && gefunden === null; dy++) {
        const kandidaten = grid.get(`${cx + dx}_${cy + dy}`)
        if (!kandidaten) continue
        for (const kandId of kandidaten) {
          const kc = koordinaten.get(kandId)!
          if (Math.abs(kc.lat - node.lat) < SNAP_TOLERANZ_GRAD && Math.abs(kc.lng - node.lng) < SNAP_TOLERANZ_GRAD) {
            gefunden = kandId
            break
          }
        }
      }
    }

    if (gefunden !== null) {
      kanonisch.set(id, gefunden)
    } else {
      kanonisch.set(id, id)
      koordinaten.set(id, { lat: node.lat, lng: node.lng })
      const key = `${cx}_${cy}`
      if (!grid.has(key)) grid.set(key, [])
      grid.get(key)!.push(id)
    }
  }

  return kanonisch
}

// Radius um jede Adresse, innerhalb dessen ein Feldweg als "innerorts" gilt
// und deshalb NICHT genutzt wird — dort soll weiterhin nur an echten Straßen
// gebaut werden. Außerhalb dieses Radius (= zwischen den Ortschaften) sind
// Feldwege erlaubt.
const FELDWEG_ORTS_RADIUS_METER = 200

// Grid-Index über alle Adressen (gleiche Technik wie snappeKnoten): erlaubt
// einen schnellen "liegt Punkt X in der Nähe einer Adresse"-Test auch bei
// mehreren tausend Adressen, statt jede Kante gegen jede Adresse zu prüfen.
function baueOrtszonenTest(adressen: LatLng[], radiusMeter: number): (p: LatLng) => boolean {
  if (adressen.length === 0) return () => false
  const zellGroesseGrad = radiusMeter / 111_320
  const grid = new Map<string, LatLng[]>()
  for (const a of adressen) {
    const cx = Math.floor(a.lat / zellGroesseGrad)
    const cy = Math.floor(a.lng / zellGroesseGrad)
    const key = `${cx}_${cy}`
    if (!grid.has(key)) grid.set(key, [])
    grid.get(key)!.push(a)
  }
  return (p: LatLng) => {
    const cx = Math.floor(p.lat / zellGroesseGrad)
    const cy = Math.floor(p.lng / zellGroesseGrad)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const kandidaten = grid.get(`${cx + dx}_${cy + dy}`)
        if (!kandidaten) continue
        for (const k of kandidaten) {
          if (haversine(p, k) <= radiusMeter) return true
        }
      }
    }
    return false
  }
}

// Bis zu dieser Distanz werden zwei eigentlich getrennte Teilnetze automatisch
// überbrückt (2026-08-17, Alex: "eine Hauptstraße mitten durchs Dorf, da wurde
// überhaupt keine Trasse gebildet"). Root Cause: OSM-Wege werden unabhängig
// voneinander digitalisiert und ihre Endpunkte treffen sich oft nicht exakt
// auf einem gemeinsamen Knoten — z.B. eine kurze Stichstraße/Grundstücks-
// zufahrt, die ein paar Meter neben der eigentlichen Straßenmitte endet, statt
// exakt auf ihr. snappeKnoten() (s.o.) fängt nur den 1:1-Fall "zwei Knoten
// liegen fast exakt übereinander" (~2m) ab, nicht "Endpunkt X liegt ein Stück
// neben Straße Y" — genau DAS ist aber die häufigste Ursache, warum ganze,
// real angebundene Straßenzüge für den Steiner-Baum unerreichbar blieben.
// Bewusst klein gehalten: eine echte fehlende Straßenverbindung (>30m) soll
// NICHT geraten, sondern weiterhin im Warnmodal zur manuellen Prüfung
// gemeldet werden (siehe nichtErreichbareNodeIds in steinerbaum.ts).
const AUTO_VERBINDUNG_MAX_METER = 30

// Verbindet kleine, vom Rest des Netzes getrennte Teilnetze automatisch mit
// dem nächstgelegenen anderen Teilnetz, sofern die Lücke klein genug ist (s.o.).
// Läuft NACH dem normalen Kantenaufbau, EINMAL über alle Knoten — durch die
// Union-Find-Struktur wirken bereits hinzugefügte Brücken sofort auf spätere
// Prüfungen, wodurch auch Ketten aus mehreren kleinen Inseln (A→B→Hauptnetz)
// in einem Durchlauf zusammenfinden.
function verbindeGetrennteTeilnetze(graph: RoadGraph) {
  const ids = [...graph.coordinates.keys()]
  if (ids.length === 0) return

  const parent = new Map<number, number>(ids.map((id) => [id, id]))
  function find(x: number): number {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!)
      x = parent.get(x)!
    }
    return x
  }
  function union(a: number, b: number) {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const [a, kanten] of graph.adjacency) {
    for (const { to: b } of kanten) union(a, b)
  }

  // Grid-Index über alle Knoten (gleiche Technik wie snappeKnoten/
  // baueOrtszonenTest) für eine schnelle Nachbarschaftssuche auch bei
  // mehreren tausend Knoten.
  const zellGrad = AUTO_VERBINDUNG_MAX_METER / 111_320
  const grid = new Map<string, number[]>()
  for (const id of ids) {
    const c = graph.coordinates.get(id)!
    const cx = Math.floor(c.lat / zellGrad)
    const cy = Math.floor(c.lng / zellGrad)
    const key = `${cx}_${cy}`
    if (!grid.has(key)) grid.set(key, [])
    grid.get(key)!.push(id)
  }

  for (const id of ids) {
    const c = graph.coordinates.get(id)!
    const cx = Math.floor(c.lat / zellGrad)
    const cy = Math.floor(c.lng / zellGrad)
    let bestId = -1
    let bestDist = AUTO_VERBINDUNG_MAX_METER
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const kandidaten = grid.get(`${cx + dx}_${cy + dy}`)
        if (!kandidaten) continue
        for (const kandId of kandidaten) {
          if (kandId === id || find(kandId) === find(id)) continue
          const d = haversine(c, graph.coordinates.get(kandId)!)
          if (d < bestDist) { bestDist = d; bestId = kandId }
        }
      }
    }
    if (bestId !== -1) {
      graph.addEdge(id, bestId, bestDist, false, 'paved', true)
      union(id, bestId)
    }
  }
}

export function buildRoadGraph(netz: OsmNetz, adressen: LatLng[] = []): RoadGraph {
  const graph = new RoadGraph()
  const kanonisch = snappeKnoten(netz)
  const istInnerorts = baueOrtszonenTest(adressen, FELDWEG_ORTS_RADIUS_METER)

  for (const [id, node] of netz.nodeMap) {
    const kid = kanonisch.get(id) ?? id
    if (!graph.coordinates.has(kid)) {
      graph.addNode(kid, { lat: node.lat, lng: node.lng })
    }
  }

  for (const way of netz.ways) {
    const istFeldweg = way.highway === 'track'
    for (let i = 0; i < way.nodeIds.length - 1; i++) {
      const a = kanonisch.get(way.nodeIds[i]) ?? way.nodeIds[i]
      const b = kanonisch.get(way.nodeIds[i + 1]) ?? way.nodeIds[i + 1]
      if (a === b) continue
      const ca = graph.coordinates.get(a)
      const cb = graph.coordinates.get(b)
      if (!ca || !cb) continue

      if (istFeldweg) {
        const mitte: LatLng = { lat: (ca.lat + cb.lat) / 2, lng: (ca.lng + cb.lng) / 2 }
        if (istInnerorts(mitte)) continue // innerorts: Feldweg ignorieren, nur Straße
        graph.addEdge(a, b, haversine(ca, cb), way.oneway, 'track')
      } else {
        graph.addEdge(a, b, haversine(ca, cb), way.oneway, 'paved')
      }
    }
  }

  verbindeGetrennteTeilnetze(graph)

  return graph
}

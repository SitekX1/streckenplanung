import { OsmNetz } from './overpassClient'
import { LatLng } from './types'

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

export class RoadGraph {
  adjacency: Map<number, Array<{ to: number; dist: number }>> = new Map()
  coordinates: Map<number, LatLng> = new Map()
  private naechsteVirtuelleId = -1

  addNode(id: number, coord: LatLng) {
    this.coordinates.set(id, coord)
    if (!this.adjacency.has(id)) this.adjacency.set(id, [])
  }

  addEdge(a: number, b: number, dist: number, oneway: boolean) {
    this.adjacency.get(a)?.push({ to: b, dist })
    if (!oneway) this.adjacency.get(b)?.push({ to: a, dist })
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
      for (const { to: b } of kanten) {
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
    const neueId = this.naechsteVirtuelleId--
    this.addNode(neueId, projCoord)
    this.removeEdge(bestA, bestB)
    this.addEdge(bestA, neueId, haversine(ca, projCoord), false)
    this.addEdge(neueId, bestB, haversine(projCoord, cb), false)
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
        const nd = d + edge.dist
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

export function buildRoadGraph(netz: OsmNetz): RoadGraph {
  const graph = new RoadGraph()
  const kanonisch = snappeKnoten(netz)

  for (const [id, node] of netz.nodeMap) {
    const kid = kanonisch.get(id) ?? id
    if (!graph.coordinates.has(kid)) {
      graph.addNode(kid, { lat: node.lat, lng: node.lng })
    }
  }

  for (const way of netz.ways) {
    for (let i = 0; i < way.nodeIds.length - 1; i++) {
      const a = kanonisch.get(way.nodeIds[i]) ?? way.nodeIds[i]
      const b = kanonisch.get(way.nodeIds[i + 1]) ?? way.nodeIds[i + 1]
      if (a === b) continue
      const ca = graph.coordinates.get(a)
      const cb = graph.coordinates.get(b)
      if (ca && cb) {
        graph.addEdge(a, b, haversine(ca, cb), way.oneway)
      }
    }
  }

  return graph
}

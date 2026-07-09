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

  addNode(id: number, coord: LatLng) {
    this.coordinates.set(id, coord)
    if (!this.adjacency.has(id)) this.adjacency.set(id, [])
  }

  addEdge(a: number, b: number, dist: number, oneway: boolean) {
    this.adjacency.get(a)?.push({ to: b, dist })
    if (!oneway) this.adjacency.get(b)?.push({ to: a, dist })
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

export function buildRoadGraph(netz: OsmNetz): RoadGraph {
  const graph = new RoadGraph()

  for (const [id, node] of netz.nodeMap) {
    graph.addNode(id, { lat: node.lat, lng: node.lng })
  }

  for (const way of netz.ways) {
    for (let i = 0; i < way.nodeIds.length - 1; i++) {
      const a = way.nodeIds[i]
      const b = way.nodeIds[i + 1]
      const ca = graph.coordinates.get(a)
      const cb = graph.coordinates.get(b)
      if (ca && cb) {
        graph.addEdge(a, b, haversine(ca, cb), way.oneway)
      }
    }
  }

  return graph
}

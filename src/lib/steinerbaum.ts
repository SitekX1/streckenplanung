import { RoadGraph } from './roadGraph'
import { LatLng } from './types'

export interface SteinerErgebnis {
  pfade: LatLng[][]
  gesamtLaengeMeter: number
}

// Steiner-Baum-Approximation via wiederholtem Multi-Source-Dijkstra.
// Startet vom Startpunkt, fügt in jedem Schritt den nächsten unverbundenen Terminal hinzu.
// Jede Straßen-Kante wird NUR EINMAL in den Baum aufgenommen → kein Hin-und-Rückweg.
// async: gibt alle 50 Iterationen die UI-Kontrolle zurück (Progress-Bar bleibt reaktiv).
export async function berechneSteinerBaum(
  graph: RoadGraph,
  startNodeId: number,
  terminalNodeIds: number[],
  onProgress?: (prozent: number) => void
): Promise<SteinerErgebnis> {
  const uniqueTerminals = [...new Set(terminalNodeIds)].filter((id) => id !== startNodeId)
  if (uniqueTerminals.length === 0) return { pfade: [], gesamtLaengeMeter: 0 }

  const treeNodes = new Set<number>([startNodeId])
  const usedEdges = new Set<string>() // normiert: "min_max"
  const remaining = new Set<number>(uniqueTerminals)
  const total = remaining.size
  let done = 0

  while (remaining.size > 0) {
    const result = graph.dijkstraVomBaum(treeNodes, remaining)
    if (!result) break // Unerreichbarer Terminal (z.B. getrenntes Teilgraph)

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

    // Alle 50 Terminals: Event-Loop freigeben damit React re-rendern kann
    if (done % 50 === 0) {
      await new Promise<void>((r) => setTimeout(r, 0))
    }
  }

  return kantenzuPfade(graph, usedEdges)
}

// Wandelt die verwendeten Kanten (als Set normierter Strings) in LatLng-Pfade um.
// Kanten mit Grad ≠ 2 (Abzweige, Blätter) sind Startpunkte für neue Pfadsegmente.
// Ketten von Grad-2-Knoten werden zu einzelnen langen Polylinien zusammengefasst.
function kantenzuPfade(graph: RoadGraph, usedEdges: Set<string>): SteinerErgebnis {
  if (usedEdges.size === 0) return { pfade: [], gesamtLaengeMeter: 0 }

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

  // Pfade von Blättern (Grad 1) und Abzweigpunkten (Grad ≠ 2) aus aufbauen
  const startNodes = [...adj.keys()].filter((id) => adj.get(id)!.length !== 2)
  if (startNodes.length === 0) {
    const first = adj.keys().next().value
    if (typeof first === 'number') startNodes.push(first)
  }

  function verfolge(von: number, zu: number): LatLng[] {
    const path: LatLng[] = [coord(von)]
    let prev = von, curr = zu

    while (true) {
      const k = `${Math.min(prev, curr)}_${Math.max(prev, curr)}`
      if (visitedEdges.has(k)) break
      visitedEdges.add(k)
      path.push(coord(curr))

      const weiter = (adj.get(curr) ?? []).filter((n) => {
        const nk = `${Math.min(curr, n)}_${Math.max(curr, n)}`
        return !visitedEdges.has(nk)
      })

      // Blatt oder Abzweig → Segment beenden
      if (weiter.length === 0 || adj.get(curr)!.length !== 2) break

      prev = curr
      curr = weiter[0]
    }

    return path
  }

  for (const startId of startNodes) {
    for (const neighbor of adj.get(startId) ?? []) {
      const k = `${Math.min(startId, neighbor)}_${Math.max(startId, neighbor)}`
      if (visitedEdges.has(k)) continue
      const path = verfolge(startId, neighbor)
      if (path.length >= 2) pfade.push(path)
    }
  }

  // Verbleibende Kanten (bei Zyklen)
  for (const key of usedEdges) {
    if (visitedEdges.has(key)) continue
    const [aStr, bStr] = key.split('_')
    const ca = graph.coordinates.get(parseInt(aStr))
    const cb = graph.coordinates.get(parseInt(bStr))
    if (ca && cb) pfade.push([ca, cb])
  }

  return { pfade, gesamtLaengeMeter: gesamtLaenge }
}

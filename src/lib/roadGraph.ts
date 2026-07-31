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

// Grobe Umrechnung "Breitengrad-äquivalente Gradeinheit" → Meter (siehe
// sucheNaechsteKante: sowohl bx als auch by sind in Breitengrad-Einheiten
// skaliert, also ist 1° ≈ 111.320m für beide Achsen gültig).
const GRAD_ZU_METER = 111_320

// Wie weit darf die nächste ECHTE Straße (nicht-Zufahrt) höchstens entfernt
// sein, damit eine näher liegende Zufahrt (highway=service) trotzdem
// gemieden wird? Deckt den ueblichen Fall "Haus liegt direkt an einer
// Straße" ab, ohne bei einer ausschließlich über eine Zufahrt erreichbaren
// Häusergruppe (oder einem ganzen als "service" getaggten Sträßchen) quer
// durchs Dorf an eine völlig andere Straße anzubinden.
const ZUFAHRT_BEVORZUGUNG_MAX_METER = 60

export class RoadGraph {
  adjacency: Map<number, Array<{ to: number; dist: number; weight: number; kind: WegKind; istZufahrt: boolean }>> = new Map()
  coordinates: Map<number, LatLng> = new Map()
  private naechsteVirtuelleId = -1

  addNode(id: number, coord: LatLng) {
    this.coordinates.set(id, coord)
    if (!this.adjacency.has(id)) this.adjacency.set(id, [])
  }

  // istZufahrt = highway=service (Einfahrten/Zufahrtswege/Stichwege) — zählt
  // als reguläre Straße (kind bleibt 'paved', keine Extra-Kosten fürs
  // Durchqueren), wird aber beim Anbindungspunkt-Suchen (nearestPointOnGraph)
  // bevorzugt gemieden. Siehe dort für den Hintergrund.
  addEdge(a: number, b: number, dist: number, oneway: boolean, kind: WegKind = 'paved', istZufahrt = false) {
    const weight = kind === 'track' ? dist * FELDWEG_KOSTEN_FAKTOR : dist
    this.adjacency.get(a)?.push({ to: b, dist, weight, kind, istZufahrt })
    if (!oneway) this.adjacency.get(b)?.push({ to: a, dist, weight, kind, istZufahrt })
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

  // Sucht den nächsten Punkt unter allen Kanten, optional Zufahrten
  // (highway=service) ausgeschlossen. Reine Geometrie-Suche, legt noch
  // keinen Knoten an.
  private sucheNaechsteKante(
    coord: LatLng,
    ohneZufahrten: boolean
  ): { a: number; b: number; t: number; dist2: number } | null {
    const cosLat = Math.cos((coord.lat * Math.PI) / 180)
    let bestDist2 = Infinity
    let bestA = -1
    let bestB = -1
    let bestT = 0
    const gesehen = new Set<string>()

    for (const [a, kanten] of this.adjacency) {
      for (const { to: b, istZufahrt } of kanten) {
        if (ohneZufahrten && istZufahrt) continue
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

    return bestA === -1 ? null : { a: bestA, b: bestB, t: bestT, dist2: bestDist2 }
  }

  // Nächsten Punkt auf dem GESAMTEN Straßennetz finden (nicht nur auf
  // existierenden Knoten) — bei Bedarf wird mitten auf einer Kante ein neuer
  // virtueller Knoten eingefügt. Ohne das würde nearestNode() ein Haus an
  // einer nur grob digitalisierten Straße (wenige OSM-Knoten) fälschlich an
  // den nächstgelegenen BELIEBIGEN Knoten anhängen — und das kann eine private
  // Einfahrt oder eine ganz andere Straße sein, wenn die eigene Straße zufällig
  // weiter entfernte Stützpunkte hat. Ergebnis: die Trasse "erreicht" das Haus
  // zwar (kein Fehler, kein Luftlinien-Fallback), aber über die falsche Straße.
  //
  // Zufahrten (highway=service — Einfahrten/Stichwege/Hofzufahrten) werden
  // dabei bevorzugt gemieden, ABER NUR wenn eine echte Straße auch wirklich
  // in der Nähe liegt (siehe ZUFAHRT_BEVORZUGUNG_MAX_METER) — sonst würde
  // z.B. ein ganzes als "service" getaggtes Wohnsträßchen komplett
  // übersprungen und stattdessen an eine völlig andere, weit entfernte
  // Straße im Datensatz angebunden. Der ursprüngliche Zweck ist enger: nur
  // die ganz knappen Fälle vermeiden, wo die Trasse für ein einzelnes Haus,
  // das schon direkt an der eigentlichen Straße liegt, ein paar Meter in
  // eine private Zufahrt hineinfahren würde, nur weil die geometrisch
  // hauchdünn näher liegt.
  nearestPointOnGraph(coord: LatLng): number {
    const nurStrasse = this.sucheNaechsteKante(coord, true)
    const alle = this.sucheNaechsteKante(coord, false)
    const strasseZuWeitWeg = !nurStrasse || Math.sqrt(nurStrasse.dist2) * GRAD_ZU_METER > ZUFAHRT_BEVORZUGUNG_MAX_METER
    const treffer = strasseZuWeitWeg ? alle : nurStrasse
    if (!treffer) return this.nearestNode(coord)
    const { a: bestA, b: bestB, t: bestT } = treffer

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
    const kante = (this.adjacency.get(bestA) ?? []).find((e) => e.to === bestB)
    const kind = kante?.kind ?? 'paved'
    const istZufahrt = kante?.istZufahrt ?? false
    const neueId = this.naechsteVirtuelleId--
    this.addNode(neueId, projCoord)
    this.removeEdge(bestA, bestB)
    this.addEdge(bestA, neueId, haversine(ca, projCoord), false, kind, istZufahrt)
    this.addEdge(neueId, bestB, haversine(projCoord, cb), false, kind, istZufahrt)
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
    const istZufahrt = way.highway === 'service'
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
        graph.addEdge(a, b, haversine(ca, cb), way.oneway, 'paved', istZufahrt)
      }
    }
  }

  return graph
}

import { Address, LatLng } from './types'

export interface OsmNode {
  id: number
  lat: number
  lng: number
}

export interface OsmWay {
  id: number
  nodeIds: number[]
  oneway: boolean
}

export interface OsmNetz {
  nodeMap: Map<number, OsmNode>
  ways: OsmWay[]
}

// Alle für FTTH-Planung relevanten Straßentypen
const HIGHWAY_FILTER =
  'motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|track|road|path'

export function berechneGrenzen(
  adressen: Address[],
  startpunkt: LatLng,
  padding = 0.015
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const lats = adressen.map((a) => a.lat)
  const lngs = adressen.map((a) => a.lon)
  lats.push(startpunkt.lat)
  lngs.push(startpunkt.lng)
  return {
    minLat: Math.min(...lats) - padding,
    maxLat: Math.max(...lats) + padding,
    minLng: Math.min(...lngs) - padding,
    maxLng: Math.max(...lngs) + padding,
  }
}

export async function fetchOsmNetz(bounds: {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}): Promise<OsmNetz> {
  const bbox = `${bounds.minLat},${bounds.minLng},${bounds.maxLat},${bounds.maxLng}`
  const query = `[out:json][timeout:90];(way["highway"~"${HIGHWAY_FILTER}"](${bbox}););out body;>;out skel qt;`

  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })

  if (!res.ok) throw new Error(`Overpass API: HTTP ${res.status}`)

  const data = (await res.json()) as {
    elements: Array<{
      type: string
      id: number
      lat?: number
      lon?: number
      nodes?: number[]
      tags?: Record<string, string>
    }>
  }

  const nodeMap = new Map<number, OsmNode>()
  const ways: OsmWay[] = []

  for (const el of data.elements) {
    if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) {
      nodeMap.set(el.id, { id: el.id, lat: el.lat, lng: el.lon })
    } else if (el.type === 'way' && el.nodes) {
      ways.push({ id: el.id, nodeIds: el.nodes, oneway: el.tags?.oneway === 'yes' })
    }
  }

  return { nodeMap, ways }
}

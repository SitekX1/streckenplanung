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

// Nur versiegelte/beschilderte Straßen — Feldwege/Fußwege (track/path) werden BEWUSST ausgeschlossen
// damit die Trasse nicht quer durch Felder oder Häuser läuft
const HIGHWAY_FILTER =
  'primary|secondary|tertiary|unclassified|residential|service|living_street|road'

export function berechneGrenzen(
  adressen: Address[],
  startpunkt: LatLng,
  padding = 0.008  // enger Puffer (~900m) → kleinere Overpass-Antwort
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

// Mehrere öffentliche Overpass-Mirror — wenn einer ausfällt, wird der nächste probiert
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

async function fetchOverpass(query: string): Promise<Response> {
  let lastError: unknown
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 55_000) // 55s pro Versuch
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (res.ok) return res
      lastError = new Error(`HTTP ${res.status} von ${endpoint}`)
    } catch (e) {
      clearTimeout(timer)
      lastError = e
    }
  }
  throw new Error(`Alle Overpass-Server nicht erreichbar: ${lastError}`)
}

export async function fetchOsmNetz(bounds: {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}): Promise<OsmNetz> {
  const bbox = `${bounds.minLat},${bounds.minLng},${bounds.maxLat},${bounds.maxLng}`
  const query = `[out:json][timeout:50];(way["highway"~"${HIGHWAY_FILTER}"](${bbox}););out body;>;out skel qt;`

  const res = await fetchOverpass(query)

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

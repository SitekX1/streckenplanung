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

// Nur versiegelte Straßen — Feldwege/Fußwege absichtlich ausgeschlossen
const HIGHWAY_FILTER =
  'primary|secondary|tertiary|unclassified|residential|service|living_street|road'

// private.coffee spiegelt kumi.systems — beide teilen sich teils dieselbe
// Infrastruktur. maps.mail.ru (VK Maps) läuft komplett unabhängig davon und
// gibt zusätzliche echte Redundanz, falls beide gleichzeitig ausfallen.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

// IndexedDB-Cache: einmal geladen → 48h gespeichert, kein Overpass-Abruf mehr nötig
const DB_NAME = 'streckenplanung-osm'
const STORE = 'osm-cache'
const TTL = 48 * 60 * 60 * 1000

async function dbOpen(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}

async function cacheGet(key: string): Promise<string | null> {
  try {
    if (typeof window === 'undefined' || !window.indexedDB) return null
    const db = await dbOpen()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => {
        const val = req.result as { ts: number; data: string } | undefined
        if (!val || Date.now() - val.ts > TTL) { resolve(null); return }
        resolve(val.data)
      }
      req.onerror = () => resolve(null)
    })
  } catch { return null }
}

async function cachePut(key: string, data: string): Promise<void> {
  try {
    if (typeof window === 'undefined' || !window.indexedDB) return
    const db = await dbOpen()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ ts: Date.now(), data }, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch { /* ignorieren */ }
}

export function berechneGrenzen(
  adressen: Address[],
  startpunkt: LatLng,
  padding = 0.008
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

function parseOsmResponse(data: {
  elements: Array<{
    type: string; id: number; lat?: number; lon?: number
    nodes?: number[]; tags?: Record<string, string>
  }>
}): OsmNetz {
  const nodeMap = new Map<number, OsmNode>()
  const ways: OsmWay[] = []
  for (const el of data.elements) {
    if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) {
      nodeMap.set(el.id, { id: el.id, lat: el.lat, lng: el.lon })
    } else if (el.type === 'way' && el.nodes) {
      ways.push({ id: el.id, nodeIds: el.nodes, oneway: el.tags?.oneway === 'yes' })
    }
  }
  if (nodeMap.size === 0) throw new Error('Keine Straßenknoten in Antwort')
  return { nodeMap, ways }
}

// Overpass bricht große Abfragen bei internem Timeout ab und liefert trotzdem
// ein valides JSON mit den bis dahin gesammelten (unvollständigen!) Daten plus
// einem "remark"-Feld. Ohne diese Prüfung würde so eine Teil-Antwort als
// vollständig gecacht (48h) und immer wieder als "Erfolg" ausgeliefert, obwohl
// z.B. ganze Straßenzüge fehlen.
function istUnvollstaendigeAntwort(text: string): boolean {
  try {
    const data = JSON.parse(text) as { remark?: string }
    return typeof data.remark === 'string' && data.remark.toLowerCase().includes('timeout')
  } catch {
    return false
  }
}

export async function fetchOsmNetz(bounds: {
  minLat: number; maxLat: number; minLng: number; maxLng: number
}): Promise<OsmNetz> {
  const cacheKey = [bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng]
    .map((v) => v.toFixed(4)).join('_')

  // 1. Cache prüfen — wenn vorhanden, sofort zurückgeben (außer der gecachte
  // Snapshot war selbst durch einen Overpass-Timeout unvollständig)
  const cached = await cacheGet(cacheKey)
  if (cached && !istUnvollstaendigeAntwort(cached)) {
    return parseOsmResponse(JSON.parse(cached))
  }

  const bbox = `${bounds.minLat},${bounds.minLng},${bounds.maxLat},${bounds.maxLng}`
  const query = `[out:json][timeout:50];(way["highway"~"${HIGHWAY_FILTER}"](${bbox}););out body;>;out skel qt;`
  const body = `data=${encodeURIComponent(query)}`

  const OSM_MAX_RETRIES = 1
  const OSM_RETRY_DELAY_MS = 8000

  let responseText: string | null = null
  let letzterFehler: unknown = null

  for (let versuch = 0; versuch <= OSM_MAX_RETRIES && !responseText; versuch++) {
    if (versuch > 0) await new Promise((r) => setTimeout(r, OSM_RETRY_DELAY_MS))

    // 2. Browser-direkt versuchen (alle Endpoints parallel — umgeht Vercel-IP-Limits)
    try {
      const direktText = await Promise.any(
        OVERPASS_ENDPOINTS.map(async (endpoint) => {
          const res = await fetch(endpoint, {
            method: 'POST', body,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            signal: AbortSignal.timeout(35_000),
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.text()
        })
      )
      if (istUnvollstaendigeAntwort(direktText)) {
        letzterFehler = new Error('Overpass-Antwort durch internen Timeout unvollständig')
      } else {
        responseText = direktText
        continue
      }
    } catch (e) {
      letzterFehler = e
    }

    // 3. Vercel-Proxy als Fallback (falls CORS oder lokale Firewall) — alle Overpass-Server
    // sind kurzzeitig manchmal komplett überlastet, daher die äußere Retry-Schleife.
    try {
      const proxyRes = await fetch('/api/osm-proxy', {
        method: 'POST', body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      if (!proxyRes.ok) {
        const err = await proxyRes.json().catch(() => ({ error: `HTTP ${proxyRes.status}` }))
        throw new Error((err as { error?: string }).error ?? `HTTP ${proxyRes.status}`)
      }
      const proxyText = await proxyRes.text()
      if (istUnvollstaendigeAntwort(proxyText)) {
        letzterFehler = new Error('Overpass-Antwort durch internen Timeout unvollständig')
      } else {
        responseText = proxyText
      }
    } catch (e) {
      letzterFehler = e
    }
  }

  if (!responseText) {
    throw new Error(letzterFehler instanceof Error ? letzterFehler.message : 'Keine Daten erhalten')
  }

  // 4. In IndexedDB speichern — nächster Aufruf mit gleicher Fläche ist sofort
  await cachePut(cacheKey, responseText)

  return parseOsmResponse(JSON.parse(responseText))
}

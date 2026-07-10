'use client'

import { memo, useEffect, useRef, useState } from 'react'
import {
  MapContainer, TileLayer, CircleMarker, Marker, Polyline,
  Tooltip, Popup, useMapEvents, useMap,
} from 'react-leaflet'
import L from 'leaflet'
import * as turf from '@turf/turf'
import 'leaflet/dist/leaflet.css'
import { Address, LatLng, Hausstich } from '../lib/types'

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const startpunktIcon = new L.DivIcon({
  className: '',
  html: `<div style="width:20px;height:20px;background:#ef4444;border:3px solid white;border-radius:50%;box-shadow:0 0 0 2px rgba(239,68,68,0.6),0 3px 12px rgba(0,0,0,0.9)"></div>`,
  iconSize: [20, 20], iconAnchor: [10, 10], popupAnchor: [0, -12],
})
const editHandleIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:12px;height:12px;background:#3b82f6;border:2px solid white;border-radius:50%;cursor:grab;box-shadow:0 0 0 1px rgba(59,130,246,0.4),0 2px 6px rgba(0,0,0,0.6)"></div>',
  iconSize: [12, 12], iconAnchor: [6, 6],
})
const editHandleAktivIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:16px;height:16px;background:#f97316;border:3px solid white;border-radius:50%;cursor:crosshair;box-shadow:0 0 0 3px rgba(249,115,22,0.6),0 2px 8px rgba(0,0,0,0.8)"></div>',
  iconSize: [16, 16], iconAnchor: [8, 8],
})
const hsHausIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:11px;height:11px;background:#f97316;border:2px solid white;border-radius:50%;cursor:grab;box-shadow:0 2px 6px rgba(0,0,0,0.7)"></div>',
  iconSize: [11, 11], iconAnchor: [5, 5],
})
const hsTrasseIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:11px;height:11px;background:#a855f7;border:2px solid white;border-radius:50%;cursor:grab;box-shadow:0 2px 6px rgba(0,0,0,0.7)"></div>',
  iconSize: [11, 11], iconAnchor: [5, 5],
})

function berechneLinieLaenge(wp: LatLng[]): number {
  let total = 0
  for (let i = 0; i < wp.length - 1; i++) {
    const dLat = (wp[i + 1].lat - wp[i].lat) * 111_000
    const dLng = (wp[i + 1].lng - wp[i].lng) * Math.cos((wp[i].lat * Math.PI) / 180) * 111_000
    total += Math.sqrt(dLat * dLat + dLng * dLng)
  }
  return total
}

type MenuAktion = { label: string; farbe: string; action: () => void }
type AktivMenu = { screenX: number; screenY: number; aktionen: MenuAktion[] } | null
type NeuerHsStart = { adresseUuid: string; pos: LatLng; name: string } | null

interface MapViewProps {
  adressen: Address[]
  startpunkt: LatLng | null
  startpunktSetzenAktiv: boolean
  trasse: LatLng[]
  trassePfade: LatLng[][]
  hausanschluesse: Hausstich[]
  editierbarAktiv: boolean
  aktiveOrteKeys: string[]
  adressFarbe: string
  trasseFarbe: string
  hausanschlussfarbe: string
  trasseMethode?: string
  onStartpunktGesetzt: (punkt: LatLng) => void
  onTrasseGeaendert: (punkte: LatLng[]) => void
  onTrassePfadeGeaendert: (pfade: LatLng[][]) => void
  onHausanschluesseGeaendert: (updated: Hausstich[]) => void
}

function KlickHandler({
  aktiv, onKlick, ziehModus, onZiehZiel, hsZeichenModus, onHsZeichenZiel, menuOffen, onMenuSchliessen,
}: {
  aktiv: boolean
  onKlick: (p: LatLng) => void
  ziehModus?: boolean
  onZiehZiel?: (p: LatLng) => void
  hsZeichenModus?: boolean
  onHsZeichenZiel?: (p: LatLng) => void
  menuOffen?: boolean
  onMenuSchliessen?: () => void
}) {
  useMapEvents({
    click(e) {
      if (menuOffen) { onMenuSchliessen?.(); return }
      const pos = { lat: e.latlng.lat, lng: e.latlng.lng }
      if (ziehModus && onZiehZiel) onZiehZiel(pos)
      else if (hsZeichenModus && onHsZeichenZiel) onHsZeichenZiel(pos)
      else if (aktiv) onKlick(pos)
    },
  })
  return null
}

function AutoZoom({ adressen }: { adressen: Address[] }) {
  const map = useMap()
  const letzteAnzahl = useRef(0)
  useEffect(() => {
    if (adressen.length > 0 && adressen.length !== letzteAnzahl.current) {
      letzteAnzahl.current = adressen.length
      const bounds = L.latLngBounds(adressen.map((a) => [a.lat, a.lon]))
      map.fitBounds(bounds, { padding: [40, 40] })
    }
  }, [adressen, map])
  return null
}

function TopographieWMS({ sichtbar }: { sichtbar: boolean }) {
  const map = useMap()
  useEffect(() => {
    if (!sichtbar) return
    const wmsLayer = L.tileLayer.wms('https://sgx.geodatenzentrum.de/wms_topplus_open', {
      layers: 'web', version: '1.1.1', format: 'image/png', transparent: false,
      attribution: '© Bundesamt für Kartographie und Geodäsie (BKG)',
      maxNativeZoom: 18, maxZoom: 21,
    } as L.WMSOptions)
    wmsLayer.addTo(map)
    return () => { map.removeLayer(wmsLayer) }
  }, [map, sichtbar])
  return null
}

function FlyTo({ ziel }: { ziel: LatLng | null }) {
  const map = useMap()
  useEffect(() => {
    if (ziel) map.flyTo([ziel.lat, ziel.lng], 15, { duration: 1.2 })
  }, [map, ziel])
  return null
}

function TrasseNetzwerk({ pfade, farbe, opacity = 0.9 }: { pfade: LatLng[][]; farbe: string; opacity?: number }) {
  const map = useMap()
  useEffect(() => {
    const gueltige = pfade.filter((p) => p.length >= 2)
    if (gueltige.length === 0) return
    const renderer = L.canvas({ padding: 0.1 })
    const gruppe = L.layerGroup(
      gueltige.map((pfad) =>
        L.polyline(pfad.map((p) => [p.lat, p.lng] as [number, number]), { color: farbe, weight: 4, opacity, renderer } as L.PolylineOptions)
      )
    ).addTo(map)
    return () => { map.removeLayer(gruppe) }
  }, [pfade, farbe, opacity, map])
  return null
}

type TileVariante = 'satellit' | 'osm'

const MapView = memo(function MapView({
  adressen, startpunkt, startpunktSetzenAktiv, trasse, trassePfade, hausanschluesse,
  editierbarAktiv, aktiveOrteKeys, adressFarbe, trasseFarbe, hausanschlussfarbe, trasseMethode,
  onStartpunktGesetzt, onTrasseGeaendert, onTrassePfadeGeaendert, onHausanschluesseGeaendert,
}: MapViewProps) {
  const [tileVariante, setTileVariante] = useState<TileVariante>('satellit')
  const [topoSichtbar, setTopoSichtbar] = useState(false)
  const [ortsnamenSichtbar, setOrtsnamenSichtbar] = useState(true)
  const [suchQuery, setSuchQuery] = useState('')
  const [suchLaden, setSuchLaden] = useState(false)
  const [suchFehler, setSuchFehler] = useState(false)
  const [flugZiel, setFlugZiel] = useState<LatLng | null>(null)

  // Layer-Sichtbarkeit
  const [trasseSichtbar, setTrasseSichtbar] = useState(true)
  const [hausanschluesseSichtbar, setHausanschluesseSichtbar] = useState(true)
  const [adressenSichtbar, setAdressenSichtbar] = useState(true)

  const [editPfade, setEditPfade] = useState<LatLng[][]>([])
  const [editSingle, setEditSingle] = useState<LatLng[]>([])
  const [deletedStack, setDeletedStack] = useState<Hausstich[]>([])
  const [ziehStartId, setZiehStartId] = useState<string | null>(null)
  const [ziehStartPos, setZiehStartPos] = useState<LatLng | null>(null)
  const [aktivMenu, setAktivMenu] = useState<AktivMenu>(null)
  // Manuell neuen Hausanschluss zeichnen
  const [neuerHsStart, setNeuerHsStart] = useState<NeuerHsStart>(null)

  const trasseRef = useRef<LatLng[]>([])
  const trassePfadeRef = useRef<LatLng[][]>([])
  const editPfadeRef = useRef<LatLng[][]>([])
  const editSingleRef = useRef<LatLng[]>([])
  const prevEditRef = useRef(false)
  const editiertRef = useRef(false)

  useEffect(() => { trasseRef.current = trasse }, [trasse])
  useEffect(() => { trassePfadeRef.current = trassePfade }, [trassePfade])
  useEffect(() => { editPfadeRef.current = editPfade }, [editPfade])
  useEffect(() => { editSingleRef.current = editSingle }, [editSingle])

  useEffect(() => {
    const wasActive = prevEditRef.current
    prevEditRef.current = editierbarAktiv

    if (!wasActive && editierbarAktiv) {
      const pfade = trassePfadeRef.current
      const t = trasseRef.current
      setDeletedStack([])
      editiertRef.current = false
      if (pfade.length > 0) {
        const gueltig = pfade.filter((p) => p.length >= 2)
        const gesamtPunkte = gueltig.reduce((s, p) => s + p.length, 0)
        const maxProPfad = gesamtPunkte <= 2000 ? Infinity : Math.max(3, Math.floor(2000 / gueltig.length))
        setEditPfade(gueltig.map((pfad) => {
          if (!isFinite(maxProPfad) || pfad.length <= maxProPfad) return [...pfad]
          const step = (pfad.length - 1) / (maxProPfad - 1)
          return Array.from({ length: maxProPfad }, (_, i) => pfad[Math.round(i * step)])
        }))
        setEditSingle([])
      } else if (t.length >= 2) {
        const max = 500
        setEditSingle(t.length <= max ? [...t] : t.filter((_, i) => i % Math.ceil(t.length / max) === 0 || i === t.length - 1))
        setEditPfade([])
      }
    } else if (wasActive && !editierbarAktiv) {
      const ep = editPfadeRef.current
      const es = editSingleRef.current
      if (editiertRef.current) {
        if (ep.length > 0) onTrassePfadeGeaendert(ep.filter((p) => p.length >= 2))
        else if (es.length >= 2) onTrasseGeaendert(es)
      }
      setEditPfade([])
      setEditSingle([])
      setDeletedStack([])
      setZiehStartId(null)
      setZiehStartPos(null)
      setNeuerHsStart(null)
      setAktivMenu(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editierbarAktiv])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setZiehStartId(null); setZiehStartPos(null)
        setNeuerHsStart(null); setAktivMenu(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function handleZiehZiel(zielPos: LatLng) {
    if (!ziehStartPos) return
    editiertRef.current = true
    setEditPfade((prev) => [...prev, [ziehStartPos, zielPos]])
    setZiehStartId(null)
    setZiehStartPos(null)
  }

  function handleNeuerHsZiel(zielPos: LatLng) {
    if (!neuerHsStart) return
    const wp: LatLng[] = [neuerHsStart.pos, zielPos]
    const neuerHs: Hausstich = {
      id: crypto.randomUUID(),
      addressUuid: neuerHsStart.adresseUuid,
      hausKoordinate: neuerHsStart.pos,
      trassenPunkt: zielPos,
      wegpunkte: wp,
      laengeMeter: berechneLinieLaenge(wp),
    }
    onHausanschluesseGeaendert([...hausanschluesse, neuerHs])
    setNeuerHsStart(null)
  }

  // --- Trasse ---
  function handlePfadPunktBewegt(pfadIdx: number, punktIdx: number, pos: LatLng) {
    editiertRef.current = true
    setEditPfade((prev) =>
      prev.map((pf, pi) => (pi === pfadIdx ? pf.map((p, i) => (i === punktIdx ? pos : p)) : pf))
    )
  }

  function handlePfadPunktLoeschen(pfadIdx: number, punktIdx: number) {
    editiertRef.current = true
    setEditPfade((prev) =>
      prev.map((pf, pi) => {
        if (pi !== pfadIdx) return pf
        if (pf.length <= 2) return []
        return pf.filter((_, i) => i !== punktIdx)
      }).filter((pf) => pf.length >= 2)
    )
  }

  function handlePfadLoeschen(pfadIdx: number) {
    editiertRef.current = true
    setEditPfade((prev) => prev.filter((_, i) => i !== pfadIdx))
  }

  function handlePfadPunktEinfuegen(pfadIdx: number, klickPos: LatLng) {
    editiertRef.current = true
    setEditPfade((prev) =>
      prev.map((pf, pi) => {
        if (pi !== pfadIdx || pf.length < 2) return pf
        let bestIdx = 0, bestDist = Infinity
        for (let i = 0; i < pf.length - 1; i++) {
          const d = (klickPos.lat - (pf[i].lat + pf[i + 1].lat) / 2) ** 2 + (klickPos.lng - (pf[i].lng + pf[i + 1].lng) / 2) ** 2
          if (d < bestDist) { bestDist = d; bestIdx = i }
        }
        return [...pf.slice(0, bestIdx + 1), klickPos, ...pf.slice(bestIdx + 1)]
      })
    )
  }

  function handleSinglePunktBewegt(i: number, pos: LatLng) {
    editiertRef.current = true
    setEditSingle((prev) => prev.map((p, idx) => (idx === i ? pos : p)))
  }

  function handleSinglePunktLoeschen(i: number) {
    editiertRef.current = true
    setEditSingle((prev) => prev.filter((_, idx) => idx !== i))
  }

  function handleSinglePunktEinfuegen(klickPos: LatLng) {
    if (editSingle.length < 2) return
    try {
      const line = turf.lineString(editSingle.map((p) => [p.lng, p.lat]))
      const nearest = turf.nearestPointOnLine(line, turf.point([klickPos.lng, klickPos.lat]))
      const idx = (nearest.properties.index ?? 0) as number
      editiertRef.current = true
      setEditSingle((prev) => { const u = [...prev]; u.splice(idx + 1, 0, klickPos); return u })
    } catch { /* ignore */ }
  }

  // --- Hausanschlüsse ---
  function hausstichWp(h: Hausstich): LatLng[] {
    return h.wegpunkte && h.wegpunkte.length >= 2 ? h.wegpunkte : [h.hausKoordinate, h.trassenPunkt]
  }

  function handleHsWpBewegen(id: string, wpIdx: number, neuePos: LatLng) {
    const updated = hausanschluesse.map((h) => {
      if (h.id !== id) return h
      const wp = [...hausstichWp(h)]
      wp[wpIdx] = neuePos
      return { ...h, wegpunkte: wp, hausKoordinate: wp[0], trassenPunkt: wp[wp.length - 1], laengeMeter: berechneLinieLaenge(wp) }
    })
    onHausanschluesseGeaendert(updated)
  }

  function handleHsPunktLoeschen(id: string, wpIdx: number) {
    const updated = hausanschluesse.map((h) => {
      if (h.id !== id) return h
      const wp = hausstichWp(h)
      if (wp.length <= 2) return h
      const newWp = wp.filter((_, i) => i !== wpIdx)
      return { ...h, wegpunkte: newWp, laengeMeter: berechneLinieLaenge(newWp) }
    })
    onHausanschluesseGeaendert(updated)
  }

  function handleHsPunktEinfuegen(id: string, klickPos: LatLng) {
    const updated = hausanschluesse.map((h) => {
      if (h.id !== id) return h
      const wp = hausstichWp(h)
      let bestIdx = 0, bestDist = Infinity
      for (let i = 0; i < wp.length - 1; i++) {
        const d = (klickPos.lat - (wp[i].lat + wp[i + 1].lat) / 2) ** 2 + (klickPos.lng - (wp[i].lng + wp[i + 1].lng) / 2) ** 2
        if (d < bestDist) { bestDist = d; bestIdx = i }
      }
      const newWp = [...wp.slice(0, bestIdx + 1), klickPos, ...wp.slice(bestIdx + 1)]
      return { ...h, wegpunkte: newWp, laengeMeter: berechneLinieLaenge(newWp) }
    })
    onHausanschluesseGeaendert(updated)
  }

  function handleHsLoeschen(id: string) {
    const deleted = hausanschluesse.find((h) => h.id === id)
    if (deleted) setDeletedStack((prev) => [...prev, deleted].slice(-10))
    onHausanschluesseGeaendert(hausanschluesse.filter((h) => h.id !== id))
  }

  function handleHsUndo() {
    if (deletedStack.length === 0) return
    const last = deletedStack[deletedStack.length - 1]
    setDeletedStack((prev) => prev.slice(0, -1))
    onHausanschluesseGeaendert([...hausanschluesse, last])
  }

  async function handleSuche() {
    const q = suchQuery.trim()
    if (!q) return
    setSuchLaden(true); setSuchFehler(false)
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=de`
      const res = await fetch(url, { headers: { 'Accept-Language': 'de' } })
      const data = await res.json()
      if (data.length > 0) setFlugZiel({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) })
      else setSuchFehler(true)
    } catch { setSuchFehler(true) }
    finally { setSuchLaden(false) }
  }

  function zeigeMenu(e: L.LeafletMouseEvent, aktionen: MenuAktion[]) {
    setAktivMenu({ screenX: e.containerPoint.x, screenY: e.containerPoint.y, aktionen })
  }

  const btnStyle = (farbe: string, border: boolean): React.CSSProperties => ({
    display: 'block', width: '100%', padding: '13px 16px', background: 'none', border: 'none',
    borderBottom: border ? '1px solid #374151' : 'none',
    color: farbe, fontSize: '14px', cursor: 'pointer', textAlign: 'left',
  })

  const layerBtnStyle = (aktiv: boolean): React.CSSProperties => ({
    backgroundColor: aktiv ? '#1e3a5f' : '#1a1a1a',
    color: '#f9fafb',
    border: `1px solid ${aktiv ? '#3b82f6' : '#374151'}`,
    opacity: aktiv ? 1 : 0.55,
  })

  const imZeichenModus = !!ziehStartId || !!neuerHsStart

  return (
    <div className="relative w-full h-full">
      {/* Ortssuche */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-1000 flex gap-2 items-center">
        <input
          type="text" value={suchQuery}
          onChange={(e) => { setSuchQuery(e.target.value); setSuchFehler(false) }}
          onKeyDown={(e) => e.key === 'Enter' && handleSuche()}
          placeholder="Ort oder Adresse suchen…"
          className="w-56 px-3 py-1.5 rounded-lg text-xs outline-none shadow-lg"
          style={{ backgroundColor: '#1a1a1a', color: '#f9fafb', border: `1px solid ${suchFehler ? '#ef4444' : '#374151'}` }}
        />
        <button onClick={handleSuche} disabled={suchLaden}
          className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg transition-colors disabled:opacity-50"
          style={{ backgroundColor: '#3b82f6', color: '#fff', border: 'none' }}>
          {suchLaden ? '…' : '🔍'}
        </button>
        {suchFehler && <span className="text-xs" style={{ color: '#ef4444' }}>Nicht gefunden</span>}
      </div>

      {/* Rechte Buttons */}
      <div className="absolute top-3 right-3 z-1000 flex flex-col gap-2">
        <button onClick={() => setTileVariante((v) => (v === 'satellit' ? 'osm' : 'satellit'))}
          className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg"
          style={{ backgroundColor: '#1a1a1a', color: '#f9fafb', border: '1px solid #374151' }}>
          {tileVariante === 'satellit' ? '🗺️ Karte' : '🛰️ Satellit'}
        </button>
        <button onClick={() => setTopoSichtbar((v) => !v)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg"
          style={{ backgroundColor: topoSichtbar ? '#1e3a5f' : '#1a1a1a', color: '#f9fafb', border: `1px solid ${topoSichtbar ? '#3b82f6' : '#374151'}` }}>
          📐 Topokarte
        </button>
        <button onClick={() => setOrtsnamenSichtbar((v) => !v)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg"
          style={{ backgroundColor: ortsnamenSichtbar ? '#1e3a5f' : '#1a1a1a', color: '#f9fafb', border: `1px solid ${ortsnamenSichtbar ? '#3b82f6' : '#374151'}` }}>
          🏷️ Ortsnamen
        </button>

        <div style={{ borderTop: '1px solid #374151', margin: '2px 0' }} />

        <button onClick={() => setTrasseSichtbar((v) => !v)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg transition-all flex items-center gap-1.5"
          style={layerBtnStyle(trasseSichtbar)}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: trasseFarbe, display: 'inline-block', flexShrink: 0 }} />
          Trasse
        </button>
        <button onClick={() => setHausanschluesseSichtbar((v) => !v)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg transition-all flex items-center gap-1.5"
          style={layerBtnStyle(hausanschluesseSichtbar)}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: hausanschlussfarbe, display: 'inline-block', flexShrink: 0 }} />
          Hausanschlüsse
        </button>
        <button onClick={() => setAdressenSichtbar((v) => !v)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg transition-all flex items-center gap-1.5"
          style={layerBtnStyle(adressenSichtbar)}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: adressFarbe, display: 'inline-block', flexShrink: 0 }} />
          Adressen
        </button>
      </div>

      <MapContainer center={[51.1657, 10.4515]} zoom={6} style={{ height: '100%', width: '100%' }}
        className={startpunktSetzenAktiv || imZeichenModus ? 'cursor-crosshair' : ''}>

        {tileVariante === 'satellit' ? (
          <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="© Esri" maxNativeZoom={19} maxZoom={21} />
        ) : (
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' maxNativeZoom={19} maxZoom={21} />
        )}
        {ortsnamenSichtbar && (
          <TileLayer url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" attribution="© Esri" maxNativeZoom={19} maxZoom={21} opacity={1} />
        )}

        <KlickHandler aktiv={startpunktSetzenAktiv} onKlick={onStartpunktGesetzt}
          ziehModus={!!ziehStartId} onZiehZiel={handleZiehZiel}
          hsZeichenModus={!!neuerHsStart} onHsZeichenZiel={handleNeuerHsZiel}
          menuOffen={!!aktivMenu} onMenuSchliessen={() => setAktivMenu(null)} />
        <AutoZoom adressen={adressen} />
        <TopographieWMS sichtbar={topoSichtbar} />
        <FlyTo ziel={flugZiel} />

        {/* Adressen */}
        {adressenSichtbar && adressen.map((a) => {
          const aktiv = aktiveOrteKeys.includes(`${a.plz}_${a.ortsname}_${a.ortsteil}`)
          const istHsStart = neuerHsStart?.adresseUuid === a.uuid
          return (
            <CircleMarker key={a.uuid} center={[a.lat, a.lon]}
              radius={istHsStart ? 9 : aktiv ? 6 : 4}
              pathOptions={{
                fillColor: istHsStart ? '#fbbf24' : aktiv ? adressFarbe : '#6b7280',
                color: istHsStart ? '#f59e0b' : aktiv ? adressFarbe : '#4b5563',
                weight: istHsStart ? 3 : 1.5,
                fillOpacity: aktiv ? 0.85 : 0.3,
              }}
              eventHandlers={editierbarAktiv ? {
                click: (e) => {
                  e.originalEvent?.stopPropagation?.()
                  if (ziehStartId) { handleZiehZiel({ lat: a.lat, lng: a.lon }); return }
                  if (neuerHsStart) {
                    // Andere Adresse antippen wechselt den Startpunkt
                    setNeuerHsStart({ adresseUuid: a.uuid, pos: { lat: a.lat, lng: a.lon }, name: `${a.strasse} ${a.nr}` })
                    return
                  }
                  zeigeMenu(e as unknown as L.LeafletMouseEvent, [
                    { label: '🔴 Hausanschluss zeichnen', farbe: '#fca5a5', action: () => {
                      setNeuerHsStart({ adresseUuid: a.uuid, pos: { lat: a.lat, lng: a.lon }, name: `${a.strasse} ${a.nr}` })
                      setAktivMenu(null)
                    }},
                  ])
                },
              } : {}}>
              <Tooltip>{a.strasse} {a.nr}{a.nr_zusatz ? ` ${a.nr_zusatz}` : ''}, {a.ortsname}</Tooltip>
              {!editierbarAktiv && (
                <Popup>
                  <div className="text-sm">
                    <p className="font-semibold">{a.strasse} {a.nr}{a.nr_zusatz ? ` ${a.nr_zusatz}` : ''}</p>
                    <p>{a.plz} {a.ortsname}</p>
                    {a.ortsteil && <p className="text-gray-500">{a.ortsteil}</p>}
                    <p className="mt-1 text-blue-600">Haushalte: {a.hh}</p>
                  </div>
                </Popup>
              )}
            </CircleMarker>
          )
        })}

        {startpunkt && <Marker position={[startpunkt.lat, startpunkt.lng]} icon={startpunktIcon}><Tooltip>Startpunkt</Tooltip></Marker>}

        {/* Trasse View */}
        {trasseSichtbar && trassePfade.length > 0 && <TrasseNetzwerk pfade={trassePfade} farbe={trasseFarbe} opacity={editierbarAktiv ? 0.25 : 0.9} />}
        {trasseSichtbar && !editierbarAktiv && trassePfade.length === 0 && trasse.length >= 2 && (
          <Polyline positions={trasse.map((p) => [p.lat, p.lng] as [number, number])} pathOptions={{ color: trasseFarbe, weight: 4, opacity: 0.9 }} />
        )}

        {/* Trasse Edit — MST-Linien */}
        {editierbarAktiv && editPfade.map((pfad, pi) =>
          pfad.length >= 2 ? (
            <Polyline key={`ep-${pi}`} positions={pfad.map((p) => [p.lat, p.lng] as [number, number])}
              pathOptions={{ color: trasseFarbe, weight: 5, opacity: 0.9 }}
              eventHandlers={{
                click: (e) => {
                  if (ziehStartId) return
                  e.originalEvent.stopPropagation()
                  const pos = { lat: e.latlng.lat, lng: e.latlng.lng }
                  if (neuerHsStart) { handleNeuerHsZiel(pos); return }
                  zeigeMenu(e, [
                    { label: '➕ Punkt einfügen', farbe: '#93c5fd', action: () => { handlePfadPunktEinfuegen(pi, pos); setAktivMenu(null) } },
                    { label: '🗑️ Segment löschen', farbe: '#f87171', action: () => { handlePfadLoeschen(pi); setAktivMenu(null) } },
                  ])
                },
              }} />
          ) : null
        )}

        {/* Trasse Edit — Einzel-Linie */}
        {editierbarAktiv && editSingle.length >= 2 && (
          <Polyline positions={editSingle.map((p) => [p.lat, p.lng] as [number, number])}
            pathOptions={{ color: trasseFarbe, weight: 5, opacity: 0.9 }}
            eventHandlers={{
              click: (e) => {
                if (ziehStartId) return
                e.originalEvent.stopPropagation()
                const pos = { lat: e.latlng.lat, lng: e.latlng.lng }
                if (neuerHsStart) { handleNeuerHsZiel(pos); return }
                zeigeMenu(e, [
                  { label: '➕ Punkt einfügen', farbe: '#93c5fd', action: () => { handleSinglePunktEinfuegen(pos); setAktivMenu(null) } },
                ])
              },
            }} />
        )}

        {/* Trasse Edit — MST-Handles */}
        {editierbarAktiv && editPfade.flatMap((pfad, pi) =>
          pfad.map((p, i) => {
            const hid = `ep-${pi}-${i}`
            const istAktiv = ziehStartId === hid
            return (
              <Marker key={`ep-h-${pi}-${i}`} position={[p.lat, p.lng]} draggable={!imZeichenModus}
                icon={istAktiv ? editHandleAktivIcon : editHandleIcon}
                eventHandlers={{
                  click: (e) => {
                    if (e.originalEvent) e.originalEvent.stopPropagation()
                    if (ziehStartId) { handleZiehZiel(p); return }
                    if (neuerHsStart) { handleNeuerHsZiel(p); return }
                    zeigeMenu(e, [
                      { label: '🗑️ Punkt löschen', farbe: '#f87171', action: () => { handlePfadPunktLoeschen(pi, i); setAktivMenu(null) } },
                      { label: '✏️ Neuer Strich', farbe: '#93c5fd', action: () => { setZiehStartId(hid); setZiehStartPos(p); setAktivMenu(null) } },
                    ])
                  },
                  dragstart: () => setAktivMenu(null),
                  dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); handlePfadPunktBewegt(pi, i, { lat: ll.lat, lng: ll.lng }) },
                }}>
                {istAktiv && <Tooltip permanent>Karte antippen → Segment · ESC = Abbrechen</Tooltip>}
              </Marker>
            )
          })
        )}

        {/* Trasse Edit — Einzel-Handles */}
        {editierbarAktiv && editSingle.map((p, i) => {
          const hid = `es-${i}`
          const istAktiv = ziehStartId === hid
          return (
            <Marker key={`es-h-${i}`} position={[p.lat, p.lng]} draggable={!imZeichenModus}
              icon={istAktiv ? editHandleAktivIcon : editHandleIcon}
              eventHandlers={{
                click: (e) => {
                  if (e.originalEvent) e.originalEvent.stopPropagation()
                  if (ziehStartId) { handleZiehZiel(p); return }
                  if (neuerHsStart) { handleNeuerHsZiel(p); return }
                  zeigeMenu(e, [
                    { label: '🗑️ Punkt löschen', farbe: '#f87171', action: () => { handleSinglePunktLoeschen(i); setAktivMenu(null) } },
                    { label: '✏️ Neuer Strich', farbe: '#93c5fd', action: () => { setZiehStartId(hid); setZiehStartPos(p); setAktivMenu(null) } },
                  ])
                },
                dragstart: () => setAktivMenu(null),
                dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); handleSinglePunktBewegt(i, { lat: ll.lat, lng: ll.lng }) },
              }}>
              {istAktiv && <Tooltip permanent>Karte antippen → Segment · ESC = Abbrechen</Tooltip>}
            </Marker>
          )
        })}

        {/* Hausanschlüsse — Linien */}
        {hausanschluesseSichtbar && hausanschluesse.map((h) => {
          const wp = hausstichWp(h)
          return (
            <Polyline key={h.id} positions={wp.map((p) => [p.lat, p.lng] as [number, number])}
              pathOptions={{ color: hausanschlussfarbe, weight: editierbarAktiv ? 3 : 2, opacity: editierbarAktiv ? 1 : 0.8 }}
              eventHandlers={editierbarAktiv ? {
                click: (e) => {
                  e.originalEvent.stopPropagation()
                  if (neuerHsStart) return
                  const pos = { lat: e.latlng.lat, lng: e.latlng.lng }
                  zeigeMenu(e, [
                    { label: '➕ Punkt einfügen', farbe: '#93c5fd', action: () => { handleHsPunktEinfuegen(h.id, pos); setAktivMenu(null) } },
                    { label: '🗑️ Linie löschen', farbe: '#f87171', action: () => { handleHsLoeschen(h.id); setAktivMenu(null) } },
                  ])
                },
              } : {}}>
              <Tooltip>{editierbarAktiv ? 'Antippen = Menü · ' : ''}Hausanschluss: {h.laengeMeter.toFixed(1)} m</Tooltip>
            </Polyline>
          )
        })}

        {/* Hausanschlüsse — Handles */}
        {hausanschluesseSichtbar && editierbarAktiv && hausanschluesse.flatMap((h) => {
          const wp = hausstichWp(h)
          return wp.map((p, idx) => {
            const isFirst = idx === 0
            const isLast = idx === wp.length - 1
            const icon = isFirst ? hsHausIcon : isLast ? hsTrasseIcon : editHandleIcon
            const tip = isFirst ? '🏠 Haus-Ende' : isLast ? '📡 Kabel-Ende' : 'Zwischenpunkt'
            return (
              <Marker key={`hs-wp-${h.id}-${idx}`} position={[p.lat, p.lng]} draggable={!imZeichenModus} icon={icon}
                eventHandlers={{
                  click: (e) => {
                    if (e.originalEvent) e.originalEvent.stopPropagation()
                    if (ziehStartId) { handleZiehZiel(p); return }
                    if (neuerHsStart) { handleNeuerHsZiel(p); return }
                    zeigeMenu(e, [
                      { label: '🗑️ Punkt löschen', farbe: '#f87171', action: () => { handleHsPunktLoeschen(h.id, idx); setAktivMenu(null) } },
                    ])
                  },
                  dragstart: () => setAktivMenu(null),
                  dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); handleHsWpBewegen(h.id, idx, { lat: ll.lat, lng: ll.lng }) },
                }}>
                <Tooltip>{tip}</Tooltip>
              </Marker>
            )
          })
        })}
      </MapContainer>

      {startpunktSetzenAktiv && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 px-4 py-2 rounded-lg text-sm font-medium shadow-lg"
          style={{ backgroundColor: '#1a1a1a', color: '#f9fafb', border: '1px solid #3b82f6' }}>
          Klick auf die Karte, um den Startpunkt zu setzen
        </div>
      )}

      {trasseMethode && !editierbarAktiv && (
        <div className="absolute bottom-4 right-3 z-1000 px-3 py-1.5 rounded-lg text-xs shadow-lg max-w-xs"
          style={{
            backgroundColor: '#1a1a1a',
            color: trasseMethode.startsWith('OSM') ? '#4ade80' : trasseMethode.startsWith('Fehler') || trasseMethode.startsWith('Erweiterung fehlgeschlagen') ? '#f87171' : '#fbbf24',
            border: `1px solid ${trasseMethode.startsWith('OSM') ? '#16a34a' : trasseMethode.startsWith('Fehler') || trasseMethode.startsWith('Erweiterung fehlgeschlagen') ? '#dc2626' : '#d97706'}`,
          }}>
          {trasseMethode.startsWith('OSM') || trasseMethode.includes('Erweitert') ? '✅' : trasseMethode.startsWith('Fehler') || trasseMethode.startsWith('Erweiterung fehlgeschlagen') ? '❌' : '⚠️'} {trasseMethode}
          {(trasseMethode.startsWith('Fehler') || trasseMethode.startsWith('Erweiterung fehlgeschlagen')) && <div style={{ marginTop: 4, color: '#fca5a5' }}>Straßendaten nicht verfügbar — bitte erneut versuchen</div>}
        </div>
      )}

      {/* Kontextmenü */}
      {editierbarAktiv && aktivMenu && !imZeichenModus && (
        <div style={{
          position: 'absolute',
          left: Math.min(aktivMenu.screenX - 50, window.innerWidth - 185),
          top: Math.max(aktivMenu.screenY - aktivMenu.aktionen.length * 46 - 10, 60),
          zIndex: 2000,
          backgroundColor: '#1a1a1a',
          border: '1px solid #374151',
          borderRadius: '10px',
          overflow: 'hidden',
          boxShadow: '0 8px 24px rgba(0,0,0,0.9)',
          minWidth: '170px',
        }}>
          {aktivMenu.aktionen.map((a, idx) => (
            <button key={idx}
              onPointerDown={(e) => { e.stopPropagation(); a.action() }}
              style={btnStyle(a.farbe, idx < aktivMenu.aktionen.length - 1)}>
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* Bearbeitungs-Banner */}
      {editierbarAktiv && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 rounded-lg shadow-lg"
          style={{
            backgroundColor: ziehStartId ? '#431407' : neuerHsStart ? '#1a1207' : '#111827',
            border: `1px solid ${ziehStartId ? '#f97316' : neuerHsStart ? '#fbbf24' : '#374151'}`,
            padding: '10px 16px',
            maxWidth: '92vw',
          }}>
          {ziehStartId ? (
            <p style={{ color: '#fed7aa', fontSize: 12, margin: 0 }}>
              🖊️ <b>Zeichenmodus</b> — Auf Karte tippen = neues Segment &nbsp;·&nbsp; Punkt antippen = verbinden &nbsp;·&nbsp; ESC
            </p>
          ) : neuerHsStart ? (
            <p style={{ color: '#fde68a', fontSize: 12, margin: 0 }}>
              🏠 <b>Hausanschluss zeichnen</b> — {neuerHsStart.name} &nbsp;·&nbsp; Ziel antippen (Trasse, Punkt oder Karte) &nbsp;·&nbsp; ESC
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <p style={{ color: '#d1d5db', fontSize: 12, margin: 0 }}>
                <span style={{ color: '#93c5fd', fontWeight: 600 }}>Trasse &amp; Hausanschluss</span>
              </p>
              <p style={{ color: '#9ca3af', fontSize: 11, margin: 0 }}>
                <b style={{ color: '#d1d5db' }}>Adresspunkt antippen</b> → Neuer Hausanschluss zeichnen
              </p>
              <p style={{ color: '#9ca3af', fontSize: 11, margin: 0 }}>
                <b style={{ color: '#d1d5db' }}>Trassenpunkt antippen</b> → Menü (Löschen / Neuer Strich)
              </p>
              <p style={{ color: '#9ca3af', fontSize: 11, margin: 0 }}>
                <b style={{ color: '#d1d5db' }}>Linie antippen</b> → Menü (Punkt einfügen / Löschen)
              </p>
              <p style={{ color: '#9ca3af', fontSize: 11, margin: 0 }}>
                <b style={{ color: '#d1d5db' }}>Punkt ziehen</b> → Position ändern
              </p>
              {deletedStack.length > 0 && (
                <button onClick={handleHsUndo}
                  style={{ alignSelf: 'flex-start', background: '#1e3a5f', color: '#93c5fd', border: '1px solid #3b82f6', borderRadius: '6px', padding: '4px 12px', cursor: 'pointer', fontSize: 11, marginTop: 2 }}>
                  ↩ Hausanschluss zurück ({deletedStack.length})
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
})

export default MapView

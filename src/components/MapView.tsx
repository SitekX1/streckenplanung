'use client'

import { memo, useEffect, useRef, useState } from 'react'
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Marker,
  Polyline,
  Tooltip,
  Popup,
  useMapEvents,
  useMap,
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
  iconSize: [20, 20],
  iconAnchor: [10, 10],
  popupAnchor: [0, -12],
})

const editHandleIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:12px;height:12px;background:#3b82f6;border:2px solid white;border-radius:50%;cursor:grab;box-shadow:0 0 0 1px rgba(59,130,246,0.4),0 2px 6px rgba(0,0,0,0.6)"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
})

// Aktiv-Handle: leuchtet orange wenn "Segment von hier zeichnen" aktiv ist
const editHandleAktivIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:16px;height:16px;background:#f97316;border:3px solid white;border-radius:50%;cursor:crosshair;box-shadow:0 0 0 3px rgba(249,115,22,0.6),0 2px 8px rgba(0,0,0,0.8)"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

// Hausanschluss-Handle: Haus-Ende (orange) + Kabel-Ende (lila)
const hsHausIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:11px;height:11px;background:#f97316;border:2px solid white;border-radius:50%;cursor:grab;box-shadow:0 2px 6px rgba(0,0,0,0.7)"></div>',
  iconSize: [11, 11],
  iconAnchor: [5, 5],
})
const hsTrasseIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:11px;height:11px;background:#a855f7;border:2px solid white;border-radius:50%;cursor:grab;box-shadow:0 2px 6px rgba(0,0,0,0.7)"></div>',
  iconSize: [11, 11],
  iconAnchor: [5, 5],
})

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
  aktiv,
  onKlick,
  ziehModus,
  onZiehZiel,
}: {
  aktiv: boolean
  onKlick: (p: LatLng) => void
  ziehModus?: boolean
  onZiehZiel?: (p: LatLng) => void
}) {
  useMapEvents({
    click(e) {
      const pos = { lat: e.latlng.lat, lng: e.latlng.lng }
      if (ziehModus && onZiehZiel) {
        onZiehZiel(pos)
      } else if (aktiv) {
        onKlick(pos)
      }
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
      layers: 'web',
      version: '1.1.1',
      format: 'image/png',
      transparent: false,
      attribution: '© Bundesamt für Kartographie und Geodäsie (BKG)',
      maxNativeZoom: 18,
      maxZoom: 21,
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

// Canvas-Layer für alle Trassenpfade — kein SVG-Overhead, WMS-Tiles bleiben stabil.
// opacity: 0.9 im View-Modus, 0.25 als Referenz während Edit-Modus
function TrasseNetzwerk({ pfade, farbe, opacity = 0.9 }: { pfade: LatLng[][]; farbe: string; opacity?: number }) {
  const map = useMap()
  useEffect(() => {
    const gueltige = pfade.filter((p) => p.length >= 2)
    if (gueltige.length === 0) return
    const renderer = L.canvas({ padding: 0.1 })
    const gruppe = L.layerGroup(
      gueltige.map((pfad) =>
        L.polyline(
          pfad.map((p) => [p.lat, p.lng] as [number, number]),
          { color: farbe, weight: 4, opacity, renderer } as L.PolylineOptions
        )
      )
    ).addTo(map)
    return () => { map.removeLayer(gruppe) }
  }, [pfade, farbe, opacity, map])
  return null
}

type TileVariante = 'satellit' | 'osm'

const MapView = memo(function MapView({
  adressen,
  startpunkt,
  startpunktSetzenAktiv,
  trasse,
  trassePfade,
  hausanschluesse,
  editierbarAktiv,
  aktiveOrteKeys,
  adressFarbe,
  trasseFarbe,
  hausanschlussfarbe,
  trasseMethode,
  onStartpunktGesetzt,
  onTrasseGeaendert,
  onTrassePfadeGeaendert,
  onHausanschluesseGeaendert,
}: MapViewProps) {
  const [tileVariante, setTileVariante] = useState<TileVariante>('satellit')
  const [topoSichtbar, setTopoSichtbar] = useState(false)
  const [ortsnamenSichtbar, setOrtsnamenSichtbar] = useState(true)
  const [suchQuery, setSuchQuery] = useState('')
  const [suchLaden, setSuchLaden] = useState(false)
  const [suchFehler, setSuchFehler] = useState(false)
  const [flugZiel, setFlugZiel] = useState<LatLng | null>(null)

  // Edit-State: 2D-Array pro Pfad — Änderungen werden erst beim Verlassen propagiert.
  // Das verhindert das Spider-Web: trassePfade in page.tsx bleibt während des Editierens intakt.
  const [editPfade, setEditPfade] = useState<LatLng[][]>([])
  const [editSingle, setEditSingle] = useState<LatLng[]>([])
  const [deletedStack, setDeletedStack] = useState<Hausstich[]>([])

  // Zeichenmodus: Handle anklicken → von dort neue Linie zeichnen
  const [ziehStartId, setZiehStartId] = useState<string | null>(null)
  const [ziehStartPos, setZiehStartPos] = useState<LatLng | null>(null)

  const trasseRef = useRef<LatLng[]>([])
  const trassePfadeRef = useRef<LatLng[][]>([])
  const editPfadeRef = useRef<LatLng[][]>([])
  const editSingleRef = useRef<LatLng[]>([])
  const prevEditRef = useRef(false)

  useEffect(() => { trasseRef.current = trasse }, [trasse])
  useEffect(() => { trassePfadeRef.current = trassePfade }, [trassePfade])
  useEffect(() => { editPfadeRef.current = editPfade }, [editPfade])
  useEffect(() => { editSingleRef.current = editSingle }, [editSingle])

  // Aktivierung: Handles aufbauen (2 pro MST-Pfad, max 250 für Einzel).
  // Deaktivierung: editierte Pfade propagieren — KEIN Aufruf während des Editierens.
  useEffect(() => {
    const wasActive = prevEditRef.current
    prevEditRef.current = editierbarAktiv

    if (!wasActive && editierbarAktiv) {
      const pfade = trassePfadeRef.current
      const t = trasseRef.current
      setDeletedStack([])

      if (pfade.length > 0) {
        const gueltig = pfade.filter((p) => p.length >= 2)
        // Alle Punkte zeigen wie Google Earth — maximal 2000 Handles gesamt
        const gesamtPunkte = gueltig.reduce((s, p) => s + p.length, 0)
        const maxProPfad = gesamtPunkte <= 2000
          ? Infinity
          : Math.max(3, Math.floor(2000 / gueltig.length))

        setEditPfade(gueltig.map((pfad) => {
          if (!isFinite(maxProPfad) || pfad.length <= maxProPfad) return [...pfad]
          const step = (pfad.length - 1) / (maxProPfad - 1)
          return Array.from({ length: maxProPfad }, (_, i) => pfad[Math.round(i * step)])
        }))
        setEditSingle([])
      } else if (t.length >= 2) {
        const max = 500
        setEditSingle(
          t.length <= max
            ? [...t]
            : t.filter((_, i) => i % Math.ceil(t.length / max) === 0 || i === t.length - 1)
        )
        setEditPfade([])
      }
    } else if (wasActive && !editierbarAktiv) {
      // Änderungen beim Verlassen des Edit-Modus propagieren
      const ep = editPfadeRef.current
      const es = editSingleRef.current
      if (ep.length > 0) {
        onTrassePfadeGeaendert(ep.filter((p) => p.length >= 2))
      } else if (es.length >= 2) {
        onTrasseGeaendert(es)
      }
      setEditPfade([])
      setEditSingle([])
      setDeletedStack([])
      setZiehStartId(null)
      setZiehStartPos(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editierbarAktiv])

  // ESC bricht den Zeichenmodus ab
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setZiehStartId(null); setZiehStartPos(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Handle anklicken: startet Zeichenmodus (oder bricht ihn ab wenn gleicher Handle nochmal)
  function handleStartZiehen(id: string, pos: LatLng) {
    if (ziehStartId === id) {
      setZiehStartId(null); setZiehStartPos(null)
    } else {
      setZiehStartId(id); setZiehStartPos(pos)
    }
  }

  // Karte angeklickt im Zeichenmodus: neues Segment von Start zu Ziel
  function handleZiehZiel(zielPos: LatLng) {
    if (!ziehStartPos) return
    setEditPfade((prev) => [...prev, [ziehStartPos, zielPos]])
    setZiehStartId(null)
    setZiehStartPos(null)
  }

  async function handleSuche() {
    const q = suchQuery.trim()
    if (!q) return
    setSuchLaden(true)
    setSuchFehler(false)
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=de`
      const res = await fetch(url, { headers: { 'Accept-Language': 'de' } })
      const data = await res.json()
      if (data.length > 0) {
        setFlugZiel({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) })
      } else {
        setSuchFehler(true)
      }
    } catch {
      setSuchFehler(true)
    } finally {
      setSuchLaden(false)
    }
  }

  // Handles für MST-Edit (pro Pfad)
  function handlePfadPunktBewegt(pfadIdx: number, punktIdx: number, pos: LatLng) {
    setEditPfade((prev) =>
      prev.map((pf, pi) => (pi === pfadIdx ? pf.map((p, i) => (i === punktIdx ? pos : p)) : pf))
    )
  }

  function handlePfadPunktLoeschen(pfadIdx: number, punktIdx: number) {
    setEditPfade((prev) =>
      prev.map((pf, pi) => {
        if (pi !== pfadIdx || pf.length <= 2) return pf
        return pf.filter((_, i) => i !== punktIdx)
      })
    )
  }

  function handlePfadPunktEinfuegen(pfadIdx: number, klickPos: LatLng) {
    setEditPfade((prev) =>
      prev.map((pf, pi) => {
        if (pi !== pfadIdx || pf.length < 2) return pf
        let bestIdx = 0
        let bestDist = Infinity
        for (let i = 0; i < pf.length - 1; i++) {
          const d =
            (klickPos.lat - (pf[i].lat + pf[i + 1].lat) / 2) ** 2 +
            (klickPos.lng - (pf[i].lng + pf[i + 1].lng) / 2) ** 2
          if (d < bestDist) { bestDist = d; bestIdx = i }
        }
        return [...pf.slice(0, bestIdx + 1), klickPos, ...pf.slice(bestIdx + 1)]
      })
    )
  }

  // Handles für Einzel-Edit
  function handleSinglePunktBewegt(i: number, pos: LatLng) {
    setEditSingle((prev) => prev.map((p, idx) => (idx === i ? pos : p)))
  }

  function handleSinglePunktLoeschen(i: number) {
    setEditSingle((prev) => {
      if (prev.length <= 2) return prev
      return prev.filter((_, idx) => idx !== i)
    })
  }

  function handleSinglePunktEinfuegen(klickPos: LatLng) {
    if (editSingle.length < 2) return
    try {
      const line = turf.lineString(editSingle.map((p) => [p.lng, p.lat]))
      const nearest = turf.nearestPointOnLine(line, turf.point([klickPos.lng, klickPos.lat]))
      const idx = (nearest.properties.index ?? 0) as number
      setEditSingle((prev) => {
        const updated = [...prev]
        updated.splice(idx + 1, 0, klickPos)
        return updated
      })
    } catch { /* ignore */ }
  }

  function handleHausstichLoeschen(id: string) {
    const deleted = hausanschluesse.find((h) => h.id === id)
    if (deleted) setDeletedStack((prev) => [...prev, deleted].slice(-10))
    onHausanschluesseGeaendert(hausanschluesse.filter((h) => h.id !== id))
  }

  function handleHausstichUndo() {
    if (deletedStack.length === 0) return
    const last = deletedStack[deletedStack.length - 1]
    setDeletedStack((prev) => prev.slice(0, -1))
    onHausanschluesseGeaendert([...hausanschluesse, last])
  }

  function handleHausstichEndpunktBewegen(id: string, typ: 'haus' | 'trasse', neuePos: LatLng) {
    const updated = hausanschluesse.map((h) => {
      if (h.id !== id) return h
      const haus = typ === 'haus' ? neuePos : h.hausKoordinate
      const trasse = typ === 'trasse' ? neuePos : h.trassenPunkt
      const dLat = (haus.lat - trasse.lat) * 111_000
      const dLng = (haus.lng - trasse.lng) * Math.cos((haus.lat * Math.PI) / 180) * 111_000
      return { ...h, hausKoordinate: haus, trassenPunkt: trasse, wegpunkte: [haus, trasse], laengeMeter: Math.sqrt(dLat * dLat + dLng * dLng) }
    })
    onHausanschluesseGeaendert(updated)
  }

  return (
    <div className="relative w-full h-full">
      {/* Ortssuche */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-1000 flex gap-2 items-center">
        <input
          type="text"
          value={suchQuery}
          onChange={(e) => { setSuchQuery(e.target.value); setSuchFehler(false) }}
          onKeyDown={(e) => e.key === 'Enter' && handleSuche()}
          placeholder="Ort oder Adresse suchen…"
          className="w-56 px-3 py-1.5 rounded-lg text-xs outline-none shadow-lg"
          style={{ backgroundColor: '#1a1a1a', color: '#f9fafb', border: `1px solid ${suchFehler ? '#ef4444' : '#374151'}` }}
        />
        <button
          onClick={handleSuche}
          disabled={suchLaden}
          className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg transition-colors disabled:opacity-50"
          style={{ backgroundColor: '#3b82f6', color: '#fff', border: 'none' }}
        >
          {suchLaden ? '…' : '🔍'}
        </button>
        {suchFehler && <span className="text-xs" style={{ color: '#ef4444' }}>Nicht gefunden</span>}
      </div>

      {/* Layer-Buttons */}
      <div className="absolute top-3 right-3 z-1000 flex flex-col gap-2">
        <button
          onClick={() => setTileVariante((v) => (v === 'satellit' ? 'osm' : 'satellit'))}
          className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg"
          style={{ backgroundColor: '#1a1a1a', color: '#f9fafb', border: '1px solid #374151' }}
        >
          {tileVariante === 'satellit' ? '🗺️ Karte' : '🛰️ Satellit'}
        </button>
        <button
          onClick={() => setTopoSichtbar((v) => !v)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg"
          style={{ backgroundColor: topoSichtbar ? '#1e3a5f' : '#1a1a1a', color: '#f9fafb', border: `1px solid ${topoSichtbar ? '#3b82f6' : '#374151'}` }}
        >
          📐 Topokarte
        </button>
        <button
          onClick={() => setOrtsnamenSichtbar((v) => !v)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg"
          style={{ backgroundColor: ortsnamenSichtbar ? '#1e3a5f' : '#1a1a1a', color: '#f9fafb', border: `1px solid ${ortsnamenSichtbar ? '#3b82f6' : '#374151'}` }}
        >
          🏷️ Ortsnamen
        </button>
      </div>

      <MapContainer
        center={[51.1657, 10.4515]}
        zoom={6}
        style={{ height: '100%', width: '100%' }}
        className={startpunktSetzenAktiv || ziehStartId ? 'cursor-crosshair' : ''}
      >
        {tileVariante === 'satellit' ? (
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="© Esri"
            maxNativeZoom={19}
            maxZoom={21}
          />
        ) : (
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            maxNativeZoom={19}
            maxZoom={21}
          />
        )}

        {ortsnamenSichtbar && (
          <TileLayer
            url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
            attribution="© Esri"
            maxNativeZoom={19}
            maxZoom={21}
            opacity={1}
          />
        )}

        <KlickHandler
          aktiv={startpunktSetzenAktiv}
          onKlick={onStartpunktGesetzt}
          ziehModus={!!ziehStartId}
          onZiehZiel={handleZiehZiel}
        />
        <AutoZoom adressen={adressen} />
        <TopographieWMS sichtbar={topoSichtbar} />
        <FlyTo ziel={flugZiel} />

        {/* Adressen */}
        {adressen.map((adresse) => {
          const istAktiv =
            aktiveOrteKeys.length === 0 ||
            aktiveOrteKeys.includes(`${adresse.plz}_${adresse.ortsname}_${adresse.ortsteil}`)
          return (
            <CircleMarker
              key={adresse.uuid}
              center={[adresse.lat, adresse.lon]}
              radius={istAktiv ? 6 : 4}
              pathOptions={{
                fillColor: istAktiv ? adressFarbe : '#6b7280',
                color: istAktiv ? adressFarbe : '#4b5563',
                weight: 1.5,
                fillOpacity: istAktiv ? 0.85 : 0.3,
              }}
            >
              <Tooltip>{adresse.strasse} {adresse.nr}{adresse.nr_zusatz ? ` ${adresse.nr_zusatz}` : ''}, {adresse.ortsname}</Tooltip>
              <Popup>
                <div className="text-sm">
                  <p className="font-semibold">{adresse.strasse} {adresse.nr}{adresse.nr_zusatz ? ` ${adresse.nr_zusatz}` : ''}</p>
                  <p>{adresse.plz} {adresse.ortsname}</p>
                  {adresse.ortsteil && <p className="text-gray-500">{adresse.ortsteil}</p>}
                  <p className="mt-1 text-blue-600">Haushalte: {adresse.hh}</p>
                </div>
              </Popup>
            </CircleMarker>
          )
        })}

        {/* Startpunkt */}
        {startpunkt && (
          <Marker position={[startpunkt.lat, startpunkt.lng]} icon={startpunktIcon}>
            <Tooltip>Startpunkt</Tooltip>
          </Marker>
        )}

        {/* Trasse: View-Modus voll sichtbar, Edit-Modus gedimmt als Referenz */}
        {trassePfade.length > 0 && (
          <TrasseNetzwerk pfade={trassePfade} farbe={trasseFarbe} opacity={editierbarAktiv ? 0.25 : 0.9} />
        )}

        {/* Einzel-Polylinie (nur View-Modus, kein MST) */}
        {!editierbarAktiv && trassePfade.length === 0 && trasse.length >= 2 && (
          <Polyline
            positions={trasse.map((p) => [p.lat, p.lng] as [number, number])}
            pathOptions={{ color: trasseFarbe, weight: 4, opacity: 0.9 }}
          />
        )}

        {/* Edit-Modus: MST-Polylinien (klickbar zum Einfügen, außer im Zeichenmodus) */}
        {editierbarAktiv && editPfade.length > 0 && editPfade.map((pfad, pi) =>
          pfad.length >= 2 ? (
            <Polyline
              key={`ep-${pi}`}
              positions={pfad.map((p) => [p.lat, p.lng] as [number, number])}
              pathOptions={{ color: trasseFarbe, weight: 5, opacity: 0.9 }}
              eventHandlers={{
                click: (e) => {
                  if (ziehStartId) return // Zeichenmodus hat Vorrang
                  e.originalEvent.stopPropagation()
                  handlePfadPunktEinfuegen(pi, { lat: e.latlng.lat, lng: e.latlng.lng })
                },
              }}
            />
          ) : null
        )}

        {/* Edit-Modus: Einzel-Polylinie (klickbar) */}
        {editierbarAktiv && editSingle.length >= 2 && (
          <Polyline
            positions={editSingle.map((p) => [p.lat, p.lng] as [number, number])}
            pathOptions={{ color: trasseFarbe, weight: 5, opacity: 0.9 }}
            eventHandlers={{
              click: (e) => {
                if (ziehStartId) return
                e.originalEvent.stopPropagation()
                handleSinglePunktEinfuegen({ lat: e.latlng.lat, lng: e.latlng.lng })
              },
            }}
          />
        )}

        {/* Edit-Handles: MST-Modus (pro Pfad) */}
        {editierbarAktiv && editPfade.length > 0 && editPfade.flatMap((pfad, pi) =>
          pfad.map((p, i) => {
            const hid = `ep-${pi}-${i}`
            const istAktiv = ziehStartId === hid
            return (
              <Marker
                key={`ep-h-${pi}-${i}`}
                position={[p.lat, p.lng]}
                draggable={!ziehStartId}
                icon={istAktiv ? editHandleAktivIcon : editHandleIcon}
                eventHandlers={{
                  click: (e) => {
                    if (e.originalEvent) e.originalEvent.stopPropagation()
                    handleStartZiehen(hid, p)
                  },
                  dragend: (e) => {
                    const ll = (e.target as L.Marker).getLatLng()
                    handlePfadPunktBewegt(pi, i, { lat: ll.lat, lng: ll.lng })
                  },
                  dblclick: (e) => {
                    if (e.originalEvent) e.originalEvent.stopPropagation()
                    handlePfadPunktLoeschen(pi, i)
                  },
                }}
              >
                {istAktiv && <Tooltip permanent>Klick auf Karte → neues Segment · ESC = Abbrechen</Tooltip>}
              </Marker>
            )
          })
        )}

        {/* Edit-Handles: Einzel-Modus */}
        {editierbarAktiv && editSingle.length > 0 && editSingle.map((p, i) => {
          const hid = `es-${i}`
          const istAktiv = ziehStartId === hid
          return (
            <Marker
              key={`es-h-${i}`}
              position={[p.lat, p.lng]}
              draggable={!ziehStartId}
              icon={istAktiv ? editHandleAktivIcon : editHandleIcon}
              eventHandlers={{
                click: (e) => {
                  if (e.originalEvent) e.originalEvent.stopPropagation()
                  handleStartZiehen(hid, p)
                },
                dragend: (e) => {
                  const ll = (e.target as L.Marker).getLatLng()
                  handleSinglePunktBewegt(i, { lat: ll.lat, lng: ll.lng })
                },
                dblclick: (e) => {
                  if (e.originalEvent) e.originalEvent.stopPropagation()
                  handleSinglePunktLoeschen(i)
                },
              }}
            >
              {istAktiv && <Tooltip permanent>Klick auf Karte → neues Segment · ESC = Abbrechen</Tooltip>}
            </Marker>
          )
        })}

        {/* Hausanschlüsse */}
        {hausanschluesse.map((h) => {
          const pts =
            h.wegpunkte && h.wegpunkte.length >= 2
              ? h.wegpunkte.map((p) => [p.lat, p.lng] as [number, number])
              : [[h.trassenPunkt.lat, h.trassenPunkt.lng] as [number, number], [h.hausKoordinate.lat, h.hausKoordinate.lng] as [number, number]]

          return (
            <Polyline
              key={h.id}
              positions={pts}
              pathOptions={{ color: hausanschlussfarbe, weight: editierbarAktiv ? 3 : 2, opacity: editierbarAktiv ? 1 : 0.8 }}
              eventHandlers={
                editierbarAktiv
                  ? { dblclick: (e) => { e.originalEvent.stopPropagation(); handleHausstichLoeschen(h.id) } }
                  : {}
              }
            >
              <Tooltip>{editierbarAktiv ? '🗑️ Doppelklick = Löschen · ' : ''}Hausanschluss: {h.laengeMeter.toFixed(1)} m</Tooltip>
            </Polyline>
          )
        })}

        {/* Hausanschluss-Handles im Edit-Modus: orange = Haus, lila = Kabelpunkt */}
        {editierbarAktiv && hausanschluesse.flatMap((h) => [
          <Marker
            key={`hs-haus-${h.id}`}
            position={[h.hausKoordinate.lat, h.hausKoordinate.lng]}
            draggable={true}
            icon={hsHausIcon}
            eventHandlers={{
              dragend: (e) => {
                const ll = (e.target as L.Marker).getLatLng()
                handleHausstichEndpunktBewegen(h.id, 'haus', { lat: ll.lat, lng: ll.lng })
              },
            }}
          >
            <Tooltip>🏠 Haus-Ende ziehen</Tooltip>
          </Marker>,
          <Marker
            key={`hs-trasse-${h.id}`}
            position={[h.trassenPunkt.lat, h.trassenPunkt.lng]}
            draggable={true}
            icon={hsTrasseIcon}
            eventHandlers={{
              dragend: (e) => {
                const ll = (e.target as L.Marker).getLatLng()
                handleHausstichEndpunktBewegen(h.id, 'trasse', { lat: ll.lat, lng: ll.lng })
              },
            }}
          >
            <Tooltip>📡 Kabel-Anschlusspunkt ziehen</Tooltip>
          </Marker>,
        ])}
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
            color: trasseMethode.startsWith('OSM') ? '#4ade80' : trasseMethode.startsWith('Fehler') ? '#f87171' : '#fbbf24',
            border: `1px solid ${trasseMethode.startsWith('OSM') ? '#16a34a' : trasseMethode.startsWith('Fehler') ? '#dc2626' : '#d97706'}`,
          }}>
          {trasseMethode.startsWith('OSM') ? '✅' : trasseMethode.startsWith('Fehler') ? '❌' : '⚠️'} {trasseMethode}
          {trasseMethode.startsWith('Fehler') && <div style={{ marginTop: 4, color: '#fca5a5' }}>Straßendaten nicht verfügbar — bitte erneut versuchen</div>}
        </div>
      )}

      {editierbarAktiv && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 px-4 py-2 rounded-lg text-xs shadow-lg flex items-center gap-3"
          style={{ backgroundColor: ziehStartId ? '#431407' : '#1e3a5f', color: ziehStartId ? '#fed7aa' : '#93c5fd', border: `1px solid ${ziehStartId ? '#f97316' : '#3b82f6'}` }}>
          {ziehStartId
            ? '🖊️ Zeichenmodus: Klick auf Karte → neues Segment von diesem Punkt · ESC = Abbrechen'
            : <>
                ✏️ Punkte ziehen · Klick auf Linie = Punkt einfügen · Doppelklick auf Punkt = löschen · <b>Klick auf Punkt = neues Segment zeichnen</b>
                &nbsp;|&nbsp;
                🏠 <span style={{color:'#fb923c'}}>●</span> Haus · <span style={{color:'#c084fc'}}>●</span> Kabel ziehen · Doppelklick Linie = löschen
              </>
          }
          {!ziehStartId && deletedStack.length > 0 && (
            <button
              onClick={handleHausstichUndo}
              style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '6px', padding: '3px 10px', cursor: 'pointer', fontSize: '11px', whiteSpace: 'nowrap' }}
            >
              ↩ Rückgängig ({deletedStack.length})
            </button>
          )}
        </div>
      )}
    </div>
  )
})

export default MapView

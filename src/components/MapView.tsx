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

// Leaflet Icons für Next.js reparieren
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// DivIcon statt externer URL — keine CDN-Abhängigkeit, immer sichtbar auf jeder Kartenebene
const startpunktIcon = new L.DivIcon({
  className: '',
  html: `<div style="
    width:20px;height:20px;
    background:#ef4444;
    border:3px solid white;
    border-radius:50%;
    box-shadow:0 0 0 2px rgba(239,68,68,0.6),0 3px 12px rgba(0,0,0,0.9);
  "></div>`,
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
  onStartpunktGesetzt: (punkt: LatLng) => void
  onTrasseGeaendert: (punkte: LatLng[]) => void
  onHausanschluesseGeaendert: (updated: Hausstich[]) => void
}

function KlickHandler({
  aktiv,
  onKlick,
}: {
  aktiv: boolean
  onKlick: (p: LatLng) => void
}) {
  useMapEvents({
    click(e) {
      if (aktiv) {
        onKlick({ lat: e.latlng.lat, lng: e.latlng.lng })
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
    return () => {
      map.removeLayer(wmsLayer)
    }
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

// Rendert das MST-Netzwerk imperativ als Canvas-Layer — ein einziges Canvas-Element
// für alle 645 Pfade statt 645 SVG-Polylines. Verhindert SVG-Overhead, der sonst
// den Browser-Renderer blockiert und WMS-Tiles am Laden hindert.
function TrasseNetzwerk({ pfade, farbe }: { pfade: LatLng[][]; farbe: string }) {
  const map = useMap()

  useEffect(() => {
    const gueltige = pfade.filter((p) => p.length >= 2)
    if (gueltige.length === 0) return
    const renderer = L.canvas({ padding: 0.1 })
    const gruppe = L.layerGroup(
      gueltige.map((pfad) =>
        L.polyline(
          pfad.map((p) => [p.lat, p.lng] as [number, number]),
          { color: farbe, weight: 4, opacity: 0.9, renderer } as L.PolylineOptions
        )
      )
    ).addTo(map)
    return () => { map.removeLayer(gruppe) }
  }, [pfade, farbe, map])

  return null
}

type TileVariante = 'satellit' | 'osm'

// React.memo prevents MapView from re-rendering during Trasse generation
// progress updates — only re-renders when actual map data (props) changes.
// This is the primary fix for WMS tile disruption during Trasse generation.
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
  onStartpunktGesetzt,
  onTrasseGeaendert,
  onHausanschluesseGeaendert,
}: MapViewProps) {
  const [tileVariante, setTileVariante] = useState<TileVariante>('satellit')
  const [topoSichtbar, setTopoSichtbar] = useState(false)
  const [ortsnamenSichtbar, setOrtsnamenSichtbar] = useState(true)
  const [suchQuery, setSuchQuery] = useState('')
  const [suchLaden, setSuchLaden] = useState(false)
  const [suchFehler, setSuchFehler] = useState(false)
  const [flugZiel, setFlugZiel] = useState<LatLng | null>(null)

  // Edit state
  const [editTrasse, setEditTrasse] = useState<LatLng[]>([])
  // Startindizes der einzelnen Pfade im flachen editTrasse-Array (für MST-Modus)
  const [editBoundaries, setEditBoundaries] = useState<number[]>([])
  // Undo-Stack für versehentlich gelöschte Hausanschlüsse (max. 10)
  const [deletedStack, setDeletedStack] = useState<Hausstich[]>([])
  const trasseRef = useRef<LatLng[]>([])
  const trassePfadeRef = useRef<LatLng[][]>([])

  useEffect(() => { trasseRef.current = trasse }, [trasse])
  useEffect(() => { trassePfadeRef.current = trassePfade }, [trassePfade])

  // Baut editTrasse wenn Edit-Modus aktiviert wird.
  // MST-Modus: jeden Pfad separat sampeln + Grenzen merken, damit die Polylinien
  // im Edit-Modus pro Pfad gezeichnet werden und keine Sprung-Diagonalen entstehen.
  // Einzel-Polylinie: gleichmäßige Dezimierung auf max. 250 Handles.
  useEffect(() => {
    if (!editierbarAktiv) {
      setEditTrasse([])
      setEditBoundaries([])
      setDeletedStack([])
      return
    }

    const pfade = trassePfadeRef.current
    const t = trasseRef.current

    if (pfade.length > 0) {
      // MST-Modus: jeden Pfad separat auf max. 4 Handles sampeln
      const MAX_PRO_PFAD = 4
      const points: LatLng[] = []
      const boundaries: number[] = []
      for (const pfad of pfade) {
        if (pfad.length < 2) continue
        boundaries.push(points.length)
        if (pfad.length <= MAX_PRO_PFAD) {
          points.push(...pfad)
        } else {
          const step = Math.ceil(pfad.length / MAX_PRO_PFAD)
          points.push(...pfad.filter((_, i) => i % step === 0 || i === pfad.length - 1))
        }
      }
      setEditTrasse(points)
      setEditBoundaries(boundaries)
    } else {
      // Einzel-Polylinie: gleichmäßig auf max. 250 Handles dezimieren
      if (t.length === 0) return
      setEditBoundaries([])
      if (t.length <= 250) {
        setEditTrasse([...t])
      } else {
        const step = Math.ceil(t.length / 250)
        setEditTrasse(t.filter((_, i) => i % step === 0 || i === t.length - 1))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editierbarAktiv])

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

  // In view mode, show full trasse (accurate to OSRM geometry).
  // In edit mode, show the downsampled editTrasse (250 draggable handles).
  const trasseAnzeige = editierbarAktiv && editTrasse.length >= 2 ? editTrasse : trasse
  const trasseLeaflet = trasseAnzeige.map((p) => [p.lat, p.lng] as [number, number])

  function handleTrassePunktBewegt(i: number, neu: LatLng) {
    const updated = [...editTrasse]
    updated[i] = neu
    setEditTrasse(updated)
    onTrasseGeaendert(updated)
  }

  function handleTrassePunktLoeschen(i: number) {
    if (editTrasse.length <= 2) return
    const updated = editTrasse.filter((_, idx) => idx !== i)
    setEditTrasse(updated)
    onTrasseGeaendert(updated)
  }

  function handleTrassePunktEinfuegen(klickPos: LatLng) {
    if (editTrasse.length < 2) return
    try {
      const line = turf.lineString(editTrasse.map((p) => [p.lng, p.lat]))
      const nearest = turf.nearestPointOnLine(line, turf.point([klickPos.lng, klickPos.lat]))
      const idx = (nearest.properties.index ?? 0) as number
      const updated = [...editTrasse]
      updated.splice(idx + 1, 0, klickPos)
      setEditTrasse(updated)
      onTrasseGeaendert(updated)
    } catch {
      // ignore
    }
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
          style={{
            backgroundColor: '#1a1a1a',
            color: '#f9fafb',
            border: `1px solid ${suchFehler ? '#ef4444' : '#374151'}`,
          }}
        />
        <button
          onClick={handleSuche}
          disabled={suchLaden}
          className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg transition-colors disabled:opacity-50"
          style={{ backgroundColor: '#3b82f6', color: '#fff', border: 'none' }}
        >
          {suchLaden ? '…' : '🔍'}
        </button>
        {suchFehler && (
          <span className="text-xs" style={{ color: '#ef4444' }}>Nicht gefunden</span>
        )}
      </div>

      {/* Layer-Toggle Buttons */}
      <div className="absolute top-3 right-3 z-1000 flex flex-col gap-2">
        <button
          onClick={() => setTileVariante((v) => (v === 'satellit' ? 'osm' : 'satellit'))}
          className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg transition-colors"
          style={{ backgroundColor: '#1a1a1a', color: '#f9fafb', border: '1px solid #374151' }}
        >
          {tileVariante === 'satellit' ? '🗺️ Karte' : '🛰️ Satellit'}
        </button>
        <button
          onClick={() => setTopoSichtbar((v) => !v)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg transition-colors"
          style={{
            backgroundColor: topoSichtbar ? '#1e3a5f' : '#1a1a1a',
            color: '#f9fafb',
            border: `1px solid ${topoSichtbar ? '#3b82f6' : '#374151'}`,
          }}
        >
          📐 Topokarte
        </button>
        <button
          onClick={() => setOrtsnamenSichtbar((v) => !v)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg transition-colors"
          style={{
            backgroundColor: ortsnamenSichtbar ? '#1e3a5f' : '#1a1a1a',
            color: '#f9fafb',
            border: `1px solid ${ortsnamenSichtbar ? '#3b82f6' : '#374151'}`,
          }}
        >
          🏷️ Ortsnamen
        </button>
      </div>

      <MapContainer
        center={[51.1657, 10.4515]}
        zoom={6}
        style={{ height: '100%', width: '100%' }}
        className={startpunktSetzenAktiv ? 'cursor-crosshair' : ''}
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

        {/* Ortsnamen-Overlay */}
        {ortsnamenSichtbar && (
          <TileLayer
            url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
            attribution="© Esri"
            maxNativeZoom={19}
            maxZoom={21}
            opacity={1}
          />
        )}

        <KlickHandler aktiv={startpunktSetzenAktiv} onKlick={onStartpunktGesetzt} />
        <AutoZoom adressen={adressen} />
        <TopographieWMS sichtbar={topoSichtbar} />
        <FlyTo ziel={flugZiel} />

        {/* Adressen-Pins */}
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
            <Tooltip>
              {adresse.strasse} {adresse.nr}
              {adresse.nr_zusatz ? ` ${adresse.nr_zusatz}` : ''}, {adresse.ortsname}
            </Tooltip>
            <Popup>
              <div className="text-sm">
                <p className="font-semibold">
                  {adresse.strasse} {adresse.nr}
                  {adresse.nr_zusatz ? ` ${adresse.nr_zusatz}` : ''}
                </p>
                <p>{adresse.plz} {adresse.ortsname}</p>
                {adresse.ortsteil && <p className="text-gray-500">{adresse.ortsteil}</p>}
                <p className="mt-1 text-blue-600">Haushalte: {adresse.hh}</p>
              </div>
            </Popup>
          </CircleMarker>
          )
        })}

        {/* Startpunkt-Marker */}
        {startpunkt && (
          <Marker position={[startpunkt.lat, startpunkt.lng]} icon={startpunktIcon}>
            <Tooltip>Startpunkt</Tooltip>
          </Marker>
        )}

        {/* Trasse */}
        {!editierbarAktiv && trassePfade.length > 0
          // View-Modus: MST-Netzwerk als Canvas-Layer (kein SVG-Overhead → WMS bleibt stabil)
          ? <TrasseNetzwerk pfade={trassePfade} farbe={trasseFarbe} />
          : editierbarAktiv && editBoundaries.length > 0
          // Edit-Modus MST: jeden Pfad als eigene Polylinie → keine Sprung-Diagonalen
          ? editBoundaries.map((start, i) => {
              const end = editBoundaries[i + 1] ?? editTrasse.length
              const pts = editTrasse.slice(start, end).map((p) => [p.lat, p.lng] as [number, number])
              if (pts.length < 2) return null
              return (
                <Polyline
                  key={`ep-${i}`}
                  positions={pts}
                  pathOptions={{ color: trasseFarbe, weight: 5, opacity: 0.9 }}
                />
              )
            })
          // Edit-Modus Einzel-Polylinie (oder View-Modus ohne trassePfade)
          : trasseLeaflet.length >= 2 && (
              <Polyline
                positions={trasseLeaflet}
                pathOptions={{
                  color: trasseFarbe,
                  weight: editierbarAktiv ? 5 : 4,
                  opacity: 0.9,
                }}
                eventHandlers={
                  editierbarAktiv
                    ? {
                        click: (e) => {
                          e.originalEvent.stopPropagation()
                          handleTrassePunktEinfuegen({ lat: e.latlng.lat, lng: e.latlng.lng })
                        },
                      }
                    : {}
                }
              />
            )}

        {/* Edit-Handles für Trasse (nur im Bearbeiten-Modus) */}
        {editierbarAktiv &&
          editTrasse.map((p, i) => (
            <Marker
              key={`edit-${i}`}
              position={[p.lat, p.lng]}
              draggable={true}
              icon={editHandleIcon}
              eventHandlers={{
                dragend: (e) => {
                  const ll = (e.target as L.Marker).getLatLng()
                  handleTrassePunktBewegt(i, { lat: ll.lat, lng: ll.lng })
                },
                dblclick: (e) => {
                  if (e.originalEvent) e.originalEvent.stopPropagation()
                  handleTrassePunktLoeschen(i)
                },
              }}
            />
          ))}

        {/* Hausanschlüsse */}
        {hausanschluesse.map((h) => {
          const pts =
            h.wegpunkte && h.wegpunkte.length >= 2
              ? h.wegpunkte.map((p) => [p.lat, p.lng] as [number, number])
              : [
                  [h.trassenPunkt.lat, h.trassenPunkt.lng] as [number, number],
                  [h.hausKoordinate.lat, h.hausKoordinate.lng] as [number, number],
                ]

          return (
            <Polyline
              key={h.id}
              positions={pts}
              pathOptions={{
                color: hausanschlussfarbe,
                weight: editierbarAktiv ? 3 : 2,
                opacity: editierbarAktiv ? 1 : 0.8,
              }}
              eventHandlers={
                editierbarAktiv
                  ? {
                      dblclick: (e) => {
                        e.originalEvent.stopPropagation()
                        handleHausstichLoeschen(h.id)
                      },
                    }
                  : {}
              }
            >
              <Tooltip>
                {editierbarAktiv ? '🗑️ Doppelklick zum Löschen · ' : ''}
                Hausanschluss: {h.laengeMeter.toFixed(1)} m
              </Tooltip>
            </Polyline>
          )
        })}
      </MapContainer>

      {/* Hinweis wenn Startpunkt-Modus aktiv */}
      {startpunktSetzenAktiv && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 px-4 py-2 rounded-lg text-sm font-medium shadow-lg"
          style={{ backgroundColor: '#1a1a1a', color: '#f9fafb', border: '1px solid #3b82f6' }}
        >
          Klick auf die Karte, um den Startpunkt zu setzen
        </div>
      )}

      {/* Hinweis wenn Bearbeiten-Modus aktiv */}
      {editierbarAktiv && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 px-4 py-2 rounded-lg text-xs shadow-lg flex items-center gap-3"
          style={{ backgroundColor: '#1e3a5f', color: '#93c5fd', border: '1px solid #3b82f6' }}
        >
          ✏️ Bearbeiten · Punkte ziehen · Klick auf Trasse fügt Punkt ein · Doppelklick auf Punkt löscht · Doppelklick auf Hausanschluss löscht
          {deletedStack.length > 0 && (
            <button
              onClick={handleHausstichUndo}
              style={{
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '3px 10px',
                cursor: 'pointer',
                fontSize: '11px',
                whiteSpace: 'nowrap',
              }}
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

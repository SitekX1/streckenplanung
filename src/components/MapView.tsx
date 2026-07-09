'use client'

import { useEffect, useRef, useState } from 'react'
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

const startpunktIcon = new L.Icon({
  iconUrl:
    'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
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
      updateWhenZooming: false,
      keepBuffer: 4,
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

type TileVariante = 'satellit' | 'osm'

export default function MapView({
  adressen,
  startpunkt,
  startpunktSetzenAktiv,
  trasse,
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

  // Edit state: simplified trasse for drag handles
  const [editTrasse, setEditTrasse] = useState<LatLng[]>([])
  const trasseRef = useRef<LatLng[]>([])

  // Keep ref current
  useEffect(() => {
    trasseRef.current = trasse
  }, [trasse])

  // Initialize editTrasse only when edit mode is toggled ON
  useEffect(() => {
    if (!editierbarAktiv) {
      setEditTrasse([])
      return
    }
    const t = trasseRef.current
    if (t.length === 0) return

    try {
      const line = turf.lineString(t.map((p) => [p.lng, p.lat]))
      // Higher tolerance to avoid dense overlapping handles on back-and-forth segments
      const simplified = turf.simplify(line, { tolerance: 0.0005, highQuality: false })
      let pts = (simplified.geometry.coordinates as [number, number][]).map((c) => ({
        lat: c[1],
        lng: c[0],
      }))
      // Cap at 250 handles so edit mode stays usable
      if (pts.length > 250) {
        const step = Math.ceil(pts.length / 250)
        pts = pts.filter((_, i) => i % step === 0 || i === pts.length - 1)
      }
      setEditTrasse(pts)
    } catch {
      setEditTrasse(t.slice(0, 250))
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

  // Which points to show in the Polyline: edit handles when active, full trasse otherwise
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
    onHausanschluesseGeaendert(hausanschluesse.filter((h) => h.id !== id))
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
        {trasseLeaflet.length >= 2 && (
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
                      click: (e) => {
                        e.originalEvent.stopPropagation()
                        handleHausstichLoeschen(h.id)
                      },
                    }
                  : {}
              }
            >
              <Tooltip>
                {editierbarAktiv ? '🗑️ Klicken zum Löschen · ' : ''}
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
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 px-4 py-2 rounded-lg text-xs shadow-lg"
          style={{ backgroundColor: '#1e3a5f', color: '#93c5fd', border: '1px solid #3b82f6' }}
        >
          ✏️ Bearbeiten · Punkte ziehen · Klick auf Trasse fügt Punkt ein · Doppelklick auf Punkt löscht
        </div>
      )}
    </div>
  )
}

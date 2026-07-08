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

interface MapViewProps {
  adressen: Address[]
  startpunkt: LatLng | null
  startpunktSetzenAktiv: boolean
  trasse: LatLng[]
  hausanschluesse: Hausstich[]
  editierbarAktiv: boolean
  onStartpunktGesetzt: (punkt: LatLng) => void
  onTrasseGeaendert: (punkte: LatLng[]) => void
}

// Hilfkomponente: reagiert auf Klicks zur Startpunkt-Setzung
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

// Hilfkomponente: zoomt automatisch auf Adressen nach Import
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

// BKG TopPlusOpen Topographiekarte als WMS-Overlay
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
    })
    wmsLayer.addTo(map)
    return () => {
      map.removeLayer(wmsLayer)
    }
  }, [map, sichtbar])

  return null
}

// Hilfkomponente: fliegt zu einer Position wenn flugZiel gesetzt wird
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
  onStartpunktGesetzt,
  onTrasseGeaendert,
}: MapViewProps) {
  const [tileVariante, setTileVariante] = useState<TileVariante>('satellit')
  const [topoSichtbar, setTopoSichtbar] = useState(false)
  const [suchQuery, setSuchQuery] = useState('')
  const [suchLaden, setSuchLaden] = useState(false)
  const [suchFehler, setSuchFehler] = useState(false)
  const [flugZiel, setFlugZiel] = useState<LatLng | null>(null)

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

  const trasseLeaflet = trasse.map((p) => [p.lat, p.lng] as [number, number])

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
          style={{
            backgroundColor: '#1a1a1a',
            color: '#f9fafb',
            border: '1px solid #374151',
          }}
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

        <KlickHandler aktiv={startpunktSetzenAktiv} onKlick={onStartpunktGesetzt} />
        <AutoZoom adressen={adressen} />
        <TopographieWMS sichtbar={topoSichtbar} />
        <FlyTo ziel={flugZiel} />

        {/* Adressen-Pins */}
        {adressen.map((adresse) => (
          <CircleMarker
            key={adresse.uuid}
            center={[adresse.lat, adresse.lon]}
            radius={6}
            pathOptions={{
              fillColor: '#22c55e',
              color: '#16a34a',
              weight: 1.5,
              fillOpacity: 0.85,
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
                <p>
                  {adresse.plz} {adresse.ortsname}
                </p>
                {adresse.ortsteil && <p className="text-gray-500">{adresse.ortsteil}</p>}
                <p className="mt-1 text-blue-600">Haushalte: {adresse.hh}</p>
              </div>
            </Popup>
          </CircleMarker>
        ))}

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
              color: '#3b82f6',
              weight: 4,
              opacity: 0.9,
            }}
          />
        )}

        {/* Hausanschlüsse */}
        {hausanschluesse.map((h) => (
          <Polyline
            key={h.id}
            positions={[
              [h.trassenPunkt.lat, h.trassenPunkt.lng],
              [h.hausKoordinate.lat, h.hausKoordinate.lng],
            ]}
            pathOptions={{
              color: '#ef4444',
              weight: 2,
              opacity: 0.8,
            }}
          >
            <Tooltip>
              Hausanschluss: {h.laengeMeter.toFixed(1)} m
            </Tooltip>
          </Polyline>
        ))}
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
    </div>
  )
}

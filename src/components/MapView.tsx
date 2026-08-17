'use client'

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MapContainer, TileLayer, CircleMarker, Marker, Polyline,
  Tooltip, Popup, useMapEvents, useMap,
} from 'react-leaflet'
import L from 'leaflet'
import * as turf from '@turf/turf'
import 'leaflet/dist/leaflet.css'
import { Address, BackboneVerbindung, LatLng, Hausstich, WegKind, NvtStandort, SchachtStandort, MaterialUebersteuerung } from '../lib/types'
import { ermittleHausanschluesseProSegment, ermittleMaterialProSegment, ermittleMaterialUebersteuerungProSegment, ermittleVerbandSegmente } from '../lib/faserdimensionierung'
import { aktivesMaterialProfil, lrArtLabel, MaterialEintrag } from '../lib/materialkatalog'

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
const nvtIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:16px;height:16px;background:#7c3aed;border:2px solid white;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.8)"></div>',
  iconSize: [16, 16], iconAnchor: [8, 8], popupAnchor: [0, -10],
})
const schachtIcon = new L.DivIcon({
  className: '',
  html: '<div style="width:14px;height:14px;background:#f97316;border:2px solid white;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.8)"></div>',
  iconSize: [14, 14], iconAnchor: [7, 7], popupAnchor: [0, -9],
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

const GELB = '#facc15'
// Zyklisch pro NVT-Index vergeben (nvtIdx % Länge) — dieselbe reale Box hat
// dadurch immer dieselbe Farbe, unabhängig davon, was sonst noch gerade
// mitmarkiert ist, wenn mehrere NVT gleichzeitig zum Vergleichen markiert werden.
const NVT_MARKIER_FARBEN = ['#22d3ee', '#f472b6', '#a3e635', '#fb923c', '#c084fc', '#facc15', '#38bdf8', '#fb7185']
const SCHACHT_MARKIER_FARBE = '#22d3ee'
// Hervorhebung der Hausanschlüsse, die zum gerade angeklickten Trasse-
// Segment gehören (siehe hausanschluesseProSegment) — bewusst weiß, um sich
// klar von den NVT-Markier-Farben und dem gelben Segment-Highlight (GELB)
// abzusetzen.
const SEGMENT_HERVORHEBUNG_FARBE = '#ffffff'
const MAX_HANDLES = 80
// Schwellenwert: ≤ 1000 Punkte → Klein-Projekt (alle Handles sofort sichtbar)
const KLEIN_PROJEKT_SCHWELLE = 1000
// Ab welcher Nähe (Meter) beim Ziehen eines Punkts ein Schnapp-Ziel markiert
// und beim Loslassen tatsächlich exakt übernommen wird.
const SNAP_SCHWELLE_METER = 5

function haversineMeter(a: LatLng, b: LatLng): number {
  const R = 6_371_000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

// Versetzt einen Pfad senkrecht zu seiner Laufrichtung um einen festen
// Meter-Betrag — für Doppelbelegung (zwei Materialien auf demselben
// Segment) statt der bisherigen konzentrischen Überlagerung zwei parallel
// nebeneinander laufende Linien zu zeichnen (wie ein Leitungsgraben mit
// zwei Kabeln), damit beide Farben eigenständig erkennbar bleiben (Alex,
// 2026-08-21: "Verbünde die aufeinander liegen ... ist unübersichtlich").
// Bewusst keine echte Polygon-Versatzberechnung (Miter/Bevel je Knick) —
// bei den vielen, meist sanft gekrümmten Straßen-Stützpunkten reicht ein
// einfacher Pro-Punkt-Versatz anhand der lokalen Laufrichtung völlig aus.
function versetzePfadSenkrecht(pfad: LatLng[], meterVersatz: number): LatLng[] {
  const METER_PRO_GRAD_LAT = 111_320
  return pfad.map((p, i) => {
    const von = pfad[Math.max(0, i - 1)]
    const nach = pfad[Math.min(pfad.length - 1, i + 1)]
    const cosLat = Math.cos((p.lat * Math.PI) / 180)
    const dxMeter = (nach.lng - von.lng) * METER_PRO_GRAD_LAT * cosLat
    const dyMeter = (nach.lat - von.lat) * METER_PRO_GRAD_LAT
    const laenge = Math.hypot(dxMeter, dyMeter)
    if (laenge < 1e-6) return p
    // Senkrechte Richtung (um 90° gedreht), auf Ziel-Versatz normiert
    const nx = (-dyMeter / laenge) * meterVersatz
    const ny = (dxMeter / laenge) * meterVersatz
    return { lat: p.lat + ny / METER_PRO_GRAD_LAT, lng: p.lng + nx / (METER_PRO_GRAD_LAT * cosLat) }
  })
}

// Sucht beim Ziehen eines Punkts das nächstgelegene Schnapp-Ziel — entweder
// ein bestehender Punkt (Vertex) auf irgendeinem Trasse-Pfad, oder die
// Projektion auf eine Pfad-Linie selbst (falls näher als jeder einzelne
// Vertex). Der gerade gezogene Punkt wird über (ausschlussPfadIdx,
// ausschlussPunktIdx) von der Suche ausgenommen, damit er nicht sich selbst
// "trifft". Gibt null zurück, wenn nichts innerhalb der Schwelle liegt.
function findeSchnappziel(
  position: LatLng,
  pfade: LatLng[][],
  ausschlussPfadIdx: number,
  ausschlussPunktIdx: number
): LatLng | null {
  let bestPos: LatLng | null = null
  let bestDist = SNAP_SCHWELLE_METER

  pfade.forEach((pfad, pi) => {
    pfad.forEach((p, i) => {
      if (pi === ausschlussPfadIdx && i === ausschlussPunktIdx) return
      const d = haversineMeter(position, p)
      if (d < bestDist) { bestDist = d; bestPos = p }
    })
    if (pfad.length >= 2) {
      try {
        const line = turf.lineString(pfad.map((p) => [p.lng, p.lat]))
        const nearest = turf.nearestPointOnLine(line, turf.point([position.lng, position.lat]))
        const [lng, lat] = nearest.geometry.coordinates
        const projPos = { lat, lng }
        const d = haversineMeter(position, projPos)
        if (d < bestDist) { bestDist = d; bestPos = projPos }
      } catch { /* ignorieren — z.B. bei entarteten Linien */ }
    }
  })

  return bestPos
}

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
  feldwegFarbe: string
  bundesfoerderung: boolean
  trassePfadeKinds: WegKind[]
  trasseMethode?: string
  nichtAngebundeneAdressen?: Address[]
  aussiedlerhofUuids?: Set<string>
  aussiedlerhofMarkierenAktiv?: boolean
  nvtStandorte?: NvtStandort[]
  nvtManuellSetzenAktiv?: boolean
  schachtStandorte?: SchachtStandort[]
  schachtSetzenAktiv?: boolean
  backboneVerbindungen?: BackboneVerbindung[]
  backboneVerbindungLaeuft?: boolean
  backboneVerbindungFehler?: string | null
  materialUebersteuerungen?: MaterialUebersteuerung[]
  onStartpunktGesetzt: (punkt: LatLng) => void
  onTrasseGeaendert: (punkte: LatLng[]) => void
  onTrassePfadeGeaendert: (pfade: LatLng[][], kinds: WegKind[]) => void
  onHausanschluesseGeaendert: (updated: Hausstich[]) => void
  onAussiedlerhofToggle?: (uuid: string) => void
  onAussiedlerhofMarkierenFertig?: () => void
  onNvtManuellHinzufuegen?: (position: LatLng, kapazitaet: number) => void
  onNvtManuellSetzenAbbrechen?: () => void
  onNvtLoeschen?: (nvtIdx: number) => void
  onNvtHausanschlussToggle?: (nvtIdx: number, hausId: string) => void
  onNvtVerschoben?: (nvtIdx: number, position: LatLng) => void
  onSchachtGesetzt?: (position: LatLng) => void
  onSchachtSetzenAbbrechen?: () => void
  onSchachtLoeschen?: (schachtIdx: number) => void
  onSchachtHausanschlussToggle?: (schachtIdx: number, hausId: string) => void
  onSchachtVerschoben?: (schachtIdx: number, position: LatLng) => void
  onBackboneVerbindungErstellen?: (quelle: LatLng, ziel: LatLng, material: MaterialEintrag) => void
  onBackboneVerbindungFehlerSchliessen?: () => void
  onMaterialUebersteuern?: (segmentIdxs: number[], material: MaterialEintrag | null) => void
}

function KlickHandler({
  aktiv, onKlick, ziehModus, onZiehZiel, hsZeichenModus, onHsZeichenZiel,
  nvtSetzenModus, onNvtSetzenZiel, schachtSetzenModus, onSchachtSetzenZiel,
  mehrpunktModus, onMehrpunktKlick, onMehrpunktFertig,
  menuOffen, onMenuSchliessen, onMapKlick,
}: {
  aktiv: boolean
  onKlick: (p: LatLng) => void
  ziehModus?: boolean
  onZiehZiel?: (p: LatLng) => void
  hsZeichenModus?: boolean
  onHsZeichenZiel?: (p: LatLng) => void
  nvtSetzenModus?: boolean
  onNvtSetzenZiel?: (p: LatLng) => void
  schachtSetzenModus?: boolean
  onSchachtSetzenZiel?: (p: LatLng) => void
  mehrpunktModus?: boolean
  onMehrpunktKlick?: (p: LatLng) => void
  onMehrpunktFertig?: () => void
  menuOffen?: boolean
  onMenuSchliessen?: () => void
  onMapKlick?: () => void
}) {
  const map = useMapEvents({
    click(e) {
      if (menuOffen) { onMenuSchliessen?.(); return }
      const pos = { lat: e.latlng.lat, lng: e.latlng.lng }
      if (mehrpunktModus && onMehrpunktKlick) onMehrpunktKlick(pos)
      else if (ziehModus && onZiehZiel) onZiehZiel(pos)
      else if (hsZeichenModus && onHsZeichenZiel) onHsZeichenZiel(pos)
      else if (nvtSetzenModus && onNvtSetzenZiel) onNvtSetzenZiel(pos)
      else if (schachtSetzenModus && onSchachtSetzenZiel) onSchachtSetzenZiel(pos)
      else if (aktiv) onKlick(pos)
      else onMapKlick?.()
    },
    dblclick(e) {
      if (mehrpunktModus && onMehrpunktFertig) {
        L.DomEvent.stopPropagation(e)
        onMehrpunktFertig()
      }
    },
  })
  // Doppelklick-Zoom stört den "Doppelklick = Linie fertig"-Abschluss beim
  // Mehrpunkt-Zeichnen (BayernAtlas-Flow) — während des Modus deaktivieren.
  useEffect(() => {
    if (mehrpunktModus) map.doubleClickZoom.disable()
    else map.doubleClickZoom.enable()
  }, [mehrpunktModus, map])
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

function TrasseNetzwerk({ pfade, farbe, opacity = 0.9, weight = 4 }: { pfade: LatLng[][]; farbe: string; opacity?: number; weight?: number }) {
  const map = useMap()
  useEffect(() => {
    const gueltige = pfade.filter((p) => p.length >= 2)
    if (gueltige.length === 0) return
    const renderer = L.canvas({ padding: 0.1 })
    const gruppe = L.layerGroup(
      gueltige.map((pfad) =>
        L.polyline(pfad.map((p) => [p.lat, p.lng] as [number, number]), { color: farbe, weight, opacity, renderer } as L.PolylineOptions)
      )
    ).addTo(map)
    return () => { map.removeLayer(gruppe) }
  }, [pfade, farbe, opacity, weight, map])
  return null
}

// Unsichtbare Klick-Flächen für die Trasse-Segmente AUSSERHALB des Bearbeitungs-
// modus — rein zum Markieren/Ansehen, keine Editierfunktion. Eigenständig statt
// in TrasseNetzwerk integriert, damit das bestehende (performancekritische)
// Canvas-Rendering dort unangetastet bleibt. Das ausgewählte Segment bekommt
// zusätzlich eine echte gelbe Overlay-Polyline (nur eine gleichzeitig, daher
// keine Performance-Sorge trotz react-leaflet statt Canvas).
function TrasseKlickbar({ pfade, ausgewaehlteIdxs, onKlick }: {
  pfade: LatLng[][]
  // Mehrere Indizes = kompletter Verband-Verlauf wird hervorgehoben, nicht
  // nur das einzeln angeklickte Segment (2026-08-21, Alex: "möchte den
  // Verlauf des Verbands sehen").
  ausgewaehlteIdxs: number[]
  onKlick: (idx: number) => void
}) {
  const map = useMap()
  useEffect(() => {
    const renderer = L.canvas({ padding: 0.1 })
    const linien: L.Polyline[] = []
    pfade.forEach((pfad, i) => {
      if (pfad.length < 2) return
      const linie = L.polyline(pfad.map((p) => [p.lat, p.lng] as [number, number]), {
        color: '#000', weight: 16, opacity: 0.01, renderer,
      } as L.PolylineOptions)
      linie.on('click', (e) => { L.DomEvent.stopPropagation(e); onKlick(i) })
      linien.push(linie)
    })
    const gruppe = L.layerGroup(linien).addTo(map)
    return () => { map.removeLayer(gruppe) }
  }, [pfade, onKlick, map])

  const ausgewaehltePfade = ausgewaehlteIdxs
    .map((idx) => pfade[idx])
    .filter((pfad): pfad is LatLng[] => !!pfad && pfad.length >= 2)
    .map((pfad) => pfad.map((p) => [p.lat, p.lng] as [number, number]))
  if (ausgewaehltePfade.length === 0) return null
  return (
    <Polyline
      positions={ausgewaehltePfade}
      interactive={false}
      // Weiß statt Gelb (2026-08-21) — Gelb kollidierte optisch mit der
      // 12x7-Materialfarbe (#eab308, fast identischer Ton), sobald ein
      // Verband über mehrere Segmente hinweg markiert wird und dabei neben
      // 12x7-Strecken verläuft. Passt zusätzlich zur bereits weißen
      // Hausanschluss-Hervorhebung (SEGMENT_HERVORHEBUNG_FARBE).
      pathOptions={{ color: SEGMENT_HERVORHEBUNG_FARBE, weight: 6, opacity: 1 }} />
  )
}

// Schnapp-Ziel-Anzeige beim Ziehen eines Punkt-Handles — bewusst NICHT über
// React-State (setState während des Ziehens würde MapView neu rendern; da
// react-leaflet die Marker-"position"-Prop nur per Referenzvergleich prüft
// (updateMarker: `props.position !== prevProps.position`), erzeugt JEDES
// Re-Rendern ein neues [lat,lng]-Array und reißt den gerade gezogenen Marker
// per marker.setLatLng() zurück auf die alte Position — das Ziehen wirkte
// dadurch "kaputt", der Punkt sprang beim Loslassen zurück). Stattdessen wird
// hier ein einziger, dauerhaft auf der Karte liegender Leaflet-Layer rein
// imperativ verschoben/ein-ausgeblendet, ohne jemals ein Re-Rendern auszulösen.
function SchnappZielLayer({ layerRef }: { layerRef: React.MutableRefObject<L.CircleMarker | null> }) {
  const map = useMap()
  useEffect(() => {
    const circle = L.circleMarker([0, 0], {
      radius: 11, color: '#4ade80', weight: 3, fillColor: '#4ade80',
      fillOpacity: 0, opacity: 0, interactive: false,
    }).addTo(map)
    layerRef.current = circle
    return () => { circle.remove(); layerRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])
  return null
}

function zeigeSchnappZiel(layerRef: React.MutableRefObject<L.CircleMarker | null>, ziel: LatLng | null) {
  const layer = layerRef.current
  if (!layer) return
  if (ziel) {
    layer.setLatLng([ziel.lat, ziel.lng])
    layer.setStyle({ opacity: 1, fillOpacity: 0.35 })
  } else {
    layer.setStyle({ opacity: 0, fillOpacity: 0 })
  }
}

type TileVariante = 'satellit' | 'osm'

const MapView = memo(function MapView({
  adressen, startpunkt, startpunktSetzenAktiv, trasse, trassePfade, hausanschluesse,
  editierbarAktiv, aktiveOrteKeys, adressFarbe, trasseFarbe, hausanschlussfarbe, trasseMethode,
  feldwegFarbe, bundesfoerderung, trassePfadeKinds,
  nichtAngebundeneAdressen = [],
  aussiedlerhofUuids = new Set(), aussiedlerhofMarkierenAktiv = false, nvtStandorte = [],
  nvtManuellSetzenAktiv = false, schachtStandorte = [], schachtSetzenAktiv = false,
  backboneVerbindungen = [], backboneVerbindungLaeuft = false, backboneVerbindungFehler = null,
  materialUebersteuerungen = [],
  onStartpunktGesetzt, onTrasseGeaendert, onTrassePfadeGeaendert, onHausanschluesseGeaendert,
  onAussiedlerhofToggle, onAussiedlerhofMarkierenFertig,
  onNvtManuellHinzufuegen, onNvtManuellSetzenAbbrechen, onNvtLoeschen, onNvtHausanschlussToggle, onNvtVerschoben,
  onSchachtGesetzt, onSchachtSetzenAbbrechen, onSchachtLoeschen, onSchachtHausanschlussToggle, onSchachtVerschoben,
  onBackboneVerbindungErstellen, onBackboneVerbindungFehlerSchliessen, onMaterialUebersteuern,
}: MapViewProps) {
  const [tileVariante, setTileVariante] = useState<TileVariante>('satellit')
  const [topoSichtbar, setTopoSichtbar] = useState(false)
  const [ortsnamenSichtbar, setOrtsnamenSichtbar] = useState(true)
  const [suchQuery, setSuchQuery] = useState('')
  const [suchLaden, setSuchLaden] = useState(false)
  const [suchFehler, setSuchFehler] = useState(false)
  const [flugZiel, setFlugZiel] = useState<LatLng | null>(null)
  const [trasseSichtbar, setTrasseSichtbar] = useState(true)
  const [hausanschluesseSichtbar, setHausanschluesseSichtbar] = useState(true)
  const [adressenSichtbar, setAdressenSichtbar] = useState(true)
  const [nvtSichtbar, setNvtSichtbar] = useState(true)
  const [schachtSichtbar, setSchachtSichtbar] = useState(true)
  // Segment-Markierung außerhalb des Bearbeitungsmodus (reines Ansehen).
  const [ausgewaehltesSegmentNormal, setAusgewaehltesSegmentNormal] = useState<number | null>(null)
  // Material-Auswahl im Klick-Panel ein-/ausgeklappt (2026-08-21, Alex:
  // "im Nachhinein kann ich aber keinen einzigen Verbund bearbeiten").
  const [materialAuswahlOffen, setMaterialAuswahlOffen] = useState(false)
  const [warnModalOffen, setWarnModalOffen] = useState(false)
  // Referenz der zuletzt gesehenen Liste — erlaubt, das Warnmodal direkt beim
  // Render zu öffnen sobald eine NEUE (andere Referenz) Liste ankommt, ohne
  // dafür einen Effect mit setState-Kaskade zu brauchen.
  const [vorherigeNichtAngebunden, setVorherigeNichtAngebunden] = useState(nichtAngebundeneAdressen)
  if (nichtAngebundeneAdressen !== vorherigeNichtAngebunden) {
    setVorherigeNichtAngebunden(nichtAngebundeneAdressen)
    if (nichtAngebundeneAdressen.length > 0) setWarnModalOffen(true)
  }

  const nichtAngebundenUuids = useMemo(
    () => new Set(nichtAngebundeneAdressen.map((a) => a.uuid)),
    [nichtAngebundeneAdressen]
  )

  // Welche NVT sind gerade angeklickt — markiert deren Hausanschlüsse auf der
  // Karte, mit je eigener Farbe (siehe NVT_MARKIER_FARBEN), damit sich
  // mehrere Standorte gleichzeitig zum Vergleichen markieren lassen. Schacht
  // bleibt Einzelauswahl (schließt sich mit der NVT-Auswahl gegenseitig aus,
  // siehe Klick-Handler der jeweiligen Marker weiter unten). Eine Löschung
  // (Standort löschen) leert die NVT-Auswahl komplett statt nur den Index zu
  // entfernen, weil sich sonst alle Indizes danach verschieben.
  const [ausgewaehlteNvtIdxs, setAusgewaehlteNvtIdxs] = useState<Set<number>>(new Set())
  const [ausgewaehltesSchachtIdx, setAusgewaehltesSchachtIdx] = useState<number | null>(null)

  // Mausover-Übersicht für NVT/Schacht (2026-08-13, Alex: "wenn ich mit der
  // Maus drüber geh, soll son kleines Modal aufgehen mit allen wichtigen
  // Daten") — bewusst getrennt von ausgewaehlteNvtIdxs/-SchachtIdx, da Klick
  // weiterhin die Hausanschlüsse auf der Karte markiert und das eine mit dem
  // anderen nichts zu tun haben soll.
  const [hoverNvtIdx, setHoverNvtIdx] = useState<number | null>(null)
  const [hoverSchachtIdx, setHoverSchachtIdx] = useState<number | null>(null)

  // Welche Hausanschlüsse hängen an welchem Trasse-Segment (2026-08-13, Alex:
  // "ich möchte sehen, auf welchem Segment welche Kunden hängen") — dieselbe
  // Baum-Aggregation wie im GIS-NB-Export, hier für die Klick-Info + optische
  // Hervorhebung der betroffenen Hausanschluss-Stiche genutzt.
  const hausanschluesseProSegment = useMemo(
    () =>
      startpunkt && trassePfade.length > 0
        ? ermittleHausanschluesseProSegment(trassePfade, startpunkt, hausanschluesse, nvtStandorte, schachtStandorte)
        : trassePfade.map(() => [] as string[]),
    [trassePfade, startpunkt, hausanschluesse, nvtStandorte, schachtStandorte]
  )

  // "Hausanschlüsse zuweisen" braucht genau EIN Ziel-NVT — der Zuweisen-Modus
  // setzt die Auswahl beim Aktivieren bewusst auf ein Einzelelement (siehe
  // Kontextmenü-Aktion der NVT-Marker), daher reicht hier size === 1.
  const zuweisenZielNvtIdx = ausgewaehlteNvtIdxs.size === 1 ? [...ausgewaehlteNvtIdxs][0] : null

  // Gefilterte Pfad-Arrays für TrasseNetzwerk/TrasseKlickbar gememoized —
  // ohne das erzeugt JEDES .filter() in der JSX bei JEDEM Re-Render von
  // MapView (Menü öffnen, Punkt ziehen, Suche tippen, ...) ein neues Array,
  // dessen useEffect (in TrasseNetzwerk/TrasseKlickbar) daraufhin sämtliche
  // Leaflet-Layer der kompletten Trasse abbaut und neu aufbaut — bei
  // größeren Projekten spürbar langsamer mit jeder Interaktion.
  // Kartenfarbe je Trasse-Segment nach zugewiesenem Material (2026-08-12,
  // Alex: "7x7, 12x7, 24x7, 4x20, 2x20, 7x14 jeweils eine andere Farbe") —
  // dieselbe Zuordnungslogik wie im GIS-NB-Export (gisNbExport.ts):
  // Backbone-Segmente (siehe ermittleBackboneSegmente) bekommen die Farbe
  // des Trasse-Materials, alle anderen (mit Hausanschlüssen dahinter) die
  // Farbe der jeweils gewählten Kundenanschluss-Sammelverband-Stufe. Nur für
  // die normale Ansicht (außerhalb des Bearbeitungsmodus) berücksichtigt —
  // die Edit-Modus-Einfärbung (localPfade weiter unten) bleibt unverändert
  // bei Straße/Feldweg, um das ohnehin fragile Drag-Verhalten dort nicht
  // anzufassen.
  const materialProfil = useMemo(() => aktivesMaterialProfil(bundesfoerderung), [bundesfoerderung])
  // Material pro Segment — Grundlage für die Kartenfarbe UND die Klick-Info-
  // Box (2026-08-13, Alex: "ich möchte sehen, welcher Verbund wo langläuft").
  // "haupt" ist das primär gezeigte Material (Kundenanschluss-Stufe, sonst
  // Backbone), "zusatz" nur gesetzt bei Doppelbelegung (beides trifft zu) —
  // dann läuft ZUSÄTZLICH das Backbone-Material auf demselben Segment, siehe
  // Doppelbelegungs-Rendering unten (zwei Linien übereinander statt einer
  // einzelnen Farbe, sonst wäre auf der Karte gar nicht sichtbar, dass dort
  // zwei Verbände liegen — Alex-Feedback 2026-08-13).
  // Ohne mindestens einen Verteiler (NVT/Schacht) lässt sich noch gar kein
  // Verbund sinnvoll bestimmen — die Kapazitätsobergrenze UND die
  // Backbone-Klassifizierung hängen direkt an dessen Standort. Vorher würde
  // rein aus der Hausanschluss-Anzahl schon eine Kundenanschluss-Stufe
  // gewählt, obwohl das Programm noch gar nicht weiß, wo der NVT sitzt
  // (Alex, 2026-08-13: "Verbünde sollen erst gesetzt sein, wenn die NVTs
  // stehen") — bis dahin bleibt die Trasse in der Fallback-Farbe (siehe
  // ermittleMaterialProSegment in faserdimensionierung.ts, die dieselbe
  // Prüfung macht und leer zurückgibt).
  const materialProSegment = useMemo(
    () => ermittleMaterialProSegment(trassePfade, startpunkt, nvtStandorte, schachtStandorte, hausanschluesse, materialProfil, backboneVerbindungen, materialUebersteuerungen),
    [trassePfade, startpunkt, nvtStandorte, schachtStandorte, hausanschluesse, materialProfil, backboneVerbindungen, materialUebersteuerungen]
  )
  // Ist das Segment gerade manuell übersteuert? Nur fürs Klick-Panel (zeigt
  // "manuell gesetzt" + "Automatisch zurücksetzen"-Option statt der
  // Material-Auswahl bei einem bereits übersteuerten Segment).
  const manuellUebersteuertProSegment = useMemo(
    () => ermittleMaterialUebersteuerungProSegment(trassePfade, materialUebersteuerungen),
    [trassePfade, materialUebersteuerungen]
  )
  // Kompletter Verlauf des Verbands, zu dem das angeklickte Segment gehört
  // (2026-08-21, Alex: "möchte den Verlauf des Verbands sehen, auch bei einer
  // Gabelung") — nicht nur das eine angeklickte Segment, sondern die ganze
  // zusammenhängende Kette gleichen Materials bis zur Gabelung/zum NVT.
  const verbandSegmentIdxs = useMemo(
    () =>
      ausgewaehltesSegmentNormal !== null
        ? ermittleVerbandSegmente(trassePfade, materialProSegment, hausanschluesseProSegment, ausgewaehltesSegmentNormal)
        : [],
    [trassePfade, materialProSegment, hausanschluesseProSegment, ausgewaehltesSegmentNormal]
  )
  // Hausanschlüsse, die irgendwo auf dem kompletten Verband-Verlauf hängen —
  // Vereinigung über alle Segmente der Instanz (durch die Verteiler-
  // stoppende Akkumulation trägt ohnehin meist schon das NVT-nächste Segment
  // die volle Menge, die Vereinigung ist hier nur ein Sicherheitsnetz).
  const verbandHausIds = useMemo(() => {
    const ids = new Set<string>()
    for (const idx of verbandSegmentIdxs) for (const id of hausanschluesseProSegment[idx] ?? []) ids.add(id)
    return ids
  }, [verbandSegmentIdxs, hausanschluesseProSegment])
  const hausIdZuFarbe = useMemo(() => {
    const map = new Map<string, string>()
    for (const nvtIdx of ausgewaehlteNvtIdxs) {
      const farbe = NVT_MARKIER_FARBEN[nvtIdx % NVT_MARKIER_FARBEN.length]
      for (const hausId of nvtStandorte[nvtIdx]?.hausanschlussIds ?? []) map.set(hausId, farbe)
    }
    if (ausgewaehltesSchachtIdx !== null) {
      for (const hausId of schachtStandorte[ausgewaehltesSchachtIdx]?.hausanschlussIds ?? []) map.set(hausId, SCHACHT_MARKIER_FARBE)
    }
    if (ausgewaehltesSegmentNormal !== null) {
      for (const hausId of verbandHausIds) map.set(hausId, SEGMENT_HERVORHEBUNG_FARBE)
    }
    return map
  }, [ausgewaehlteNvtIdxs, nvtStandorte, ausgewaehltesSchachtIdx, schachtStandorte, ausgewaehltesSegmentNormal, verbandHausIds])
  const farbeProSegment = useMemo(
    () => materialProSegment.map((m) => m?.haupt.farbe ?? trasseFarbe),
    [materialProSegment, trasseFarbe]
  )

  // Einfarbige Segmente (kein Doppelbelegung) — normales, Canvas-optimiertes
  // Rendering, gruppiert nach Farbe wie bisher.
  const trassePfadeNachFarbeOhneFeldweg = useMemo(() => {
    const gruppen = new Map<string, LatLng[][]>()
    trassePfade.forEach((pfad, i) => {
      if (trassePfadeKinds[i] === 'track') return
      if (materialProSegment[i]?.zusatz) return // Doppelbelegung, siehe unten
      const farbe = farbeProSegment[i] ?? trasseFarbe
      if (!gruppen.has(farbe)) gruppen.set(farbe, [])
      gruppen.get(farbe)!.push(pfad)
    })
    return [...gruppen.entries()]
  }, [trassePfade, trassePfadeKinds, materialProSegment, farbeProSegment, trasseFarbe])

  // Doppelbelegung: zwei Materialien auf demselben Segment — statt der
  // früheren konzentrischen Überlagerung (schmal auf breit) zwei parallel
  // versetzte Linien wie ein Leitungsgraben mit zwei Kabeln, gruppiert nach
  // Farbe für performantes Canvas-Rendering (wie die einfarbigen Segmente).
  // Bewusst KEINE gestrichelte/Punkt-Strich-Symbolik (von Alex explizit
  // abgelehnt), nur Farbe + räumlicher Versatz.
  const DOPPELBELEGUNG_VERSATZ_METER = 1.6
  const trassePfadeDoppelbelegungHaupt = useMemo(() => {
    const gruppen = new Map<string, LatLng[][]>()
    trassePfade.forEach((pfad, i) => {
      if (trassePfadeKinds[i] === 'track') return
      const m = materialProSegment[i]
      if (!m?.zusatz) return
      const farbe = m.haupt.farbe
      if (!gruppen.has(farbe)) gruppen.set(farbe, [])
      gruppen.get(farbe)!.push(versetzePfadSenkrecht(pfad, DOPPELBELEGUNG_VERSATZ_METER))
    })
    return [...gruppen.entries()]
  }, [trassePfade, trassePfadeKinds, materialProSegment])
  const trassePfadeDoppelbelegungZusatz = useMemo(() => {
    const gruppen = new Map<string, LatLng[][]>()
    trassePfade.forEach((pfad, i) => {
      if (trassePfadeKinds[i] === 'track') return
      const m = materialProSegment[i]
      if (!m?.zusatz) return
      const farbe = m.zusatz.farbe
      if (!gruppen.has(farbe)) gruppen.set(farbe, [])
      gruppen.get(farbe)!.push(versetzePfadSenkrecht(pfad, -DOPPELBELEGUNG_VERSATZ_METER))
    })
    return [...gruppen.entries()]
  }, [trassePfade, trassePfadeKinds, materialProSegment])
  const trassePfadeNurFeldweg = useMemo(
    () => trassePfade.filter((_, i) => trassePfadeKinds[i] === 'track'),
    [trassePfade, trassePfadeKinds]
  )
  const handleSegmentNormalKlick = useCallback((i: number) => {
    setAusgewaehltesSegmentNormal((prev) => (prev === i ? null : i))
    setMaterialAuswahlOffen(false)
  }, [])

  // Manuelles NVT setzen: nach Klick auf die Karte erst Kapazität abfragen,
  // bevor der Standort wirklich angelegt wird.
  const [neuerNvtPosition, setNeuerNvtPosition] = useState<LatLng | null>(null)
  const [neueNvtKapazitaet, setNeueNvtKapazitaet] = useState(24)
  // Zuweisen-Modus: Hausanschlüsse anklicken ordnet sie dem ausgewählten NVT/Schacht zu.
  const [nvtZuweisenAktiv, setNvtZuweisenAktiv] = useState(false)
  const [schachtZuweisenAktiv, setSchachtZuweisenAktiv] = useState(false)

  // Backbone-Verbindung erstellen (2026-08-13, Alex: "Schacht setzen oder
  // NVT, markiert den, sagt Backbone-Verbindung erstellen mit diesem
  // Verband") — Quelle wird per Kontextmenü-Aktion gesetzt, danach fängt der
  // nächste Klick auf einen ANDEREN NVT/Schacht (siehe click-Handler der
  // Marker oben) das Ziel ab statt die normale Markieren-Auswahl auszulösen.
  // Sobald beide stehen, fragt ein kleiner Dialog das Material ab (jedes im
  // aktiven Katalog-Profil hinterlegte, nicht nur das feste Backbone-Material
  // — "kann man dann alles auswählen, was hinterlegt wurde").
  const [backboneVerbindungQuelle, setBackboneVerbindungQuelle] =
    useState<{ typ: 'nvt' | 'schacht'; idx: number; position: LatLng } | null>(null)
  const [backboneVerbindungZiel, setBackboneVerbindungZiel] =
    useState<{ typ: 'nvt' | 'schacht'; idx: number; position: LatLng } | null>(null)
  const [backboneVerbindungMaterial, setBackboneVerbindungMaterial] = useState<MaterialEintrag | null>(null)
  const backboneVerbindungAbbrechen = useCallback(() => {
    setBackboneVerbindungQuelle(null)
    setBackboneVerbindungZiel(null)
    setBackboneVerbindungMaterial(null)
  }, [setBackboneVerbindungQuelle, setBackboneVerbindungZiel, setBackboneVerbindungMaterial])

  // Lokale Arbeitskopie der Pfade im Edit-Modus
  const [localPfade, setLocalPfade] = useState<LatLng[][]>([])
  // Straße/Feldweg-Klassifizierung parallel zu localPfade (gleicher Index) —
  // wird durch jede strukturelle Mutation (Löschen/Trennen/Neuer Strich)
  // mitgezogen und kann per Kontextmenü manuell umgeschaltet werden.
  const [localPfadeKinds, setLocalPfadeKinds] = useState<WegKind[]>([])
  // Groß-Projekt: ausgewähltes Segment (Tap-to-Select)
  const [editSegmentIdx, setEditSegmentIdx] = useState<number | null>(null)
  const [editPunkte, setEditPunkte] = useState<LatLng[]>([])
  // Klein-Projekt (≤ KLEIN_PROJEKT_SCHWELLE Punkte): alle Handles sofort sichtbar
  const [kleinProjekt, setKleinProjekt] = useState(false)

  // Gememoized wie trassePfadeOhneFeldweg/-NurFeldweg oben — verhindert
  // denselben Voll-Rebuild-der-Leaflet-Layer bei jedem Re-Render im Edit-Modus.
  const localPfadeOhneFeldweg = useMemo(
    () => localPfade.filter((_, i) => i !== editSegmentIdx && localPfadeKinds[i] !== 'track'),
    [localPfade, localPfadeKinds, editSegmentIdx]
  )
  const localPfadeNurFeldweg = useMemo(
    () => localPfade.filter((_, i) => i !== editSegmentIdx && localPfadeKinds[i] === 'track'),
    [localPfade, localPfadeKinds, editSegmentIdx]
  )

  const [deletedStack, setDeletedStack] = useState<Hausstich[]>([])
  const [ziehStartId, setZiehStartId] = useState<string | null>(null)
  const [ziehStartPos, setZiehStartPos] = useState<LatLng | null>(null)
  // Beim Ziehen eines Punkt-Handles: Ref auf den imperativ verwalteten
  // Schnapp-Ziel-Layer (siehe SchnappZielLayer/zeigeSchnappZiel oben) — bewusst
  // KEIN React-State, sonst reißt jedes Re-Rendern den gerade gezogenen
  // Marker zurück auf seine alte Position (react-leaflet vergleicht die
  // position-Prop nur per Referenz).
  const schnappZielLayerRef = useRef<L.CircleMarker | null>(null)
  const [aktivMenu, setAktivMenu] = useState<AktivMenu>(null)
  const [neuerHsStart, setNeuerHsStart] = useState<NeuerHsStart>(null)
  const [aktivesSegment, setAktivesSegment] = useState<string | null>(null)
  // Manuelle Segment-Definition: erster Klick merkt sich Pfad+Position als
  // Start, zweiter Klick auf DEMSELBEN Pfad schneidet den Abschnitt dazwischen
  // als eigenständiges Segment heraus (für den Export wichtig).
  const [segmentStart, setSegmentStart] = useState<{ pfadIdx: number; pos: LatLng } | null>(null)
  // Mehrpunkt-Linienzeichnen (BayernAtlas-Flow, 2026-08-21, Alex: "Eine Linie
  // zieht mit mehreren Punkten ... zwischendrin verbinden Sie die Linien") —
  // ZUSÄTZLICH zum bestehenden Ein-Klick-"Neuer Strich" (unverändert), nicht
  // als Ersatz. Startet wie "Neuer Strich" an einem bestehenden Punkt, sammelt
  // aber beliebig viele weitere Punkte, bis "Fertig" (oder Doppelklick).
  const [mehrpunktModus, setMehrpunktModus] = useState(false)
  const [mehrpunktPunkte, setMehrpunktPunkte] = useState<LatLng[]>([])

  const trasseRef = useRef<LatLng[]>([])
  const trassePfadeRef = useRef<LatLng[][]>([])
  const trassePfadeKindsRef = useRef<WegKind[]>([])
  const localPfadeRef = useRef<LatLng[][]>([])
  const localPfadeKindsRef = useRef<WegKind[]>([])
  const editSegmentIdxRef = useRef<number | null>(null)
  const editPunkteRef = useRef<LatLng[]>([])
  const prevEditRef = useRef(false)
  const editiertRef = useRef(false)
  const startedWithSingleRef = useRef(false)

  useEffect(() => { trasseRef.current = trasse }, [trasse])
  useEffect(() => { trassePfadeRef.current = trassePfade }, [trassePfade])
  useEffect(() => { trassePfadeKindsRef.current = trassePfadeKinds }, [trassePfadeKinds])
  useEffect(() => { localPfadeRef.current = localPfade }, [localPfade])
  useEffect(() => { localPfadeKindsRef.current = localPfadeKinds }, [localPfadeKinds])
  useEffect(() => { editSegmentIdxRef.current = editSegmentIdx }, [editSegmentIdx])
  useEffect(() => { editPunkteRef.current = editPunkte }, [editPunkte])

  const handleDeselect = useCallback(() => {
    const segIdx = editSegmentIdxRef.current
    const punkte = editPunkteRef.current
    if (segIdx !== null && punkte.length >= 2) {
      const neuePfade = localPfadeRef.current.map((pf, i) => i === segIdx ? punkte : pf)
      localPfadeRef.current = neuePfade
      setLocalPfade(neuePfade)
      editiertRef.current = true
    }
    setEditSegmentIdx(null)
    editSegmentIdxRef.current = null
    setEditPunkte([])
    editPunkteRef.current = []
    setAktivesSegment(null)
  }, [])

  useEffect(() => {
    const wasActive = prevEditRef.current
    prevEditRef.current = editierbarAktiv

    if (!wasActive && editierbarAktiv) {
      const pfade = trassePfadeRef.current
      const t = trasseRef.current
      setDeletedStack([])
      editiertRef.current = false
      setEditSegmentIdx(null)
      setEditPunkte([])
      setAktivesSegment(null)
      setAktivMenu(null)
      setSegmentStart(null)
      setAusgewaehltesSegmentNormal(null)
      zeigeSchnappZiel(schnappZielLayerRef, null)

      if (pfade.length > 0) {
        startedWithSingleRef.current = false
        const kopie = pfade.map((pf) => [...pf])
        const gesamtPunkte = kopie.reduce((s, pf) => s + pf.length, 0)
        setKleinProjekt(gesamtPunkte <= KLEIN_PROJEKT_SCHWELLE)
        localPfadeRef.current = kopie
        setLocalPfade(kopie)
        // Kinds aus trassePfadeKinds übernehmen — bei Längen-Mismatch (altes
        // Projekt ohne gespeicherte Kinds, o.ä.) sicher auf 'paved' auffüllen.
        const kindsKopie = kopie.map((_, i) => trassePfadeKindsRef.current[i] ?? 'paved')
        localPfadeKindsRef.current = kindsKopie
        setLocalPfadeKinds(kindsKopie)
      } else if (t.length >= 2) {
        startedWithSingleRef.current = true
        const kopie = [[...t]]
        setKleinProjekt(t.length <= KLEIN_PROJEKT_SCHWELLE)
        localPfadeRef.current = kopie
        setLocalPfade(kopie)
        localPfadeKindsRef.current = ['paved']
        setLocalPfadeKinds(['paved'])
      } else {
        startedWithSingleRef.current = false
        setKleinProjekt(false)
        localPfadeRef.current = []
        setLocalPfade([])
        localPfadeKindsRef.current = []
        setLocalPfadeKinds([])
      }
    } else if (wasActive && !editierbarAktiv) {
      let finalPfade = localPfadeRef.current
      const segIdx = editSegmentIdxRef.current
      const punkte = editPunkteRef.current
      if (segIdx !== null && punkte.length >= 2) {
        finalPfade = finalPfade.map((pf, i) => i === segIdx ? punkte : pf)
        editiertRef.current = true
      }
      if (editiertRef.current) {
        const finalKinds = localPfadeKindsRef.current
        const gueltig: LatLng[][] = []
        const gueltigeKinds: WegKind[] = []
        finalPfade.forEach((pf, i) => {
          if (pf.length >= 2) { gueltig.push(pf); gueltigeKinds.push(finalKinds[i] ?? 'paved') }
        })
        if (startedWithSingleRef.current && gueltig.length === 1) {
          onTrasseGeaendert(gueltig[0])
        } else {
          onTrassePfadeGeaendert(gueltig, gueltigeKinds)
        }
      }
      localPfadeRef.current = []
      setLocalPfade([])
      localPfadeKindsRef.current = []
      setLocalPfadeKinds([])
      setEditSegmentIdx(null)
      editSegmentIdxRef.current = null
      setEditPunkte([])
      editPunkteRef.current = []
      setKleinProjekt(false)
      setDeletedStack([])
      setZiehStartId(null)
      setZiehStartPos(null)
      setNeuerHsStart(null)
      setAktivMenu(null)
      setAktivesSegment(null)
      setSegmentStart(null)
      setMehrpunktModus(false)
      setMehrpunktPunkte([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editierbarAktiv])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setZiehStartId(null); setZiehStartPos(null)
      setNeuerHsStart(null); setAktivMenu(null)
      setSegmentStart(null)
      setMehrpunktModus(false); setMehrpunktPunkte([])
      handleDeselect()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleDeselect])

  // ── Groß-Projekt: Segment auswählen ──────────────────────────────────────
  function handleSegmentAuswaehlen(idx: number) {
    const segIdx = editSegmentIdxRef.current
    const punkte = editPunkteRef.current
    let aktuelllePfade = localPfadeRef.current
    if (segIdx !== null && segIdx !== idx && punkte.length >= 2) {
      aktuelllePfade = aktuelllePfade.map((pf, i) => i === segIdx ? punkte : pf)
      localPfadeRef.current = aktuelllePfade
      setLocalPfade(aktuelllePfade)
      editiertRef.current = true
    }
    const pfad = aktuelllePfade[idx]
    if (!pfad || pfad.length < 2) return
    setEditSegmentIdx(idx)
    editSegmentIdxRef.current = idx
    setEditPunkte([...pfad])
    editPunkteRef.current = [...pfad]
    setAktivesSegment(`pfad-${idx}`)
  }

  // ── Groß-Projekt: ausgewähltes Segment bearbeiten ────────────────────────
  function handleEditPunktBewegt(i: number, pos: LatLng) {
    editiertRef.current = true
    const neu = editPunkteRef.current.map((p, idx) => idx === i ? pos : p)
    editPunkteRef.current = neu
    setEditPunkte(neu)
  }

  function handleEditPunktLoeschen(i: number) {
    const aktuell = editPunkteRef.current
    if (aktuell.length <= 2) { handleSegmentLoeschen(); return }
    editiertRef.current = true
    const neu = aktuell.filter((_, idx) => idx !== i)
    editPunkteRef.current = neu
    setEditPunkte(neu)
  }

  function handleEditPunktEinfuegen(klickPos: LatLng) {
    const aktuell = editPunkteRef.current
    if (aktuell.length < 2) return
    try {
      const line = turf.lineString(aktuell.map((p) => [p.lng, p.lat]))
      const nearest = turf.nearestPointOnLine(line, turf.point([klickPos.lng, klickPos.lat]))
      const insertIdx = (nearest.properties.index ?? 0) + 1
      editiertRef.current = true
      const neu = [...aktuell]
      neu.splice(insertIdx, 0, klickPos)
      editPunkteRef.current = neu
      setEditPunkte(neu)
    } catch { /* ignore */ }
  }

  // Trennt das ausgewählte Segment an der geklickten Stelle in zwei eigenständige
  // Pfade auf (kein Punkt-Löschen, kein Gesamt-Löschen — nur die Verbindung dazwischen).
  function handleEditVerbindungTrennen(klickPos: LatLng) {
    const segIdx = editSegmentIdxRef.current
    if (segIdx === null) return
    const aktuell = editPunkteRef.current
    if (aktuell.length < 3) return
    try {
      const line = turf.lineString(aktuell.map((p) => [p.lng, p.lat]))
      const nearest = turf.nearestPointOnLine(line, turf.point([klickPos.lng, klickPos.lat]))
      const idx = nearest.properties.index ?? 0
      const teilA = aktuell.slice(0, idx + 1)
      const teilB = aktuell.slice(idx + 1)
      if (teilA.length < 2 || teilB.length < 2) return
      editiertRef.current = true
      const neuePfade = localPfadeRef.current.map((pf, i) => i === segIdx ? teilA : pf)
      neuePfade.push(teilB)
      localPfadeRef.current = neuePfade
      setLocalPfade(neuePfade)
      // teilB übernimmt die Kind-Klassifizierung des ursprünglichen Segments
      // (teilA behält denselben Index, also automatisch dieselbe Kind).
      const neueKinds = [...localPfadeKindsRef.current, localPfadeKindsRef.current[segIdx] ?? 'paved']
      localPfadeKindsRef.current = neueKinds
      setLocalPfadeKinds(neueKinds)
      setEditSegmentIdx(null)
      editSegmentIdxRef.current = null
      setEditPunkte([])
      editPunkteRef.current = []
      setAktivesSegment(null)
    } catch { /* ignore */ }
  }

  function handleSegmentLoeschen() {
    const segIdx = editSegmentIdxRef.current
    if (segIdx === null) return
    editiertRef.current = true
    const neuePfade = localPfadeRef.current.filter((_, i) => i !== segIdx)
    localPfadeRef.current = neuePfade
    setLocalPfade(neuePfade)
    const neueKinds = localPfadeKindsRef.current.filter((_, i) => i !== segIdx)
    localPfadeKindsRef.current = neueKinds
    setLocalPfadeKinds(neueKinds)
    setEditSegmentIdx(null)
    editSegmentIdxRef.current = null
    setEditPunkte([])
    editPunkteRef.current = []
    setAktivesSegment(null)
  }

  // ── Klein-Projekt: direkte Bearbeitung aller Punkte ──────────────────────
  function handleKleinPunktBewegt(pfadIdx: number, punktIdx: number, pos: LatLng) {
    editiertRef.current = true
    const neuePfade = localPfadeRef.current.map((pf, pi) =>
      pi === pfadIdx ? pf.map((p, i) => i === punktIdx ? pos : p) : pf
    )
    localPfadeRef.current = neuePfade
    setLocalPfade(neuePfade)
  }

  function handleKleinPunktLoeschen(pfadIdx: number, punktIdx: number) {
    editiertRef.current = true
    const gemappt = localPfadeRef.current.map((pf, pi) => {
      if (pi !== pfadIdx) return pf
      if (pf.length <= 2) return [] as LatLng[]
      return pf.filter((_, i) => i !== punktIdx)
    })
    const neuePfade: LatLng[][] = []
    const neueKinds: WegKind[] = []
    gemappt.forEach((pf, i) => {
      if (pf.length >= 2) { neuePfade.push(pf); neueKinds.push(localPfadeKindsRef.current[i] ?? 'paved') }
    })
    localPfadeRef.current = neuePfade
    setLocalPfade(neuePfade)
    localPfadeKindsRef.current = neueKinds
    setLocalPfadeKinds(neueKinds)
    setAktivesSegment(null)
  }

  function handleKleinSegmentLoeschen(pfadIdx: number) {
    editiertRef.current = true
    const neuePfade = localPfadeRef.current.filter((_, i) => i !== pfadIdx)
    localPfadeRef.current = neuePfade
    setLocalPfade(neuePfade)
    const neueKinds = localPfadeKindsRef.current.filter((_, i) => i !== pfadIdx)
    localPfadeKindsRef.current = neueKinds
    setLocalPfadeKinds(neueKinds)
    setAktivesSegment(null)
  }

  // Schneidet den Abschnitt zwischen dem zuvor per "Segment-Start hier
  // setzen" gemerkten Punkt und der jetzt geklickten Position als
  // eigenständiges Segment aus dem Pfad heraus (davor/dazwischen/danach —
  // bis zu drei Teile statt der bisherigen zwei bei "Verbindung trennen").
  // Funktioniert für Groß- UND Klein-Projekt gleichermaßen, da beide über
  // localPfade[pfadIdx] arbeiten (im Groß-Projekt ist pfadIdx = editSegmentIdx).
  function handleSegmentDefinieren(pfadIdx: number, endPos: LatLng) {
    if (!segmentStart || segmentStart.pfadIdx !== pfadIdx) return
    const pfad = localPfadeRef.current[pfadIdx]
    if (!pfad || pfad.length < 3) return
    try {
      const line = turf.lineString(pfad.map((p) => [p.lng, p.lat]))
      const idxStart = turf.nearestPointOnLine(line, turf.point([segmentStart.pos.lng, segmentStart.pos.lat])).properties.index ?? 0
      const idxEnd = turf.nearestPointOnLine(line, turf.point([endPos.lng, endPos.lat])).properties.index ?? 0
      const von = Math.min(idxStart, idxEnd)
      const bis = Math.max(idxStart, idxEnd)
      if (bis - von < 1) return // zu nah beieinander / gleicher Punkt
      const stuecke = [pfad.slice(0, von + 1), pfad.slice(von, bis + 1), pfad.slice(bis)].filter((t) => t.length >= 2)
      if (stuecke.length < 2) return
      editiertRef.current = true
      const kind = localPfadeKindsRef.current[pfadIdx] ?? 'paved'
      const neuePfade = [...localPfadeRef.current.slice(0, pfadIdx), ...stuecke, ...localPfadeRef.current.slice(pfadIdx + 1)]
      localPfadeRef.current = neuePfade
      setLocalPfade(neuePfade)
      const neueKinds = [...localPfadeKindsRef.current.slice(0, pfadIdx), ...stuecke.map(() => kind), ...localPfadeKindsRef.current.slice(pfadIdx + 1)]
      localPfadeKindsRef.current = neueKinds
      setLocalPfadeKinds(neueKinds)
      setSegmentStart(null)
      setAktivesSegment(null)
      setEditSegmentIdx(null)
      editSegmentIdxRef.current = null
      setEditPunkte([])
      editPunkteRef.current = []
    } catch { /* ignore */ }
  }

  // Menü-Eintrag "Segment-Start/Ende hier setzen" — je nachdem, ob für
  // diesen Pfad bereits ein Startpunkt gemerkt ist.
  function segmentDefinierenMenuEintrag(pfadIdx: number, pos: LatLng): MenuAktion {
    if (segmentStart?.pfadIdx === pfadIdx) {
      return { label: '🏁 Segment-Ende hier setzen', farbe: '#4ade80', action: () => { handleSegmentDefinieren(pfadIdx, pos); setAktivMenu(null) } }
    }
    return { label: '📍 Segment-Start hier setzen', farbe: '#4ade80', action: () => { setSegmentStart({ pfadIdx, pos }); setAktivMenu(null) } }
  }

  // Trennt den Pfad an der geklickten Stelle in zwei eigenständige Pfade auf.
  function handleKleinVerbindungTrennen(pfadIdx: number, klickPos: LatLng) {
    const pfad = localPfadeRef.current[pfadIdx]
    if (!pfad || pfad.length < 3) return
    try {
      const line = turf.lineString(pfad.map((p) => [p.lng, p.lat]))
      const nearest = turf.nearestPointOnLine(line, turf.point([klickPos.lng, klickPos.lat]))
      const idx = nearest.properties.index ?? 0
      const teilA = pfad.slice(0, idx + 1)
      const teilB = pfad.slice(idx + 1)
      if (teilA.length < 2 || teilB.length < 2) return
      editiertRef.current = true
      const neuePfade = localPfadeRef.current.map((pf, i) => i === pfadIdx ? teilA : pf)
      neuePfade.push(teilB)
      localPfadeRef.current = neuePfade
      setLocalPfade(neuePfade)
      const neueKinds = [...localPfadeKindsRef.current, localPfadeKindsRef.current[pfadIdx] ?? 'paved']
      localPfadeKindsRef.current = neueKinds
      setLocalPfadeKinds(neueKinds)
      setAktivesSegment(null)
    } catch { /* ignore */ }
  }

  function handleKleinPunktEinfuegen(pfadIdx: number, klickPos: LatLng) {
    const pfad = localPfadeRef.current[pfadIdx]
    if (!pfad || pfad.length < 2) return
    try {
      const line = turf.lineString(pfad.map((p) => [p.lng, p.lat]))
      const nearest = turf.nearestPointOnLine(line, turf.point([klickPos.lng, klickPos.lat]))
      const insertIdx = (nearest.properties.index ?? 0) + 1
      editiertRef.current = true
      const neuePfade = localPfadeRef.current.map((pf, pi) => {
        if (pi !== pfadIdx) return pf
        const neu = [...pf]
        neu.splice(insertIdx, 0, klickPos)
        return neu
      })
      localPfadeRef.current = neuePfade
      setLocalPfade(neuePfade)
    } catch { /* ignore */ }
  }

  // ── Zeichnen (beide Modi) ─────────────────────────────────────────────────
  function handleZiehZiel(zielPos: LatLng) {
    if (!ziehStartPos) return
    let aktuelllePfade = localPfadeRef.current
    const segIdx = editSegmentIdxRef.current
    const punkte = editPunkteRef.current
    if (segIdx !== null && punkte.length >= 2) {
      aktuelllePfade = aktuelllePfade.map((pf, i) => i === segIdx ? punkte : pf)
    }
    const newSegment: LatLng[] = [ziehStartPos, zielPos]
    const neuePfade = [...aktuelllePfade, newSegment]
    localPfadeRef.current = neuePfade
    setLocalPfade(neuePfade)
    // Neu gezeichneter Strich: Default Straße — der Nutzer zeichnet ihn
    // bewusst, kann ihn danach übers Kontextmenü als Feldweg markieren.
    const neueKinds = [...localPfadeKindsRef.current, 'paved' as WegKind]
    localPfadeKindsRef.current = neueKinds
    setLocalPfadeKinds(neueKinds)
    if (!kleinProjekt) {
      setEditSegmentIdx(neuePfade.length - 1)
      editSegmentIdxRef.current = neuePfade.length - 1
      setEditPunkte(newSegment)
      editPunkteRef.current = newSegment
      setAktivesSegment(`pfad-${neuePfade.length - 1}`)
    }
    editiertRef.current = true
    setZiehStartId(null)
    setZiehStartPos(null)
  }

  // Mehrpunkt-Linie: jeder Klick (auf Karte oder bestehenden Punkt) hängt
  // einen weiteren Punkt an — Abschluss erst über "Fertig" / Doppelklick /
  // Enter, im Gegensatz zu handleZiehZiel oben, das nach einem Klick endet.
  function handleMehrpunktPunkt(p: LatLng) {
    setMehrpunktPunkte((prev) => [...prev, p])
  }

  function handleMehrpunktUndo() {
    setMehrpunktPunkte((prev) => prev.slice(0, -1))
  }

  function handleMehrpunktAbbrechen() {
    setMehrpunktModus(false)
    setMehrpunktPunkte([])
  }

  function handleMehrpunktFertig() {
    if (mehrpunktPunkte.length < 2) { handleMehrpunktAbbrechen(); return }
    let aktuelllePfade = localPfadeRef.current
    const segIdx = editSegmentIdxRef.current
    const punkte = editPunkteRef.current
    if (segIdx !== null && punkte.length >= 2) {
      aktuelllePfade = aktuelllePfade.map((pf, i) => i === segIdx ? punkte : pf)
    }
    const neuePfade = [...aktuelllePfade, mehrpunktPunkte]
    localPfadeRef.current = neuePfade
    setLocalPfade(neuePfade)
    const neueKinds = [...localPfadeKindsRef.current, 'paved' as WegKind]
    localPfadeKindsRef.current = neueKinds
    setLocalPfadeKinds(neueKinds)
    if (!kleinProjekt) {
      setEditSegmentIdx(neuePfade.length - 1)
      editSegmentIdxRef.current = neuePfade.length - 1
      setEditPunkte(mehrpunktPunkte)
      editPunkteRef.current = mehrpunktPunkte
      setAktivesSegment(`pfad-${neuePfade.length - 1}`)
    }
    editiertRef.current = true
    setMehrpunktModus(false)
    setMehrpunktPunkte([])
  }

  // Schaltet die Straße/Feldweg-Klassifizierung eines Segments manuell um —
  // sowohl für frisch generierte als auch für per Hand editierte Segmente.
  function handleSegmentKindToggle(idx: number) {
    const neu = [...localPfadeKindsRef.current]
    neu[idx] = neu[idx] === 'track' ? 'paved' : 'track'
    localPfadeKindsRef.current = neu
    setLocalPfadeKinds(neu)
    editiertRef.current = true
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

  // Rastet einen frei geklickten/gezogenen Punkt auf die Trasse ein, falls er
  // nah genug dran liegt (2026-08-13, Alex: "Schacht setzen ist aktuell so,
  // dass man den nicht auf die Trasse setzen kann, muss ihn danach immer
  // verschieben") — sonst bleibt die Originalposition (z.B. für einen
  // Aussiedlerhof-Schacht bewusst abseits jeder Trasse). Dieselbe
  // Schnapp-Logik wie beim Ziehen von Trasse-Punkten im Bearbeitungsmodus.
  const snapAufTrasse = useCallback(
    (pos: LatLng): LatLng => findeSchnappziel(pos, trassePfade, -1, -1) ?? pos,
    [trassePfade]
  )

  // ── NVT manuell setzen ────────────────────────────────────────────────────
  function handleNvtSetzenZiel(pos: LatLng) {
    setNeuerNvtPosition(snapAufTrasse(pos))
  }

  function handleNeuerNvtBestaetigen() {
    if (!neuerNvtPosition) return
    onNvtManuellHinzufuegen?.(neuerNvtPosition, neueNvtKapazitaet)
    setNeuerNvtPosition(null)
  }

  function handleNeuerNvtAbbrechen() {
    setNeuerNvtPosition(null)
    onNvtManuellSetzenAbbrechen?.()
  }

  // ── Schacht manuell setzen ────────────────────────────────────────────────
  // Kein Bestätigungsschritt nötig (keine Kapazität abzufragen) — Klick auf
  // die Karte legt den Standort direkt an, analog zum Startpunkt-Setzen.
  function handleSchachtSetzenZiel(pos: LatLng) {
    onSchachtGesetzt?.(snapAufTrasse(pos))
  }

  // ── Hausanschlüsse ────────────────────────────────────────────────────────
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
    setAktivesSegment(null)
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
    borderBottom: border ? '1px solid var(--border-strong)' : 'none',
    color: farbe, fontSize: '14px', cursor: 'pointer', textAlign: 'left',
  })

  // Werkzeug-/Layer-Zeile fürs gebündelte Karten-Panel (2026-08-14, komplette
  // Design-Überarbeitung nach Sitenna-Referenz: EIN abgerundetes, geschichtetes
  // Panel mit Trennlinien statt vieler einzelner freischwebender Buttons).
  const panelZeile = (aktiv: boolean, farbe: string | undefined, label: string, onClick: () => void, key?: string) => (
    <button key={key ?? label} onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-left transition-colors hover:brightness-125"
      style={{ backgroundColor: aktiv && farbe === undefined ? 'var(--accent-blue-dim)' : 'transparent', color: aktiv ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
      {farbe && <span style={{ width: 9, height: 9, borderRadius: '50%', background: farbe, display: 'inline-block', flexShrink: 0, opacity: aktiv ? 1 : 0.4 }} />}
      {label}
    </button>
  )

  const imZeichenModus = !!ziehStartId || !!neuerHsStart || mehrpunktModus

  // Handle-Dezimierung für Groß-Projekt (nur für ausgewähltes Segment)
  const handleSchritt = editPunkte.length > MAX_HANDLES ? Math.ceil(editPunkte.length / MAX_HANDLES) : 1
  const sichtbareHandleIdx: number[] = []
  for (let i = 0; i < editPunkte.length; i++) {
    if (i === 0 || i === editPunkte.length - 1 || i % handleSchritt === 0) sichtbareHandleIdx.push(i)
  }

  return (
    <div className="relative w-full h-full">
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-1000 flex gap-2 items-center">
        <input type="text" value={suchQuery}
          onChange={(e) => { setSuchQuery(e.target.value); setSuchFehler(false) }}
          onKeyDown={(e) => e.key === 'Enter' && handleSuche()}
          placeholder="🔍 Ort oder Adresse suchen…"
          className="w-60 px-4 py-2 text-xs outline-none shadow-lg"
          style={{ backgroundColor: 'var(--surface-1)', color: 'var(--text-primary)', border: `1px solid ${suchFehler ? 'var(--accent-red)' : 'var(--border-subtle)'}`, borderRadius: 999 }} />
        <button onClick={handleSuche} disabled={suchLaden}
          className="px-4 py-2 text-xs font-medium shadow-lg disabled:opacity-50 text-white transition-colors hover:brightness-110"
          style={{ backgroundColor: 'var(--accent-blue)', borderRadius: 999 }}>
          {suchLaden ? '…' : 'Suchen'}
        </button>
        {suchFehler && <span className="text-xs px-2" style={{ color: 'var(--accent-red)' }}>Nicht gefunden</span>}
      </div>

      {/* Gebündeltes Karten-Werkzeug-Panel — ein abgerundeter, geschichteter
          Container mit Trennlinien statt vieler einzelner freischwebender
          Buttons (2026-08-14, komplette Design-Überarbeitung nach
          Sitenna-Referenz + Apple-Formsprache, Alex: "Farben behalten, aber
          Struktur modernisieren"). */}
      <div className="absolute top-3 right-3 z-1000 flex flex-col overflow-hidden shadow-lg"
        style={{ backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', width: 196 }}>
        {panelZeile(tileVariante === 'satellit', undefined, tileVariante === 'satellit' ? '🗺️ Karte' : '🛰️ Satellit', () => setTileVariante((v) => v === 'satellit' ? 'osm' : 'satellit'))}
        {panelZeile(topoSichtbar, undefined, '📐 Topokarte', () => setTopoSichtbar((v) => !v))}
        {panelZeile(ortsnamenSichtbar, undefined, '🏷️ Ortsnamen', () => setOrtsnamenSichtbar((v) => !v))}
        <div style={{ borderTop: '1px solid var(--border-subtle)' }} />
        {panelZeile(trasseSichtbar, trasseFarbe, 'Trasse', () => setTrasseSichtbar((v) => !v))}
        {panelZeile(hausanschluesseSichtbar, hausanschlussfarbe, 'Hausanschlüsse', () => setHausanschluesseSichtbar((v) => !v))}
        {panelZeile(adressenSichtbar, adressFarbe, 'Adressen', () => setAdressenSichtbar((v) => !v))}
        {panelZeile(nvtSichtbar, '#7c3aed', 'NVT', () => setNvtSichtbar((v) => !v))}
        {panelZeile(schachtSichtbar, '#f97316', 'Schacht', () => setSchachtSichtbar((v) => !v))}
      </div>

      {/* Material-Legende (2026-08-13, Alex: "ich seh lauter verschiedene
          Farben, aber ich weiß nicht was was ist") — zeigt Farbe ↔ Material
          aus dem gerade aktiven Katalog-Profil (Firmenstandard/Förderung). */}
      {trasseSichtbar && !editierbarAktiv && trassePfade.length > 0 && (nvtStandorte.length > 0 || schachtStandorte.length > 0) && (
        <div className="absolute bottom-3 left-3 z-1000 rounded-2xl shadow-lg p-2.5 flex flex-col gap-1.5 max-w-56"
          style={{ backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-strong)' }}>
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">Legende — Material</span>
          {[materialProfil.trasse, ...materialProfil.kundenanschlussStufen].map((m, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span style={{ width: 12, height: 3, borderRadius: 2, background: m.farbe, display: 'inline-block', flexShrink: 0 }} />
              <span className="text-[10px] text-gray-300 truncate">
                {m.bezeichnungFirma || lrArtLabel(m.lrArt)}{i === 0 ? ' (Backbone)' : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Klick-Info fürs angeklickte Trasse-Segment (2026-08-13, Alex: "ich
          möchte sehen, welcher Verbund wo langläuft und welche Adresse an
          welchem Verbund hängt") — Hausanschlüsse werden zusätzlich weiß auf
          der Karte hervorgehoben (siehe hausIdZuFarbe). */}
      {trasseSichtbar && !editierbarAktiv && ausgewaehltesSegmentNormal !== null && (() => {
        const material = materialProSegment[ausgewaehltesSegmentNormal]
        const hausIds = [...verbandHausIds]
        const adressenHier = hausIds
          .map((id) => hausanschluesse.find((h) => h.id === id))
          .filter((h): h is Hausstich => !!h)
          .map((h) => adressen.find((a) => a.uuid === h.addressUuid))
          .filter((a): a is Address => !!a)
        const ANZEIGE_LIMIT = 8
        const materialZeile = (m: MaterialEintrag, zusatzLabel?: string) => (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <span style={{ width: 12, height: 3, borderRadius: 2, background: m.farbe, display: 'inline-block', flexShrink: 0 }} />
              <span className="text-xs text-gray-200">{m.bezeichnungFirma || lrArtLabel(m.lrArt)}{zusatzLabel ? ` (${zusatzLabel})` : ''}</span>
            </div>
            <span className="text-[10px] text-gray-500 ml-4.5">
              {m.anzahl}× {lrArtLabel(m.lrArt)}, Reserve {m.reserve} Röhrchen
            </span>
          </div>
        )
        return (
          <div className="absolute bottom-3 left-64 z-1000 rounded-2xl shadow-lg p-2.5 flex flex-col gap-1.5 max-w-64"
            style={{ backgroundColor: 'var(--surface-1)', border: `1px solid ${GELB}` }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                {verbandSegmentIdxs.length > 1 ? `Verband über ${verbandSegmentIdxs.length} Segmente` : `Segment ${ausgewaehltesSegmentNormal + 1}`}
              </span>
              <button onClick={() => setAusgewaehltesSegmentNormal(null)} className="text-xs" style={{ color: 'var(--text-secondary)' }}>✕</button>
            </div>
            {material ? (
              <>
                {materialZeile(material.haupt)}
                {material.zusatz && materialZeile(material.zusatz, 'Doppelbelegung')}
              </>
            ) : (
              <span className="text-xs text-gray-500">Kein Material zugewiesen</span>
            )}
            <span className="text-[10px] text-gray-500">{hausIds.length} Hausanschluss(e) auf diesem Verbund:</span>
            <div className="flex flex-col gap-0.5">
              {adressenHier.slice(0, ANZEIGE_LIMIT).map((a) => (
                <span key={a.uuid} className="text-[10px] text-gray-300 truncate">
                  {a.strasse} {a.nr}{a.nr_zusatz}
                </span>
              ))}
              {adressenHier.length > ANZEIGE_LIMIT && (
                <span className="text-[10px] text-gray-600">… und {adressenHier.length - ANZEIGE_LIMIT} weitere</span>
              )}
            </div>
            {/* Manuelle Material-Übersteuerung (2026-08-21, Alex: "im
                Nachhinein kann ich aber keinen einzigen Verbund
                bearbeiten") — wirkt auf den KOMPLETTEN Verband-Verlauf
                (verbandSegmentIdxs), nicht nur das angeklickte Einzelsegment. */}
            {onMaterialUebersteuern && (
              <div className="flex flex-col gap-1 pt-1" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                {manuellUebersteuertProSegment[ausgewaehltesSegmentNormal] && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px]" style={{ color: '#c084fc' }}>✏️ manuell gesetzt</span>
                    <button
                      onClick={() => { onMaterialUebersteuern(verbandSegmentIdxs, null); setMaterialAuswahlOffen(false) }}
                      className="text-[10px] underline"
                      style={{ color: 'var(--text-secondary)' }}>
                      ↺ Automatisch
                    </button>
                  </div>
                )}
                {materialAuswahlOffen ? (
                  <div className="flex flex-col gap-0.5">
                    {[...materialProfil.kundenanschlussStufen]
                      .sort((a, b) => a.lrAnzahl - b.lrAnzahl)
                      .map((m) => (
                        <button
                          key={m.bezeichnungFirma || m.lrArt}
                          onClick={() => { onMaterialUebersteuern(verbandSegmentIdxs, m); setMaterialAuswahlOffen(false) }}
                          className="flex items-center gap-1.5 px-1.5 py-1 rounded text-left transition-colors hover:brightness-125"
                          style={{ backgroundColor: 'var(--surface-2)' }}>
                          <span style={{ width: 12, height: 3, borderRadius: 2, background: m.farbe, display: 'inline-block', flexShrink: 0 }} />
                          <span className="text-[10px] text-gray-200">{m.bezeichnungFirma || lrArtLabel(m.lrArt)}</span>
                        </button>
                      ))}
                    <button onClick={() => setMaterialAuswahlOffen(false)} className="text-[10px] text-left" style={{ color: 'var(--text-secondary)' }}>
                      ✕ Abbrechen
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setMaterialAuswahlOffen(true)} className="text-[10px] text-left underline" style={{ color: '#93c5fd' }}>
                    ✏️ Material ändern
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {/* Mausover-Übersicht fürs NVT (2026-08-13, Alex: "wenn ich mit der
          Maus draufgeh, soll son kleines Modal aufgehen mit allen wichtigen
          Daten") — zeigt Belegung, hängende Hausanschlüsse und die
          Kundenanschluss-Verbände auf den Zuführungssegmenten, die
          ausschließlich diesem NVT zugeordnet sind (bei geteilten
          Backbone-Segmenten also nicht mitgezählt, da die dort mehreren
          NVTs gleichzeitig dienen). */}
      {hoverNvtIdx !== null && nvtStandorte[hoverNvtIdx] && (() => {
        const nvt = nvtStandorte[hoverNvtIdx]
        const istUeberlastet = nvt.belegung > nvt.kapazitaet
        const auslastung = nvt.kapazitaet > 0 ? Math.round((nvt.belegung / nvt.kapazitaet) * 100) : 0
        const adressenHier = nvt.hausanschlussIds
          .map((id) => hausanschluesse.find((h) => h.id === id))
          .filter((h): h is Hausstich => !!h)
          .map((h) => adressen.find((a) => a.uuid === h.addressUuid))
          .filter((a): a is Address => !!a)
        // beispielSegmentIdx: EIN Segment dieses Materials an diesem NVT —
        // reicht als Startpunkt für ermittleVerbandSegmente() (2026-08-21,
        // Alex: "möchte den Verband markieren komplett, dass ich den
        // Verlauf seh"), das von dort aus selbst den kompletten
        // zusammenhängenden Verlauf ermittelt.
        const verbaende = new Map<string, { material: MaterialEintrag; anzahl: number; beispielSegmentIdx: number }>()
        trassePfade.forEach((_, i) => {
          const ids = hausanschluesseProSegment[i] ?? []
          if (ids.length === 0 || !ids.every((id) => nvt.hausanschlussIds.includes(id))) return
          const m = materialProSegment[i]?.haupt
          if (!m) return
          const key = m.bezeichnungFirma || lrArtLabel(m.lrArt)
          const eintrag = verbaende.get(key)
          if (eintrag) eintrag.anzahl++
          else verbaende.set(key, { material: m, anzahl: 1, beispielSegmentIdx: i })
        })
        const ANZEIGE_LIMIT = 6
        return (
          <div className="absolute bottom-3 right-3 z-1000 rounded-2xl shadow-lg p-2.5 flex flex-col gap-1.5 max-w-64"
            style={{ backgroundColor: 'var(--surface-1)', border: `1px solid ${istUeberlastet ? '#f87171' : '#3b82f6'}` }}
            // Hover bleibt beim Wechsel von Marker zu Panel bestehen, sonst
            // schließt sich das Panel per mouseout am Marker, bevor man
            // einen Verband-Eintrag überhaupt anklicken kann.
            onMouseEnter={() => setHoverNvtIdx(hoverNvtIdx)}
            onMouseLeave={() => setHoverNvtIdx(null)}>
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">NVT {hoverNvtIdx + 1}</span>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-300">Belegung</span>
              <span className="text-xs font-medium" style={{ color: istUeberlastet ? '#f87171' : '#93c5fd' }}>
                {nvt.belegung}/{nvt.kapazitaet} ({auslastung}%){istUeberlastet ? ' ⚠️' : ''}
              </span>
            </div>
            {verbaende.size > 0 && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-gray-500">Verbände auf Zuführung (anklicken für Verlauf):</span>
                {[...verbaende.values()].map(({ material, anzahl, beispielSegmentIdx }) => (
                  <button
                    key={material.bezeichnungFirma || material.lrArt}
                    onClick={() => { setAusgewaehltesSegmentNormal(beispielSegmentIdx); setMaterialAuswahlOffen(false) }}
                    className="flex items-center gap-1.5 text-left transition-colors hover:brightness-125"
                  >
                    <span style={{ width: 12, height: 3, borderRadius: 2, background: material.farbe, display: 'inline-block', flexShrink: 0 }} />
                    <span className="text-[10px] text-gray-300">{anzahl}× {material.bezeichnungFirma || lrArtLabel(material.lrArt)}</span>
                  </button>
                ))}
              </div>
            )}
            <span className="text-[10px] text-gray-500">{adressenHier.length} Hausanschluss(e):</span>
            <div className="flex flex-col gap-0.5">
              {adressenHier.slice(0, ANZEIGE_LIMIT).map((a) => (
                <span key={a.uuid} className="text-[10px] text-gray-300 truncate">
                  {a.strasse} {a.nr}{a.nr_zusatz}
                </span>
              ))}
              {adressenHier.length > ANZEIGE_LIMIT && (
                <span className="text-[10px] text-gray-600">… und {adressenHier.length - ANZEIGE_LIMIT} weitere</span>
              )}
            </div>
          </div>
        )
      })()}

      {/* Mausover-Übersicht fürs Schacht — dieselbe Idee wie beim NVT, aber
          ohne Kapazitätsgrenze (Schacht hat keine, siehe types.ts). */}
      {hoverSchachtIdx !== null && schachtStandorte[hoverSchachtIdx] && (() => {
        const schacht = schachtStandorte[hoverSchachtIdx]
        const adressenHier = schacht.hausanschlussIds
          .map((id) => hausanschluesse.find((h) => h.id === id))
          .filter((h): h is Hausstich => !!h)
          .map((h) => adressen.find((a) => a.uuid === h.addressUuid))
          .filter((a): a is Address => !!a)
        const ANZEIGE_LIMIT = 6
        return (
          <div className="absolute bottom-3 right-3 z-1000 rounded-2xl shadow-lg p-2.5 flex flex-col gap-1.5 max-w-64"
            style={{ backgroundColor: 'var(--surface-1)', border: '1px solid #f97316' }}>
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">Schacht {hoverSchachtIdx + 1}</span>
            <span className="text-[10px] text-gray-500">{adressenHier.length} Hausanschluss(e):</span>
            <div className="flex flex-col gap-0.5">
              {adressenHier.slice(0, ANZEIGE_LIMIT).map((a) => (
                <span key={a.uuid} className="text-[10px] text-gray-300 truncate">
                  {a.strasse} {a.nr}{a.nr_zusatz}
                </span>
              ))}
              {adressenHier.length > ANZEIGE_LIMIT && (
                <span className="text-[10px] text-gray-600">… und {adressenHier.length - ANZEIGE_LIMIT} weitere</span>
              )}
            </div>
          </div>
        )
      })()}

      <MapContainer center={[51.1657, 10.4515]} zoom={6} style={{ height: '100%', width: '100%' }}
        className={startpunktSetzenAktiv || imZeichenModus ? 'cursor-crosshair' : ''}>

        {tileVariante === 'satellit' ? (
          <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="© Esri" maxNativeZoom={19} maxZoom={21} />
        ) : (
          // Standard-OSM-Kacheln — bewusst NICHT eingefärbt (Alex, 2026-08-14:
          // "die Karte an sich selber nicht ändern", Rückbau des dunklen
          // Kartenversuchs aus derselben Design-Überarbeitung).
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='© OpenStreetMap' maxNativeZoom={19} maxZoom={21} />
        )}
        {ortsnamenSichtbar && (
          <TileLayer url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" attribution="© Esri" maxNativeZoom={19} maxZoom={21} />
        )}

        <KlickHandler aktiv={startpunktSetzenAktiv} onKlick={onStartpunktGesetzt}
          ziehModus={!!ziehStartId} onZiehZiel={handleZiehZiel}
          hsZeichenModus={!!neuerHsStart} onHsZeichenZiel={handleNeuerHsZiel}
          nvtSetzenModus={nvtManuellSetzenAktiv && !neuerNvtPosition} onNvtSetzenZiel={handleNvtSetzenZiel}
          schachtSetzenModus={schachtSetzenAktiv} onSchachtSetzenZiel={handleSchachtSetzenZiel}
          mehrpunktModus={mehrpunktModus} onMehrpunktKlick={handleMehrpunktPunkt} onMehrpunktFertig={handleMehrpunktFertig}
          menuOffen={!!aktivMenu} onMenuSchliessen={() => setAktivMenu(null)}
          onMapKlick={() => {
            if (editierbarAktiv && !kleinProjekt) handleDeselect()
            setAusgewaehltesSegmentNormal(null)
          }} />
        <AutoZoom adressen={adressen} />
        <TopographieWMS sichtbar={topoSichtbar} />
        <FlyTo ziel={flugZiel} />

        {/* ── TRASSE: Normal-Modus — nach Kind eingefärbt ── */}
        {trasseSichtbar && !editierbarAktiv && (
          trassePfade.length > 0
            ? (
              <>
                {trassePfadeNachFarbeOhneFeldweg.map(([farbe, pfade]) => (
                  <TrasseNetzwerk key={farbe} pfade={pfade} farbe={farbe} opacity={0.9} />
                ))}
                {/* Doppelbelegung: zwei parallel versetzte Linien statt einer
                    einzelnen, nicht unterscheidbaren Farbe — macht sichtbar,
                    dass hier zwei Verbände auf demselben Segment liegen
                    (Alex, 2026-08-13 / 2026-08-21: Überlagerung war
                    "unübersichtlich"). */}
                {trassePfadeDoppelbelegungZusatz.map(([farbe, pfade]) => (
                  <TrasseNetzwerk key={`db-zusatz-${farbe}`} pfade={pfade} farbe={farbe} opacity={0.9} weight={4} />
                ))}
                {trassePfadeDoppelbelegungHaupt.map(([farbe, pfade]) => (
                  <TrasseNetzwerk key={`db-haupt-${farbe}`} pfade={pfade} farbe={farbe} opacity={0.9} weight={4} />
                ))}
                <TrasseNetzwerk pfade={trassePfadeNurFeldweg} farbe={feldwegFarbe} opacity={0.9} />
                <TrasseKlickbar pfade={trassePfade} ausgewaehlteIdxs={verbandSegmentIdxs}
                  onKlick={handleSegmentNormalKlick} />
              </>
            )
            : trasse.length >= 2
              ? <Polyline positions={trasse.map((p) => [p.lat, p.lng] as [number, number])} pathOptions={{ color: trasseFarbe, weight: 4, opacity: 0.9 }} />
              : null
        )}

        {/* ── TRASSE: Edit-Modus Groß-Projekt (Tap-to-Select) ── */}
        {trasseSichtbar && editierbarAktiv && !kleinProjekt && (
          <>
            {/* Canvas für nicht-ausgewählte Segmente — nach Kind eingefärbt */}
            <TrasseNetzwerk pfade={localPfadeOhneFeldweg} farbe={trasseFarbe} opacity={0.55} />
            <TrasseNetzwerk pfade={localPfadeNurFeldweg} farbe={feldwegFarbe} opacity={0.55} />
            {/* Unsichtbare Klick-Flächen */}
            {localPfade.map((pfad, pi) =>
              pfad.length >= 2 ? (
                <Polyline key={`hit-${pi}`}
                  positions={pfad.map((p) => [p.lat, p.lng] as [number, number])}
                  pathOptions={{ color: '#000', weight: 20, opacity: 0.01 }}
                  eventHandlers={{
                    click: (e) => {
                      L.DomEvent.stopPropagation(e)
                      const pos = { lat: e.latlng.lat, lng: e.latlng.lng }
                      if (mehrpunktModus) { handleMehrpunktPunkt(pos); return }
                      if (ziehStartId) { handleZiehZiel(pos); return }
                      if (neuerHsStart) { handleNeuerHsZiel(pos); return }
                      handleSegmentAuswaehlen(pi)
                      if (editSegmentIdxRef.current === pi) {
                        zeigeMenu(e, [
                          { label: '➕ Punkt einfügen', farbe: '#93c5fd', action: () => { handleEditPunktEinfuegen(pos); setAktivMenu(null) } },
                          { label: '✂️ Verbindung hier trennen', farbe: '#93c5fd', action: () => { handleEditVerbindungTrennen(pos); setAktivMenu(null) } },
                          {
                            label: localPfadeKinds[pi] === 'track' ? '🛣️ Als Straße markieren' : '🚜 Als Feldweg markieren',
                            farbe: '#fbbf24', action: () => { handleSegmentKindToggle(pi); setAktivMenu(null) },
                          },
                          segmentDefinierenMenuEintrag(pi, pos),
                          { label: '🗑️ Segment löschen', farbe: '#f87171', action: () => { handleSegmentLoeschen(); setAktivMenu(null) } },
                        ])
                      }
                    },
                  }} />
              ) : null
            )}
            {/* Gelbe Linie für ausgewähltes Segment (+ breite unsichtbare Tipp-Fläche) */}
            {editSegmentIdx !== null && editPunkte.length >= 2 && (
              <>
                <Polyline key={`yellow-hit-${editSegmentIdx}`}
                  positions={editPunkte.map((p) => [p.lat, p.lng] as [number, number])}
                  pathOptions={{ color: '#000', weight: 20, opacity: 0.01 }}
                  eventHandlers={{
                    click: (e) => {
                      L.DomEvent.stopPropagation(e)
                      if (ziehStartId || neuerHsStart) return
                      const pos = { lat: e.latlng.lat, lng: e.latlng.lng }
                      zeigeMenu(e, [
                        { label: '➕ Punkt einfügen', farbe: '#93c5fd', action: () => { handleEditPunktEinfuegen(pos); setAktivMenu(null) } },
                        { label: '✂️ Verbindung hier trennen', farbe: '#93c5fd', action: () => { handleEditVerbindungTrennen(pos); setAktivMenu(null) } },
                        {
                          label: (editSegmentIdx !== null && localPfadeKinds[editSegmentIdx] === 'track') ? '🛣️ Als Straße markieren' : '🚜 Als Feldweg markieren',
                          farbe: '#fbbf24', action: () => { if (editSegmentIdx !== null) handleSegmentKindToggle(editSegmentIdx); setAktivMenu(null) },
                        },
                        ...(editSegmentIdx !== null ? [segmentDefinierenMenuEintrag(editSegmentIdx, pos)] : []),
                        { label: '🗑️ Segment löschen', farbe: '#f87171', action: () => { handleSegmentLoeschen(); setAktivMenu(null) } },
                      ])
                    },
                  }} />
                <Polyline key={`yellow-${editSegmentIdx}`}
                  positions={editPunkte.map((p) => [p.lat, p.lng] as [number, number])}
                  interactive={false}
                  pathOptions={{ color: GELB, weight: 5, opacity: 1 }} />
              </>
            )}
            {/* Handles nur für ausgewähltes Segment (max MAX_HANDLES) */}
            {editSegmentIdx !== null && sichtbareHandleIdx.map((i) => {
              const p = editPunkte[i]
              if (!p) return null
              const hid = `ep-${editSegmentIdx}-${i}`
              const istAktiv = ziehStartId === hid
              return (
                <Marker key={hid} position={[p.lat, p.lng]} draggable={!imZeichenModus}
                  icon={istAktiv ? editHandleAktivIcon : editHandleIcon}
                  eventHandlers={{
                    click: (e) => {
                      if (e.originalEvent) e.originalEvent.stopPropagation()
                      if (mehrpunktModus) { handleMehrpunktPunkt(p); return }
                      if (ziehStartId) { handleZiehZiel(p); return }
                      if (neuerHsStart) { handleNeuerHsZiel(p); return }
                      zeigeMenu(e, [
                        { label: '🗑️ Punkt löschen', farbe: '#f87171', action: () => { handleEditPunktLoeschen(i); setAktivMenu(null) } },
                        { label: '✏️ Neuer Strich', farbe: '#93c5fd', action: () => { setZiehStartId(hid); setZiehStartPos(p); setAktivMenu(null) } },
                        { label: '📐 Mehrpunkt-Linie', farbe: '#93c5fd', action: () => { setMehrpunktModus(true); setMehrpunktPunkte([p]); setAktivMenu(null) } },
                        segmentDefinierenMenuEintrag(editSegmentIdx, p),
                      ])
                    },
                    dragstart: () => setAktivMenu(null),
                    drag: (e) => {
                      const ll = (e.target as L.Marker).getLatLng()
                      const linienLive = localPfadeRef.current.map((pf, idx) => (idx === editSegmentIdx ? editPunkteRef.current : pf))
                      zeigeSchnappZiel(schnappZielLayerRef, findeSchnappziel({ lat: ll.lat, lng: ll.lng }, linienLive, editSegmentIdx ?? -1, i))
                    },
                    dragend: (e) => {
                      const ll = (e.target as L.Marker).getLatLng()
                      const pos = { lat: ll.lat, lng: ll.lng }
                      const linienLive = localPfadeRef.current.map((pf, idx) => (idx === editSegmentIdx ? editPunkteRef.current : pf))
                      const ziel = findeSchnappziel(pos, linienLive, editSegmentIdx ?? -1, i)
                      handleEditPunktBewegt(i, ziel ?? pos)
                      zeigeSchnappZiel(schnappZielLayerRef, null)
                    },
                  }}>
                  {istAktiv && <Tooltip permanent>Karte antippen → Segment · ESC = Abbrechen</Tooltip>}
                </Marker>
              )
            })}
          </>
        )}

        {/* ── TRASSE: Edit-Modus Klein-Projekt (alle Handles sofort) ── */}
        {trasseSichtbar && editierbarAktiv && kleinProjekt && localPfade.map((pfad, pi) => {
          const segKey = `pfad-${pi}`
          const istAktiv = aktivesSegment === segKey
          if (pfad.length < 2) return null
          const positions = pfad.map((p) => [p.lat, p.lng] as [number, number])
          return (
            <Fragment key={`kp-${pi}`}>
              {/* Breite unsichtbare Klick-/Tipp-Fläche — deutlich einfacher zu treffen als die duenne Linie, wichtig auf Touch-Geraeten */}
              <Polyline key={`kp-hit-${pi}`}
                positions={positions}
                pathOptions={{ color: '#000', weight: 20, opacity: 0.01 }}
                eventHandlers={{
                  click: (e) => {
                    L.DomEvent.stopPropagation(e)
                    const pos = { lat: e.latlng.lat, lng: e.latlng.lng }
                    if (mehrpunktModus) { handleMehrpunktPunkt(pos); return }
                    if (ziehStartId) { handleZiehZiel(pos); return }
                    if (neuerHsStart) { handleNeuerHsZiel(pos); return }
                    setAktivesSegment(segKey)
                    zeigeMenu(e, [
                      { label: '➕ Punkt einfügen', farbe: '#93c5fd', action: () => { handleKleinPunktEinfuegen(pi, pos); setAktivMenu(null) } },
                      { label: '✂️ Verbindung hier trennen', farbe: '#93c5fd', action: () => { handleKleinVerbindungTrennen(pi, pos); setAktivMenu(null) } },
                      {
                        label: localPfadeKinds[pi] === 'track' ? '🛣️ Als Straße markieren' : '🚜 Als Feldweg markieren',
                        farbe: '#fbbf24', action: () => { handleSegmentKindToggle(pi); setAktivMenu(null) },
                      },
                      segmentDefinierenMenuEintrag(pi, pos),
                      { label: '🗑️ Segment löschen', farbe: '#f87171', action: () => { handleKleinSegmentLoeschen(pi); setAktivMenu(null) } },
                    ])
                  },
                }} />
              <Polyline key={`kp-line-${pi}`}
                positions={positions}
                interactive={false}
                pathOptions={{
                  color: istAktiv ? GELB : (localPfadeKinds[pi] === 'track' ? feldwegFarbe : trasseFarbe),
                  weight: istAktiv ? 5 : 4, opacity: 0.95,
                }} />
            </Fragment>
          )
        })}
        {editierbarAktiv && kleinProjekt && localPfade.flatMap((pfad, pi) =>
          pfad.map((p, i) => {
            const hid = `kp-${pi}-${i}`
            const istAktiv = ziehStartId === hid
            return (
              <Marker key={hid} position={[p.lat, p.lng]} draggable={!imZeichenModus}
                icon={istAktiv ? editHandleAktivIcon : editHandleIcon}
                eventHandlers={{
                  click: (e) => {
                    if (e.originalEvent) e.originalEvent.stopPropagation()
                    if (mehrpunktModus) { handleMehrpunktPunkt(p); return }
                    if (ziehStartId) { handleZiehZiel(p); return }
                    if (neuerHsStart) { handleNeuerHsZiel(p); return }
                    zeigeMenu(e, [
                      { label: '🗑️ Punkt löschen', farbe: '#f87171', action: () => { handleKleinPunktLoeschen(pi, i); setAktivMenu(null) } },
                      { label: '✏️ Neuer Strich', farbe: '#93c5fd', action: () => { setZiehStartId(hid); setZiehStartPos(p); setAktivMenu(null) } },
                      { label: '📐 Mehrpunkt-Linie', farbe: '#93c5fd', action: () => { setMehrpunktModus(true); setMehrpunktPunkte([p]); setAktivMenu(null) } },
                      segmentDefinierenMenuEintrag(pi, p),
                    ])
                  },
                  dragstart: () => setAktivMenu(null),
                  drag: (e) => {
                    const ll = (e.target as L.Marker).getLatLng()
                    zeigeSchnappZiel(schnappZielLayerRef, findeSchnappziel({ lat: ll.lat, lng: ll.lng }, localPfadeRef.current, pi, i))
                  },
                  dragend: (e) => {
                    const ll = (e.target as L.Marker).getLatLng()
                    const pos = { lat: ll.lat, lng: ll.lng }
                    const ziel = findeSchnappziel(pos, localPfadeRef.current, pi, i)
                    handleKleinPunktBewegt(pi, i, ziel ?? pos)
                    zeigeSchnappZiel(schnappZielLayerRef, null)
                  },
                }}>
                {istAktiv && <Tooltip permanent>Karte antippen → Segment · ESC = Abbrechen</Tooltip>}
              </Marker>
            )
          })
        )}

        {/* Schnapp-Ziel beim Ziehen eines Punkts — zeigt live, wo genau
            gelandet wird, wenn jetzt losgelassen wird. */}
        <SchnappZielLayer layerRef={schnappZielLayerRef} />

        {/* Mehrpunkt-Linie: live wachsende Vorschau während des Zeichnens */}
        {mehrpunktModus && mehrpunktPunkte.length >= 2 && (
          <Polyline positions={mehrpunktPunkte.map((p) => [p.lat, p.lng] as [number, number])}
            interactive={false} pathOptions={{ color: '#4ade80', weight: 4, opacity: 0.9 }} />
        )}
        {mehrpunktModus && mehrpunktPunkte.map((p, i) => (
          <CircleMarker key={`mp-${i}`} center={[p.lat, p.lng]} radius={5}
            pathOptions={{ color: '#4ade80', fillColor: '#4ade80', fillOpacity: 1, weight: 2 }} />
        ))}

        {/* Adressen */}
        {adressenSichtbar && adressen.map((a) => {
          const aktiv = aktiveOrteKeys.includes(`${a.plz}_${a.ortsname}_${a.ortsteil}`)
          const istHsStart = neuerHsStart?.adresseUuid === a.uuid
          const istNichtAngebunden = nichtAngebundenUuids.has(a.uuid)
          const istAussiedlerhof = aussiedlerhofUuids.has(a.uuid)
          return (
            <CircleMarker key={a.uuid} center={[a.lat, a.lon]}
              radius={istAussiedlerhof ? 9 : istNichtAngebunden ? 9 : istHsStart ? 9 : aktiv ? 6 : 4}
              pathOptions={{
                fillColor: istAussiedlerhof ? '#a16207' : istNichtAngebunden ? '#ef4444' : istHsStart ? '#fbbf24' : aktiv ? adressFarbe : 'var(--text-tertiary)',
                color: istAussiedlerhof ? '#fcd34d' : istNichtAngebunden ? '#fca5a5' : istHsStart ? '#f59e0b' : aktiv ? adressFarbe : '#4b5563',
                weight: istAussiedlerhof ? 3 : istNichtAngebunden ? 3 : istHsStart ? 3 : 1.5,
                fillOpacity: istAussiedlerhof ? 0.95 : istNichtAngebunden ? 0.95 : aktiv ? 0.85 : 0.3,
              }}
              eventHandlers={aussiedlerhofMarkierenAktiv ? {
                click: (e) => {
                  L.DomEvent.stopPropagation(e)
                  onAussiedlerhofToggle?.(a.uuid)
                },
              } : editierbarAktiv ? {
                click: (e) => {
                  L.DomEvent.stopPropagation(e)
                  if (mehrpunktModus) { handleMehrpunktPunkt({ lat: a.lat, lng: a.lon }); return }
                  if (ziehStartId) { handleZiehZiel({ lat: a.lat, lng: a.lon }); return }
                  if (neuerHsStart) {
                    setNeuerHsStart({ adresseUuid: a.uuid, pos: { lat: a.lat, lng: a.lon }, name: `${a.strasse} ${a.nr}` })
                    return
                  }
                  zeigeMenu(e as unknown as L.LeafletMouseEvent, [
                    {
                      label: '🔴 Hausanschluss zeichnen', farbe: '#fca5a5', action: () => {
                        setNeuerHsStart({ adresseUuid: a.uuid, pos: { lat: a.lat, lng: a.lon }, name: `${a.strasse} ${a.nr}` })
                        setAktivMenu(null)
                      }
                    },
                  ])
                },
              } : {}}>
              <Tooltip>{a.strasse} {a.nr}{a.nr_zusatz ? ` ${a.nr_zusatz}` : ''}, {a.ortsname}{istAussiedlerhof ? ' · 🚜 Aussiedlerhof' : ''}</Tooltip>
              {!editierbarAktiv && !aussiedlerhofMarkierenAktiv && (
                <Popup>
                  <div className="text-sm">
                    <p className="font-semibold">{a.strasse} {a.nr}{a.nr_zusatz ? ` ${a.nr_zusatz}` : ''}</p>
                    <p>{a.plz} {a.ortsname}</p>
                    {a.ortsteil && <p className="text-gray-500">{a.ortsteil}</p>}
                    <p className="mt-1 text-blue-600">Haushalte: {a.hh}</p>
                    {istNichtAngebunden && (
                      <p className="mt-1 font-medium" style={{ color: '#dc2626' }}>
                        ⚠️ Nicht angebunden — kein öffentlicher Weg gefunden
                      </p>
                    )}
                    {istAussiedlerhof && (
                      <p className="mt-1 font-medium" style={{ color: '#a16207' }}>
                        🚜 Aussiedlerhof — von 500m-Regel ausgenommen
                      </p>
                    )}
                  </div>
                </Popup>
              )}
            </CircleMarker>
          )
        })}

        {/* NVT-Standorte */}
        {nvtSichtbar && nvtStandorte.map((nvt, i) => {
          const istUeberlastet = nvt.belegung > nvt.kapazitaet
          return (
            <Marker key={`nvt-${i}`} position={[nvt.position.lat, nvt.position.lng]} icon={nvtIcon}
              draggable
              eventHandlers={{
                click: (e) => {
                  if (e.originalEvent) e.originalEvent.stopPropagation()
                  if (backboneVerbindungQuelle) {
                    if (backboneVerbindungQuelle.typ === 'nvt' && backboneVerbindungQuelle.idx === i) return
                    setBackboneVerbindungZiel({ typ: 'nvt', idx: i, position: nvt.position })
                    setBackboneVerbindungMaterial(materialProfil.trasse)
                    return
                  }
                  setAusgewaehltesSchachtIdx(null)
                  setAusgewaehlteNvtIdxs((prev) => {
                    const next = new Set(prev)
                    if (next.has(i)) next.delete(i)
                    else next.add(i)
                    return next
                  })
                },
                contextmenu: (e) => {
                  if (e.originalEvent) e.originalEvent.stopPropagation()
                  zeigeMenu(e, [
                    { label: '🔗 Hausanschlüsse zuweisen', farbe: '#93c5fd', action: () => { setAusgewaehltesSchachtIdx(null); setAusgewaehlteNvtIdxs(new Set([i])); setNvtZuweisenAktiv(true); setAktivMenu(null) } },
                    { label: '🔌 Backbone-Verbindung erstellen', farbe: '#a78bfa', action: () => { setAusgewaehlteNvtIdxs(new Set()); setAusgewaehltesSchachtIdx(null); setBackboneVerbindungQuelle({ typ: 'nvt', idx: i, position: nvt.position }); setAktivMenu(null) } },
                    { label: '🗑️ Standort löschen', farbe: '#f87171', action: () => { onNvtLoeschen?.(i); setAusgewaehlteNvtIdxs(new Set()); setNvtZuweisenAktiv(false); setAktivMenu(null) } },
                  ])
                },
                dragend: (e) => {
                  const ll = (e.target as L.Marker).getLatLng()
                  onNvtVerschoben?.(i, snapAufTrasse({ lat: ll.lat, lng: ll.lng }))
                },
                mouseover: () => setHoverNvtIdx(i),
                mouseout: () => setHoverNvtIdx((prev) => (prev === i ? null : prev)),
              }}>
              <Tooltip>
                NVT {i + 1} · {nvt.belegung}/{nvt.kapazitaet} belegt{istUeberlastet ? ' · ⚠️ überbelegt' : ''}
                {ausgewaehlteNvtIdxs.has(i) ? ' · Hausanschlüsse markiert' : ' · ziehen zum Verschieben · antippen zum Markieren (mehrere gleichzeitig möglich) · lang drücken für Aktionen'}
              </Tooltip>
            </Marker>
          )
        })}

        {/* Schacht-Standorte */}
        {schachtSichtbar && schachtStandorte.map((schacht, i) => (
          <Marker key={`schacht-${i}`} position={[schacht.position.lat, schacht.position.lng]} icon={schachtIcon}
            draggable
            eventHandlers={{
              click: (e) => {
                if (e.originalEvent) e.originalEvent.stopPropagation()
                if (backboneVerbindungQuelle) {
                  if (backboneVerbindungQuelle.typ === 'schacht' && backboneVerbindungQuelle.idx === i) return
                  setBackboneVerbindungZiel({ typ: 'schacht', idx: i, position: schacht.position })
                  setBackboneVerbindungMaterial(materialProfil.trasse)
                  return
                }
                setAusgewaehlteNvtIdxs(new Set())
                setAusgewaehltesSchachtIdx((prev) => (prev === i ? null : i))
              },
              contextmenu: (e) => {
                if (e.originalEvent) e.originalEvent.stopPropagation()
                zeigeMenu(e, [
                  { label: '🔗 Hausanschlüsse zuweisen', farbe: '#93c5fd', action: () => { setAusgewaehlteNvtIdxs(new Set()); setAusgewaehltesSchachtIdx(i); setSchachtZuweisenAktiv(true); setAktivMenu(null) } },
                  { label: '🔌 Backbone-Verbindung erstellen', farbe: '#a78bfa', action: () => { setAusgewaehlteNvtIdxs(new Set()); setAusgewaehltesSchachtIdx(null); setBackboneVerbindungQuelle({ typ: 'schacht', idx: i, position: schacht.position }); setAktivMenu(null) } },
                  { label: '🗑️ Standort löschen', farbe: '#f87171', action: () => { onSchachtLoeschen?.(i); setAusgewaehltesSchachtIdx(null); setSchachtZuweisenAktiv(false); setAktivMenu(null) } },
                ])
              },
              dragend: (e) => {
                const ll = (e.target as L.Marker).getLatLng()
                onSchachtVerschoben?.(i, snapAufTrasse({ lat: ll.lat, lng: ll.lng }))
              },
              mouseover: () => setHoverSchachtIdx(i),
              mouseout: () => setHoverSchachtIdx((prev) => (prev === i ? null : prev)),
            }}>
            <Tooltip>
              Schacht {i + 1}{schacht.hausanschlussIds.length > 0 ? ` · ${schacht.hausanschlussIds.length} Hausanschluss(e)` : ''}
              {ausgewaehltesSchachtIdx === i ? ' · Hausanschlüsse markiert' : ' · ziehen zum Verschieben · antippen zum Markieren · lang drücken für Aktionen'}
            </Tooltip>
          </Marker>
        ))}

        {startpunkt && <Marker position={[startpunkt.lat, startpunkt.lng]} icon={startpunktIcon}><Tooltip>Startpunkt</Tooltip></Marker>}

        {/* Hausanschlüsse */}
        {hausanschluesseSichtbar && hausanschluesse.map((h) => {
          const wp = hausstichWp(h)
          const segKey = `hs-${h.id}`
          const istAktiv = aktivesSegment === segKey
          const hervorhebungsFarbe = hausIdZuFarbe.get(h.id)
          const istHervorgehoben = hervorhebungsFarbe !== undefined
          const positions = wp.map((p) => [p.lat, p.lng] as [number, number])
          const hsKlick = (e: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(e)
            if (neuerHsStart) return
            const pos = { lat: e.latlng.lat, lng: e.latlng.lng }
            if (!kleinProjekt) handleDeselect()
            setAktivesSegment(segKey)
            zeigeMenu(e, [
              { label: '➕ Punkt einfügen', farbe: '#93c5fd', action: () => { handleHsPunktEinfuegen(h.id, pos); setAktivMenu(null) } },
              { label: '🗑️ Linie löschen', farbe: '#f87171', action: () => { handleHsLoeschen(h.id); setAktivMenu(null) } },
            ])
          }
          const hsZuweisenKlick = (e: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(e)
            if (zuweisenZielNvtIdx !== null) onNvtHausanschlussToggle?.(zuweisenZielNvtIdx, h.id)
          }
          const hsSchachtZuweisenKlick = (e: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(e)
            if (ausgewaehltesSchachtIdx !== null) onSchachtHausanschlussToggle?.(ausgewaehltesSchachtIdx, h.id)
          }
          const zuweisenModusAktiv = (nvtZuweisenAktiv && zuweisenZielNvtIdx !== null) || (schachtZuweisenAktiv && ausgewaehltesSchachtIdx !== null)
          const klickHandler = nvtZuweisenAktiv && zuweisenZielNvtIdx !== null
            ? { click: hsZuweisenKlick }
            : schachtZuweisenAktiv && ausgewaehltesSchachtIdx !== null
              ? { click: hsSchachtZuweisenKlick }
              : editierbarAktiv ? { click: hsKlick } : {}
          return (
            <Fragment key={h.id}>
              <Polyline positions={positions}
                pathOptions={{
                  color: istAktiv ? GELB : hervorhebungsFarbe ?? hausanschlussfarbe,
                  weight: istAktiv ? (editierbarAktiv ? 7 : 6) : istHervorgehoben ? 6 : (editierbarAktiv ? 3 : 2),
                  opacity: 0.95,
                }}
                eventHandlers={klickHandler}>
                <Tooltip>
                  {zuweisenModusAktiv ? (istHervorgehoben ? 'Antippen = entfernen · ' : 'Antippen = zuweisen · ') : editierbarAktiv ? 'Antippen = Menü · ' : ''}
                  Hausanschluss: {h.laengeMeter.toFixed(1)} m
                </Tooltip>
              </Polyline>
              {/* Breite unsichtbare Tipp-Fläche — die duenne HS-Linie ist auf Touch-Geraeten schwer zu treffen */}
              {(editierbarAktiv || zuweisenModusAktiv) && (
                <Polyline positions={positions}
                  pathOptions={{ color: '#000', weight: 18, opacity: 0.01 }}
                  eventHandlers={klickHandler} />
              )}
            </Fragment>
          )
        })}

        {/* HS-Handles */}
        {hausanschluesseSichtbar && editierbarAktiv && hausanschluesse.flatMap((h) => {
          const wp = hausstichWp(h)
          return wp.map((p, idx) => {
            const isFirst = idx === 0, isLast = idx === wp.length - 1
            const icon = isFirst ? hsHausIcon : isLast ? hsTrasseIcon : editHandleIcon
            return (
              <Marker key={`hs-wp-${h.id}-${idx}`} position={[p.lat, p.lng]} draggable={!imZeichenModus} icon={icon}
                eventHandlers={{
                  click: (e) => {
                    if (e.originalEvent) e.originalEvent.stopPropagation()
                    if (mehrpunktModus) { handleMehrpunktPunkt(p); return }
                    if (ziehStartId) { handleZiehZiel(p); return }
                    if (neuerHsStart) { handleNeuerHsZiel(p); return }
                    zeigeMenu(e, [
                      { label: '🗑️ Punkt löschen', farbe: '#f87171', action: () => { handleHsPunktLoeschen(h.id, idx); setAktivMenu(null) } },
                    ])
                  },
                  dragstart: () => setAktivMenu(null),
                  dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); handleHsWpBewegen(h.id, idx, { lat: ll.lat, lng: ll.lng }) },
                }}>
                <Tooltip>{isFirst ? '🏠 Haus-Ende' : isLast ? '📡 Kabel-Ende' : 'Zwischenpunkt'}</Tooltip>
              </Marker>
            )
          })
        })}
      </MapContainer>

      {startpunktSetzenAktiv && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 px-4 py-2 rounded-lg text-sm font-medium shadow-lg"
          style={{ backgroundColor: 'var(--surface-1)', color: 'var(--text-primary)', border: '1px solid #3b82f6' }}>
          Klick auf die Karte, um den Startpunkt zu setzen
        </div>
      )}

      {aussiedlerhofMarkierenAktiv && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 px-4 py-2 rounded-lg text-sm font-medium shadow-lg flex items-center gap-3"
          style={{ backgroundColor: 'var(--surface-1)', color: 'var(--text-primary)', border: '1px solid #a16207' }}>
          🚜 Adressen anklicken zum Markieren/Entmarkieren als Aussiedlerhof
          <button onClick={() => onAussiedlerhofMarkierenFertig?.()}
            className="px-3 py-1 rounded text-xs font-medium"
            style={{ backgroundColor: 'var(--accent-amber)', color: '#fff' }}>
            ✓ Fertig
          </button>
        </div>
      )}

      {nvtManuellSetzenAktiv && !neuerNvtPosition && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 px-4 py-2 rounded-lg text-sm font-medium shadow-lg flex items-center gap-3"
          style={{ backgroundColor: 'var(--surface-1)', color: 'var(--text-primary)', border: '1px solid #3b82f6' }}>
          📍 Klick auf die Karte, um einen NVT-Standort zu setzen
          <button onClick={handleNeuerNvtAbbrechen}
            className="px-3 py-1 rounded text-xs font-medium"
            style={{ backgroundColor: 'var(--surface-3)', color: 'var(--text-primary)' }}>
            ✕ Abbrechen
          </button>
        </div>
      )}

      {neuerNvtPosition && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 rounded-2xl shadow-lg p-3 flex flex-col gap-2.5"
          style={{ backgroundColor: 'var(--surface-1)', border: '1px solid #3b82f6', width: 280 }}>
          <span className="text-sm font-medium text-white">📍 Kapazität für neuen NVT</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {[7, 12, 24, 96, 120].map((k) => (
              <button key={k} onClick={() => setNeueNvtKapazitaet(k)}
                className="px-2.5 py-1 rounded text-xs font-medium transition-colors"
                style={{
                  backgroundColor: neueNvtKapazitaet === k ? '#1e3a5f' : 'var(--surface-2)',
                  color: neueNvtKapazitaet === k ? '#93c5fd' : 'var(--text-secondary)',
                  border: `1px solid ${neueNvtKapazitaet === k ? '#3b82f6' : 'var(--border-strong)'}`,
                }}>
                {k}
              </button>
            ))}
            <input type="number" min={1} value={neueNvtKapazitaet}
              onChange={(e) => setNeueNvtKapazitaet(Number(e.target.value) || 1)}
              className="w-16 px-2 py-1 rounded text-sm outline-none"
              style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)' }} />
          </div>
          <div className="flex gap-2">
            <button onClick={handleNeuerNvtBestaetigen}
              className="flex-1 px-3 py-1.5 rounded text-xs font-medium"
              style={{ backgroundColor: 'var(--accent-blue)', color: '#fff' }}>
              ✓ Anlegen
            </button>
            <button onClick={handleNeuerNvtAbbrechen}
              className="flex-1 px-3 py-1.5 rounded text-xs font-medium"
              style={{ backgroundColor: 'var(--surface-3)', color: 'var(--text-primary)' }}>
              ✕ Abbrechen
            </button>
          </div>
        </div>
      )}

      {nvtZuweisenAktiv && zuweisenZielNvtIdx !== null && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 px-4 py-2 rounded-lg text-sm font-medium shadow-lg flex items-center gap-3"
          style={{ backgroundColor: 'var(--surface-1)', color: 'var(--text-primary)', border: '1px solid #3b82f6' }}>
          🔗 Hausanschlüsse anklicken zum Zuweisen/Entfernen (NVT {zuweisenZielNvtIdx + 1})
          <button onClick={() => setNvtZuweisenAktiv(false)}
            className="px-3 py-1 rounded text-xs font-medium"
            style={{ backgroundColor: 'var(--accent-blue)', color: '#fff' }}>
            ✓ Fertig
          </button>
        </div>
      )}

      {schachtZuweisenAktiv && ausgewaehltesSchachtIdx !== null && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 px-4 py-2 rounded-lg text-sm font-medium shadow-lg flex items-center gap-3"
          style={{ backgroundColor: 'var(--surface-1)', color: 'var(--text-primary)', border: '1px solid #0d9488' }}>
          🔗 Hausanschlüsse anklicken zum Zuweisen/Entfernen (Schacht {ausgewaehltesSchachtIdx + 1})
          <button onClick={() => setSchachtZuweisenAktiv(false)}
            className="px-3 py-1 rounded text-xs font-medium"
            style={{ backgroundColor: 'var(--accent-teal)', color: '#fff' }}>
            ✓ Fertig
          </button>
        </div>
      )}

      {schachtSetzenAktiv && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 px-4 py-2 rounded-lg text-sm font-medium shadow-lg flex items-center gap-3"
          style={{ backgroundColor: 'var(--surface-1)', color: 'var(--text-primary)', border: '1px solid #0d9488' }}>
          🕳️ Klick auf die Karte, um einen Schacht zu setzen
          <button onClick={() => onSchachtSetzenAbbrechen?.()}
            className="px-3 py-1 rounded text-xs font-medium"
            style={{ backgroundColor: 'var(--surface-3)', color: 'var(--text-primary)' }}>
            ✕ Abbrechen
          </button>
        </div>
      )}

      {/* Backbone-Verbindung erstellen (2026-08-13) — Schritt 1: Ziel wählen. */}
      {backboneVerbindungQuelle && !backboneVerbindungZiel && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 px-4 py-2 rounded-lg text-sm font-medium shadow-lg flex items-center gap-3"
          style={{ backgroundColor: 'var(--surface-1)', color: 'var(--text-primary)', border: '1px solid #a78bfa' }}>
          🔌 Ziel-NVT/Schacht anklicken für Backbone-Verbindung ab {backboneVerbindungQuelle.typ === 'nvt' ? 'NVT' : 'Schacht'} {backboneVerbindungQuelle.idx + 1}
          <button onClick={backboneVerbindungAbbrechen}
            className="px-3 py-1 rounded text-xs font-medium"
            style={{ backgroundColor: 'var(--surface-3)', color: 'var(--text-primary)' }}>
            ✕ Abbrechen
          </button>
        </div>
      )}

      {/* Schritt 2: Material wählen — jede im aktiven Katalog-Profil
          hinterlegte Sorte steht zur Auswahl (Backbone-Material + alle
          Kundenanschluss-Stufen), nicht nur das eine feste Backbone-Material
          (Alex: "kann man dann alles auswählen, was hinterlegt wurde"). Die
          Route wird beim Bestätigen über das echte Straßennetz berechnet
          (siehe onBackboneVerbindungErstellen in page.tsx) — kann ein paar
          Sekunden dauern, daher schließt der Dialog sofort und ein separater
          Fortschritts-/Fehler-Hinweis übernimmt (siehe unten). */}
      {backboneVerbindungQuelle && backboneVerbindungZiel && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 rounded-2xl shadow-lg p-3 flex flex-col gap-2.5"
          style={{ backgroundColor: 'var(--surface-1)', border: '1px solid #a78bfa', width: 300 }}>
          <span className="text-sm font-medium text-white">
            🔌 {backboneVerbindungQuelle.typ === 'nvt' ? 'NVT' : 'Schacht'} {backboneVerbindungQuelle.idx + 1} → {backboneVerbindungZiel.typ === 'nvt' ? 'NVT' : 'Schacht'} {backboneVerbindungZiel.idx + 1}
          </span>
          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
            {[materialProfil.trasse, ...materialProfil.kundenanschlussStufen].map((m) => (
              <button key={m.bezeichnungFirma || m.lrArt} onClick={() => setBackboneVerbindungMaterial(m)}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded text-xs font-medium text-left transition-colors"
                style={{
                  backgroundColor: backboneVerbindungMaterial === m ? '#3b2f5f' : 'var(--surface-2)',
                  color: backboneVerbindungMaterial === m ? '#c4b5fd' : 'var(--text-secondary)',
                  border: `1px solid ${backboneVerbindungMaterial === m ? '#a78bfa' : 'var(--border-strong)'}`,
                }}>
                <span style={{ width: 12, height: 3, borderRadius: 2, background: m.farbe, display: 'inline-block', flexShrink: 0 }} />
                {m.bezeichnungFirma || lrArtLabel(m.lrArt)}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (!backboneVerbindungMaterial) return
                onBackboneVerbindungErstellen?.(backboneVerbindungQuelle.position, backboneVerbindungZiel.position, backboneVerbindungMaterial)
                backboneVerbindungAbbrechen()
              }}
              disabled={!backboneVerbindungMaterial}
              className="flex-1 px-3 py-1.5 rounded text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#a78bfa', color: 'var(--surface-1)' }}>
              ✓ Verbindung erstellen
            </button>
            <button onClick={backboneVerbindungAbbrechen}
              className="flex-1 px-3 py-1.5 rounded text-xs font-medium"
              style={{ backgroundColor: 'var(--surface-3)', color: 'var(--text-primary)' }}>
              ✕ Abbrechen
            </button>
          </div>
        </div>
      )}

      {backboneVerbindungLaeuft && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 px-4 py-2 rounded-lg text-sm font-medium shadow-lg"
          style={{ backgroundColor: 'var(--surface-1)', color: 'var(--text-primary)', border: '1px solid #a78bfa' }}>
          🔌 Backbone-Verbindung wird über das Straßennetz berechnet …
        </div>
      )}

      {backboneVerbindungFehler && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 px-4 py-2 rounded-lg text-sm font-medium shadow-lg flex items-center gap-3"
          style={{ backgroundColor: 'var(--surface-1)', color: '#fca5a5', border: '1px solid #dc2626' }}>
          ⚠️ {backboneVerbindungFehler}
          <button onClick={() => onBackboneVerbindungFehlerSchliessen?.()}
            className="px-3 py-1 rounded text-xs font-medium"
            style={{ backgroundColor: 'var(--surface-3)', color: 'var(--text-primary)' }}>
            ✕
          </button>
        </div>
      )}

      {trasseMethode && !editierbarAktiv && (() => {
        // Reihenfolge wichtig: erst eindeutige Präfixe prüfen, erst danach
        // auf "sonst = Erfolg" schließen — sonst rutschen Fallback-/Hinweis-
        // Meldungen fälschlich in den Erfolgs-Zweig (Grün trotz Fallback).
        const istFehler = trasseMethode.startsWith('Fehler') || trasseMethode.startsWith('Erweiterung fehlgeschlagen')
        const istFallback = !istFehler && trasseMethode.startsWith('Fallback:')
        const istHinweis = !istFehler && !istFallback && trasseMethode.startsWith('Hinweis:')

        const farbe = istFehler ? '#f87171' : istFallback ? '#93c5fd' : istHinweis ? 'var(--text-secondary)' : '#4ade80'
        const rand = istFehler ? '#dc2626' : istFallback ? '#2563eb' : istHinweis ? '#4b5563' : '#16a34a'
        const icon = istFehler ? '❌' : istFallback ? '🔁' : istHinweis ? 'ℹ️' : '✅'

        return (
          <div className="absolute bottom-4 right-3 z-1000 px-3 py-1.5 rounded-lg text-xs shadow-lg max-w-xs"
            style={{ backgroundColor: 'var(--surface-1)', color: farbe, border: `1px solid ${rand}` }}>
            {icon} {trasseMethode}
            {istFehler && <div style={{ marginTop: 4, color: '#fca5a5' }}>Straßendaten nicht verfügbar — bitte erneut versuchen</div>}
            {istFallback && <div style={{ marginTop: 4, color: '#bfdbfe' }}>Weniger präzise als OSM-Routing — bei Gelegenheit erneut versuchen</div>}
          </div>
        )
      })()}

      {nichtAngebundeneAdressen.length > 0 && warnModalOffen && (
        <div className="absolute inset-0 z-1000 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-2xl shadow-lg p-4" style={{ backgroundColor: 'var(--surface-1)', border: '1px solid #dc2626', width: 340, maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold" style={{ color: '#f87171' }}>
                ⚠️ {nichtAngebundeneAdressen.length} Adresse(n) nicht angebunden
              </span>
              <button onClick={() => setWarnModalOffen(false)}
                className="text-xs px-2 py-1 rounded" style={{ color: 'var(--text-secondary)' }}>✕</button>
            </div>
            <p className="text-xs mb-2" style={{ color: '#d1d5db' }}>
              Kein öffentlicher Weg (Straße/Feldweg) im OSM-Netz gefunden — bitte im Edit-Modus manuell anbinden.
            </p>
            <div className="overflow-y-auto" style={{ flex: 1 }}>
              {nichtAngebundeneAdressen.map((a) => (
                <div key={a.uuid} className="flex items-center justify-between text-xs py-1.5"
                  style={{ borderBottom: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}>
                  <span>{a.strasse} {a.nr}{a.nr_zusatz ? ` ${a.nr_zusatz}` : ''}, {a.ortsname}</span>
                  <button
                    onClick={() => { setFlugZiel({ lat: a.lat, lng: a.lon }); setWarnModalOffen(false) }}
                    className="ml-2 px-2 py-1 rounded text-xs font-medium shrink-0"
                    style={{ backgroundColor: '#dc2626', color: '#fff' }}>
                    📍 Zur Adresse
                  </button>
                </div>
              ))}
            </div>
            <button onClick={() => setWarnModalOffen(false)}
              className="mt-3 px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ backgroundColor: 'var(--surface-3)', color: 'var(--text-primary)', border: 'none' }}>
              Schließen
            </button>
          </div>
        </div>
      )}

      {/* Kontextmenü */}
      {aktivMenu && !imZeichenModus && (
        <div style={{
          position: 'absolute',
          left: Math.min(aktivMenu.screenX + 16, window.innerWidth - 185),
          top: Math.max(aktivMenu.screenY - aktivMenu.aktionen.length * 46 - 26, 60),
          zIndex: 2000, backgroundColor: 'var(--surface-1)',
          border: `1px solid ${aktivesSegment ? GELB : 'var(--border-strong)'}`,
          borderRadius: '10px', overflow: 'hidden',
          boxShadow: '0 8px 24px rgba(0,0,0,0.9)', minWidth: '170px',
        }}>
          {aktivMenu.aktionen.map((a, idx) => (
            <button key={idx} onPointerDown={(e) => { e.stopPropagation(); a.action() }}
              style={btnStyle(a.farbe, idx < aktivMenu.aktionen.length - 1)}>
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* Bearbeitungs-Banner */}
      {editierbarAktiv && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 rounded-2xl shadow-lg"
          style={{
            backgroundColor: mehrpunktModus ? '#022c22' : segmentStart ? '#052e2b' : ziehStartId ? '#431407' : neuerHsStart ? '#1a1207' : 'var(--surface-2)',
            border: `1px solid ${mehrpunktModus ? '#4ade80' : segmentStart ? '#4ade80' : ziehStartId ? '#f97316' : neuerHsStart ? '#fbbf24' : aktivesSegment ? GELB : 'var(--border-strong)'}`,
            padding: '10px 16px', maxWidth: '92vw',
          }}>
          {mehrpunktModus ? (
            <p style={{ color: '#bbf7d0', fontSize: 12, margin: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              📐 <b>Mehrpunkt-Linie</b> — {mehrpunktPunkte.length} Punkt{mehrpunktPunkte.length === 1 ? '' : 'e'} &nbsp;·&nbsp; Karte/Punkt antippen = weiterer Punkt &nbsp;·&nbsp; Doppelklick = fertig
              <button onClick={handleMehrpunktUndo} disabled={mehrpunktPunkte.length === 0}
                style={{ background: 'var(--border-strong)', color: 'var(--text-primary)', border: 'none', borderRadius: '6px', padding: '3px 10px', cursor: mehrpunktPunkte.length === 0 ? 'default' : 'pointer', fontSize: 11, opacity: mehrpunktPunkte.length === 0 ? 0.5 : 1 }}>
                ↩ Letzten Punkt entfernen
              </button>
              <button onClick={handleMehrpunktFertig} disabled={mehrpunktPunkte.length < 2}
                style={{ background: mehrpunktPunkte.length < 2 ? 'var(--border-strong)' : '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', padding: '3px 10px', cursor: mehrpunktPunkte.length < 2 ? 'default' : 'pointer', fontSize: 11, opacity: mehrpunktPunkte.length < 2 ? 0.5 : 1 }}>
                ✅ Fertig
              </button>
              <button onClick={handleMehrpunktAbbrechen}
                style={{ background: 'var(--border-strong)', color: 'var(--text-primary)', border: 'none', borderRadius: '6px', padding: '3px 10px', cursor: 'pointer', fontSize: 11 }}>
                ✕ Abbrechen
              </button>
            </p>
          ) : segmentStart ? (
            <p style={{ color: '#bbf7d0', fontSize: 12, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              📍 <b>Segment-Start gesetzt</b> — zweiten Punkt auf demselben Abschnitt antippen für Segment-Ende
              <button onClick={() => setSegmentStart(null)}
                style={{ background: 'var(--border-strong)', color: 'var(--text-primary)', border: 'none', borderRadius: '6px', padding: '3px 10px', cursor: 'pointer', fontSize: 11 }}>
                ✕ Abbrechen
              </button>
            </p>
          ) : ziehStartId ? (
            <p style={{ color: '#fed7aa', fontSize: 12, margin: 0 }}>
              🖊️ <b>Zeichenmodus</b> — Auf Karte tippen = neues Segment &nbsp;·&nbsp; Punkt antippen = verbinden &nbsp;·&nbsp; ESC
            </p>
          ) : neuerHsStart ? (
            <p style={{ color: '#fde68a', fontSize: 12, margin: 0 }}>
              🏠 <b>Hausanschluss zeichnen</b> — {neuerHsStart.name} &nbsp;·&nbsp; Ziel antippen &nbsp;·&nbsp; ESC
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <p style={{ color: '#d1d5db', fontSize: 12, margin: 0 }}>
                <span style={{ color: '#93c5fd', fontWeight: 600 }}>
                  {kleinProjekt ? '✏️ Klein-Projekt' : '✏️ Groß-Projekt'} — Trasse &amp; Hausanschlüsse bearbeiten
                </span>
                {aktivesSegment && <span style={{ color: GELB, marginLeft: 8, fontWeight: 600 }}>● Segment markiert</span>}
              </p>
              <p style={{ color: 'var(--text-secondary)', fontSize: 11, margin: 0 }}>
                {kleinProjekt
                  ? <><b style={{ color: '#d1d5db' }}>Punkt ziehen</b> → verschieben &nbsp;·&nbsp; <b style={{ color: '#d1d5db' }}>Punkt antippen</b> → Menü &nbsp;·&nbsp; <b style={{ color: '#d1d5db' }}>Linie antippen</b> → Menü</>
                  : <><b style={{ color: '#d1d5db' }}>Segment antippen</b> → <span style={{ color: GELB }}>gelb</span> + Handles &nbsp;·&nbsp; <b style={{ color: '#d1d5db' }}>Punkt ziehen</b> → verschieben &nbsp;·&nbsp; <b style={{ color: '#d1d5db' }}>ESC</b> → Auswahl aufheben</>
                }
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

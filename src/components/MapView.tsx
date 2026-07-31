'use client'

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MapContainer, TileLayer, CircleMarker, Marker, Polyline,
  Tooltip, Popup, useMapEvents, useMap,
} from 'react-leaflet'
import L from 'leaflet'
import * as turf from '@turf/turf'
import 'leaflet/dist/leaflet.css'
import { Address, LatLng, Hausstich, WegKind, NvtStandort, SchachtStandort } from '../lib/types'

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
  html: '<div style="width:14px;height:14px;background:#0d9488;border:2px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.8)"></div>',
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
const MAX_HANDLES = 80
// Schwellenwert: ≤ 1000 Punkte → Klein-Projekt (alle Handles sofort sichtbar)
const KLEIN_PROJEKT_SCHWELLE = 1000

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
  trassePfadeKinds: WegKind[]
  trasseMethode?: string
  nichtAngebundeneAdressen?: Address[]
  aussiedlerhofUuids?: Set<string>
  aussiedlerhofMarkierenAktiv?: boolean
  nvtStandorte?: NvtStandort[]
  nvtManuellSetzenAktiv?: boolean
  schachtStandorte?: SchachtStandort[]
  schachtSetzenAktiv?: boolean
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
}

function KlickHandler({
  aktiv, onKlick, ziehModus, onZiehZiel, hsZeichenModus, onHsZeichenZiel,
  nvtSetzenModus, onNvtSetzenZiel, schachtSetzenModus, onSchachtSetzenZiel,
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
  menuOffen?: boolean
  onMenuSchliessen?: () => void
  onMapKlick?: () => void
}) {
  useMapEvents({
    click(e) {
      if (menuOffen) { onMenuSchliessen?.(); return }
      const pos = { lat: e.latlng.lat, lng: e.latlng.lng }
      if (ziehModus && onZiehZiel) onZiehZiel(pos)
      else if (hsZeichenModus && onHsZeichenZiel) onHsZeichenZiel(pos)
      else if (nvtSetzenModus && onNvtSetzenZiel) onNvtSetzenZiel(pos)
      else if (schachtSetzenModus && onSchachtSetzenZiel) onSchachtSetzenZiel(pos)
      else if (aktiv) onKlick(pos)
      else onMapKlick?.()
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
  feldwegFarbe, trassePfadeKinds,
  nichtAngebundeneAdressen = [],
  aussiedlerhofUuids = new Set(), aussiedlerhofMarkierenAktiv = false, nvtStandorte = [],
  nvtManuellSetzenAktiv = false, schachtStandorte = [], schachtSetzenAktiv = false,
  onStartpunktGesetzt, onTrasseGeaendert, onTrassePfadeGeaendert, onHausanschluesseGeaendert,
  onAussiedlerhofToggle, onAussiedlerhofMarkierenFertig,
  onNvtManuellHinzufuegen, onNvtManuellSetzenAbbrechen, onNvtLoeschen, onNvtHausanschlussToggle, onNvtVerschoben,
  onSchachtGesetzt, onSchachtSetzenAbbrechen, onSchachtLoeschen, onSchachtHausanschlussToggle, onSchachtVerschoben,
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

  // Welches NVT/Schacht ist gerade angeklickt — markiert dessen Hausanschlüsse
  // auf der Karte. Beide Auswahlen schließen sich gegenseitig aus (siehe
  // Klick-Handler der jeweiligen Marker weiter unten).
  const [ausgewaehltesNvtIdx, setAusgewaehltesNvtIdx] = useState<number | null>(null)
  const [ausgewaehltesSchachtIdx, setAusgewaehltesSchachtIdx] = useState<number | null>(null)
  const hervorgehobeneHausIds = useMemo(() => {
    if (ausgewaehltesNvtIdx !== null) return new Set(nvtStandorte[ausgewaehltesNvtIdx]?.hausanschlussIds ?? [])
    if (ausgewaehltesSchachtIdx !== null) return new Set(schachtStandorte[ausgewaehltesSchachtIdx]?.hausanschlussIds ?? [])
    return new Set<string>()
  }, [ausgewaehltesNvtIdx, nvtStandorte, ausgewaehltesSchachtIdx, schachtStandorte])
  // Manuelles NVT setzen: nach Klick auf die Karte erst Kapazität abfragen,
  // bevor der Standort wirklich angelegt wird.
  const [neuerNvtPosition, setNeuerNvtPosition] = useState<LatLng | null>(null)
  const [neueNvtKapazitaet, setNeueNvtKapazitaet] = useState(24)
  // Zuweisen-Modus: Hausanschlüsse anklicken ordnet sie dem ausgewählten NVT/Schacht zu.
  const [nvtZuweisenAktiv, setNvtZuweisenAktiv] = useState(false)
  const [schachtZuweisenAktiv, setSchachtZuweisenAktiv] = useState(false)

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

  const [deletedStack, setDeletedStack] = useState<Hausstich[]>([])
  const [ziehStartId, setZiehStartId] = useState<string | null>(null)
  const [ziehStartPos, setZiehStartPos] = useState<LatLng | null>(null)
  const [aktivMenu, setAktivMenu] = useState<AktivMenu>(null)
  const [neuerHsStart, setNeuerHsStart] = useState<NeuerHsStart>(null)
  const [aktivesSegment, setAktivesSegment] = useState<string | null>(null)
  // Manuelle Segment-Definition: erster Klick merkt sich Pfad+Position als
  // Start, zweiter Klick auf DEMSELBEN Pfad schneidet den Abschnitt dazwischen
  // als eigenständiges Segment heraus (für den Export wichtig).
  const [segmentStart, setSegmentStart] = useState<{ pfadIdx: number; pos: LatLng } | null>(null)

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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editierbarAktiv])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setZiehStartId(null); setZiehStartPos(null)
      setNeuerHsStart(null); setAktivMenu(null)
      setSegmentStart(null)
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

  // ── NVT manuell setzen ────────────────────────────────────────────────────
  function handleNvtSetzenZiel(pos: LatLng) {
    setNeuerNvtPosition(pos)
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
    onSchachtGesetzt?.(pos)
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
    borderBottom: border ? '1px solid #374151' : 'none',
    color: farbe, fontSize: '14px', cursor: 'pointer', textAlign: 'left',
  })

  const layerBtnStyle = (aktiv: boolean): React.CSSProperties => ({
    backgroundColor: aktiv ? '#1e3a5f' : '#1a1a1a', color: '#f9fafb',
    border: `1px solid ${aktiv ? '#3b82f6' : '#374151'}`, opacity: aktiv ? 1 : 0.55,
  })

  const imZeichenModus = !!ziehStartId || !!neuerHsStart

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
          placeholder="Ort oder Adresse suchen…"
          className="w-56 px-3 py-1.5 rounded-lg text-xs outline-none shadow-lg"
          style={{ backgroundColor: '#1a1a1a', color: '#f9fafb', border: `1px solid ${suchFehler ? '#ef4444' : '#374151'}` }} />
        <button onClick={handleSuche} disabled={suchLaden}
          className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg disabled:opacity-50"
          style={{ backgroundColor: '#3b82f6', color: '#fff', border: 'none' }}>
          {suchLaden ? '…' : '🔍'}
        </button>
        {suchFehler && <span className="text-xs" style={{ color: '#ef4444' }}>Nicht gefunden</span>}
      </div>

      <div className="absolute top-3 right-3 z-1000 flex flex-col gap-2">
        <button onClick={() => setTileVariante((v) => v === 'satellit' ? 'osm' : 'satellit')}
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
          className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg flex items-center gap-1.5"
          style={layerBtnStyle(trasseSichtbar)}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: trasseFarbe, display: 'inline-block', flexShrink: 0 }} />Trasse
        </button>
        <button onClick={() => setHausanschluesseSichtbar((v) => !v)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg flex items-center gap-1.5"
          style={layerBtnStyle(hausanschluesseSichtbar)}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: hausanschlussfarbe, display: 'inline-block', flexShrink: 0 }} />Hausanschlüsse
        </button>
        <button onClick={() => setAdressenSichtbar((v) => !v)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg flex items-center gap-1.5"
          style={layerBtnStyle(adressenSichtbar)}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: adressFarbe, display: 'inline-block', flexShrink: 0 }} />Adressen
        </button>
      </div>

      <MapContainer center={[51.1657, 10.4515]} zoom={6} style={{ height: '100%', width: '100%' }}
        className={startpunktSetzenAktiv || imZeichenModus ? 'cursor-crosshair' : ''}>

        {tileVariante === 'satellit' ? (
          <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="© Esri" maxNativeZoom={19} maxZoom={21} />
        ) : (
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
          menuOffen={!!aktivMenu} onMenuSchliessen={() => setAktivMenu(null)}
          onMapKlick={editierbarAktiv && !kleinProjekt ? handleDeselect : undefined} />
        <AutoZoom adressen={adressen} />
        <TopographieWMS sichtbar={topoSichtbar} />
        <FlyTo ziel={flugZiel} />

        {/* ── TRASSE: Normal-Modus — nach Kind eingefärbt ── */}
        {trasseSichtbar && !editierbarAktiv && (
          trassePfade.length > 0
            ? (
              <>
                <TrasseNetzwerk pfade={trassePfade.filter((_, i) => trassePfadeKinds[i] !== 'track')} farbe={trasseFarbe} opacity={0.9} />
                <TrasseNetzwerk pfade={trassePfade.filter((_, i) => trassePfadeKinds[i] === 'track')} farbe={feldwegFarbe} opacity={0.9} />
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
            <TrasseNetzwerk
              pfade={localPfade.filter((_, i) => i !== editSegmentIdx && localPfadeKinds[i] !== 'track')}
              farbe={trasseFarbe} opacity={0.55} />
            <TrasseNetzwerk
              pfade={localPfade.filter((_, i) => i !== editSegmentIdx && localPfadeKinds[i] === 'track')}
              farbe={feldwegFarbe} opacity={0.55} />
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
                      if (ziehStartId) { handleZiehZiel(p); return }
                      if (neuerHsStart) { handleNeuerHsZiel(p); return }
                      zeigeMenu(e, [
                        { label: '🗑️ Punkt löschen', farbe: '#f87171', action: () => { handleEditPunktLoeschen(i); setAktivMenu(null) } },
                        { label: '✏️ Neuer Strich', farbe: '#93c5fd', action: () => { setZiehStartId(hid); setZiehStartPos(p); setAktivMenu(null) } },
                      ])
                    },
                    dragstart: () => setAktivMenu(null),
                    dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); handleEditPunktBewegt(i, { lat: ll.lat, lng: ll.lng }) },
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
                    if (ziehStartId) { handleZiehZiel(p); return }
                    if (neuerHsStart) { handleNeuerHsZiel(p); return }
                    zeigeMenu(e, [
                      { label: '🗑️ Punkt löschen', farbe: '#f87171', action: () => { handleKleinPunktLoeschen(pi, i); setAktivMenu(null) } },
                      { label: '✏️ Neuer Strich', farbe: '#93c5fd', action: () => { setZiehStartId(hid); setZiehStartPos(p); setAktivMenu(null) } },
                    ])
                  },
                  dragstart: () => setAktivMenu(null),
                  dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); handleKleinPunktBewegt(pi, i, { lat: ll.lat, lng: ll.lng }) },
                }}>
                {istAktiv && <Tooltip permanent>Karte antippen → Segment · ESC = Abbrechen</Tooltip>}
              </Marker>
            )
          })
        )}

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
                fillColor: istAussiedlerhof ? '#a16207' : istNichtAngebunden ? '#ef4444' : istHsStart ? '#fbbf24' : aktiv ? adressFarbe : '#6b7280',
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
        {nvtStandorte.map((nvt, i) => {
          const istUeberlastet = nvt.belegung > nvt.kapazitaet
          return (
            <Marker key={`nvt-${i}`} position={[nvt.position.lat, nvt.position.lng]} icon={nvtIcon}
              draggable
              eventHandlers={{
                click: (e) => {
                  if (e.originalEvent) e.originalEvent.stopPropagation()
                  setAusgewaehltesSchachtIdx(null)
                  setAusgewaehltesNvtIdx((prev) => (prev === i ? null : i))
                },
                contextmenu: (e) => {
                  if (e.originalEvent) e.originalEvent.stopPropagation()
                  zeigeMenu(e, [
                    { label: '🔗 Hausanschlüsse zuweisen', farbe: '#93c5fd', action: () => { setAusgewaehltesSchachtIdx(null); setAusgewaehltesNvtIdx(i); setNvtZuweisenAktiv(true); setAktivMenu(null) } },
                    { label: '🗑️ Standort löschen', farbe: '#f87171', action: () => { onNvtLoeschen?.(i); setAusgewaehltesNvtIdx(null); setNvtZuweisenAktiv(false); setAktivMenu(null) } },
                  ])
                },
                dragend: (e) => {
                  const ll = (e.target as L.Marker).getLatLng()
                  onNvtVerschoben?.(i, { lat: ll.lat, lng: ll.lng })
                },
              }}>
              <Tooltip>
                NVT {i + 1} · {nvt.belegung}/{nvt.kapazitaet} belegt{istUeberlastet ? ' · ⚠️ überbelegt' : ''}
                {ausgewaehltesNvtIdx === i ? ' · Hausanschlüsse markiert' : ' · ziehen zum Verschieben · antippen zum Markieren · lang drücken für Aktionen'}
              </Tooltip>
            </Marker>
          )
        })}

        {/* Schacht-Standorte */}
        {schachtStandorte.map((schacht, i) => (
          <Marker key={`schacht-${i}`} position={[schacht.position.lat, schacht.position.lng]} icon={schachtIcon}
            draggable
            eventHandlers={{
              click: (e) => {
                if (e.originalEvent) e.originalEvent.stopPropagation()
                setAusgewaehltesNvtIdx(null)
                setAusgewaehltesSchachtIdx((prev) => (prev === i ? null : i))
              },
              contextmenu: (e) => {
                if (e.originalEvent) e.originalEvent.stopPropagation()
                zeigeMenu(e, [
                  { label: '🔗 Hausanschlüsse zuweisen', farbe: '#93c5fd', action: () => { setAusgewaehltesNvtIdx(null); setAusgewaehltesSchachtIdx(i); setSchachtZuweisenAktiv(true); setAktivMenu(null) } },
                  { label: '🗑️ Standort löschen', farbe: '#f87171', action: () => { onSchachtLoeschen?.(i); setAusgewaehltesSchachtIdx(null); setSchachtZuweisenAktiv(false); setAktivMenu(null) } },
                ])
              },
              dragend: (e) => {
                const ll = (e.target as L.Marker).getLatLng()
                onSchachtVerschoben?.(i, { lat: ll.lat, lng: ll.lng })
              },
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
          const istHervorgehoben = hervorgehobeneHausIds.has(h.id)
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
            if (ausgewaehltesNvtIdx !== null) onNvtHausanschlussToggle?.(ausgewaehltesNvtIdx, h.id)
          }
          const hsSchachtZuweisenKlick = (e: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(e)
            if (ausgewaehltesSchachtIdx !== null) onSchachtHausanschlussToggle?.(ausgewaehltesSchachtIdx, h.id)
          }
          const zuweisenModusAktiv = (nvtZuweisenAktiv && ausgewaehltesNvtIdx !== null) || (schachtZuweisenAktiv && ausgewaehltesSchachtIdx !== null)
          const klickHandler = nvtZuweisenAktiv && ausgewaehltesNvtIdx !== null
            ? { click: hsZuweisenKlick }
            : schachtZuweisenAktiv && ausgewaehltesSchachtIdx !== null
              ? { click: hsSchachtZuweisenKlick }
              : editierbarAktiv ? { click: hsKlick } : {}
          return (
            <Fragment key={h.id}>
              <Polyline positions={positions}
                pathOptions={{
                  color: istAktiv ? GELB : istHervorgehoben ? '#22d3ee' : hausanschlussfarbe,
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
          style={{ backgroundColor: '#1a1a1a', color: '#f9fafb', border: '1px solid #3b82f6' }}>
          Klick auf die Karte, um den Startpunkt zu setzen
        </div>
      )}

      {aussiedlerhofMarkierenAktiv && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 px-4 py-2 rounded-lg text-sm font-medium shadow-lg flex items-center gap-3"
          style={{ backgroundColor: '#1a1a1a', color: '#f9fafb', border: '1px solid #a16207' }}>
          🚜 Adressen anklicken zum Markieren/Entmarkieren als Aussiedlerhof
          <button onClick={() => onAussiedlerhofMarkierenFertig?.()}
            className="px-3 py-1 rounded text-xs font-medium"
            style={{ backgroundColor: '#a16207', color: '#fff' }}>
            ✓ Fertig
          </button>
        </div>
      )}

      {segmentStart && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 px-4 py-2 rounded-lg text-sm font-medium shadow-lg flex items-center gap-3"
          style={{ backgroundColor: '#1a1a1a', color: '#f9fafb', border: '1px solid #4ade80' }}>
          📍 Segment-Start gesetzt — zweiten Punkt auf demselben Abschnitt antippen für Segment-Ende
          <button onClick={() => setSegmentStart(null)}
            className="px-3 py-1 rounded text-xs font-medium"
            style={{ backgroundColor: '#374151', color: '#f9fafb' }}>
            ✕ Abbrechen
          </button>
        </div>
      )}

      {nvtManuellSetzenAktiv && !neuerNvtPosition && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 px-4 py-2 rounded-lg text-sm font-medium shadow-lg flex items-center gap-3"
          style={{ backgroundColor: '#1a1a1a', color: '#f9fafb', border: '1px solid #3b82f6' }}>
          📍 Klick auf die Karte, um einen NVT-Standort zu setzen
          <button onClick={handleNeuerNvtAbbrechen}
            className="px-3 py-1 rounded text-xs font-medium"
            style={{ backgroundColor: '#374151', color: '#f9fafb' }}>
            ✕ Abbrechen
          </button>
        </div>
      )}

      {neuerNvtPosition && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 rounded-lg shadow-lg p-3 flex flex-col gap-2.5"
          style={{ backgroundColor: '#1a1a1a', border: '1px solid #3b82f6', width: 280 }}>
          <span className="text-sm font-medium text-white">📍 Kapazität für neuen NVT</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {[7, 12, 24, 96, 120].map((k) => (
              <button key={k} onClick={() => setNeueNvtKapazitaet(k)}
                className="px-2.5 py-1 rounded text-xs font-medium transition-colors"
                style={{
                  backgroundColor: neueNvtKapazitaet === k ? '#1e3a5f' : '#111827',
                  color: neueNvtKapazitaet === k ? '#93c5fd' : '#9ca3af',
                  border: `1px solid ${neueNvtKapazitaet === k ? '#3b82f6' : '#374151'}`,
                }}>
                {k}
              </button>
            ))}
            <input type="number" min={1} value={neueNvtKapazitaet}
              onChange={(e) => setNeueNvtKapazitaet(Number(e.target.value) || 1)}
              className="w-16 px-2 py-1 rounded text-sm outline-none"
              style={{ backgroundColor: '#111827', color: '#f9fafb', border: '1px solid #374151' }} />
          </div>
          <div className="flex gap-2">
            <button onClick={handleNeuerNvtBestaetigen}
              className="flex-1 px-3 py-1.5 rounded text-xs font-medium"
              style={{ backgroundColor: '#3b82f6', color: '#fff' }}>
              ✓ Anlegen
            </button>
            <button onClick={handleNeuerNvtAbbrechen}
              className="flex-1 px-3 py-1.5 rounded text-xs font-medium"
              style={{ backgroundColor: '#374151', color: '#f9fafb' }}>
              ✕ Abbrechen
            </button>
          </div>
        </div>
      )}

      {nvtZuweisenAktiv && ausgewaehltesNvtIdx !== null && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 px-4 py-2 rounded-lg text-sm font-medium shadow-lg flex items-center gap-3"
          style={{ backgroundColor: '#1a1a1a', color: '#f9fafb', border: '1px solid #3b82f6' }}>
          🔗 Hausanschlüsse anklicken zum Zuweisen/Entfernen (NVT {ausgewaehltesNvtIdx + 1})
          <button onClick={() => setNvtZuweisenAktiv(false)}
            className="px-3 py-1 rounded text-xs font-medium"
            style={{ backgroundColor: '#3b82f6', color: '#fff' }}>
            ✓ Fertig
          </button>
        </div>
      )}

      {schachtZuweisenAktiv && ausgewaehltesSchachtIdx !== null && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 px-4 py-2 rounded-lg text-sm font-medium shadow-lg flex items-center gap-3"
          style={{ backgroundColor: '#1a1a1a', color: '#f9fafb', border: '1px solid #0d9488' }}>
          🔗 Hausanschlüsse anklicken zum Zuweisen/Entfernen (Schacht {ausgewaehltesSchachtIdx + 1})
          <button onClick={() => setSchachtZuweisenAktiv(false)}
            className="px-3 py-1 rounded text-xs font-medium"
            style={{ backgroundColor: '#0d9488', color: '#fff' }}>
            ✓ Fertig
          </button>
        </div>
      )}

      {schachtSetzenAktiv && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 px-4 py-2 rounded-lg text-sm font-medium shadow-lg flex items-center gap-3"
          style={{ backgroundColor: '#1a1a1a', color: '#f9fafb', border: '1px solid #0d9488' }}>
          🕳️ Klick auf die Karte, um einen Schacht zu setzen
          <button onClick={() => onSchachtSetzenAbbrechen?.()}
            className="px-3 py-1 rounded text-xs font-medium"
            style={{ backgroundColor: '#374151', color: '#f9fafb' }}>
            ✕ Abbrechen
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

        const farbe = istFehler ? '#f87171' : istFallback ? '#93c5fd' : istHinweis ? '#9ca3af' : '#4ade80'
        const rand = istFehler ? '#dc2626' : istFallback ? '#2563eb' : istHinweis ? '#4b5563' : '#16a34a'
        const icon = istFehler ? '❌' : istFallback ? '🔁' : istHinweis ? 'ℹ️' : '✅'

        return (
          <div className="absolute bottom-4 right-3 z-1000 px-3 py-1.5 rounded-lg text-xs shadow-lg max-w-xs"
            style={{ backgroundColor: '#1a1a1a', color: farbe, border: `1px solid ${rand}` }}>
            {icon} {trasseMethode}
            {istFehler && <div style={{ marginTop: 4, color: '#fca5a5' }}>Straßendaten nicht verfügbar — bitte erneut versuchen</div>}
            {istFallback && <div style={{ marginTop: 4, color: '#bfdbfe' }}>Weniger präzise als OSM-Routing — bei Gelegenheit erneut versuchen</div>}
          </div>
        )
      })()}

      {nichtAngebundeneAdressen.length > 0 && warnModalOffen && (
        <div className="absolute inset-0 z-1000 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-lg shadow-lg p-4" style={{ backgroundColor: '#1a1a1a', border: '1px solid #dc2626', width: 340, maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold" style={{ color: '#f87171' }}>
                ⚠️ {nichtAngebundeneAdressen.length} Adresse(n) nicht angebunden
              </span>
              <button onClick={() => setWarnModalOffen(false)}
                className="text-xs px-2 py-1 rounded" style={{ color: '#9ca3af' }}>✕</button>
            </div>
            <p className="text-xs mb-2" style={{ color: '#d1d5db' }}>
              Kein öffentlicher Weg (Straße/Feldweg) im OSM-Netz gefunden — bitte im Edit-Modus manuell anbinden.
            </p>
            <div className="overflow-y-auto" style={{ flex: 1 }}>
              {nichtAngebundeneAdressen.map((a) => (
                <div key={a.uuid} className="flex items-center justify-between text-xs py-1.5"
                  style={{ borderBottom: '1px solid #374151', color: '#f9fafb' }}>
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
              style={{ backgroundColor: '#374151', color: '#f9fafb', border: 'none' }}>
              Schließen
            </button>
          </div>
        </div>
      )}

      {/* Kontextmenü */}
      {aktivMenu && !imZeichenModus && (
        <div style={{
          position: 'absolute',
          left: Math.min(aktivMenu.screenX - 50, window.innerWidth - 185),
          top: Math.max(aktivMenu.screenY - aktivMenu.aktionen.length * 46 - 10, 60),
          zIndex: 2000, backgroundColor: '#1a1a1a',
          border: `1px solid ${aktivesSegment ? GELB : '#374151'}`,
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
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-1000 rounded-lg shadow-lg"
          style={{
            backgroundColor: ziehStartId ? '#431407' : neuerHsStart ? '#1a1207' : '#111827',
            border: `1px solid ${ziehStartId ? '#f97316' : neuerHsStart ? '#fbbf24' : aktivesSegment ? GELB : '#374151'}`,
            padding: '10px 16px', maxWidth: '92vw',
          }}>
          {ziehStartId ? (
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
              <p style={{ color: '#9ca3af', fontSize: 11, margin: 0 }}>
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

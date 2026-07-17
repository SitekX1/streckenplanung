'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
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
  trasseMethode?: string
  onStartpunktGesetzt: (punkt: LatLng) => void
  onTrasseGeaendert: (punkte: LatLng[]) => void
  onTrassePfadeGeaendert: (pfade: LatLng[][]) => void
  onHausanschluesseGeaendert: (updated: Hausstich[]) => void
}

function KlickHandler({
  aktiv, onKlick, ziehModus, onZiehZiel, hsZeichenModus, onHsZeichenZiel,
  menuOffen, onMenuSchliessen, onMapKlick,
}: {
  aktiv: boolean
  onKlick: (p: LatLng) => void
  ziehModus?: boolean
  onZiehZiel?: (p: LatLng) => void
  hsZeichenModus?: boolean
  onHsZeichenZiel?: (p: LatLng) => void
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
  onStartpunktGesetzt, onTrasseGeaendert, onTrassePfadeGeaendert, onHausanschluesseGeaendert,
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

  // Lokale Arbeitskopie der Pfade im Edit-Modus
  const [localPfade, setLocalPfade] = useState<LatLng[][]>([])
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

  const trasseRef = useRef<LatLng[]>([])
  const trassePfadeRef = useRef<LatLng[][]>([])
  const localPfadeRef = useRef<LatLng[][]>([])
  const editSegmentIdxRef = useRef<number | null>(null)
  const editPunkteRef = useRef<LatLng[]>([])
  const prevEditRef = useRef(false)
  const editiertRef = useRef(false)
  const startedWithSingleRef = useRef(false)

  useEffect(() => { trasseRef.current = trasse }, [trasse])
  useEffect(() => { trassePfadeRef.current = trassePfade }, [trassePfade])
  useEffect(() => { localPfadeRef.current = localPfade }, [localPfade])
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

      if (pfade.length > 0) {
        startedWithSingleRef.current = false
        const kopie = pfade.map((pf) => [...pf])
        const gesamtPunkte = kopie.reduce((s, pf) => s + pf.length, 0)
        setKleinProjekt(gesamtPunkte <= KLEIN_PROJEKT_SCHWELLE)
        localPfadeRef.current = kopie
        setLocalPfade(kopie)
      } else if (t.length >= 2) {
        startedWithSingleRef.current = true
        const kopie = [[...t]]
        setKleinProjekt(t.length <= KLEIN_PROJEKT_SCHWELLE)
        localPfadeRef.current = kopie
        setLocalPfade(kopie)
      } else {
        startedWithSingleRef.current = false
        setKleinProjekt(false)
        localPfadeRef.current = []
        setLocalPfade([])
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
        const gueltig = finalPfade.filter((pf) => pf.length >= 2)
        if (startedWithSingleRef.current && gueltig.length === 1) {
          onTrasseGeaendert(gueltig[0])
        } else {
          onTrassePfadeGeaendert(gueltig)
        }
      }
      localPfadeRef.current = []
      setLocalPfade([])
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editierbarAktiv])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setZiehStartId(null); setZiehStartPos(null)
      setNeuerHsStart(null); setAktivMenu(null)
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
    const neuePfade = localPfadeRef.current.map((pf, pi) => {
      if (pi !== pfadIdx) return pf
      if (pf.length <= 2) return [] as LatLng[]
      return pf.filter((_, i) => i !== punktIdx)
    }).filter((pf) => pf.length >= 2)
    localPfadeRef.current = neuePfade
    setLocalPfade(neuePfade)
    setAktivesSegment(null)
  }

  function handleKleinSegmentLoeschen(pfadIdx: number) {
    editiertRef.current = true
    const neuePfade = localPfadeRef.current.filter((_, i) => i !== pfadIdx)
    localPfadeRef.current = neuePfade
    setLocalPfade(neuePfade)
    setAktivesSegment(null)
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
          menuOffen={!!aktivMenu} onMenuSchliessen={() => setAktivMenu(null)}
          onMapKlick={editierbarAktiv && !kleinProjekt ? handleDeselect : undefined} />
        <AutoZoom adressen={adressen} />
        <TopographieWMS sichtbar={topoSichtbar} />
        <FlyTo ziel={flugZiel} />

        {/* ── TRASSE: Normal-Modus ── */}
        {trasseSichtbar && !editierbarAktiv && (
          trassePfade.length > 0
            ? <TrasseNetzwerk pfade={trassePfade} farbe={trasseFarbe} opacity={0.9} />
            : trasse.length >= 2
              ? <Polyline positions={trasse.map((p) => [p.lat, p.lng] as [number, number])} pathOptions={{ color: trasseFarbe, weight: 4, opacity: 0.9 }} />
              : null
        )}

        {/* ── TRASSE: Edit-Modus Groß-Projekt (Tap-to-Select) ── */}
        {trasseSichtbar && editierbarAktiv && !kleinProjekt && (
          <>
            {/* Canvas für nicht-ausgewählte Segmente */}
            <TrasseNetzwerk
              pfade={localPfade.filter((_, i) => i !== editSegmentIdx)}
              farbe={trasseFarbe} opacity={0.55} />
            {/* Unsichtbare Klick-Flächen */}
            {localPfade.map((pfad, pi) =>
              pfad.length >= 2 ? (
                <Polyline key={`hit-${pi}`}
                  positions={pfad.map((p) => [p.lat, p.lng] as [number, number])}
                  pathOptions={{ color: '#000', weight: 14, opacity: 0.01 }}
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
                          { label: '🗑️ Segment löschen', farbe: '#f87171', action: () => { handleSegmentLoeschen(); setAktivMenu(null) } },
                        ])
                      }
                    },
                  }} />
              ) : null
            )}
            {/* Gelbe Linie für ausgewähltes Segment */}
            {editSegmentIdx !== null && editPunkte.length >= 2 && (
              <Polyline key={`yellow-${editSegmentIdx}`}
                positions={editPunkte.map((p) => [p.lat, p.lng] as [number, number])}
                pathOptions={{ color: GELB, weight: 5, opacity: 1 }}
                eventHandlers={{
                  click: (e) => {
                    L.DomEvent.stopPropagation(e)
                    if (ziehStartId || neuerHsStart) return
                    const pos = { lat: e.latlng.lat, lng: e.latlng.lng }
                    zeigeMenu(e, [
                      { label: '➕ Punkt einfügen', farbe: '#93c5fd', action: () => { handleEditPunktEinfuegen(pos); setAktivMenu(null) } },
                      { label: '✂️ Verbindung hier trennen', farbe: '#93c5fd', action: () => { handleEditVerbindungTrennen(pos); setAktivMenu(null) } },
                      { label: '🗑️ Segment löschen', farbe: '#f87171', action: () => { handleSegmentLoeschen(); setAktivMenu(null) } },
                    ])
                  },
                }} />
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
          return pfad.length >= 2 ? (
            <Polyline key={`kp-line-${pi}`}
              positions={pfad.map((p) => [p.lat, p.lng] as [number, number])}
              pathOptions={{ color: istAktiv ? GELB : trasseFarbe, weight: istAktiv ? 5 : 4, opacity: 0.95 }}
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
                    { label: '🗑️ Segment löschen', farbe: '#f87171', action: () => { handleKleinSegmentLoeschen(pi); setAktivMenu(null) } },
                  ])
                },
              }} />
          ) : null
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
          return (
            <CircleMarker key={a.uuid} center={[a.lat, a.lon]}
              radius={istHsStart ? 9 : aktiv ? 6 : 4}
              pathOptions={{
                fillColor: istHsStart ? '#fbbf24' : aktiv ? adressFarbe : '#6b7280',
                color: istHsStart ? '#f59e0b' : aktiv ? adressFarbe : '#4b5563',
                weight: istHsStart ? 3 : 1.5, fillOpacity: aktiv ? 0.85 : 0.3,
              }}
              eventHandlers={editierbarAktiv ? {
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

        {/* Hausanschlüsse */}
        {hausanschluesseSichtbar && hausanschluesse.map((h) => {
          const wp = hausstichWp(h)
          const segKey = `hs-${h.id}`
          const istAktiv = aktivesSegment === segKey
          return (
            <Polyline key={h.id} positions={wp.map((p) => [p.lat, p.lng] as [number, number])}
              pathOptions={{
                color: istAktiv ? GELB : hausanschlussfarbe,
                weight: istAktiv ? (editierbarAktiv ? 7 : 6) : (editierbarAktiv ? 3 : 2),
                opacity: 0.95,
              }}
              eventHandlers={editierbarAktiv ? {
                click: (e) => {
                  L.DomEvent.stopPropagation(e)
                  if (neuerHsStart) return
                  const pos = { lat: e.latlng.lat, lng: e.latlng.lng }
                  if (!kleinProjekt) handleDeselect()
                  setAktivesSegment(segKey)
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

      {trasseMethode && !editierbarAktiv && (
        <div className="absolute bottom-4 right-3 z-1000 px-3 py-1.5 rounded-lg text-xs shadow-lg max-w-xs"
          style={{
            backgroundColor: '#1a1a1a',
            color: trasseMethode.startsWith('Fehler') || trasseMethode.startsWith('Erweiterung fehlgeschlagen') ? '#f87171' : trasseMethode.includes('Erweitert') || trasseMethode.startsWith('ORS') ? '#4ade80' : '#fbbf24',
            border: `1px solid ${trasseMethode.startsWith('Fehler') || trasseMethode.startsWith('Erweiterung fehlgeschlagen') ? '#dc2626' : trasseMethode.includes('Erweitert') || trasseMethode.startsWith('ORS') ? '#16a34a' : '#d97706'}`,
          }}>
          {trasseMethode.startsWith('Fehler') || trasseMethode.startsWith('Erweiterung fehlgeschlagen') ? '❌' : '✅'} {trasseMethode}
          {(trasseMethode.startsWith('Fehler') || trasseMethode.startsWith('Erweiterung fehlgeschlagen')) && <div style={{ marginTop: 4, color: '#fca5a5' }}>Straßendaten nicht verfügbar — bitte erneut versuchen</div>}
        </div>
      )}

      {/* Kontextmenü */}
      {editierbarAktiv && aktivMenu && !imZeichenModus && (
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

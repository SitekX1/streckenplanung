'use client'

import dynamic from 'next/dynamic'
import { useState, useCallback } from 'react'
import Sidebar from '../components/Sidebar'
import NVTModal from '../components/NVTModal'
import { Address, LatLng, Hausstich, OrtInfo, WegKind, NvtStandort, SchachtStandort } from '../lib/types'
import { parseExcelFile } from '../lib/excelParser'
import { berechneGrenzen, fetchOsmNetz } from '../lib/overpassClient'
import { buildRoadGraph } from '../lib/roadGraph'
import { berechneSteinerBaum } from '../lib/steinerbaum'
import { berechneBaumORS } from '../lib/baumOrs'
import { berechneHausanschluesse, berechneLaengen } from '../lib/hausanschluesse'
import { exportKML } from '../lib/kmlExport'
import { exportShapefile } from '../lib/shapefileExport'
import { exportProjekt, importProjekt } from '../lib/projektSpeichern'
import { berechneNvtStandorte } from '../lib/nvt'

const MapView = dynamic(() => import('../components/MapView'), { ssr: false })

function extractOrte(adressen: Address[]): OrtInfo[] {
  const map = new Map<string, OrtInfo>()
  for (const a of adressen) {
    const key = `${a.plz}_${a.ortsname}_${a.ortsteil}`
    const name = [a.ortsname, a.ortsteil].filter(Boolean).join(' – ') || a.plz
    if (!map.has(key)) map.set(key, { key, name, plz: a.plz, anzahl: 0 })
    map.get(key)!.anzahl++
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

// Reduziert eine Punktliste auf max. maxCount Punkte (gleichmäßig verteilt,
// letzter Punkt bleibt immer erhalten) — begrenzt die Kosten von
// graph.nearestPointOnGraph() bei sehr langen bestehenden Trassen.
function sampleMitStride<T>(arr: T[], maxCount: number): T[] {
  if (arr.length <= maxCount) return arr
  const stride = Math.ceil(arr.length / maxCount)
  const result: T[] = []
  for (let i = 0; i < arr.length; i += stride) result.push(arr[i])
  if (result[result.length - 1] !== arr[arr.length - 1]) result.push(arr[arr.length - 1])
  return result
}

// Entfernt doppelte Straßensegmente aus allen Pfaden und baut das Netz als echten Baum.
// Gleiche Segmente (unabhängig von der Richtung) werden nur einmal behalten.
function deduplicatePfade(pfade: LatLng[][]): LatLng[][] {
  if (pfade.length <= 1) return pfade
  const r = (v: number) => Math.round(v * 100000) / 100000 // ~1m Präzision
  const nk = (p: LatLng) => `${r(p.lat)},${r(p.lng)}`
  const seen = new Set<string>()
  const edges: [LatLng, LatLng][] = []
  const pos = new Map<string, LatLng>()
  for (const pfad of pfade) {
    for (let i = 0; i < pfad.length - 1; i++) {
      const a = pfad[i], b = pfad[i + 1]
      const ka = nk(a), kb = nk(b)
      if (ka === kb) continue
      pos.set(ka, a); pos.set(kb, b)
      const sk = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
      if (!seen.has(sk)) { seen.add(sk); edges.push([a, b]) }
    }
  }
  if (edges.length === 0) return pfade
  // Adjazenzliste aufbauen
  const adj = new Map<string, Array<{ k: string; i: number }>>()
  for (let i = 0; i < edges.length; i++) {
    const ka = nk(edges[i][0]), kb = nk(edges[i][1])
    if (!adj.has(ka)) adj.set(ka, [])
    if (!adj.has(kb)) adj.set(kb, [])
    adj.get(ka)!.push({ k: kb, i }); adj.get(kb)!.push({ k: ka, i })
  }
  // Ketten rekonstruieren: Blätter (Grad 1) zuerst, dann Kreuzungen
  const used = new Set<number>()
  const chains: LatLng[][] = []
  const keys = Array.from(adj.keys())
  const queue = [
    ...keys.filter(k => adj.get(k)!.length === 1),
    ...keys.filter(k => adj.get(k)!.length !== 1),
  ]
  for (const startK of queue) {
    for (const { k: nextK, i: ei } of adj.get(startK) ?? []) {
      if (used.has(ei)) continue
      const chain: LatLng[] = [pos.get(startK)!, pos.get(nextK)!]
      used.add(ei)
      let cur = nextK, prev = startK
      while (true) {
        const nx = (adj.get(cur) ?? []).filter(n => n.k !== prev && !used.has(n.i))
        if (nx.length !== 1) break // Blatt oder Kreuzung → Kette endet hier
        chain.push(pos.get(nx[0].k)!); used.add(nx[0].i); prev = cur; cur = nx[0].k
      }
      chains.push(chain)
    }
  }
  return chains.length > 0 ? chains : pfade
}

// Kind-bewusster Wrapper um deduplicatePfade(): Straße- und Feldweg-Segmente
// werden getrennt dedupliziert, damit deduplicatePfade() (das Ketten anhand
// gemeinsamer Endpunkte neu zusammensetzt) niemals ein Straßen- mit einem
// Feldweg-Segment zu einer gemischten Kette verschmilzt — an der Stelle SOLL
// ja bewusst eine Segmentgrenze bestehen bleiben (Straße/Feldweg-Übergang).
function deduplicatePfadeMitKind(
  pfade: LatLng[][],
  kinds: WegKind[]
): { pfade: LatLng[][]; kinds: WegKind[] } {
  const strasse = pfade.filter((_, i) => kinds[i] !== 'track')
  const feldweg = pfade.filter((_, i) => kinds[i] === 'track')
  const dedupStrasse = deduplicatePfade(strasse)
  const dedupFeldweg = deduplicatePfade(feldweg)
  return {
    pfade: [...dedupStrasse, ...dedupFeldweg],
    kinds: [
      ...dedupStrasse.map((): WegKind => 'paved'),
      ...dedupFeldweg.map((): WegKind => 'track'),
    ],
  }
}

// Falls kinds nicht exakt zu pfade passt (z.B. Mapbox-Fallback ohne
// Klassifizierung, oder Legacy-Projekt ohne gespeicherte Kinds) → sicherer
// Default: alles als Straße behandeln, statt falsch zuzuordnen.
function passendeKinds(pfade: LatLng[][], kinds: WegKind[]): WegKind[] {
  return kinds.length === pfade.length ? kinds : pfade.map((): WegKind => 'paved')
}

type Laengen = { trassenLaenge: number; hausanschluesseLaenge: number; gesamt: number; strasseLaenge: number; feldwegLaenge: number }
type HistorySnapshot = {
  label: string
  trassePfade: LatLng[][]
  trasse: LatLng[]
  hausanschluesse: Hausstich[]
  laengen: Laengen
  trasseAdressenUuids: string[]
  trassePfadeKinds: WegKind[]
  nvtStandorte: NvtStandort[]
  aussiedlerhofUuids: string[]
  schachtStandorte: SchachtStandort[]
}

export default function Home() {
  const [adressen, setAdressen] = useState<Address[]>([])
  const [orte, setOrte] = useState<OrtInfo[]>([])
  const [aktiveOrteKeys, setAktiveOrteKeys] = useState<string[]>([])
  const [startpunkt, setStartpunkt] = useState<LatLng | null>(null)
  const [startpunktSetzenAktiv, setStartpunktSetzenAktiv] = useState(false)
  const [trasse, setTrasse] = useState<LatLng[]>([])
  const [trassePfade, setTrassePfade] = useState<LatLng[][]>([])
  const [hausanschluesse, setHausanschluesse] = useState<Hausstich[]>([])
  const [trasseProgress, setTrasseProgress] = useState(0)
  const [hausanschluesseProgress, setHausanschluesseProgress] = useState(0)
  const [laengen, setLaengen] = useState<Laengen>({ trassenLaenge: 0, hausanschluesseLaenge: 0, gesamt: 0, strasseLaenge: 0, feldwegLaenge: 0 })
  const [editierbarAktiv, setEditierbarAktiv] = useState(false)
  const [trasseMethode, setTrasseMethode] = useState('')
  const [projektName] = useState('Neues Projekt')
  const [adressFarbe, setAdressFarbe] = useState('#22c55e')
  const [trasseFarbe, setTrasseFarbe] = useState('#3b82f6')
  const [hausanschlussfarbe, setHausanschlussfarbe] = useState('#ef4444')
  const [feldwegFarbe, setFeldwegFarbe] = useState('#d97706')
  const [history, setHistory] = useState<HistorySnapshot[]>([])
  // Adress-UUIDs, die bereits Teil einer generierten/erweiterten Trasse sind —
  // getrennt von "hat Hausanschluss", da das zwei verschiedene Arbeitsschritte
  // sind. Nur damit weiß "Trasse erweitern", ob es wirklich neue (noch nicht
  // angebundene) Adressen/Orte gibt, statt einfach "hat noch keinen Hausanschluss".
  const [trasseAdressenUuids, setTrasseAdressenUuids] = useState<Set<string>>(new Set())
  // Adressen, die beim letzten Generieren/Erweitern über kein öffentliches
  // Wege-Netz (Straße/Feldweg) an den Baum angebunden werden konnten — werden
  // NICHT mehr per Luftlinie zwangsverbunden, sondern hier zur manuellen
  // Prüfung/Anbindung im Edit-Modus gesammelt (siehe MapView-Warnmodal).
  const [nichtAngebundeneAdressen, setNichtAngebundeneAdressen] = useState<Address[]>([])
  // Straße/Feldweg-Klassifizierung parallel zu trassePfade (gleicher Index).
  // Wird bei Generieren/Erweitern aus dem Steiner-Baum übernommen, bleibt bei
  // reinen Punktverschiebungen im Edit-Modus erhalten und kann dort zusätzlich
  // manuell pro Segment umgeschaltet werden ("Als Feldweg markieren").
  const [trassePfadeKinds, setTrassePfadeKinds] = useState<WegKind[]>([])
  // NVT-Feature (Netzverteiler-Standorte je Dorf, Abstandsregel zu
  // Hausanschlüssen) — aktuell nur auf dem dev-Branch.
  const [aussiedlerhofUuids, setAussiedlerhofUuids] = useState<Set<string>>(new Set())
  const [aussiedlerhofMarkierenAktiv, setAussiedlerhofMarkierenAktiv] = useState(false)
  const [nvtModalOffen, setNvtModalOffen] = useState(false)
  const [nvtStandorte, setNvtStandorte] = useState<NvtStandort[]>([])
  // Manuelles Setzen: Klick auf die Karte fragt danach nach der Kapazität
  // (siehe MapView) — für Einzelfälle wie 2-3 benachbarte Aussiedlerhöfe mit
  // eigenem kleinem NVT/Schacht statt der automatischen Dorf-weiten Planung.
  const [nvtManuellSetzenAktiv, setNvtManuellSetzenAktiv] = useState(false)
  // Schacht: manuell gesetzter Kabelschacht/Übergabepunkt (z.B. Zwischenpunkt
  // bei zu langer Strecke zwischen Dörfern, oder direkte Anbindung einzelner
  // Aussiedlerhöfe ohne eigenen NVT) — kapazitätslos, kein Automatik-Feature.
  const [schachtStandorte, setSchachtStandorte] = useState<SchachtStandort[]>([])
  const [schachtSetzenAktiv, setSchachtSetzenAktiv] = useState(false)

  const pushHistory = useCallback((label: string) => {
    setHistory((prev) => [
      ...prev.slice(-19),
      {
        label, trassePfade, trasse, hausanschluesse, laengen,
        trasseAdressenUuids: [...trasseAdressenUuids], trassePfadeKinds,
        nvtStandorte, aussiedlerhofUuids: [...aussiedlerhofUuids], schachtStandorte,
      },
    ])
  }, [trassePfade, trasse, hausanschluesse, laengen, trasseAdressenUuids, trassePfadeKinds, nvtStandorte, aussiedlerhofUuids, schachtStandorte])

  const wendeSnapshotAn = useCallback((snap: HistorySnapshot) => {
    setTrassePfade(snap.trassePfade)
    setTrasse(snap.trasse)
    setHausanschluesse(snap.hausanschluesse)
    setLaengen(snap.laengen)
    setTrasseAdressenUuids(new Set(snap.trasseAdressenUuids))
    setTrassePfadeKinds(snap.trassePfadeKinds)
    setNvtStandorte(snap.nvtStandorte)
    setAussiedlerhofUuids(new Set(snap.aussiedlerhofUuids))
    setSchachtStandorte(snap.schachtStandorte)
  }, [])

  const handleUndo = useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) return prev
      wendeSnapshotAn(prev[prev.length - 1])
      return prev.slice(0, -1)
    })
  }, [wendeSnapshotAn])

  // Springt zu einem beliebigen Punkt in der Historie (nicht nur einen
  // einzelnen Schritt zurück) — alles danach (inkl. des gewählten Snapshots
  // selbst, der ja der Zustand VOR diesem Schritt ist) wird verworfen.
  const handleUndoZu = useCallback((index: number) => {
    setHistory((prev) => {
      if (index < 0 || index >= prev.length) return prev
      wendeSnapshotAn(prev[index])
      return prev.slice(0, index)
    })
  }, [wendeSnapshotAn])

  const handleExcelImport = useCallback(async (file: File) => {
    const ergebnis = await parseExcelFile(file)
    setAdressen(ergebnis)
    const orteListe = extractOrte(ergebnis)
    setOrte(orteListe)
    setAktiveOrteKeys(orteListe.map((o) => o.key))
  }, [])

  const handleOrtToggle = useCallback((key: string) => {
    setAktiveOrteKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    )
  }, [])

  const handleAlleOrteToggle = useCallback(
    (alleAktiv: boolean) => {
      setAktiveOrteKeys(alleAktiv ? orte.map((o) => o.key) : [])
    },
    [orte]
  )

  const handleStartpunktSetzen = useCallback(() => {
    setStartpunktSetzenAktiv(true)
  }, [])

  const handleStartpunktGesetzt = useCallback((punkt: LatLng) => {
    setStartpunkt(punkt)
    setStartpunktSetzenAktiv(false)
  }, [])

  const handleStartpunktZuruecksetzen = useCallback(() => {
    setStartpunkt(null)
    setStartpunktSetzenAktiv(false)
  }, [])

  const handleTrasseGenerieren = useCallback(async () => {
    if (!startpunkt || adressen.length === 0) return

    pushHistory('Trasse generiert')
    setEditierbarAktiv(false)
    setHausanschluesse([])
    setTrasseProgress(2)

    const gefilterteAdressen =
      aktiveOrteKeys.length === orte.length
        ? adressen
        : adressen.filter((a) => aktiveOrteKeys.includes(`${a.plz}_${a.ortsname}_${a.ortsteil}`))

    let pfade: LatLng[][] = []
    let pfadeKinds: WegKind[] = []
    setNichtAngebundeneAdressen([])

    try {
      setTrasseProgress(5)
      const bounds = berechneGrenzen(gefilterteAdressen, startpunkt)
      const osmNetz = await fetchOsmNetz(bounds)
      setTrasseProgress(18)

      const graph = buildRoadGraph(osmNetz, gefilterteAdressen.map((a) => ({ lat: a.lat, lng: a.lon })))
      if (graph.coordinates.size === 0) throw new Error('Leerer Graph')
      setTrasseProgress(22)

      const startNodeId = graph.nearestPointOnGraph(startpunkt)
      const terminalIds = gefilterteAdressen.map((a) =>
        graph.nearestPointOnGraph({ lat: a.lat, lng: a.lon })
      )
      setTrasseProgress(25)

      const ergebnis = await berechneSteinerBaum(
        graph,
        startNodeId,
        terminalIds,
        (p) => setTrasseProgress(25 + Math.round(p * 0.73))
      )

      if (ergebnis.pfade.length === 0) throw new Error('Keine Pfade erzeugt')
      pfade = ergebnis.pfade
      pfadeKinds = ergebnis.pfadeKinds
      setTrasseMethode(`OSM Straßennetz · ${pfade.length} Segmente`)

      const nichtErreichbar = new Set(ergebnis.nichtErreichbareNodeIds)
      setNichtAngebundeneAdressen(
        gefilterteAdressen.filter((a, i) => nichtErreichbar.has(terminalIds[i]))
      )
    } catch (err) {
      const fehlerText = err instanceof Error ? err.message : String(err)
      console.warn('Overpass nicht verfügbar, Mapbox-Baum:', fehlerText)
      setTrasseMethode('Fallback: Overpass (OSM) nicht erreichbar — Mapbox-Routing wird geladen…')
      setTrasseProgress(3)
      try {
        pfade = await berechneBaumORS(
          startpunkt,
          gefilterteAdressen,
          (p) => setTrasseProgress(3 + Math.round(p * 0.95))
        )
        setTrasseMethode('Fallback: Overpass (OSM) war nicht erreichbar — Mapbox-Baum verwendet (Straßen folgen ✓, Abzweige optimiert)')
      } catch (orsErr) {
        const orsText = orsErr instanceof Error ? orsErr.message : String(orsErr)
        setTrasseMethode(`Fehler: ${orsText}`)
        setTrasseProgress(100)
        setTimeout(() => setTrasseProgress(0), 500)
        return
      }
    }

    const { pfade: dedupPfade, kinds: dedupKinds } = deduplicatePfadeMitKind(pfade, passendeKinds(pfade, pfadeKinds))
    setTrassePfade(dedupPfade)
    setTrasse(dedupPfade.flat())
    setTrasseAdressenUuids(new Set(gefilterteAdressen.map((a) => a.uuid)))
    setTrassePfadeKinds(dedupKinds)
    setTrasseProgress(100)
    setLaengen(berechneLaengen(dedupPfade, [], dedupKinds))
    setTimeout(() => setTrasseProgress(0), 500)
  }, [startpunkt, adressen, aktiveOrteKeys, orte.length, pushHistory])

  const handleTrasseErweitern = useCallback(async () => {
    const vorhandenePfade = trassePfade.length > 0 ? trassePfade : (trasse.length >= 2 ? [trasse] : [])
    if (vorhandenePfade.length === 0 || !startpunkt) return

    const gefilterteNeue = adressen.filter(
      (a) =>
        aktiveOrteKeys.includes(`${a.plz}_${a.ortsname}_${a.ortsteil}`) &&
        !trasseAdressenUuids.has(a.uuid)
    )

    if (gefilterteNeue.length === 0) {
      setTrasseMethode('Hinweis: Keine neuen Adressen für ausgewählte Orte')
      return
    }

    pushHistory('Trasse erweitert')
    setTrasseProgress(2)
    setNichtAngebundeneAdressen([])

    const vorhandeneKinds = passendeKinds(vorhandenePfade, trassePfadeKinds)
    let allePfade: LatLng[][] = vorhandenePfade
    let alleKinds: WegKind[] = vorhandeneKinds
    let erfolgreich = false

    try {
      setTrasseProgress(5)
      // Bestehende Trasse gehört mit ins Overpass-Gebiet, sonst fehlen
      // ggf. die Straßendaten zwischen altem und neuem Dorf.
      const bounds = berechneGrenzen(gefilterteNeue, startpunkt, 0.008, vorhandenePfade.flat())
      const osmNetz = await fetchOsmNetz(bounds)
      setTrasseProgress(18)

      const graph = buildRoadGraph(osmNetz, gefilterteNeue.map((a) => ({ lat: a.lat, lng: a.lon })))
      if (graph.coordinates.size === 0) throw new Error('Leerer Graph')
      setTrasseProgress(22)

      // Die komplette bestehende Trasse wird als bereits verbundener Baum
      // vorgegeben (auf das neu geladene Straßennetz gesnappt) — so dockt
      // die Erweiterung am wirklich naechstgelegenen Punkt an, statt einen
      // einzelnen (evtl. weit entfernten) Anschlusspunkt zu erraten.
      const bestehendePunkte = sampleMitStride(vorhandenePfade.flat(), 500)
      const startNodeIds = bestehendePunkte.map((p) => graph.nearestPointOnGraph(p))
      const terminalIds = gefilterteNeue.map((a) =>
        graph.nearestPointOnGraph({ lat: a.lat, lng: a.lon })
      )
      setTrasseProgress(25)

      const ergebnis = await berechneSteinerBaum(
        graph,
        startNodeIds,
        terminalIds,
        (p) => setTrasseProgress(25 + Math.round(p * 0.7))
      )

      if (ergebnis.pfade.length === 0) throw new Error('Keine neuen Pfade erzeugt')
      {
        const kombiniert = deduplicatePfadeMitKind(
          [...vorhandenePfade, ...ergebnis.pfade],
          [...vorhandeneKinds, ...ergebnis.pfadeKinds]
        )
        allePfade = kombiniert.pfade
        alleKinds = kombiniert.kinds
      }
      setTrasseMethode(`OSM Straßennetz Erweitert · ${allePfade.length} Segmente`)

      const nichtErreichbar = new Set(ergebnis.nichtErreichbareNodeIds)
      setNichtAngebundeneAdressen(
        gefilterteNeue.filter((a, i) => nichtErreichbar.has(terminalIds[i]))
      )
      erfolgreich = true
    } catch (err) {
      const fehlerText = err instanceof Error ? err.message : String(err)
      console.warn('Overpass nicht verfügbar, Mapbox-Erweiterung:', fehlerText)
      setTrasseMethode('Fallback: Overpass (OSM) nicht erreichbar — Mapbox-Routing, Erweiterung läuft…')
      setTrasseProgress(3)
      try {
        const neuePfade = await berechneBaumORS(
          startpunkt,
          gefilterteNeue,
          (p) => setTrasseProgress(3 + Math.round(p * 0.95)),
          vorhandenePfade
        )
        {
          const kombiniert = deduplicatePfadeMitKind(
            [...vorhandenePfade, ...neuePfade],
            [...vorhandeneKinds, ...neuePfade.map((): WegKind => 'paved')]
          )
          allePfade = kombiniert.pfade
          alleKinds = kombiniert.kinds
        }
        setTrasseMethode(`Fallback: Overpass (OSM) war nicht erreichbar — Mapbox-Baum Erweitert · ${allePfade.length} Segmente`)
        erfolgreich = true
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setTrasseMethode(`Erweiterung fehlgeschlagen: ${msg}`)
      }
    }

    if (erfolgreich) {
      setTrassePfade(allePfade)
      setTrasse(allePfade.flat())
      setTrasseAdressenUuids((prev) => new Set([...prev, ...gefilterteNeue.map((a) => a.uuid)]))
      setTrassePfadeKinds(alleKinds)
      setLaengen(berechneLaengen(allePfade, hausanschluesse, alleKinds))
    }

    setTrasseProgress(100)
    setTimeout(() => setTrasseProgress(0), 500)
  }, [startpunkt, trassePfade, trasse, adressen, aktiveOrteKeys, hausanschluesse, trasseAdressenUuids, pushHistory, trassePfadeKinds])

  const handleHausanschluesseGenerieren = useCallback(async () => {
    const pfade = trassePfade.length > 0 ? trassePfade : (trasse.length >= 2 ? [trasse] : [])
    if (pfade.length === 0) return

    pushHistory('Hausanschlüsse generiert')
    setHausanschluesseProgress(1)

    const gefilterteAdressen =
      aktiveOrteKeys.length === orte.length
        ? adressen
        : adressen.filter((a) => aktiveOrteKeys.includes(`${a.plz}_${a.ortsname}_${a.ortsteil}`))

    const ergebnis = await berechneHausanschluesse(pfade, gefilterteAdressen, (p) => {
      setHausanschluesseProgress(p)
    })

    setHausanschluesse(ergebnis)
    setHausanschluesseProgress(100)
    setLaengen(berechneLaengen(pfade, ergebnis, passendeKinds(pfade, trassePfadeKinds)))
    setTimeout(() => setHausanschluesseProgress(0), 500)
  }, [trassePfade, trasse, adressen, aktiveOrteKeys, orte.length, pushHistory, trassePfadeKinds])

  const handleHausanschluesseHinzufuegen = useCallback(async () => {
    const pfade = trassePfade.length > 0 ? trassePfade : (trasse.length >= 2 ? [trasse] : [])
    if (pfade.length === 0) return

    const bearbeiteteUuids = new Set(hausanschluesse.map((h) => h.addressUuid))
    const gefilterteAdressen = adressen.filter(
      (a) =>
        aktiveOrteKeys.includes(`${a.plz}_${a.ortsname}_${a.ortsteil}`) &&
        !bearbeiteteUuids.has(a.uuid)
    )

    if (gefilterteAdressen.length === 0) return

    pushHistory('Hausanschlüsse hinzugefügt')
    setHausanschluesseProgress(1)
    const neueHs = await berechneHausanschluesse(pfade, gefilterteAdressen, (p) =>
      setHausanschluesseProgress(p)
    )
    const alleHs = [...hausanschluesse, ...neueHs]
    setHausanschluesse(alleHs)
    setHausanschluesseProgress(100)
    setLaengen(berechneLaengen(pfade, alleHs, passendeKinds(pfade, trassePfadeKinds)))
    setTimeout(() => setHausanschluesseProgress(0), 500)
  }, [trassePfade, trasse, adressen, aktiveOrteKeys, hausanschluesse, pushHistory, trassePfadeKinds])

  const handleTrasseGeaendert = useCallback(
    (punkte: LatLng[]) => {
      pushHistory('Trasse bearbeitet')
      setTrasse(punkte)
      setTrassePfade([])
      // Alte Einzel-Trasse-Darstellung (kein pfade-Array) — hier ist keine
      // Segment-Granularität für eine Feldweg-Markierung vorhanden.
      setTrassePfadeKinds([])
      setLaengen(berechneLaengen([punkte], hausanschluesse, []))
    },
    [hausanschluesse, pushHistory]
  )

  const handleTrassePfadeGeaendert = useCallback(
    (pfade: LatLng[][], kinds: WegKind[]) => {
      pushHistory('Trasse bearbeitet')
      setTrassePfade(pfade)
      setTrasse(pfade.flat())
      setTrassePfadeKinds(kinds)
      setLaengen(berechneLaengen(pfade, hausanschluesse, kinds))
    },
    [hausanschluesse, pushHistory]
  )

  const handleHausanschluesseGeaendert = useCallback(
    (updated: Hausstich[]) => {
      setHausanschluesse(updated)
      const pfade = trassePfade.length > 0 ? trassePfade : [trasse]
      setLaengen(berechneLaengen(pfade, updated, passendeKinds(pfade, trassePfadeKinds)))
    },
    [trassePfade, trasse, trassePfadeKinds]
  )

  const handleEditierbarToggle = useCallback(() => {
    setEditierbarAktiv((v) => !v)
  }, [])

  const handleAllesZuruecksetzen = useCallback(() => {
    setAdressen([])
    setOrte([])
    setAktiveOrteKeys([])
    setStartpunkt(null)
    setStartpunktSetzenAktiv(false)
    setTrasse([])
    setTrassePfade([])
    setHausanschluesse([])
    setTrasseProgress(0)
    setHausanschluesseProgress(0)
    setLaengen({ trassenLaenge: 0, hausanschluesseLaenge: 0, gesamt: 0, strasseLaenge: 0, feldwegLaenge: 0 })
    setEditierbarAktiv(false)
    setHistory([])
    setTrasseAdressenUuids(new Set())
    setNichtAngebundeneAdressen([])
    setTrassePfadeKinds([])
    setAussiedlerhofUuids(new Set())
    setAussiedlerhofMarkierenAktiv(false)
    setNvtModalOffen(false)
    setNvtStandorte([])
    setSchachtStandorte([])
    setSchachtSetzenAktiv(false)
  }, [])

  const handleAussiedlerhofToggle = useCallback((uuid: string) => {
    setAussiedlerhofUuids((prev) => {
      const neu = new Set(prev)
      if (neu.has(uuid)) neu.delete(uuid)
      else neu.add(uuid)
      return neu
    })
  }, [])

  const handleAussiedlerhoefeMarkierenStart = useCallback(() => {
    setNvtModalOffen(false)
    setAussiedlerhofMarkierenAktiv(true)
  }, [])

  const handleAussiedlerhoefeMarkierenFertig = useCallback(() => {
    setAussiedlerhofMarkierenAktiv(false)
    setNvtModalOffen(true)
  }, [])

  const handleNvtManuellSetzenStart = useCallback(() => {
    setNvtModalOffen(false)
    setNvtManuellSetzenAktiv(true)
  }, [])

  const handleNvtManuellSetzenAbbrechen = useCallback(() => {
    setNvtManuellSetzenAktiv(false)
  }, [])

  const handleNvtManuellHinzufuegen = useCallback((position: LatLng, kapazitaet: number) => {
    pushHistory('NVT manuell gesetzt')
    setNvtStandorte((prev) => [...prev, { position, kapazitaet, belegung: 0, hausanschlussIds: [] }])
    setNvtManuellSetzenAktiv(false)
  }, [pushHistory])

  const handleNvtLoeschen = useCallback((nvtIdx: number) => {
    pushHistory('NVT gelöscht')
    setNvtStandorte((prev) => prev.filter((_, i) => i !== nvtIdx))
  }, [pushHistory])

  // Ordnet einen Hausanschluss exklusiv einem NVT zu (toggle: erneutes
  // Anklicken beim selben NVT entfernt ihn wieder) — war er vorher einem
  // ANDEREN NVT oder einem Schacht zugeordnet, wird er dort automatisch entfernt.
  const handleNvtHausanschlussToggle = useCallback((nvtIdx: number, hausId: string) => {
    pushHistory('Hausanschluss zugewiesen')
    setNvtStandorte((prev) => {
      const ziel = prev[nvtIdx]
      if (!ziel) return prev
      const warBeimZielZugeordnet = ziel.hausanschlussIds.includes(hausId)
      if (!warBeimZielZugeordnet) {
        setSchachtStandorte((s) => s.map((schacht) =>
          schacht.hausanschlussIds.includes(hausId)
            ? { ...schacht, hausanschlussIds: schacht.hausanschlussIds.filter((id) => id !== hausId) }
            : schacht
        ))
      }
      return prev.map((nvt, i) => {
        if (i === nvtIdx) {
          const neueIds = warBeimZielZugeordnet
            ? nvt.hausanschlussIds.filter((id) => id !== hausId)
            : [...nvt.hausanschlussIds, hausId]
          return { ...nvt, hausanschlussIds: neueIds, belegung: neueIds.length }
        }
        if (!warBeimZielZugeordnet && nvt.hausanschlussIds.includes(hausId)) {
          const neueIds = nvt.hausanschlussIds.filter((id) => id !== hausId)
          return { ...nvt, hausanschlussIds: neueIds, belegung: neueIds.length }
        }
        return nvt
      })
    })
  }, [pushHistory])

  const handleNvtVerschoben = useCallback((nvtIdx: number, position: LatLng) => {
    pushHistory('NVT verschoben')
    setNvtStandorte((prev) => prev.map((nvt, i) => (i === nvtIdx ? { ...nvt, position } : nvt)))
  }, [pushHistory])

  const handleSchachtSetzenStart = useCallback(() => {
    setNvtModalOffen(false)
    setSchachtSetzenAktiv(true)
  }, [])

  const handleSchachtSetzenAbbrechen = useCallback(() => {
    setSchachtSetzenAktiv(false)
  }, [])

  const handleSchachtGesetzt = useCallback((position: LatLng) => {
    pushHistory('Schacht gesetzt')
    setSchachtStandorte((prev) => [...prev, { position, hausanschlussIds: [] }])
    setSchachtSetzenAktiv(false)
  }, [pushHistory])

  const handleSchachtLoeschen = useCallback((schachtIdx: number) => {
    pushHistory('Schacht gelöscht')
    setSchachtStandorte((prev) => prev.filter((_, i) => i !== schachtIdx))
  }, [pushHistory])

  const handleSchachtVerschoben = useCallback((schachtIdx: number, position: LatLng) => {
    pushHistory('Schacht verschoben')
    setSchachtStandorte((prev) => prev.map((s, i) => (i === schachtIdx ? { ...s, position } : s)))
  }, [pushHistory])

  // Ordnet einen Hausanschluss exklusiv einem Schacht zu — war er vorher
  // einem ANDEREN Schacht oder einem NVT zugeordnet, wird er dort automatisch entfernt.
  const handleSchachtHausanschlussToggle = useCallback((schachtIdx: number, hausId: string) => {
    pushHistory('Hausanschluss zugewiesen')
    setSchachtStandorte((prev) => {
      const ziel = prev[schachtIdx]
      if (!ziel) return prev
      const warBeimZielZugeordnet = ziel.hausanschlussIds.includes(hausId)
      if (!warBeimZielZugeordnet) {
        setNvtStandorte((n) => n.map((nvt) =>
          nvt.hausanschlussIds.includes(hausId)
            ? { ...nvt, hausanschlussIds: nvt.hausanschlussIds.filter((id) => id !== hausId), belegung: nvt.hausanschlussIds.filter((id) => id !== hausId).length }
            : nvt
        ))
      }
      return prev.map((s, i) => {
        if (i === schachtIdx) {
          const neueIds = warBeimZielZugeordnet
            ? s.hausanschlussIds.filter((id) => id !== hausId)
            : [...s.hausanschlussIds, hausId]
          return { ...s, hausanschlussIds: neueIds }
        }
        if (!warBeimZielZugeordnet && s.hausanschlussIds.includes(hausId)) {
          return { ...s, hausanschlussIds: s.hausanschlussIds.filter((id) => id !== hausId) }
        }
        return s
      })
    })
  }, [pushHistory])

  // Ordnet jeden bereits einem NVT zugeordneten Hausanschluss neu dem
  // (Luftlinien-)nächsten der AKTUELLEN NVT-Standorte zu — gedacht als
  // Werkzeug nach dem manuellen Verschieben eines oder mehrerer NVT, damit
  // man nicht jeden Hausanschluss einzeln von Hand neu zuweisen muss.
  const handleNvtHausanschluesseNeuZuweisen = useCallback(() => {
    if (nvtStandorte.length === 0) return
    pushHistory('NVT-Zuweisung neu berechnet')

    const hausById = new Map(hausanschluesse.map((h) => [h.id, h]))
    const alleZugeordnetenIds = new Set(nvtStandorte.flatMap((n) => n.hausanschlussIds))

    const gruppenProNvt: string[][] = nvtStandorte.map(() => [])
    for (const hausId of alleZugeordnetenIds) {
      const haus = hausById.get(hausId)
      if (!haus) continue
      let besterIdx = 0
      let besteDist = Infinity
      nvtStandorte.forEach((nvt, i) => {
        const dLat = nvt.position.lat - haus.trassenPunkt.lat
        const dLng = nvt.position.lng - haus.trassenPunkt.lng
        const d2 = dLat * dLat + dLng * dLng
        if (d2 < besteDist) { besteDist = d2; besterIdx = i }
      })
      gruppenProNvt[besterIdx].push(hausId)
    }

    setNvtStandorte((prev) =>
      prev.map((nvt, i) => ({ ...nvt, hausanschlussIds: gruppenProNvt[i], belegung: gruppenProNvt[i].length }))
    )
  }, [nvtStandorte, hausanschluesse, pushHistory])

  const handleNvtGenerieren = useCallback((ausgewaehlteOrteKeys: string[], distanzMeter: number, erlaubteKapazitaeten: number[], kapazitaetsReserve: number) => {
    if (!startpunkt || ausgewaehlteOrteKeys.length === 0) return
    const pfade = trassePfade.length > 0 ? trassePfade : (trasse.length >= 2 ? [trasse] : [])
    if (pfade.length === 0) return

    const orteSet = new Set(ausgewaehlteOrteKeys)
    const adressUuidsImDorf = new Set(
      adressen
        .filter((a) => orteSet.has(`${a.plz}_${a.ortsname}_${a.ortsteil}`))
        .map((a) => a.uuid)
    )

    // Schutz gegen versehentliches doppeltes Generieren fuers selbe Dorf —
    // legt sonst einen kompletten zweiten Satz NVT ueber die bestehenden.
    const bereitsZugeordneteHausIds = new Set(nvtStandorte.flatMap((n) => n.hausanschlussIds))
    const ueberschneidungAnzahl = hausanschluesse.filter(
      (h) => adressUuidsImDorf.has(h.addressUuid) && bereitsZugeordneteHausIds.has(h.id)
    ).length
    if (ueberschneidungAnzahl > 0) {
      const weiter = confirm(
        `${ueberschneidungAnzahl} Hausanschluss(e) in der Auswahl haben bereits einen NVT. ` +
        `Trotzdem neu generieren? (bestehende NVT bleiben erhalten, es kommen weitere hinzu)`
      )
      if (!weiter) return
    }

    pushHistory('NVT generiert')

    const relevanteHausanschluesse = hausanschluesse.filter(
      (h) => adressUuidsImDorf.has(h.addressUuid) && !aussiedlerhofUuids.has(h.addressUuid)
    )

    const ergebnis = berechneNvtStandorte(pfade, relevanteHausanschluesse, startpunkt, distanzMeter, erlaubteKapazitaeten, kapazitaetsReserve)
    setNvtStandorte((prev) => [...prev, ...ergebnis.standorte])
    if (ergebnis.nichtErreichbar.length > 0) {
      console.warn(`NVT-Generierung: ${ergebnis.nichtErreichbar.length} Hausanschluss(e) ohne Netzanbindung zum Startpunkt — nicht berücksichtigt.`)
    }
    setNvtModalOffen(false)
  }, [startpunkt, trassePfade, trasse, adressen, hausanschluesse, aussiedlerhofUuids, pushHistory, nvtStandorte])

  const handleKMLExport = useCallback(() => {
    exportKML({
      name: projektName,
      erstelltAm: new Date().toISOString(),
      adressen,
      startpunkt,
      trasse,
      trassePfade: trassePfade.length > 0 ? trassePfade : undefined,
      hausanschluesse,
      trassenLaengeMeter: laengen.trassenLaenge,
      hausanschlussLaengeMeter: laengen.hausanschluesseLaenge,
    })
  }, [projektName, adressen, startpunkt, trasse, trassePfade, hausanschluesse, laengen])

  const handleShapefileExport = useCallback(() => {
    exportShapefile({
      name: projektName,
      erstelltAm: new Date().toISOString(),
      adressen,
      startpunkt,
      trasse,
      trassePfade: trassePfade.length > 0 ? trassePfade : undefined,
      hausanschluesse,
      trassenLaengeMeter: laengen.trassenLaenge,
      hausanschlussLaengeMeter: laengen.hausanschluesseLaenge,
      trassePfadeKinds: trassePfadeKinds.length > 0 ? trassePfadeKinds : undefined,
      nvtStandorte: nvtStandorte.length > 0 ? nvtStandorte : undefined,
      schachtStandorte: schachtStandorte.length > 0 ? schachtStandorte : undefined,
    })
  }, [projektName, adressen, startpunkt, trasse, trassePfade, hausanschluesse, laengen, trassePfadeKinds, nvtStandorte, schachtStandorte])

  const handleProjektSpeichern = useCallback(() => {
    exportProjekt({
      name: projektName,
      erstelltAm: new Date().toISOString(),
      adressen,
      startpunkt,
      trasse,
      trassePfade: trassePfade.length > 0 ? trassePfade : undefined,
      hausanschluesse,
      trassenLaengeMeter: laengen.trassenLaenge,
      hausanschlussLaengeMeter: laengen.hausanschluesseLaenge,
      trassePfadeKinds: trassePfadeKinds.length > 0 ? trassePfadeKinds : undefined,
      nvtStandorte: nvtStandorte.length > 0 ? nvtStandorte : undefined,
      aussiedlerhofUuids: aussiedlerhofUuids.size > 0 ? [...aussiedlerhofUuids] : undefined,
      schachtStandorte: schachtStandorte.length > 0 ? schachtStandorte : undefined,
    })
  }, [projektName, adressen, startpunkt, trasse, trassePfade, hausanschluesse, laengen, trassePfadeKinds, nvtStandorte, aussiedlerhofUuids, schachtStandorte])

  const handleProjektLaden = useCallback(async (file: File) => {
    const projekt = await importProjekt(file)
    setAdressen(projekt.adressen)
    setStartpunkt(projekt.startpunkt)
    setTrasse(projekt.trasse)
    setTrassePfade(projekt.trassePfade ?? [])
    setHausanschluesse(projekt.hausanschluesse)
    const pfade = projekt.trassePfade?.length ? projekt.trassePfade : [projekt.trasse]
    // Kinds nur setzen, wenn sie wirklich zu trassePfade gehören (nicht zum
    // trasse-Fallback, der für die Längenberechnung nur behelfsmäßig genutzt wird).
    const kinds = projekt.trassePfade?.length
      ? passendeKinds(projekt.trassePfade, projekt.trassePfadeKinds ?? [])
      : []
    setTrassePfadeKinds(kinds)
    setLaengen(berechneLaengen(pfade, projekt.hausanschluesse, passendeKinds(pfade, kinds)))
    setEditierbarAktiv(false)
    setHistory([])
    // Bei geladenen Projekten ist unbekannt, welche Adressen genau zur Trasse
    // gehören — sicherer Default: bei vorhandener Trasse gilt sie als
    // vollständig für alle geladenen Adressen (sonst würde "Trasse erweitern"
    // fälschlich sofort aktiv sein).
    const hatTrasse = (projekt.trassePfade?.length ?? 0) > 0 || projekt.trasse.length >= 2
    setTrasseAdressenUuids(hatTrasse ? new Set(projekt.adressen.map((a) => a.uuid)) : new Set())
    const orteListe = extractOrte(projekt.adressen)
    setOrte(orteListe)
    setAktiveOrteKeys(orteListe.map((o) => o.key))
    setNvtStandorte(projekt.nvtStandorte ?? [])
    setAussiedlerhofUuids(new Set(projekt.aussiedlerhofUuids ?? []))
    setAussiedlerhofMarkierenAktiv(false)
    setNvtModalOffen(false)
    setSchachtStandorte(projekt.schachtStandorte ?? [])
    setSchachtSetzenAktiv(false)
  }, [])

  const gefilterteAdressenAnzahl =
    aktiveOrteKeys.length === orte.length
      ? adressen.length
      : adressen.filter((a) => aktiveOrteKeys.includes(`${a.plz}_${a.ortsname}_${a.ortsteil}`)).length

  const bearbeiteteUuids = new Set(hausanschluesse.map((h) => h.addressUuid))
  const neueAdressenOhneHsAnzahl = adressen.filter(
    (a) =>
      aktiveOrteKeys.includes(`${a.plz}_${a.ortsname}_${a.ortsteil}`) &&
      !bearbeiteteUuids.has(a.uuid)
  ).length

  // Für "Trasse erweitern": Adressen, die noch nicht Teil einer generierten/
  // erweiterten Trasse sind — bewusst getrennt von neueAdressenOhneHsAnzahl,
  // da "hat noch keinen Hausanschluss" (normal direkt nach Trasse generieren,
  // bevor Hausanschlüsse berechnet wurden) etwas anderes ist als "gehört noch
  // gar nicht zur Trasse" (neues Dorf aktiviert / neue Excel-Liste importiert).
  const neueAdressenFuerTrasseAnzahl = adressen.filter(
    (a) =>
      aktiveOrteKeys.includes(`${a.plz}_${a.ortsname}_${a.ortsteil}`) &&
      !trasseAdressenUuids.has(a.uuid)
  ).length

  return (
    <div className="flex h-screen overflow-hidden bg-[#0f0f0f]">
      <Sidebar
        adressenCount={adressen.length}
        gefilterteAdressenAnzahl={gefilterteAdressenAnzahl}
        neueAdressenOhneHsAnzahl={neueAdressenOhneHsAnzahl}
        neueAdressenFuerTrasseAnzahl={neueAdressenFuerTrasseAnzahl}
        orte={orte}
        aktiveOrteKeys={aktiveOrteKeys}
        startpunktGesetzt={startpunkt !== null}
        startpunktKoords={startpunkt}
        trasseVorhanden={trasse.length >= 2 || trassePfade.length > 0}
        hausanschluesseCount={hausanschluesse.length}
        trassenLaenge={laengen.trassenLaenge}
        hausanschlussLaenge={laengen.hausanschluesseLaenge}
        gesamtLaenge={laengen.gesamt}
        strasseLaenge={laengen.strasseLaenge}
        feldwegLaenge={laengen.feldwegLaenge}
        trasseProgress={trasseProgress}
        hausanschluesseProgress={hausanschluesseProgress}
        editierbarAktiv={editierbarAktiv}
        adressFarbe={adressFarbe}
        trasseFarbe={trasseFarbe}
        hausanschlussfarbe={hausanschlussfarbe}
        feldwegFarbe={feldwegFarbe}
        canUndo={history.length > 0}
        undoCount={history.length}
        historyLabels={history.map((h) => h.label)}
        onUndoZu={handleUndoZu}
        nvtStandorteAnzahl={nvtStandorte.length}
        onNvtButtonKlick={() => setNvtModalOffen(true)}
        onNvtNeuZuweisenKlick={handleNvtHausanschluesseNeuZuweisen}
        onAdressFarbeAendern={setAdressFarbe}
        onTrasseFarbeAendern={setTrasseFarbe}
        onHausanschlussFarbeAendern={setHausanschlussfarbe}
        onFeldwegFarbeAendern={setFeldwegFarbe}
        onExcelImport={handleExcelImport}
        onOrtToggle={handleOrtToggle}
        onAlleOrteToggle={handleAlleOrteToggle}
        onStartpunktSetzen={handleStartpunktSetzen}
        onStartpunktZuruecksetzen={handleStartpunktZuruecksetzen}
        onTrasseGenerieren={handleTrasseGenerieren}
        onHausanschluesseGenerieren={handleHausanschluesseGenerieren}
        onHausanschluesseHinzufuegen={handleHausanschluesseHinzufuegen}
        onEditierbarToggle={handleEditierbarToggle}
        onAllesZuruecksetzen={handleAllesZuruecksetzen}
        onKMLExport={handleKMLExport}
        onShapefileExport={handleShapefileExport}
        onProjektSpeichern={handleProjektSpeichern}
        onProjektLaden={handleProjektLaden}
        onTrasseErweitern={handleTrasseErweitern}
        onUndo={handleUndo}
      />
      <main className="flex-1 relative overflow-hidden">
        <MapView
          adressen={adressen}
          startpunkt={startpunkt}
          startpunktSetzenAktiv={startpunktSetzenAktiv}
          trasse={trasse}
          trassePfade={trassePfade}
          hausanschluesse={hausanschluesse}
          editierbarAktiv={editierbarAktiv}
          aktiveOrteKeys={aktiveOrteKeys}
          adressFarbe={adressFarbe}
          trasseFarbe={trasseFarbe}
          hausanschlussfarbe={hausanschlussfarbe}
          feldwegFarbe={feldwegFarbe}
          trassePfadeKinds={trassePfadeKinds}
          trasseMethode={trasseMethode}
          nichtAngebundeneAdressen={nichtAngebundeneAdressen}
          aussiedlerhofUuids={aussiedlerhofUuids}
          aussiedlerhofMarkierenAktiv={aussiedlerhofMarkierenAktiv}
          nvtStandorte={nvtStandorte}
          nvtManuellSetzenAktiv={nvtManuellSetzenAktiv}
          schachtStandorte={schachtStandorte}
          schachtSetzenAktiv={schachtSetzenAktiv}
          onStartpunktGesetzt={handleStartpunktGesetzt}
          onTrasseGeaendert={handleTrasseGeaendert}
          onTrassePfadeGeaendert={handleTrassePfadeGeaendert}
          onHausanschluesseGeaendert={handleHausanschluesseGeaendert}
          onAussiedlerhofToggle={handleAussiedlerhofToggle}
          onAussiedlerhofMarkierenFertig={handleAussiedlerhoefeMarkierenFertig}
          onNvtManuellHinzufuegen={handleNvtManuellHinzufuegen}
          onNvtManuellSetzenAbbrechen={handleNvtManuellSetzenAbbrechen}
          onNvtLoeschen={handleNvtLoeschen}
          onNvtHausanschlussToggle={handleNvtHausanschlussToggle}
          onNvtVerschoben={handleNvtVerschoben}
          onSchachtGesetzt={handleSchachtGesetzt}
          onSchachtSetzenAbbrechen={handleSchachtSetzenAbbrechen}
          onSchachtLoeschen={handleSchachtLoeschen}
          onSchachtHausanschlussToggle={handleSchachtHausanschlussToggle}
          onSchachtVerschoben={handleSchachtVerschoben}
        />
        {nvtModalOffen && (
          <NVTModal
            orte={orte}
            aussiedlerhofAnzahl={aussiedlerhofUuids.size}
            nvtVorhandenAnzahl={nvtStandorte.length}
            schachtVorhandenAnzahl={schachtStandorte.length}
            onAussiedlerhoefeMarkieren={handleAussiedlerhoefeMarkierenStart}
            onManuellSetzen={handleNvtManuellSetzenStart}
            onSchachtSetzen={handleSchachtSetzenStart}
            onGenerieren={handleNvtGenerieren}
            onClose={() => setNvtModalOffen(false)}
          />
        )}
      </main>
    </div>
  )
}

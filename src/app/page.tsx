'use client'

import dynamic from 'next/dynamic'
import { useState, useCallback } from 'react'
import Sidebar from '../components/Sidebar'
import { Address, LatLng, Hausstich, OrtInfo } from '../lib/types'
import { parseExcelFile } from '../lib/excelParser'
import { berechneGrenzen, fetchOsmNetz } from '../lib/overpassClient'
import { buildRoadGraph } from '../lib/roadGraph'
import { berechneSteinerBaum } from '../lib/steinerbaum'
import { berechneBaumORS } from '../lib/baumOrs'
import { berechneHausanschluesse, berechneLaengen } from '../lib/hausanschluesse'
import { exportKML } from '../lib/kmlExport'
import { exportProjekt, importProjekt } from '../lib/projektSpeichern'

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

type Laengen = { trassenLaenge: number; hausanschluesseLaenge: number; gesamt: number }
type HistorySnapshot = {
  trassePfade: LatLng[][]
  trasse: LatLng[]
  hausanschluesse: Hausstich[]
  laengen: Laengen
  trasseAdressenUuids: string[]
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
  const [laengen, setLaengen] = useState<Laengen>({ trassenLaenge: 0, hausanschluesseLaenge: 0, gesamt: 0 })
  const [editierbarAktiv, setEditierbarAktiv] = useState(false)
  const [trasseMethode, setTrasseMethode] = useState('')
  const [projektName] = useState('Neues Projekt')
  const [adressFarbe, setAdressFarbe] = useState('#22c55e')
  const [trasseFarbe, setTrasseFarbe] = useState('#3b82f6')
  const [hausanschlussfarbe, setHausanschlussfarbe] = useState('#ef4444')
  const [history, setHistory] = useState<HistorySnapshot[]>([])
  // Adress-UUIDs, die bereits Teil einer generierten/erweiterten Trasse sind —
  // getrennt von "hat Hausanschluss", da das zwei verschiedene Arbeitsschritte
  // sind. Nur damit weiß "Trasse erweitern", ob es wirklich neue (noch nicht
  // angebundene) Adressen/Orte gibt, statt einfach "hat noch keinen Hausanschluss".
  const [trasseAdressenUuids, setTrasseAdressenUuids] = useState<Set<string>>(new Set())

  const pushHistory = useCallback(() => {
    setHistory((prev) => [
      ...prev.slice(-9),
      { trassePfade, trasse, hausanschluesse, laengen, trasseAdressenUuids: [...trasseAdressenUuids] },
    ])
  }, [trassePfade, trasse, hausanschluesse, laengen, trasseAdressenUuids])

  const handleUndo = useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) return prev
      const snap = prev[prev.length - 1]
      setTrassePfade(snap.trassePfade)
      setTrasse(snap.trasse)
      setHausanschluesse(snap.hausanschluesse)
      setLaengen(snap.laengen)
      setTrasseAdressenUuids(new Set(snap.trasseAdressenUuids))
      return prev.slice(0, -1)
    })
  }, [])

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

    pushHistory()
    setEditierbarAktiv(false)
    setHausanschluesse([])
    setTrasseProgress(2)

    const gefilterteAdressen =
      aktiveOrteKeys.length === orte.length
        ? adressen
        : adressen.filter((a) => aktiveOrteKeys.includes(`${a.plz}_${a.ortsname}_${a.ortsteil}`))

    let pfade: LatLng[][] = []

    try {
      setTrasseProgress(5)
      const bounds = berechneGrenzen(gefilterteAdressen, startpunkt)
      const osmNetz = await fetchOsmNetz(bounds)
      setTrasseProgress(18)

      const graph = buildRoadGraph(osmNetz)
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
      setTrasseMethode(
        ergebnis.luftlinienAnzahl > 0
          ? `OSM Straßennetz · ${pfade.length} Segmente · ⚠️ ${ergebnis.luftlinienAnzahl} Adresse(n) ohne Straßenanbindung per Luftlinie verbunden — bitte prüfen`
          : `OSM Straßennetz · ${pfade.length} Segmente`
      )
    } catch (err) {
      const fehlerText = err instanceof Error ? err.message : String(err)
      console.warn('Overpass nicht verfügbar, Mapbox-Baum:', fehlerText)
      setTrasseMethode('Mapbox-Routing (Straßendaten werden geladen…)')
      setTrasseProgress(3)
      try {
        pfade = await berechneBaumORS(
          startpunkt,
          gefilterteAdressen,
          (p) => setTrasseProgress(3 + Math.round(p * 0.95))
        )
        setTrasseMethode('Mapbox-Baum — Straßen folgen ✓, Abzweige optimiert')
      } catch (orsErr) {
        const orsText = orsErr instanceof Error ? orsErr.message : String(orsErr)
        setTrasseMethode(`Fehler: ${orsText}`)
        setTrasseProgress(100)
        setTimeout(() => setTrasseProgress(0), 500)
        return
      }
    }

    const dedupPfade = deduplicatePfade(pfade)
    setTrassePfade(dedupPfade)
    setTrasse(dedupPfade.flat())
    setTrasseAdressenUuids(new Set(gefilterteAdressen.map((a) => a.uuid)))
    setTrasseProgress(100)
    setLaengen(berechneLaengen(dedupPfade, []))
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
      setTrasseMethode('Keine neuen Adressen für ausgewählte Orte')
      return
    }

    pushHistory()
    setTrasseProgress(2)
    setTrasseMethode('Mapbox-Routing (Erweiterung läuft…)')

    try {
      const neuePfade = await berechneBaumORS(
        startpunkt,
        gefilterteNeue,
        (p) => setTrasseProgress(2 + Math.round(p * 0.95)),
        vorhandenePfade
      )
      const allePfade = deduplicatePfade([...vorhandenePfade, ...neuePfade])
      setTrassePfade(allePfade)
      setTrasse(allePfade.flat())
      setTrasseAdressenUuids((prev) => new Set([...prev, ...gefilterteNeue.map((a) => a.uuid)]))
      setTrasseMethode(`Mapbox-Baum Erweitert · ${allePfade.length} Segmente`)
      setLaengen(berechneLaengen(allePfade, hausanschluesse))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setTrasseMethode(`Erweiterung fehlgeschlagen: ${msg}`)
    }

    setTrasseProgress(100)
    setTimeout(() => setTrasseProgress(0), 500)
  }, [startpunkt, trassePfade, trasse, adressen, aktiveOrteKeys, hausanschluesse, trasseAdressenUuids, pushHistory])

  const handleHausanschluesseGenerieren = useCallback(async () => {
    const pfade = trassePfade.length > 0 ? trassePfade : (trasse.length >= 2 ? [trasse] : [])
    if (pfade.length === 0) return

    pushHistory()
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
    setLaengen(berechneLaengen(pfade, ergebnis))
    setTimeout(() => setHausanschluesseProgress(0), 500)
  }, [trassePfade, trasse, adressen, aktiveOrteKeys, orte.length, pushHistory])

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

    pushHistory()
    setHausanschluesseProgress(1)
    const neueHs = await berechneHausanschluesse(pfade, gefilterteAdressen, (p) =>
      setHausanschluesseProgress(p)
    )
    const alleHs = [...hausanschluesse, ...neueHs]
    setHausanschluesse(alleHs)
    setHausanschluesseProgress(100)
    setLaengen(berechneLaengen(pfade, alleHs))
    setTimeout(() => setHausanschluesseProgress(0), 500)
  }, [trassePfade, trasse, adressen, aktiveOrteKeys, hausanschluesse, pushHistory])

  const handleTrasseGeaendert = useCallback(
    (punkte: LatLng[]) => {
      pushHistory()
      setTrasse(punkte)
      setTrassePfade([])
      setLaengen(berechneLaengen([punkte], hausanschluesse))
    },
    [hausanschluesse, pushHistory]
  )

  const handleTrassePfadeGeaendert = useCallback(
    (pfade: LatLng[][]) => {
      pushHistory()
      setTrassePfade(pfade)
      setTrasse(pfade.flat())
      setLaengen(berechneLaengen(pfade, hausanschluesse))
    },
    [hausanschluesse, pushHistory]
  )

  const handleHausanschluesseGeaendert = useCallback(
    (updated: Hausstich[]) => {
      setHausanschluesse(updated)
      const pfade = trassePfade.length > 0 ? trassePfade : [trasse]
      setLaengen(berechneLaengen(pfade, updated))
    },
    [trassePfade, trasse]
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
    setLaengen({ trassenLaenge: 0, hausanschluesseLaenge: 0, gesamt: 0 })
    setEditierbarAktiv(false)
    setHistory([])
    setTrasseAdressenUuids(new Set())
  }, [])

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
    })
  }, [projektName, adressen, startpunkt, trasse, trassePfade, hausanschluesse, laengen])

  const handleProjektLaden = useCallback(async (file: File) => {
    const projekt = await importProjekt(file)
    setAdressen(projekt.adressen)
    setStartpunkt(projekt.startpunkt)
    setTrasse(projekt.trasse)
    setTrassePfade(projekt.trassePfade ?? [])
    setHausanschluesse(projekt.hausanschluesse)
    const pfade = projekt.trassePfade?.length ? projekt.trassePfade : [projekt.trasse]
    setLaengen(berechneLaengen(pfade, projekt.hausanschluesse))
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
        trasseProgress={trasseProgress}
        hausanschluesseProgress={hausanschluesseProgress}
        editierbarAktiv={editierbarAktiv}
        adressFarbe={adressFarbe}
        trasseFarbe={trasseFarbe}
        hausanschlussfarbe={hausanschlussfarbe}
        canUndo={history.length > 0}
        undoCount={history.length}
        onAdressFarbeAendern={setAdressFarbe}
        onTrasseFarbeAendern={setTrasseFarbe}
        onHausanschlussFarbeAendern={setHausanschlussfarbe}
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
          trasseMethode={trasseMethode}
          onStartpunktGesetzt={handleStartpunktGesetzt}
          onTrasseGeaendert={handleTrasseGeaendert}
          onTrassePfadeGeaendert={handleTrassePfadeGeaendert}
          onHausanschluesseGeaendert={handleHausanschluesseGeaendert}
        />
      </main>
    </div>
  )
}

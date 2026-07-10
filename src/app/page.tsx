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
  const [laengen, setLaengen] = useState({
    trassenLaenge: 0,
    hausanschluesseLaenge: 0,
    gesamt: 0,
  })
  const [editierbarAktiv, setEditierbarAktiv] = useState(false)
  const [trasseMethode, setTrasseMethode] = useState('')
  const [projektName] = useState('Neues Projekt')
  const [adressFarbe, setAdressFarbe] = useState('#22c55e')
  const [trasseFarbe, setTrasseFarbe] = useState('#3b82f6')
  const [hausanschlussfarbe, setHausanschlussfarbe] = useState('#ef4444')

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

    setEditierbarAktiv(false)
    setHausanschluesse([])
    setTrasseProgress(2)

    const gefilterteAdressen =
      aktiveOrteKeys.length === orte.length
        ? adressen
        : adressen.filter((a) => aktiveOrteKeys.includes(`${a.plz}_${a.ortsname}_${a.ortsteil}`))

    let pfade: LatLng[][] = []

    try {
      // Phase 1: OSM-Straßennetz laden (Overpass API, kostenlos)
      setTrasseProgress(5)
      const bounds = berechneGrenzen(gefilterteAdressen, startpunkt)
      const osmNetz = await fetchOsmNetz(bounds)
      setTrasseProgress(18)

      // Phase 2: Straßengraph aufbauen
      const graph = buildRoadGraph(osmNetz)
      if (graph.coordinates.size === 0) throw new Error('Leerer Graph')
      setTrasseProgress(22)

      // Phase 3: Startpunkt + Adressen auf nächste Straßenknoten einrasten
      const startNodeId = graph.nearestNode(startpunkt)
      const terminalIds = gefilterteAdressen.map((a) =>
        graph.nearestNode({ lat: a.lat, lng: a.lon })
      )
      setTrasseProgress(25)

      // Phase 4: Steiner-Baum (jede Straße nur EINMAL — kein Hin-und-Zurück)
      const ergebnis = await berechneSteinerBaum(
        graph,
        startNodeId,
        terminalIds,
        (p) => setTrasseProgress(25 + Math.round(p * 0.73))
      )

      if (ergebnis.pfade.length === 0) throw new Error('Keine Pfade erzeugt')
      pfade = ergebnis.pfade
      setTrasseMethode(`OSM Straßennetz · ${pfade.length} Segmente`)
    } catch (err) {
      const fehlerText = err instanceof Error ? err.message : String(err)
      console.warn('Overpass nicht verfügbar, ORS-Baum:', fehlerText)
      setTrasseMethode('ORS-Routing (Straßendaten werden geladen…)')
      setTrasseProgress(3)
      try {
        pfade = await berechneBaumORS(
          startpunkt,
          gefilterteAdressen,
          (p) => setTrasseProgress(3 + Math.round(p * 0.95))
        )
        setTrasseMethode('ORS-Baum — Straßen folgen ✓, Abzweige optimiert')
      } catch (orsErr) {
        const orsText = orsErr instanceof Error ? orsErr.message : String(orsErr)
        setTrasseMethode(`Fehler: ${orsText}`)
        setTrasseProgress(100)
        setTimeout(() => setTrasseProgress(0), 500)
        return
      }
    }

    setTrassePfade(pfade)
    setTrasse(pfade.flat())
    setTrasseProgress(100)
    setLaengen(berechneLaengen(pfade, []))
    setTimeout(() => setTrasseProgress(0), 500)
  }, [startpunkt, adressen, aktiveOrteKeys, orte.length])

  const handleHausanschluesseGenerieren = useCallback(async () => {
    const pfade = trassePfade.length > 0 ? trassePfade : (trasse.length >= 2 ? [trasse] : [])
    if (pfade.length === 0) return

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

    const neueLaengen = berechneLaengen(pfade, ergebnis)
    setLaengen(neueLaengen)

    setTimeout(() => setHausanschluesseProgress(0), 500)
  }, [trassePfade, trasse, adressen, aktiveOrteKeys, orte.length])

  const handleTrasseGeaendert = useCallback(
    (punkte: LatLng[]) => {
      setTrasse(punkte)
      setTrassePfade([])
      const neueLaengen = berechneLaengen([punkte], hausanschluesse)
      setLaengen(neueLaengen)
    },
    [hausanschluesse]
  )

  const handleTrassePfadeGeaendert = useCallback(
    (pfade: LatLng[][]) => {
      setTrassePfade(pfade)
      setTrasse(pfade.flat())
      const neueLaengen = berechneLaengen(pfade, hausanschluesse)
      setLaengen(neueLaengen)
    },
    [hausanschluesse]
  )

  const handleHausanschluesseGeaendert = useCallback(
    (updated: Hausstich[]) => {
      setHausanschluesse(updated)
      const pfade = trassePfade.length > 0 ? trassePfade : [trasse]
      const neueLaengen = berechneLaengen(pfade, updated)
      setLaengen(neueLaengen)
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
    const neueLaengen = berechneLaengen(pfade, projekt.hausanschluesse)
    setLaengen(neueLaengen)
    setEditierbarAktiv(false)
    const orteListe = extractOrte(projekt.adressen)
    setOrte(orteListe)
    setAktiveOrteKeys(orteListe.map((o) => o.key))
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-[#0f0f0f]">
      <Sidebar
        adressenCount={adressen.length}
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
        onEditierbarToggle={handleEditierbarToggle}
        onAllesZuruecksetzen={handleAllesZuruecksetzen}
        onKMLExport={handleKMLExport}
        onProjektSpeichern={handleProjektSpeichern}
        onProjektLaden={handleProjektLaden}
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

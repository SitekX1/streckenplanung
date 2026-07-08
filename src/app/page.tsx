'use client'

import dynamic from 'next/dynamic'
import { useState, useCallback } from 'react'
import Sidebar from '../components/Sidebar'
import { Address, LatLng, Hausstich } from '../lib/types'
import { parseExcelFile } from '../lib/excelParser'
import { clusteredNearestNeighborTSP } from '../lib/tsp'
import { routeEntlangStrassen } from '../lib/osrmClient'
import { berechneHausanschluesse, berechneLaengen } from '../lib/hausanschluesse'
import { exportKML } from '../lib/kmlExport'
import { exportProjekt, importProjekt } from '../lib/projektSpeichern'

const MapView = dynamic(() => import('../components/MapView'), { ssr: false })

export default function Home() {
  const [adressen, setAdressen] = useState<Address[]>([])
  const [startpunkt, setStartpunkt] = useState<LatLng | null>(null)
  const [startpunktSetzenAktiv, setStartpunktSetzenAktiv] = useState(false)
  const [trasse, setTrasse] = useState<LatLng[]>([])
  const [hausanschluesse, setHausanschluesse] = useState<Hausstich[]>([])
  const [trasseProgress, setTrasseProgress] = useState(0)
  const [hausanschluesseProgress, setHausanschluesseProgress] = useState(0)
  const [laengen, setLaengen] = useState({
    trassenLaenge: 0,
    hausanschluesseLaenge: 0,
    gesamt: 0,
  })
  const [editierbarAktiv, setEditierbarAktiv] = useState(false)
  const [projektName] = useState('Neues Projekt')
  const [adressFarbe, setAdressFarbe] = useState('#22c55e')
  const [trasseFarbe, setTrasseFarbe] = useState('#3b82f6')
  const [hausanschlussfarbe, setHausanschlussfarbe] = useState('#ef4444')

  const handleExcelImport = useCallback(async (file: File) => {
    const ergebnis = await parseExcelFile(file)
    setAdressen(ergebnis)
  }, [])

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
    setTrasseProgress(1)

    const geordnetePunkte = clusteredNearestNeighborTSP(startpunkt, adressen)

    const result = await routeEntlangStrassen(geordnetePunkte, (p) => {
      setTrasseProgress(p)
    })

    setTrasse(result)
    setTrasseProgress(100)

    const neueLaengen = berechneLaengen(result, [])
    setLaengen(neueLaengen)

    setTimeout(() => setTrasseProgress(0), 500)
  }, [startpunkt, adressen])

  const handleHausanschluesseGenerieren = useCallback(async () => {
    if (trasse.length < 2) return

    setHausanschluesseProgress(1)

    const ergebnis = await berechneHausanschluesse(trasse, adressen, (p) => {
      setHausanschluesseProgress(p)
    })

    setHausanschluesse(ergebnis)
    setHausanschluesseProgress(100)

    const neueLaengen = berechneLaengen(trasse, ergebnis)
    setLaengen(neueLaengen)

    setTimeout(() => setHausanschluesseProgress(0), 500)
  }, [trasse, adressen])

  const handleTrasseGeaendert = useCallback(
    (punkte: LatLng[]) => {
      setTrasse(punkte)
      const neueLaengen = berechneLaengen(punkte, hausanschluesse)
      setLaengen(neueLaengen)
    },
    [hausanschluesse]
  )

  const handleHausanschluesseGeaendert = useCallback(
    (updated: Hausstich[]) => {
      setHausanschluesse(updated)
      const neueLaengen = berechneLaengen(trasse, updated)
      setLaengen(neueLaengen)
    },
    [trasse]
  )

  const handleEditierbarToggle = useCallback(() => {
    setEditierbarAktiv((v) => !v)
  }, [])

  const handleKMLExport = useCallback(() => {
    exportKML({
      name: projektName,
      erstelltAm: new Date().toISOString(),
      adressen,
      startpunkt,
      trasse,
      hausanschluesse,
      trassenLaengeMeter: laengen.trassenLaenge,
      hausanschlussLaengeMeter: laengen.hausanschluesseLaenge,
    })
  }, [projektName, adressen, startpunkt, trasse, hausanschluesse, laengen])

  const handleProjektSpeichern = useCallback(() => {
    exportProjekt({
      name: projektName,
      erstelltAm: new Date().toISOString(),
      adressen,
      startpunkt,
      trasse,
      hausanschluesse,
      trassenLaengeMeter: laengen.trassenLaenge,
      hausanschlussLaengeMeter: laengen.hausanschluesseLaenge,
    })
  }, [projektName, adressen, startpunkt, trasse, hausanschluesse, laengen])

  const handleProjektLaden = useCallback(async (file: File) => {
    const projekt = await importProjekt(file)
    setAdressen(projekt.adressen)
    setStartpunkt(projekt.startpunkt)
    setTrasse(projekt.trasse)
    setHausanschluesse(projekt.hausanschluesse)
    const neueLaengen = berechneLaengen(projekt.trasse, projekt.hausanschluesse)
    setLaengen(neueLaengen)
    setEditierbarAktiv(false)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-[#0f0f0f]">
      <Sidebar
        adressenCount={adressen.length}
        startpunktGesetzt={startpunkt !== null}
        startpunktKoords={startpunkt}
        trasseVorhanden={trasse.length >= 2}
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
        onStartpunktSetzen={handleStartpunktSetzen}
        onStartpunktZuruecksetzen={handleStartpunktZuruecksetzen}
        onTrasseGenerieren={handleTrasseGenerieren}
        onHausanschluesseGenerieren={handleHausanschluesseGenerieren}
        onEditierbarToggle={handleEditierbarToggle}
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
          hausanschluesse={hausanschluesse}
          editierbarAktiv={editierbarAktiv}
          adressFarbe={adressFarbe}
          trasseFarbe={trasseFarbe}
          hausanschlussfarbe={hausanschlussfarbe}
          onStartpunktGesetzt={handleStartpunktGesetzt}
          onTrasseGeaendert={handleTrasseGeaendert}
          onHausanschluesseGeaendert={handleHausanschluesseGeaendert}
        />
      </main>
    </div>
  )
}

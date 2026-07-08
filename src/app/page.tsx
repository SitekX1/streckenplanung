'use client'

import dynamic from 'next/dynamic'
import { useState, useCallback } from 'react'
import Sidebar from '../components/Sidebar'
import { Address, LatLng, Hausstich } from '../lib/types'
import { parseExcelFile } from '../lib/excelParser'
import { nearestNeighborTSP } from '../lib/tsp'
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
  const [laengen, setLaengen] = useState({
    trassenLaenge: 0,
    hausanschluesseLaenge: 0,
    gesamt: 0,
  })
  const [editierbarAktiv] = useState(false)
  const [projektName] = useState('Neues Projekt')

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

    setTrasseProgress(1)

    const adressPunkte: LatLng[] = adressen.map((a) => ({ lat: a.lat, lng: a.lon }))
    const geordnetePunkte = nearestNeighborTSP(startpunkt, adressPunkte)

    const result = await routeEntlangStrassen(geordnetePunkte, (p) => {
      setTrasseProgress(p)
    })

    setTrasse(result)
    setTrasseProgress(100)

    const neueLaengen = berechneLaengen(result, hausanschluesse)
    setLaengen(neueLaengen)

    setTimeout(() => setTrasseProgress(0), 500)
  }, [startpunkt, adressen, hausanschluesse])

  const handleHausanschluesseGenerieren = useCallback(() => {
    if (trasse.length < 2) return

    const ergebnis = berechneHausanschluesse(trasse, adressen)
    setHausanschluesse(ergebnis)

    const neueLaengen = berechneLaengen(trasse, ergebnis)
    setLaengen(neueLaengen)
  }, [trasse, adressen])

  const handleTrasseGeaendert = useCallback(
    (punkte: LatLng[]) => {
      setTrasse(punkte)
      const neueLaengen = berechneLaengen(punkte, hausanschluesse)
      setLaengen(neueLaengen)
    },
    [hausanschluesse]
  )

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
        onExcelImport={handleExcelImport}
        onStartpunktSetzen={handleStartpunktSetzen}
        onStartpunktZuruecksetzen={handleStartpunktZuruecksetzen}
        onTrasseGenerieren={handleTrasseGenerieren}
        onHausanschluesseGenerieren={handleHausanschluesseGenerieren}
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
          onStartpunktGesetzt={handleStartpunktGesetzt}
          onTrasseGeaendert={handleTrasseGeaendert}
        />
      </main>
    </div>
  )
}

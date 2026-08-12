'use client'

import { useEffect, useState } from 'react'
import { exportKalkulationPdf } from '../lib/kalkulationPdfExport'
import { ladeFirmendaten } from '../lib/firmendaten'
import { aktivesMaterialProfil, lrArtLabel } from '../lib/materialkatalog'

interface KalkulationModalProps {
  projektName: string
  strasseLaenge: number
  feldwegLaenge: number
  hausanschluesseCount: number
  hausanschlussLaenge: number
  nvtAnzahl: number
  schachtAnzahl: number
  bundesfoerderung: boolean
  onClose: () => void
}

interface KalkulationPreise {
  strassePreisProMeter: number
  feldwegPreisProMeter: number
  hausanschlussPreis: number
  sonderpositionAnzahl: number
  sonderpositionPreis: number
  nvtPreis: number
  schachtPreis: number
}

const STORAGE_KEY = 'streckenplanung-kalkulation-preise'

const DEFAULT_PREISE: KalkulationPreise = {
  strassePreisProMeter: 45,
  feldwegPreisProMeter: 25,
  hausanschlussPreis: 800,
  sonderpositionAnzahl: 0,
  sonderpositionPreis: 250,
  nvtPreis: 3500,
  schachtPreis: 800,
}

function ladePreise(): KalkulationPreise {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PREISE
    return { ...DEFAULT_PREISE, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_PREISE
  }
}

function formatEuro(betrag: number): string {
  return betrag.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

export default function KalkulationModal({
  projektName, strasseLaenge, feldwegLaenge, hausanschluesseCount, hausanschlussLaenge, nvtAnzahl, schachtAnzahl, bundesfoerderung, onClose,
}: KalkulationModalProps) {
  // Material-Leerrohrpreise (nicht Verlegekosten — die stehen separat oben)
  // kommen aus dem geräteweiten Materialkatalog, je nach Projekt-Schalter
  // "Bundesförderung" das passende Profil (siehe EinstellungenModal.tsx).
  const materialProfil = aktivesMaterialProfil(bundesfoerderung)
  const trassenLaengeGesamt = strasseLaenge + feldwegLaenge
  // Preise sind geräteweit gespeichert (nicht Teil des Projekts) — die
  // Sätze eurer Firma ändern sich kaum von Projekt zu Projekt, im
  // Gegensatz zu den Streckenlängen/Stückzahlen selbst. Lazy-Initializer
  // statt Effect, da localStorage nur einmalig beim ersten Rendern gelesen
  // werden muss (kein externer Trigger, auf den reagiert werden müsste).
  const [preise, setPreise] = useState<KalkulationPreise>(ladePreise)
  // Rohtext je Feld getrennt von preise (Zahlen) gehalten — bei Number-State
  // sprang das Feld beim Löschen der letzten Ziffer sofort auf 0 zurück,
  // ein leeres Feld zum Neueintippen war nicht möglich (selbes Muster wie
  // reserveText/distanzText in NVTModal.tsx).
  const [preisTexte, setPreisTexte] = useState<Record<keyof KalkulationPreise, string>>(() => {
    const initial = ladePreise()
    return Object.fromEntries(
      (Object.keys(initial) as (keyof KalkulationPreise)[]).map((k) => [k, String(initial[k])])
    ) as Record<keyof KalkulationPreise, string>
  })

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preise)) } catch { /* ignorieren */ }
  }, [preise])

  const feld = (label: string, key: keyof KalkulationPreise, einheit: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-gray-400">{label}</span>
      <div className="flex items-center rounded-lg overflow-hidden" style={{ border: '1px solid #374151', backgroundColor: '#111827' }}>
        <input
          type="number"
          min={0}
          value={preisTexte[key]}
          onChange={(e) => {
            const text = e.target.value
            setPreisTexte((p) => ({ ...p, [key]: text }))
            setPreise((p) => ({ ...p, [key]: Number(text) || 0 }))
          }}
          className="flex-1 min-w-0 px-3 py-2 text-sm outline-none"
          style={{ backgroundColor: 'transparent', color: '#f9fafb' }}
        />
        <span className="px-3 text-xs text-gray-500 shrink-0 border-l" style={{ borderColor: '#374151' }}>{einheit}</span>
      </div>
    </label>
  )

  const strasseSumme = strasseLaenge * preise.strassePreisProMeter
  const feldwegSumme = feldwegLaenge * preise.feldwegPreisProMeter
  const hausanschlussSumme = hausanschluesseCount * preise.hausanschlussPreis
  const sonderpositionSumme = preise.sonderpositionAnzahl * preise.sonderpositionPreis
  const nvtSumme = nvtAnzahl * preise.nvtPreis
  const schachtSumme = schachtAnzahl * preise.schachtPreis
  const materialTrasseSumme = trassenLaengeGesamt * materialProfil.trasse.preisProMeter
  const materialHausanschlussSumme = hausanschlussLaenge * materialProfil.hausanschluss.preisProMeter
  const gesamt =
    strasseSumme + feldwegSumme + hausanschlussSumme + sonderpositionSumme + nvtSumme + schachtSumme +
    materialTrasseSumme + materialHausanschlussSumme

  const handlePdfExport = () => {
    const zeilen = [
      { label: 'Befestigte Oberfläche', menge: `${Math.round(strasseLaenge)} m`, einzelpreis: `${preise.strassePreisProMeter} €/m`, summe: strasseSumme },
      { label: 'Unbefestigte Oberfläche', menge: `${Math.round(feldwegLaenge)} m`, einzelpreis: `${preise.feldwegPreisProMeter} €/m`, summe: feldwegSumme },
      { label: 'Hausanschlüsse', menge: `${hausanschluesseCount} Stk.`, einzelpreis: `${preise.hausanschlussPreis} €/Stk.`, summe: hausanschlussSumme },
      ...(preise.sonderpositionAnzahl > 0
        ? [{ label: 'Sonderposition', menge: `${preise.sonderpositionAnzahl} Stk.`, einzelpreis: `${preise.sonderpositionPreis} €/Stk.`, summe: sonderpositionSumme }]
        : []),
      ...(nvtAnzahl > 0
        ? [{ label: 'NVT', menge: `${nvtAnzahl} Stk.`, einzelpreis: `${preise.nvtPreis} €/Stk.`, summe: nvtSumme }]
        : []),
      ...(schachtAnzahl > 0
        ? [{ label: 'Schacht', menge: `${schachtAnzahl} Stk.`, einzelpreis: `${preise.schachtPreis} €/Stk.`, summe: schachtSumme }]
        : []),
      ...(materialProfil.trasse.preisProMeter > 0
        ? [{ label: `Material Trasse (${materialProfil.trasse.bezeichnungFirma})`, menge: `${Math.round(trassenLaengeGesamt)} m`, einzelpreis: `${materialProfil.trasse.preisProMeter} €/m`, summe: materialTrasseSumme }]
        : []),
      ...(materialProfil.hausanschluss.preisProMeter > 0
        ? [{ label: `Material Hausanschluss (${materialProfil.hausanschluss.bezeichnungFirma})`, menge: `${Math.round(hausanschlussLaenge)} m`, einzelpreis: `${materialProfil.hausanschluss.preisProMeter} €/m`, summe: materialHausanschlussSumme }]
        : []),
    ]
    const firmendaten = ladeFirmendaten()
    const adresse = [
      [firmendaten.strasse, firmendaten.hausnummer].filter(Boolean).join(' '),
      [firmendaten.plz, firmendaten.ort].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join('\n')
    exportKalkulationPdf({
      projektName,
      zeilen,
      gesamt,
      logoDataUrl: firmendaten.logoDataUrl,
      logoBreite: firmendaten.logoBreite,
      logoHoehe: firmendaten.logoHoehe,
      firmenname: firmendaten.firmenname,
      adresse,
    })
  }

  const zeile = (label: string, menge: string, summe: number) => (
    <div className="flex justify-between items-center text-xs py-1.5" style={{ borderBottom: '1px solid #1f2430' }}>
      <span className="text-gray-500">{label} <span className="text-gray-600">({menge})</span></span>
      <span className="text-gray-200 font-medium">{formatEuro(summe)}</span>
    </div>
  )

  const sektion = (titel: string, inhalt: React.ReactNode) => (
    <div className="rounded-xl p-3.5" style={{ backgroundColor: '#181c24', border: '1px solid #262b36' }}>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">{titel}</p>
      <div className="grid grid-cols-2 gap-3">{inhalt}</div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-1000 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div className="rounded-2xl shadow-2xl flex flex-col"
        style={{ backgroundColor: '#14171d', border: '1px solid #2a2f3a', width: 420, maxHeight: '90vh' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: '#262b36' }}>
          <span className="text-base font-semibold text-white">💰 Kalkulation</span>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-sm hover:bg-gray-800 transition-colors"
            style={{ color: '#9ca3af' }}>
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-3 p-5 overflow-y-auto">
          {sektion('🛣️ Trasse', (
            <>
              {feld('Befestigte Oberfläche', 'strassePreisProMeter', '€/m')}
              {feld('Unbefestigte Oberfläche', 'feldwegPreisProMeter', '€/m')}
            </>
          ))}

          {sektion('🏠 Hausanschluss', (
            <>
              {feld('Preis / Stück', 'hausanschlussPreis', '€')}
              <div />
              {feld('Sonderposition · Anzahl', 'sonderpositionAnzahl', 'Stk.')}
              {feld('Sonderposition · Preis', 'sonderpositionPreis', '€/Stk.')}
              <p className="col-span-2 text-xs text-gray-600 -mt-1.5">
                Frei nutzbarer Zusatzposten, z.B. für Erschwerniszuschläge, Bohrungen oder sonstige Sonderfälle, die nicht über die Standardsätze abgedeckt sind.
              </p>
            </>
          ))}

          {sektion('📡 NVT', (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-gray-400">Anzahl (aus Projekt)</span>
                <div className="flex items-center rounded-lg px-3 py-2 text-sm" style={{ border: '1px solid #374151', backgroundColor: '#0d1117', color: '#9ca3af' }}>
                  {nvtAnzahl} Stk.
                </div>
              </div>
              {feld('Preis / Stück', 'nvtPreis', '€')}
            </>
          ))}

          {sektion('🕳️ Schacht', (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-gray-400">Anzahl (aus Projekt)</span>
                <div className="flex items-center rounded-lg px-3 py-2 text-sm" style={{ border: '1px solid #374151', backgroundColor: '#0d1117', color: '#9ca3af' }}>
                  {schachtAnzahl} Stk.
                </div>
              </div>
              {feld('Preis / Stück', 'schachtPreis', '€')}
            </>
          ))}

          {sektion(`🧵 Material${bundesfoerderung ? ' (Bundesförderung)' : ''}`, (
            <>
              <div className="col-span-2 flex flex-col gap-1">
                <span className="text-xs text-gray-400">
                  Trasse: {materialProfil.trasse.bezeichnungFirma} · {lrArtLabel(materialProfil.trasse.lrArt)}
                </span>
                <span className="text-xs text-gray-400">
                  Hausanschluss: {materialProfil.hausanschluss.bezeichnungFirma} · {lrArtLabel(materialProfil.hausanschluss.lrArt)}
                </span>
                <span className="text-xs text-gray-600">
                  Preise (€/m) unter ⚙️ Einstellungen → Materialkatalog hinterlegen.
                </span>
              </div>
            </>
          ))}

          <div className="rounded-xl p-4 flex flex-col mt-1" style={{ backgroundColor: '#0f1216', border: '1px solid #262b36' }}>
            {zeile('Befestigte Oberfläche', `${Math.round(strasseLaenge)} m`, strasseSumme)}
            {zeile('Unbefestigte Oberfläche', `${Math.round(feldwegLaenge)} m`, feldwegSumme)}
            {zeile('Hausanschlüsse', `${hausanschluesseCount} Stk.`, hausanschlussSumme)}
            {preise.sonderpositionAnzahl > 0 && zeile('Sonderposition', `${preise.sonderpositionAnzahl} Stk.`, sonderpositionSumme)}
            {nvtAnzahl > 0 && zeile('NVT', `${nvtAnzahl} Stk.`, nvtSumme)}
            {schachtAnzahl > 0 && zeile('Schacht', `${schachtAnzahl} Stk.`, schachtSumme)}
            {materialTrasseSumme > 0 && zeile(`Material Trasse`, `${Math.round(trassenLaengeGesamt)} m`, materialTrasseSumme)}
            {materialHausanschlussSumme > 0 && zeile(`Material Hausanschluss`, `${Math.round(hausanschlussLaenge)} m`, materialHausanschlussSumme)}
            <div className="flex justify-between items-center pt-3 mt-1.5" style={{ borderTop: '1px solid #262b36' }}>
              <span className="text-sm font-medium text-gray-300">Gesamt</span>
              <span className="text-lg font-semibold text-blue-400">{formatEuro(gesamt)}</span>
            </div>
          </div>

          <button onClick={handlePdfExport}
            className="w-full px-3 py-2.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors">
            📄 Als PDF exportieren
          </button>

          <p className="text-xs text-gray-600 text-center">
            Preise werden geräteweit gespeichert und gelten projektübergreifend.
          </p>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'

interface KalkulationModalProps {
  strasseLaenge: number
  feldwegLaenge: number
  hausanschluesseCount: number
  onClose: () => void
}

interface KalkulationPreise {
  strassePreisProMeter: number
  feldwegPreisProMeter: number
  hausanschlussPreis: number
  sondergebuehrAnzahl: number
  sondergebuehrPreis: number
  nvtAnzahl: number
  nvtPreis: number
}

const STORAGE_KEY = 'streckenplanung-kalkulation-preise'

const DEFAULT_PREISE: KalkulationPreise = {
  strassePreisProMeter: 45,
  feldwegPreisProMeter: 25,
  hausanschlussPreis: 800,
  sondergebuehrAnzahl: 0,
  sondergebuehrPreis: 250,
  nvtAnzahl: 0,
  nvtPreis: 3500,
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
  strasseLaenge, feldwegLaenge, hausanschluesseCount, onClose,
}: KalkulationModalProps) {
  // Preise sind geräteweit gespeichert (nicht Teil des Projekts) — die
  // Sätze eurer Firma ändern sich kaum von Projekt zu Projekt, im
  // Gegensatz zu den Streckenlängen/Stückzahlen selbst. Lazy-Initializer
  // statt Effect, da localStorage nur einmalig beim ersten Rendern gelesen
  // werden muss (kein externer Trigger, auf den reagiert werden müsste).
  const [preise, setPreise] = useState<KalkulationPreise>(ladePreise)

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
          value={preise[key]}
          onChange={(e) => setPreise((p) => ({ ...p, [key]: Number(e.target.value) || 0 }))}
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
  const sondergebuehrSumme = preise.sondergebuehrAnzahl * preise.sondergebuehrPreis
  const nvtSumme = preise.nvtAnzahl * preise.nvtPreis
  const gesamt = strasseSumme + feldwegSumme + hausanschlussSumme + sondergebuehrSumme + nvtSumme

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
              {feld('Sondergebühr · Anzahl', 'sondergebuehrAnzahl', 'Stk.')}
              {feld('Sondergebühr · Preis', 'sondergebuehrPreis', '€/Stk.')}
            </>
          ))}

          {sektion('📡 NVT', (
            <>
              {feld('Anzahl', 'nvtAnzahl', 'Stk.')}
              {feld('Preis / Stück', 'nvtPreis', '€')}
            </>
          ))}

          <div className="rounded-xl p-4 flex flex-col mt-1" style={{ backgroundColor: '#0f1216', border: '1px solid #262b36' }}>
            {zeile('Befestigte Oberfläche', `${Math.round(strasseLaenge)} m`, strasseSumme)}
            {zeile('Unbefestigte Oberfläche', `${Math.round(feldwegLaenge)} m`, feldwegSumme)}
            {zeile('Hausanschlüsse', `${hausanschluesseCount} Stk.`, hausanschlussSumme)}
            {preise.sondergebuehrAnzahl > 0 && zeile('Sondergebühr', `${preise.sondergebuehrAnzahl} Stk.`, sondergebuehrSumme)}
            {preise.nvtAnzahl > 0 && zeile('NVT', `${preise.nvtAnzahl} Stk.`, nvtSumme)}
            <div className="flex justify-between items-center pt-3 mt-1.5" style={{ borderTop: '1px solid #262b36' }}>
              <span className="text-sm font-medium text-gray-300">Gesamt</span>
              <span className="text-lg font-semibold text-blue-400">{formatEuro(gesamt)}</span>
            </div>
          </div>

          <p className="text-xs text-gray-600 text-center">
            Preise werden geräteweit gespeichert und gelten projektübergreifend.
          </p>
        </div>
      </div>
    </div>
  )
}

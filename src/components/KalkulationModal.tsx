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

  const feld = (
    label: string,
    key: keyof KalkulationPreise,
    einheit: string
  ) => (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-gray-400">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={0}
          value={preise[key]}
          onChange={(e) => setPreise((p) => ({ ...p, [key]: Number(e.target.value) || 0 }))}
          className="w-24 px-2 py-1 rounded text-sm text-right outline-none"
          style={{ backgroundColor: '#111827', color: '#f9fafb', border: '1px solid #374151' }}
        />
        <span className="text-xs text-gray-500 w-16">{einheit}</span>
      </div>
    </div>
  )

  const strasseSumme = strasseLaenge * preise.strassePreisProMeter
  const feldwegSumme = feldwegLaenge * preise.feldwegPreisProMeter
  const hausanschlussSumme = hausanschluesseCount * preise.hausanschlussPreis
  const sondergebuehrSumme = preise.sondergebuehrAnzahl * preise.sondergebuehrPreis
  const nvtSumme = preise.nvtAnzahl * preise.nvtPreis
  const gesamt = strasseSumme + feldwegSumme + hausanschlussSumme + sondergebuehrSumme + nvtSumme

  const zeile = (label: string, menge: string, summe: number) => (
    <div className="flex justify-between items-center text-xs py-1" style={{ borderBottom: '1px solid #262b36' }}>
      <span className="text-gray-500">{label} <span className="text-gray-600">({menge})</span></span>
      <span className="text-gray-200 font-medium">{formatEuro(summe)}</span>
    </div>
  )

  return (
    <div className="fixed inset-0 z-1000 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-lg shadow-lg p-4 flex flex-col gap-3"
        style={{ backgroundColor: '#1a1a1a', border: '1px solid #374151', width: 360, maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-white">💰 Kalkulation</span>
          <button onClick={onClose} className="text-xs px-2 py-1 rounded" style={{ color: '#9ca3af' }}>✕</button>
        </div>

        <div className="flex flex-col gap-2">
          {feld('Straße-Trasse', 'strassePreisProMeter', '€/m')}
          {feld('Feldweg-Trasse', 'feldwegPreisProMeter', '€/m')}
          {feld('Hausanschluss', 'hausanschlussPreis', '€/Stk.')}
          <div className="border-t my-0.5" style={{ borderColor: '#374151' }} />
          {feld('Sondergebühr · Anzahl', 'sondergebuehrAnzahl', 'Stk.')}
          {feld('Sondergebühr · Preis', 'sondergebuehrPreis', '€/Stk.')}
          <div className="border-t my-0.5" style={{ borderColor: '#374151' }} />
          {feld('NVT · Anzahl', 'nvtAnzahl', 'Stk.')}
          {feld('NVT · Preis', 'nvtPreis', '€/Stk.')}
        </div>

        <div className="rounded-lg p-3 flex flex-col mt-1" style={{ backgroundColor: '#111827' }}>
          {zeile('Straße', `${Math.round(strasseLaenge)} m`, strasseSumme)}
          {zeile('Feldweg', `${Math.round(feldwegLaenge)} m`, feldwegSumme)}
          {zeile('Hausanschlüsse', `${hausanschluesseCount} Stk.`, hausanschlussSumme)}
          {preise.sondergebuehrAnzahl > 0 && zeile('Sondergebühr', `${preise.sondergebuehrAnzahl} Stk.`, sondergebuehrSumme)}
          {preise.nvtAnzahl > 0 && zeile('NVT', `${preise.nvtAnzahl} Stk.`, nvtSumme)}
          <div className="flex justify-between items-center pt-2 mt-1" style={{ borderTop: '1px solid #374151' }}>
            <span className="text-sm font-medium text-gray-300">Gesamt</span>
            <span className="text-base font-semibold text-blue-400">{formatEuro(gesamt)}</span>
          </div>
        </div>

        <p className="text-xs text-gray-600">
          Preise werden geräteweit gespeichert und gelten projektübergreifend.
        </p>
      </div>
    </div>
  )
}

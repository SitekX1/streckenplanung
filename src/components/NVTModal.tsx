'use client'

import { useState } from 'react'
import { OrtInfo } from '../lib/types'

interface NVTModalProps {
  orte: OrtInfo[]
  aussiedlerhofAnzahl: number
  nvtVorhandenAnzahl: number
  onAussiedlerhoefeMarkieren: () => void
  onGenerieren: (ausgewaehlteOrteKeys: string[], distanzMeter: number) => void
  onClose: () => void
}

export default function NVTModal({
  orte, aussiedlerhofAnzahl, nvtVorhandenAnzahl,
  onAussiedlerhoefeMarkieren, onGenerieren, onClose,
}: NVTModalProps) {
  const [ausgewaehlt, setAusgewaehlt] = useState<Set<string>>(new Set())
  const [distanz, setDistanz] = useState(500)

  function toggle(key: string) {
    setAusgewaehlt((prev) => {
      const neu = new Set(prev)
      if (neu.has(key)) neu.delete(key)
      else neu.add(key)
      return neu
    })
  }

  return (
    <div className="fixed inset-0 z-1000 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-lg shadow-lg p-4 flex flex-col gap-3"
        style={{ backgroundColor: '#1a1a1a', border: '1px solid #374151', width: 360, maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-white">📡 NVT generieren</span>
          <button onClick={onClose} className="text-xs px-2 py-1 rounded" style={{ color: '#9ca3af' }}>✕</button>
        </div>

        <button
          onClick={onAussiedlerhoefeMarkieren}
          className="w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ backgroundColor: '#374151', color: '#f9fafb' }}
        >
          🚜 Aussiedlerhöfe markieren {aussiedlerhofAnzahl > 0 && `(${aussiedlerhofAnzahl})`}
        </button>
        <p className="text-xs text-gray-500 -mt-1">
          Markierte Adressen sind von der Abstandsregel ausgenommen (Anfahrt mit größerem Kabel, hängen aber trotzdem am nächsten NVT).
        </p>

        <div className="border-t" style={{ borderColor: '#374151' }} />

        <div>
          <p className="text-xs font-medium text-gray-400 mb-1.5">Für welche(s) Dorf/Dörfer?</p>
          <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto rounded-lg" style={{ backgroundColor: '#111827' }}>
            {orte.map((ort) => (
              <label key={ort.key} className="flex items-center gap-2.5 px-2.5 py-1.5 cursor-pointer hover:bg-gray-800 transition-colors">
                <input
                  type="checkbox"
                  checked={ausgewaehlt.has(ort.key)}
                  onChange={() => toggle(ort.key)}
                  className="accent-blue-500 w-3.5 h-3.5 shrink-0"
                />
                <span className="text-xs text-gray-300 flex-1 truncate">{ort.name}</span>
                <span className="text-[10px] text-gray-600 shrink-0">{ort.anzahl}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-gray-400">Max. Distanz Hausanschluss → NVT</span>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              value={distanz}
              onChange={(e) => setDistanz(Number(e.target.value) || 500)}
              className="w-20 px-2 py-1 rounded text-sm text-right outline-none"
              style={{ backgroundColor: '#111827', color: '#f9fafb', border: '1px solid #374151' }}
            />
            <span className="text-xs text-gray-500">m</span>
          </div>
        </div>

        {nvtVorhandenAnzahl > 0 && (
          <p className="text-xs text-gray-500">Bereits {nvtVorhandenAnzahl} NVT-Standort(e) auf der Karte.</p>
        )}

        <button
          onClick={() => onGenerieren([...ausgewaehlt], distanz)}
          disabled={ausgewaehlt.size === 0}
          className="w-full px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          📡 NVT generieren
        </button>
      </div>
    </div>
  )
}

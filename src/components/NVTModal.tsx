'use client'

import { useState } from 'react'
import { OrtInfo } from '../lib/types'

interface NVTModalProps {
  orte: OrtInfo[]
  aussiedlerhofAnzahl: number
  nvtVorhandenAnzahl: number
  onAussiedlerhoefeMarkieren: () => void
  onManuellSetzen: () => void
  onGenerieren: (ausgewaehlteOrteKeys: string[], distanzMeter: number, erlaubteKapazitaeten: number[], kapazitaetsReserve: number) => void
  onClose: () => void
}

export default function NVTModal({
  orte, aussiedlerhofAnzahl, nvtVorhandenAnzahl,
  onAussiedlerhoefeMarkieren, onManuellSetzen, onGenerieren, onClose,
}: NVTModalProps) {
  const [ausgewaehlt, setAusgewaehlt] = useState<Set<string>>(new Set())
  const [distanz, setDistanz] = useState(500)
  const [kapazitaeten, setKapazitaeten] = useState<Set<number>>(new Set([96, 120]))
  const [reserve, setReserve] = useState(0)

  function toggleKapazitaet(k: number) {
    setKapazitaeten((prev) => {
      const neu = new Set(prev)
      if (neu.has(k)) neu.delete(k)
      else neu.add(k)
      return neu
    })
  }

  function toggle(key: string) {
    setAusgewaehlt((prev) => {
      const neu = new Set(prev)
      if (neu.has(key)) neu.delete(key)
      else neu.add(key)
      return neu
    })
  }

  const sektion = (titel: string, inhalt: React.ReactNode) => (
    <div className="rounded-xl p-3.5" style={{ backgroundColor: '#181c24', border: '1px solid #262b36' }}>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">{titel}</p>
      {inhalt}
    </div>
  )

  return (
    <div className="fixed inset-0 z-1000 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div className="rounded-2xl shadow-2xl flex flex-col"
        style={{ backgroundColor: '#14171d', border: '1px solid #2a2f3a', width: 420, maxHeight: '90vh' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: '#262b36' }}>
          <span className="text-base font-semibold text-white">📡 NVT</span>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-sm hover:bg-gray-800 transition-colors"
            style={{ color: '#9ca3af' }}>
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-3 p-5 overflow-y-auto">

          {sektion('Werkzeuge', (
            <div className="flex flex-col gap-2">
              <button
                onClick={onAussiedlerhoefeMarkieren}
                className="w-full px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-colors hover:brightness-110"
                style={{ backgroundColor: '#2a2115', color: '#fbbf24', border: '1px solid #78350f' }}
              >
                🚜 Aussiedlerhöfe markieren {aussiedlerhofAnzahl > 0 && `(${aussiedlerhofAnzahl})`}
              </button>
              <p className="text-xs text-gray-600 px-0.5">
                Markierte Adressen sind von der Abstandsregel ausgenommen (Anfahrt mit größerem Kabel), hängen aber trotzdem am nächsten NVT.
              </p>

              <button
                onClick={onManuellSetzen}
                className="w-full px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-colors hover:brightness-110"
                style={{ backgroundColor: '#1e2a3a', color: '#93c5fd', border: '1px solid #1e3a5f' }}
              >
                📍 NVT manuell setzen
              </button>
              <p className="text-xs text-gray-600 px-0.5">
                Für Einzelfälle wie 2-3 benachbarte Aussiedlerhöfe — eigener Standort mit frei wählbarer Kapazität (z.B. kleiner 24er-Verband statt 96/120), Hausanschlüsse danach per Klick zuweisen.
              </p>
            </div>
          ))}

          {sektion('Automatisch generieren', (
            <div className="flex flex-col gap-3.5">
              <div>
                <p className="text-xs text-gray-400 mb-1.5">Für welche(s) Dorf/Dörfer?</p>
                <div className="flex flex-col gap-0.5 max-h-36 overflow-y-auto rounded-lg" style={{ backgroundColor: '#111827', border: '1px solid #262b36' }}>
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

              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-400">Max. Distanz Hausanschluss → NVT</span>
                <div className="flex items-center rounded-lg overflow-hidden" style={{ border: '1px solid #374151', backgroundColor: '#111827' }}>
                  <input
                    type="number"
                    min={1}
                    value={distanz}
                    onChange={(e) => setDistanz(Number(e.target.value) || 500)}
                    className="flex-1 min-w-0 px-3 py-2 text-sm outline-none"
                    style={{ backgroundColor: 'transparent', color: '#f9fafb' }}
                  />
                  <span className="px-3 text-xs text-gray-500 shrink-0 border-l" style={{ borderColor: '#374151' }}>Meter</span>
                </div>
              </label>

              <div>
                <p className="text-xs text-gray-400 mb-1.5">Erlaubte NVT-Kapazitäten (Rohr)</p>
                <div className="flex items-center gap-1.5">
                  {[96, 120].map((k) => (
                    <button
                      key={k}
                      onClick={() => toggleKapazitaet(k)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                      style={{
                        backgroundColor: kapazitaeten.has(k) ? '#1e3a5f' : '#111827',
                        color: kapazitaeten.has(k) ? '#93c5fd' : '#9ca3af',
                        border: `1px solid ${kapazitaeten.has(k) ? '#3b82f6' : '#374151'}`,
                      }}
                    >
                      {k}er
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-600 mt-1.5">
                  Pro Standort wird die kleinste ausreichende Kapazität genutzt. Reicht selbst die größte nicht, wird geografisch aufgeteilt — nie zwei NVT am selben Ort.
                </p>
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-400">Reserve pro Standort (Röhrchen frei lassen)</span>
                <div className="flex items-center rounded-lg overflow-hidden" style={{ border: '1px solid #374151', backgroundColor: '#111827' }}>
                  <input
                    type="number"
                    min={0}
                    value={reserve}
                    onChange={(e) => setReserve(Math.max(0, Number(e.target.value) || 0))}
                    className="flex-1 min-w-0 px-3 py-2 text-sm outline-none"
                    style={{ backgroundColor: 'transparent', color: '#f9fafb' }}
                  />
                  <span className="px-3 text-xs text-gray-500 shrink-0 border-l" style={{ borderColor: '#374151' }}>Stk.</span>
                </div>
              </label>
              <p className="text-xs text-gray-600 -mt-2">
                z.B. 50 bei einem 120er → es werden nur bis zu 70 Hausanschlüsse belegt, 50 bleiben als Reserve frei. Wirkt auf alle ausgewählten Kapazitäten.
              </p>

              {nvtVorhandenAnzahl > 0 && (
                <p className="text-xs text-gray-500">Bereits {nvtVorhandenAnzahl} NVT-Standort(e) auf der Karte.</p>
              )}

              <button
                onClick={() => onGenerieren([...ausgewaehlt], distanz, [...kapazitaeten], reserve)}
                disabled={ausgewaehlt.size === 0 || kapazitaeten.size === 0}
                className="w-full px-3 py-2.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                📡 NVT generieren
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

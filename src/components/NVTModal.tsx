'use client'

import { useState } from 'react'
import { OrtInfo } from '../lib/types'

interface NVTModalProps {
  orte: OrtInfo[]
  aussiedlerhofAnzahl: number
  nvtVorhandenAnzahl: number
  schachtVorhandenAnzahl: number
  onAussiedlerhoefeMarkieren: () => void
  onManuellSetzen: () => void
  onSchachtSetzen: () => void
  onGenerieren: (ausgewaehlteOrteKeys: string[], distanzMeter: number, erlaubteKapazitaeten: number[], kapazitaetsReserve: number) => void
  // 2026-08-14, Alex: bei einem großen Mehr-Ortsteil-Projekt (Dresden,
  // ~1100 Adressen) konnte NVT generieren spürbar dauern, ohne dass sich
  // irgendwas rührte — Button zeigt jetzt einen Lade-Zustand statt so
  // auszusehen, als würde nichts passieren.
  berechnungLaeuft?: boolean
  onClose: () => void
}

export default function NVTModal({
  orte, aussiedlerhofAnzahl, nvtVorhandenAnzahl, schachtVorhandenAnzahl,
  onAussiedlerhoefeMarkieren, onManuellSetzen, onSchachtSetzen, onGenerieren, berechnungLaeuft = false, onClose,
}: NVTModalProps) {
  const [ausgewaehlt, setAusgewaehlt] = useState<Set<string>>(new Set())
  // Als Text statt Number gehalten, damit das Feld beim Löschen wirklich leer
  // werden kann (bei Number-State sprang der Wert sofort auf 0/500 zurück,
  // sobald man die letzte Ziffer entfernt hat — Eingabe war so kaum möglich).
  // Der eigentliche Default greift erst beim tatsächlichen Verwenden (Klick
  // auf "NVT generieren"), nicht bei jedem Tastendruck.
  const [distanzText, setDistanzText] = useState('500')
  const [kapazitaeten, setKapazitaeten] = useState<Set<number>>(new Set([96, 120]))
  const [reserveText, setReserveText] = useState('')
  const distanz = Math.max(1, Number(distanzText) || 500)
  const reserve = Math.max(0, Number(reserveText) || 0)

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
    <div className="p-3.5" style={{ backgroundColor: 'var(--surface-2)', borderRadius: 'var(--radius-lg)' }}>
      <p className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>{titel}</p>
      {inhalt}
    </div>
  )

  return (
    <div className="fixed inset-0 z-1000 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(6,7,10,0.7)' }}>
      <div className="shadow-2xl flex flex-col"
        style={{ backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xl)', width: 420, maxHeight: '90vh' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <span className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>📡 NVT</span>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-sm transition-colors hover:brightness-125"
            style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)' }}>
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-3 p-5 overflow-y-auto">

          {sektion('Werkzeuge', (
            <div className="flex flex-col gap-2">
              <button
                onClick={onAussiedlerhoefeMarkieren}
                className="w-full px-3.5 py-2.5 text-sm font-medium text-left transition-colors hover:brightness-110"
                style={{ backgroundColor: 'var(--accent-amber-dim)', color: 'var(--accent-amber-bright)', borderRadius: 'var(--radius-md)' }}
              >
                🚜 Aussiedlerhöfe markieren {aussiedlerhofAnzahl > 0 && `(${aussiedlerhofAnzahl})`}
              </button>
              <p className="text-xs px-0.5" style={{ color: 'var(--text-tertiary)' }}>
                Markierte Adressen sind von der Abstandsregel ausgenommen (Anfahrt mit größerem Kabel), hängen aber trotzdem am nächsten NVT.
              </p>

              <button
                onClick={onManuellSetzen}
                className="w-full px-3.5 py-2.5 text-sm font-medium text-left transition-colors hover:brightness-110"
                style={{ backgroundColor: 'var(--accent-blue-dim)', color: '#93c5fd', borderRadius: 'var(--radius-md)' }}
              >
                📍 NVT manuell setzen
              </button>
              <p className="text-xs px-0.5" style={{ color: 'var(--text-tertiary)' }}>
                Für Einzelfälle wie 2-3 benachbarte Aussiedlerhöfe — eigener Standort mit frei wählbarer Kapazität (z.B. kleiner 24er-Verband statt 96/120), Hausanschlüsse danach per Klick zuweisen.
              </p>

              <button
                onClick={onSchachtSetzen}
                className="w-full px-3.5 py-2.5 text-sm font-medium text-left transition-colors hover:brightness-110"
                style={{ backgroundColor: 'var(--accent-teal-dim)', color: '#5eead4', borderRadius: 'var(--radius-md)' }}
              >
                🕳️ Schacht setzen {schachtVorhandenAnzahl > 0 && `(${schachtVorhandenAnzahl})`}
              </button>
              <p className="text-xs px-0.5" style={{ color: 'var(--text-tertiary)' }}>
                Kabelschacht/Übergabepunkt ohne Kapazitätsgrenze — z.B. als Zwischenpunkt bei zu langer Strecke zwischen Dörfern, oder zur direkten Anbindung einzelner Aussiedlerhöfe. Hausanschlüsse danach per Klick zuweisen.
              </p>
            </div>
          ))}

          {sektion('Automatisch generieren', (
            <div className="flex flex-col gap-3.5">
              <div>
                <p className="text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>Für welche(s) Dorf/Dörfer?</p>
                <div className="flex flex-col gap-0.5 max-h-36 overflow-y-auto" style={{ backgroundColor: 'var(--surface-3)', borderRadius: 'var(--radius-md)' }}>
                  {orte.map((ort) => (
                    <label key={ort.key} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors hover:brightness-125">
                      <input
                        type="checkbox"
                        checked={ausgewaehlt.has(ort.key)}
                        onChange={() => toggle(ort.key)}
                        className="accent-blue-500 w-3.5 h-3.5 shrink-0"
                      />
                      <span className="text-xs flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>{ort.name}</span>
                      <span className="text-[10px] shrink-0" style={{ color: 'var(--text-tertiary)' }}>{ort.anzahl}</span>
                    </label>
                  ))}
                </div>
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Max. Distanz Hausanschluss → NVT</span>
                <div className="flex items-center overflow-hidden" style={{ border: '1px solid var(--border-subtle)', backgroundColor: 'var(--surface-3)', borderRadius: 'var(--radius-md)' }}>
                  <input
                    type="number"
                    min={1}
                    value={distanzText}
                    onChange={(e) => setDistanzText(e.target.value)}
                    className="flex-1 min-w-0 px-3 py-2 text-sm outline-none"
                    style={{ backgroundColor: 'transparent', color: 'var(--text-primary)' }}
                  />
                  <span className="px-3 text-xs shrink-0" style={{ color: 'var(--text-tertiary)', borderLeft: '1px solid var(--border-subtle)' }}>Meter</span>
                </div>
              </label>

              <div>
                <p className="text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>Erlaubte NVT-Kapazitäten (Rohr)</p>
                <div className="flex items-center gap-1.5">
                  {[96, 120].map((k) => (
                    <button
                      key={k}
                      onClick={() => toggleKapazitaet(k)}
                      className="px-3.5 py-1.5 text-xs font-medium transition-colors"
                      style={{
                        backgroundColor: kapazitaeten.has(k) ? 'var(--accent-blue-dim)' : 'var(--surface-3)',
                        color: kapazitaeten.has(k) ? '#93c5fd' : 'var(--text-tertiary)',
                        border: `1px solid ${kapazitaeten.has(k) ? 'var(--accent-blue)' : 'var(--border-subtle)'}`,
                        borderRadius: 999,
                      }}
                    >
                      {k}er
                    </button>
                  ))}
                </div>
                <p className="text-xs mt-1.5" style={{ color: 'var(--text-tertiary)' }}>
                  Pro Standort wird die kleinste ausreichende Kapazität genutzt. Reicht selbst die größte nicht, wird geografisch aufgeteilt — nie zwei NVT am selben Ort.
                </p>
              </div>

              <label className="flex flex-col gap-1">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Reserve pro Standort (Röhrchen frei lassen)</span>
                <div className="flex items-center overflow-hidden" style={{ border: '1px solid var(--border-subtle)', backgroundColor: 'var(--surface-3)', borderRadius: 'var(--radius-md)' }}>
                  <input
                    type="number"
                    min={0}
                    value={reserveText}
                    onChange={(e) => setReserveText(e.target.value)}
                    className="flex-1 min-w-0 px-3 py-2 text-sm outline-none"
                    style={{ backgroundColor: 'transparent', color: 'var(--text-primary)' }}
                  />
                  <span className="px-3 text-xs shrink-0" style={{ color: 'var(--text-tertiary)', borderLeft: '1px solid var(--border-subtle)' }}>Stk.</span>
                </div>
              </label>
              <p className="text-xs -mt-2" style={{ color: 'var(--text-tertiary)' }}>
                z.B. 50 bei einem 120er → es werden nur bis zu 70 Hausanschlüsse belegt, 50 bleiben als Reserve frei. Wirkt auf alle ausgewählten Kapazitäten.
              </p>

              {nvtVorhandenAnzahl > 0 && (
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Bereits {nvtVorhandenAnzahl} NVT-Standort(e) auf der Karte.</p>
              )}

              <button
                onClick={() => onGenerieren([...ausgewaehlt], distanz, [...kapazitaeten], reserve)}
                disabled={ausgewaehlt.size === 0 || kapazitaeten.size === 0 || berechnungLaeuft}
                className="w-full px-3.5 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
                style={{ backgroundColor: 'var(--accent-blue)', borderRadius: 'var(--radius-md)' }}
              >
                {berechnungLaeuft ? '⏳ Wird berechnet …' : '📡 NVT generieren'}
              </button>
              {berechnungLaeuft && (
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Bei größeren Projekten kann das einen Moment dauern.
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

'use client'

import { useRef, useState } from 'react'
import { OrtInfo } from '../lib/types'
import KalkulationModal from './KalkulationModal'
import EinstellungenModal from './EinstellungenModal'

interface SidebarProps {
  projektName: string
  onProjektNameAendern: (name: string) => void
  adressenCount: number
  gefilterteAdressenAnzahl: number
  neueAdressenOhneHsAnzahl: number
  neueAdressenFuerTrasseAnzahl: number
  orte: OrtInfo[]
  aktiveOrteKeys: string[]
  startpunktGesetzt: boolean
  startpunktKoords: { lat: number; lng: number } | null
  trasseVorhanden: boolean
  hausanschluesseCount: number
  trassenLaenge: number
  hausanschlussLaenge: number
  gesamtLaenge: number
  strasseLaenge: number
  feldwegLaenge: number
  trasseProgress: number
  trasseLangsam: boolean
  hausanschluesseProgress: number
  editierbarAktiv: boolean
  adressFarbe: string
  trasseFarbe: string
  hausanschlussfarbe: string
  feldwegFarbe: string
  canUndo: boolean
  undoCount: number
  historyLabels: string[]
  onUndoZu: (index: number) => void
  nvtStandorteAnzahl: number
  schachtStandorteAnzahl: number
  onNvtButtonKlick: () => void
  onNvtNeuZuweisenKlick: () => void
  onAdressFarbeAendern: (farbe: string) => void
  onTrasseFarbeAendern: (farbe: string) => void
  onHausanschlussFarbeAendern: (farbe: string) => void
  onFeldwegFarbeAendern: (farbe: string) => void
  onOrtToggle: (key: string) => void
  onAlleOrteToggle: (alleAktiv: boolean) => void
  onExcelImport: (file: File) => void
  onStartpunktSetzen: () => void
  onStartpunktZuruecksetzen: () => void
  onTrasseGenerieren: () => void
  onHausanschluesseGenerieren: () => void
  onHausanschluesseHinzufuegen?: () => void
  onEditierbarToggle: () => void
  onAllesZuruecksetzen: () => void
  onKMLExport: () => void
  onShapefileExport: () => void
  onProjektSpeichern: () => void
  onProjektLaden: (file: File) => void
  onTrasseErweitern?: () => void
  onUndo: () => void
}

function formatMeter(meter: number): string {
  if (meter >= 1000) {
    return `${(meter / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`
  }
  return `${Math.round(meter).toLocaleString('de-DE')} m`
}

// Einklappbarer Abschnitt: Titel + optionales Badge (nur sichtbar wenn
// eingeklappt, zeigt eine Kurz-Zusammenfassung ohne den Inhalt aufklappen zu
// müssen — z.B. Adressenanzahl oder Trassenlänge). Zustand liegt beim
// Aufrufer (Sidebar selbst), nicht lokal im Abschnitt, damit man den
// Default-Zustand pro Sektion einzeln steuern kann.
function Abschnitt({
  titel,
  badge,
  offen,
  onToggle,
  children,
}: {
  titel: string
  badge?: string
  offen: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between mb-2 group"
      >
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider group-hover:text-gray-300 transition-colors">
          {titel}
        </span>
        <span className="flex items-center gap-2">
          {!offen && badge && (
            <span className="text-[10px] text-gray-500 normal-case tracking-normal">{badge}</span>
          )}
          <span
            className="text-gray-600 text-[10px] transition-transform inline-block"
            style={{ transform: offen ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            ▶
          </span>
        </span>
      </button>
      {offen && children}
    </div>
  )
}

export default function Sidebar({
  projektName,
  onProjektNameAendern,
  adressenCount,
  gefilterteAdressenAnzahl,
  neueAdressenOhneHsAnzahl,
  neueAdressenFuerTrasseAnzahl,
  orte,
  aktiveOrteKeys,
  onOrtToggle,
  onAlleOrteToggle,
  startpunktGesetzt,
  startpunktKoords,
  trasseVorhanden,
  hausanschluesseCount,
  trassenLaenge,
  hausanschlussLaenge,
  gesamtLaenge,
  strasseLaenge,
  feldwegLaenge,
  trasseProgress,
  trasseLangsam,
  hausanschluesseProgress,
  editierbarAktiv,
  adressFarbe,
  trasseFarbe,
  hausanschlussfarbe,
  feldwegFarbe,
  canUndo,
  undoCount,
  historyLabels,
  onUndoZu,
  nvtStandorteAnzahl,
  schachtStandorteAnzahl,
  onNvtButtonKlick,
  onNvtNeuZuweisenKlick,
  onAdressFarbeAendern,
  onTrasseFarbeAendern,
  onHausanschlussFarbeAendern,
  onFeldwegFarbeAendern,
  onExcelImport,
  onStartpunktSetzen,
  onStartpunktZuruecksetzen,
  onTrasseGenerieren,
  onHausanschluesseGenerieren,
  onHausanschluesseHinzufuegen,
  onEditierbarToggle,
  onAllesZuruecksetzen,
  onKMLExport,
  onShapefileExport,
  onProjektSpeichern,
  onProjektLaden,
  onTrasseErweitern,
  onUndo,
}: SidebarProps) {
  const excelInputRef = useRef<HTMLInputElement>(null)
  const projektLadenRef = useRef<HTMLInputElement>(null)
  const [kalkulationOffen, setKalkulationOffen] = useState(false)
  const [einstellungenOffen, setEinstellungenOffen] = useState(false)
  const [verlaufOffen, setVerlaufOffen] = useState(false)

  // Einklappbare Sektionen: Default so gewählt, dass der übliche Arbeitsablauf
  // (Daten laden → Schritte → Auswertung prüfen) offen ist, seltener gebrauchte
  // Sektionen (Projekt-Verwaltung, NVT, Export) starten eingeklappt — hält die
  // Sidebar übersichtlich, auch wenn mit wachsendem Funktionsumfang mehr
  // Sektionen dazukommen.
  const [offeneSektionen, setOffeneSektionen] = useState<Set<string>>(
    new Set(['daten', 'schritte', 'auswertung'])
  )
  const toggleSektion = (id: string) => {
    setOffeneSektionen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const hatDaten = adressenCount > 0
  const kannTrasseGenerieren = startpunktGesetzt && hatDaten
  const isGeneratingTrasse = trasseProgress > 0 && trasseProgress < 100
  const isGeneratingHaus = hausanschluesseProgress > 0 && hausanschluesseProgress < 100

  return (
    <aside
      className="w-72 h-screen shrink-0 flex flex-col overflow-y-auto"
      style={{ backgroundColor: '#141414', borderRight: '1px solid #1f2937' }}
    >
      {/* Header */}
      <div className="px-5 py-5 border-b border-gray-800 flex items-start justify-between">
        <div>
          <h1 className="text-white font-semibold text-lg leading-tight">Trassenplaner</h1>
          <span className="text-xs text-gray-500 mt-0.5 block">Glasfaser Streckenplanung</span>
          {projektName.trim() !== '' && projektName !== 'Neues Projekt' && (
            <span className="text-xs mt-1 block" style={{ color: '#93c5fd' }}>📁 {projektName}</span>
          )}
        </div>
        <button
          onClick={() => setEinstellungenOffen(true)}
          title="Einstellungen"
          className="text-lg text-gray-500 hover:text-white transition-colors leading-none mt-0.5"
        >
          ⚙️
        </button>
      </div>

      <div className="flex-1 px-4 py-4 flex flex-col gap-4">

        {/* Sektion: Projekt */}
        <Abschnitt
          titel="Projekt"
          badge={projektName.trim() !== '' && projektName !== 'Neues Projekt' ? projektName : undefined}
          offen={offeneSektionen.has('projekt')}
          onToggle={() => toggleSektion('projekt')}
        >
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={projektName}
              onChange={(e) => onProjektNameAendern(e.target.value)}
              placeholder="Projektname"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ backgroundColor: '#111827', border: '1px solid #374151', color: '#f9fafb' }}
            />
            <button
              onClick={() => projektLadenRef.current?.click()}
              className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
            >
              📂 Projekt laden
            </button>
            <input
              ref={projektLadenRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onProjektLaden(file)
                e.target.value = ''
              }}
            />
            <button
              onClick={onProjektSpeichern}
              disabled={!hatDaten}
              className="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-gray-300 hover:text-white hover:bg-gray-800 enabled:hover:bg-gray-800"
            >
              💾 Projekt speichern
            </button>
            <div className="flex gap-1.5">
              <button
                onClick={onUndo}
                disabled={!canUndo}
                className="flex-1 text-left px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ color: canUndo ? '#fbbf24' : '#6b7280' }}
              >
                ↩ Zurück{canUndo ? ` (${undoCount})` : ''}
              </button>
              {canUndo && (
                <button
                  onClick={() => setVerlaufOffen((v) => !v)}
                  title="Verlauf anzeigen"
                  className="px-3 py-2 rounded-lg text-sm transition-colors"
                  style={{ color: verlaufOffen ? '#fbbf24' : '#6b7280', backgroundColor: verlaufOffen ? '#2a2115' : 'transparent' }}
                >
                  📜
                </button>
              )}
            </div>
            {verlaufOffen && canUndo && (
              <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto rounded-lg" style={{ backgroundColor: '#1a1a1a' }}>
                {historyLabels.map((_, i) => historyLabels.length - 1 - i).map((idx, pos) => (
                  <button
                    key={idx}
                    onClick={() => { onUndoZu(idx); setVerlaufOffen(false) }}
                    className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-gray-800 transition-colors"
                    style={{ color: pos === 0 ? '#fbbf24' : '#9ca3af' }}
                    title="Zu diesem Zeitpunkt zurückspringen"
                  >
                    ↩ Vor: „{historyLabels[idx]}“
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => {
                if (hatDaten && !confirm('Alle Daten löschen und neu anfangen?')) return
                onAllesZuruecksetzen()
              }}
              className="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors text-red-500 hover:text-red-400 hover:bg-red-950/30"
            >
              🗑️ Neu anfangen
            </button>
          </div>
        </Abschnitt>

        <div className="border-t border-gray-800" />

        {/* Sektion: Daten */}
        <Abschnitt
          titel="Daten"
          badge={hatDaten ? `${adressenCount.toLocaleString('de-DE')} Adr.` : undefined}
          offen={offeneSektionen.has('daten')}
          onToggle={() => toggleSektion('daten')}
        >
          <button
            onClick={() => excelInputRef.current?.click()}
            className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
          >
            📊 Excel importieren
          </button>
          <input
            ref={excelInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onExcelImport(file)
              e.target.value = ''
            }}
          />
          {hatDaten && (
            <p className="mt-2 px-3 text-xs text-green-400">
              ✅ {adressenCount.toLocaleString('de-DE')} Adressen geladen
            </p>
          )}

          {/* Orts-Filter */}
          {orte.length > 1 && (
            <div className="mt-3">
              <div className="flex items-center justify-between px-1 mb-1.5">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                  Orte für Trasse ({aktiveOrteKeys.length}/{orte.length})
                </span>
                <div className="flex gap-2.5">
                  <button
                    onClick={() => onAlleOrteToggle(true)}
                    className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    Alle
                  </button>
                  <button
                    onClick={() => onAlleOrteToggle(false)}
                    className="text-[10px] text-gray-500 hover:text-gray-400 transition-colors"
                  >
                    Keine
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-0.5 max-h-44 overflow-y-auto rounded-lg"
                style={{ backgroundColor: '#1a1a1a' }}>
                {orte.map((ort) => (
                  <label
                    key={ort.key}
                    className="flex items-center gap-2.5 px-2.5 py-1.5 cursor-pointer hover:bg-gray-800 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={aktiveOrteKeys.includes(ort.key)}
                      onChange={() => onOrtToggle(ort.key)}
                      className="accent-blue-500 w-3.5 h-3.5 shrink-0"
                    />
                    <span className="text-xs text-gray-300 flex-1 truncate">{ort.name}</span>
                    <span className="text-[10px] text-gray-600 shrink-0">{ort.anzahl}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </Abschnitt>

        <div className="border-t border-gray-800" />

        {/* Sektion: Schritte */}
        <Abschnitt
          titel="Schritte"
          badge={trasseVorhanden ? formatMeter(gesamtLaenge) : undefined}
          offen={offeneSektionen.has('schritte')}
          onToggle={() => toggleSektion('schritte')}
        >
          {/* Hinweis Bearbeitungsmodus */}
          {editierbarAktiv && (
            <div className="mb-3 px-3 py-2 rounded-lg text-xs"
              style={{ backgroundColor: '#1e2a1f', border: '1px solid #16a34a', color: '#86efac' }}>
              ✏️ Bearbeitung aktiv — Generierung gesperrt
            </div>
          )}

          <div className="flex flex-col gap-4">

            {/* Schritt 1 */}
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1.5">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] mr-1.5">1</span>
                Startpunkt setzen
              </p>
              {startpunktGesetzt ? (
                <button
                  onClick={onStartpunktZuruecksetzen}
                  className="w-full px-3 py-2 rounded-lg text-sm font-medium bg-green-900/40 text-green-400 border border-green-800 hover:bg-green-900/60 transition-colors text-left"
                >
                  ✅ Startpunkt gesetzt
                </button>
              ) : (
                <button
                  onClick={onStartpunktSetzen}
                  disabled={!hatDaten}
                  className="w-full px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  📍 Startpunkt setzen
                </button>
              )}
              {startpunktKoords && (
                <p className="mt-1 px-1 text-[11px] text-gray-500">
                  {startpunktKoords.lat.toFixed(5)}, {startpunktKoords.lng.toFixed(5)}
                </p>
              )}
            </div>

            {/* Schritt 2 */}
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1.5">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] mr-1.5">2</span>
                Trasse generieren
              </p>
              {trasseVorhanden && !isGeneratingTrasse ? (
                <div className="flex flex-col gap-2">
                  <div className="px-3 py-2 rounded-lg text-sm bg-green-900/40 text-green-400 border border-green-800">
                    ✅ Trasse: {formatMeter(trassenLaenge)}
                  </div>
                  <button
                    onClick={onTrasseGenerieren}
                    disabled={editierbarAktiv}
                    className="w-full px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-gray-800 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ↺ Neu generieren
                  </button>
                  <button
                    onClick={onEditierbarToggle}
                    className="w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left"
                    style={{
                      backgroundColor: editierbarAktiv ? '#1e3a5f' : '#3f2d0a',
                      color: editierbarAktiv ? '#93c5fd' : '#fbbf24',
                      border: `1px solid ${editierbarAktiv ? '#3b82f6' : '#d97706'}`,
                    }}
                  >
                    ✏️ {editierbarAktiv ? 'Bearbeitung beenden' : 'Trasse bearbeiten'}
                  </button>
                  {onTrasseErweitern && (
                    <button
                      onClick={onTrasseErweitern}
                      disabled={neueAdressenFuerTrasseAnzahl === 0 || editierbarAktiv}
                      className="w-full px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-gray-800 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      🔗 Trasse erweitern
                      {neueAdressenFuerTrasseAnzahl > 0 && !editierbarAktiv && (
                        <span className="ml-1.5 text-[10px] text-blue-400">({neueAdressenFuerTrasseAnzahl} Adr.)</span>
                      )}
                    </button>
                  )}
                </div>
              ) : isGeneratingTrasse ? (
                <div className="flex flex-col gap-1.5">
                  <div className="w-full bg-gray-800 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${trasseProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 text-right">{trasseProgress}%</p>
                  {trasseLangsam && (
                    <p className="text-xs text-amber-500 text-right">
                      Straßendaten werden geladen – bei langsamer Verbindung kann das länger dauern …
                    </p>
                  )}
                </div>
              ) : (
                <button
                  onClick={onTrasseGenerieren}
                  disabled={!kannTrasseGenerieren || editierbarAktiv}
                  className="w-full px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  🔵 Trasse generieren
                </button>
              )}
            </div>

            {/* Schritt 3 */}
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1.5">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] mr-1.5">3</span>
                Hausanschlüsse generieren
              </p>
              {isGeneratingHaus ? (
                <div className="flex flex-col gap-1.5">
                  <div className="w-full bg-gray-800 rounded-full h-2">
                    <div
                      className="bg-red-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${hausanschluesseProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 text-right">{hausanschluesseProgress}%</p>
                </div>
              ) : hausanschluesseCount > 0 ? (
                <div className="flex flex-col gap-2">
                  <div className="px-3 py-2 rounded-lg text-sm bg-green-900/40 text-green-400 border border-green-800">
                    ✅ {hausanschluesseCount} / {gefilterteAdressenAnzahl} Adressen: {formatMeter(hausanschlussLaenge)}
                  </div>
                  <button
                    onClick={onHausanschluesseGenerieren}
                    disabled={!trasseVorhanden || editierbarAktiv}
                    className="w-full px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-gray-800 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ↺ Alle neu generieren
                  </button>
                  {onHausanschluesseHinzufuegen && (
                    <button
                      onClick={onHausanschluesseHinzufuegen}
                      disabled={!trasseVorhanden || neueAdressenOhneHsAnzahl === 0 || editierbarAktiv}
                      className="w-full px-3 py-1.5 rounded-lg text-xs font-medium transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{
                        backgroundColor: neueAdressenOhneHsAnzahl > 0 && !editierbarAktiv ? '#1e3a5f' : '#1f2937',
                        color: neueAdressenOhneHsAnzahl > 0 && !editierbarAktiv ? '#93c5fd' : '#6b7280',
                        border: `1px solid ${neueAdressenOhneHsAnzahl > 0 && !editierbarAktiv ? '#3b82f6' : '#374151'}`,
                      }}
                    >
                      ➕ Für aktive Orte hinzufügen
                      {neueAdressenOhneHsAnzahl > 0 && !editierbarAktiv && (
                        <span className="ml-1.5 text-[10px]">({neueAdressenOhneHsAnzahl} Adr.)</span>
                      )}
                    </button>
                  )}
                  {editierbarAktiv && (
                    <p className="px-1 text-[10px] text-red-400 leading-tight">
                      Klick auf rote Linie löscht den Hausanschluss
                    </p>
                  )}
                </div>
              ) : (
                <button
                  onClick={onHausanschluesseGenerieren}
                  disabled={!trasseVorhanden || editierbarAktiv}
                  className="w-full px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  🔴 Hausanschlüsse generieren
                </button>
              )}
            </div>
          </div>
        </Abschnitt>

        <div className="border-t border-gray-800" />

        {/* Sektion: NVT (dev) */}
        <Abschnitt
          titel="NVT"
          badge={nvtStandorteAnzahl > 0 ? `${nvtStandorteAnzahl}` : undefined}
          offen={offeneSektionen.has('nvt')}
          onToggle={() => toggleSektion('nvt')}
        >
          <div className="flex flex-col gap-1.5">
          <button
            onClick={onNvtButtonKlick}
            disabled={!trasseVorhanden || hausanschluesseCount === 0}
            className="w-full px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            📡 NVT generieren {nvtStandorteAnzahl > 0 && `(${nvtStandorteAnzahl})`}
          </button>
          {nvtStandorteAnzahl > 0 && (
            <button
              onClick={onNvtNeuZuweisenKlick}
              title="Nach manuellem Verschieben eines NVT: alle zugeordneten Hausanschlüsse neu dem jeweils nächsten NVT zuordnen"
              className="w-full px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:brightness-125 active:brightness-150"
              style={{ backgroundColor: '#1e293b', color: '#93c5fd', border: '1px solid #334155' }}
            >
              🔄 Hausanschlüsse neu zuweisen
            </button>
          )}
          </div>
        </Abschnitt>

        <div className="border-t border-gray-800" />

        {/* Sektion: Auswertung */}
        <Abschnitt
          titel="📏 Auswertung"
          badge={trasseVorhanden ? formatMeter(gesamtLaenge) : undefined}
          offen={offeneSektionen.has('auswertung')}
          onToggle={() => toggleSektion('auswertung')}
        >
          <div className="rounded-xl p-3 flex flex-col gap-2" style={{ backgroundColor: '#1a1a1a' }}>
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500">Trasse</span>
              <span className="text-sm font-medium text-white">{formatMeter(trassenLaenge)}</span>
            </div>
            {feldwegLaenge > 0 && (
              <>
                <div className="flex justify-between items-center pl-3">
                  <span className="text-xs text-gray-600">davon Straße</span>
                  <span className="text-xs text-gray-400">{formatMeter(strasseLaenge)}</span>
                </div>
                <div className="flex justify-between items-center pl-3">
                  <span className="text-xs text-gray-600">davon Feldweg</span>
                  <span className="text-xs text-gray-400">{formatMeter(feldwegLaenge)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500">Hausanschlüsse</span>
              <span className="text-sm font-medium text-white">{formatMeter(hausanschlussLaenge)}</span>
            </div>
            <div className="border-t border-gray-700 my-0.5" />
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-400 font-medium">Gesamt</span>
              <span className="text-sm font-semibold text-blue-400">{formatMeter(gesamtLaenge)}</span>
            </div>
          </div>
          <button
            onClick={() => setKalkulationOffen(true)}
            disabled={!trasseVorhanden}
            className="w-full mt-2 px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            💰 Kalkulation
          </button>
        </Abschnitt>

        <div className="border-t border-gray-800" />

        {/* Sektion: Export */}
        <Abschnitt
          titel="Export"
          offen={offeneSektionen.has('export')}
          onToggle={() => toggleSektion('export')}
        >
          <div className="flex flex-col gap-2">
            <button
              onClick={onKMLExport}
              disabled={!trasseVorhanden}
              className="w-full px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              📥 KML exportieren
            </button>
            <button
              onClick={onShapefileExport}
              disabled={!trasseVorhanden}
              className="w-full px-3 py-2 rounded-lg text-sm font-medium border border-[#334155] bg-[#1e293b] text-[#93c5fd] hover:bg-[#2a3b52] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#1e293b]"
            >
              🗺️ Shapefile exportieren
            </button>
          </div>
        </Abschnitt>

      </div>

      {kalkulationOffen && (
        <KalkulationModal
          projektName={projektName}
          strasseLaenge={strasseLaenge}
          feldwegLaenge={feldwegLaenge}
          hausanschluesseCount={hausanschluesseCount}
          nvtAnzahl={nvtStandorteAnzahl}
          schachtAnzahl={schachtStandorteAnzahl}
          onClose={() => setKalkulationOffen(false)}
        />
      )}

      {einstellungenOffen && (
        <EinstellungenModal
          adressFarbe={adressFarbe}
          trasseFarbe={trasseFarbe}
          hausanschlussfarbe={hausanschlussfarbe}
          feldwegFarbe={feldwegFarbe}
          onAdressFarbeAendern={onAdressFarbeAendern}
          onTrasseFarbeAendern={onTrasseFarbeAendern}
          onHausanschlussFarbeAendern={onHausanschlussFarbeAendern}
          onFeldwegFarbeAendern={onFeldwegFarbeAendern}
          onClose={() => setEinstellungenOffen(false)}
        />
      )}
    </aside>
  )
}

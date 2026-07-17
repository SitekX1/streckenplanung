'use client'

import { useRef } from 'react'
import { OrtInfo } from '../lib/types'

interface SidebarProps {
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
  trasseProgress: number
  hausanschluesseProgress: number
  editierbarAktiv: boolean
  adressFarbe: string
  trasseFarbe: string
  hausanschlussfarbe: string
  canUndo: boolean
  undoCount: number
  onAdressFarbeAendern: (farbe: string) => void
  onTrasseFarbeAendern: (farbe: string) => void
  onHausanschlussFarbeAendern: (farbe: string) => void
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

export default function Sidebar({
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
  trasseProgress,
  hausanschluesseProgress,
  editierbarAktiv,
  adressFarbe,
  trasseFarbe,
  hausanschlussfarbe,
  canUndo,
  undoCount,
  onAdressFarbeAendern,
  onTrasseFarbeAendern,
  onHausanschlussFarbeAendern,
  onExcelImport,
  onStartpunktSetzen,
  onStartpunktZuruecksetzen,
  onTrasseGenerieren,
  onHausanschluesseGenerieren,
  onHausanschluesseHinzufuegen,
  onEditierbarToggle,
  onAllesZuruecksetzen,
  onKMLExport,
  onProjektSpeichern,
  onProjektLaden,
  onTrasseErweitern,
  onUndo,
}: SidebarProps) {
  const excelInputRef = useRef<HTMLInputElement>(null)
  const projektLadenRef = useRef<HTMLInputElement>(null)

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
      <div className="px-5 py-5 border-b border-gray-800">
        <h1 className="text-white font-semibold text-lg leading-tight">Trassenplaner</h1>
        <span className="text-xs text-gray-500 mt-0.5 block">Glasfaser Streckenplanung</span>
      </div>

      <div className="flex-1 px-4 py-4 flex flex-col gap-5">

        {/* Sektion: Projekt */}
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Projekt</p>
          <div className="flex flex-col gap-2">
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
            <button
              onClick={onUndo}
              disabled={!canUndo}
              className="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ color: canUndo ? '#fbbf24' : '#6b7280' }}
            >
              ↩ Zurück{canUndo ? ` (${undoCount})` : ''}
            </button>
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
        </div>

        <div className="border-t border-gray-800" />

        {/* Sektion: Daten */}
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Daten</p>
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
        </div>

        <div className="border-t border-gray-800" />

        {/* Sektion: Schritte */}
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Schritte</p>

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
                    className="w-full px-3 py-1.5 rounded-lg text-xs font-medium transition-colors text-left"
                    style={{
                      backgroundColor: editierbarAktiv ? '#1e3a5f' : '#1f2937',
                      color: editierbarAktiv ? '#93c5fd' : '#9ca3af',
                      border: `1px solid ${editierbarAktiv ? '#3b82f6' : '#374151'}`,
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
        </div>

        <div className="border-t border-gray-800" />

        {/* Sektion: Auswertung */}
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">📏 Auswertung</p>
          <div className="rounded-xl p-3 flex flex-col gap-2" style={{ backgroundColor: '#1a1a1a' }}>
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500">Trasse</span>
              <span className="text-sm font-medium text-white">{formatMeter(trassenLaenge)}</span>
            </div>
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
        </div>

        <div className="border-t border-gray-800" />

        {/* Sektion: Export */}
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Export</p>
          <div className="flex flex-col gap-2">
            <button
              onClick={onKMLExport}
              disabled={!trasseVorhanden}
              className="w-full px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              📥 KML exportieren
            </button>
          </div>
        </div>

        <div className="border-t border-gray-800" />

        {/* Sektion: Darstellung */}
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Darstellung</p>
          <div className="flex flex-col gap-2.5">
            {[
              { label: 'Adressen', value: adressFarbe, onChange: onAdressFarbeAendern },
              { label: 'Trasse', value: trasseFarbe, onChange: onTrasseFarbeAendern },
              { label: 'Hausanschlüsse', value: hausanschlussfarbe, onChange: onHausanschlussFarbeAendern },
            ].map(({ label, value, onChange }) => (
              <div key={label} className="flex items-center justify-between px-1">
                <span className="text-xs text-gray-400">{label}</span>
                <input
                  type="color"
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  className="w-8 h-6 rounded cursor-pointer border-0 p-0"
                  style={{ background: 'transparent' }}
                />
              </div>
            ))}
          </div>
        </div>

      </div>
    </aside>
  )
}

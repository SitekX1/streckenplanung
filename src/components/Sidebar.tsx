'use client'

import { useRef } from 'react'

interface SidebarProps {
  adressenCount: number
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
  onAdressFarbeAendern: (farbe: string) => void
  onTrasseFarbeAendern: (farbe: string) => void
  onHausanschlussFarbeAendern: (farbe: string) => void
  onExcelImport: (file: File) => void
  onStartpunktSetzen: () => void
  onStartpunktZuruecksetzen: () => void
  onTrasseGenerieren: () => void
  onHausanschluesseGenerieren: () => void
  onEditierbarToggle: () => void
  onAllesZuruecksetzen: () => void
  onKMLExport: () => void
  onProjektSpeichern: () => void
  onProjektLaden: (file: File) => void
}

function formatMeter(meter: number): string {
  if (meter >= 1000) {
    return `${(meter / 1000).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`
  }
  return `${Math.round(meter).toLocaleString('de-DE')} m`
}

export default function Sidebar({
  adressenCount,
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
  onAdressFarbeAendern,
  onTrasseFarbeAendern,
  onHausanschlussFarbeAendern,
  onExcelImport,
  onStartpunktSetzen,
  onStartpunktZuruecksetzen,
  onTrasseGenerieren,
  onHausanschluesseGenerieren,
  onEditierbarToggle,
  onAllesZuruecksetzen,
  onKMLExport,
  onProjektSpeichern,
  onProjektLaden,
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
        </div>

        <div className="border-t border-gray-800" />

        {/* Sektion: Schritte */}
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Schritte</p>
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
                    className="w-full px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-gray-800 transition-colors text-left"
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
                    ✏️ {editierbarAktiv ? 'Bearbeitung aktiv' : 'Trasse bearbeiten'}
                  </button>
                  {editierbarAktiv && (
                    <p className="px-1 text-[10px] text-blue-400 leading-tight">
                      Punkte ziehen · Klick auf Linie fügt Punkt ein · Doppelklick auf Punkt löscht
                    </p>
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
                  disabled={!kannTrasseGenerieren}
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
                    ✅ {hausanschluesseCount} Hausanschlüsse: {formatMeter(hausanschlussLaenge)}
                  </div>
                  <button
                    onClick={onHausanschluesseGenerieren}
                    disabled={!trasseVorhanden}
                    className="w-full px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-gray-800 transition-colors text-left disabled:opacity-40"
                  >
                    ↺ Neu generieren
                  </button>
                  {editierbarAktiv && (
                    <p className="px-1 text-[10px] text-red-400 leading-tight">
                      Klick auf rote Linie löscht den Hausanschluss
                    </p>
                  )}
                </div>
              ) : (
                <button
                  onClick={onHausanschluesseGenerieren}
                  disabled={!trasseVorhanden}
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
            <button
              onClick={onProjektSpeichern}
              disabled={!hatDaten}
              className="w-full px-3 py-2 rounded-lg text-sm font-medium text-gray-300 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#1f2937' }}
            >
              📄 Als JSON speichern
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

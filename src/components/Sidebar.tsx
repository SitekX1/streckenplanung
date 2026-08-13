'use client'

import { useRef, useState } from 'react'
import { BackboneVerbindung, Hausstich, LatLng, NvtStandort, OrtInfo, SchachtStandort } from '../lib/types'
import KalkulationModal from './KalkulationModal'
import EinstellungenModal from './EinstellungenModal'

interface SidebarProps {
  projektName: string
  onProjektNameAendern: (name: string) => void
  bundesfoerderung: boolean
  onBundesfoerderungAendern: (aktiv: boolean) => void
  // Rohdaten für die segmentgenaue Material-Kalkulation in KalkulationModal —
  // zusätzlich zu den unten schon vorhandenen aggregierten Längen/Anzahlen.
  trassePfade: LatLng[][]
  startpunkt: LatLng | null
  nvtStandorte: NvtStandort[]
  schachtStandorte: SchachtStandort[]
  hausanschluesse: Hausstich[]
  backboneVerbindungen: BackboneVerbindung[]
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

// Wiederverwendete Stil-Bausteine (2026-08-14, komplette Design-Überarbeitung
// nach Sitenna-Referenz + Apple-Formsprache) — EIN Satz Grund-Styles statt
// pro Button einzeln Hex-Werte zu wiederholen, damit spätere Anpassungen an
// einer Stelle greifen. Tiefe entsteht durch Farbschichtung (surface-1 →
// surface-2 → surface-3), nicht durch Rahmen/Schatten — sekundäre Buttons
// sind daher schon im Ruhezustand als eigene Fläche erkennbar, nicht erst
// beim Hover (Alex, 2026-08-13: "man sieht kaum, dass da Buttons sind").
const sekundaerBtn: React.CSSProperties = {
  backgroundColor: 'var(--surface-2)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-secondary)',
}
const primaerBtn: React.CSSProperties = {
  backgroundColor: 'var(--accent-blue)',
  borderRadius: 'var(--radius-md)',
  color: '#fff',
}
const pill: React.CSSProperties = {
  backgroundColor: 'var(--surface-3)',
  color: 'var(--text-secondary)',
  borderRadius: 999,
}

// Einklappbarer Abschnitt: Titel + optionales Badge (nur sichtbar wenn
// eingeklappt, zeigt eine Kurz-Zusammenfassung ohne den Inhalt aufklappen zu
// müssen — z.B. Adressenanzahl oder Trassenlänge). Zustand liegt beim
// Aufrufer (Sidebar selbst), nicht lokal im Abschnitt, damit man den
// Default-Zustand pro Sektion einzeln steuern kann. Offener Zustand bekommt
// einen farbigen Akzent-Balken links (als inset-box-shadow, verschiebt
// dadurch keinen Content) statt nur einer Textfarben-Änderung — dieselbe
// Sprache wie die aktive Navigation im Sitenna-Referenzdesign.
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
        className="sidebar-abschnitt w-full flex items-center justify-between mb-2.5 pl-3 pr-2 py-2 transition-colors group"
        style={{
          borderRadius: 'var(--radius-md)',
          backgroundColor: offen ? 'var(--surface-2)' : undefined,
          boxShadow: offen ? 'inset 3px 0 0 0 var(--accent-blue)' : 'inset 3px 0 0 0 transparent',
        }}
      >
        <span
          className="text-xs font-semibold uppercase tracking-wider transition-colors"
          style={{ color: offen ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
        >
          {titel}
        </span>
        <span className="flex items-center gap-2">
          {!offen && badge && (
            <span className="text-[10px] font-medium normal-case tracking-normal px-2 py-0.5" style={pill}>{badge}</span>
          )}
          <span
            className="flex items-center justify-center w-5 h-5 transition-colors group-hover:brightness-125"
            style={{ backgroundColor: 'var(--surface-3)', borderRadius: 999 }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              className="transition-transform duration-200"
              style={{ color: 'var(--text-secondary)', transform: offen ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >
              <path d="M1.5 3.5L5 7L8.5 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </span>
      </button>
      {offen && <div className="px-0.5">{children}</div>}
    </div>
  )
}

// Nicht-blockierender Einstiegs-Hinweis statt starrem Pflicht-Wizard
// (2026-08-13, Alex: "einer, der das Tool öffnet, weiß gar nicht, was los
// ist" — Recherche zu aktueller SaaS-Onboarding-Praxis empfiehlt kontextuelle,
// überspringbare Hinweise statt linearer Zwangs-Flows). Erscheint nur bei
// leerem Projekt, lässt sich wegklicken und über den Link am Sidebar-Ende
// jederzeit wieder einblenden. Bewusst NUR die zwei Setup-Schritte, die es
// sonst nirgendwo offensichtlich gibt (Bundesförderung-Schalter ist jetzt
// selbst schon immer sichtbar, Adressen-Import steht schon unten unter
// "Daten" — beides hier zusätzlich zu zeigen war doppelt, siehe Alex'
// Korrektur 2026-08-14: "das ist auch Quatsch").
function ErsteSchritteBanner({
  onSchliessen,
  onFirmaKlick,
  onKalkulationKlick,
}: {
  onSchliessen: () => void
  onFirmaKlick: () => void
  onKalkulationKlick: () => void
}) {
  return (
    <div className="p-3 flex flex-col gap-2"
      style={{ backgroundColor: 'var(--accent-blue-dim)', borderRadius: 'var(--radius-lg)', border: '1px solid #2c4a70' }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold" style={{ color: '#93c5fd' }}>👋 Erste Schritte</span>
        <button onClick={onSchliessen} className="text-xs transition-colors hover:brightness-125" style={{ color: 'var(--text-secondary)' }}>✕</button>
      </div>
      <button onClick={onFirmaKlick}
        className="w-full text-left px-3 py-2 text-xs font-medium transition-colors hover:brightness-110"
        style={{ backgroundColor: 'var(--accent-blue)', color: '#fff', borderRadius: 'var(--radius-md)' }}>
        1️⃣ 🏢 Firma & Material einrichten
      </button>
      <button onClick={onKalkulationKlick}
        className="w-full text-left px-3 py-2 text-xs font-medium transition-colors hover:brightness-110"
        style={{ backgroundColor: 'var(--accent-blue)', color: '#fff', borderRadius: 'var(--radius-md)' }}>
        2️⃣ 💰 Kalkulation (Preise hinterlegen)
      </button>
    </div>
  )
}

export default function Sidebar({
  projektName,
  onProjektNameAendern,
  bundesfoerderung,
  onBundesfoerderungAendern,
  trassePfade,
  startpunkt,
  nvtStandorte,
  schachtStandorte,
  hausanschluesse,
  backboneVerbindungen,
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
  const [ersteSchritteVerborgen, setErsteSchritteVerborgen] = useState(false)

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
      style={{ backgroundColor: 'var(--surface-1)', borderRight: '1px solid var(--border-subtle)' }}
    >
      {/* Header */}
      <div className="px-5 py-5 flex items-start justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div>
          <h1 className="font-semibold text-lg leading-tight" style={{ color: 'var(--text-primary)' }}>Trassenplaner</h1>
          <span className="text-xs mt-0.5 block" style={{ color: 'var(--text-tertiary)' }}>Glasfaser Streckenplanung</span>
          {projektName.trim() !== '' && projektName !== 'Neues Projekt' && (
            <span className="text-xs mt-1 block" style={{ color: '#93c5fd' }}>📁 {projektName}</span>
          )}
        </div>
        <button
          onClick={() => setEinstellungenOffen(true)}
          title="Einstellungen"
          className="w-8 h-8 flex items-center justify-center text-base transition-colors hover:brightness-125"
          style={{ backgroundColor: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' }}
        >
          ⚙️
        </button>
      </div>

      {/* Bundesförderung: bewusst IMMER sichtbar direkt unterm Header statt in
          einem einklappbaren Abschnitt versteckt (Alex, 2026-08-13: "keiner
          weiß, wo der Haken ist") — bestimmt Export-Schema UND
          Materialkatalog-Profil fürs ganze Projekt, die wichtigste
          Weichenstellung, bevor überhaupt losgelegt wird. */}
      <label
        className="mx-4 mt-3 flex items-center justify-between px-3.5 py-2.5 text-sm cursor-pointer transition-colors"
        style={{
          backgroundColor: bundesfoerderung ? 'var(--accent-amber-dim)' : 'var(--surface-2)',
          border: `1px solid ${bundesfoerderung ? 'var(--accent-amber)' : 'var(--border-subtle)'}`,
          borderRadius: 'var(--radius-lg)',
        }}
        title="Steuert GIS-NB-Export-Schema (statt freiem Layout) und welches Materialkatalog-Profil angewendet wird"
      >
        <span className="flex flex-col">
          <span style={{ color: bundesfoerderung ? 'var(--accent-amber-bright)' : 'var(--text-primary)' }} className="font-medium">🏛️ Bundesförderung</span>
          <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Bestimmt Material & Export-Format</span>
        </span>
        <input
          type="checkbox"
          checked={bundesfoerderung}
          onChange={(e) => onBundesfoerderungAendern(e.target.checked)}
          className="accent-amber-500 w-4 h-4 shrink-0"
        />
      </label>

      <div className="flex-1 px-4 py-4 flex flex-col gap-4">

        {!hatDaten && !ersteSchritteVerborgen && (
          <ErsteSchritteBanner
            onSchliessen={() => setErsteSchritteVerborgen(true)}
            onFirmaKlick={() => setEinstellungenOffen(true)}
            onKalkulationKlick={() => setKalkulationOffen(true)}
          />
        )}

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
              className="w-full px-3.5 py-2.5 text-sm outline-none"
              style={{ backgroundColor: 'var(--surface-3)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)' }}
            />
            <button
              onClick={() => projektLadenRef.current?.click()}
              className="w-full text-left px-3.5 py-2.5 text-sm transition-colors hover:brightness-125"
              style={sekundaerBtn}
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
              className="w-full text-left px-3.5 py-2.5 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-125"
              style={sekundaerBtn}
            >
              💾 Projekt speichern
            </button>
            <div className="flex gap-1.5">
              <button
                onClick={onUndo}
                disabled={!canUndo}
                className="flex-1 text-left px-3.5 py-2.5 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ ...sekundaerBtn, color: canUndo ? 'var(--accent-amber-bright)' : 'var(--text-tertiary)' }}
              >
                ↩ Zurück{canUndo ? ` (${undoCount})` : ''}
              </button>
              {canUndo && (
                <button
                  onClick={() => setVerlaufOffen((v) => !v)}
                  title="Verlauf anzeigen"
                  className="px-3.5 py-2.5 text-sm transition-colors"
                  style={{
                    borderRadius: 'var(--radius-md)',
                    color: verlaufOffen ? 'var(--accent-amber-bright)' : 'var(--text-secondary)',
                    backgroundColor: verlaufOffen ? 'var(--accent-amber-dim)' : 'var(--surface-2)',
                    border: `1px solid ${verlaufOffen ? 'var(--accent-amber)' : 'var(--border-subtle)'}`,
                  }}
                >
                  📜
                </button>
              )}
            </div>
            {verlaufOffen && canUndo && (
              <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto" style={{ backgroundColor: 'var(--surface-2)', borderRadius: 'var(--radius-md)' }}>
                {historyLabels.map((_, i) => historyLabels.length - 1 - i).map((idx, pos) => (
                  <button
                    key={idx}
                    onClick={() => { onUndoZu(idx); setVerlaufOffen(false) }}
                    className="w-full text-left px-3 py-2 text-xs transition-colors hover:brightness-125"
                    style={{ color: pos === 0 ? 'var(--accent-amber-bright)' : 'var(--text-secondary)' }}
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
              className="w-full text-left px-3.5 py-2.5 text-sm transition-colors hover:brightness-125"
              style={{ ...sekundaerBtn, color: 'var(--accent-red)' }}
            >
              🗑️ Neu anfangen
            </button>
          </div>
        </Abschnitt>

        {/* Sektion: Daten */}
        <Abschnitt
          titel="Daten"
          badge={hatDaten ? `${adressenCount.toLocaleString('de-DE')} Adr.` : undefined}
          offen={offeneSektionen.has('daten')}
          onToggle={() => toggleSektion('daten')}
        >
          <button
            onClick={() => excelInputRef.current?.click()}
            className="w-full text-left px-3.5 py-2.5 text-sm font-medium transition-colors hover:brightness-110"
            style={primaerBtn}
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
            <p className="mt-2 px-3 text-xs" style={{ color: 'var(--accent-green)' }}>
              ✅ {adressenCount.toLocaleString('de-DE')} Adressen geladen
            </p>
          )}

          {/* Orts-Filter */}
          {orte.length > 1 && (
            <div className="mt-3">
              <div className="flex items-center justify-between px-1 mb-1.5">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                  Orte für Trasse ({aktiveOrteKeys.length}/{orte.length})
                </span>
                <div className="flex gap-2.5">
                  <button
                    onClick={() => onAlleOrteToggle(true)}
                    className="text-[10px] transition-colors hover:brightness-125"
                    style={{ color: '#93c5fd' }}
                  >
                    Alle
                  </button>
                  <button
                    onClick={() => onAlleOrteToggle(false)}
                    className="text-[10px] transition-colors hover:brightness-125"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Keine
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-0.5 max-h-44 overflow-y-auto"
                style={{ backgroundColor: 'var(--surface-2)', borderRadius: 'var(--radius-md)' }}>
                {orte.map((ort) => (
                  <label
                    key={ort.key}
                    className="flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors hover:brightness-125"
                  >
                    <input
                      type="checkbox"
                      checked={aktiveOrteKeys.includes(ort.key)}
                      onChange={() => onOrtToggle(ort.key)}
                      className="accent-blue-500 w-3.5 h-3.5 shrink-0"
                    />
                    <span className="text-xs flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>{ort.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 shrink-0" style={pill}>{ort.anzahl}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </Abschnitt>

        {/* Sektion: Schritte */}
        <Abschnitt
          titel="Schritte"
          badge={trasseVorhanden ? formatMeter(gesamtLaenge) : undefined}
          offen={offeneSektionen.has('schritte')}
          onToggle={() => toggleSektion('schritte')}
        >
          {/* Hinweis Bearbeitungsmodus */}
          {editierbarAktiv && (
            <div className="mb-3 px-3.5 py-2.5 text-xs"
              style={{ backgroundColor: 'var(--accent-green-dim)', borderRadius: 'var(--radius-md)', color: '#86efac' }}>
              ✏️ Bearbeitung aktiv — Generierung gesperrt
            </div>
          )}

          <div className="flex flex-col gap-4">

            {/* Schritt 1 */}
            <div>
              <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[10px] mr-1.5" style={{ backgroundColor: 'var(--accent-blue)' }}>1</span>
                Startpunkt setzen
              </p>
              {startpunktGesetzt ? (
                <button
                  onClick={onStartpunktZuruecksetzen}
                  className="w-full px-3.5 py-2.5 text-sm font-medium transition-colors text-left hover:brightness-110"
                  style={{ backgroundColor: 'var(--accent-green-dim)', color: '#86efac', borderRadius: 'var(--radius-md)' }}
                >
                  ✅ Startpunkt gesetzt
                </button>
              ) : (
                <button
                  onClick={onStartpunktSetzen}
                  disabled={!hatDaten}
                  className="w-full px-3.5 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
                  style={primaerBtn}
                >
                  📍 Startpunkt setzen
                </button>
              )}
              {startpunktKoords && (
                <p className="mt-1 px-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  {startpunktKoords.lat.toFixed(5)}, {startpunktKoords.lng.toFixed(5)}
                </p>
              )}
            </div>

            {/* Schritt 2 */}
            <div>
              <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[10px] mr-1.5" style={{ backgroundColor: 'var(--accent-blue)' }}>2</span>
                Trasse generieren
              </p>
              {trasseVorhanden && !isGeneratingTrasse ? (
                <div className="flex flex-col gap-2">
                  <div className="px-3.5 py-2.5 text-sm" style={{ backgroundColor: 'var(--accent-green-dim)', color: '#86efac', borderRadius: 'var(--radius-md)' }}>
                    ✅ Trasse: {formatMeter(trassenLaenge)}
                  </div>
                  <button
                    onClick={onTrasseGenerieren}
                    disabled={editierbarAktiv}
                    className="w-full px-3.5 py-2 text-xs transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-125"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    ↺ Neu generieren
                  </button>
                  <button
                    onClick={onEditierbarToggle}
                    className="w-full px-3.5 py-2.5 text-sm font-medium transition-colors text-left hover:brightness-110"
                    style={{
                      backgroundColor: editierbarAktiv ? 'var(--accent-blue-dim)' : 'var(--accent-amber-dim)',
                      color: editierbarAktiv ? '#93c5fd' : 'var(--accent-amber-bright)',
                      border: `1px solid ${editierbarAktiv ? 'var(--accent-blue)' : 'var(--accent-amber)'}`,
                      borderRadius: 'var(--radius-md)',
                    }}
                  >
                    ✏️ {editierbarAktiv ? 'Bearbeitung beenden' : 'Trasse bearbeiten'}
                  </button>
                  {onTrasseErweitern && (
                    <button
                      onClick={onTrasseErweitern}
                      disabled={neueAdressenFuerTrasseAnzahl === 0 || editierbarAktiv}
                      className="w-full px-3.5 py-2 text-xs transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-125"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      🔗 Trasse erweitern
                      {neueAdressenFuerTrasseAnzahl > 0 && !editierbarAktiv && (
                        <span className="ml-1.5 text-[10px]" style={{ color: '#93c5fd' }}>({neueAdressenFuerTrasseAnzahl} Adr.)</span>
                      )}
                    </button>
                  )}
                </div>
              ) : isGeneratingTrasse ? (
                <div className="flex flex-col gap-1.5">
                  <div className="w-full h-2 rounded-full" style={{ backgroundColor: 'var(--surface-3)' }}>
                    <div
                      className="h-2 rounded-full transition-all duration-300"
                      style={{ width: `${trasseProgress}%`, backgroundColor: 'var(--accent-blue)' }}
                    />
                  </div>
                  <p className="text-xs text-right" style={{ color: 'var(--text-tertiary)' }}>{trasseProgress}%</p>
                  {trasseLangsam && (
                    <p className="text-xs text-right" style={{ color: 'var(--accent-amber-bright)' }}>
                      Straßendaten werden geladen – bei langsamer Verbindung kann das länger dauern …
                    </p>
                  )}
                </div>
              ) : (
                <button
                  onClick={onTrasseGenerieren}
                  disabled={!kannTrasseGenerieren || editierbarAktiv}
                  className="w-full px-3.5 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
                  style={primaerBtn}
                >
                  🔵 Trasse generieren
                </button>
              )}
            </div>

            {/* Schritt 3 */}
            <div>
              <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[10px] mr-1.5" style={{ backgroundColor: 'var(--accent-blue)' }}>3</span>
                Hausanschlüsse generieren
              </p>
              {isGeneratingHaus ? (
                <div className="flex flex-col gap-1.5">
                  <div className="w-full h-2 rounded-full" style={{ backgroundColor: 'var(--surface-3)' }}>
                    <div
                      className="h-2 rounded-full transition-all duration-300"
                      style={{ width: `${hausanschluesseProgress}%`, backgroundColor: 'var(--accent-red)' }}
                    />
                  </div>
                  <p className="text-xs text-right" style={{ color: 'var(--text-tertiary)' }}>{hausanschluesseProgress}%</p>
                </div>
              ) : hausanschluesseCount > 0 ? (
                <div className="flex flex-col gap-2">
                  <div className="px-3.5 py-2.5 text-sm" style={{ backgroundColor: 'var(--accent-green-dim)', color: '#86efac', borderRadius: 'var(--radius-md)' }}>
                    ✅ {hausanschluesseCount} / {gefilterteAdressenAnzahl} Adressen: {formatMeter(hausanschlussLaenge)}
                  </div>
                  <button
                    onClick={onHausanschluesseGenerieren}
                    disabled={!trasseVorhanden || editierbarAktiv}
                    className="w-full px-3.5 py-2 text-xs transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-125"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    ↺ Alle neu generieren
                  </button>
                  {onHausanschluesseHinzufuegen && (
                    <button
                      onClick={onHausanschluesseHinzufuegen}
                      disabled={!trasseVorhanden || neueAdressenOhneHsAnzahl === 0 || editierbarAktiv}
                      className="w-full px-3.5 py-2 text-xs font-medium transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
                      style={{
                        backgroundColor: neueAdressenOhneHsAnzahl > 0 && !editierbarAktiv ? 'var(--accent-blue-dim)' : 'var(--surface-2)',
                        color: neueAdressenOhneHsAnzahl > 0 && !editierbarAktiv ? '#93c5fd' : 'var(--text-tertiary)',
                        border: `1px solid ${neueAdressenOhneHsAnzahl > 0 && !editierbarAktiv ? 'var(--accent-blue)' : 'var(--border-subtle)'}`,
                        borderRadius: 'var(--radius-md)',
                      }}
                    >
                      ➕ Für aktive Orte hinzufügen
                      {neueAdressenOhneHsAnzahl > 0 && !editierbarAktiv && (
                        <span className="ml-1.5 text-[10px]">({neueAdressenOhneHsAnzahl} Adr.)</span>
                      )}
                    </button>
                  )}
                  {editierbarAktiv && (
                    <p className="px-1 text-[10px] leading-tight" style={{ color: 'var(--accent-red)' }}>
                      Klick auf rote Linie löscht den Hausanschluss
                    </p>
                  )}
                </div>
              ) : (
                <button
                  onClick={onHausanschluesseGenerieren}
                  disabled={!trasseVorhanden || editierbarAktiv}
                  className="w-full px-3.5 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
                  style={primaerBtn}
                >
                  🔴 Hausanschlüsse generieren
                </button>
              )}
            </div>
          </div>
        </Abschnitt>

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
              className="w-full px-3.5 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
              style={primaerBtn}
            >
              📡 NVT generieren {nvtStandorteAnzahl > 0 && `(${nvtStandorteAnzahl})`}
            </button>
            {nvtStandorteAnzahl > 0 && (
              <button
                onClick={onNvtNeuZuweisenKlick}
                title="Nach manuellem Verschieben eines NVT: alle zugeordneten Hausanschlüsse neu dem jeweils nächsten NVT zuordnen"
                className="w-full px-3.5 py-2 text-xs font-medium transition-colors hover:brightness-125"
                style={{ backgroundColor: 'var(--accent-blue-dim)', color: '#93c5fd', borderRadius: 'var(--radius-md)' }}
              >
                🔄 Hausanschlüsse neu zuweisen
              </button>
            )}
          </div>
        </Abschnitt>

        {/* Sektion: Auswertung */}
        <Abschnitt
          titel="Auswertung"
          badge={trasseVorhanden ? formatMeter(gesamtLaenge) : undefined}
          offen={offeneSektionen.has('auswertung')}
          onToggle={() => toggleSektion('auswertung')}
        >
          <div className="p-3.5 flex flex-col gap-2" style={{ backgroundColor: 'var(--surface-2)', borderRadius: 'var(--radius-lg)' }}>
            <div className="flex justify-between items-center">
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Trasse</span>
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{formatMeter(trassenLaenge)}</span>
            </div>
            {feldwegLaenge > 0 && (
              <>
                <div className="flex justify-between items-center pl-3">
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>davon Straße</span>
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{formatMeter(strasseLaenge)}</span>
                </div>
                <div className="flex justify-between items-center pl-3">
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>davon Feldweg</span>
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{formatMeter(feldwegLaenge)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between items-center">
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Hausanschlüsse</span>
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{formatMeter(hausanschlussLaenge)}</span>
            </div>
            <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '2px 0' }} />
            <div className="flex justify-between items-center">
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Gesamt</span>
              <span className="text-sm font-semibold" style={{ color: '#93c5fd' }}>{formatMeter(gesamtLaenge)}</span>
            </div>
          </div>
          <button
            onClick={() => setKalkulationOffen(true)}
            disabled={!trasseVorhanden}
            className="w-full mt-2 px-3.5 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
            style={primaerBtn}
          >
            💰 Kalkulation
          </button>
        </Abschnitt>

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
              className="w-full px-3.5 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
              style={primaerBtn}
            >
              📥 KML exportieren
            </button>
            <button
              onClick={onShapefileExport}
              disabled={!trasseVorhanden}
              className="w-full px-3.5 py-2.5 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
              style={{ backgroundColor: 'var(--accent-blue-dim)', color: '#93c5fd', border: '1px solid #2c4a70', borderRadius: 'var(--radius-md)' }}
            >
              🗺️ Shapefile exportieren
            </button>
          </div>
        </Abschnitt>

        {ersteSchritteVerborgen && (
          <button
            onClick={() => setErsteSchritteVerborgen(false)}
            className="w-full text-center px-3 py-2 text-xs transition-colors hover:brightness-125"
            style={{ color: 'var(--text-tertiary)' }}
          >
            👋 Erste Schritte wieder anzeigen
          </button>
        )}

      </div>

      {kalkulationOffen && (
        <KalkulationModal
          projektName={projektName}
          strasseLaenge={strasseLaenge}
          feldwegLaenge={feldwegLaenge}
          hausanschluesseCount={hausanschluesseCount}
          hausanschlussLaenge={hausanschlussLaenge}
          nvtAnzahl={nvtStandorteAnzahl}
          schachtAnzahl={schachtStandorteAnzahl}
          bundesfoerderung={bundesfoerderung}
          trassePfade={trassePfade}
          startpunkt={startpunkt}
          nvtStandorte={nvtStandorte}
          schachtStandorte={schachtStandorte}
          hausanschluesse={hausanschluesse}
          backboneVerbindungen={backboneVerbindungen}
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

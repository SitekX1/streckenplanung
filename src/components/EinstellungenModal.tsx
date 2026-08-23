'use client'

import { useRef, useState } from 'react'
import { Firmendaten, ladeFirmendaten, speichereFirmendaten } from '../lib/firmendaten'
import {
  LR_ART_KATALOG,
  MaterialEintrag,
  MaterialProfilName,
  ladeMaterialkatalog,
  speichereMaterialkatalog,
} from '../lib/materialkatalog'

interface EinstellungenModalProps {
  adressFarbe: string
  trasseFarbe: string
  hausanschlussfarbe: string
  feldwegFarbe: string
  onAdressFarbeAendern: (farbe: string) => void
  onTrasseFarbeAendern: (farbe: string) => void
  onHausanschlussFarbeAendern: (farbe: string) => void
  onFeldwegFarbeAendern: (farbe: string) => void
  onClose: () => void
}

// Wiederverwendeter Feld-Look (2026-08-14, Design-Überarbeitung) — surface-3
// auf surface-2-Karten, damit jede Verschachtelungsebene optisch eine eigene
// Fläche ist statt nur durch Rahmen abgegrenzt zu sein.
const feldStyle: React.CSSProperties = {
  backgroundColor: 'var(--surface-3)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
}

// Verkleinert ein hochgeladenes Logo auf eine PDF-taugliche Pixelgröße, bevor
// es als Data-URL abgelegt wird — ein rohes Handyfoto würde sonst sowohl das
// localStorage-Kontingent als auch die spätere PDF unnötig aufblähen.
function verkleinereLogo(file: File): Promise<{ dataUrl: string; breite: number; hoehe: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const MAX_PX = 300
        const skala = Math.min(1, MAX_PX / Math.max(img.width, img.height))
        const breite = Math.max(1, Math.round(img.width * skala))
        const hoehe = Math.max(1, Math.round(img.height * skala))
        const canvas = document.createElement('canvas')
        canvas.width = breite
        canvas.height = hoehe
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('Canvas nicht verfügbar')); return }
        ctx.drawImage(img, 0, 0, breite, hoehe)
        resolve({ dataUrl: canvas.toDataURL('image/png'), breite, hoehe })
      }
      img.onerror = () => reject(new Error('Bild konnte nicht geladen werden'))
      img.src = reader.result as string
    }
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'))
    reader.readAsDataURL(file)
  })
}

export default function EinstellungenModal({
  adressFarbe, trasseFarbe, hausanschlussfarbe, feldwegFarbe,
  onAdressFarbeAendern, onTrasseFarbeAendern, onHausanschlussFarbeAendern, onFeldwegFarbeAendern,
  onClose,
}: EinstellungenModalProps) {
  // Geräteweit persistent per localStorage, unabhängig vom einzelnen Projekt
  // (gleiches Muster wie die Kalkulations-Preise in KalkulationModal.tsx) —
  // anders als bei den Preisen aber bewusst NICHT live bei jedem Tastendruck
  // gespeichert, sondern erst per Klick auf "Speichern": Firmendaten tippt
  // man einmal ein und ist fertig, ein Live-Save bei jedem Zeichen bringt
  // hier nur unnötige localStorage-Schreibzugriffe ohne Mehrwert.
  const [firmendaten, setFirmendaten] = useState<Firmendaten>(ladeFirmendaten)
  const [gespeichert, setGespeichert] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

  const handleFirmendatenSpeichern = () => {
    speichereFirmendaten(firmendaten)
    setGespeichert(true)
    setTimeout(() => setGespeichert(false), 1800)
  }

  // Rohr-Farbschema (2026-08-21) — anders als Firmenname/Adresse bewusst
  // SOFORT gespeichert (wie der Materialkatalog unten), da eine Auswahl aus
  // festen Optionen kein Tipp-Risiko hat und ein "vergessen zu speichern"
  // hier nur verwirren würde.
  const handleRohrFarbschemaAendern = (schema: Firmendaten['rohrFarbschema']) => {
    setFirmendaten((f) => {
      const naechster = { ...f, rohrFarbschema: schema }
      speichereFirmendaten(naechster)
      return naechster
    })
  }

  // Materialkatalog: zwei Profile (Firmenstandard / Bundesförderung), je mit
  // Trasse- und Hausanschluss-Material — geräteweit gespeichert, live bei
  // jeder Änderung (wie die Kalkulations-Preise), kein separater Speichern-
  // Klick nötig, da hier nur Zahlen/Auswahl ohne Tipp-Risiko wie bei Freitext.
  const [katalog, setKatalog] = useState(ladeMaterialkatalog)
  const aktualisiereMaterial = (
    profil: MaterialProfilName,
    ebene: 'trasse' | 'hausanschluss',
    aenderung: Partial<MaterialEintrag>
  ) => {
    setKatalog((k) => {
      const naechster = {
        ...k,
        [profil]: { ...k[profil], [ebene]: { ...k[profil][ebene], ...aenderung } },
      }
      speichereMaterialkatalog(naechster)
      return naechster
    })
  }

  const aendereAuslastungsSchwelle = (schwelle: number) => {
    setKatalog((k) => {
      const naechster = { ...k, auslastungsSchwelle: Math.min(0.99, Math.max(0.01, schwelle)) }
      speichereMaterialkatalog(naechster)
      return naechster
    })
  }

  const materialZeile = (profil: MaterialProfilName, ebene: 'trasse' | 'hausanschluss', label: string, hinweis?: string) => {
    const eintrag = katalog[profil][ebene]
    return (
      <div className="flex flex-col gap-2 p-3.5" style={{ backgroundColor: 'var(--surface-2)', borderRadius: 'var(--radius-lg)' }}>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
          {hinweis && <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{hinweis}</span>}
        </div>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={eintrag.bezeichnungFirma}
            onChange={(e) => aktualisiereMaterial(profil, ebene, { bezeichnungFirma: e.target.value })}
            placeholder="Bezeichnung (z.B. 24x7)"
            className="flex-1 min-w-0 px-3 py-2 text-sm outline-none"
            style={feldStyle}
          />
          <input
            type="color"
            title="Kartenfarbe für dieses Material"
            value={eintrag.farbe}
            onChange={(e) => aktualisiereMaterial(profil, ebene, { farbe: e.target.value })}
            className="w-9 h-8 cursor-pointer border-0 p-0 shrink-0"
            style={{ background: 'transparent', borderRadius: 'var(--radius-sm)' }}
          />
        </div>
        <select
          value={eintrag.lrArt}
          onChange={(e) => aktualisiereMaterial(profil, ebene, { lrArt: Number(e.target.value) })}
          className="px-3 py-2 text-xs outline-none"
          style={feldStyle}
        >
          {LR_ART_KATALOG.map((e) => (
            <option key={e.code} value={e.code}>{e.code} — {e.label}</option>
          ))}
        </select>
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Röhrchen/Verb.</span>
            <input type="number" min={0} value={eintrag.lrAnzahl}
              onChange={(e) => aktualisiereMaterial(profil, ebene, { lrAnzahl: Number(e.target.value) || 0 })}
              className="px-2 py-1.5 text-xs outline-none" style={feldStyle} />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Verbände</span>
            <input type="number" min={0} value={eintrag.anzahl}
              onChange={(e) => aktualisiereMaterial(profil, ebene, { anzahl: Number(e.target.value) || 0 })}
              className="px-2 py-1.5 text-xs outline-none" style={feldStyle} />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Reserve</span>
            <input type="number" min={0} value={eintrag.reserve}
              onChange={(e) => aktualisiereMaterial(profil, ebene, { reserve: Number(e.target.value) || 0 })}
              className="px-2 py-1.5 text-xs outline-none" style={feldStyle} />
          </label>
        </div>
      </div>
    )
  }

  const aktualisiereStufe = (profil: MaterialProfilName, index: number, aenderung: Partial<MaterialEintrag>) => {
    setKatalog((k) => {
      const naechsteStufen = k[profil].kundenanschlussStufen.map((s, i) => (i === index ? { ...s, ...aenderung } : s))
      const naechster = { ...k, [profil]: { ...k[profil], kundenanschlussStufen: naechsteStufen } }
      speichereMaterialkatalog(naechster)
      return naechster
    })
  }

  const stufenZeilen = (profil: MaterialProfilName) => (
    <div className="flex flex-col gap-2 p-3.5" style={{ backgroundColor: 'var(--surface-2)', borderRadius: 'var(--radius-lg)' }}>
      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Kundenanschluss-Sammelverband (Doppelbelegung auf Trasse-Segmenten)</span>
      <span className="text-[10px] -mt-1" style={{ color: 'var(--text-tertiary)' }}>Kleinste ausreichende Stufe wird je Segment automatisch gewählt, je nach Anzahl versorgter Hausanschlüsse dahinter.</span>
      {katalog[profil].kundenanschlussStufen.map((stufe, i) => (
        <div key={i} className="grid grid-cols-4 gap-2 items-end">
          <input type="text" value={stufe.bezeichnungFirma}
            onChange={(e) => aktualisiereStufe(profil, i, { bezeichnungFirma: e.target.value })}
            placeholder="z.B. 7x7"
            className="px-2 py-1.5 text-xs outline-none" style={feldStyle} />
          <input type="color" title="Kartenfarbe für diese Stufe" value={stufe.farbe}
            onChange={(e) => aktualisiereStufe(profil, i, { farbe: e.target.value })}
            className="w-full h-8 cursor-pointer border-0 p-0" style={{ background: 'transparent', borderRadius: 'var(--radius-sm)' }} />
          <select value={stufe.lrArt}
            onChange={(e) => aktualisiereStufe(profil, i, { lrArt: Number(e.target.value) })}
            className="px-1.5 py-1.5 text-[10px] outline-none" style={feldStyle}>
            {LR_ART_KATALOG.map((e) => (<option key={e.code} value={e.code}>{e.code}</option>))}
          </select>
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px]" style={{ color: 'var(--text-tertiary)' }}>Röhrchen</span>
            <input type="number" min={0} value={stufe.lrAnzahl}
              onChange={(e) => aktualisiereStufe(profil, i, { lrAnzahl: Number(e.target.value) || 0 })}
              className="px-2 py-1.5 text-xs outline-none" style={feldStyle} />
          </label>
        </div>
      ))}
    </div>
  )

  const handleLogoDatei = async (file: File) => {
    try {
      const { dataUrl, breite, hoehe } = await verkleinereLogo(file)
      setFirmendaten((f) => ({ ...f, logoDataUrl: dataUrl, logoBreite: breite, logoHoehe: hoehe }))
    } catch {
      // Datei ungültig/kein Bild — einfach ignorieren, Logo bleibt unverändert
    }
  }

  return (
    <div className="fixed inset-0 z-1000 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(6,7,10,0.7)' }}>
      <div className="shadow-2xl flex flex-col overflow-y-auto"
        style={{ backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xl)', width: 560, maxWidth: '100%', maxHeight: '88vh' }}>
        <div className="flex items-center justify-between px-5 py-4 sticky top-0 z-10"
          style={{ borderBottom: '1px solid var(--border-subtle)', backgroundColor: 'var(--surface-1)' }}>
          <span className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>⚙️ Einstellungen</span>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-sm transition-colors hover:brightness-125"
            style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)' }}>
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-5 p-5">

        <div>
          <p className="text-xs font-medium uppercase tracking-wider mb-2.5" style={{ color: 'var(--text-tertiary)' }}>Firma (für Kalkulations-PDF)</p>
          <div className="flex flex-col gap-2.5 p-3.5" style={{ backgroundColor: 'var(--surface-2)', borderRadius: 'var(--radius-lg)' }}>
            <div className="flex items-center gap-3">
              {firmendaten.logoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={firmendaten.logoDataUrl} alt="Firmenlogo"
                  style={{ maxWidth: 64, maxHeight: 40, backgroundColor: '#fff', padding: 2, borderRadius: 'var(--radius-sm)' }} />
              ) : (
                <div className="flex items-center justify-center text-xs"
                  style={{ width: 64, height: 40, border: '1px dashed var(--border-strong)', color: 'var(--text-tertiary)', borderRadius: 'var(--radius-sm)' }}>
                  kein Logo
                </div>
              )}
              <div className="flex flex-col gap-1">
                <button onClick={() => logoInputRef.current?.click()}
                  className="text-xs px-3 py-1.5 transition-colors hover:brightness-110"
                  style={{ backgroundColor: 'var(--surface-3)', color: '#93c5fd', borderRadius: 'var(--radius-sm)' }}>
                  📷 Logo wählen
                </button>
                {firmendaten.logoDataUrl && (
                  <button onClick={() => setFirmendaten((f) => ({ ...f, logoDataUrl: null, logoBreite: 0, logoHoehe: 0 }))}
                    className="text-xs px-3 py-1.5" style={{ color: 'var(--accent-red)' }}>
                    Logo entfernen
                  </button>
                )}
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleLogoDatei(file)
                  e.target.value = ''
                }}
              />
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Firmenname</span>
              <input
                type="text"
                value={firmendaten.firmenname}
                onChange={(e) => setFirmendaten((f) => ({ ...f, firmenname: e.target.value }))}
                className="px-3 py-2 text-sm outline-none"
                style={feldStyle}
              />
            </label>

            <div>
              <span className="text-xs block mb-1.5" style={{ color: 'var(--text-secondary)' }}>Adresse</span>
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={firmendaten.strasse}
                    onChange={(e) => setFirmendaten((f) => ({ ...f, strasse: e.target.value }))}
                    placeholder="Straße"
                    className="flex-2 min-w-0 px-3 py-2 text-sm outline-none"
                    style={feldStyle}
                  />
                  <input
                    type="text"
                    value={firmendaten.hausnummer}
                    onChange={(e) => setFirmendaten((f) => ({ ...f, hausnummer: e.target.value }))}
                    placeholder="Nr."
                    className="flex-1 min-w-0 px-3 py-2 text-sm outline-none"
                    style={feldStyle}
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={firmendaten.plz}
                    onChange={(e) => setFirmendaten((f) => ({ ...f, plz: e.target.value }))}
                    placeholder="PLZ"
                    className="flex-1 min-w-0 px-3 py-2 text-sm outline-none"
                    style={feldStyle}
                  />
                  <input
                    type="text"
                    value={firmendaten.ort}
                    onChange={(e) => setFirmendaten((f) => ({ ...f, ort: e.target.value }))}
                    placeholder="Ort"
                    className="flex-2 min-w-0 px-3 py-2 text-sm outline-none"
                    style={feldStyle}
                  />
                </div>
              </div>
            </div>

            <button onClick={handleFirmendatenSpeichern}
              className="w-full px-3 py-2.5 text-sm font-medium transition-colors hover:brightness-110"
              style={{ backgroundColor: gespeichert ? 'var(--accent-green-dim)' : 'var(--surface-3)', color: gespeichert ? '#86efac' : '#93c5fd', borderRadius: 'var(--radius-md)' }}>
              {gespeichert ? '✓ Gespeichert' : '💾 Speichern'}
            </button>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Wird auf jedem Kalkulations-PDF-Export mit ausgegeben, geräteweit gespeichert.</p>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wider mb-2.5" style={{ color: 'var(--text-tertiary)' }}>Darstellung</p>
          <div className="flex flex-col gap-2">
            {[
              { label: 'Adressen', value: adressFarbe, onChange: onAdressFarbeAendern },
              { label: 'Trasse (Fallback, ohne Materialzuordnung)', value: trasseFarbe, onChange: onTrasseFarbeAendern },
              { label: 'Feldweg-Anteil', value: feldwegFarbe, onChange: onFeldwegFarbeAendern },
              { label: 'Hausanschlüsse', value: hausanschlussfarbe, onChange: onHausanschlussFarbeAendern },
            ].map(({ label, value, onChange }) => (
              <div key={label} className="flex items-center justify-between px-3.5 py-2.5"
                style={{ backgroundColor: 'var(--surface-2)', borderRadius: 'var(--radius-md)' }}>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
                <input
                  type="color"
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  className="w-8 h-6 cursor-pointer border-0 p-0"
                  style={{ background: 'transparent', borderRadius: 'var(--radius-sm)' }}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between px-3.5 py-2.5 mt-2"
            style={{ backgroundColor: 'var(--surface-2)', borderRadius: 'var(--radius-md)' }}>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Rohr-Farbschema (Trassenknoten-Panel)</span>
              <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Welche Rohr-Farben beim Anklicken eines Trassenknotens angezeigt werden.</span>
            </div>
            <select
              value={firmendaten.rohrFarbschema}
              onChange={(e) => handleRohrFarbschemaAendern(e.target.value as Firmendaten['rohrFarbschema'])}
              className="px-2.5 py-1.5 text-xs outline-none shrink-0"
              style={feldStyle}
            >
              <option value="gabocom">gabocom</option>
              <option value="din">DIN EN 60794</option>
            </select>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wider mb-2.5" style={{ color: 'var(--text-tertiary)' }}>Materialkatalog</p>
          <p className="text-xs mb-2.5" style={{ color: 'var(--text-tertiary)' }}>
            Wird pro Projekt automatisch angewendet — je nachdem, ob oben &bdquo;Bundesförderung&ldquo; aktiviert ist. Die Farbe je Material-Typ (rechts neben der Bezeichnung) bestimmt auch die Einfärbung der Trasse auf der Karte. Preise pro Meter werden separat in der 💰 Kalkulation hinterlegt, nicht hier.
          </p>
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 mb-1"
            style={{ backgroundColor: 'var(--surface-2)', borderRadius: 'var(--radius-lg)' }}>
            <span className="text-xs flex-1" style={{ color: 'var(--text-secondary)' }}>Reserve-Schwelle (Stufensprung ab Auslastung)</span>
            <input
              type="number"
              min={1}
              max={99}
              value={Math.round(katalog.auslastungsSchwelle * 100)}
              onChange={(e) => aendereAuslastungsSchwelle((Number(e.target.value) || 0) / 100)}
              className="w-16 px-2 py-1.5 text-sm outline-none text-right"
              style={feldStyle}
            />
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>%</span>
          </div>
          <p className="text-[10px] mb-3" style={{ color: 'var(--text-tertiary)' }}>
            Wäre die knapp passende Verband-Stufe über dieser Auslastung, wird automatisch die nächstgrößere gewählt (z.B. 5 Kunden bei Schwelle 70 % → 12x7 statt 7x7, da 5/7 ≈ 71 %). Physisch gedeckelt durch die jeweilige NVT-Kapazität — die wird nie überschritten.
          </p>
          <div className="flex flex-col gap-3">
            <div>
              <span className="text-[11px] font-medium block mb-1.5" style={{ color: '#93c5fd' }}>Firmenstandard</span>
              <div className="flex flex-col gap-2">
                {materialZeile('firma', 'trasse', 'Trasse (NVT-zu-NVT-Backbone)', 'Läuft nur zwischen zwei Verteilern (NVT/Schacht), siehe Kartenlegende')}
                {materialZeile('firma', 'hausanschluss', 'Hausanschluss (Hauszuführung)', 'Einzelne Leitung von NVT/Schacht zu EINEM Haus — nicht der Sammelverband unten')}
                {stufenZeilen('firma')}
              </div>
            </div>
            <div>
              <span className="text-[11px] font-medium block mb-1.5" style={{ color: 'var(--accent-amber-bright)' }}>Bundesförderung</span>
              <div className="flex flex-col gap-2">
                {materialZeile('foerderung', 'trasse', 'Trasse (NVT-zu-NVT-Backbone)', 'Läuft nur zwischen zwei Verteilern (NVT/Schacht), siehe Kartenlegende')}
                {materialZeile('foerderung', 'hausanschluss', 'Hausanschluss (Hauszuführung)', 'Einzelne Leitung von NVT/Schacht zu EINEM Haus — nicht der Sammelverband unten')}
                {stufenZeilen('foerderung')}
              </div>
            </div>
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>Änderungen werden sofort geräteweit gespeichert.</p>
        </div>
        </div>
      </div>
    </div>
  )
}

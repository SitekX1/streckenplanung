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
      <div className="flex flex-col gap-2 rounded-xl p-3" style={{ backgroundColor: '#111827', border: '1px solid #262b36' }}>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-gray-400">{label}</span>
          {hinweis && <span className="text-[10px] text-gray-600">{hinweis}</span>}
        </div>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={eintrag.bezeichnungFirma}
            onChange={(e) => aktualisiereMaterial(profil, ebene, { bezeichnungFirma: e.target.value })}
            placeholder="Bezeichnung (z.B. 24x7)"
            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-sm outline-none"
            style={{ backgroundColor: '#0d1117', border: '1px solid #374151', color: '#f9fafb' }}
          />
          <input
            type="color"
            title="Kartenfarbe für dieses Material"
            value={eintrag.farbe}
            onChange={(e) => aktualisiereMaterial(profil, ebene, { farbe: e.target.value })}
            className="w-9 h-8 rounded-lg cursor-pointer border-0 p-0 shrink-0"
            style={{ background: 'transparent' }}
          />
        </div>
        <select
          value={eintrag.lrArt}
          onChange={(e) => aktualisiereMaterial(profil, ebene, { lrArt: Number(e.target.value) })}
          className="px-2.5 py-1.5 rounded-lg text-xs outline-none"
          style={{ backgroundColor: '#0d1117', border: '1px solid #374151', color: '#f9fafb' }}
        >
          {LR_ART_KATALOG.map((e) => (
            <option key={e.code} value={e.code}>{e.code} — {e.label}</option>
          ))}
        </select>
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-500">Röhrchen/Verb.</span>
            <input type="number" min={0} value={eintrag.lrAnzahl}
              onChange={(e) => aktualisiereMaterial(profil, ebene, { lrAnzahl: Number(e.target.value) || 0 })}
              className="px-2 py-1.5 rounded-lg text-xs outline-none" style={{ backgroundColor: '#0d1117', border: '1px solid #374151', color: '#f9fafb' }} />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-500">Verbände</span>
            <input type="number" min={0} value={eintrag.anzahl}
              onChange={(e) => aktualisiereMaterial(profil, ebene, { anzahl: Number(e.target.value) || 0 })}
              className="px-2 py-1.5 rounded-lg text-xs outline-none" style={{ backgroundColor: '#0d1117', border: '1px solid #374151', color: '#f9fafb' }} />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-gray-500">Reserve</span>
            <input type="number" min={0} value={eintrag.reserve}
              onChange={(e) => aktualisiereMaterial(profil, ebene, { reserve: Number(e.target.value) || 0 })}
              className="px-2 py-1.5 rounded-lg text-xs outline-none" style={{ backgroundColor: '#0d1117', border: '1px solid #374151', color: '#f9fafb' }} />
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
    <div className="flex flex-col gap-2 rounded-xl p-3" style={{ backgroundColor: '#111827', border: '1px solid #262b36' }}>
      <span className="text-xs text-gray-400">Kundenanschluss-Sammelverband (Doppelbelegung auf Trasse-Segmenten)</span>
      <span className="text-[10px] text-gray-600 -mt-1">Kleinste ausreichende Stufe wird je Segment automatisch gewählt, je nach Anzahl versorgter Hausanschlüsse dahinter.</span>
      {katalog[profil].kundenanschlussStufen.map((stufe, i) => (
        <div key={i} className="grid grid-cols-4 gap-2 items-end">
          <input type="text" value={stufe.bezeichnungFirma}
            onChange={(e) => aktualisiereStufe(profil, i, { bezeichnungFirma: e.target.value })}
            placeholder="z.B. 7x7"
            className="px-2 py-1.5 rounded-lg text-xs outline-none" style={{ backgroundColor: '#0d1117', border: '1px solid #374151', color: '#f9fafb' }} />
          <input type="color" title="Kartenfarbe für diese Stufe" value={stufe.farbe}
            onChange={(e) => aktualisiereStufe(profil, i, { farbe: e.target.value })}
            className="w-full h-8 rounded-lg cursor-pointer border-0 p-0" style={{ background: 'transparent' }} />
          <select value={stufe.lrArt}
            onChange={(e) => aktualisiereStufe(profil, i, { lrArt: Number(e.target.value) })}
            className="px-1.5 py-1.5 rounded-lg text-[10px] outline-none" style={{ backgroundColor: '#0d1117', border: '1px solid #374151', color: '#f9fafb' }}>
            {LR_ART_KATALOG.map((e) => (<option key={e.code} value={e.code}>{e.code}</option>))}
          </select>
          <label className="flex flex-col gap-0.5">
            <span className="text-[9px] text-gray-500">Röhrchen</span>
            <input type="number" min={0} value={stufe.lrAnzahl}
              onChange={(e) => aktualisiereStufe(profil, i, { lrAnzahl: Number(e.target.value) || 0 })}
              className="px-2 py-1.5 rounded-lg text-xs outline-none" style={{ backgroundColor: '#0d1117', border: '1px solid #374151', color: '#f9fafb' }} />
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
    <div className="fixed inset-0 z-1000 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-2xl shadow-2xl flex flex-col overflow-y-auto"
        style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2f3a', width: 560, maxWidth: '100%', maxHeight: '88vh' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 z-10" style={{ borderColor: '#262b36', backgroundColor: '#1a1a1a' }}>
          <span className="text-base font-semibold text-white">⚙️ Einstellungen</span>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-sm hover:bg-gray-800 transition-colors"
            style={{ color: '#9ca3af' }}>
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-4 p-5">

        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Firma (für Kalkulations-PDF)</p>
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-3">
              {firmendaten.logoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={firmendaten.logoDataUrl} alt="Firmenlogo" className="rounded-lg"
                  style={{ maxWidth: 64, maxHeight: 40, backgroundColor: '#fff', padding: 2 }} />
              ) : (
                <div className="flex items-center justify-center rounded-lg text-xs text-gray-600"
                  style={{ width: 64, height: 40, border: '1px dashed #374151' }}>
                  kein Logo
                </div>
              )}
              <div className="flex flex-col gap-1">
                <button onClick={() => logoInputRef.current?.click()}
                  className="text-xs px-2.5 py-1.5 rounded-lg transition-colors hover:brightness-110"
                  style={{ backgroundColor: '#262b36', color: '#93c5fd' }}>
                  📷 Logo wählen
                </button>
                {firmendaten.logoDataUrl && (
                  <button onClick={() => setFirmendaten((f) => ({ ...f, logoDataUrl: null, logoBreite: 0, logoHoehe: 0 }))}
                    className="text-xs px-2.5 py-1.5 rounded-lg" style={{ color: '#f87171' }}>
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
              <span className="text-xs text-gray-400">Firmenname</span>
              <input
                type="text"
                value={firmendaten.firmenname}
                onChange={(e) => setFirmendaten((f) => ({ ...f, firmenname: e.target.value }))}
                className="px-2.5 py-1.5 rounded-lg text-sm outline-none"
                style={{ backgroundColor: '#111827', border: '1px solid #374151', color: '#f9fafb' }}
              />
            </label>

            <div>
              <span className="text-xs text-gray-400 block mb-1.5">Adresse</span>
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={firmendaten.strasse}
                    onChange={(e) => setFirmendaten((f) => ({ ...f, strasse: e.target.value }))}
                    placeholder="Straße"
                    className="flex-2 min-w-0 px-2.5 py-1.5 rounded-lg text-sm outline-none"
                    style={{ backgroundColor: '#111827', border: '1px solid #374151', color: '#f9fafb' }}
                  />
                  <input
                    type="text"
                    value={firmendaten.hausnummer}
                    onChange={(e) => setFirmendaten((f) => ({ ...f, hausnummer: e.target.value }))}
                    placeholder="Nr."
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded text-sm outline-none"
                    style={{ backgroundColor: '#111827', border: '1px solid #374151', color: '#f9fafb' }}
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={firmendaten.plz}
                    onChange={(e) => setFirmendaten((f) => ({ ...f, plz: e.target.value }))}
                    placeholder="PLZ"
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded text-sm outline-none"
                    style={{ backgroundColor: '#111827', border: '1px solid #374151', color: '#f9fafb' }}
                  />
                  <input
                    type="text"
                    value={firmendaten.ort}
                    onChange={(e) => setFirmendaten((f) => ({ ...f, ort: e.target.value }))}
                    placeholder="Ort"
                    className="flex-2 min-w-0 px-2.5 py-1.5 rounded-lg text-sm outline-none"
                    style={{ backgroundColor: '#111827', border: '1px solid #374151', color: '#f9fafb' }}
                  />
                </div>
              </div>
            </div>

            <button onClick={handleFirmendatenSpeichern}
              className="w-full px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              style={{ backgroundColor: gespeichert ? '#166534' : '#262b36', color: gespeichert ? '#86efac' : '#93c5fd' }}>
              {gespeichert ? '✓ Gespeichert' : '💾 Speichern'}
            </button>
            <p className="text-xs text-gray-600">Wird auf jedem Kalkulations-PDF-Export mit ausgegeben, geräteweit gespeichert.</p>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Darstellung</p>
          <div className="flex flex-col gap-2.5">
            {[
              { label: 'Adressen', value: adressFarbe, onChange: onAdressFarbeAendern },
              { label: 'Trasse (Fallback, ohne Materialzuordnung)', value: trasseFarbe, onChange: onTrasseFarbeAendern },
              { label: 'Feldweg-Anteil', value: feldwegFarbe, onChange: onFeldwegFarbeAendern },
              { label: 'Hausanschlüsse', value: hausanschlussfarbe, onChange: onHausanschlussFarbeAendern },
            ].map(({ label, value, onChange }) => (
              <div key={label} className="flex items-center justify-between px-3 py-2 rounded-xl"
                style={{ backgroundColor: '#111827', border: '1px solid #262b36' }}>
                <span className="text-xs text-gray-400">{label}</span>
                <input
                  type="color"
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  className="w-8 h-6 rounded-lg cursor-pointer border-0 p-0"
                  style={{ background: 'transparent' }}
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Materialkatalog</p>
          <p className="text-xs text-gray-600 mb-2.5">
            Wird pro Projekt automatisch angewendet — je nachdem, ob oben &bdquo;Bundesförderung&ldquo; aktiviert ist. Die Farbe je Material-Typ (rechts neben der Bezeichnung) bestimmt auch die Einfärbung der Trasse auf der Karte. Preise pro Meter werden separat in der 💰 Kalkulation hinterlegt, nicht hier.
          </p>
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl mb-1"
            style={{ backgroundColor: '#111827', border: '1px solid #262b36' }}>
            <span className="text-xs text-gray-300 flex-1">Reserve-Schwelle (Stufensprung ab Auslastung)</span>
            <input
              type="number"
              min={1}
              max={99}
              value={Math.round(katalog.auslastungsSchwelle * 100)}
              onChange={(e) => aendereAuslastungsSchwelle((Number(e.target.value) || 0) / 100)}
              className="w-16 px-2 py-1.5 rounded-lg text-sm outline-none text-right"
              style={{ backgroundColor: '#0d1117', border: '1px solid #374151', color: '#f9fafb' }}
            />
            <span className="text-xs text-gray-500">%</span>
          </div>
          <p className="text-[10px] text-gray-600 mb-3">
            Wäre die knapp passende Verband-Stufe über dieser Auslastung, wird automatisch die nächstgrößere gewählt (z.B. 5 Kunden bei Schwelle 70 % → 12x7 statt 7x7, da 5/7 ≈ 71 %). Physisch gedeckelt durch die jeweilige NVT-Kapazität — die wird nie überschritten.
          </p>
          <div className="flex flex-col gap-3">
            <div>
              <span className="text-[11px] text-blue-400 font-medium block mb-1.5">Firmenstandard</span>
              <div className="flex flex-col gap-2">
                {materialZeile('firma', 'trasse', 'Trasse (NVT-zu-NVT-Backbone)', 'Läuft nur zwischen zwei Verteilern (NVT/Schacht), siehe Kartenlegende')}
                {materialZeile('firma', 'hausanschluss', 'Hausanschluss (Hauszuführung)', 'Einzelne Leitung von NVT/Schacht zu EINEM Haus — nicht der Sammelverband unten')}
                {stufenZeilen('firma')}
              </div>
            </div>
            <div>
              <span className="text-[11px] text-amber-400 font-medium block mb-1.5">Bundesförderung</span>
              <div className="flex flex-col gap-2">
                {materialZeile('foerderung', 'trasse', 'Trasse (NVT-zu-NVT-Backbone)', 'Läuft nur zwischen zwei Verteilern (NVT/Schacht), siehe Kartenlegende')}
                {materialZeile('foerderung', 'hausanschluss', 'Hausanschluss (Hauszuführung)', 'Einzelne Leitung von NVT/Schacht zu EINEM Haus — nicht der Sammelverband unten')}
                {stufenZeilen('foerderung')}
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-600 mt-2">Änderungen werden sofort geräteweit gespeichert.</p>
        </div>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { exportKalkulationPdf } from '../lib/kalkulationPdfExport'
import { ladeFirmendaten } from '../lib/firmendaten'
import { MaterialEintrag, ladeMaterialkatalog, speichereMaterialkatalog, lrArtLabel, profilName } from '../lib/materialkatalog'
import { ermittleMaterialProSegment } from '../lib/faserdimensionierung'
import { segmentLaenge } from '../lib/shapefileExport'
import { BackboneVerbindung, Hausstich, LatLng, NvtStandort, SchachtStandort } from '../lib/types'

interface KalkulationModalProps {
  projektName: string
  strasseLaenge: number
  feldwegLaenge: number
  hausanschluesseCount: number
  hausanschlussLaenge: number
  nvtAnzahl: number
  schachtAnzahl: number
  bundesfoerderung: boolean
  // Rohdaten für die segmentgenaue Material-Kostenaufteilung (siehe
  // trasseMaterialLaengen unten) — zusätzlich zu den bereits aggregierten
  // Längen/Stückzahlen oben, die für die restlichen Positionen reichen.
  trassePfade: LatLng[][]
  startpunkt: LatLng | null
  nvtStandorte: NvtStandort[]
  schachtStandorte: SchachtStandort[]
  hausanschluesse: Hausstich[]
  backboneVerbindungen: BackboneVerbindung[]
  onClose: () => void
}

interface KalkulationPreise {
  strassePreisProMeter: number
  feldwegPreisProMeter: number
  hausanschlussPreis: number
  sonderpositionAnzahl: number
  sonderpositionPreis: number
  nvtPreis: number
  schachtPreis: number
}

const STORAGE_KEY = 'streckenplanung-kalkulation-preise'

const DEFAULT_PREISE: KalkulationPreise = {
  strassePreisProMeter: 45,
  feldwegPreisProMeter: 25,
  hausanschlussPreis: 800,
  sonderpositionAnzahl: 0,
  sonderpositionPreis: 250,
  nvtPreis: 3500,
  schachtPreis: 800,
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

// siehe EinstellungenModal.tsx für dieselbe Feld-Stil-Konvention
const feldStyle: React.CSSProperties = {
  backgroundColor: 'var(--surface-3)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
}

export default function KalkulationModal({
  projektName, strasseLaenge, feldwegLaenge, hausanschluesseCount, hausanschlussLaenge, nvtAnzahl, schachtAnzahl, bundesfoerderung,
  trassePfade, startpunkt, nvtStandorte, schachtStandorte, hausanschluesse, backboneVerbindungen, onClose,
}: KalkulationModalProps) {
  // Material-Leerrohrpreise (nicht Verlegekosten — die stehen separat oben)
  // kommen aus dem geräteweiten Materialkatalog, je nach Projekt-Schalter
  // "Bundesförderung" das passende Profil. Typ/Größe des Materials wird
  // weiterhin unter Einstellungen festgelegt, der €/m-Preis aber HIER
  // editiert (2026-08-14, Alex: "Kosten pro laufenden Meter nicht in die
  // Material-Einstellung reinschmeißen, sondern wie bei der Kalkulation") —
  // eigener Katalog-State statt des einmaligen aktivesMaterialProfil()-Calls,
  // damit Preisänderungen hier sofort zurückgeschrieben werden können.
  const [katalog, setKatalog] = useState(ladeMaterialkatalog)
  const materialProfil = katalog[profilName(bundesfoerderung)]
  const aktualisiereMaterialPreis = (ebene: 'trasse' | 'hausanschluss', preisProMeter: number) => {
    setKatalog((k) => {
      const profil = profilName(bundesfoerderung)
      const naechster = { ...k, [profil]: { ...k[profil], [ebene]: { ...k[profil][ebene], preisProMeter } } }
      speichereMaterialkatalog(naechster)
      return naechster
    })
  }
  const aktualisiereStufePreis = (index: number, preisProMeter: number) => {
    setKatalog((k) => {
      const profil = profilName(bundesfoerderung)
      const naechsteStufen = k[profil].kundenanschlussStufen.map((s, i) => (i === index ? { ...s, preisProMeter } : s))
      const naechster = { ...k, [profil]: { ...k[profil], kundenanschlussStufen: naechsteStufen } }
      speichereMaterialkatalog(naechster)
      return naechster
    })
  }
  // Preise sind geräteweit gespeichert (nicht Teil des Projekts) — die
  // Sätze eurer Firma ändern sich kaum von Projekt zu Projekt, im
  // Gegensatz zu den Streckenlängen/Stückzahlen selbst. Lazy-Initializer
  // statt Effect, da localStorage nur einmalig beim ersten Rendern gelesen
  // werden muss (kein externer Trigger, auf den reagiert werden müsste).
  const [preise, setPreise] = useState<KalkulationPreise>(ladePreise)
  // Rohtext je Feld getrennt von preise (Zahlen) gehalten — bei Number-State
  // sprang das Feld beim Löschen der letzten Ziffer sofort auf 0 zurück,
  // ein leeres Feld zum Neueintippen war nicht möglich (selbes Muster wie
  // reserveText/distanzText in NVTModal.tsx).
  const [preisTexte, setPreisTexte] = useState<Record<keyof KalkulationPreise, string>>(() => {
    const initial = ladePreise()
    return Object.fromEntries(
      (Object.keys(initial) as (keyof KalkulationPreise)[]).map((k) => [k, String(initial[k])])
    ) as Record<keyof KalkulationPreise, string>
  })

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preise)) } catch { /* ignorieren */ }
  }, [preise])

  const feld = (label: string, key: keyof KalkulationPreise, einheit: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <div className="flex items-center overflow-hidden" style={feldStyle}>
        <input
          type="number"
          min={0}
          value={preisTexte[key]}
          onChange={(e) => {
            const text = e.target.value
            setPreisTexte((p) => ({ ...p, [key]: text }))
            setPreise((p) => ({ ...p, [key]: Number(text) || 0 }))
          }}
          className="flex-1 min-w-0 px-3 py-2 text-sm outline-none"
          style={{ backgroundColor: 'transparent', color: 'var(--text-primary)' }}
        />
        <span className="px-3 text-xs shrink-0" style={{ color: 'var(--text-tertiary)', borderLeft: '1px solid var(--border-subtle)' }}>{einheit}</span>
      </div>
    </label>
  )

  const materialPreisFeld = (label: string, wert: number, onChange: (v: number) => void) => (
    <label className="flex flex-col gap-1">
      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <div className="flex items-center overflow-hidden" style={feldStyle}>
        <input
          type="number"
          min={0}
          value={wert}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="flex-1 min-w-0 px-3 py-2 text-sm outline-none"
          style={{ backgroundColor: 'transparent', color: 'var(--text-primary)' }}
        />
        <span className="px-3 text-xs shrink-0" style={{ color: 'var(--text-tertiary)', borderLeft: '1px solid var(--border-subtle)' }}>€/m</span>
      </div>
    </label>
  )

  // Segmentgenaue Material-Kostenaufteilung (2026-08-14, Alex: "wenn NVTs
  // generiert sind und der Verbände/Backbone plant, ist diese
  // Längenpreiskalkulation noch nicht integriert") — dieselbe Zuordnung wie
  // auf der Karte/im GIS-NB-Export (ermittleMaterialProSegment), NICHT
  // einfach die gesamte Trassenlänge mit dem Backbone-Preis multipliziert
  // (das war der vorherige, zu grobe Stand: der Backbone-Preis lief bisher
  // über 100 % der Länge statt nur über die echten Backbone-Segmente, und
  // die Sammelverband-Stufen fehlten komplett). Bei Doppelbelegung (Backbone
  // + Sammelverband auf demselben Segment) zählt die Segmentlänge für BEIDE
  // Materialien, da physisch zwei separate Leitungen verlegt werden.
  const trasseMaterialLaengen = useMemo(() => {
    const materialProSegment = ermittleMaterialProSegment(
      trassePfade, startpunkt, nvtStandorte, schachtStandorte, hausanschluesse, materialProfil, backboneVerbindungen
    )
    const map = new Map<string, { material: MaterialEintrag; laenge: number }>()
    trassePfade.forEach((pfad, i) => {
      const m = materialProSegment[i]
      if (!m || pfad.length < 2) return
      const laenge = segmentLaenge(pfad)
      const addiere = (mat: MaterialEintrag) => {
        const key = mat.bezeichnungFirma || String(mat.lrArt)
        const eintrag = map.get(key)
        if (eintrag) eintrag.laenge += laenge
        else map.set(key, { material: mat, laenge })
      }
      addiere(m.haupt)
      if (m.zusatz) addiere(m.zusatz)
    })
    return [...map.values()]
  }, [trassePfade, startpunkt, nvtStandorte, schachtStandorte, hausanschluesse, materialProfil, backboneVerbindungen])

  const strasseSumme = strasseLaenge * preise.strassePreisProMeter
  const feldwegSumme = feldwegLaenge * preise.feldwegPreisProMeter
  const hausanschlussSumme = hausanschluesseCount * preise.hausanschlussPreis
  const sonderpositionSumme = preise.sonderpositionAnzahl * preise.sonderpositionPreis
  const nvtSumme = nvtAnzahl * preise.nvtPreis
  const schachtSumme = schachtAnzahl * preise.schachtPreis
  const trasseMaterialSumme = trasseMaterialLaengen.reduce((sum, { material, laenge }) => sum + laenge * material.preisProMeter, 0)
  const materialHausanschlussSumme = hausanschlussLaenge * materialProfil.hausanschluss.preisProMeter
  const gesamt =
    strasseSumme + feldwegSumme + hausanschlussSumme + sonderpositionSumme + nvtSumme + schachtSumme +
    trasseMaterialSumme + materialHausanschlussSumme

  const handlePdfExport = () => {
    const zeilen = [
      { label: 'Befestigte Oberfläche', menge: `${Math.round(strasseLaenge)} m`, einzelpreis: `${preise.strassePreisProMeter} €/m`, summe: strasseSumme },
      { label: 'Unbefestigte Oberfläche', menge: `${Math.round(feldwegLaenge)} m`, einzelpreis: `${preise.feldwegPreisProMeter} €/m`, summe: feldwegSumme },
      { label: 'Hausanschlüsse', menge: `${hausanschluesseCount} Stk.`, einzelpreis: `${preise.hausanschlussPreis} €/Stk.`, summe: hausanschlussSumme },
      ...(preise.sonderpositionAnzahl > 0
        ? [{ label: 'Sonderposition', menge: `${preise.sonderpositionAnzahl} Stk.`, einzelpreis: `${preise.sonderpositionPreis} €/Stk.`, summe: sonderpositionSumme }]
        : []),
      ...(nvtAnzahl > 0
        ? [{ label: 'NVT', menge: `${nvtAnzahl} Stk.`, einzelpreis: `${preise.nvtPreis} €/Stk.`, summe: nvtSumme }]
        : []),
      ...(schachtAnzahl > 0
        ? [{ label: 'Schacht', menge: `${schachtAnzahl} Stk.`, einzelpreis: `${preise.schachtPreis} €/Stk.`, summe: schachtSumme }]
        : []),
      ...trasseMaterialLaengen
        .filter(({ material }) => material.preisProMeter > 0)
        .map(({ material, laenge }) => ({
          label: `Material ${material.bezeichnungFirma}`,
          menge: `${Math.round(laenge)} m`,
          einzelpreis: `${material.preisProMeter} €/m`,
          summe: laenge * material.preisProMeter,
        })),
      ...(materialProfil.hausanschluss.preisProMeter > 0
        ? [{ label: `Material Hausanschluss (${materialProfil.hausanschluss.bezeichnungFirma})`, menge: `${Math.round(hausanschlussLaenge)} m`, einzelpreis: `${materialProfil.hausanschluss.preisProMeter} €/m`, summe: materialHausanschlussSumme }]
        : []),
    ]
    const firmendaten = ladeFirmendaten()
    const adresse = [
      [firmendaten.strasse, firmendaten.hausnummer].filter(Boolean).join(' '),
      [firmendaten.plz, firmendaten.ort].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join('\n')
    exportKalkulationPdf({
      projektName,
      zeilen,
      gesamt,
      logoDataUrl: firmendaten.logoDataUrl,
      logoBreite: firmendaten.logoBreite,
      logoHoehe: firmendaten.logoHoehe,
      firmenname: firmendaten.firmenname,
      adresse,
    })
  }

  const zeile = (label: string, menge: string, summe: number) => (
    <div className="flex justify-between items-center text-xs py-1.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{label} <span style={{ color: 'var(--text-tertiary)', opacity: 0.7 }}>({menge})</span></span>
      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{formatEuro(summe)}</span>
    </div>
  )

  const sektion = (titel: string, inhalt: React.ReactNode) => (
    <div className="p-3.5" style={{ backgroundColor: 'var(--surface-2)', borderRadius: 'var(--radius-lg)' }}>
      <p className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>{titel}</p>
      <div className="grid grid-cols-2 gap-3">{inhalt}</div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-1000 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(6,7,10,0.7)' }}>
      <div className="shadow-2xl flex flex-col"
        style={{ backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xl)', width: 460, maxHeight: '90vh' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <span className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>💰 Kalkulation</span>
          <button onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-sm transition-colors hover:brightness-125"
            style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)' }}>
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-3 p-5 overflow-y-auto">
          {sektion('🛣️ Trasse', (
            <>
              {feld('Befestigte Oberfläche', 'strassePreisProMeter', '€/m')}
              {feld('Unbefestigte Oberfläche', 'feldwegPreisProMeter', '€/m')}
            </>
          ))}

          {sektion('🏠 Hausanschluss', (
            <>
              {feld('Preis / Stück', 'hausanschlussPreis', '€')}
              <div />
              {feld('Sonderposition · Anzahl', 'sonderpositionAnzahl', 'Stk.')}
              {feld('Sonderposition · Preis', 'sonderpositionPreis', '€/Stk.')}
              <p className="col-span-2 text-xs -mt-1.5" style={{ color: 'var(--text-tertiary)' }}>
                Frei nutzbarer Zusatzposten, z.B. für Erschwerniszuschläge, Bohrungen oder sonstige Sonderfälle, die nicht über die Standardsätze abgedeckt sind.
              </p>
            </>
          ))}

          {sektion('📡 NVT', (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Anzahl (aus Projekt)</span>
                <div className="flex items-center px-3 py-2 text-sm" style={{ ...feldStyle, color: 'var(--text-secondary)' }}>
                  {nvtAnzahl} Stk.
                </div>
              </div>
              {feld('Preis / Stück', 'nvtPreis', '€')}
            </>
          ))}

          {sektion('🕳️ Schacht', (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Anzahl (aus Projekt)</span>
                <div className="flex items-center px-3 py-2 text-sm" style={{ ...feldStyle, color: 'var(--text-secondary)' }}>
                  {schachtAnzahl} Stk.
                </div>
              </div>
              {feld('Preis / Stück', 'schachtPreis', '€')}
            </>
          ))}

          {sektion(`🧵 Material${bundesfoerderung ? ' (Bundesförderung)' : ''}`, (
            <>
              {materialPreisFeld(
                `Trasse (${materialProfil.trasse.bezeichnungFirma} · ${lrArtLabel(materialProfil.trasse.lrArt)})`,
                materialProfil.trasse.preisProMeter,
                (v) => aktualisiereMaterialPreis('trasse', v)
              )}
              {materialPreisFeld(
                `Hausanschluss (${materialProfil.hausanschluss.bezeichnungFirma} · ${lrArtLabel(materialProfil.hausanschluss.lrArt)})`,
                materialProfil.hausanschluss.preisProMeter,
                (v) => aktualisiereMaterialPreis('hausanschluss', v)
              )}
              {materialProfil.kundenanschlussStufen.map((stufe, i) => (
                <div key={i}>
                  {materialPreisFeld(`Sammelverband ${stufe.bezeichnungFirma}`, stufe.preisProMeter, (v) => aktualisiereStufePreis(i, v))}
                </div>
              ))}
              <p className="col-span-2 text-xs -mt-1" style={{ color: 'var(--text-tertiary)' }}>
                Material-Typ/-Größe wird unter ⚙️ Einstellungen → Materialkatalog festgelegt, hier nur der Preis pro Meter. Die Summe unten rechnet mit der tatsächlich je Segment verlegten Länge (Backbone nur zwischen Verteilern, Sammelverband nach echtem Bedarf) — nicht mit der gesamten Trassenlänge.
              </p>
            </>
          ))}

          <div className="p-4 flex flex-col mt-1" style={{ backgroundColor: 'var(--surface-2)', borderRadius: 'var(--radius-lg)' }}>
            {zeile('Befestigte Oberfläche', `${Math.round(strasseLaenge)} m`, strasseSumme)}
            {zeile('Unbefestigte Oberfläche', `${Math.round(feldwegLaenge)} m`, feldwegSumme)}
            {zeile('Hausanschlüsse', `${hausanschluesseCount} Stk.`, hausanschlussSumme)}
            {preise.sonderpositionAnzahl > 0 && zeile('Sonderposition', `${preise.sonderpositionAnzahl} Stk.`, sonderpositionSumme)}
            {nvtAnzahl > 0 && zeile('NVT', `${nvtAnzahl} Stk.`, nvtSumme)}
            {schachtAnzahl > 0 && zeile('Schacht', `${schachtAnzahl} Stk.`, schachtSumme)}
            {trasseMaterialLaengen
              .filter(({ material }) => material.preisProMeter > 0)
              .map(({ material, laenge }) => (
                <div key={material.bezeichnungFirma || material.lrArt}>
                  {zeile(`Material ${material.bezeichnungFirma}`, `${Math.round(laenge)} m`, laenge * material.preisProMeter)}
                </div>
              ))}
            {materialHausanschlussSumme > 0 && zeile(`Material Hausanschluss`, `${Math.round(hausanschlussLaenge)} m`, materialHausanschlussSumme)}
            <div className="flex justify-between items-center pt-3 mt-1.5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Gesamt</span>
              <span className="text-lg font-semibold" style={{ color: '#93c5fd' }}>{formatEuro(gesamt)}</span>
            </div>
          </div>

          <button onClick={handlePdfExport}
            className="w-full px-3.5 py-2.5 text-sm font-medium text-white transition-colors hover:brightness-110"
            style={{ backgroundColor: 'var(--accent-blue)', borderRadius: 'var(--radius-md)' }}>
            📄 Als PDF exportieren
          </button>

          <p className="text-xs text-center" style={{ color: 'var(--text-tertiary)' }}>
            Preise werden geräteweit gespeichert und gelten projektübergreifend.
          </p>
        </div>
      </div>
    </div>
  )
}

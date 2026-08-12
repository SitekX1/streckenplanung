// Material-/Rohrverband-Katalog nach "Einheitliches Materialkonzept und
// Vorgaben für die Dimensionierung passiver Infrastruktur" (Version 5.0.2,
// 02.08.2024) und den GIS-Nebenbestimmungen (Version 5.1, 03.04.2023),
// Abschnitt 3.2.2.2 (Layer Leerrohre, Feld lr_art).
//
// Zwei Ebenen werden unterschieden (vereinfacht gegenüber der vollen
// Materialkonzept-Tabelle, die zusätzlich eine separate Backbone-Ebene vor
// dem HvT/PoP kennt — Streckenplanung modelliert aktuell nur Start→NVT/
// Schacht→Haus, daher fällt die Backbone-Ebene mit der Verteilerebene
// zusammen):
// - "trasse": alle Trassenbau-Segmente (Start↔NVT, NVT↔NVT via Schacht)
// - "hausanschluss": alle Hausanschluss-Stiche (NVT/Schacht↔Haus)

export type MaterialEbene = 'trasse' | 'hausanschluss'
export type MaterialProfilName = 'firma' | 'foerderung'

// GIS-NB lr_art-Codes (Materialkonzept Abschnitt 2 + GIS-NB 3.2.2.2) — für
// Dropdowns und zur Anzeige des offiziellen Codes neben der Firmenbezeichnung.
export const LR_ART_KATALOG: { code: number; label: string; daDi?: string }[] = [
  { code: 1, label: 'Kabelschutzrohr (KSR)' },
  { code: 2, label: '16/12 (Einzelrohr)', daDi: '16/12' },
  { code: 3, label: '12/8 (Einzelrohr)', daDi: '12/8' },
  { code: 4, label: '14/10 (Einzelrohr)', daDi: '14/10' },
  { code: 5, label: '7/4 (Einzelrohr)', daDi: '7/4' },
  { code: 6, label: '10/6 (Einzelrohr)', daDi: '10/6' },
  { code: 11, label: '16/12 (Rohrverband)', daDi: '16/12' },
  { code: 12, label: '12/8 (Rohrverband)', daDi: '12/8' },
  { code: 13, label: '14/10 (Rohrverband)', daDi: '14/10' },
  { code: 14, label: '10/6 (Rohrverband)', daDi: '10/6' },
  { code: 15, label: '7/4 (Rohrverband)', daDi: '7/4' },
  { code: 16, label: '20/15 (Rohrverband)', daDi: '20/15' },
  { code: 21, label: 'MR4 (PE-HD) 2x40/32 + 2x32/28' },
  { code: 22, label: 'Kabelschutzrohr (DN50)' },
  { code: 23, label: 'Kabelschutzrohr (DN40)' },
  { code: 24, label: 'Kabelschutzrohr (DN32)' },
  { code: 25, label: 'Kabelschutzrohr (DN100)' },
  { code: 99, label: 'Sonstige' },
]

export function lrArtLabel(code: number): string {
  return LR_ART_KATALOG.find((e) => e.code === code)?.label ?? `Code ${code}`
}

// Ein Material-Eintrag für eine Ebene: welcher GIS-NB-Code, wie viele
// Einzelröhrchen pro Verband (lr_anzahl) und wie viele Rohrverbände auf der
// Linie (anzahl) — entspricht 1:1 den gleichnamigen GIS-NB-Feldern.
export interface MaterialEintrag {
  lrArt: number
  lrAnzahl: number
  anzahl: number
  reserve: number // lr_reserv — Anzahl der Mikrorohre im Verband, die als Reserve vorgesehen sind
  bezeichnungFirma: string // eure interne Kurzbezeichnung, z.B. "24x7"
  preisProMeter: number // Materialkosten (nicht Verlegekosten — die stehen separat in der Kalkulation)
}

export interface MaterialProfil {
  trasse: MaterialEintrag // NVT-zu-NVT-/Backbone-Verband, fest, unabhängig von der Hausanschluss-Anzahl
  hausanschluss: MaterialEintrag // Hauszuführung NVT/Schacht → einzelnes Haus
  // Doppelbelegung auf Trasse-Segmenten (Materialkonzept: "Jedes Leerrohr...
  // muss gesondert genannt werden, ggf. durch übereinander liegende
  // Linien"): zusätzlich zum festen Backbone-Verband (oben) läuft ein
  // Kundenanschluss-Sammelverband mit, dessen Größe sich dynamisch nach der
  // Anzahl der über das jeweilige Segment versorgten Hausanschlüsse richtet
  // (siehe berechneHausanschlussAnzahlProSegment in faserdimensionierung.ts)
  // — aufsteigend sortiert nach lrAnzahl, die kleinste ausreichende Stufe
  // wird gewählt (gleiche Logik wie bei den Glasfaserkabel-Standardgrößen).
  kundenanschlussStufen: MaterialEintrag[]
}

// Default "Firmenstandard": eure real verbauten Typen (Stand 2026-08-12,
// von Alex bestätigt) — 24x7/12x7/7x7 für Kundenanschlüsse (7/4-Rohrverband,
// unterschiedliche Stückzahl), 4x20/2x20 im Backbone/Verteilbereich
// (20/15-Rohrverband). lr_reserv hier bewusst 0, da euer Standardmaterial
// nicht nach der 15%-Förderregel bemessen ist, sondern nach eigener Praxis.
const KUNDENANSCHLUSS_STUFEN_DEFAULT: MaterialEintrag[] = [
  { lrArt: 15, lrAnzahl: 7, anzahl: 1, reserve: 0, bezeichnungFirma: '7x7', preisProMeter: 0 },
  { lrArt: 15, lrAnzahl: 12, anzahl: 1, reserve: 0, bezeichnungFirma: '12x7', preisProMeter: 0 },
  { lrArt: 15, lrAnzahl: 24, anzahl: 1, reserve: 0, bezeichnungFirma: '24x7', preisProMeter: 0 },
]

const FIRMA_DEFAULT: MaterialProfil = {
  trasse: { lrArt: 16, lrAnzahl: 4, anzahl: 1, reserve: 0, bezeichnungFirma: '4x20', preisProMeter: 0 },
  hausanschluss: { lrArt: 15, lrAnzahl: 12, anzahl: 1, reserve: 0, bezeichnungFirma: '12x7', preisProMeter: 0 },
  kundenanschlussStufen: KUNDENANSCHLUSS_STUFEN_DEFAULT,
}

// Default "Bundesförderung": trasse (NVT-zu-NVT-Backbone) auf eure real
// genannte Förderungs-Praxis "7x14" gesetzt (Code 13, 14/10-Rohrverband) —
// NICHT die abstrakte Materialkonzept-Mindestgröße, sondern was ihr laut
// Alex (2026-08-12) tatsächlich baut. hausanschluss bleibt die
// Materialkonzept-Mindestvorgabe (Einzelrohr ≥ Da10/Di6, Code 6), da dafür
// keine abweichende reale Praxis genannt wurde. Die separat vorgeschriebene
// Backbone-Reserve (12x10/6, Code 14) und die 15%-Kapazitätsreserve (RN 4)
// werden hier vereinfacht als lr_reserv auf den Hauptverband gelegt statt
// als eigene zweite Linie.
const FOERDERUNG_DEFAULT: MaterialProfil = {
  trasse: { lrArt: 13, lrAnzahl: 7, anzahl: 1, reserve: 1, bezeichnungFirma: '7x14 (Förderung-Standard)', preisProMeter: 0 },
  hausanschluss: { lrArt: 6, lrAnzahl: 1, anzahl: 1, reserve: 0, bezeichnungFirma: 'GIS-NB Hauszuführung ≥1x10/6', preisProMeter: 0 },
  kundenanschlussStufen: KUNDENANSCHLUSS_STUFEN_DEFAULT,
}

const STORAGE_KEY = 'streckenplanung-materialkatalog'

interface GespeicherterKatalog {
  firma: MaterialProfil
  foerderung: MaterialProfil
}

// Geräteweit persistent, gleiches Muster wie Kalkulations-Preise/Firmendaten
// (ändert sich kaum von Projekt zu Projekt, im Gegensatz zu den eigentlichen
// Streckendaten).
export function ladeMaterialkatalog(): GespeicherterKatalog {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { firma: FIRMA_DEFAULT, foerderung: FOERDERUNG_DEFAULT }
    const parsed = JSON.parse(raw)
    const stufen = (gespeichert: unknown, fallback: MaterialEintrag[]) =>
      Array.isArray(gespeichert) && gespeichert.length > 0 ? gespeichert : fallback
    return {
      firma: {
        trasse: { ...FIRMA_DEFAULT.trasse, ...parsed.firma?.trasse },
        hausanschluss: { ...FIRMA_DEFAULT.hausanschluss, ...parsed.firma?.hausanschluss },
        kundenanschlussStufen: stufen(parsed.firma?.kundenanschlussStufen, FIRMA_DEFAULT.kundenanschlussStufen),
      },
      foerderung: {
        trasse: { ...FOERDERUNG_DEFAULT.trasse, ...parsed.foerderung?.trasse },
        hausanschluss: { ...FOERDERUNG_DEFAULT.hausanschluss, ...parsed.foerderung?.hausanschluss },
        kundenanschlussStufen: stufen(parsed.foerderung?.kundenanschlussStufen, FOERDERUNG_DEFAULT.kundenanschlussStufen),
      },
    }
  } catch {
    return { firma: FIRMA_DEFAULT, foerderung: FOERDERUNG_DEFAULT }
  }
}

export function speichereMaterialkatalog(katalog: GespeicherterKatalog): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(katalog))
  } catch {
    /* ignorieren */
  }
}

// Liefert das für ein Projekt aktive Profil (Bundesförderung → foerderung,
// sonst firma) direkt aus dem gespeicherten Katalog.
export function aktivesMaterialProfil(bundesfoerderung: boolean | undefined): MaterialProfil {
  const katalog = ladeMaterialkatalog()
  return bundesfoerderung ? katalog.foerderung : katalog.firma
}

export function profilName(bundesfoerderung: boolean | undefined): MaterialProfilName {
  return bundesfoerderung ? 'foerderung' : 'firma'
}

// Wählt für eine gegebene Hausanschluss-Anzahl (aus
// berechneHausanschlussAnzahlProSegment) die kleinste ausreichende Stufe des
// Kundenanschluss-Sammelverbands — reicht keine Stufe aus, wird die größte
// genommen (Grenzfall: sehr große Zone vor einem großen NVT).
export function waehleKundenanschlussStufe(profil: MaterialProfil, hausanschlussAnzahl: number): MaterialEintrag {
  const stufen = [...profil.kundenanschlussStufen].sort((a, b) => a.lrAnzahl - b.lrAnzahl)
  return stufen.find((s) => s.lrAnzahl >= hausanschlussAnzahl) ?? stufen[stufen.length - 1]
}

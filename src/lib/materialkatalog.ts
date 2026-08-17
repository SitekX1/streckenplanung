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
  // Eigene Kartenfarbe je Material-Typ (2026-08-12, Alex: "7x7, 12x7, 24x7,
  // 4x20, 2x20, 7x14 jeweils eine andere Farbe") — MapView.tsx färbt jedes
  // Trasse-Segment nach dem Material ein, das dort laut derselben Logik wie
  // im GIS-NB-Export tatsächlich zugewiesen wird.
  farbe: string
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
// 2x7 (2026-08-20, Alex) als kleinste Stufe ergänzt — für z.B. genau 2
// Hausanschlüsse an einer kurzen Stichstraße/Sackgasse: "man braucht für
// zwei Häuser nicht mit einem 7x7 in eine Stichstraße rein". Die generische
// Stufenwahl in waehleVerbandMitReserve() greift automatisch, keine
// Sonderlogik nötig — sie wählt ja ohnehin schon die kleinste ausreichende
// Stufe.
const KUNDENANSCHLUSS_STUFEN_DEFAULT: MaterialEintrag[] = [
  { lrArt: 15, lrAnzahl: 2, anzahl: 1, reserve: 0, bezeichnungFirma: '2x7', preisProMeter: 0, farbe: '#c084fc' },
  { lrArt: 15, lrAnzahl: 7, anzahl: 1, reserve: 0, bezeichnungFirma: '7x7', preisProMeter: 0, farbe: '#22d3ee' },
  { lrArt: 15, lrAnzahl: 12, anzahl: 1, reserve: 0, bezeichnungFirma: '12x7', preisProMeter: 0, farbe: '#eab308' },
  { lrArt: 15, lrAnzahl: 24, anzahl: 1, reserve: 0, bezeichnungFirma: '24x7', preisProMeter: 0, farbe: '#84cc16' },
]

const FIRMA_DEFAULT: MaterialProfil = {
  trasse: { lrArt: 16, lrAnzahl: 4, anzahl: 1, reserve: 0, bezeichnungFirma: '4x20', preisProMeter: 0, farbe: '#ec4899' },
  // Einzelne Hauszuführung NVT/Schacht → EIN Haus — bewusst ein einzelnes/
  // kleines Bündel, NICHT der Kundenanschluss-Sammelverband (der läuft
  // separat auf dem Trasse-Segment, siehe kundenanschlussStufen). Vorheriger
  // Default (12x7) war ein Fehler — 12 Röhrchen für einen einzelnen
  // Hausanschluss ergeben keinen Sinn (Alex, 2026-08-14: "da liegt mal
  // entweder ein 1x7 oder maximal ein 2x7"). 1x7 als typischer Fall, im
  // Katalog jederzeit auf 2x7 änderbar.
  hausanschluss: { lrArt: 15, lrAnzahl: 1, anzahl: 1, reserve: 0, bezeichnungFirma: '1x7', preisProMeter: 0, farbe: '#eab308' },
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
  trasse: { lrArt: 13, lrAnzahl: 7, anzahl: 1, reserve: 1, bezeichnungFirma: '7x14 (Förderung-Standard)', preisProMeter: 0, farbe: '#be123c' },
  hausanschluss: { lrArt: 6, lrAnzahl: 1, anzahl: 1, reserve: 0, bezeichnungFirma: 'GIS-NB Hauszuführung ≥1x10/6', preisProMeter: 0, farbe: '#eab308' },
  kundenanschlussStufen: KUNDENANSCHLUSS_STUFEN_DEFAULT,
}

const STORAGE_KEY = 'streckenplanung-materialkatalog'

interface GespeicherterKatalog {
  firma: MaterialProfil
  foerderung: MaterialProfil
  // Ab welcher Auslastung (0–1) der knapp passenden Stufe automatisch eine
  // Nummer größer gewählt wird — 2026-08-12, Alex' konkretes Beispiel:
  // 5 Kunden auf einem Ast → 12x7 statt 7x7 (5/7 ≈ 71 % Auslastung, löst
  // aus), 8 Kunden → bleibt bei 12x7 (8/12 ≈ 67 %, löst NICHT aus). 0.7
  // liegt zwischen beiden Werten und trifft damit genau Alex' Beispiel.
  auslastungsSchwelle: number
}

const KATALOG_DEFAULT: GespeicherterKatalog = {
  firma: FIRMA_DEFAULT,
  foerderung: FOERDERUNG_DEFAULT,
  auslastungsSchwelle: 0.7,
}

// Geräteweit persistent, gleiches Muster wie Kalkulations-Preise/Firmendaten
// (ändert sich kaum von Projekt zu Projekt, im Gegensatz zu den eigentlichen
// Streckendaten).
// Neue, seit dem letzten Speichern hinzugekommene Standard-Stufen (z.B. das
// nachträglich eingeführte 2x7) automatisch in einen bereits gespeicherten
// Katalog einmischen, statt dass sie dort unsichtbar bleiben — Geräte, die
// den Katalog schon einmal gespeichert haben, sähen die neue Stufe sonst nie
// (die alte Logik nahm bei vorhandenem Array NUR das gespeicherte, komplett
// ohne neue Defaults). Abgleich über lrAnzahl, damit eine vom Nutzer bereits
// umbenannte/umpreiste Stufe nicht dupliziert wird.
function stufen(gespeichert: unknown, fallback: MaterialEintrag[]): MaterialEintrag[] {
  const basis = Array.isArray(gespeichert) && gespeichert.length > 0 ? (gespeichert as MaterialEintrag[]) : fallback
  const vorhandeneGroessen = new Set(basis.map((s) => s.lrAnzahl))
  const fehlende = fallback.filter((s) => !vorhandeneGroessen.has(s.lrAnzahl))
  if (fehlende.length === 0) return basis
  return [...basis, ...fehlende].sort((a, b) => a.lrAnzahl - b.lrAnzahl)
}

export function ladeMaterialkatalog(): GespeicherterKatalog {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return KATALOG_DEFAULT
    const parsed = JSON.parse(raw)
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
      auslastungsSchwelle:
        typeof parsed.auslastungsSchwelle === 'number'
          ? parsed.auslastungsSchwelle
          : KATALOG_DEFAULT.auslastungsSchwelle,
    }
  } catch {
    return KATALOG_DEFAULT
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

// Wählt den Kundenanschluss-Sammelverband für einen gegebenen tatsächlichen
// Bedarf (aus berechneHausanschlussAnzahlProSegment), mit Reserve-Logik nach
// Alex' konkreten Beispielen (2026-08-12):
//
// 1. Normalfall (Bedarf passt in eine einzelne Stufe): die knapp
//    ausreichende Stufe wird gewählt — außer sie wäre über der
//    auslastungsSchwelle (Default 70 %) ausgelastet, dann wird die nächst-
//    größere Stufe genommen ("5 Kunden → 12x7 statt 7x7, weil ich noch
//    Reserve haben will; 8 Kunden → bleibt bei 12x7, das ist schon
//    ausreichend Luft").
// 2. Großfall (Bedarf übersteigt selbst die größte Stufe, z.B. Bedarf nahe
//    der NVT-Kapazität): so viele Bündel der GRÖSSTEN Stufe wie nötig,
//    wieder mit Aufrundung bei knapper Auslastung ("5x 24x7 für ein
//    NVT mit 80 tatsächlichen von 120 möglichen Anschlüssen — nicht mehr,
//    das wäre schon zu knapp").
// 3. Kappung: kapazitaetsObergrenze (z.B. die nominale NVT-Kapazität) wird
//    NIE überschritten — "der Kasten hat nur 120 Plätze, mehr geht nicht,
//    mehr wird auch nicht reinkommen". Reicht die Reserve-Aufrundung nicht
//    mehr in die Box, wird ohne Zusatzreserve exakt bis zur Grenze gefüllt
//    ("wenn's nicht anders geht, dann halt voll").
export function waehleVerbandMitReserve(
  profil: MaterialProfil,
  bedarf: number,
  kapazitaetsObergrenze?: number
): MaterialEintrag {
  const stufenAufsteigend = [...profil.kundenanschlussStufen].sort((a, b) => a.lrAnzahl - b.lrAnzahl)
  const groesste = stufenAufsteigend[stufenAufsteigend.length - 1]
  if (!groesste) return { lrArt: 15, lrAnzahl: 0, anzahl: 0, reserve: 0, bezeichnungFirma: '', farbe: '#6b7280', preisProMeter: 0 }
  if (bedarf <= 0) return { ...groesste, anzahl: 0, reserve: 0 }

  const { auslastungsSchwelle } = ladeMaterialkatalog()
  let ergebnis: MaterialEintrag

  const passendeStufe = stufenAufsteigend.find((s) => s.lrAnzahl >= bedarf)
  if (passendeStufe) {
    const idx = stufenAufsteigend.indexOf(passendeStufe)
    const naechsteGroessere = stufenAufsteigend[idx + 1]
    const auslastung = bedarf / passendeStufe.lrAnzahl
    const gewaehlt = naechsteGroessere && auslastung > auslastungsSchwelle ? naechsteGroessere : passendeStufe
    ergebnis = { ...gewaehlt, anzahl: 1, reserve: Math.max(0, gewaehlt.lrAnzahl - bedarf) }
  } else {
    const rohAnzahl = Math.ceil(bedarf / groesste.lrAnzahl)
    const auslastung = bedarf / (rohAnzahl * groesste.lrAnzahl)
    const anzahl = auslastung > auslastungsSchwelle ? rohAnzahl + 1 : rohAnzahl
    ergebnis = { ...groesste, anzahl, reserve: Math.max(0, anzahl * groesste.lrAnzahl - bedarf) }
  }

  if (kapazitaetsObergrenze != null && ergebnis.lrAnzahl === groesste.lrAnzahl) {
    const maxAnzahl = Math.max(1, Math.floor(kapazitaetsObergrenze / groesste.lrAnzahl))
    if (ergebnis.anzahl > maxAnzahl) {
      ergebnis = { ...groesste, anzahl: maxAnzahl, reserve: Math.max(0, maxAnzahl * groesste.lrAnzahl - bedarf) }
    }
  }

  return ergebnis
}

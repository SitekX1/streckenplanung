import * as XLSX from 'xlsx'
import proj4 from 'proj4'
import { Address } from './types'

const MAX_DATEIGROESSE = 50 * 1024 * 1024 // 50 MB

// ETRS89 / UTM Zone 32N (EPSG:25832) — heutiger Vermessungsstandard für
// West-/Mitteldeutschland (u.a. Bayern), abgelöst Gauß-Krüger. towgs84 mit
// Nullverschiebung, da ETRS89 und WGS84 für unsere Zwecke praktisch
// deckungsgleich sind (gleiche Annahme wie beim ETRS89_PRJ in
// shapefileExport.ts). Nur Zone 32N unterstützt — reicht für die bisher
// gesehenen Adresslisten (Bayern); andere Zonen/Gauß-Krüger wären eine
// weitere proj4.defs()-Zeile plus Erkennung, falls später gebraucht.
proj4.defs('EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs')

function utm32nZuWgs84(x: number, y: number): { lat: number; lon: number } {
  const [lon, lat] = proj4('EPSG:25832', 'EPSG:4326', [x, y])
  return { lat, lon }
}

// Spalten werden per Kopfzeilen-Name gesucht statt per fester Buchstaben-
// Position (2026-08-14, Alex: Chef wollte eine andere Adressliste
// importieren, "man sieht, dass nichts importiert wird" — Ursache: der
// Import las Koordinaten bisher stur aus Spalte D/E, unabhängig vom
// tatsächlichen Spaltenkopf. Andere Listen aus derselben Quelle haben ein
// komplett anderes Layout: x/y als UTM32N-Koordinaten statt direkt lat/lon,
// ags statt plz in Spalte D, etc.). Aliasliste deckt die bisher gesehenen
// Varianten ab, Vergleich case-/whitespace-unempfindlich.
const SPALTEN_ALIASE = {
  uuid: ['uuid', 'id'],
  lat: ['lat', 'latitude', 'breite'],
  lon: ['lon', 'lng', 'long', 'longitude', 'länge', 'laenge'],
  x: ['x', 'ostwert', 'rechtswert'],
  y: ['y', 'nordwert', 'hochwert'],
  strasse: ['stra_name', 'strasse', 'straße', 'str'],
  nr: ['nr', 'hausnummer', 'hausnr'],
  nr_zusatz: ['nr_zusatz', 'zusatz'],
  plz: ['plz', 'postleitzahl'],
  ortsname: ['ortsname', 'ort'],
  ortsteil: ['ortsteil'],
  hh: ['hh', 'haushalte', 'wohneinheiten'],
} as const

type SpaltenSchluessel = keyof typeof SPALTEN_ALIASE

function normalisiere(s: string): string {
  return s.trim().toLowerCase()
}

// Ermittelt für jeden logischen Feldnamen (siehe SPALTEN_ALIASE), welcher
// tatsächliche Spaltenkopf in dieser Datei dazu passt — einmal pro Import,
// nicht pro Zeile.
function ermittleSpaltenZuordnung(headerZeile: string[]): Partial<Record<SpaltenSchluessel, string>> {
  const zuordnung: Partial<Record<SpaltenSchluessel, string>> = {}
  const normalisierteHeader = headerZeile.map((h) => ({ original: h, normalisiert: normalisiere(String(h ?? '')) }))
  for (const [feld, aliase] of Object.entries(SPALTEN_ALIASE) as [SpaltenSchluessel, readonly string[]][]) {
    const treffer = normalisierteHeader.find((h) => (aliase as readonly string[]).includes(h.normalisiert))
    if (treffer) zuordnung[feld] = treffer.original
  }
  return zuordnung
}

export async function parseExcelFile(file: File): Promise<Address[]> {
  if (file.size > MAX_DATEIGROESSE) throw new Error('Excel-Datei zu groß (max. 50 MB)')

  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })

  if (!workbook.SheetNames.length) throw new Error('Excel-Datei enthält kein Arbeitsblatt')
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error('Arbeitsblatt konnte nicht gelesen werden')

  // Rohe Kopfzeile (Zeile 1) separat lesen für die Alias-Zuordnung oben.
  const headerZeile: string[] = (
    (XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, range: 0 })[0] as string[] | undefined) ?? []
  ).map((h) => String(h ?? ''))
  const zuordnung = ermittleSpaltenZuordnung(headerZeile)

  // Ohne header-Option nutzt sheet_to_json Zeile 1 automatisch als
  // Objekt-Keys — Datenzeilen beginnen direkt bei Zeile 2.
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

  const wert = (row: Record<string, unknown>, feld: SpaltenSchluessel): string =>
    zuordnung[feld] ? String(row[zuordnung[feld]!] ?? '') : ''

  const adressen: Address[] = []
  let uebersprungen = 0

  for (const row of rows) {
    let lat = parseFloat(wert(row, 'lat'))
    let lon = parseFloat(wert(row, 'lon'))

    // Kein direktes lat/lon erkannt, aber X/Y (UTM32N) vorhanden — von dort
    // umrechnen. Grobe Wertebereichsprüfung als Sicherheitsnetz gegen
    // fehlerhaft erkannte Spalten (echte UTM32N-Werte für Deutschland
    // liegen sicher innerhalb dieser Grenzen).
    if ((!isFinite(lat) || !isFinite(lon)) && zuordnung.x && zuordnung.y) {
      const x = parseFloat(wert(row, 'x'))
      const y = parseFloat(wert(row, 'y'))
      if (isFinite(x) && isFinite(y) && x > 100_000 && x < 900_000 && y > 4_000_000 && y < 6_500_000) {
        const wgs84 = utm32nZuWgs84(x, y)
        lat = wgs84.lat
        lon = wgs84.lon
      }
    }

    // Kopfzeile enthielt keine erkannte Koordinatenspalte (weder lat/lon
    // noch x/y per Alias) — Fallback auf das alte Verhalten (Koordinaten
    // fest aus Spalte D/E), damit bereits funktionierende Importe mit
    // anderer/unbekannter Kopfzeilen-Benennung nicht durch die neue
    // namensbasierte Zuordnung brechen. Position statt Name, da
    // Object.values() bei String-Keys die ursprüngliche Spaltenreihenfolge
    // erhält (A=Index 0, ..., D=Index 3, E=Index 4).
    if ((!isFinite(lat) || !isFinite(lon)) && !zuordnung.lat && !zuordnung.x) {
      const werte = Object.values(row)
      lat = parseFloat(String(werte[3] ?? ''))
      lon = parseFloat(String(werte[4] ?? ''))
    }

    if (!isFinite(lat) || !isFinite(lon)) { uebersprungen++; continue }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) { uebersprungen++; continue }

    adressen.push({
      uuid: wert(row, 'uuid') || crypto.randomUUID(),
      lat,
      lon,
      strasse: wert(row, 'strasse'),
      nr: wert(row, 'nr'),
      nr_zusatz: wert(row, 'nr_zusatz'),
      plz: wert(row, 'plz'),
      ortsname: wert(row, 'ortsname'),
      ortsteil: wert(row, 'ortsteil'),
      hh: parseInt(wert(row, 'hh'), 10) || 0,
    })
  }

  // Bisher ein stiller Fehlschlag (0 Adressen, keine Meldung) — genau das
  // Symptom, das zu diesem Fix geführt hat. Jetzt eine klare Fehlermeldung
  // statt eines leeren, unerklärten Imports.
  if (adressen.length === 0) {
    throw new Error(
      uebersprungen > 0
        ? `Keine gültigen Adressen gefunden (${uebersprungen} Zeile(n) wegen fehlender/ungültiger Koordinaten übersprungen) — Spaltenköpfe der Excel-Datei prüfen.`
        : 'Keine Adressen in der Datei gefunden.'
    )
  }

  return adressen
}

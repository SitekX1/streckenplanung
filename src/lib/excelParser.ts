import * as XLSX from 'xlsx'
import { Address } from './types'

const MAX_DATEIGROESSE = 50 * 1024 * 1024 // 50 MB

export async function parseExcelFile(file: File): Promise<Address[]> {
  if (file.size > MAX_DATEIGROESSE) throw new Error('Excel-Datei zu groß (max. 50 MB)')

  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })

  if (!workbook.SheetNames.length) throw new Error('Excel-Datei enthält kein Arbeitsblatt')
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error('Arbeitsblatt konnte nicht gelesen werden')
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    header: 'A',
    defval: '',
  })

  // Row 0 is the header row — skip it
  const dataRows = rows.slice(1)

  const adressen: Address[] = []

  for (const row of dataRows) {
    const lat = parseFloat(String(row['D'] ?? ''))
    const lon = parseFloat(String(row['E'] ?? ''))

    if (!isFinite(lat) || !isFinite(lon)) continue
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue

    adressen.push({
      uuid: String(row['A'] ?? crypto.randomUUID()),
      lat,
      lon,
      strasse: String(row['I'] ?? ''),
      nr: String(row['J'] ?? ''),
      nr_zusatz: String(row['K'] ?? ''),
      plz: String(row['G'] ?? ''),
      ortsname: String(row['H'] ?? ''),
      ortsteil: String(row['L'] ?? ''),
      hh: parseInt(String(row['M'] ?? '0'), 10) || 0,
    })
  }

  return adressen
}

import { Projekt } from './types'

// Farbreihe nach Materialkonzept Abschnitt 3 (DIN EN 60794-1-1 Beiblatt 1) —
// ab Rohr Nr. 13 beginnt die 12er-Reihe erneut, ergänzt durch eine
// Streifenmarkierung (hier als Text-Hinweis abgebildet, da eine echte
// Streifen-Grafik in einer CSV nicht sinnvoll darstellbar ist).
const FARBEN = [
  'Rot', 'Grün', 'Blau', 'Gelb', 'Weiß', 'Grau',
  'Braun', 'Violett', 'Türkis', 'Schwarz', 'Orange', 'Rosa',
]

function farbeFuerRohrNr(rohrNr: number): string {
  const basisfarbe = FARBEN[(rohrNr - 1) % 12]
  const streifenRunde = Math.floor((rohrNr - 1) / 12)
  return streifenRunde === 0 ? basisfarbe : `${basisfarbe} + ${streifenRunde}x Streifen`
}

function csvFeld(wert: string | number): string {
  const text = String(wert)
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

// Dokumentationstabelle "Hausanschluss Mikrokabelrohr" (Materialkonzept
// Abschnitt 3, Seite 8) — pro Rohrverband (= NVT oder Schacht) wird jedem
// zugeordneten Hausanschluss eine fortlaufende Rohr-Nr + Farbe zugewiesen.
// Anschlusspunkt/Datum/"Hausanschluss gesetzt" sind Baustellen-Vollzugsdaten,
// die die Software nicht kennen kann — Spalten bleiben für die manuelle
// Nachpflege durch die Baukolonne leer.
export function baueRohrbelegungCsv(projekt: Projekt): string {
  const adresseByUuid = new Map(projekt.adressen.map((a) => [a.uuid, a]))

  const zeilen: string[] = []
  zeilen.push(`Bauvorhaben/Objekt;${csvFeld(projekt.name)}`)
  zeilen.push('')
  zeilen.push(
    ['Standort', 'Straße', 'Haus Nr', 'Haushalt/Name', 'Mantelfarbe Verbund', 'Rohr Nr', 'Farbe', 'Anschlusspunkt', 'Datum', 'Hausanschluss gesetzt ja/nein'].join(';')
  )

  function schreibeGruppe(standortLabel: string, hausanschlussIds: string[]) {
    hausanschlussIds.forEach((hausId, i) => {
      const haus = projekt.hausanschluesse.find((h) => h.id === hausId)
      const adresse = haus ? adresseByUuid.get(haus.addressUuid) : undefined
      const rohrNr = i + 1
      zeilen.push(
        [
          standortLabel,
          adresse?.strasse ?? '',
          `${adresse?.nr ?? ''}${adresse?.nr_zusatz ? ' ' + adresse.nr_zusatz : ''}`,
          '',
          '',
          rohrNr,
          farbeFuerRohrNr(rohrNr),
          '',
          '',
          '',
        ].map(csvFeld).join(';')
      )
    })
  }

  ;(projekt.nvtStandorte ?? []).forEach((nvt, i) => schreibeGruppe(`NVT ${i + 1}`, nvt.hausanschlussIds))
  ;(projekt.schachtStandorte ?? []).forEach((schacht, i) => schreibeGruppe(`Schacht ${i + 1}`, schacht.hausanschlussIds))

  return zeilen.join('\r\n')
}

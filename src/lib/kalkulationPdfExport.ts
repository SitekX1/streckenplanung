import jsPDF from 'jspdf'

export interface KalkulationZeile {
  label: string
  menge: string
  einzelpreis: string
  summe: number
}

export interface KalkulationPdfDaten {
  projektName: string
  zeilen: KalkulationZeile[]
  gesamt: number
}

function formatEuro(betrag: number): string {
  return betrag.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

export function exportKalkulationPdf(daten: KalkulationPdfDaten): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const seitenBreite = doc.internal.pageSize.getWidth()
  const randLinks = 18
  const randRechts = seitenBreite - 18
  let y = 22

  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('Kostenschätzung', randLinks, y)
  y += 8

  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text(daten.projektName, randLinks, y)
  y += 6
  doc.setTextColor(120)
  doc.text(new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }), randLinks, y)
  doc.setTextColor(0)
  y += 12

  // Tabellenkopf
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(120)
  doc.text('Position', randLinks, y)
  doc.text('Menge', randLinks + 78, y)
  doc.text('Einzelpreis', randLinks + 112, y)
  doc.text('Summe', randRechts, y, { align: 'right' })
  y += 3
  doc.setDrawColor(200)
  doc.line(randLinks, y, randRechts, y)
  y += 7
  doc.setTextColor(0)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  for (const zeile of daten.zeilen) {
    doc.text(zeile.label, randLinks, y)
    doc.text(zeile.menge, randLinks + 78, y)
    doc.text(zeile.einzelpreis, randLinks + 112, y)
    doc.text(formatEuro(zeile.summe), randRechts, y, { align: 'right' })
    y += 7
  }

  y += 2
  doc.setDrawColor(0)
  doc.line(randLinks, y, randRechts, y)
  y += 9

  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text('Gesamt', randLinks, y)
  doc.text(formatEuro(daten.gesamt), randRechts, y, { align: 'right' })
  y += 14

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(150)
  doc.text('Unverbindliche Kostenschätzung auf Basis der Grobplanung — keine Ausschreibungs- oder Vertragsgrundlage.', randLinks, y)

  doc.save(`${daten.projektName}_Kalkulation.pdf`)
}

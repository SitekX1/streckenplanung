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
  // Firmendaten sind optional — ohne hinterlegtes Logo/Adresse (Einstellungen
  // → Firma) bleibt der Kopfbereich einfach weg, kein Leerraum.
  logoDataUrl?: string | null
  logoBreite?: number
  logoHoehe?: number
  firmenname?: string
  adresse?: string
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

  const hatLogo = !!daten.logoDataUrl && !!daten.logoBreite && !!daten.logoHoehe
  const adresseZeilen = (daten.adresse ?? '').split('\n').filter((z) => z.trim() !== '')
  const hatFirmentext = !!daten.firmenname || adresseZeilen.length > 0

  if (hatLogo || hatFirmentext) {
    // Kopfbereich mit fester Top-Kante — Bild (Top-Koordinate) und Text
    // (Baseline-Koordinate) starten beide relativ dazu, damit sie optisch
    // auf gleicher Höhe beginnen.
    const kopfTop = 10
    let kopfHoehe = 0

    if (hatLogo) {
      const MAX_W = 32, MAX_H = 18
      const seitenverhaeltnis = daten.logoBreite! / daten.logoHoehe!
      const logoBreiteMm = seitenverhaeltnis > MAX_W / MAX_H ? MAX_W : MAX_H * seitenverhaeltnis
      const logoHoeheMm = seitenverhaeltnis > MAX_W / MAX_H ? MAX_W / seitenverhaeltnis : MAX_H
      doc.addImage(daten.logoDataUrl!, 'PNG', randLinks, kopfTop, logoBreiteMm, logoHoeheMm)
      kopfHoehe = Math.max(kopfHoehe, logoHoeheMm)
    }

    if (hatFirmentext) {
      let textY = kopfTop + 4
      if (daten.firmenname) {
        doc.setFontSize(10)
        doc.setFont('helvetica', 'bold')
        doc.text(daten.firmenname, randRechts, textY, { align: 'right' })
        textY += 5
      }
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(90)
      for (const zeile of adresseZeilen) {
        doc.text(zeile, randRechts, textY, { align: 'right' })
        textY += 4.5
      }
      doc.setTextColor(0)
      kopfHoehe = Math.max(kopfHoehe, textY - kopfTop)
    }

    y = kopfTop + kopfHoehe + 8
    doc.setDrawColor(220)
    doc.line(randLinks, y, randRechts, y)
    y += 10
  }

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

  doc.save(`${daten.projektName}_Kalkulation.pdf`)
}

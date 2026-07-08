import { Projekt } from './types'

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function koordinatenZuString(coords: { lat: number; lng: number }[]): string {
  return coords.map((p) => `${p.lng},${p.lat},0`).join('\n          ')
}

function downloadBlob(inhalt: string, dateiname: string, mimeType: string): void {
  const blob = new Blob([inhalt], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = dateiname
  a.click()
  URL.revokeObjectURL(url)
}

export function exportKML(projekt: Projekt): void {
  const adressenPlacemarks = projekt.adressen
    .map(
      (a) => `    <Placemark>
      <styleUrl>#adresse</styleUrl>
      <name>${xmlEscape(a.strasse)} ${xmlEscape(a.nr)}${a.nr_zusatz ? ' ' + xmlEscape(a.nr_zusatz) : ''}, ${xmlEscape(a.plz)} ${xmlEscape(a.ortsname)}</name>
      <description>Haushalte: ${a.hh}</description>
      <Point><coordinates>${a.lon},${a.lat},0</coordinates></Point>
    </Placemark>`
    )
    .join('\n')

  const hausanschlussPlacemarks = projekt.hausanschluesse
    .map((h) => {
      const linePts =
        h.wegpunkte && h.wegpunkte.length >= 2
          ? h.wegpunkte
          : [h.trassenPunkt, h.hausKoordinate]
      const coordStr = linePts.map((p) => `${p.lng},${p.lat},0`).join('\n          ')
      return `    <Placemark>
      <styleUrl>#hausstich</styleUrl>
      <name>Hausanschluss ${h.id.slice(0, 8)}</name>
      <description>Länge: ${h.laengeMeter.toFixed(1)} m</description>
      <LineString>
        <coordinates>
          ${coordStr}
        </coordinates>
      </LineString>
    </Placemark>`
    })
    .join('\n')

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>Trassenplanung - ${xmlEscape(projekt.name)}</name>

  <Style id="trasse">
    <LineStyle><color>ffff0000</color><width>3</width></LineStyle>
  </Style>
  <Style id="hausstich">
    <LineStyle><color>ff0000ff</color><width>2</width></LineStyle>
  </Style>
  <Style id="adresse">
    <IconStyle><color>ff00ff00</color></IconStyle>
  </Style>

  <Folder>
    <name>Adressen</name>
${adressenPlacemarks}
  </Folder>

  <Folder>
    <name>Trasse</name>
    <Placemark>
      <styleUrl>#trasse</styleUrl>
      <name>Trasse</name>
      <LineString>
        <coordinates>
          ${koordinatenZuString(projekt.trasse)}
        </coordinates>
      </LineString>
    </Placemark>
  </Folder>

  <Folder>
    <name>Hausanschlüsse</name>
${hausanschlussPlacemarks}
  </Folder>
</Document>
</kml>`

  downloadBlob(kml, `${projekt.name}.kml`, 'application/vnd.google-earth.kml+xml')
}

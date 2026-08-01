import { Projekt } from './types'
import { ermittleZuordnungen } from './nvt'

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

function segmentLaenge(pts: { lat: number; lng: number }[]): number {
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const dLat = (pts[i + 1].lat - pts[i].lat) * 111_000
    const dLng = (pts[i + 1].lng - pts[i].lng) * Math.cos((pts[i].lat * Math.PI) / 180) * 111_000
    total += Math.sqrt(dLat * dLat + dLng * dLng)
  }
  return total
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

  const zuordnungen = ermittleZuordnungen(projekt.nvtStandorte ?? [], projekt.schachtStandorte ?? [])

  const hausanschlussPlacemarks = projekt.hausanschluesse
    .map((h) => {
      const linePts =
        h.wegpunkte && h.wegpunkte.length >= 2
          ? h.wegpunkte
          : [h.trassenPunkt, h.hausKoordinate]
      const coordStr = linePts.map((p) => `${p.lng},${p.lat},0`).join('\n          ')
      const zuordnung = zuordnungen.get(h.id)
      const zuordnungText = zuordnung?.nvtNr != null
        ? `NVT ${zuordnung.nvtNr}`
        : zuordnung?.schachtNr != null
          ? `Schacht ${zuordnung.schachtNr}`
          : null
      return `    <Placemark>
      <styleUrl>#hausstich</styleUrl>
      <name>Hausanschluss ${h.id.slice(0, 8)}</name>
      <description>Länge: ${h.laengeMeter.toFixed(1)} m${zuordnungText ? ` &#183; ${zuordnungText}` : ''}</description>
      <LineString>
        <coordinates>
          ${coordStr}
        </coordinates>
      </LineString>
    </Placemark>`
    })
    .join('\n')

  const nvtPlacemarks = (projekt.nvtStandorte ?? [])
    .map(
      (n, i) => `    <Placemark>
      <styleUrl>#nvt</styleUrl>
      <name>NVT ${i + 1}</name>
      <description>Belegung: ${n.belegung}/${n.kapazitaet}</description>
      <Point><coordinates>${n.position.lng},${n.position.lat},0</coordinates></Point>
    </Placemark>`
    )
    .join('\n')

  const schachtPlacemarks = (projekt.schachtStandorte ?? [])
    .map(
      (s, i) => `    <Placemark>
      <styleUrl>#schacht</styleUrl>
      <name>Schacht ${i + 1}</name>
      <description>${s.hausanschlussIds.length} Hausanschluss(e)</description>
      <Point><coordinates>${s.position.lng},${s.position.lat},0</coordinates></Point>
    </Placemark>`
    )
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
  <Style id="nvt">
    <IconStyle><color>ffed3a7c</color></IconStyle>
  </Style>
  <Style id="schacht">
    <IconStyle><color>ff1673f9</color></IconStyle>
  </Style>

  <Folder>
    <name>Adressen</name>
${adressenPlacemarks}
  </Folder>

  <Folder>
    <name>Trasse</name>
    ${
      projekt.trassePfade && projekt.trassePfade.length > 0
        ? projekt.trassePfade
            .filter((p) => p.length >= 2)
            .map(
              (pfad, i) => `<Placemark>
      <styleUrl>#trasse</styleUrl>
      <name>Trasse Segment ${i + 1}</name>
      <description>Länge: ${segmentLaenge(pfad).toFixed(1)} m</description>
      <LineString>
        <coordinates>
          ${koordinatenZuString(pfad)}
        </coordinates>
      </LineString>
    </Placemark>`
            )
            .join('\n    ')
        : `<Placemark>
      <styleUrl>#trasse</styleUrl>
      <name>Trasse</name>
      <description>Länge: ${segmentLaenge(projekt.trasse).toFixed(1)} m</description>
      <LineString>
        <coordinates>
          ${koordinatenZuString(projekt.trasse)}
        </coordinates>
      </LineString>
    </Placemark>`
    }
  </Folder>

  <Folder>
    <name>Hausanschlüsse</name>
${hausanschlussPlacemarks}
  </Folder>
${
  nvtPlacemarks
    ? `  <Folder>
    <name>NVT</name>
${nvtPlacemarks}
  </Folder>
`
    : ''
}${
  schachtPlacemarks
    ? `  <Folder>
    <name>Schacht</name>
${schachtPlacemarks}
  </Folder>
`
    : ''
}</Document>
</kml>`

  downloadBlob(kml, `${projekt.name}.kml`, 'application/vnd.google-earth.kml+xml')
}

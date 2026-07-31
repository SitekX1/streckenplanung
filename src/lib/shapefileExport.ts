import { zip as shpZip } from '@mapbox/shp-write'
import JSZip from 'jszip'
import { Projekt } from './types'

function segmentLaenge(pts: { lat: number; lng: number }[]): number {
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const dLat = (pts[i + 1].lat - pts[i].lat) * 111_000
    const dLng = (pts[i + 1].lng - pts[i].lng) * Math.cos((pts[i].lat * Math.PI) / 180) * 111_000
    total += Math.sqrt(dLat * dLat + dLng * dLng)
  }
  return total
}

// Baut aus einem Punkt- oder Linien-FeatureCollection einen eigenen Shapefile-
// Layer (shp/shx/dbf/prj) und hängt ihn als Unterordner in den übergebenen
// JSZip ein. shp-write erzeugt pro Aufruf ein eigenes, vollständiges Zip —
// das wird hier per JSZip.loadAsync() wieder "ausgepackt" und in den
// gemeinsamen Ordner umgehängt, damit am Ende EIN Download mit allen Layern
// entsteht statt vier einzelnen Zip-Dateien.
async function layerHinzufuegen(
  outerZip: JSZip,
  ordner: string,
  geojson: GeoJSON.FeatureCollection
): Promise<void> {
  if (geojson.features.length === 0) return
  const buffer = await shpZip<'arraybuffer'>(geojson, {
    folder: ordner,
    outputType: 'arraybuffer',
    compression: 'DEFLATE',
  })
  const innerZip = await JSZip.loadAsync(buffer)
  for (const [pfad, datei] of Object.entries(innerZip.files)) {
    if (datei.dir) continue
    const inhalt = await datei.async('arraybuffer')
    // shp-write benennt die Dateien nach dem Shapefile-Geometrietyp
    // (POINT/POLYLINE/POLYGON) statt nach unserem Layer-Namen — hier auf
    // "<ordner>.<endung>" umbenennen, da pro Aufruf ohnehin nur ein
    // Geometrietyp vorkommt (jeder Layer ist bei uns rein Punkt oder Linie).
    const endung = pfad.split('.').pop()
    outerZip.file(`${ordner}/${ordner}.${endung}`, inhalt)
  }
}

export async function exportShapefile(projekt: Projekt): Promise<void> {
  const outerZip = new JSZip()

  const adressenFc: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: projekt.adressen.map((a) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
      properties: {
        strasse: a.strasse,
        hausnr: `${a.nr}${a.nr_zusatz ? ' ' + a.nr_zusatz : ''}`,
        plz: a.plz,
        ort: a.ortsname,
        ortsteil: a.ortsteil,
        haushalte: a.hh,
      },
    })),
  }

  const trassePfade = projekt.trassePfade && projekt.trassePfade.length > 0 ? projekt.trassePfade : [projekt.trasse]
  const trasseKinds = projekt.trassePfadeKinds ?? []
  const trasseFc: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: trassePfade
      .filter((pfad) => pfad.length >= 2)
      .map((pfad, i) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: pfad.map((p) => [p.lng, p.lat]) },
        properties: {
          segment: i + 1,
          laenge_m: Math.round(segmentLaenge(pfad) * 10) / 10,
          typ: trasseKinds[i] === 'track' ? 'Feldweg' : 'Strasse',
        },
      })),
  }

  const hausanschluesseFc: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: projekt.hausanschluesse.map((h) => {
      const linePts = h.wegpunkte && h.wegpunkte.length >= 2 ? h.wegpunkte : [h.trassenPunkt, h.hausKoordinate]
      return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: linePts.map((p) => [p.lng, p.lat]) },
        properties: { laenge_m: Math.round(h.laengeMeter * 10) / 10 },
      }
    }),
  }

  const nvtFc: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: (projekt.nvtStandorte ?? []).map((n, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [n.position.lng, n.position.lat] },
      properties: {
        nvt_nr: i + 1,
        kapazitaet: n.kapazitaet,
        belegung: n.belegung,
      },
    })),
  }

  await layerHinzufuegen(outerZip, 'Adressen', adressenFc)
  await layerHinzufuegen(outerZip, 'Trasse', trasseFc)
  await layerHinzufuegen(outerZip, 'Hausanschluesse', hausanschluesseFc)
  await layerHinzufuegen(outerZip, 'NVT', nvtFc)

  const blob = await outerZip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${projekt.name}_shapefile.zip`
  a.click()
  URL.revokeObjectURL(url)
}

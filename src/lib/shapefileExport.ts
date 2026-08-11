import { zip as shpZip, write as shpWriteRaw } from '@mapbox/shp-write'
import JSZip from 'jszip'
import { Projekt } from './types'
import { ermittleZuordnungen } from './nvt'

// Identischer WKT-String, den @mapbox/shp-write intern per Default für .prj
// verwendet (src/prj.js) — hier dupliziert, damit layerHinzufuegenLinien()
// (die den High-Level-Weg umgeht) exakt dieselbe Projektion schreibt wie
// layerHinzufuegen() für die Punkt-Layer.
const WGS84_PRJ =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]'

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

// Wie layerHinzufuegen(), aber für LineString-Layer über die Low-Level-API
// von shp-write statt über zip(). GRUND: shp-write's High-Level-Konvertierung
// (src/geojson.js) packt bei Linien-FeatureCollections ALLE Features in EIN
// einziges Multi-Part-Shapefile-Record statt einem Record pro Feature (Punkte
// sind davon nicht betroffen, nur Linien) — mit dem Effekt, dass z.B. in QGIS
// ein Klick auf EINEN Hausanschluss/EIN Trassensegment gleich ALLE markiert,
// weil sie technisch ein einziger Datensatz sind. Verifiziert per Testskript
// (Anzahl SHP-Records vor/nach Fix). Die Low-Level-write()-Funktion umgeht
// genau diesen einen fehlerhaften Vorverarbeitungsschritt und erzeugt korrekt
// ein Record pro Feature.
async function layerHinzufuegenLinien(
  outerZip: JSZip,
  ordner: string,
  geojson: GeoJSON.FeatureCollection
): Promise<void> {
  if (geojson.features.length === 0) return
  const geometries = geojson.features.map((f) => (f.geometry as GeoJSON.LineString).coordinates)
  const rows = geojson.features.map((f) => f.properties ?? {})

  const dateien = await new Promise<{ shp: { buffer: ArrayBuffer }; shx: { buffer: ArrayBuffer }; dbf: { buffer: ArrayBuffer } }>(
    (resolve, reject) => {
      shpWriteRaw(rows, 'POLYLINE', geometries, (err, result) => {
        if (err) reject(err)
        else resolve(result)
      })
    }
  )

  outerZip.file(`${ordner}/${ordner}.shp`, dateien.shp.buffer)
  outerZip.file(`${ordner}/${ordner}.shx`, dateien.shx.buffer)
  outerZip.file(`${ordner}/${ordner}.dbf`, dateien.dbf.buffer)
  outerZip.file(`${ordner}/${ordner}.prj`, WGS84_PRJ)
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

  const zuordnungen = ermittleZuordnungen(projekt.nvtStandorte ?? [], projekt.schachtStandorte ?? [])

  const hausanschluesseFc: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: projekt.hausanschluesse.map((h) => {
      const linePts = h.wegpunkte && h.wegpunkte.length >= 2 ? h.wegpunkte : [h.trassenPunkt, h.hausKoordinate]
      const zuordnung = zuordnungen.get(h.id)
      return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: linePts.map((p) => [p.lng, p.lat]) },
        properties: {
          laenge_m: Math.round(h.laengeMeter * 10) / 10,
          nvt_nr: zuordnung?.nvtNr ?? null,
          schacht_nr: zuordnung?.schachtNr ?? null,
        },
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

  const schachtFc: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: (projekt.schachtStandorte ?? []).map((s, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.position.lng, s.position.lat] },
      properties: {
        schacht_nr: i + 1,
        hausansch: s.hausanschlussIds.length,
      },
    })),
  }

  await layerHinzufuegen(outerZip, 'Adressen', adressenFc)
  await layerHinzufuegenLinien(outerZip, 'Trasse', trasseFc)
  await layerHinzufuegenLinien(outerZip, 'Hausanschluesse', hausanschluesseFc)
  await layerHinzufuegen(outerZip, 'NVT', nvtFc)
  await layerHinzufuegen(outerZip, 'Schacht', schachtFc)

  // Zusätzlich Hausanschlüsse nach NVT/Schacht gruppiert als eigene Layer, damit
  // man in QGIS/Tanis pro NVT/Schacht gezielt ein-/ausblenden kann statt nur
  // über die nvt_nr/schacht_nr-Spalte im Gesamt-Layer filtern zu müssen.
  const hausanschlussGruppen = new Map<string, GeoJSON.Feature[]>()
  for (const feature of hausanschluesseFc.features) {
    const nvtNr = feature.properties?.nvt_nr
    const schachtNr = feature.properties?.schacht_nr
    const ordner = nvtNr != null ? `Hausanschluesse_NVT${nvtNr}` : schachtNr != null ? `Hausanschluesse_Schacht${schachtNr}` : null
    if (!ordner) continue
    if (!hausanschlussGruppen.has(ordner)) hausanschlussGruppen.set(ordner, [])
    hausanschlussGruppen.get(ordner)!.push(feature)
  }
  for (const [ordner, features] of hausanschlussGruppen) {
    await layerHinzufuegenLinien(outerZip, ordner, { type: 'FeatureCollection', features })
  }

  const blob = await outerZip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${projekt.name}_shapefile.zip`
  a.click()
  URL.revokeObjectURL(url)
}

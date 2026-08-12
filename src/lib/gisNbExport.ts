import JSZip from 'jszip'
import { Projekt } from './types'
import { ermittleZuordnungen } from './nvt'
import { aktivesMaterialProfil, MaterialEintrag } from './materialkatalog'
import { berechneFaserbedarfProSegment, passendesKabel } from './faserdimensionierung'
import { layerHinzufuegen, layerHinzufuegenLinien, GEMEINSAMER_ORDNER, segmentLaenge } from './shapefileExport'
import { baueRohrbelegungCsv } from './rohrbelegung'

// GIS-NB-konformer Export (Breitbandförderung des Bundes, GIS-Nebenbestimmungen
// Version 5.1 vom 03.04.2023, Abschnitt 3.2 "Netzplan") — nur aktiv wenn
// projekt.bundesfoerderung true ist (siehe exportShapefile() in
// shapefileExport.ts). Ersetzt das freie Firmen-Schema durch die gesetzlich
// vorgegebenen fünf Layer mit exakten Attributnamen/Codes, entspricht dem
// Verfahrensschritt "Phase 2: Ergebnis des Vergabeverfahrens bis zum
// Baubeginn (Planung)" — das ist der Stand, den Streckenplanung produziert.
//
// Bekannte Vereinfachung (siehe materialkatalog.ts): Streckenplanung
// modelliert nur Start→NVT/Schacht→Haus, keine separate Backbone-Ebene vor
// einem HvT/PoP. Bei mehrstufigen Projekten (mehrere kaskadierte PoP) müsste
// das nachgezogen werden.

// Baut den Layer "Bauten und Netztechnik" (Punkte) — Startpunkt als
// GF-HVt/PoP (art 12), NVT als GF-Vt (art 14), Schacht als Kabelschacht
// (art 31). Liefert zusätzlich die id-Zuordnung je NVT-/Schacht-Index, damit
// der Endverbraucher-Layer (id_netze) darauf verweisen kann.
function bautenUndNetztechnikLayer(projekt: Projekt): {
  fc: GeoJSON.FeatureCollection
  nvtIdById: number[]
  schachtIdById: number[]
} {
  const features: GeoJSON.Feature[] = []
  let id = 1
  const nvtIdById: number[] = []
  const schachtIdById: number[] = []

  if (projekt.startpunkt) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [projekt.startpunkt.lng, projekt.startpunkt.lat] },
      properties: { art: 12, kollokatio: 0, art_sonst: '', zustand: 1, bezeichner: 'Startpunkt/PoP', id, id_tech: -1 },
    })
    id++
  }

  for (const nvt of projekt.nvtStandorte ?? []) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [nvt.position.lng, nvt.position.lat] },
      properties: { art: 14, kollokatio: 0, art_sonst: '', zustand: 1, bezeichner: '', id, id_tech: -1 },
    })
    nvtIdById.push(id)
    id++
  }

  for (const schacht of projekt.schachtStandorte ?? []) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [schacht.position.lng, schacht.position.lat] },
      properties: { art: 31, kollokatio: 0, art_sonst: '', zustand: 1, bezeichner: '', id, id_tech: -1 },
    })
    schachtIdById.push(id)
    id++
  }

  return { fc: { type: 'FeatureCollection', features }, nvtIdById, schachtIdById }
}

// Layer "Endverbraucher" (Punkte, aus Adressen) — id_netze verweist auf die
// id im Bauten-und-Netztechnik-Layer. Adressen ohne (noch) zugeordneten
// Hausanschluss/NVT bekommen id_netze -1 (analog zur GIS-NB-eigenen
// "-1 = keine Netztechnik verantwortlich"-Konvention bei id_tech).
function endverbraucherLayer(
  projekt: Projekt,
  nvtIdById: number[],
  schachtIdById: number[]
): GeoJSON.FeatureCollection {
  const zuordnungen = ermittleZuordnungen(projekt.nvtStandorte ?? [], projekt.schachtStandorte ?? [])
  const hausByAddressUuid = new Map(projekt.hausanschluesse.map((h) => [h.addressUuid, h]))

  const features: GeoJSON.Feature[] = projekt.adressen.map((a, i) => {
    const haus = hausByAddressUuid.get(a.uuid)
    const zuordnung = haus ? zuordnungen.get(haus.id) : undefined
    const idNetze =
      zuordnung?.nvtNr != null
        ? nvtIdById[zuordnung.nvtNr - 1]
        : zuordnung?.schachtNr != null
          ? schachtIdById[zuordnung.schachtNr - 1]
          : -1
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
      properties: { endkunde: 1, id_netze: idNetze ?? -1, id: i + 1 },
    }
  })
  return { type: 'FeatureCollection', features }
}

function trassenbauLayer(projekt: Projekt): GeoJSON.FeatureCollection {
  const trassePfade = projekt.trassePfade && projekt.trassePfade.length > 0 ? projekt.trassePfade : [projekt.trasse]
  const kinds = projekt.trassePfadeKinds ?? []
  const features: GeoJSON.Feature[] = trassePfade
    .filter((p) => p.length >= 2)
    .map((pfad, i) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: pfad.map((p) => [p.lng, p.lat]) },
      properties: {
        id: i + 1,
        trassenb: kinds[i] === 'track' ? 12 : 11, // 11 versiegelt, 12 unversiegelt
        mitverleg: 0,
      },
    }))
  return { type: 'FeatureCollection', features }
}

function materialEigenschaften(m: MaterialEintrag) {
  return {
    lr_art: m.lrArt,
    lr_sonst: m.lrArt === 99 ? m.bezeichnungFirma : '',
    lr_anzahl: m.lrAnzahl,
    anzahl: m.anzahl,
    lr_reserv: m.reserve,
  }
}

// Leerrohre: eine Linie pro Trasse-Segment (Ebene "trasse") + eine Linie pro
// Hausanschluss-Stich (Ebene "hausanschluss"), Material aus dem aktiven
// Katalog-Profil (Firmenstandard oder Bundesförderungs-Minimum, je nach
// projekt.bundesfoerderung — hier immer foerderung, da diese Funktion nur im
// Förderfall aufgerufen wird).
function leerrohreLayer(projekt: Projekt): GeoJSON.FeatureCollection {
  const profil = aktivesMaterialProfil(true)
  const trassePfade = projekt.trassePfade && projekt.trassePfade.length > 0 ? projekt.trassePfade : [projekt.trasse]
  let id = 1
  const features: GeoJSON.Feature[] = []

  for (const pfad of trassePfade) {
    if (pfad.length < 2) continue
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: pfad.map((p) => [p.lng, p.lat]) },
      properties: {
        id: id++,
        ...materialEigenschaften(profil.trasse),
        lae_lr: Math.round(segmentLaenge(pfad) * 10) / 10,
        zustand: 2, // Leerrohre: 2 = Neubau (Codes hier ANDERS als bei Verbindungen/Bauten!)
      },
    })
  }

  for (const h of projekt.hausanschluesse) {
    const linePts = h.wegpunkte && h.wegpunkte.length >= 2 ? h.wegpunkte : [h.trassenPunkt, h.hausKoordinate]
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: linePts.map((p) => [p.lng, p.lat]) },
      properties: {
        id: id++,
        ...materialEigenschaften(profil.hausanschluss),
        lae_lr: Math.round(h.laengeMeter * 10) / 10,
        zustand: 2,
      },
    })
  }

  return { type: 'FeatureCollection', features }
}

// Verbindungen: gleiche Geometrien wie die Leerrohre (Kabel läuft durch das
// Rohr), aber mit Faserzahl statt Rohr-Material. Trasse-Segmente bekommen
// die per Bottom-up-Baumaggregation berechnete kumulierte Faserzahl (siehe
// faserdimensionierung.ts), Hausanschlüsse die individuelle Faserzahl der
// jeweiligen Adresse (4 Fasern/Wohneinheit).
function verbindungenLayer(projekt: Projekt): GeoJSON.FeatureCollection {
  const trassePfade = projekt.trassePfade && projekt.trassePfade.length > 0 ? projekt.trassePfade : [projekt.trasse]
  let id = 1
  const features: GeoJSON.Feature[] = []

  const faserbedarf =
    projekt.startpunkt != null
      ? berechneFaserbedarfProSegment(
          trassePfade,
          projekt.startpunkt,
          projekt.nvtStandorte ?? [],
          projekt.schachtStandorte ?? [],
          projekt.hausanschluesse,
          projekt.adressen
        )
      : trassePfade.map(() => ({ fasernBasis: 0, fasernReserve: 0, fasernGesamt: 0 }))

  trassePfade.forEach((pfad, i) => {
    if (pfad.length < 2) return
    const bedarf = faserbedarf[i] ?? { fasernBasis: 0, fasernReserve: 0, fasernGesamt: 0 }
    const kabel = passendesKabel(bedarf.fasernGesamt)
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: pfad.map((p) => [p.lng, p.lat]) },
      properties: {
        id: id++,
        verb_art: kabel.code,
        v_a_sonst: '',
        lae_kabel: Math.round(segmentLaenge(pfad) * 10) / 10,
        anzahl_f_a: bedarf.fasernGesamt,
        f_a_reserv: bedarf.fasernReserve,
        zustand: 1, // Verbindungen: 1 = Neubau
      },
    })
  })

  const hausByUuid = new Map(projekt.adressen.map((a) => [a.uuid, a]))
  for (const h of projekt.hausanschluesse) {
    const linePts = h.wegpunkte && h.wegpunkte.length >= 2 ? h.wegpunkte : [h.trassenPunkt, h.hausKoordinate]
    const adresse = hausByUuid.get(h.addressUuid)
    const fasern = 4 * Math.max(1, adresse?.hh ?? 1)
    const kabel = passendesKabel(fasern)
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: linePts.map((p) => [p.lng, p.lat]) },
      properties: {
        id: id++,
        verb_art: kabel.code,
        v_a_sonst: '',
        lae_kabel: Math.round(h.laengeMeter * 10) / 10,
        anzahl_f_a: fasern,
        f_a_reserv: Math.ceil(fasern * 0.15),
        zustand: 1,
      },
    })
  }

  return { type: 'FeatureCollection', features }
}

export async function exportShapefileGisNb(projekt: Projekt): Promise<void> {
  const outerZip = new JSZip()

  const { fc: bautenFc, nvtIdById, schachtIdById } = bautenUndNetztechnikLayer(projekt)
  const endverbraucherFc = endverbraucherLayer(projekt, nvtIdById, schachtIdById)
  const trassenbauFc = trassenbauLayer(projekt)
  const leerrohreFc = leerrohreLayer(projekt)
  const verbindungenFc = verbindungenLayer(projekt)

  await layerHinzufuegen(outerZip, 'Bauten und Netztechnik', bautenFc)
  await layerHinzufuegen(outerZip, 'Endverbraucher', endverbraucherFc)
  await layerHinzufuegenLinien(outerZip, 'Trassenbau', trassenbauFc)
  await layerHinzufuegenLinien(outerZip, 'Leerrohre', leerrohreFc)
  await layerHinzufuegenLinien(outerZip, 'Verbindungen', verbindungenFc)

  // Rohrbelegungs-/Farbdokumentation (Materialkonzept Abschnitt 3) — "auf
  // Anfrage des Fördermittelgebers einzureichen", daher direkt mit im
  // GIS-NB-Paket statt als separater Export-Button.
  outerZip.file(`${GEMEINSAMER_ORDNER}/Rohrbelegung.csv`, '﻿' + baueRohrbelegungCsv(projekt))

  const blob = await outerZip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${projekt.name}_GIS-NB.zip`
  a.click()
  URL.revokeObjectURL(url)
}

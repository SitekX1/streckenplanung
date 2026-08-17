import { MaterialEintrag } from './materialkatalog'

export interface Address {
  uuid: string
  lat: number
  lon: number
  strasse: string
  nr: string
  nr_zusatz: string
  plz: string
  ortsname: string
  ortsteil: string
  hh: number
}

export interface LatLng {
  lat: number
  lng: number
}

// 'paved' = Straße, 'track' = Feldweg. Pro Trassen-Segment (nicht pro Adresse).
export type WegKind = 'paved' | 'track'

export interface Hausstich {
  id: string
  addressUuid: string
  trassenPunkt: LatLng
  hausKoordinate: LatLng
  laengeMeter: number
  wegpunkte?: LatLng[]
}

export interface OrtInfo {
  key: string
  name: string
  plz: string
  anzahl: number
}

// Physischer NVT-Standort (nur dev-Branch) — mehrere Einträge können dieselbe
// position teilen (mehrere Boxen am selben Schrank, wenn die Kapazität eines
// einzelnen NVT für die dortige Hausanschluss-Anzahl nicht reicht).
export interface NvtStandort {
  position: LatLng
  kapazitaet: number
  belegung: number
  // Hausstich.id der diesem Standort zugeordneten Hausanschlüsse — für die
  // Markierung auf der Karte beim Anklicken des NVT.
  hausanschlussIds: string[]
}

// Schacht = manuell gesetzter Kabelschacht/Übergabepunkt, z.B. als Zwischen-
// punkt bei zu langen Strecken zwischen Dörfern, oder um einzelne (Aussiedler-)
// Höfe direkt anzubinden ohne eigenen NVT. Anders als NvtStandort ohne
// Kapazitätsgrenze — reiner Standort mit optional zugeordneten Hausanschlüssen.
export interface SchachtStandort {
  position: LatLng
  hausanschlussIds: string[]
}

// Manuell erstellte Backbone-Verbindung zwischen zwei Verteilern (NVT/Schacht/
// Startpunkt), z.B. eine nachträgliche Anbindung eines abseits liegenden
// Aussiedlerhof-Schachts (2026-08-13, Alex: "muss man dann alles auswählen
// können, was hinterlegt wurde" — 4x20, 2x20, 7x14, ...). "von"/"nach" sind
// die Standort-Positionen zum Erstellzeitpunkt, nicht Array-Indizes — bleibt
// dadurch stabil, auch wenn die Trasse später neu segmentiert wird (siehe
// ermittleUeberschriebenesMaterialProSegment in faserdimensionierung.ts, das
// die betroffenen Segmente jedes Mal frisch aus der Geometrie ableitet statt
// gespeicherte Indizes zu vertrauen).
export interface BackboneVerbindung {
  von: LatLng
  nach: LatLng
  material: MaterialEintrag
}

// Manuelle Material-Übersteuerung für EIN einzelnes Trasse-Segment
// (2026-08-21, Alex: "im Nachhinein kann ich aber keinen einzigen Verbund
// bearbeiten") — überschreibt die automatisch (nach Hausanschluss-Bedarf)
// gewählte Kundenanschluss-Sammelverband-Stufe für dieses Segment fest.
// "von"/"nach" sind die Endpunkt-Positionen des Segments zum Erstellzeitpunkt
// (nicht der Array-Index) — dasselbe Stabilitätsprinzip wie bei
// BackboneVerbindung, da segmentiereAnKreuzungen() die Trasse jederzeit neu
// aufteilen kann. Ein längerer Verband (mehrere Trasse-Segmente) bekommt
// entsprechend mehrere Einträge, einen je Segment — siehe
// ermittleMaterialUebersteuerungProSegment in faserdimensionierung.ts.
export interface MaterialUebersteuerung {
  von: LatLng
  nach: LatLng
  material: MaterialEintrag
}

export interface Projekt {
  name: string
  erstelltAm: string
  adressen: Address[]
  startpunkt: LatLng | null
  trasse: LatLng[]
  trassePfade?: LatLng[][]
  hausanschluesse: Hausstich[]
  trassenLaengeMeter: number
  hausanschlussLaengeMeter: number
  // Straße/Feldweg-Klassifizierung parallel zu trassePfade (gleicher Index =
  // gleiches Segment). Fehlt bei älteren Projekten → dann überall 'paved'.
  trassePfadeKinds?: WegKind[]
  // NVT-Feature (nur dev-Branch)
  nvtStandorte?: NvtStandort[]
  aussiedlerhofUuids?: string[]
  schachtStandorte?: SchachtStandort[]
  // Manuell erstellte Backbone-Verbindungen (siehe BackboneVerbindung oben) —
  // fehlt bei älteren Projekten, dann einfach keine.
  backboneVerbindungen?: BackboneVerbindung[]
  // Manuelle Material-Übersteuerungen einzelner Segmente (siehe
  // MaterialUebersteuerung oben) — fehlt bei älteren Projekten, dann einfach
  // keine (alles bleibt automatisch berechnet wie bisher).
  materialUebersteuerungen?: MaterialUebersteuerung[]
  // Welche Orte-Filter beim Speichern aktiv waren (Sidebar-Auswahl) — fehlt
  // bei älteren Projekten, dann sind beim Laden wie bisher alle Orte aktiv.
  aktiveOrteKeys?: string[]
  // Bundesförderung (Breitbandförderung des Bundes): bestimmt, ob Export
  // (KML/Shapefile) und Materialzuweisung nach dem gesetzlich verbindlichen
  // GIS-NB-Schema + Materialkonzept-Mindestvorgaben laufen, oder nach dem
  // freien Firmenstandard. Fehlt bei älteren Projekten → false (bisheriges
  // Verhalten/Export bleibt unverändert).
  bundesfoerderung?: boolean
}

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
}

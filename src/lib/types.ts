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
}

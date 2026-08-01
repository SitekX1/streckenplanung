// Firmenlogo + -adresse für den Kalkulations-PDF-Export — geräteweit per
// localStorage persistent (gleiches Muster wie die Kalkulations-Preise in
// KalkulationModal.tsx), NICHT Teil des einzelnen Projekts, da sich die
// Firmendaten projektübergreifend so gut wie nie ändern.
export interface Firmendaten {
  // Logo als Data-URL, bereits beim Upload auf eine handliche Pixelgröße
  // herunterskaliert (siehe EinstellungenModal) — sonst würde ein rohes
  // Handyfoto sowohl das localStorage-Kontingent als auch die PDF sprengen.
  logoDataUrl: string | null
  logoBreite: number
  logoHoehe: number
  firmenname: string
  adresse: string
}

const STORAGE_KEY = 'streckenplanung-firmendaten'

const DEFAULT_FIRMENDATEN: Firmendaten = {
  logoDataUrl: null,
  logoBreite: 0,
  logoHoehe: 0,
  firmenname: '',
  adresse: '',
}

export function ladeFirmendaten(): Firmendaten {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_FIRMENDATEN
    return { ...DEFAULT_FIRMENDATEN, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_FIRMENDATEN
  }
}

export function speichereFirmendaten(daten: Firmendaten): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(daten))
  } catch {
    // z.B. Kontingent voll — Firmendaten sind nicht kritisch, einfach ignorieren
  }
}

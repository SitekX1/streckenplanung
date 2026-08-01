'use client'

import { useEffect, useRef, useState } from 'react'
import { Firmendaten, ladeFirmendaten, speichereFirmendaten } from '../lib/firmendaten'

interface EinstellungenModalProps {
  adressFarbe: string
  trasseFarbe: string
  hausanschlussfarbe: string
  feldwegFarbe: string
  onAdressFarbeAendern: (farbe: string) => void
  onTrasseFarbeAendern: (farbe: string) => void
  onHausanschlussFarbeAendern: (farbe: string) => void
  onFeldwegFarbeAendern: (farbe: string) => void
  onClose: () => void
}

// Verkleinert ein hochgeladenes Logo auf eine PDF-taugliche Pixelgröße, bevor
// es als Data-URL abgelegt wird — ein rohes Handyfoto würde sonst sowohl das
// localStorage-Kontingent als auch die spätere PDF unnötig aufblähen.
function verkleinereLogo(file: File): Promise<{ dataUrl: string; breite: number; hoehe: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const MAX_PX = 300
        const skala = Math.min(1, MAX_PX / Math.max(img.width, img.height))
        const breite = Math.max(1, Math.round(img.width * skala))
        const hoehe = Math.max(1, Math.round(img.height * skala))
        const canvas = document.createElement('canvas')
        canvas.width = breite
        canvas.height = hoehe
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('Canvas nicht verfügbar')); return }
        ctx.drawImage(img, 0, 0, breite, hoehe)
        resolve({ dataUrl: canvas.toDataURL('image/png'), breite, hoehe })
      }
      img.onerror = () => reject(new Error('Bild konnte nicht geladen werden'))
      img.src = reader.result as string
    }
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'))
    reader.readAsDataURL(file)
  })
}

export default function EinstellungenModal({
  adressFarbe, trasseFarbe, hausanschlussfarbe, feldwegFarbe,
  onAdressFarbeAendern, onTrasseFarbeAendern, onHausanschlussFarbeAendern, onFeldwegFarbeAendern,
  onClose,
}: EinstellungenModalProps) {
  // Geräteweit persistent per localStorage, unabhängig vom einzelnen Projekt
  // (gleiches Muster wie die Kalkulations-Preise in KalkulationModal.tsx).
  const [firmendaten, setFirmendaten] = useState<Firmendaten>(ladeFirmendaten)
  const logoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    speichereFirmendaten(firmendaten)
  }, [firmendaten])

  const handleLogoDatei = async (file: File) => {
    try {
      const { dataUrl, breite, hoehe } = await verkleinereLogo(file)
      setFirmendaten((f) => ({ ...f, logoDataUrl: dataUrl, logoBreite: breite, logoHoehe: hoehe }))
    } catch {
      // Datei ungültig/kein Bild — einfach ignorieren, Logo bleibt unverändert
    }
  }

  return (
    <div className="fixed inset-0 z-1000 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-lg shadow-lg p-4 flex flex-col gap-4 overflow-y-auto"
        style={{ backgroundColor: '#1a1a1a', border: '1px solid #374151', width: 340, maxHeight: '85vh' }}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-white">⚙️ Einstellungen</span>
          <button onClick={onClose} className="text-xs px-2 py-1 rounded" style={{ color: '#9ca3af' }}>✕</button>
        </div>

        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Firma (für Kalkulations-PDF)</p>
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-3">
              {firmendaten.logoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={firmendaten.logoDataUrl} alt="Firmenlogo" className="rounded"
                  style={{ maxWidth: 64, maxHeight: 40, backgroundColor: '#fff', padding: 2 }} />
              ) : (
                <div className="flex items-center justify-center rounded text-xs text-gray-600"
                  style={{ width: 64, height: 40, border: '1px dashed #374151' }}>
                  kein Logo
                </div>
              )}
              <div className="flex flex-col gap-1">
                <button onClick={() => logoInputRef.current?.click()}
                  className="text-xs px-2.5 py-1.5 rounded"
                  style={{ backgroundColor: '#262b36', color: '#93c5fd' }}>
                  📷 Logo wählen
                </button>
                {firmendaten.logoDataUrl && (
                  <button onClick={() => setFirmendaten((f) => ({ ...f, logoDataUrl: null, logoBreite: 0, logoHoehe: 0 }))}
                    className="text-xs px-2.5 py-1.5 rounded" style={{ color: '#f87171' }}>
                    Logo entfernen
                  </button>
                )}
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleLogoDatei(file)
                  e.target.value = ''
                }}
              />
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-400">Firmenname</span>
              <input
                type="text"
                value={firmendaten.firmenname}
                onChange={(e) => setFirmendaten((f) => ({ ...f, firmenname: e.target.value }))}
                className="px-2.5 py-1.5 rounded text-sm outline-none"
                style={{ backgroundColor: '#111827', border: '1px solid #374151', color: '#f9fafb' }}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-400">Adresse</span>
              <textarea
                value={firmendaten.adresse}
                onChange={(e) => setFirmendaten((f) => ({ ...f, adresse: e.target.value }))}
                rows={3}
                placeholder={'Straße Hausnr.\nPLZ Ort'}
                className="px-2.5 py-1.5 rounded text-sm outline-none resize-none"
                style={{ backgroundColor: '#111827', border: '1px solid #374151', color: '#f9fafb' }}
              />
            </label>
            <p className="text-xs text-gray-600">Wird auf jedem Kalkulations-PDF-Export mit ausgegeben, geräteweit gespeichert.</p>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Darstellung</p>
          <div className="flex flex-col gap-2.5">
            {[
              { label: 'Adressen', value: adressFarbe, onChange: onAdressFarbeAendern },
              { label: 'Trasse', value: trasseFarbe, onChange: onTrasseFarbeAendern },
              { label: 'Feldweg-Anteil', value: feldwegFarbe, onChange: onFeldwegFarbeAendern },
              { label: 'Hausanschlüsse', value: hausanschlussfarbe, onChange: onHausanschlussFarbeAendern },
            ].map(({ label, value, onChange }) => (
              <div key={label} className="flex items-center justify-between px-1">
                <span className="text-xs text-gray-400">{label}</span>
                <input
                  type="color"
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  className="w-8 h-6 rounded cursor-pointer border-0 p-0"
                  style={{ background: 'transparent' }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

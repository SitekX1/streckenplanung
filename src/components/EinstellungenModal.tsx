'use client'

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

export default function EinstellungenModal({
  adressFarbe, trasseFarbe, hausanschlussfarbe, feldwegFarbe,
  onAdressFarbeAendern, onTrasseFarbeAendern, onHausanschlussFarbeAendern, onFeldwegFarbeAendern,
  onClose,
}: EinstellungenModalProps) {
  return (
    <div className="fixed inset-0 z-1000 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-lg shadow-lg p-4 flex flex-col gap-3"
        style={{ backgroundColor: '#1a1a1a', border: '1px solid #374151', width: 320 }}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-white">⚙️ Einstellungen</span>
          <button onClick={onClose} className="text-xs px-2 py-1 rounded" style={{ color: '#9ca3af' }}>✕</button>
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

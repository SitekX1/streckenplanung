'use client'

interface BestaetigungsModalProps {
  text: string
  onBestaetigen: () => void
  onAbbrechen?: () => void
}

export default function BestaetigungsModal({ text, onBestaetigen, onAbbrechen }: BestaetigungsModalProps) {
  return (
    <div className="fixed inset-0 z-1000 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <div className="rounded-2xl shadow-2xl flex flex-col gap-4 p-5"
        style={{ backgroundColor: '#14171d', border: '1px solid #2a2f3a', width: 380 }}>
        <p className="text-sm text-gray-200 whitespace-pre-line">{text}</p>
        <div className="flex gap-2 justify-end">
          {onAbbrechen && (
            <button onClick={onAbbrechen}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:brightness-125"
              style={{ backgroundColor: '#1f2430', color: '#d1d5db', border: '1px solid #374151' }}>
              Abbrechen
            </button>
          )}
          <button onClick={onBestaetigen}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors">
            {onAbbrechen ? 'Trotzdem fortfahren' : 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}

'use client'

interface BestaetigungsModalProps {
  text: string
  onBestaetigen: () => void
  onAbbrechen?: () => void
}

export default function BestaetigungsModal({ text, onBestaetigen, onAbbrechen }: BestaetigungsModalProps) {
  return (
    <div className="fixed inset-0 z-1000 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(6,7,10,0.7)' }}>
      <div className="shadow-2xl flex flex-col gap-4 p-5"
        style={{ backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xl)', width: 380 }}>
        <p className="text-sm whitespace-pre-line" style={{ color: 'var(--text-primary)' }}>{text}</p>
        <div className="flex gap-2 justify-end">
          {onAbbrechen && (
            <button onClick={onAbbrechen}
              className="px-4 py-2 text-sm font-medium transition-colors hover:brightness-125"
              style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
              Abbrechen
            </button>
          )}
          <button onClick={onBestaetigen}
            className="px-4 py-2 text-sm font-medium text-white transition-colors hover:brightness-110"
            style={{ backgroundColor: 'var(--accent-blue)', borderRadius: 'var(--radius-md)' }}>
            {onAbbrechen ? 'Trotzdem fortfahren' : 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}

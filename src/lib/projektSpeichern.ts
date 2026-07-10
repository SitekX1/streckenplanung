import { Projekt } from './types'

function isValidProjekt(obj: unknown): obj is Projekt {
  if (!obj || typeof obj !== 'object') return false
  const p = obj as Record<string, unknown>
  return (
    typeof p.name === 'string' &&
    Array.isArray(p.adressen) &&
    Array.isArray(p.trasse) &&
    Array.isArray(p.hausanschluesse) &&
    (p.startpunkt === null || typeof p.startpunkt === 'object')
  )
}

function downloadBlob(inhalt: string, dateiname: string): void {
  const blob = new Blob([inhalt], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = dateiname
  a.click()
  URL.revokeObjectURL(url)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any

export async function exportProjekt(projekt: Projekt): Promise<void> {
  const json = JSON.stringify(projekt, null, 2)

  const picker = (window as unknown as Record<string, AnyFn>)['showSaveFilePicker'] as AnyFn | undefined
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: `${projekt.name}.json`,
        types: [{ description: 'JSON Projektdatei', accept: { 'application/json': ['.json'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(json)
      await writable.close()
      return
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      // Fallback auf Download
    }
  }

  downloadBlob(json, `${projekt.name}.json`)
}

export function importProjekt(file: File): Promise<Projekt> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const parsed: unknown = JSON.parse(e.target?.result as string)
        if (!isValidProjekt(parsed)) throw new Error('Schema ungültig')
        resolve(parsed)
      } catch {
        reject(new Error('Ungültige Projektdatei'))
      }
    }
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'))
    reader.readAsText(file)
  })
}

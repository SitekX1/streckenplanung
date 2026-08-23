import { farbeFuerRohrNr as dinFarbeFuerRohrNr } from './rohrbelegung'

// Auswählbares Rohr-Farbschema fürs Trassenknoten-Panel (2026-08-21, Alex:
// "der Gabo-Farbcode darf aber nicht allgemein aktiv sein, sondern in
// Einstellungen auswählbar — andere Firmen haben vielleicht andere
// Farben") — bewusst getrennt von der DIN-Tabelle in rohrbelegung.ts, die
// für die Materialkonzept-Pflichtdokumentation (Hausanschluss-CSV)
// unverändert bleibt. Auswahl liegt in Firmendaten (siehe firmendaten.ts),
// geräteweit/firmenweit, nicht Teil des Projekts.
export type RohrFarbschema = 'gabocom' | 'din'

// Aus Alex' zweitem (korrigiertem) gabocom-Farbcode-Diagramm abgelesen
// (2026-08-21 — das erste Diagramm war laut Alex nicht die richtige
// Referenz, DIESES ist die korrekte Quelle). Anders als bei DIN trägt hier
// jedes Röhrchen ZWEI Farben (linker/rechter Farbkeil am Ring), kein
// einfacher 12-Grundfarben-Zyklus. Positionsweise so genau wie beim
// Ablesen eines Bild-Diagramms möglich übertragen — bei sehr ähnlichen
// Farbtönen (z.B. Violett/Blau, Braun/Rot) besteht ein kleines Restrisiko
// einer Verwechslung. Vor dem ersten echten Bau-Einsatz kurz gegen das
// Original-Diagramm/Datenblatt querlesen, dann diese Liste bei Bedarf an
// EINER Stelle korrigieren.
const GABO_7X_ROHRFARBEN: string[] = [
  'gelb/rot',    // 1
  'grün/rot',    // 2
  'blau/rot',    // 3
  'violett/rot', // 4
  'rot/grau',    // 5
  'blau/gelb',   // 6
  'gelb/violett',// 7
  'grau/gelb',   // 8
  'blau/grün',   // 9
  'violett/grün',// 10
  'grün/grau',   // 11
  'blau/braun',  // 12
  'blau/violett',// 13
  'grau/braun',  // 14
  'braun/grün',  // 15
  'braun/gelb',  // 16
  'braun/rot',   // 17
  'rot/schwarz', // 18
  'gelb/schwarz',// 19
  'grün/schwarz',// 20
  'blau/schwarz',// 21
  'violett/schwarz', // 22
  'grau/schwarz',// 23
  'braun/schwarz', // 24
]

function gabocomFarbeFuerRohrNr(gesamtRohrAnzahlImVerband: number, rohrNr: number): string {
  if (gesamtRohrAnzahlImVerband <= 24) return GABO_7X_ROHRFARBEN[(rohrNr - 1) % GABO_7X_ROHRFARBEN.length] ?? '—'
  // Größere Backbone-Rohrtypen (10/6, 12/2,0, 14/2,0, 16/2,0, 20/2,5 — für
  // unsere Backbone-Stufen 4x20/7x14) — einfarbige Kennzeichnung laut
  // gabocom-Verlegeanleitung, aber NICHT durch ein konkretes Diagramm
  // bestätigt (nur Web-Zusammenfassung). Bitte bei Bedarf mit echtem
  // Datenblatt gegenchecken.
  const GABO_BACKBONE_SEQUENZ = ['schwarz', 'braun', 'rot', 'orange', 'gelb', 'grün', 'blau']
  return GABO_BACKBONE_SEQUENZ[(rohrNr - 1) % GABO_BACKBONE_SEQUENZ.length] ?? '—'
}

export function rohrFarbeFuerRohrNr(schema: RohrFarbschema, gesamtRohrAnzahlImVerband: number, rohrNr: number): string {
  return schema === 'din' ? dinFarbeFuerRohrNr(rohrNr) : gabocomFarbeFuerRohrNr(gesamtRohrAnzahlImVerband, rohrNr)
}

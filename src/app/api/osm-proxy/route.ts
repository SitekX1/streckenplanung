import { NextRequest, NextResponse } from 'next/server'

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

export async function POST(req: NextRequest) {
  const body = await req.text()

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(55_000),
      })
      if (!res.ok) continue
      const data = await res.text()
      return new NextResponse(data, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch {
      // nächsten Mirror versuchen
    }
  }

  return NextResponse.json({ error: 'Alle Overpass-Server nicht erreichbar' }, { status: 502 })
}

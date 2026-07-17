import { NextRequest, NextResponse } from 'next/server'

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

// Vercel Hobby erlaubt 60s — reicht wenn der schnellste Server < 50s braucht
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const body = await req.text()

  try {
    // Alle Server gleichzeitig anfragen — erster der antwortet gewinnt
    const data = await Promise.any(
      OVERPASS_ENDPOINTS.map(async (endpoint) => {
        const res = await fetch(endpoint, {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: AbortSignal.timeout(50_000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status} von ${endpoint}`)
        return res.text()
      })
    )

    return new NextResponse(data, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return NextResponse.json(
      { error: 'Alle Overpass-Server nicht erreichbar — bitte kurz warten und nochmal versuchen' },
      { status: 502 }
    )
  }
}

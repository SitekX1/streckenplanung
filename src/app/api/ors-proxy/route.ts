import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  const apiKey = process.env.ORS_API_KEY?.trim()
  if (!apiKey) {
    return NextResponse.json({ error: 'ORS_API_KEY nicht konfiguriert' }, { status: 500 })
  }

  const body = await req.text()

  try {
    const res = await fetch(
      'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
      {
        method: 'POST',
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json, application/geo+json',
        },
        body,
        signal: AbortSignal.timeout(25_000),
      }
    )

    const text = await res.text()

    if (!res.ok) {
      return NextResponse.json(
        { error: `ORS Fehler ${res.status}: ${text.slice(0, 200)}` },
        { status: res.status }
      )
    }

    return new NextResponse(text, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return NextResponse.json(
      { error: `ORS nicht erreichbar: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    )
  }
}

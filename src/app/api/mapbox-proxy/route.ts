import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

interface Body {
  coordinates: [number, number][]
}

export async function POST(req: NextRequest) {
  const token = process.env.MAPBOX_ACCESS_TOKEN?.trim()
  if (!token) {
    return NextResponse.json({ error: 'MAPBOX_ACCESS_TOKEN nicht konfiguriert' }, { status: 500 })
  }

  const { coordinates } = (await req.json()) as Body
  if (!coordinates || coordinates.length < 2) {
    return NextResponse.json({ error: 'Mindestens 2 Koordinaten nötig' }, { status: 400 })
  }

  const coordString = coordinates.map(([lng, lat]) => `${lng},${lat}`).join(';')
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordString}?geometries=geojson&overview=full&access_token=${token}`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(25_000) })
    const text = await res.text()

    if (!res.ok) {
      return NextResponse.json(
        { error: `Mapbox Fehler ${res.status}: ${text.slice(0, 200)}` },
        { status: res.status }
      )
    }

    return new NextResponse(text, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return NextResponse.json(
      { error: `Mapbox nicht erreichbar: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    )
  }
}

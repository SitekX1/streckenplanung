import { LatLng } from './types'

const EARTH_RADIUS_M = 6_371_000

export function haversineDistanz(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const h =
    sinDLat * sinDLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinDLng *
      sinDLng
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

export function nearestNeighborTSP(startpunkt: LatLng, punkte: LatLng[]): LatLng[] {
  if (punkte.length === 0) return [startpunkt]

  const remaining = [...punkte]
  const route: LatLng[] = [startpunkt]
  let current = startpunkt

  while (remaining.length > 0) {
    let nearestIdx = 0
    let nearestDist = haversineDistanz(current, remaining[0])

    for (let i = 1; i < remaining.length; i++) {
      const dist = haversineDistanz(current, remaining[i])
      if (dist < nearestDist) {
        nearestDist = dist
        nearestIdx = i
      }
    }

    current = remaining[nearestIdx]
    route.push(current)
    remaining.splice(nearestIdx, 1)
  }

  return route
}

import { distanceBetween, type NavigationRoute, type Point } from './navigation'

export type RoadPosition = Point & { along: number; distance: number; bearing: number }

export function roadLengths(coordinates: [number, number][]) {
  const lengths = [0]
  for (let index = 1; index < coordinates.length; index += 1) {
    lengths.push(lengths[index - 1] + distanceBetween(
      { lon: coordinates[index - 1][0], lat: coordinates[index - 1][1] },
      { lon: coordinates[index][0], lat: coordinates[index][1] },
    ))
  }
  return lengths
}

export function sampleRoad(coordinates: [number, number][], lengths: number[], along: number): Point {
  const found = lengths.findIndex((length) => length >= along)
  const segment = found < 0 ? coordinates.length - 1 : Math.max(1, found)
  const previous = coordinates[segment - 1]
  const current = coordinates[segment]
  const length = lengths[segment] - lengths[segment - 1]
  const progress = length ? Math.max(0, Math.min(1, (along - lengths[segment - 1]) / length)) : 0
  return { lon: previous[0] + (current[0] - previous[0]) * progress, lat: previous[1] + (current[1] - previous[1]) * progress }
}

export function projectToRoad(point: Point, coordinates: [number, number][], lengths: number[]): RoadPosition {
  const longitudeScale = 111_320 * Math.cos(point.lat * Math.PI / 180)
  let closest = { ...point, along: 0, distance: Infinity, bearing: 0 }
  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = coordinates[index - 1]
    const current = coordinates[index]
    const startX = (previous[0] - point.lon) * longitudeScale
    const startY = (previous[1] - point.lat) * 111_320
    const deltaX = (current[0] - previous[0]) * longitudeScale
    const deltaY = (current[1] - previous[1]) * 111_320
    const squared = deltaX ** 2 + deltaY ** 2
    if (!squared) continue
    const progress = Math.max(0, Math.min(1, -(startX * deltaX + startY * deltaY) / squared))
    const distance = Math.hypot(startX + progress * deltaX, startY + progress * deltaY)
    if (distance < closest.distance) closest = {
      lon: previous[0] + (current[0] - previous[0]) * progress,
      lat: previous[1] + (current[1] - previous[1]) * progress,
      along: lengths[index - 1] + progress * (lengths[index] - lengths[index - 1]),
      distance,
      bearing: (Math.atan2(deltaX, deltaY) * 180 / Math.PI + 360) % 360,
    }
  }
  return closest
}

export function getDrivingCamera(route: NavigationRoute, location: Point, stepIndex: number, speed: number | null, heading: number | null) {
  const approach = route.steps[Math.max(0, stepIndex - 1)]
  const next = route.steps[stepIndex]
  const coordinates = [...(approach?.geometry.coordinates ?? []), ...(approach === next ? [] : next?.geometry.coordinates ?? [])]
  if (coordinates.length < 2) return null
  const lengths = roadLengths(coordinates)
  const position = projectToRoad(location, coordinates, lengths)
  const velocity = speed !== null && Number.isFinite(speed) ? Math.max(0, Math.min(55, speed)) : 0
  const bearing = heading !== null && Number.isFinite(heading) ? heading : position.distance <= 40 ? position.bearing : null
  if (bearing === null) return null
  const lookAhead = Math.min(35, 12 + velocity * 0.65)
  const center = position.distance <= 40
    ? sampleRoad(coordinates, lengths, position.along + lookAhead)
    : {
      lat: location.lat + Math.cos(bearing * Math.PI / 180) * lookAhead / 111_320,
      lon: location.lon + Math.sin(bearing * Math.PI / 180) * lookAhead / (111_320 * Math.cos(location.lat * Math.PI / 180)),
    }
  return { center, bearing, zoom: Math.max(17.5, 19 - velocity * 0.04) }
}

export function gpsAccuracyRing(location: Point, accuracy: number | null): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  if (accuracy === null || !Number.isFinite(accuracy) || accuracy <= 0) return { type: 'FeatureCollection', features: [] }
  const coordinates = Array.from({ length: 65 }, (_, index) => {
    const angle = index / 64 * Math.PI * 2
    return [location.lon + Math.cos(angle) * accuracy / (111_320 * Math.cos(location.lat * Math.PI / 180)), location.lat + Math.sin(angle) * accuracy / 111_320]
  })
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coordinates] } }] }
}

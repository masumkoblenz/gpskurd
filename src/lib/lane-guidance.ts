import { distanceBetween, type NavigationRoute, type Point, type RouteLane } from './navigation'

type Coordinate = [number, number]
type LaneProperties = { kind: 'surface' | 'marking' | 'arrow'; recommended: boolean }
export type LaneMapData = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.LineString, LaneProperties>
export type LaneGuidance = { lanes: RouteLane[]; distance: number; mapData: LaneMapData }

export const laneArrowPaths: Record<string, [number, number][][]> = {
  straight: [[[0, 0], [0, 10]], [[-2, 8], [0, 10], [2, 8]]],
  left: [[[0, 0], [0, 6], [-5, 6]], [[-3, 8], [-5, 6], [-3, 4]]],
  right: [[[0, 0], [0, 6], [5, 6]], [[3, 8], [5, 6], [3, 4]]],
  'slight left': [[[0, 0], [0, 4], [-4, 9]], [[-4, 6], [-4, 9], [-1, 9]]],
  'slight right': [[[0, 0], [0, 4], [4, 9]], [[1, 9], [4, 9], [4, 6]]],
  'sharp left': [[[0, 0], [0, 7], [-4, 3]], [[-4, 6], [-4, 3], [-1, 3]]],
  'sharp right': [[[0, 0], [0, 7], [4, 3]], [[1, 3], [4, 3], [4, 6]]],
  uturn: [[[0, 0], [0, 8], [-1, 10], [-3, 10], [-4, 8], [-4, 4]], [[-6, 6], [-4, 4], [-2, 6]]],
}

function project(point: Point, coordinates: Coordinate[], lengths: number[]) {
  const longitudeScale = 111_320 * Math.cos(point.lat * Math.PI / 180)
  let closest = { along: 0, distance: Infinity }
  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = coordinates[index - 1]
    const current = coordinates[index]
    const startX = (previous[0] - point.lon) * longitudeScale
    const startY = (previous[1] - point.lat) * 111_320
    const deltaX = (current[0] - previous[0]) * longitudeScale
    const deltaY = (current[1] - previous[1]) * 111_320
    const squared = deltaX ** 2 + deltaY ** 2
    const progress = squared ? Math.max(0, Math.min(1, -(startX * deltaX + startY * deltaY) / squared)) : 0
    const distance = Math.hypot(startX + progress * deltaX, startY + progress * deltaY)
    if (distance < closest.distance) closest = {
      along: lengths[index - 1] + progress * (lengths[index] - lengths[index - 1]),
      distance,
    }
  }
  return closest
}

function sample(coordinates: Coordinate[], lengths: number[], along: number) {
  const segment = Math.max(1, lengths.findIndex((length) => length >= along))
  const previous = coordinates[segment - 1]
  const current = coordinates[segment]
  const length = lengths[segment] - lengths[segment - 1]
  const progress = length ? Math.max(0, Math.min(1, (along - lengths[segment - 1]) / length)) : 0
  const lat = previous[1] + (current[1] - previous[1]) * progress
  const lon = previous[0] + (current[0] - previous[0]) * progress
  const east = (current[0] - previous[0]) * Math.cos(lat * Math.PI / 180)
  const north = current[1] - previous[1]
  const magnitude = Math.hypot(east, north) || 1
  return { lat, lon, east: east / magnitude, north: north / magnitude }
}

function offset(position: ReturnType<typeof sample>, right: number, forward = 0): Coordinate {
  return [
    position.lon + (position.north * right + position.east * forward) / (111_320 * Math.cos(position.lat * Math.PI / 180)),
    position.lat + (-position.east * right + position.north * forward) / 111_320,
  ]
}

export function getLaneGuidance(route: NavigationRoute | null, location: Point | null, stepIndex: number): LaneGuidance | null {
  if (!route || route.mode !== 'driving' || !location) return null
  const approach = route.steps[Math.max(0, stepIndex - 1)]
  const next = route.steps[stepIndex]
  if (!approach || !next) return null
  const coordinates = [...approach.geometry.coordinates, ...next.geometry.coordinates]
    .filter((coordinate, index, all) => index === 0 || coordinate[0] !== all[index - 1][0] || coordinate[1] !== all[index - 1][1])
  if (coordinates.length < 2) return null
  const lengths = [0]
  for (let index = 1; index < coordinates.length; index += 1) {
    lengths.push(lengths[index - 1] + distanceBetween(
      { lon: coordinates[index - 1][0], lat: coordinates[index - 1][1] },
      { lon: coordinates[index][0], lat: coordinates[index][1] },
    ))
  }
  const current = project(location, coordinates, lengths)
  if (current.distance > 50) return null
  const candidates = [...(approach.intersections ?? []), ...(next.intersections ?? []).slice(0, 1)]
    .flatMap((intersection) => {
      const lanes = intersection.lanes
      if (!lanes?.length || lanes.length > 16 || !lanes.every((lane) =>
        lane && typeof lane.valid === 'boolean' && Array.isArray(lane.indications) && lane.indications.every((direction) => typeof direction === 'string'),
      )) return []
      const target = project({ lon: intersection.location[0], lat: intersection.location[1] }, coordinates, lengths)
      const distance = target.along - current.along
      return target.distance <= 10 && distance > 0 && distance <= 300 && target.along >= 12
        ? [{ lanes, distance, along: target.along }] : []
    }).sort((first, second) => first.distance - second.distance)
  const guidance = candidates[0]
  if (!guidance) return null

  const mapData: LaneMapData = { type: 'FeatureCollection', features: [] }
  const end = guidance.along - 3
  const start = Math.max(0, end - 60)
  const samples = Array.from({ length: Math.ceil((end - start) / 3) + 1 }, (_, index) =>
    sample(coordinates, lengths, Math.min(end, start + index * 3)),
  )
  const halfWidth = guidance.lanes.length * 3.4 / 2
  guidance.lanes.forEach((lane, index) => {
    const left = index * 3.4 - halfWidth
    const right = left + 3.4
    const outline = [...samples.map((position) => offset(position, left)), ...[...samples].reverse().map((position) => offset(position, right))]
    outline.push(outline[0])
    mapData.features.push({ type: 'Feature', properties: { kind: 'surface', recommended: lane.valid }, geometry: { type: 'Polygon', coordinates: [outline] } })
    for (const arrowAlong of [end - 10, end - 32]) {
      if (arrowAlong < start + 2) continue
      const position = sample(coordinates, lengths, arrowAlong)
      for (const indication of lane.indications) {
        for (const path of Object.hasOwn(laneArrowPaths, indication) ? laneArrowPaths[indication] : []) {
          mapData.features.push({ type: 'Feature', properties: { kind: 'arrow', recommended: lane.valid }, geometry: {
            type: 'LineString', coordinates: path.map(([horizontal, forward]) => offset(position, left + 1.7 + horizontal * 0.22, forward * 0.65)),
          } })
        }
      }
    }
  })
  for (let index = 0; index <= guidance.lanes.length; index += 1) {
    const lateral = index * 3.4 - halfWidth
    const isEdge = index === 0 || index === guidance.lanes.length
    for (let along = start; along < end; along += isEdge ? end - start : 7) {
      const lineEnd = Math.min(end, along + (isEdge ? end - start : 4))
      const points = [sample(coordinates, lengths, along)]
      for (let middle = along + 2; middle < lineEnd; middle += 2) points.push(sample(coordinates, lengths, middle))
      points.push(sample(coordinates, lengths, lineEnd))
      mapData.features.push({ type: 'Feature', properties: { kind: 'marking', recommended: false }, geometry: {
        type: 'LineString', coordinates: points.map((position) => offset(position, lateral)),
      } })
    }
  }
  return { lanes: guidance.lanes, distance: guidance.distance, mapData }
}

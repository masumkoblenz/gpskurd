import { type NavigationRoute, type Point, type RouteLane } from './navigation'
import { projectToRoad, roadLengths } from './driving-perspective'

export type LaneGuidance = { lanes: RouteLane[]; distance: number; location: Point }

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

export function getLaneGuidance(route: NavigationRoute | null, location: Point | null, stepIndex: number): LaneGuidance | null {
  if (!route || route.mode !== 'driving' || !location) return null
  const approach = route.steps[Math.max(0, stepIndex - 1)]
  const next = route.steps[stepIndex]
  if (!approach || !next) return null
  const coordinates = [...approach.geometry.coordinates, ...(approach === next ? [] : next.geometry.coordinates)]
    .filter((coordinate, index, all) => index === 0 || coordinate[0] !== all[index - 1][0] || coordinate[1] !== all[index - 1][1])
  if (coordinates.length < 2) return null
  const lengths = roadLengths(coordinates)
  const current = projectToRoad(location, coordinates, lengths)
  if (current.distance > 50) return null
  const candidates = [...(approach.intersections ?? []), ...(next.intersections ?? []).slice(0, 1)]
    .flatMap((intersection) => {
      const lanes = intersection.lanes
      if (!Array.isArray(intersection.location) || intersection.location.length !== 2 || !intersection.location.every(Number.isFinite)) return []
      if (!lanes?.length || lanes.length > 16 || !lanes.every((lane) =>
        lane && typeof lane.valid === 'boolean' && Array.isArray(lane.indications) && lane.indications.every((direction) => typeof direction === 'string'),
      )) return []
      const target = projectToRoad({ lon: intersection.location[0], lat: intersection.location[1] }, coordinates, lengths)
      const distance = target.along - current.along
      return target.distance <= 10 && distance > 0 && distance <= 800 && target.along >= 12
        ? [{ lanes, distance, location: { lon: intersection.location[0], lat: intersection.location[1] } }] : []
    }).sort((first, second) => first.distance - second.distance)
  const guidance = candidates[0]
  if (!guidance) return null

  return { lanes: guidance.lanes, distance: guidance.distance, location: guidance.location }
}

export function laneSignMarkup(guidance: LaneGuidance) {
  const lanes = guidance.lanes.map((lane) => {
    const paths = lane.indications.flatMap((direction) =>
      (Object.hasOwn(laneArrowPaths, direction) ? laneArrowPaths[direction] : []).map((path) =>
        '<polyline points="' + path.map(([horizontal, forward]) => horizontal + ',' + -forward).join(' ') + '"/>',
      ),
    ).join('')
    return '<span class="map-lane-sign-lane' + (lane.valid ? ' map-lane-sign-lane--recommended' : '') + '"><svg viewBox="-7 -12 14 16" aria-hidden="true">' + paths + '</svg></span>'
  }).join('')
  return '<span class="map-lane-sign-title">Şerîtên li pêş · şematîk</span><span class="map-lane-sign-road">' + lanes + '</span>'
}

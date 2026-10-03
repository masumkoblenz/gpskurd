export type Point = {
  lat: number
  lon: number
}

export type TravelMode = 'driving' | 'foot'

export type RouteLane = {
  indications: string[]
  valid: boolean
}

export type RouteStep = {
  distance: number
  duration: number
  name: string
  maneuver: {
    type: string
    modifier?: string
    exit?: number
    location: [number, number]
  }
  geometry: {
    coordinates: [number, number][]
  }
  intersections?: {
    location: [number, number]
    lanes?: RouteLane[]
  }[]
}

export type NavigationRoute = {
  mode: TravelMode
  distance: number
  duration: number
  geometry: {
    coordinates: [number, number][]
  }
  steps: RouteStep[]
}

export type SearchResult = {
  lat: string
  lon: string
  display_name: string
  place_id: number
}

let nextGeocodingRequestAt = 0

export async function findPlaces(query: string): Promise<SearchResult[]> {
  const delay = Math.max(0, nextGeocodingRequestAt - Date.now())
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
  nextGeocodingRequestAt = Date.now() + 1_100
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '5',
    'accept-language': 'de,en',
  })
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`)
  if (!response.ok) throw new Error('Ort konnte nicht gefunden werden. Bitte erneut versuchen.')
  return response.json()
}

export async function getRoutes(start: Point, end: Point, mode: TravelMode = 'driving'): Promise<NavigationRoute[]> {
  const coordinates = `${start.lon},${start.lat};${end.lon},${end.lat}`
  const routingService = mode === 'foot'
    ? 'https://routing.openstreetmap.de/routed-foot'
    : 'https://router.project-osrm.org'
  const response = await fetch(
    `${routingService}/route/v1/driving/${coordinates}?overview=full&steps=true&geometries=geojson&alternatives=true`,
  )
  if (!response.ok) throw new Error('Route konnte nicht berechnet werden. Bitte erneut versuchen.')
  const data = await response.json()
  if (data.code !== 'Ok' || !data.routes?.[0]) {
    throw new Error('Zwischen diesen Orten wurde keine Route gefunden.')
  }
  return data.routes.map((route: { distance: number; duration: number; geometry: NavigationRoute['geometry']; legs: { steps: RouteStep[] }[] }) => ({
    mode,
    distance: route.distance,
    duration: route.duration,
    geometry: route.geometry,
    steps: route.legs.flatMap((leg) => leg.steps),
  }))
}

export function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.max(0, Math.round(meters))} m`
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`
}

export function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `${minutes} Min.`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours} Std. ${remainder} Min.` : `${hours} Std.`
}

export function formatClockDuration(seconds: number) {
  const minutes = Math.max(0, Math.round(seconds / 60))
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${String(hours).padStart(2, '0')}:${String(remainingMinutes).padStart(2, '0')}`
}

export function placeTitle(place: SearchResult) {
  return place.display_name.split(',')[0]?.trim() || place.display_name
}

export function placeSubtitle(place: SearchResult) {
  return place.display_name.split(',').slice(1, 4).map((part) => part.trim()).filter(Boolean).join(', ')
}

export type NavigationAnnouncementPhase = 'early' | 'repeat' | 'now'

export type NavigationGuidance = {
  route: NavigationRoute
  stepIndex: number
  step: RouteStep
  distanceMeters: number | null
  phase: NavigationAnnouncementPhase | null
  germanText: string
  kurmanciText: string
}

export type RouteProjection = {
  distance: number
  along: number
  remaining: number
  bearing: number
  segmentIndex: number
  coordinate: [number, number]
}

export function navigationAnnouncementThresholds(mode: TravelMode) {
  return mode === 'foot'
    ? { early: 150, repeat: 30, now: 10 }
    : { early: 800, repeat: 170, now: 35 }
}

export function navigationAnnouncementPhase(
  distance: number,
  mode: TravelMode,
  isArrival = false,
): NavigationAnnouncementPhase | null {
  const thresholds = navigationAnnouncementThresholds(mode)
  if (!isArrival && distance <= thresholds.now) return 'now'
  if (distance <= thresholds.repeat) return 'repeat'
  if (distance <= thresholds.early) return 'early'
  return null
}

function kurmanciDirection(modifier?: string) {
  if (modifier?.includes('left')) return 'li çepê bizivire'
  if (modifier?.includes('right')) return 'li rastê bizivire'
  if (modifier === 'uturn') return 'vegere'
  return 'rast berdewam bike'
}

function kurmanciExitOrdinal(exit: number) {
  const ordinals = ['yekem', 'duyem', 'sêyem', 'çarêm', 'pêncem', 'şeşem', 'heftem', 'heştem', 'nehêm', 'dehem']
  return ordinals[exit - 1] ?? `${exit}em`
}

function kurmanciTurn(step: RouteStep) {
  const { type, modifier, exit } = step.maneuver
  if (type === 'arrive') return 'heta cihê xwe berdewam bike'
  if (type === 'depart') return 'rêwîtiyê dest pê bike'
  if (type === 'roundabout' || type === 'rotary' || type === 'roundabout turn') {
    return exit ? `bike nav çemberê û derketina ${kurmanciExitOrdinal(exit)} hilbijêre` : 'bike nav çemberê û derketina rast hilbijêre'
  }
  if (type === 'exit roundabout') return `ji çemberê derkeve${modifier?.includes('left') ? ' û li çepê bizivire' : modifier?.includes('right') ? ' û li rastê bizivire' : ''}`
  if (type === 'fork') return `li dabeşbûna rêyan ${kurmanciDirection(modifier)}`
  if (type === 'end of road') return `li dawiya rêyê ${kurmanciDirection(modifier)}`
  if (type === 'on ramp') return `bike ser rêya derbasiyê${modifier?.includes('left') ? ' li çepê' : modifier?.includes('right') ? ' li rastê' : ''}`
  if (type === 'off ramp') return `ji rêya bilez derkeve${modifier?.includes('left') ? ' li çepê' : modifier?.includes('right') ? ' li rastê' : ''}`
  if (type === 'merge') return `tevli herikîna trafîkê bibe${modifier?.includes('left') ? ' li çepê' : modifier?.includes('right') ? ' li rastê' : ''}`
  if (type === 'crossing') return `li derbasgehê ${kurmanciDirection(modifier)}`
  if (type === 'intersection') return `li xaçerê ${kurmanciDirection(modifier)}`
  if (type === 'traffic_signals') return `li ronahiya trafîkê ${kurmanciDirection(modifier)}`
  if (type === 'uturn' || modifier === 'uturn') return 'vegere û bizivire'
  if (modifier?.includes('left')) return 'li çepê bizivire'
  if (modifier?.includes('right')) return 'li rastê bizivire'
  if (modifier === 'straight') return 'rast berdewam bike'
  return 'li pêş berdewam bike'
}

function instructionDistance(meters: number) {
  const roundedMeters = Math.max(0, Math.round(meters))
  if (roundedMeters < 1_000) return { value: String(roundedMeters), meters: true }
  return { value: (roundedMeters / 1_000).toFixed(1).replace('.', ','), meters: false }
}

export function kurmanciInstructionFor(
  step: RouteStep,
  includeDistance = true,
  distanceOverride?: number,
  phase: NavigationAnnouncementPhase = 'early',
) {
  const maneuver = step.maneuver.type
  const turn = kurmanciTurn(step)
  if (maneuver === 'depart') return `${turn}.`
  if (maneuver === 'arrive') return 'Heta cihê xwe berdewam bike.'

  const streetName = step.name.trim()
  const street = streetName ? ` li ser rêya ${streetName}` : ''
  if (phase === 'now') return `Niha ${turn}${street}.`
  if (!includeDistance) return `${turn}${street}.`

  const distanceMeters = distanceOverride ?? step.distance
  const formattedDistance = instructionDistance(distanceMeters)
  const distance = formattedDistance.meters
    ? `${formattedDistance.value} metreyan`
    : `${formattedDistance.value} kilometroyan`
  return `Di ${distance} de ${turn}${street}.`
}

function germanTurn(step: RouteStep) {
  const modifier = step.maneuver.modifier
  if (step.maneuver.type === 'arrive') return 'Fahren Sie bis zum Ziel weiter.'
  if (step.maneuver.type === 'depart') return 'Fahren Sie los.'
  if (step.maneuver.type === 'roundabout' || step.maneuver.type === 'rotary' || step.maneuver.type === 'roundabout turn') {
    return step.maneuver.exit
      ? `Nehmen Sie die ${step.maneuver.exit}. Ausfahrt im Kreisverkehr.`
      : 'Nehmen Sie die passende Ausfahrt im Kreisverkehr.'
  }
  if (step.maneuver.type === 'exit roundabout') {
    const direction = modifier?.includes('left') ? ' und biegen Sie nach links ab' : modifier?.includes('right') ? ' und biegen Sie nach rechts ab' : ''
    return `Verlassen Sie den Kreisverkehr${direction}.`
  }
  if (step.maneuver.type === 'fork') return `Halten Sie sich an der Gabelung ${modifier?.includes('left') ? 'links' : modifier?.includes('right') ? 'rechts' : 'geradeaus'}.`
  if (step.maneuver.type === 'end of road') return `Biegen Sie am Ende der Straße ${modifier?.includes('left') ? 'links' : modifier?.includes('right') ? 'rechts' : 'geradeaus'} ab.`
  if (step.maneuver.type === 'on ramp') {
    const direction = modifier?.includes('left') ? ' nach links' : modifier?.includes('right') ? ' nach rechts' : ''
    return `Fahren Sie auf die Auffahrt${direction}.`
  }
  if (step.maneuver.type === 'off ramp') {
    const direction = modifier?.includes('left') ? ' nach links' : modifier?.includes('right') ? ' nach rechts' : ''
    return `Nehmen Sie die Ausfahrt${direction}.`
  }
  if (step.maneuver.type === 'merge') {
    const direction = modifier?.includes('left') ? ' links' : modifier?.includes('right') ? ' rechts' : ''
    return `Fädeln Sie sich${direction} in den Verkehr ein.`
  }
  if (step.maneuver.type === 'crossing') {
    const direction = modifier?.includes('left') ? ' nach links' : modifier?.includes('right') ? ' nach rechts' : ' geradeaus'
    return `Überqueren Sie die Kreuzung und fahren Sie${direction}.`
  }
  if (step.maneuver.type === 'intersection') return `Fahren Sie an der Kreuzung ${modifier?.includes('left') ? 'nach links' : modifier?.includes('right') ? 'nach rechts' : 'geradeaus'}.`
  if (step.maneuver.type === 'traffic_signals') return `Fahren Sie an der Ampel ${modifier?.includes('left') ? 'nach links' : modifier?.includes('right') ? 'nach rechts' : 'geradeaus'}.`
  if (step.maneuver.type === 'uturn' || modifier === 'uturn') return 'Wenden Sie.'
  if (modifier?.includes('left')) return 'links abbiegen.'
  if (modifier?.includes('right')) return 'rechts abbiegen.'
  if (modifier === 'straight') return 'geradeaus weiterfahren.'
  return 'weiterfahren.'
}

export function germanInstructionFor(
  step: RouteStep,
  includeDistance = true,
  distanceOverride?: number,
  phase: NavigationAnnouncementPhase = 'early',
) {
  const turn = germanTurn(step)
  if (step.maneuver.type === 'depart' || step.maneuver.type === 'arrive') return turn
  const action = turn.endsWith('.') ? turn.slice(0, -1) : turn
  const streetName = step.name.trim()
  const street = streetName ? ` auf ${streetName}` : ''
  if (phase === 'now') return `Jetzt ${action.charAt(0).toLocaleLowerCase('de-DE')}${action.slice(1)}${street}.`
  const distanceMeters = distanceOverride ?? step.distance
  if (!includeDistance) return `${action}${street}.`
  const formattedDistance = instructionDistance(distanceMeters)
  const distance = `${formattedDistance.value} ${formattedDistance.meters ? 'm' : 'km'}`
  return `In ${distance} ${action}${street}.`
}

export function createNavigationGuidance(
  route: NavigationRoute,
  point: Point,
  stepIndex: number,
  accuracy = 10,
): NavigationGuidance | null {
  if (!route.steps.length) return null

  const lastIndex = route.steps.length - 1
  let activeIndex = Math.max(0, Math.min(stepIndex, lastIndex))
  if (activeIndex === 0 && lastIndex > 0 && route.steps[0].maneuver.type === 'depart') activeIndex = 1

  while (activeIndex < lastIndex) {
    const approachStep = route.steps[activeIndex - 1]
    const approachGeometry = approachStep?.geometry.coordinates ?? []
    if (approachGeometry.length < 2) break

    const distanceAlongApproach = distanceAlongRouteToEnd(point, approachGeometry)
    const distanceFromApproach = distanceToRoute(point, approachGeometry)
    const reachTolerance = Math.max(6, Math.min(accuracy, 15))
    const routeTolerance = Math.max(12, Math.min(accuracy * 1.5, 30))
    if (
      !Number.isFinite(distanceAlongApproach) ||
      distanceAlongApproach > reachTolerance ||
      distanceFromApproach > routeTolerance
    ) break
    activeIndex += 1
  }

  const step = route.steps[activeIndex]
  const approachGeometry = route.steps[activeIndex - 1]?.geometry.coordinates ?? []
  const distanceMeters = activeIndex === 0
    ? distanceAlongRouteToEnd(point, route.geometry.coordinates)
    : approachGeometry.length >= 2
      ? distanceAlongRouteToEnd(point, approachGeometry)
      : Number.NaN
  const preciseDistance = Number.isFinite(distanceMeters) ? distanceMeters : null
  const phase = preciseDistance === null
    ? null
    : navigationAnnouncementPhase(preciseDistance, route.mode, step.maneuver.type === 'arrive')
  const textPhase = phase ?? 'early'

  return {
    route,
    stepIndex: activeIndex,
    step,
    distanceMeters: preciseDistance,
    phase,
    germanText: germanInstructionFor(step, preciseDistance !== null, preciseDistance ?? undefined, textPhase),
    kurmanciText: kurmanciInstructionFor(step, preciseDistance !== null, preciseDistance ?? undefined, textPhase),
  }
}

export function projectOntoRoute(
  point: Point,
  coordinates: [number, number][],
  previousAlong?: number,
): RouteProjection | null {
  if (coordinates.length < 2) return null
  const latitudeScale = 111_320
  const longitudeScale = latitudeScale * Math.max(0.01, Math.cos((point.lat * Math.PI) / 180))
  let totalDistance = 0
  let closest: RouteProjection | null = null
  let closestContinuous: RouteProjection | null = null
  for (let index = 1; index < coordinates.length; index += 1) {
    const [previousLon, previousLat] = coordinates[index - 1]
    const [lon, lat] = coordinates[index]
    if (![previousLon, previousLat, lon, lat].every(Number.isFinite)) continue
    const startX = (previousLon - point.lon) * longitudeScale
    const startY = (previousLat - point.lat) * latitudeScale
    const endX = (lon - point.lon) * longitudeScale
    const endY = (lat - point.lat) * latitudeScale
    const segmentX = endX - startX
    const segmentY = endY - startY
    const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY
    const progress = segmentLengthSquared
      ? Math.min(1, Math.max(0, -(startX * segmentX + startY * segmentY) / segmentLengthSquared))
      : 0
    const distance = Math.hypot(startX + progress * segmentX, startY + progress * segmentY)
    const segmentLength = distanceBetween(
      { lat: previousLat, lon: previousLon },
      { lat, lon },
    )
    const along = totalDistance + progress * segmentLength
    const candidate = {
      distance,
      along,
      remaining: 0,
      bearing: bearingBetween({ lat: previousLat, lon: previousLon }, { lat, lon }),
      segmentIndex: index,
      coordinate: [previousLon + progress * (lon - previousLon), previousLat + progress * (lat - previousLat)] as [number, number],
    }
    if (!closest || candidate.distance < closest.distance) closest = candidate
    if (
      previousAlong === undefined ||
      (along >= Math.max(0, previousAlong - 80) && along <= previousAlong + 600)
    ) {
      if (!closestContinuous || candidate.distance < closestContinuous.distance) closestContinuous = candidate
    }
    totalDistance += segmentLength
  }
  const projection = closestContinuous ?? closest
  return projection ? { ...projection, remaining: Math.max(0, totalDistance - projection.along) } : null
}

export function remainingRouteCoordinates(route: NavigationRoute, projection: RouteProjection | null) {
  if (!projection) return route.geometry.coordinates
  if (projection.remaining <= 0.1) return []
  return [projection.coordinate, ...route.geometry.coordinates.slice(projection.segmentIndex)]
}

export function routeStepAtProjection(route: NavigationRoute, projection: RouteProjection | null) {
  if (!projection) return Math.min(1, route.steps.length - 1)
  let along = 0
  for (let index = 0; index < route.steps.length - 1; index += 1) {
    const coordinates = route.steps[index].geometry.coordinates
    for (let coordinateIndex = 1; coordinateIndex < coordinates.length; coordinateIndex += 1) {
      const start = coordinates[coordinateIndex - 1]
      const end = coordinates[coordinateIndex]
      along += distanceBetween({ lon: start[0], lat: start[1] }, { lon: end[0], lat: end[1] })
    }
    if (projection.along < along - 0.1) return index + 1
  }
  return Math.max(0, route.steps.length - 1)
}

export function distanceToRoute(point: Point, coordinates: [number, number][], previousAlong?: number) {
  return projectOntoRoute(point, coordinates, previousAlong)?.distance ?? Number.POSITIVE_INFINITY
}

export function distanceAlongRouteToEnd(point: Point, coordinates: [number, number][], previousAlong?: number) {
  return projectOntoRoute(point, coordinates, previousAlong)?.remaining ?? Number.POSITIVE_INFINITY
}

export function bearingBetween(first: Point, second: Point) {
  const firstLatitude = first.lat * Math.PI / 180
  const secondLatitude = second.lat * Math.PI / 180
  const longitudeDelta = (second.lon - first.lon) * Math.PI / 180
  const y = Math.sin(longitudeDelta) * Math.cos(secondLatitude)
  const x = Math.cos(firstLatitude) * Math.sin(secondLatitude) -
    Math.sin(firstLatitude) * Math.cos(secondLatitude) * Math.cos(longitudeDelta)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

export function distanceBetween(first: Point, second: Point) {
  const latitude = ((second.lat - first.lat) * Math.PI) / 180
  const longitude = ((second.lon - first.lon) * Math.PI) / 180
  const value =
    Math.sin(latitude / 2) ** 2 +
    Math.cos((first.lat * Math.PI) / 180) *
      Math.cos((second.lat * Math.PI) / 180) *
      Math.sin(longitude / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

export type Point = {
  lat: number
  lon: number
}

export type TravelMode = 'driving' | 'foot'

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

export async function getRoute(start: Point, end: Point, mode: TravelMode = 'driving'): Promise<NavigationRoute> {
  const coordinates = `${start.lon},${start.lat};${end.lon},${end.lat}`
  const routingService = mode === 'foot'
    ? 'https://routing.openstreetmap.de/routed-foot'
    : 'https://router.project-osrm.org'
  const response = await fetch(
    `${routingService}/route/v1/driving/${coordinates}?overview=full&steps=true&geometries=geojson`,
  )
  if (!response.ok) throw new Error('Route konnte nicht berechnet werden. Bitte erneut versuchen.')
  const data = await response.json()
  if (data.code !== 'Ok' || !data.routes?.[0]) {
    throw new Error('Zwischen diesen Orten wurde keine Route gefunden.')
  }
  return {
    mode,
    distance: data.routes[0].distance,
    duration: data.routes[0].duration,
    geometry: data.routes[0].geometry,
    steps: data.routes[0].legs.flatMap((leg: { steps: RouteStep[] }) => leg.steps),
  }
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

function kurmanciDistance(meters: number) {
  const roundedDistance = meters < 100
    ? Math.max(10, Math.round(meters / 10) * 10)
    : Math.round(meters / 50) * 50
  if (roundedDistance < 1_000) return `${roundedDistance} metreyan`
  return `${(roundedDistance / 1_000).toFixed(1).replace('.', ',')} kilometroyan`
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
  if (maneuver === 'arrive' && phase === 'now') return 'Heta cihê xwe berdewam bike.'

  const streetName = step.name.trim()
  const street = streetName ? ` li ser rêya ${streetName}` : ''
  if (phase === 'now') return `Niha ${turn}${street}.`
  if (!includeDistance) return `${turn}${street}.`

  const distanceMeters = distanceOverride ?? step.distance
  const distance = kurmanciDistance(distanceMeters)
  return `Di ${distance} de ${turn}${street}.`
}

export function kurmanciArrivalInstruction() {
  return 'Gihîştî cihê xwe.'
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
  if (phase === 'now') return `Jetzt ${turn.charAt(0).toLocaleLowerCase('de-DE')}${turn.slice(1)}`
  const distanceMeters = distanceOverride ?? step.distance
  if (!includeDistance || distanceMeters < 10) {
    return `${turn.charAt(0).toLocaleUpperCase('de-DE')}${turn.slice(1)}`
  }
  const distance = distanceMeters < 1_000
    ? `${Math.max(50, Math.round(distanceMeters / 50) * 50)} m`
    : `${(distanceMeters / 1_000).toFixed(1).replace('.', ',')} km`
  return `In ${distance} ${turn}`
}

export function distanceToRoute(point: Point, coordinates: [number, number][]) {
  if (coordinates.length < 2) return Number.POSITIVE_INFINITY
  const latitudeScale = 111_320
  const longitudeScale = latitudeScale * Math.cos((point.lat * Math.PI) / 180)
  let closest = Number.POSITIVE_INFINITY

  for (let index = 1; index < coordinates.length; index += 1) {
    const [previousLon, previousLat] = coordinates[index - 1]
    const [lon, lat] = coordinates[index]
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
    closest = Math.min(closest, distance)
  }
  return closest
}

export function distanceAlongRouteToEnd(point: Point, coordinates: [number, number][]) {
  if (coordinates.length < 2) return Number.POSITIVE_INFINITY

  const latitudeScale = 111_320
  const longitudeScale = latitudeScale * Math.cos((point.lat * Math.PI) / 180)
  let closestDistance = Number.POSITIVE_INFINITY
  let distanceAlong = 0
  let distanceBeforeSegment = 0

  for (let index = 1; index < coordinates.length; index += 1) {
    const [previousLon, previousLat] = coordinates[index - 1]
    const [lon, lat] = coordinates[index]
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
    const distanceToSegment = Math.hypot(startX + progress * segmentX, startY + progress * segmentY)
    const segmentLength = distanceBetween(
      { lat: previousLat, lon: previousLon },
      { lat, lon },
    )

    if (distanceToSegment < closestDistance) {
      closestDistance = distanceToSegment
      distanceAlong = distanceBeforeSegment + progress * segmentLength
    }
    distanceBeforeSegment += segmentLength
  }

  return Math.max(0, distanceBeforeSegment - distanceAlong)
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

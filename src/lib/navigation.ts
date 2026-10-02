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
  if (meters < 1000) return `${Math.max(0, Math.round(meters / 50) * 50)} m`
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

function kurmanciTurn(step: RouteStep) {
  const modifier = step.maneuver.modifier
  if (step.maneuver.type === 'arrive') return 'Gihîştî cihê xwe.'
  if (step.maneuver.type === 'depart') return 'Destpê bike.'
  if (step.maneuver.type === 'roundabout' || step.maneuver.type === 'rotary') {
    return 'Bike nav çemberê û derketina rast hilbijêre.'
  }
  if (step.maneuver.type === 'uturn') return 'Vegere û bizivire.'
  if (modifier?.includes('left')) return 'li çepê bizivire.'
  if (modifier?.includes('right')) return 'li rastê bizivire.'
  if (modifier === 'uturn') return 'vegere.'
  if (modifier === 'straight') return 'rast biçe.'
  return 'li pêş biçe.'
}

export function kurmanciInstructionFor(step: RouteStep, includeDistance = true, distanceOverride?: number) {
  const turn = kurmanciTurn(step)
  if (step.maneuver.type === 'depart' || step.maneuver.type === 'arrive') return turn
  const distanceMeters = distanceOverride ?? step.distance
  if (!includeDistance || distanceMeters < 10) return turn
  const distance =
    distanceMeters < 1_000
      ? `${Math.max(50, Math.round(distanceMeters / 50) * 50)} metreyan`
      : `${(distanceMeters / 1_000).toFixed(1).replace('.', ',')} kilometroyan`
  return `Di ${distance} de ${turn}`
}

function germanTurn(step: RouteStep) {
  const modifier = step.maneuver.modifier
  if (step.maneuver.type === 'arrive') return 'Ziel erreicht.'
  if (step.maneuver.type === 'depart') return 'Fahren Sie los.'
  if (step.maneuver.type === 'roundabout' || step.maneuver.type === 'rotary') {
    return 'Nehmen Sie die passende Ausfahrt im Kreisverkehr.'
  }
  if (step.maneuver.type === 'uturn' || modifier === 'uturn') return 'Wenden Sie.'
  if (modifier?.includes('left')) return 'links abbiegen.'
  if (modifier?.includes('right')) return 'rechts abbiegen.'
  if (modifier === 'straight') return 'geradeaus weiterfahren.'
  return 'weiterfahren.'
}

export function germanInstructionFor(step: RouteStep, includeDistance = true, distanceOverride?: number) {
  const turn = germanTurn(step)
  if (step.maneuver.type === 'depart' || step.maneuver.type === 'arrive') return turn
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

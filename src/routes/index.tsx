import { createFileRoute } from '@tanstack/react-router'
import {
  ArrowLeft,
  ArrowUpDown,
  ArrowUpRight,
  CarFront,
  Clock3,
  Compass,
  Footprints,
  LocateFixed,
  LoaderCircle,
  MapPin,
  Minus,
  Navigation,
  Plus,
  Play,
  Search,
  Volume2,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { NavigationMap } from '@/components/NavigationMap'
import {
  distanceBetween,
  distanceAlongRouteToEnd,
  distanceToRoute,
  findPlaces,
  formatClockDuration,
  formatDistance,
  formatDuration,
  germanInstructionFor,
  getRoute,
  kurmanciArrivalInstruction,
  kurmanciInstructionFor,
  placeSubtitle,
  placeTitle,
  type NavigationRoute,
  type Point,
  type RouteStep,
  type SearchResult,
  type TravelMode,
} from '@/lib/navigation'
import type { ZoomRequest } from '@/components/NavigationMap'

export const Route = createFileRoute('/')({
  component: NavigationPage,
})

function ManeuverArrow({ step }: { step: RouteStep }) {
  const maneuver = step.maneuver
  const modifier = maneuver.modifier ?? ''
  const isUturn = maneuver.type === 'uturn' || modifier === 'uturn'
  const isLeft = !isUturn && modifier.includes('left')
  const isRight = !isUturn && modifier.includes('right')
  const directionLabel = isUturn ? 'Wenden' : isLeft ? 'Links abbiegen' : isRight ? 'Rechts abbiegen' : 'Geradeaus fahren'

  return (
    <svg className="maneuver-arrow" viewBox="0 0 32 32" fill="none" role="img" aria-label={directionLabel}>
      {isUturn ? (
        <>
          <path d="M21 28V18a8 8 0 0 0-16 0v10" />
          <path d="m1 23 4 5 4-5" />
        </>
      ) : isLeft ? (
        <>
          <path d="M22 28V17a10 10 0 0 0-10-10H5" />
          <path d="m11 2-6 5 6 5" />
        </>
      ) : isRight ? (
        <>
          <path d="M10 28V17A10 10 0 0 1 20 7h7" />
          <path d="m21 2 6 5-6 5" />
        </>
      ) : (
        <>
          <path d="M16 28V5" />
          <path d="m8 13 8-8 8 8" />
        </>
      )}
    </svg>
  )
}

function NavigationPage() {
  const [origin, setOrigin] = useState<Point | null>(null)
  const [originName, setOriginName] = useState('')
  const [currentLocation, setCurrentLocation] = useState<Point | null>(null)
  const [destination, setDestination] = useState<Point | null>(null)
  const [destinationName, setDestinationName] = useState('')
  const [route, setRoute] = useState<NavigationRoute | null>(null)
  const [travelMode, setTravelMode] = useState<TravelMode>('driving')
  const [routeError, setRouteError] = useState('')
  const [query, setQuery] = useState('')
  const [originQuery, setOriginQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [originResults, setOriginResults] = useState<SearchResult[]>([])
  const [activeSearch, setActiveSearch] = useState<'destination' | 'origin' | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchingOrigin, setSearchingOrigin] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [routing, setRouting] = useState(false)
  const [isNavigating, setIsNavigating] = useState(false)
  const [followLocation, setFollowLocation] = useState(true)
  const [heading, setHeading] = useState<number | null>(null)
  const [headingUpEnabled, setHeadingUpEnabled] = useState(false)
  const [zoomRequest, setZoomRequest] = useState<ZoomRequest>({ id: 0, direction: 1 })
  const [nextTurnDistance, setNextTurnDistance] = useState<number | null>(null)
  const [destinationReached, setDestinationReached] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [speechCue, setSpeechCue] = useState<{ id: number; text: string } | null>(null)
  const [speechError, setSpeechError] = useState('')
  const [mapCenterRequest, setMapCenterRequest] = useState(0)
  const [stepIndex, setStepIndex] = useState(0)
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [gpsMessage, setGpsMessage] = useState('')
  const activeSearchResults = activeSearch === 'origin' ? originResults : results
  const activeSearchLoading = activeSearch === 'origin' ? searchingOrigin : searching
  const routeRef = useRef(route)
  const routeRequestRef = useRef(0)
  const navigationSessionRef = useRef(0)
  const searchRequestRef = useRef(0)
  const lastRerouteRef = useRef(0)
  const reroutingRef = useRef(false)
  const stepIndexRef = useRef(stepIndex)
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const ttsWorkerRef = useRef<Worker | null>(null)
  const speechRequestRef = useRef(0)
  const speechEventRef = useRef(0)
  const processedSpeechEventRef = useRef(0)
  const speechQueueRef = useRef<Array<{ id: number; text: string }>>([])
  const speechPlayingRef = useRef(false)
  const announcedManeuversRef = useRef(new Map<number, Set<'early' | 'repeat' | 'now'>>())
  const currentLocationRef = useRef<Point | null>(null)
  const originEditedRef = useRef(false)
  const destinationRef = useRef(destination)
  const lastLocationFixAtRef = useRef(0)
  const lastLocationRenderRef = useRef(0)
  const headingUpRef = useRef(headingUpEnabled)
  const voiceEnabledRef = useRef(voiceEnabled)
  const stopNavigationRef = useRef<() => void>(() => undefined)
  headingUpRef.current = headingUpEnabled
  voiceEnabledRef.current = voiceEnabled
  routeRef.current = route
  destinationRef.current = destination
  stepIndexRef.current = stepIndex

  const queueNavigationSpeech = (text: string) => {
    if (!voiceEnabledRef.current || !text.trim()) return
    const cue = { id: ++speechEventRef.current, text }
    if (speechPlayingRef.current) speechQueueRef.current.push(cue)
    else {
      speechPlayingRef.current = true
      setSpeechCue(cue)
    }
  }

  const clearNavigationSpeech = () => {
    speechQueueRef.current = []
    speechPlayingRef.current = false
    setSpeechCue(null)
    if (audioSourceRef.current) {
      audioSourceRef.current.onended = null
      audioSourceRef.current.stop()
      audioSourceRef.current.disconnect()
      audioSourceRef.current = null
    }
  }

  const finishNavigationSpeech = () => {
    const nextCue = speechQueueRef.current.shift()
    if (nextCue) {
      setSpeechCue(nextCue)
      return
    }
    speechPlayingRef.current = false
    setSpeechCue(null)
  }

  const maneuverAnnouncement = (
    maneuverIndex: number,
    step: RouteStep,
    distance: number,
    phase: 'early' | 'repeat' | 'now',
  ) => {
    if (!voiceEnabledRef.current || maneuverIndex === 0 || step.maneuver.type === 'depart') return null
    const announced = announcedManeuversRef.current.get(maneuverIndex) ?? new Set<'early' | 'repeat' | 'now'>()
    if (announced.has(phase)) return null
    announced.add(phase)
    if (phase === 'repeat') announced.add('early')
    if (phase === 'now') {
      announced.add('early')
      announced.add('repeat')
    }
    announcedManeuversRef.current.set(maneuverIndex, announced)
    return kurmanciInstructionFor(step, true, distance, phase)
  }

  const prepareAudio = async () => {
    try {
      const audioContext = audioContextRef.current ?? new AudioContext()
      audioContextRef.current = audioContext
      if (audioContext.state === 'suspended') await audioContext.resume()
      if (audioContext.state !== 'running') throw new Error('audio_context_not_running')
      return audioContext
    } catch {
      return null
    }
  }

  const routeFailureMessage = (error: unknown) =>
    error instanceof Error && (error.message.startsWith('Route ') || error.message.startsWith('Zwischen '))
      ? error.message
      : 'Die Route konnte nicht berechnet werden. Bitte erneut versuchen.'

  const updateCurrentLocation = (coords: GeolocationCoordinates, forceRender = false) => {
    if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) return null
    const accuracy = coords.accuracy
    const previous = currentLocationRef.current
    const now = Date.now()
    if (accuracy > 100 && previous) {
      setGpsStatus('error')
      setGpsMessage('Der GPS-Standort ist ungenau. Begeben Sie sich an einen Ort mit freier Sicht.')
      return null
    }

    const incoming = { lat: coords.latitude, lon: coords.longitude }
    let point = incoming
    if (previous) {
      const movement = distanceBetween(previous, incoming)
      const elapsedSeconds = Math.max(0, now - lastLocationFixAtRef.current) / 1_000
      const plausibleMovement = Math.max(80, Math.max(8, Math.min(coords.speed ?? 20, 45)) * elapsedSeconds * 2 + accuracy * 1.5)
      if (accuracy > 35 && movement > plausibleMovement) {
        setGpsMessage('Das GPS-Signal ist schwach. Der Standort kann ungenau sein.')
        return null
      }
      if (accuracy > 15 && movement < accuracy * 2) {
        const smoothing = elapsedSeconds > 5
          ? Math.max(0.55, Math.min(0.8, 18 / accuracy))
          : Math.max(0.2, Math.min(0.75, 18 / accuracy))
        point = {
          lat: previous.lat + (incoming.lat - previous.lat) * smoothing,
          lon: previous.lon + (incoming.lon - previous.lon) * smoothing,
        }
      }
    }

    currentLocationRef.current = point
    lastLocationFixAtRef.current = now
    setGpsStatus('ready')
    setGpsMessage(accuracy > 35 ? 'Das GPS-Signal ist schwach. Der Standort kann ungenau sein.' : '')
    if (forceRender || !previous || now - lastLocationRenderRef.current >= 1_800) {
      lastLocationRenderRef.current = now
      setCurrentLocation(point)
    }

    const course = coords.heading
    const minimumCourseSpeed = travelMode === 'foot' ? 0.35 : 1.2
    const maximumCourseAccuracy = travelMode === 'foot' ? 25 : 35
    const hasReliableCourse = accuracy <= maximumCourseAccuracy && coords.speed !== null && coords.speed > minimumCourseSpeed && course !== null && Number.isFinite(course)
    if (hasReliableCourse && headingUpRef.current) {
      setHeading((oldHeading) => {
        if (oldHeading === null) return course
        const difference = Math.abs(((course - oldHeading + 540) % 360) - 180)
        return difference > 12 ? course : oldHeading
      })
    } else if (headingUpRef.current) {
      setHeading(null)
    }

    return point
  }

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setGpsStatus('error')
      setGpsMessage('GPS wird von diesem Gerät nicht unterstützt.')
      setFollowLocation(false)
      return
    }
    setGpsStatus('loading')
    setGpsMessage('')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const point = updateCurrentLocation(coords, true)
        if (!point) return
        setFollowLocation(true)
        setMapCenterRequest((request) => request + 1)
      },
      () => {
        setGpsStatus('error')
        setGpsMessage('Standort nicht verfügbar.')
        setFollowLocation(false)
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 2_000 },
    )
  }

  const requestOriginLocation = () => {
    originEditedRef.current = false
    if (!navigator.geolocation) {
      setGpsStatus('error')
      setGpsMessage('GPS wird von diesem Gerät nicht unterstützt.')
      setFollowLocation(false)
      return
    }
    setGpsStatus('loading')
    setGpsMessage('')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const point = updateCurrentLocation(coords, true)
        if (!point) return
        if (originEditedRef.current) return
        const requestId = ++routeRequestRef.current
        setOrigin(point)
        setOriginName('Mein Standort')
        setOriginQuery('Mein Standort')
        setFollowLocation(true)
        setMapCenterRequest((request) => request + 1)
        setRoute(null)
        setStepIndex(0)
        const selectedDestination = destinationRef.current
        if (!selectedDestination) return
        setRouting(true)
        setRouteError('')
        void getRoute(point, selectedDestination, travelMode)
          .then((nextRoute) => {
            if (routeRequestRef.current === requestId) setRoute(nextRoute)
          })
          .catch((error: unknown) => {
            if (routeRequestRef.current === requestId) {
              setRouteError(routeFailureMessage(error))
            }
          })
          .finally(() => {
            if (routeRequestRef.current === requestId) setRouting(false)
          })
      },
      () => {
        setGpsStatus('error')
        setGpsMessage('Standort nicht verfügbar.')
        setFollowLocation(false)
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 2_000 },
    )
  }

  useEffect(() => {
    requestOriginLocation()
  }, [])

  const searchPlaces = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (searching) return
    const term = query.trim()
    if (term.length < 2) return
    const requestId = ++searchRequestRef.current
    setActiveSearch('destination')
    setSearchError('')
    setOriginResults([])
    setSearching(true)
    setResults([])
    try {
      const places = await findPlaces(term)
      if (searchRequestRef.current === requestId) setResults(places)
    } catch {
      if (searchRequestRef.current === requestId) setSearchError('Die Suche ist fehlgeschlagen. Bitte erneut versuchen.')
    } finally {
      if (searchRequestRef.current === requestId) setSearching(false)
    }
  }

  const searchOriginPlaces = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (searchingOrigin) return
    const term = originQuery.trim()
    if (term.length < 2) return
    const requestId = ++searchRequestRef.current
    setActiveSearch('origin')
    setSearchError('')
    setResults([])
    setSearchingOrigin(true)
    setOriginResults([])
    try {
      const places = await findPlaces(term)
      if (searchRequestRef.current === requestId) setOriginResults(places)
    } catch {
      if (searchRequestRef.current === requestId) setSearchError('Die Suche ist fehlgeschlagen. Bitte erneut versuchen.')
    } finally {
      if (searchRequestRef.current === requestId) setSearchingOrigin(false)
    }
  }

  const closeSearchResults = () => {
    searchRequestRef.current += 1
    setActiveSearch(null)
    if (origin) setOriginQuery(originName || 'Mein Standort')
    if (destination) setQuery(destinationName)
    setResults([])
    setOriginResults([])
    setSearching(false)
    setSearchingOrigin(false)
    setSearchError('')
  }

  const resetRouteForStopEdit = () => {
    routeRequestRef.current += 1
    navigationSessionRef.current += 1
    setRoute(null)
    setRouteError('')
    setRouting(false)
    setIsNavigating(false)
    clearNavigationSpeech()
    setStepIndex(0)
    setDestinationReached(false)
    setNextTurnDistance(null)
  }

  const editOriginInput = (value: string) => {
    originEditedRef.current = true
    setOriginQuery(value)
    setOrigin(null)
    setOriginName('')
    resetRouteForStopEdit()
  }

  const editDestinationInput = (value: string) => {
    setQuery(value)
    setDestination(null)
    setDestinationName('')
    resetRouteForStopEdit()
  }

  const chooseOrigin = async (place: SearchResult) => {
    searchRequestRef.current += 1
    setActiveSearch(null)
    routeRequestRef.current += 1
    navigationSessionRef.current += 1
    originEditedRef.current = true
    setOrigin({ lat: Number(place.lat), lon: Number(place.lon) })
    const selectedOriginName = place.display_name.split(',').slice(0, 2).join(', ')
    setOriginName(selectedOriginName)
    setOriginQuery(selectedOriginName)
    setOriginResults([])
    setRoute(null)
    setRouting(false)
    setIsNavigating(false)
    clearNavigationSpeech()
    setStepIndex(0)
    setDestinationReached(false)
    setRouteError('')
    if (destination) {
      const point = { lat: Number(place.lat), lon: Number(place.lon) }
      const requestId = routeRequestRef.current
      setRouting(true)
      try {
        const nextRoute = await getRoute(point, destination, travelMode)
        if (routeRequestRef.current === requestId) setRoute(nextRoute)
      } catch (error) {
        if (routeRequestRef.current === requestId) {
          setRouteError(routeFailureMessage(error))
        }
      } finally {
        if (routeRequestRef.current === requestId) setRouting(false)
      }
    }
  }

  const chooseDestination = async (place: SearchResult) => {
    searchRequestRef.current += 1
    setActiveSearch(null)
    const requestId = ++routeRequestRef.current
    navigationSessionRef.current += 1
    const point = { lat: Number(place.lat), lon: Number(place.lon) }
    const startPoint = isNavigating
      ? currentLocationRef.current ?? origin
      : originName === 'Mein Standort'
        ? currentLocationRef.current ?? origin
        : origin
    if (isNavigating && startPoint) {
      setOrigin(startPoint)
      setOriginName('Mein Standort')
      setOriginQuery('Mein Standort')
    }
    setDestination(point)
    const selectedDestinationName = place.display_name.split(',').slice(0, 2).join(', ')
    setDestinationName(selectedDestinationName)
    setQuery(selectedDestinationName)
    setResults([])
    setOriginResults([])
    setRoute(null)
    setRouteError('')
    setDestinationReached(false)
    setIsNavigating(false)
    clearNavigationSpeech()
    setStepIndex(0)
    if (!startPoint) {
      const hasUnresolvedOrigin = originQuery.trim().length > 0
      if (!hasUnresolvedOrigin) {
        setGpsStatus('error')
        setGpsMessage('Für den Startpunkt wird dein aktueller Standort benötigt. Bitte Standortzugriff erlauben.')
      }
      setRouteError(hasUnresolvedOrigin ? 'Bitte wähle einen Startort aus den Suchergebnissen.' : 'Aktueller Standort nicht verfügbar. Standortzugriff erlauben und erneut versuchen.')
      return
    }

    setRouting(true)
    try {
      const nextRoute = await getRoute(startPoint, point, travelMode)
      if (routeRequestRef.current === requestId) setRoute(nextRoute)
    } catch (error) {
      if (routeRequestRef.current === requestId) {
        setRouteError(routeFailureMessage(error))
      }
    } finally {
      if (routeRequestRef.current === requestId) setRouting(false)
    }
  }

  const selectTravelMode = async (mode: TravelMode) => {
    if (mode === travelMode) return
    const requestId = ++routeRequestRef.current
    setTravelMode(mode)
    setRoute(null)
    setRouteError('')
    setStepIndex(0)
    if (!origin || !destination) {
      setRouting(false)
      return
    }
    setRouting(true)
    try {
      const startPoint = originName === 'Mein Standort' ? currentLocationRef.current ?? origin : origin
      const nextRoute = await getRoute(startPoint, destination, mode)
      if (routeRequestRef.current === requestId) setRoute(nextRoute)
    } catch (error) {
      if (routeRequestRef.current === requestId) setRouteError(routeFailureMessage(error))
    } finally {
      if (routeRequestRef.current === requestId) setRouting(false)
    }
  }

  useEffect(() => {
    if (!isNavigating) return
    const navigationSessionId = navigationSessionRef.current
    if (!navigator.geolocation) {
      setGpsStatus('error')
      setGpsMessage('GPS wird von diesem Gerät nicht unterstützt. Die Route bleibt auf der Karte sichtbar.')
      setFollowLocation(false)
      return
    }

    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        if (navigationSessionRef.current !== navigationSessionId) return
        const point = updateCurrentLocation(coords)
        if (!point) return

        if (destination && distanceBetween(point, destination) <= Math.max(30, Math.min(coords.accuracy, 50))) {
          setDestinationReached(true)
          stopNavigationRef.current()
          queueNavigationSpeech(kurmanciArrivalInstruction())
          return
        }

        const activeRoute = routeRef.current
        if (activeRoute?.steps.length) {
          const earlyAnnouncementDistance = travelMode === 'foot' ? 150 : 800
          const repeatAnnouncementDistance = travelMode === 'foot' ? 30 : 170
          const turnAnnouncementDistance = travelMode === 'foot' ? 10 : 35
          let currentIndex = Math.min(stepIndexRef.current, activeRoute.steps.length - 1)
          let currentStep = activeRoute.steps[currentIndex]
          let [maneuverLon, maneuverLat] = currentStep.maneuver.location
          const getManeuverDistance = (index: number, maneuverPoint: Point) => {
            const approachStep = activeRoute.steps[index - 1]
            const routeDistance = approachStep
              ? distanceAlongRouteToEnd(point, approachStep.geometry.coordinates)
              : Number.POSITIVE_INFINITY
            return Number.isFinite(routeDistance)
              ? routeDistance
              : distanceBetween(point, maneuverPoint)
          }
          let maneuverDistance = getManeuverDistance(currentIndex, { lat: maneuverLat, lon: maneuverLon })
          const speechLines: string[] = []
          const announcementPhase = (step: RouteStep, distance: number) => {
            if (distance <= turnAnnouncementDistance && step.maneuver.type !== 'arrive') return 'now' as const
            if (distance <= repeatAnnouncementDistance) return 'repeat' as const
            if (distance <= earlyAnnouncementDistance) return 'early' as const
            return null
          }
          const addAnnouncement = (index: number, step: RouteStep, distance: number) => {
            const phase = announcementPhase(step, distance)
            if (!phase) return
            const instruction = maneuverAnnouncement(index, step, distance, phase)
            if (instruction) speechLines.push(instruction)
          }

          addAnnouncement(currentIndex, currentStep, maneuverDistance)
          while (
            currentIndex < activeRoute.steps.length - 1 &&
            maneuverDistance < turnAnnouncementDistance
          ) {
            const immediateInstruction = maneuverAnnouncement(currentIndex, currentStep, maneuverDistance, 'now')
            if (immediateInstruction) speechLines.push(immediateInstruction)
            currentIndex += 1
            currentStep = activeRoute.steps[currentIndex]
            ;[maneuverLon, maneuverLat] = currentStep.maneuver.location
            maneuverDistance = getManeuverDistance(currentIndex, { lat: maneuverLat, lon: maneuverLon })
            addAnnouncement(currentIndex, currentStep, maneuverDistance)
          }
          if (currentIndex !== stepIndexRef.current) {
            stepIndexRef.current = currentIndex
            setStepIndex(currentIndex)
          }

          const preciseDistance = Math.max(0, Math.round(maneuverDistance))
          setNextTurnDistance((previousDistance) => previousDistance === preciseDistance ? previousDistance : preciseDistance)
          if (speechLines.length) queueNavigationSpeech(speechLines.join(' '))

          const offRouteDistance = distanceToRoute(point, activeRoute.geometry.coordinates)
          const now = Date.now()
          if (
            destination &&
            offRouteDistance > Math.max(65, coords.accuracy * 1.5) &&
            now - lastRerouteRef.current > 12_000 &&
            !reroutingRef.current
          ) {
            lastRerouteRef.current = now
            reroutingRef.current = true
            clearNavigationSpeech()
            queueNavigationSpeech('Rê ji nû ve tê hesabkirin.')
            const requestId = ++routeRequestRef.current
            setRouting(true)
            setRouteError('')
            void getRoute(point, destination, travelMode)
              .then((newRoute) => {
                if (routeRequestRef.current === requestId) {
                  setRoute(newRoute)
                  const nextStep = Math.min(1, newRoute.steps.length - 1)
                  stepIndexRef.current = nextStep
                  setStepIndex(nextStep)
                  setNextTurnDistance(null)
                  announcedManeuversRef.current.clear()
                  const nextManeuver = newRoute.steps[nextStep]
                  const distanceToNextManeuver = newRoute.steps[0]?.distance ?? nextManeuver.distance
                  if (voiceEnabledRef.current && nextStep > 0 && nextManeuver.maneuver.type !== 'depart') {
                    announcedManeuversRef.current.set(nextStep, new Set<'early' | 'repeat' | 'now'>(['early']))
                  }
                  queueNavigationSpeech(`Rê ji nû ve hate hesabkirin. ${kurmanciInstructionFor(nextManeuver, true, distanceToNextManeuver, 'early')}`)
                }
              })
              .catch(() => {
                if (routeRequestRef.current === requestId) {
                  setRouteError('Neue Route konnte nicht berechnet werden. Die Navigation wird auf der bisherigen Route fortgesetzt.')
                  queueNavigationSpeech('Rê ji nû ve nehat hesabkirin. Bi rêya heyî berdewam bike.')
                }
              })
              .finally(() => {
                reroutingRef.current = false
                if (routeRequestRef.current === requestId) setRouting(false)
              })
          }
        }
      },
      () => {
        setGpsStatus('error')
        setGpsMessage('Standort nicht verfügbar.')
        setFollowLocation(false)
      },
      { enableHighAccuracy: true, maximumAge: 1_000, timeout: 15_000 },
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [destination, isNavigating, travelMode, voiceEnabled])

  const activeStep: RouteStep | undefined = route?.steps[Math.min(stepIndex, (route?.steps.length ?? 1) - 1)]

  useEffect(() => {
    if (!speechCue || !voiceEnabled || speechCue.id === processedSpeechEventRef.current) return
    const audioContext = audioContextRef.current
    if (!audioContext) {
      finishNavigationSpeech()
      return
    }

    processedSpeechEventRef.current = speechCue.id
    const requestId = ++speechRequestRef.current
    let requestCancelled = false
    let requestFinished = false
    let requestSynthesized = false
    const worker = ttsWorkerRef.current ?? new Worker(
      new URL('../workers/kurmanci-tts.worker.ts', import.meta.url),
      { type: 'module' },
    )
    ttsWorkerRef.current = worker

    const stopCurrentAudio = () => {
      if (!audioSourceRef.current) return
      audioSourceRef.current.onended = null
      audioSourceRef.current.stop()
      audioSourceRef.current.disconnect()
      audioSourceRef.current = null
    }
    stopCurrentAudio()

    const handleWorkerMessage = (event: MessageEvent<{
      type: 'status' | 'progress' | 'cached' | 'audio' | 'error'
      requestId: number
      status?: 'loading-runtime' | 'loading-model' | 'synthesizing'
      loaded?: number
      total?: number
      samples?: ArrayBuffer
      sampleRate?: number
    }>) => {
      const message = event.data
      if (requestCancelled || message.requestId !== requestId) return

      if (message.type === 'error') {
        requestFinished = true
        setSpeechError('Dengê rêberiyê nayê çêkirin. Dîsa biceribîne.')
        finishNavigationSpeech()
        return
      }

      if (message.type !== 'audio') return
      requestSynthesized = true
      if (!message.samples || !message.sampleRate) {
        requestFinished = true
        setSpeechError('Dengê rêberiyê nayê çêkirin. Dîsa biceribîne.')
        finishNavigationSpeech()
        return
      }

      void (async () => {
        if (audioContext.state === 'suspended') await audioContext.resume()
        if (requestCancelled) return
        if (audioContext.state !== 'running') throw new Error('audio_context_not_running')
        const samples = new Float32Array(message.samples!)
        if (!samples.length || !samples.some((sample) => Math.abs(sample) > 0.00001)) {
          throw new Error('synthesis_returned_silence')
        }
        const audioBuffer = audioContext.createBuffer(1, samples.length, message.sampleRate!)
        audioBuffer.copyToChannel(samples, 0)
        const source = audioContext.createBufferSource()
        source.buffer = audioBuffer
        source.playbackRate.value = 1.12
        source.connect(audioContext.destination)
        source.onended = () => {
          if (audioSourceRef.current === source) audioSourceRef.current = null
          source.disconnect()
          requestFinished = true
          finishNavigationSpeech()
        }
        audioSourceRef.current = source
        source.start()
        setSpeechError('')
      })().catch(() => {
        if (!requestCancelled) {
          requestFinished = true
          setSpeechError('Dengê rêberiyê nayê çêkirin. Dîsa biceribîne.')
          finishNavigationSpeech()
        }
      })
    }

    const handleWorkerError = () => {
      if (requestCancelled) return
      requestFinished = true
      setSpeechError('Dengê rêberiyê nayê çêkirin. Dîsa biceribîne.')
      finishNavigationSpeech()
    }

    worker.addEventListener('message', handleWorkerMessage)
    worker.addEventListener('error', handleWorkerError)
    worker.postMessage({
      requestId,
      text: speechCue.text,
      type: 'speak',
    })

    return () => {
      requestCancelled = true
      if (!requestFinished && !requestSynthesized) worker.postMessage({ requestId, type: 'cancel' })
      worker.removeEventListener('message', handleWorkerMessage)
      worker.removeEventListener('error', handleWorkerError)
      if (!requestFinished) stopCurrentAudio()
    }
  }, [speechCue, voiceEnabled])

  useEffect(() => () => {
    ttsWorkerRef.current?.terminate()
    void audioContextRef.current?.close()
  }, [])

  const startNavigation = () => {
    if (!route || route.mode !== travelMode) return
    navigationSessionRef.current += 1
    void prepareAudio()
    lastLocationRenderRef.current = 0
    lastRerouteRef.current = Date.now()
    const nextStep = Math.min(1, route.steps.length - 1)
    stepIndexRef.current = nextStep
    setStepIndex(nextStep)
    setNextTurnDistance(null)
    announcedManeuversRef.current.clear()
    const openingLines: string[] = []
    const departureStep = route.steps[0]
    if (departureStep?.maneuver.type === 'depart') {
      openingLines.push(kurmanciInstructionFor(departureStep, false))
    }
    const nextManeuver = route.steps[nextStep]
    if (nextStep > 0 && nextManeuver) {
      const distanceToManeuver = departureStep?.distance ?? nextManeuver.distance
      openingLines.push(kurmanciInstructionFor(nextManeuver, true, distanceToManeuver, 'early'))
      if (voiceEnabled) announcedManeuversRef.current.set(nextStep, new Set<'early' | 'repeat' | 'now'>(['early']))
    }
    queueNavigationSpeech(openingLines.join(' '))
    setDestinationReached(false)
    setRouteError('')
    setFollowLocation(true)
    setHeadingUpEnabled(true)
    setIsNavigating(true)
  }

  const stopNavigation = () => {
    navigationSessionRef.current += 1
    setIsNavigating(false)
    setFollowLocation(false)
    setHeading(null)
    setRouting(false)
    routeRequestRef.current += 1
    reroutingRef.current = false
    announcedManeuversRef.current.clear()
    clearNavigationSpeech()
  }
  stopNavigationRef.current = stopNavigation

  const toggleRotation = () => {
    const nextMode = !headingUpEnabled
    setHeadingUpEnabled(nextMode)
    setHeading(null)
  }

  const requestZoom = (direction: -1 | 1) => {
    setZoomRequest((request) => ({ id: request.id + 1, direction }))
  }

  const returnToDrivingPerspective = () => {
    setFollowLocation(true)
    setHeadingUpEnabled(true)
    requestLocation()
  }

  const openNavigationSearch = () => {
    setQuery('')
    setResults([])
    setSearchError('')
    setActiveSearch('destination')
  }

  const prepareNewRoute = () => {
    if (currentLocationRef.current) {
      originEditedRef.current = false
      setOrigin(currentLocationRef.current)
      setOriginName('Mein Standort')
      setOriginQuery('Mein Standort')
    }
    clearDestination()
  }

  const toggleVoice = () => {
    const nextVoiceEnabled = !voiceEnabled
    voiceEnabledRef.current = nextVoiceEnabled
    if (nextVoiceEnabled) void prepareAudio()
    else clearNavigationSpeech()
    setVoiceEnabled(nextVoiceEnabled)
  }

  const clearDestination = () => {
    routeRequestRef.current += 1
    navigationSessionRef.current += 1
    setDestination(null)
    setDestinationName('')
    setQuery('')
    setRoute(null)
    setRouteError('')
    setRouting(false)
    setIsNavigating(false)
    clearNavigationSpeech()
    setDestinationReached(false)
    setNextTurnDistance(null)
    setResults([])
    setOriginResults([])
  }

  const swapStops = async () => {
    if (!origin && !destination && !originQuery.trim() && !query.trim()) return
    if (isNavigating) stopNavigation()
    else navigationSessionRef.current += 1
    routeRequestRef.current += 1
    const requestId = routeRequestRef.current
    const previousOrigin = origin
    const previousDestination = destination
    const previousOriginName = originName || (origin ? 'Mein Standort' : '')
    const previousDestinationName = destinationName
    const nextOriginText = query || destinationName
    const nextDestinationText = originQuery || previousOriginName
    originEditedRef.current = true
    setOrigin(destination)
    setDestination(origin)
    setOriginName(previousDestinationName)
    setDestinationName(previousOriginName)
    setOriginQuery(nextOriginText)
    setOriginResults([])
    setRoute(null)
    setRouteError('')
    setRouting(false)
    setIsNavigating(false)
    clearNavigationSpeech()
    announcedManeuversRef.current.clear()
    stepIndexRef.current = 0
    setStepIndex(0)
    setQuery(nextDestinationText)
    setResults([])
    setDestinationReached(false)
    setNextTurnDistance(null)
    if (!previousOrigin || !previousDestination) return

    setRouting(true)
    try {
      const nextRoute = await getRoute(previousDestination, previousOrigin, travelMode)
      if (routeRequestRef.current === requestId) setRoute(nextRoute)
    } catch (error) {
      if (routeRequestRef.current === requestId) {
        setRouteError(routeFailureMessage(error))
      }
    } finally {
      if (routeRequestRef.current === requestId) setRouting(false)
    }
  }

  const remainingDistance = route?.steps.slice(stepIndex).reduce((total, step) => total + step.distance, 0) ?? 0
  const remainingDuration = route?.steps.slice(stepIndex).reduce((total, step) => total + step.duration, 0) ?? 0
  const activeNavigationStep = route?.steps[stepIndex]
  const distanceAfterTurn = route?.steps.slice(stepIndex + 1).reduce((total, step) => total + step.distance, 0) ?? 0
  const durationAfterTurn = route?.steps.slice(stepIndex + 1).reduce((total, step) => total + step.duration, 0) ?? 0
  const liveRemainingDistance = isNavigating && nextTurnDistance !== null
    ? nextTurnDistance + distanceAfterTurn
    : remainingDistance
  const liveRemainingDuration = isNavigating && nextTurnDistance !== null && activeNavigationStep?.distance
    ? Math.min(1, nextTurnDistance / activeNavigationStep.distance) * activeNavigationStep.duration + durationAfterTurn
    : remainingDuration
  const arrivalTime = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(Date.now() + liveRemainingDuration * 1_000),
  )
  return (
    <main className={`app-shell ${isNavigating ? 'app-shell--navigating' : ''}`}>
      <NavigationMap
        origin={origin}
        destination={destination}
        currentLocation={currentLocation}
        route={route}
        isNavigating={isNavigating}
        followLocation={followLocation}
        headingUpEnabled={headingUpEnabled}
        heading={headingUpEnabled ? heading : null}
        centerRequest={mapCenterRequest}
        zoomRequest={zoomRequest}
        onManualPan={() => {
          setFollowLocation(false)
          setHeadingUpEnabled(false)
        }}
      />
      <div className="map-brand-chip" aria-hidden="true">
        <span className="brand-mark"><Navigation size={17} strokeWidth={2.4} /></span>
        <span>Rêber</span>
      </div>
      <div className={`map-location-control ${isNavigating ? 'map-location-control--navigation' : ''}`}>
        {isNavigating && (
          <button
            className="map-control-button"
            type="button"
            onClick={toggleVoice}
            aria-label={voiceEnabled ? 'Sprachausgabe pausieren' : 'Sprachausgabe aktivieren'}
            aria-pressed={voiceEnabled}
            title={voiceEnabled ? 'Sprachausgabe aktiviert' : 'Sprachausgabe pausiert'}
          >
            <span className={`audio-control-icon ${voiceEnabled ? '' : 'audio-control-icon--muted'}`}>
              <Volume2 size={19} />
            </span>
          </button>
        )}
        <button className="map-control-button map-zoom-button" type="button" onClick={() => requestZoom(1)} aria-label="Vergrößern" title="Vergrößern">
          <Plus size={20} />
        </button>
        <button className="map-control-button map-zoom-button" type="button" onClick={() => requestZoom(-1)} aria-label="Verkleinern" title="Verkleinern">
          <Minus size={20} />
        </button>
        <button
          className={`map-control-button ${headingUpEnabled ? 'map-control-button--active' : ''}`}
          type="button"
          onClick={toggleRotation}
          aria-label={headingUpEnabled ? 'Karte nach Norden ausrichten' : travelMode === 'foot' ? 'Karte in Laufrichtung drehen' : 'Karte in Fahrtrichtung drehen'}
          aria-pressed={headingUpEnabled}
          title={headingUpEnabled ? 'Norden oben' : travelMode === 'foot' ? 'In Laufrichtung drehen' : 'In Fahrtrichtung drehen'}
        >
          <Compass size={19} />
        </button>
        <button className={`map-control-button ${followLocation && headingUpEnabled ? 'map-control-button--active' : 'map-control-button--inactive'}`} type="button" onClick={returnToDrivingPerspective} aria-label="Zur Fahrperspektive zurückkehren" title="Zur Fahrperspektive zurückkehren" aria-pressed={followLocation && headingUpEnabled}>
          {gpsStatus === 'loading' ? <LoaderCircle className="spin" size={19} /> : <LocateFixed size={19} />}
        </button>
      </div>

      {gpsMessage && <div className={`map-status-banner ${gpsStatus === 'error' ? 'map-status-banner--centered' : ''}`} role="status">{gpsMessage}</div>}
      {routeError && <div className="map-status-banner map-status-banner--error" role="alert">{routeError}</div>}
      {speechError && <div className="map-status-banner map-status-banner--error" role="alert">{speechError}</div>}
      {destinationReached && (
        <div className="destination-reached-banner" role="status">
          <strong>Am Ziel</strong>
          <button type="button" onClick={prepareNewRoute}>Neue Route starten</button>
        </div>
      )}

      <section className={`navigation-panel ${isNavigating ? 'navigation-panel--active' : ''} ${activeSearch ? 'navigation-panel--search-results' : ''}`}>
        <header className="panel-header">
          <div className="wordmark">
            <span className="wordmark-icon"><Navigation size={17} strokeWidth={2.4} /></span>
            <span>Rêber</span>
            <span className="wordmark-caption">IHRE NAVIGATION</span>
          </div>
          <div className="header-state"><span className="state-dot" /> LIVE</div>
        </header>

        {isNavigating && activeStep && !activeSearch ? (
          <div className="turn-card">
            <span className="turn-card-arrow"><ManeuverArrow step={activeStep} /></span>
            <div className="turn-card-copy">
              <div className="turn-eyebrow"><span className="turn-indicator" /> NÄCHSTE ANWEISUNG</div>
              <h1>{germanInstructionFor(activeStep, true, nextTurnDistance ?? undefined)}</h1>
              <p>{activeStep.name || 'Hauptstraße'}</p>
            </div>
            <button className="navigation-search-button" type="button" onClick={openNavigationSearch} aria-label="Neues Ziel suchen" title="Neues Ziel suchen"><Search size={20} /></button>
          </div>
        ) : !activeSearch ? (
          <div className="panel-intro">
            <div className="eyebrow"><Compass size={14} /> NAVIGATION</div>
            <h1>Wohin soll es gehen?</h1>
            <p>Ziel eingeben, Route auswählen und losfahren.</p>
          </div>
        ) : null}

        {activeSearch ? (
          <section className="search-results-view" aria-label="Suchergebnisse" aria-live="polite">
            <header className="search-results-view-header">
              <button className="search-results-back" type="button" onClick={closeSearchResults} aria-label="Zurück zur Suche">
                <ArrowLeft size={18} />
              </button>
              <div className="search-results-heading">
                <strong>{activeSearch === 'origin' ? 'STARTORTE' : 'ZIELE'}</strong>
                <small>{activeSearchLoading ? 'Orte werden gesucht…' : searchError || `${activeSearchResults.length} ${activeSearchResults.length === 1 ? 'Ort gefunden' : 'Orte gefunden'}`}</small>
              </div>
            </header>
            <form className="search-results-form" onSubmit={activeSearch === 'origin' ? searchOriginPlaces : searchPlaces}>
              <input
                id="search-results-query"
                value={activeSearch === 'origin' ? originQuery : query}
                onChange={(event) => activeSearch === 'origin' ? setOriginQuery(event.target.value) : setQuery(event.target.value)}
                placeholder={activeSearch === 'origin' ? 'Startort suchen' : 'Ziel suchen'}
                autoComplete="off"
                autoFocus
              />
              <button className="search-submit search-submit--small" type="submit" aria-label="Orte suchen" disabled={activeSearchLoading}>
                {activeSearchLoading ? <LoaderCircle className="spin" size={14} /> : <Search size={14} />}
              </button>
            </form>
            <div className="search-results-list" role="list">
              {activeSearchLoading ? (
                <div className="search-results-status"><LoaderCircle className="spin" size={19} /><span>Orte werden gesucht…</span></div>
              ) : activeSearchResults.length > 0 ? (
                activeSearchResults.map((place) => (
                  <div className="search-result-item" key={place.place_id} role="listitem">
                    <button
                      className="result-row"
                      type="button"
                      onClick={() => activeSearch === 'origin' ? chooseOrigin(place) : void chooseDestination(place)}
                    >
                      <span className="result-icon"><MapPin size={17} /></span>
                      <span className="result-name"><strong>{placeTitle(place)}</strong><small>{placeSubtitle(place)}</small></span>
                      <ArrowUpRight size={16} className="result-arrow" />
                    </button>
                  </div>
                ))
              ) : searchError ? (
                <div className="search-results-status search-results-status--error" role="alert"><Search size={18} /><span>{searchError}</span></div>
              ) : (
                <div className="search-results-status"><Search size={18} /><span>Keine Orte gefunden.</span></div>
              )}
            </div>
          </section>
        ) : (
        <div className="route-form-block">
          <div className="route-stops">
            <div className="stop-rail">
              <span className="stop-dot stop-dot--start" />
              <span className="stop-line" />
              <button
                className="swap-stops-button"
                type="button"
                onClick={() => void swapStops()}
                disabled={!origin && !destination && !originQuery.trim() && !query.trim()}
                aria-label="Start und Ziel tauschen"
                title="Start und Ziel tauschen"
              >
                <ArrowUpDown size={16} />
              </button>
              <span className="stop-dot stop-dot--end" />
            </div>
            <div className="stop-fields">
              <div className="origin-field">
                <label className="field-label" htmlFor="origin-search">VON</label>
                <form className="search-form origin-search-form" onSubmit={searchOriginPlaces}>
                  <input
                    id="origin-search"
                    value={originQuery}
                    onChange={(event) => editOriginInput(event.target.value)}
                    placeholder={gpsStatus === 'loading' ? 'Standort wird ermittelt…' : 'Startort suchen'}
                    autoComplete="off"
                  />
                  <button className="search-submit search-submit--small" type="submit" aria-label="Startort suchen" disabled={searchingOrigin}>
                    {searchingOrigin ? <LoaderCircle className="spin" size={14} /> : <Search size={14} />}
                  </button>
                  <button className="origin-location-button origin-location-button--small" type="button" onClick={requestOriginLocation} aria-label="Meinen Standort als Startpunkt verwenden" title="Meinen Standort als Startpunkt verwenden">
                    {gpsStatus === 'loading' ? <LoaderCircle className="spin" size={14} /> : <LocateFixed size={14} />}
                  </button>
                </form>
              </div>
              <div className="destination-field">
                <label className="field-label" htmlFor="destination-search">NACH</label>
                <form className="search-form" onSubmit={searchPlaces}>
                  <input
                    id="destination-search"
                    value={query}
                    onChange={(event) => editDestinationInput(event.target.value)}
                    placeholder="Ziel suchen"
                    autoComplete="off"
                  />
                  <button className="search-submit search-submit--small" type="submit" aria-label="Orte suchen" disabled={searching}>
                    {searching ? <LoaderCircle className="spin" size={14} /> : <Search size={14} />}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
        )}

        {destination && origin && !isNavigating && !activeSearch && (
          <div className="route-action-footer">
            <div className="travel-mode-picker" role="group" aria-label="Verkehrsmittel">
              <button
                className={`travel-mode-button ${travelMode === 'driving' ? 'travel-mode-button--active' : ''}`}
                type="button"
                onClick={() => void selectTravelMode('driving')}
                aria-pressed={travelMode === 'driving'}
              >
                <CarFront size={19} />
                <span>Auto</span>
              </button>
              <button
                className={`travel-mode-button ${travelMode === 'foot' ? 'travel-mode-button--active' : ''}`}
                type="button"
                onClick={() => void selectTravelMode('foot')}
                aria-pressed={travelMode === 'foot'}
              >
                <Footprints size={19} />
                <span>Zu Fuß</span>
              </button>
            </div>
            {route?.mode === travelMode && !routing && (
              <button className="primary-button start-button" type="button" onClick={startNavigation}>
                <Play size={16} fill="currentColor" />
                <span>Route starten</span>
                <ArrowUpRight size={17} className="button-arrow" />
              </button>
            )}
            {routing && <div className="route-loading"><LoaderCircle className="spin" size={17} /><span>Route wird berechnet…</span></div>}
          </div>
        )}

        {isNavigating && route && !activeSearch && (
          <div className="navigation-drawer">
            <div className="navigation-footer">
              <div className="navigation-stats" aria-label="Routeninformationen">
                <div className="navigation-stat"><span>REST</span><strong className="estimate-distance">{formatDistance(liveRemainingDistance)}</strong></div>
                <div className="navigation-stat"><span>ZEIT</span><strong className="estimate-duration">{formatClockDuration(liveRemainingDuration)}</strong></div>
              </div>
              <div className="navigation-arrival-stop">
                <div className="navigation-stat"><span>ANKUNFT</span><strong>{arrivalTime}</strong></div>
                <button type="button" className="stop-button" onClick={stopNavigation} aria-label="Navigation beenden" title="Navigation beenden"><X size={20} strokeWidth={2.5} /></button>
              </div>
            </div>
          </div>
        )}

        {!route && !destination && (
          <div className="empty-route">
            <span className="empty-route-icon"><MapPin size={19} /></span>
            <div><strong>Route planen</strong><p>Wählen Sie einen Startpunkt und ein Ziel.</p></div>
          </div>
        )}

        <footer className="panel-footer">
          <span><i /> OFFENE DIENSTE</span>
          <span>OSM <b>·</b> OSRM <b>·</b> NOMINATIM</span>
        </footer>
      </section>

      {route && !isNavigating && (
        <section className="route-results-panel" aria-label="Routenübersicht" aria-live="polite">
          <section className="route-summary">
            <div className="summary-topline"><span>EMPFOHLENE ROUTE</span></div>
            <div className="summary-destination"><MapPin size={16} /><strong>{destinationName}</strong></div>
            <div className="summary-main">
              <div className="summary-metric summary-metric--duration"><strong>{formatDuration(route.duration)}</strong><span>REISEZEIT</span></div>
              <div className="summary-divider" />
              <div className="summary-metric summary-metric--distance"><strong>{formatDistance(route.distance)}</strong><span>STRECKE</span></div>
            </div>
          </section>
        </section>
      )}

      {route && !isNavigating && (
        <div className="floating-route-pill"><Clock3 size={15} /><strong className="estimate-duration">{formatClockDuration(route.duration)}</strong><span>·</span><span className="estimate-distance">{formatDistance(route.distance)}</span></div>
      )}

    </main>
  )
}

import { createFileRoute } from '@tanstack/react-router'
import {
  ArrowLeft,
  ArrowUpDown,
  ArrowUpRight,
  BookOpen,
  Box,
  CarFront,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Compass,
  Footprints,
  Languages,
  LocateFixed,
  LoaderCircle,
  MapPin,
  Menu as MenuIcon,
  Minus,
  Navigation,
  Plus,
  Play,
  Search,
  Volume2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { NavigationMap } from '@/components/NavigationMap'
import LaneGuidance from '@/components/LaneGuidance'
import { getLaneGuidance } from '@/lib/lane-guidance'
import {
  createNavigationGuidance,
  distanceBetween,
  distanceAlongRouteToEnd,
  distanceToRoute,
  findPlaces,
  formatClockDuration,
  formatDistance,
  formatDuration,
  germanInstructionFor,
  getRoute,
  placeSubtitle,
  placeTitle,
  type NavigationGuidance,
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

type SpeechLanguage = 'de' | 'ku'
type SpeechCue = { id: number; text: string; stepIndex?: number; language: SpeechLanguage }

function SpeechLanguagePicker({
  language,
  onChange,
}: {
  language: SpeechLanguage
  onChange: (language: SpeechLanguage) => void
}) {
  return (
    <div className="speech-language-picker">
      <span className="speech-language-label">Sprache der Navigationsansagen</span>
      <div className="speech-language-options" role="group" aria-label="Sprache der Navigationsansagen">
        <button
          className={`speech-language-button ${language === 'de' ? 'speech-language-button--active' : ''}`}
          type="button"
          onClick={() => onChange('de')}
          aria-pressed={language === 'de'}
        >
          Deutsch (Standard)
        </button>
        <button
          className={`speech-language-button ${language === 'ku' ? 'speech-language-button--active' : ''}`}
          type="button"
          onClick={() => onChange('ku')}
          aria-pressed={language === 'ku'}
        >
          Kurmancî
        </button>
      </div>
    </div>
  )
}

function RouteDirections({ route, stepIndex }: { route: NavigationRoute; stepIndex: number }) {
  const steps = route.steps.slice(stepIndex)

  return (
    <section className="menu-directions" aria-label="Wegbeschreibung">
      <div className="directions-heading">
        <span>ROUTENSCHRITTE</span>
        <span>{steps.length} SCHRITTE</span>
      </div>
      <div className="directions-list" role="list">
        {steps.map((step, index) => (
          <div className={`direction-row ${index === 0 ? 'direction-row--current' : ''}`} key={`${step.maneuver.type}-${step.maneuver.location.join(',')}-${index}`} role="listitem">
            <span className="direction-number"><ManeuverArrow step={step} /></span>
            <span className="direction-copy"><strong>{germanInstructionFor(step, false)}</strong></span>
            <span className="direction-distance">{formatDistance(step.distance)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

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
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null)
  const [speed, setSpeed] = useState<number | null>(null)
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
  const [appMenuOpen, setAppMenuOpen] = useState(false)
  const [appMenuSection, setAppMenuSection] = useState<'main' | 'directions' | 'language'>('main')
  const [followLocation, setFollowLocation] = useState(true)
  const [heading, setHeading] = useState<number | null>(null)
  const [headingUpEnabled, setHeadingUpEnabled] = useState(false)
  const [mapPerspective, setMapPerspective] = useState<'top' | 'tilted' | 'driving'>('top')
  const threeDEnabled = mapPerspective !== 'top'
  const [zoomRequest, setZoomRequest] = useState<ZoomRequest>({ id: 0, direction: 1 })
  const [guidance, setGuidance] = useState<NavigationGuidance | null>(null)
  const [destinationReached, setDestinationReached] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [speechLanguage, setSpeechLanguage] = useState<SpeechLanguage>('de')
  const [speechCue, setSpeechCue] = useState<SpeechCue | null>(null)
  const [speechError, setSpeechError] = useState('')
  const [mapCenterRequest, setMapCenterRequest] = useState(0)
  const [drivingPerspectiveRequest, setDrivingPerspectiveRequest] = useState(0)
  const [stepIndex, setStepIndex] = useState(0)
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const hasValidOrigin = Boolean(origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lon))
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
  const speechQueueRef = useRef<SpeechCue[]>([])
  const speechPlayingRef = useRef(false)
  const speechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const announcedManeuversRef = useRef(new Map<number, Set<'early' | 'repeat' | 'now'>>())
  const currentLocationRef = useRef<Point | null>(null)
  const appMenuRef = useRef<HTMLDivElement | null>(null)
  const originEditedRef = useRef(false)
  const destinationRef = useRef(destination)
  const lastLocationFixAtRef = useRef(0)
  const lastLocationRenderRef = useRef(0)
  const headingUpRef = useRef(headingUpEnabled)
  const voiceEnabledRef = useRef(voiceEnabled)
  const speechLanguageRef = useRef(speechLanguage)
  const stopNavigationRef = useRef<(preserveSpeech?: boolean) => void>(() => undefined)
  headingUpRef.current = headingUpEnabled
  voiceEnabledRef.current = voiceEnabled
  speechLanguageRef.current = speechLanguage
  routeRef.current = route
  destinationRef.current = destination
  stepIndexRef.current = stepIndex

  useEffect(() => {
    if (!appMenuOpen) return
    const closeMenuOutside = (event: PointerEvent) => {
      if (!appMenuRef.current?.contains(event.target as Node)) setAppMenuOpen(false)
    }
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAppMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeMenuOutside)
    document.addEventListener('keydown', closeMenuOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeMenuOutside)
      document.removeEventListener('keydown', closeMenuOnEscape)
    }
  }, [appMenuOpen])

  const guidanceSpeechText = (currentGuidance: NavigationGuidance, language = speechLanguageRef.current) =>
    language === 'de' ? currentGuidance.germanText : currentGuidance.kurmanciText

  const queueNavigationSpeech = (
    text: string,
    stepIndex?: number,
    language = speechLanguageRef.current,
  ) => {
    if (!voiceEnabledRef.current || !text.trim()) return
    const cue = { id: ++speechEventRef.current, text, stepIndex, language }
    if (speechPlayingRef.current) speechQueueRef.current = [cue]
    else {
      speechPlayingRef.current = true
      setSpeechCue(cue)
    }
  }

  const clearNavigationSpeech = () => {
    speechQueueRef.current = []
    speechPlayingRef.current = false
    setSpeechCue(null)
    if (speechUtteranceRef.current) {
      speechUtteranceRef.current.onend = null
      speechUtteranceRef.current.onerror = null
      window.speechSynthesis.cancel()
      speechUtteranceRef.current = null
    }
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

  const maneuverAnnouncement = (currentGuidance: NavigationGuidance) => {
    if (!voiceEnabledRef.current || currentGuidance.stepIndex === 0 || currentGuidance.step.maneuver.type === 'depart') return null
    if (currentGuidance.distanceMeters === null || currentGuidance.phase === null) return null
    const announced = announcedManeuversRef.current.get(currentGuidance.stepIndex) ?? new Set<'early' | 'repeat' | 'now'>()
    if (announced.has(currentGuidance.phase)) return null
    announced.add(currentGuidance.phase)
    if (currentGuidance.phase === 'repeat') announced.add('early')
    if (currentGuidance.phase === 'now') {
      announced.add('early')
      announced.add('repeat')
    }
    announcedManeuversRef.current.set(currentGuidance.stepIndex, announced)
    return guidanceSpeechText(currentGuidance)
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

  const routeFailureMessage = (error: unknown) => {
    const safeMessages = [
      'Route konnte nicht berechnet werden. Bitte erneut versuchen.',
      'Zwischen diesen Orten wurde keine Route gefunden.',
    ]
    return error instanceof Error && safeMessages.includes(error.message)
      ? error.message
      : 'Die Route konnte nicht berechnet werden. Bitte prüfen Sie Start und Ziel und versuchen Sie es erneut.'
  }

  const updateCurrentLocation = (coords: GeolocationCoordinates, forceRender = false, forceHeading = false) => {
    if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) return null
    const accuracy = coords.accuracy
    const previous = currentLocationRef.current
    const now = Date.now()
    if (accuracy > 100) {
      setGpsStatus('error')
      return null
    }

    const incoming = { lat: coords.latitude, lon: coords.longitude }
    if (previous) {
      const movement = distanceBetween(previous, incoming)
      const elapsedSeconds = Math.max(0, now - lastLocationFixAtRef.current) / 1_000
      const plausibleMovement = Math.max(80, Math.max(8, Math.min(coords.speed ?? 20, 45)) * elapsedSeconds * 2 + accuracy * 1.5)
      if (accuracy > 35 && movement > plausibleMovement) {
        return null
      }
    }

    currentLocationRef.current = incoming
    lastLocationFixAtRef.current = now
    setGpsStatus('ready')
    if (forceRender || !previous || now - lastLocationRenderRef.current >= 1_800) {
      lastLocationRenderRef.current = now
      setCurrentLocation(incoming)
      setGpsAccuracy(Number.isFinite(accuracy) ? accuracy : null)
      setSpeed(coords.speed !== null && Number.isFinite(coords.speed) ? Math.max(0, coords.speed) : null)
    }

    const course = coords.heading
    const minimumCourseSpeed = travelMode === 'foot' ? 0.35 : 1.2
    const maximumCourseAccuracy = travelMode === 'foot' ? 25 : 35
    const hasReliableCourse = accuracy <= maximumCourseAccuracy && coords.speed !== null && coords.speed > minimumCourseSpeed && course !== null && Number.isFinite(course)
    if (hasReliableCourse && (headingUpRef.current || forceHeading)) {
      setHeading((oldHeading) => {
        if (oldHeading === null) return course
        const difference = Math.abs(((course - oldHeading + 540) % 360) - 180)
        return difference > 3 ? course : oldHeading
      })
    } else if (headingUpRef.current || forceHeading) {
      setHeading(null)
    }

    return incoming
  }

  const requestLocation = (onLocated?: (point: Point) => void) => {
    if (!navigator.geolocation) {
      setGpsStatus('error')
      if (onLocated && currentLocationRef.current) {
        setCurrentLocation(currentLocationRef.current)
        onLocated(currentLocationRef.current)
      }
      return
    }
    setGpsStatus('loading')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const point = updateCurrentLocation(coords, true, Boolean(onLocated))
        if (!point) return
        setFollowLocation(true)
        if (onLocated) onLocated(point)
        else setMapCenterRequest((request) => request + 1)
      },
      () => {
        setGpsStatus('error')
        if (onLocated && currentLocationRef.current) {
          setCurrentLocation(currentLocationRef.current)
          onLocated(currentLocationRef.current)
        }
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 2_000 },
    )
  }

  const requestOriginLocation = () => {
    originEditedRef.current = false
    if (!navigator.geolocation) {
      setGpsStatus('error')
      setFollowLocation(false)
      return
    }
    setGpsStatus('loading')
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
        setGuidance(null)
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
    if (!hasValidOrigin || searching) return
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
      if (searchRequestRef.current === requestId) setSearchError('Die Suche ist momentan nicht verfügbar. Bitte versuchen Sie es erneut.')
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
      if (searchRequestRef.current === requestId) setSearchError('Die Suche ist momentan nicht verfügbar. Bitte versuchen Sie es erneut.')
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

  const chooseCurrentLocationAsOrigin = () => {
    closeSearchResults()
    requestOriginLocation()
  }

  const resetRouteForStopEdit = () => {
    routeRequestRef.current += 1
    navigationSessionRef.current += 1
    setRoute(null)
    setGuidance(null)
    setRouteError('')
    setRouting(false)
    setIsNavigating(false)
    clearNavigationSpeech()
    setStepIndex(0)
    setDestinationReached(false)
  }

  const editOriginInput = (value: string) => {
    originEditedRef.current = true
    searchRequestRef.current += 1
    setActiveSearch(null)
    setResults([])
    setOriginResults([])
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
    const point = { lat: Number(place.lat), lon: Number(place.lon) }
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return
    searchRequestRef.current += 1
    setActiveSearch(null)
    routeRequestRef.current += 1
    navigationSessionRef.current += 1
    originEditedRef.current = true
    setOrigin(point)
    const selectedOriginName = place.display_name.split(',').slice(0, 2).join(', ')
    setOriginName(selectedOriginName)
    setOriginQuery(selectedOriginName)
    setOriginResults([])
    setRoute(null)
    setGuidance(null)
    setRouting(false)
    setIsNavigating(false)
    clearNavigationSpeech()
    setStepIndex(0)
    setDestinationReached(false)
    setRouteError('')
    if (destination) {
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
    if (!hasValidOrigin) return
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
    setGuidance(null)
    setRouteError('')
    setDestinationReached(false)
    setIsNavigating(false)
    clearNavigationSpeech()
    setStepIndex(0)
    if (!startPoint) {
      const hasUnresolvedOrigin = originQuery.trim().length > 0
      if (!hasUnresolvedOrigin) {
        setGpsStatus('error')
      }
      setRouteError(hasUnresolvedOrigin ? 'Bitte wählen Sie einen Startort aus den Suchergebnissen.' : '')
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
    setGuidance(null)
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
      setFollowLocation(false)
      return
    }

    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        if (navigationSessionRef.current !== navigationSessionId) return
        const point = updateCurrentLocation(coords)
        if (!point) return

        const activeRoute = routeRef.current
        if (activeRoute?.steps.length) {
          const hasReachedDestination = Boolean(
            destination && distanceBetween(point, destination) <= Math.max(30, Math.min(coords.accuracy, 50)),
          )
          const offRouteDistance = distanceToRoute(point, activeRoute.geometry.coordinates)
          const now = Date.now()
          const offRouteThreshold = Math.max(65, coords.accuracy * 1.5)
          if (offRouteDistance <= offRouteThreshold || hasReachedDestination) {
            const activeIndex = hasReachedDestination ? activeRoute.steps.length - 1 : stepIndexRef.current
            const currentGuidance = createNavigationGuidance(
              activeRoute,
              point,
              activeIndex,
              coords.accuracy,
            )
            setGuidance(currentGuidance)
            if (currentGuidance) {
              const maneuverChanged = currentGuidance.stepIndex !== stepIndexRef.current
              if (maneuverChanged) {
                stepIndexRef.current = currentGuidance.stepIndex
                setStepIndex(currentGuidance.stepIndex)
              }
              const pendingCue = speechQueueRef.current[0]
              if (pendingCue?.stepIndex !== undefined) {
                speechQueueRef.current = pendingCue.stepIndex === currentGuidance.stepIndex && currentGuidance.distanceMeters !== null
                  ? [{ ...pendingCue, text: guidanceSpeechText(currentGuidance), language: speechLanguageRef.current }]
                  : []
              }
              const instruction = maneuverAnnouncement(currentGuidance)
              if (instruction) {
                clearNavigationSpeech()
                queueNavigationSpeech(instruction, currentGuidance.stepIndex)
              }
              else if (
                maneuverChanged &&
                currentGuidance.stepIndex > 0 &&
                currentGuidance.distanceMeters !== null &&
                currentGuidance.phase === null
              ) {
                clearNavigationSpeech()
                announcedManeuversRef.current.set(currentGuidance.stepIndex, new Set(['early']))
                queueNavigationSpeech(guidanceSpeechText(currentGuidance), currentGuidance.stepIndex)
              }
            }
          } else {
            setGuidance(null)
            clearNavigationSpeech()
          }

          if (hasReachedDestination) {
            setDestinationReached(true)
            stopNavigationRef.current(true)
            return
          }

          if (
            destination &&
            offRouteDistance > offRouteThreshold &&
            now - lastRerouteRef.current > 12_000 &&
            !reroutingRef.current
          ) {
            lastRerouteRef.current = now
            reroutingRef.current = true
            clearNavigationSpeech()
            const requestId = ++routeRequestRef.current
            setRouting(true)
            setRouteError('')
            void getRoute(point, destination, travelMode)
              .then((newRoute) => {
                if (routeRequestRef.current === requestId) {
                  const newGuidance = createNavigationGuidance(newRoute, point, 1, coords.accuracy)
                  routeRef.current = newRoute
                  setRoute(newRoute)
                  setGuidance(newGuidance)
                  const nextStep = newGuidance?.stepIndex ?? 0
                  stepIndexRef.current = nextStep
                  setStepIndex(nextStep)
                  announcedManeuversRef.current.clear()
                  if (newGuidance && nextStep > 0 && newGuidance.distanceMeters !== null) {
                    announcedManeuversRef.current.set(nextStep, new Set(['early', 'repeat', 'now']))
                    queueNavigationSpeech(guidanceSpeechText(newGuidance), nextStep)
                  }
                }
              })
              .catch(() => {
                if (routeRequestRef.current === requestId) {
                  setRouteError('Neue Route konnte nicht berechnet werden. Die Navigation wird auf der bisherigen Route fortgesetzt.')
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
        setFollowLocation(false)
      },
      { enableHighAccuracy: true, maximumAge: 1_000, timeout: 15_000 },
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [destination, isNavigating, travelMode, voiceEnabled])

  const activeGuidance = guidance?.route === route ? guidance : null
  const activeStep = activeGuidance?.step
  const laneGuidance = useMemo(() => isNavigating && !destinationReached
    ? getLaneGuidance(route, currentLocation, activeGuidance?.stepIndex ?? stepIndex)
    : null, [isNavigating, destinationReached, route, currentLocation, activeGuidance?.stepIndex, stepIndex])
  const perspectiveLabel = mapPerspective === 'top' ? '2D' : mapPerspective === 'tilted' ? '25°' : '3D'
  const nextPerspectiveLabel = mapPerspective === 'top' ? 'Nexşeya hinekî xwar' : mapPerspective === 'tilted' ? 'Dîtina ajotinê ya 3D' : 'Nexşeya 2D ji jor'

  useEffect(() => {
    if (!speechCue || !voiceEnabled || speechCue.id === processedSpeechEventRef.current) return
    processedSpeechEventRef.current = speechCue.id
    const requestId = ++speechRequestRef.current
    let requestCancelled = false
    let requestFinished = false

    if (speechCue.language === 'de') {
      if (typeof window.speechSynthesis === 'undefined') {
        setSpeechError('Die deutsche Sprachausgabe ist auf diesem Gerät nicht verfügbar.')
        finishNavigationSpeech()
        return
      }

      const synthesis = window.speechSynthesis
      const utterance = new SpeechSynthesisUtterance(speechCue.text)
      utterance.lang = 'de-DE'
      const germanVoice = synthesis.getVoices().find((voice) => voice.lang.toLowerCase().startsWith('de'))
      if (germanVoice) utterance.voice = germanVoice
      utterance.onend = () => {
        if (requestCancelled) return
        requestFinished = true
        speechUtteranceRef.current = null
        setSpeechError('')
        finishNavigationSpeech()
      }
      utterance.onerror = (event) => {
        if (requestCancelled) return
        requestFinished = true
        speechUtteranceRef.current = null
        if (event.error !== 'canceled' && event.error !== 'interrupted') {
          setSpeechError('Die deutsche Sprachausgabe konnte nicht abgespielt werden.')
        }
        finishNavigationSpeech()
      }
      speechUtteranceRef.current = utterance
      synthesis.speak(utterance)

      return () => {
        requestCancelled = true
        utterance.onend = null
        utterance.onerror = null
        if (speechUtteranceRef.current === utterance) {
          speechUtteranceRef.current = null
          if (!requestFinished) synthesis.cancel()
        }
      }
    }

    const audioContext = audioContextRef.current
    if (!audioContext) {
      finishNavigationSpeech()
      return
    }

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
        setSpeechError('Die Kurmancî-Sprachausgabe konnte nicht erstellt werden. Bitte erneut versuchen.')
        finishNavigationSpeech()
        return
      }

      if (message.type !== 'audio') return
      requestSynthesized = true
      if (!message.samples || !message.sampleRate) {
        requestFinished = true
        setSpeechError('Die Kurmancî-Sprachausgabe konnte nicht erstellt werden. Bitte erneut versuchen.')
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
          setSpeechError('Die Kurmancî-Sprachausgabe konnte nicht erstellt werden. Bitte erneut versuchen.')
          finishNavigationSpeech()
        }
      })
    }

    const handleWorkerError = () => {
      if (requestCancelled) return
      requestFinished = true
      setSpeechError('Die Kurmancî-Sprachausgabe konnte nicht erstellt werden. Bitte erneut versuchen.')
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
    setAppMenuOpen(false)
    const navigationSessionId = ++navigationSessionRef.current
    lastLocationRenderRef.current = 0
    lastRerouteRef.current = 0
    const nextStep = Math.min(1, route.steps.length - 1)
    announcedManeuversRef.current.clear()
    const startPoint = currentLocationRef.current
    const locationIsOnRoute = startPoint && distanceToRoute(startPoint, route.geometry.coordinates) <= 65
    const initialGuidance = startPoint && locationIsOnRoute
      ? createNavigationGuidance(route, startPoint, nextStep)
      : null
    const activeStepIndex = initialGuidance?.stepIndex ?? nextStep
    stepIndexRef.current = activeStepIndex
    setStepIndex(activeStepIndex)
    setGuidance(initialGuidance)
    if (voiceEnabled && initialGuidance && initialGuidance.distanceMeters !== null) {
      const announcedPhases = new Set<'early' | 'repeat' | 'now'>(['early'])
      if (initialGuidance.phase === 'repeat' || initialGuidance.phase === 'now') announcedPhases.add('repeat')
      if (initialGuidance.phase === 'now') announcedPhases.add('now')
      announcedManeuversRef.current.set(activeStepIndex, announcedPhases)
    }
    clearNavigationSpeech()
    if (voiceEnabled) {
      void prepareAudio().then((audioContext) => {
        if (!audioContext || navigationSessionRef.current !== navigationSessionId || !voiceEnabledRef.current) return
        if (initialGuidance?.distanceMeters !== null && initialGuidance) {
          queueNavigationSpeech(guidanceSpeechText(initialGuidance), activeStepIndex)
        }
      })
    }
    setDestinationReached(false)
    setRouteError('')
    setFollowLocation(true)
    setHeadingUpEnabled(true)
    if (travelMode === 'driving') setMapPerspective('driving')
    setIsNavigating(true)
  }

  const stopNavigation = (preserveSpeech = false) => {
    navigationSessionRef.current += 1
    setIsNavigating(false)
    setFollowLocation(false)
    setHeading(null)
    setRouting(false)
    routeRequestRef.current += 1
    reroutingRef.current = false
    announcedManeuversRef.current.clear()
    if (!preserveSpeech) clearNavigationSpeech()
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
    if (isNavigating && travelMode === 'driving') setMapPerspective('driving')
    setFollowLocation(true)
    setHeadingUpEnabled(true)
    requestLocation(() => setDrivingPerspectiveRequest((request) => request + 1))
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

  const changeSpeechLanguage = (language: SpeechLanguage) => {
    setAppMenuSection('main')
    if (language === speechLanguageRef.current) return
    speechLanguageRef.current = language
    setSpeechLanguage(language)
    clearNavigationSpeech()

    if (!voiceEnabledRef.current || !isNavigating || !activeGuidance || activeGuidance.distanceMeters === null) return

    const speakCurrentGuidance = () => {
      if (!voiceEnabledRef.current || speechLanguageRef.current !== language) return
      queueNavigationSpeech(guidanceSpeechText(activeGuidance, language), activeGuidance.stepIndex, language)
    }

    if (language === 'de') speakCurrentGuidance()
    else void prepareAudio().then((audioContext) => {
      if (audioContext) speakCurrentGuidance()
    })
  }

  const clearDestination = () => {
    routeRequestRef.current += 1
    navigationSessionRef.current += 1
    setDestination(null)
    setDestinationName('')
    setQuery('')
    setRoute(null)
    setGuidance(null)
    setRouteError('')
    setRouting(false)
    setIsNavigating(false)
    clearNavigationSpeech()
    setDestinationReached(false)
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
    setGuidance(null)
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
  const projectedRemainingDistance = route && currentLocation
    ? distanceAlongRouteToEnd(currentLocation, route.geometry.coordinates)
    : Number.NaN
  const liveRemainingDistance = isNavigating && Number.isFinite(projectedRemainingDistance)
    ? projectedRemainingDistance
    : remainingDistance
  const liveRemainingDuration = isNavigating && route && Number.isFinite(projectedRemainingDistance) && route.distance > 0
    ? route.duration * projectedRemainingDistance / route.distance
    : remainingDuration
  const arrivalTime = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(Date.now() + liveRemainingDuration * 1_000),
  )

  const renderAppMenu = (navigationMenu = false) => (
    <div className={`app-menu-anchor${navigationMenu ? ' app-menu-anchor--navigation' : ''}`} ref={appMenuRef}>
      <button
        className="app-menu-trigger"
        type="button"
        aria-label={appMenuOpen ? 'Menü schließen' : 'Menü öffnen'}
        aria-expanded={appMenuOpen}
        aria-controls={appMenuOpen ? 'app-settings-menu' : undefined}
        onClick={() => {
          setAppMenuSection('main')
          setAppMenuOpen((open) => !open)
        }}
      >
        <MenuIcon size={19} />
      </button>
      {appMenuOpen && (
        <div className="app-menu-popover" id="app-settings-menu" role="region" aria-label="Menü">
          {appMenuSection === 'main' ? (
            <div className="app-menu-items">
              <button className="app-menu-item app-menu-toggle" type="button" role="switch" aria-checked={threeDEnabled} onClick={() => setMapPerspective((perspective) => perspective === 'top' ? 'driving' : 'top')}>
                <Box size={17} aria-hidden="true" />
                <span>3D-Karte</span>
                <span className="map-mode-switch" aria-hidden="true"><span /></span>
              </button>
              <button className="app-menu-item" type="button" disabled={!route} onClick={() => setAppMenuSection('directions')}>
                <BookOpen size={17} />
                <span>Wegbeschreibung</span>
                <ChevronRight size={16} />
              </button>
              <button className="app-menu-item" type="button" onClick={() => setAppMenuSection('language')}>
                <Languages size={17} />
                <span>Sprache</span>
                <ChevronRight size={16} />
              </button>
            </div>
          ) : (
            <>
              <button className="app-menu-back" type="button" onClick={() => setAppMenuSection('main')}>
                <ChevronLeft size={16} /> Menü
              </button>
              {appMenuSection === 'language' ? (
                <SpeechLanguagePicker language={speechLanguage} onChange={changeSpeechLanguage} />
              ) : route ? (
                <RouteDirections route={route} stepIndex={isNavigating ? stepIndex : 0} />
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  )

  return (
    <main className={`app-shell ${isNavigating ? 'app-shell--navigating' : ''}`}>
      <NavigationMap
        origin={origin}
        destination={destination}
        currentLocation={currentLocation}
        gpsAccuracy={gpsAccuracy}
        speed={speed}
        activeStepIndex={activeGuidance?.stepIndex ?? stepIndex}
        route={route}
        isNavigating={isNavigating}
        followLocation={followLocation}
        headingUpEnabled={headingUpEnabled}
        heading={headingUpEnabled ? heading : null}
        centerRequest={mapCenterRequest}
        drivingPerspectiveRequest={drivingPerspectiveRequest}
        zoomRequest={zoomRequest}
        onManualPan={() => {
          setFollowLocation(false)
          setHeadingUpEnabled(false)
        }}
        threeDEnabled={threeDEnabled}
        perspectivePitch={mapPerspective === 'tilted' ? 25 : 55}
        laneGuidance={laneGuidance}
        onThreeDUnavailable={() => setMapPerspective('top')}
      />
      {isNavigating && travelMode === 'driving' && !destinationReached && !activeSearch && <LaneGuidance guidance={laneGuidance} />}
      <div className="map-brand-chip" aria-hidden="true">
        <span className="brand-mark"><Navigation size={17} strokeWidth={2.4} /></span>
        <span>Rêber</span>
      </div>
      <div className={`map-location-control ${isNavigating ? 'map-location-control--navigation' : ''}`}>
        {isNavigating && route?.mode === 'driving' && (
          <button
            className="map-control-button map-perspective-button"
            type="button"
            onClick={() => setMapPerspective((perspective) => perspective === 'top' ? 'tilted' : perspective === 'tilted' ? 'driving' : 'top')}
            aria-label={`${perspectiveLabel} — ${nextPerspectiveLabel}`}
            title={nextPerspectiveLabel}
          >
            <Box size={17} aria-hidden="true" />
            <span aria-live="polite">{perspectiveLabel}</span>
          </button>
        )}
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
      {isNavigating && (
        <button
          className="map-control-button driving-perspective-reset"
          type="button"
          onClick={returnToDrivingPerspective}
          aria-label="Zur ursprünglichen Fahrperspektive zurückkehren"
          title="Zur ursprünglichen Fahrperspektive zurückkehren"
        >
          <Navigation size={19} />
        </button>
      )}

      {routeError && <div className="map-status-banner map-status-banner--error" role="alert">{routeError}</div>}
      {isNavigating && renderAppMenu(true)}
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
          <div className="header-state"><span className="state-dot" /> AKTIV</div>
        </header>

        {(isNavigating || destinationReached) && activeGuidance && activeStep && !activeSearch ? (
          <div className="turn-card">
            <span className="turn-card-arrow"><ManeuverArrow step={activeStep} /></span>
            <div className="turn-card-copy">
              <div className="turn-eyebrow"><span className="turn-indicator" /> NÄCHSTE ANWEISUNG</div>
              <h1>{activeGuidance.germanText}</h1>
            </div>
          </div>
        ) : (isNavigating || destinationReached) && !activeSearch ? (
          <div className="panel-intro">
            <div className="eyebrow"><Compass size={14} /> NAVIGATION</div>
            <h1>{destinationReached ? 'Ziel erreicht' : routing ? 'Route wird neu berechnet…' : 'Standort wird geprüft…'}</h1>
            {!destinationReached && <p>Die nächste Anweisung erscheint, sobald die Position sicher auf der Route liegt.</p>}
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
              {!isNavigating && <div className="search-results-menu">{renderAppMenu()}</div>}
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
              {activeSearch === 'origin' && (
                <div className="search-result-item" role="listitem">
                  <button className="result-row" type="button" onClick={chooseCurrentLocationAsOrigin}>
                    <span className="result-icon"><LocateFixed size={17} /></span>
                    <span className="result-name"><strong>Mein Standort</strong><small>Aktuellen Standort verwenden</small></span>
                    <ArrowUpRight size={16} className="result-arrow" />
                  </button>
                </div>
              )}
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
            <div className="origin-field">
              <label className="field-label" htmlFor="origin-search">Start</label>
              <form className="search-form origin-search-form" onSubmit={searchOriginPlaces}>
                <input
                  id="origin-search"
                  value={originQuery}
                  onChange={(event) => editOriginInput(event.target.value)}
                  onClick={() => setActiveSearch('origin')}
                  placeholder={gpsStatus === 'loading' ? 'Standort wird ermittelt…' : 'Start'}
                  autoComplete="off"
                />
                <button className="search-submit search-submit--small" type="submit" aria-label="Startort suchen" disabled={searchingOrigin}>
                  {searchingOrigin ? <LoaderCircle className="spin" size={14} /> : <Search size={14} />}
                </button>
              </form>
            </div>
            {!isNavigating && <div className="route-form-menu-row">{renderAppMenu()}</div>}
            <div className={`destination-field ${!hasValidOrigin ? 'destination-field--disabled' : ''}`}>
              <label className="field-label" htmlFor="destination-search">Ziel</label>
              <form className="search-form" onSubmit={searchPlaces}>
                <input
                  id="destination-search"
                  value={query}
                  onChange={(event) => editDestinationInput(event.target.value)}
                  placeholder="Ziel"
                  autoComplete="off"
                  disabled={!hasValidOrigin}
                />
                <button className="search-submit search-submit--small" type="submit" aria-label="Orte suchen" disabled={!hasValidOrigin || searching}>
                  {searching ? <LoaderCircle className="spin" size={14} /> : <Search size={14} />}
                </button>
              </form>
            </div>
            <div className="route-swap-row">
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
                <button type="button" className="stop-button" onClick={() => stopNavigation()} aria-label="Navigation beenden" title="Navigation beenden"><X size={20} strokeWidth={2.5} /></button>
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

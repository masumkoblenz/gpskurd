import { createFileRoute } from '@tanstack/react-router'
import {
  ArrowLeft,
  ArrowUpDown,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Clock3,
  Compass,
  LocateFixed,
  LoaderCircle,
  MapPin,
  Navigation,
  Play,
  RotateCcw,
  Search,
  Volume2,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { NavigationMap } from '@/components/NavigationMap'
import {
  distanceBetween,
  distanceToRoute,
  findPlaces,
  formatClockDuration,
  formatDistance,
  formatDuration,
  getRoute,
  instructionFor,
  placeSubtitle,
  placeTitle,
  type NavigationRoute,
  type Point,
  type RouteStep,
  type SearchResult,
} from '@/lib/navigation'

export const Route = createFileRoute('/')({
  component: NavigationPage,
})

function ManeuverArrow({ step }: { step: RouteStep }) {
  const maneuver = step.maneuver
  const modifier = maneuver.modifier ?? ''
  const isUturn = maneuver.type === 'uturn' || modifier === 'uturn'
  const isLeft = !isUturn && modifier.includes('left')
  const isRight = !isUturn && modifier.includes('right')
  const directionLabel = isUturn ? 'Vegere' : isLeft ? 'Ber bi çepê bizivire' : isRight ? 'Ber bi rastê bizivire' : 'Rast biçe'

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
  const [query, setQuery] = useState('')
  const [originQuery, setOriginQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [originResults, setOriginResults] = useState<SearchResult[]>([])
  const [activeSearch, setActiveSearch] = useState<'destination' | 'origin' | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchingOrigin, setSearchingOrigin] = useState(false)
  const [routing, setRouting] = useState(false)
  const [isNavigating, setIsNavigating] = useState(false)
  const [directionsExpanded, setDirectionsExpanded] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [mapCenterRequest, setMapCenterRequest] = useState(0)
  const [stepIndex, setStepIndex] = useState(0)
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const activeSearchResults = activeSearch === 'origin' ? originResults : results
  const activeSearchLoading = activeSearch === 'origin' ? searchingOrigin : searching
  const routeRef = useRef(route)
  const routeRequestRef = useRef(0)
  const searchRequestRef = useRef(0)
  const lastRerouteRef = useRef(0)
  const reroutingRef = useRef(false)
  const stepIndexRef = useRef(stepIndex)
  const drawerTouchStartYRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const ttsWorkerRef = useRef<Worker | null>(null)
  const speechRequestRef = useRef(0)
  routeRef.current = route
  stepIndexRef.current = stepIndex

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

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setGpsStatus('error')
      return
    }
    setGpsStatus('loading')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const point = { lat: coords.latitude, lon: coords.longitude }
        setCurrentLocation(point)
        if (isNavigating) setMapCenterRequest((request) => request + 1)
        if (!isNavigating) {
          searchRequestRef.current += 1
          setActiveSearch(null)
          setResults([])
          setSearching(false)
          setSearchingOrigin(false)
          routeRequestRef.current += 1
          setOrigin(point)
          setOriginName('Cihê min')
          setOriginQuery('')
          setOriginResults([])
          setRoute(null)
          setRouting(false)
          setStepIndex(0)
        }
        setGpsStatus('ready')
      },
      () => {
        setGpsStatus('error')
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
    )
  }

  const searchPlaces = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (searching) return
    const term = query.trim()
    if (term.length < 2) return
    const requestId = ++searchRequestRef.current
    setActiveSearch('destination')
    setOriginResults([])
    setSearching(true)
    setResults([])
    try {
      const places = await findPlaces(term)
      if (searchRequestRef.current === requestId) setResults(places)
    } catch {
      return
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
    setResults([])
    setSearchingOrigin(true)
    setOriginResults([])
    try {
      const places = await findPlaces(term)
      if (searchRequestRef.current === requestId) setOriginResults(places)
    } catch {
      return
    } finally {
      if (searchRequestRef.current === requestId) setSearchingOrigin(false)
    }
  }

  const closeSearchResults = () => {
    searchRequestRef.current += 1
    setActiveSearch(null)
    setResults([])
    setOriginResults([])
    setSearching(false)
    setSearchingOrigin(false)
  }

  const chooseOrigin = (place: SearchResult) => {
    searchRequestRef.current += 1
    setActiveSearch(null)
    routeRequestRef.current += 1
    setOrigin({ lat: Number(place.lat), lon: Number(place.lon) })
    setOriginName(place.display_name.split(',').slice(0, 2).join(', '))
    setOriginQuery('')
    setOriginResults([])
    setRoute(null)
    setRouting(false)
    setIsNavigating(false)
    setStepIndex(0)
  }

  const chooseDestination = async (place: SearchResult) => {
    searchRequestRef.current += 1
    setActiveSearch(null)
    const requestId = ++routeRequestRef.current
    const point = { lat: Number(place.lat), lon: Number(place.lon) }
    setDestination(point)
    setDestinationName(place.display_name.split(',').slice(0, 2).join(', '))
    setQuery('')
    setResults([])
    setOriginResults([])
    setRoute(null)
    setIsNavigating(false)
    setStepIndex(0)
    if (!origin) return

    setRouting(true)
    try {
      const nextRoute = await getRoute(origin, point)
      if (routeRequestRef.current === requestId) setRoute(nextRoute)
    } catch {
      return
    } finally {
      if (routeRequestRef.current === requestId) setRouting(false)
    }
  }

  const calculateRoute = async () => {
    if (!origin || !destination) return
    const requestId = ++routeRequestRef.current
    setRouting(true)
    setIsNavigating(false)
    try {
      const nextRoute = await getRoute(origin, destination)
      if (routeRequestRef.current === requestId) {
        setRoute(nextRoute)
        setStepIndex(0)
      }
    } catch {
      return
    } finally {
      if (routeRequestRef.current === requestId) setRouting(false)
    }
  }

  useEffect(() => {
    if (!isNavigating) return
    if (!navigator.geolocation) {
      setIsNavigating(false)
      return
    }

    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const point = { lat: coords.latitude, lon: coords.longitude }
        setCurrentLocation(point)
        setGpsStatus('ready')

        const activeRoute = routeRef.current
        if (activeRoute?.steps.length) {
          const currentStep = activeRoute.steps[Math.min(stepIndexRef.current, activeRoute.steps.length - 1)]
          const [maneuverLon, maneuverLat] = currentStep.maneuver.location
          if (distanceBetween(point, { lat: maneuverLat, lon: maneuverLon }) < 34) {
            setStepIndex((index) => Math.min(index + 1, activeRoute.steps.length - 1))
          }
          const offRouteDistance = distanceToRoute(point, activeRoute.geometry.coordinates)
          const now = Date.now()
          if (
            destination &&
            offRouteDistance > 65 &&
            now - lastRerouteRef.current > 12_000 &&
            !reroutingRef.current
          ) {
            lastRerouteRef.current = now
            reroutingRef.current = true
            const requestId = ++routeRequestRef.current
            void getRoute(point, destination)
              .then((newRoute) => {
                if (routeRequestRef.current === requestId) {
                  setRoute(newRoute)
                  setStepIndex(0)
                }
              })
              .catch(() => undefined)
              .finally(() => {
                reroutingRef.current = false
              })
          }
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 2_000, timeout: 15_000 },
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [destination, isNavigating])

  const activeStep: RouteStep | undefined = route?.steps[Math.min(stepIndex, (route?.steps.length ?? 1) - 1)]
  useEffect(() => {
    if (!isNavigating || !voiceEnabled || !activeStep) return
    const audioContext = audioContextRef.current
    if (!audioContext) return

    const requestId = ++speechRequestRef.current
    let requestCancelled = false
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

      if (message.type !== 'audio' || !message.samples || !message.sampleRate) return

      void (async () => {
        if (audioContext.state === 'suspended') await audioContext.resume()
        if (requestCancelled) return
        const samples = new Float32Array(message.samples!)
        const audioBuffer = audioContext.createBuffer(1, samples.length, message.sampleRate!)
        audioBuffer.copyToChannel(samples, 0)
        const source = audioContext.createBufferSource()
        source.buffer = audioBuffer
        source.playbackRate.value = 1.12
        source.connect(audioContext.destination)
        source.onended = () => {
          if (audioSourceRef.current === source) audioSourceRef.current = null
          source.disconnect()
        }
        audioSourceRef.current = source
        source.start()
      })().catch(() => undefined)
    }

    const handleWorkerError = () => undefined

    worker.addEventListener('message', handleWorkerMessage)
    worker.addEventListener('error', handleWorkerError)
    worker.postMessage({
      requestId,
      text: instructionFor(activeStep),
      type: 'speak',
    })

    return () => {
      requestCancelled = true
      worker.postMessage({ requestId, type: 'cancel' })
      worker.removeEventListener('message', handleWorkerMessage)
      worker.removeEventListener('error', handleWorkerError)
      stopCurrentAudio()
    }
  }, [activeStep, isNavigating, voiceEnabled])

  useEffect(() => () => {
    ttsWorkerRef.current?.terminate()
    void audioContextRef.current?.close()
  }, [])

  const startNavigation = () => {
    if (!route) return
    void prepareAudio()
    lastRerouteRef.current = Date.now()
    setStepIndex(Math.min(1, route.steps.length - 1))
    setDirectionsExpanded(false)
    setIsNavigating(true)
  }

  const stopNavigation = () => {
    setIsNavigating(false)
    setDirectionsExpanded(false)
    if (audioSourceRef.current) {
      audioSourceRef.current.stop()
      audioSourceRef.current.disconnect()
      audioSourceRef.current = null
    }
  }

  const toggleVoice = () => {
    if (!voiceEnabled) void prepareAudio()
    setVoiceEnabled((enabled) => !enabled)
  }

  const clearDestination = () => {
    routeRequestRef.current += 1
    setDestination(null)
    setDestinationName('')
    setRoute(null)
    setRouting(false)
    setIsNavigating(false)
    setResults([])
    setOriginResults([])
  }

  const clearOrigin = () => {
    routeRequestRef.current += 1
    setOrigin(null)
    setOriginName('')
    setOriginQuery('')
    setOriginResults([])
    setRoute(null)
    setRouting(false)
    setIsNavigating(false)
    setStepIndex(0)
  }

  const swapStops = () => {
    if (!origin || !destination) return
    routeRequestRef.current += 1
    setOrigin(destination)
    setDestination(origin)
    setOriginName(destinationName)
    setDestinationName(originName || 'Cihê min')
    setOriginQuery('')
    setOriginResults([])
    setRoute(null)
    setRouting(false)
    setIsNavigating(false)
    setStepIndex(0)
    setQuery('')
    setResults([])
  }

  const remainingDistance = route?.steps.slice(stepIndex).reduce((total, step) => total + step.distance, 0) ?? 0
  const remainingDuration = route?.steps.slice(stepIndex).reduce((total, step) => total + step.duration, 0) ?? 0
  const upcomingSteps = route?.steps.slice(stepIndex, stepIndex + 5) ?? []

  return (
    <main className={`app-shell ${isNavigating ? 'app-shell--navigating' : ''}`}>
      <NavigationMap
        origin={origin}
        destination={destination}
        currentLocation={currentLocation}
        route={route}
        isNavigating={isNavigating}
        centerRequest={mapCenterRequest}
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
            aria-label={voiceEnabled ? 'Deng rawestîne' : 'Deng çalak bike'}
            aria-pressed={voiceEnabled}
            title={voiceEnabled ? 'Deng çalak e' : 'Deng rawestiyaye'}
          >
            <span className={`audio-control-icon ${voiceEnabled ? '' : 'audio-control-icon--muted'}`}>
              <Volume2 size={19} />
            </span>
          </button>
        )}
        {isNavigating && (
          <button
            className="map-control-button"
            type="button"
            onClick={() => setMapCenterRequest((request) => request + 1)}
            aria-label="Nexşeyê navend bike û li bakur rast bike"
            title="Nexşeyê navend bike û li bakur rast bike"
          >
            <Compass size={19} />
          </button>
        )}
        <button className="map-control-button" type="button" onClick={requestLocation} aria-label="Cihê min bibîne">
          {gpsStatus === 'loading' ? <LoaderCircle className="spin" size={19} /> : <LocateFixed size={19} />}
        </button>
      </div>

      <section className={`navigation-panel ${isNavigating ? 'navigation-panel--active' : ''} ${activeSearch ? 'navigation-panel--search-results' : ''}`}>
        <header className="panel-header">
          <div className="wordmark">
            <span className="wordmark-icon"><Navigation size={17} strokeWidth={2.4} /></span>
            <span>Rêber</span>
            <span className="wordmark-caption">RÊBERIYA TE</span>
          </div>
          <div className="header-state"><span className="state-dot" /> ZINDÎ</div>
        </header>

        {isNavigating && activeStep ? (
          <div className="turn-card">
            <span className="turn-card-arrow"><ManeuverArrow step={activeStep} /></span>
            <div className="turn-card-copy">
              <div className="turn-eyebrow"><span className="turn-indicator" /> RÊBERIYA NIHA</div>
              <h1>{instructionFor(activeStep)}</h1>
              <p>{activeStep.name || 'Rêya sereke'}</p>
            </div>
          </div>
        ) : !activeSearch ? (
          <div className="panel-intro">
            <div className="eyebrow"><Compass size={14} /> LI SER RÊ</div>
            <h1>Bi aramî bigere.</h1>
            <p>Armanca xwe bibêje. Rêber rêya te dibîne.</p>
          </div>
        ) : null}

        {activeSearch ? (
          <section className="search-results-view" aria-label="Cihên hatine dîtin" aria-live="polite">
            <header className="search-results-view-header">
              <button className="search-results-back" type="button" onClick={closeSearchResults} aria-label="Vegere lêgerînê">
                <ArrowLeft size={18} />
              </button>
              <div className="search-results-heading">
                <strong>{activeSearch === 'origin' ? 'CIHÊN DESTPÊKÊ' : 'CIHÊN ARMANCÊ'}</strong>
                <small>{activeSearchLoading ? 'Li cihan digere…' : `${activeSearchResults.length} cih hat dîtin`}</small>
              </div>
            </header>
            <div className="search-results-list" role="list">
              {activeSearchLoading ? (
                <div className="search-results-status"><LoaderCircle className="spin" size={19} /><span>Li cihan digere…</span></div>
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
              ) : (
                <div className="search-results-status"><Search size={18} /><span>Tu cih nehat dîtin.</span></div>
              )}
            </div>
          </section>
        ) : (
        <div className="route-form-block">
          <div className="route-stops">
            <div className="stop-rail">
              {destination && <span className="stop-dot stop-dot--start" />}
              {destination && <span className="stop-line" />}
              {origin && destination && (
                <button className="swap-stops-button" type="button" onClick={swapStops} aria-label="Destpêk û armancê biguherîne" title="Destpêk û armancê biguherîne">
                  <ArrowUpDown size={16} />
                </button>
              )}
              <span className="stop-dot stop-dot--end" />
            </div>
            <div className="stop-fields">
              {destination && (
                <div className="origin-field">
                  {origin ? (
                    <span className="field-label">JI</span>
                  ) : (
                    <label className="field-label" htmlFor="origin-search">JI</label>
                  )}
                  {origin ? (
                    <div className="selected-destination selected-origin">
                      <span>{originName || 'Cihê min'}</span>
                      <button type="button" onClick={clearOrigin} aria-label="Cihê destpêkê biguherîne"><X size={16} /></button>
                    </div>
                  ) : (
                    <form className="search-form origin-search-form" onSubmit={searchOriginPlaces}>
                      <input
                        id="origin-search"
                        value={originQuery}
                        onChange={(event) => setOriginQuery(event.target.value)}
                        placeholder="Cihê destpêkê bigere"
                        autoComplete="off"
                      />
                      <button className="search-submit" type="submit" aria-label="Cihê destpêkê bigere" disabled={searchingOrigin}>
                        {searchingOrigin ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />}
                      </button>
                      <button className="origin-location-button" type="button" onClick={requestLocation} aria-label="Cihê min wek destpêkê bikar bîne" title="Cihê min wek destpêkê bikar bîne">
                        {gpsStatus === 'loading' ? <LoaderCircle className="spin" size={17} /> : <LocateFixed size={17} />}
                      </button>
                    </form>
                  )}
                </div>
              )}
              <div className="destination-field">
                {destination ? (
                  <span className="field-label">Bİ</span>
                ) : (
                  <label className="field-label" htmlFor="destination-search">Bİ</label>
                )}
                {destination ? (
                  <div className="selected-destination">
                    <span>{destinationName}</span>
                    <button type="button" onClick={clearDestination} aria-label="Armancê jê bibe"><X size={16} /></button>
                  </div>
                ) : (
                  <form className="search-form" onSubmit={searchPlaces}>
                    <input
                      id="destination-search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Tu dixwazî biçî ku?"
                      autoComplete="off"
                    />
                    <button className="search-submit" type="submit" aria-label="Cihan bigere" disabled={searching}>
                      {searching ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
        )}

        {destination && origin && !isNavigating && !activeSearch && (
          <div className="route-action-footer">
            <button
              className={`primary-button ${route ? 'start-button' : ''}`}
              type="button"
              onClick={() => {
                if (route) startNavigation()
                else void calculateRoute()
              }}
              disabled={routing}
            >
              {routing ? <LoaderCircle className="spin" size={17} /> : route ? <Play size={16} fill="currentColor" /> : <Navigation size={17} />}
              <span>{routing ? 'Rê tê hesabkirin…' : route ? 'Rêberiyê dest pê bike' : 'Rê hesab bike'}</span>
              {!routing && <ArrowUpRight size={17} className="button-arrow" />}
            </button>
          </div>
        )}

        {isNavigating && route && (
          <div className={`navigation-drawer ${directionsExpanded ? 'navigation-drawer--expanded' : ''}`}>
            <button className="navigation-drawer-toggle" type="button" onClick={() => setDirectionsExpanded((expanded) => !expanded)} aria-expanded={directionsExpanded} aria-controls="active-directions">
              <span className="navigation-drawer-grip" />
              {directionsExpanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              <span className="navigation-drawer-label">{directionsExpanded ? 'RÊBERÎ VEŞÊRE' : 'RÊBERÎ NÎŞAN BIDE'}</span>
            </button>
            <div className="directions-section navigation-directions" id="active-directions" hidden={!directionsExpanded}>
              <div className="directions-heading"><span>PÊŞIYA TE</span><span>{upcomingSteps.length} gav</span></div>
              <div className="directions-list">
                {upcomingSteps.map((step, index) => (
                  <div className={`direction-row ${index === 0 ? 'direction-row--current' : ''}`} key={`${step.maneuver.type}-${step.maneuver.location.join('-')}-${stepIndex + index}`}>
                    <span className="direction-number"><ManeuverArrow step={step} /></span>
                    <span className="direction-copy"><strong>{instructionFor(step, index > 0)}</strong><small>{step.name || 'Rêya sereke'}</small></span>
                    <span className="direction-distance">{formatDistance(step.distance)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div
              className="navigation-footer"
              onTouchStart={(event) => { drawerTouchStartYRef.current = event.touches[0]?.clientY ?? null }}
              onTouchEnd={(event) => {
                const startY = drawerTouchStartYRef.current
                const endY = event.changedTouches[0]?.clientY
                if (startY !== null && endY !== undefined) {
                  if (endY < startY - 36) setDirectionsExpanded(true)
                  if (endY > startY + 36) setDirectionsExpanded(false)
                }
                drawerTouchStartYRef.current = null
              }}
            >
              <div className="footer-estimate"><Clock3 size={16} /><strong className="estimate-duration">{formatClockDuration(remainingDuration)}</strong><span>·</span><span className="estimate-distance">{formatDistance(remainingDistance)} mayî</span></div>
              <button type="button" className="stop-button" onClick={stopNavigation} aria-label="Dawî bîne" title="Dawî bîne"><X size={20} strokeWidth={2.5} /></button>
            </div>
          </div>
        )}

        {!route && !destination && (
          <div className="empty-route">
            <span className="empty-route-icon"><MapPin size={19} /></span>
            <div><strong>Rê li benda te ye</strong><p>Cihê xwe bibîne û armanca xwe lê zêde bike.</p></div>
          </div>
        )}

        <footer className="panel-footer">
          <span><i /> XIZMETÊN VEKIRÎ</span>
          <span>OSM <b>·</b> OSRM <b>·</b> NOMINATIM</span>
        </footer>
      </section>

      {route && !isNavigating && (
        <section className="route-results-panel" aria-label="Encama rê û rêberî" aria-live="polite">
          <section className="route-summary">
            <div className="summary-topline"><span>RÊYA PÊŞNIYAR</span><button type="button" onClick={() => void calculateRoute()} aria-label="Rê ji nû ve hesab bike" disabled={routing}><RotateCcw size={15} /></button></div>
            <div className="summary-main">
              <div className="summary-metric summary-metric--duration"><strong>{formatDuration(route.duration)}</strong><span>DEMÊ RÊWÎTIYÊ</span></div>
              <div className="summary-divider" />
              <div className="summary-metric summary-metric--distance"><strong>{formatDistance(route.distance)}</strong><span>DIRÊJAHÎ</span></div>
            </div>
          </section>
          <div className="directions-section">
            <div className="directions-heading"><span>RÊBERÎ</span><span>{upcomingSteps.length} gav</span></div>
            <div className="directions-list">
              {upcomingSteps.map((step, index) => (
                <div className="direction-row" key={`${step.maneuver.type}-${step.maneuver.location.join('-')}-${stepIndex + index}`}>
                  <span className="direction-number"><ManeuverArrow step={step} /></span>
                  <span className="direction-copy"><strong>{instructionFor(step)}</strong><small>{step.name || 'Rêya sereke'}</small></span>
                  <span className="direction-distance">{formatDistance(step.distance)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {route && !isNavigating && (
        <div className="floating-route-pill"><Clock3 size={15} /><strong className="estimate-duration">{formatClockDuration(route.duration)}</strong><span>·</span><span className="estimate-distance">{formatDistance(route.distance)}</span></div>
      )}

    </main>
  )
}

import { createFileRoute } from '@tanstack/react-router'
import {
  ArrowUpRight,
  Clock3,
  Compass,
  LocateFixed,
  LoaderCircle,
  MapPin,
  Navigation,
  Play,
  RotateCcw,
  Search,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { NavigationMap } from '@/components/NavigationMap'
import {
  distanceBetween,
  distanceToRoute,
  findPlaces,
  formatDistance,
  formatDuration,
  getRoute,
  instructionFor,
  type NavigationRoute,
  type Point,
  type RouteStep,
  type SearchResult,
} from '@/lib/navigation'

export const Route = createFileRoute('/')({
  component: NavigationPage,
})

function NavigationPage() {
  const [origin, setOrigin] = useState<Point | null>(null)
  const [currentLocation, setCurrentLocation] = useState<Point | null>(null)
  const [destination, setDestination] = useState<Point | null>(null)
  const [destinationName, setDestinationName] = useState('')
  const [route, setRoute] = useState<NavigationRoute | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [routing, setRouting] = useState(false)
  const [error, setError] = useState('')
  const [speechError, setSpeechError] = useState('')
  const [speechStatus, setSpeechStatus] = useState('')
  const [isNavigating, setIsNavigating] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [speechTestRequest, setSpeechTestRequest] = useState(0)
  const [stepIndex, setStepIndex] = useState(0)
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const routeRef = useRef(route)
  const routeRequestRef = useRef(0)
  const lastRerouteRef = useRef(0)
  const reroutingRef = useRef(false)
  const stepIndexRef = useRef(stepIndex)
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const ttsWorkerRef = useRef<Worker | null>(null)
  const speechRequestRef = useRef(0)
  const handledSpeechTestRef = useRef(0)
  routeRef.current = route
  stepIndexRef.current = stepIndex

  const prepareAudio = async () => {
    try {
      const audioContext = audioContextRef.current ?? new AudioContext()
      audioContextRef.current = audioContext
      if (audioContext.state === 'suspended') await audioContext.resume()
      if (audioContext.state !== 'running') throw new Error('audio_context_not_running')
      setSpeechError('')
      return audioContext
    } catch {
      setSpeechError('Deng di vê gerokê de nayê çalakkirin.')
      return null
    }
  }

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setGpsStatus('error')
      setError('GPS di vê gerokê de nayê piştgirîkirin.')
      return
    }
    setGpsStatus('loading')
    setError('')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const point = { lat: coords.latitude, lon: coords.longitude }
        setCurrentLocation(point)
        setOrigin(point)
        setGpsStatus('ready')
      },
      () => {
        setGpsStatus('error')
        setError('Cihê te nehat bidestxistin. Destûra GPS-ê bide û dîsa biceribîne.')
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
    )
  }

  const searchPlaces = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (searching) return
    const term = query.trim()
    if (term.length < 2) {
      setError('Ji kerema xwe navê cihê binivîse.')
      return
    }
    setSearching(true)
    setError('')
    setResults([])
    try {
      setResults(await findPlaces(term))
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Di lêgerînê de xeletî çêbû.')
    } finally {
      setSearching(false)
    }
  }

  const chooseDestination = async (place: SearchResult) => {
    const requestId = ++routeRequestRef.current
    const point = { lat: Number(place.lat), lon: Number(place.lon) }
    setDestination(point)
    setDestinationName(place.display_name.split(',').slice(0, 2).join(', '))
    setQuery('')
    setResults([])
    setRoute(null)
    setIsNavigating(false)
    setStepIndex(0)
    setError('')
    if (!origin) return

    setRouting(true)
    try {
      const nextRoute = await getRoute(origin, point)
      if (routeRequestRef.current === requestId) setRoute(nextRoute)
    } catch (routeError) {
      if (routeRequestRef.current === requestId) {
        setError(routeError instanceof Error ? routeError.message : 'Rê nehat hesabkirin.')
      }
    } finally {
      if (routeRequestRef.current === requestId) setRouting(false)
    }
  }

  const calculateRoute = async () => {
    if (!origin || !destination) return
    const requestId = ++routeRequestRef.current
    setRouting(true)
    setError('')
    setIsNavigating(false)
    try {
      const nextRoute = await getRoute(origin, destination)
      if (routeRequestRef.current === requestId) {
        setRoute(nextRoute)
        setStepIndex(0)
      }
    } catch (routeError) {
      if (routeRequestRef.current === requestId) {
        setError(routeError instanceof Error ? routeError.message : 'Rê nehat hesabkirin.')
      }
    } finally {
      if (routeRequestRef.current === requestId) setRouting(false)
    }
  }

  useEffect(() => {
    if (!isNavigating) return
    if (!navigator.geolocation) {
      setError('GPS di vê gerokê de nayê piştgirîkirin.')
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
            setError('Rê ji bo cihê nû tê hesabkirin…')
            void getRoute(point, destination)
              .then((newRoute) => {
                if (routeRequestRef.current === requestId) {
                  setRoute(newRoute)
                  setStepIndex(0)
                  setError('')
                }
              })
              .catch(() => {
                if (routeRequestRef.current === requestId) {
                  setError('Nehat ku rê nû were hesabkirin. Li ser rê bimîne.')
                }
              })
              .finally(() => {
                reroutingRef.current = false
              })
          }
        }
      },
      () => {
        setError('GPS qut bû. Ji kerema xwe destûra cihê kontrol bike.')
      },
      { enableHighAccuracy: true, maximumAge: 2_000, timeout: 15_000 },
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [destination, isNavigating])

  const activeStep: RouteStep | undefined = route?.steps[Math.min(stepIndex, (route?.steps.length ?? 1) - 1)]
  useEffect(() => {
    const isTestRequest = speechTestRequest !== handledSpeechTestRef.current
    if (isTestRequest) handledSpeechTestRef.current = speechTestRequest
    if (!isTestRequest && (!isNavigating || !voiceEnabled || !activeStep)) return
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
    setSpeechError('')
    setSpeechStatus('Deng tê amadekirin…')

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

      if (message.type === 'status') {
        setSpeechStatus(
          message.status === 'loading-runtime'
            ? 'Amûra dengê Kurmancî tê barkirin…'
            : message.status === 'loading-model'
              ? 'Modela Kurmancî tê amadekirin…'
              : 'Deng tê çêkirin…',
        )
        return
      }

      if (message.type === 'progress') {
        const progress = message.total ? ` ${Math.round((message.loaded ?? 0) / message.total * 100)}%` : ''
        setSpeechStatus(`Modela Kurmancî tê daxistin…${progress}`)
        return
      }

      if (message.type === 'cached') {
        setSpeechStatus('Modela Kurmancî tê amadekirin…')
        return
      }

      if (message.type === 'error') {
        setSpeechStatus('')
        setSpeechError('Deng nehat çêkirin. Girêdana înternetê kontrol bike û dîsa biceribîne.')
        return
      }

      if (!message.samples || !message.sampleRate) return
      setSpeechStatus(isTestRequest ? 'Deng tê xwendin…' : '')

      void (async () => {
        if (audioContext.state === 'suspended') await audioContext.resume()
        if (requestCancelled) return
        const samples = new Float32Array(message.samples!)
        const audioBuffer = audioContext.createBuffer(1, samples.length, message.sampleRate!)
        audioBuffer.copyToChannel(samples, 0)
        const source = audioContext.createBufferSource()
        source.buffer = audioBuffer
        source.connect(audioContext.destination)
        source.onended = () => {
          if (audioSourceRef.current === source) audioSourceRef.current = null
          source.disconnect()
          if (isTestRequest) setSpeechStatus('Ceribandina dengê bi ser ket.')
        }
        audioSourceRef.current = source
        source.start()
      })().catch(() => {
        if (!requestCancelled) {
          setSpeechStatus('')
          setSpeechError('Deng di vê gerokê de nayê çalakkirin.')
        }
      })
    }

    const handleWorkerError = () => {
      if (requestCancelled) return
      setSpeechStatus('')
      setSpeechError('Deng nehat çêkirin. Girêdana înternetê kontrol bike û dîsa biceribîne.')
    }

    worker.addEventListener('message', handleWorkerMessage)
    worker.addEventListener('error', handleWorkerError)
    worker.postMessage({
      requestId,
      text: isTestRequest ? 'Ev ceribandina dengê Rêber e. Rêya te xweş be.' : instructionFor(activeStep!),
      type: 'speak',
    })

    return () => {
      requestCancelled = true
      worker.postMessage({ requestId, type: 'cancel' })
      worker.removeEventListener('message', handleWorkerMessage)
      worker.removeEventListener('error', handleWorkerError)
      stopCurrentAudio()
    }
  }, [activeStep, isNavigating, speechTestRequest, voiceEnabled])

  useEffect(() => () => {
    ttsWorkerRef.current?.terminate()
    void audioContextRef.current?.close()
  }, [])

  const startNavigation = () => {
    if (!route) return
    void prepareAudio()
    lastRerouteRef.current = Date.now()
    setStepIndex(Math.min(1, route.steps.length - 1))
    setIsNavigating(true)
  }

  const stopNavigation = () => {
    setIsNavigating(false)
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

  const testAudio = async () => {
    if (await prepareAudio()) setSpeechTestRequest((request) => request + 1)
  }

  const clearDestination = () => {
    routeRequestRef.current += 1
    setDestination(null)
    setDestinationName('')
    setRoute(null)
    setRouting(false)
    setIsNavigating(false)
    setResults([])
    setError('')
  }

  const remainingDistance = route?.steps.slice(stepIndex).reduce((total, step) => total + step.distance, 0) ?? 0
  const remainingDuration = route?.steps.slice(stepIndex).reduce((total, step) => total + step.duration, 0) ?? 0
  const upcomingSteps = route?.steps.slice(stepIndex, stepIndex + 5) ?? []

  return (
    <main className="app-shell">
      <NavigationMap
        origin={origin}
        destination={destination}
        currentLocation={currentLocation}
        route={route}
        isNavigating={isNavigating}
      />
      <div className="map-brand-chip" aria-hidden="true">
        <span className="brand-mark"><Navigation size={17} strokeWidth={2.4} /></span>
        <span>Rêber</span>
      </div>
      <div className="map-location-control">
        <button className="map-control-button" type="button" onClick={requestLocation} aria-label="Cihê min bibîne">
          {gpsStatus === 'loading' ? <LoaderCircle className="spin" size={19} /> : <LocateFixed size={19} />}
        </button>
      </div>

      <section className={`navigation-panel ${isNavigating ? 'navigation-panel--active' : ''}`}>
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
            <div className="turn-eyebrow"><span className="turn-indicator" /> RÊBERIYA NIHA</div>
            <h1>{instructionFor(activeStep)}</h1>
            <p>{activeStep.name || 'Rêya sereke'}</p>
            {(speechError || speechStatus) && <p className="speech-status" role="status">{speechError || speechStatus}</p>}
            <div className="speech-actions">
              <button className="voice-button" type="button" onClick={toggleVoice}>
                {voiceEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
                <span>{voiceEnabled ? 'Deng çalak e' : 'Deng rawestiyaye'}</span>
              </button>
              <button className="speech-test-button" type="button" onClick={() => void testAudio()}>
                <Play size={14} /> <span>Deng ceribîne</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="panel-intro">
            <div className="eyebrow"><Compass size={14} /> LI SER RÊ</div>
            <h1>Bi aramî bigere.</h1>
            <p>Armanca xwe bibêje. Rêber rêya te dibîne.</p>
            {(speechError || speechStatus) && <p className="speech-status" role="status">{speechError || speechStatus}</p>}
            <button className="speech-test-button" type="button" onClick={() => void testAudio()}>
              <Play size={14} /> <span>Deng ceribîne</span>
            </button>
          </div>
        )}

        <div className="route-form-block">
          <div className="route-stops">
            <div className="stop-rail"><span className="stop-dot stop-dot--start" /><span className="stop-line" /><span className="stop-dot stop-dot--end" /></div>
            <div className="stop-fields">
              <div className="origin-field">
                <span className="field-label">JI</span>
                <button className="origin-button" type="button" onClick={requestLocation}>
                  <span>{gpsStatus === 'loading' ? 'Cihê te tê dîtin…' : origin ? 'Cihê min' : 'Cihê xwe bibîne'}</span>
                  {gpsStatus === 'loading' ? <LoaderCircle size={16} className="spin" /> : <LocateFixed size={16} />}
                </button>
              </div>
              <div className="destination-field">
                <label className="field-label" htmlFor="destination-search">Bİ</label>
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
          {results.length > 0 && (
            <div className="search-results">
              <div className="results-label">CIHÊN NÊZÎK</div>
              {results.map((place) => (
                <button className="result-row" key={place.place_id} type="button" onClick={() => void chooseDestination(place)}>
                  <span className="result-icon"><MapPin size={16} /></span>
                  <span className="result-name">{place.display_name}</span>
                  <ArrowUpRight size={15} className="result-arrow" />
                </button>
              ))}
            </div>
          )}
          {error && <div className={`notice ${error.includes('tê hesabkirin') ? 'notice--working' : ''}`} role="status">{error}</div>}
          {destination && !origin && !route && !routing && (
            <div className="location-prompt">
              <LocateFixed size={17} /> <span>Ji bo hesabkirina rêyê cihê xwe destnîşan bike.</span>
            </div>
          )}
          {destination && origin && !route && (
            <button className="primary-button" type="button" onClick={() => void calculateRoute()} disabled={routing}>
              {routing ? <LoaderCircle className="spin" size={17} /> : <Navigation size={17} />}
              <span>{routing ? 'Rê tê hesabkirin…' : 'Rê hesab bike'}</span>
              {!routing && <ArrowUpRight size={17} className="button-arrow" />}
            </button>
          )}
        </div>

        {route && !isNavigating && (
          <section className="route-summary" aria-live="polite">
            <div className="summary-topline"><span>RÊYA PÊŞNIYAR</span><button type="button" onClick={() => void calculateRoute()} aria-label="Rê ji nû ve hesab bike"><RotateCcw size={15} /></button></div>
            <div className="summary-main">
              <div className="summary-metric"><strong>{formatDuration(route.duration)}</strong><span>DEMÊ RÊWÎTIYÊ</span></div>
              <div className="summary-divider" />
              <div className="summary-metric"><strong>{formatDistance(route.distance)}</strong><span>DIRÊJAHÎ</span></div>
            </div>
            <button className="primary-button start-button" type="button" onClick={startNavigation}>
              <Play size={16} fill="currentColor" /> <span>Rêberiyê dest pê bike</span><ArrowUpRight size={17} className="button-arrow" />
            </button>
          </section>
        )}

        {route && (
          <div className="directions-section">
            <div className="directions-heading"><span>{isNavigating ? 'PÊŞIYA TE' : 'RÊBERÎ'}</span><span>{upcomingSteps.length} gav</span></div>
            <div className="directions-list">
              {upcomingSteps.map((step, index) => (
                <div className={`direction-row ${index === 0 && isNavigating ? 'direction-row--current' : ''}`} key={`${step.maneuver.type}-${step.maneuver.location.join('-')}-${stepIndex + index}`}>
                  <span className="direction-number">{index === 0 && isNavigating ? <Navigation size={15} /> : String(stepIndex + index + 1).padStart(2, '0')}</span>
                  <span className="direction-copy"><strong>{instructionFor(step, !isNavigating || index > 0)}</strong><small>{step.name || 'Rêya sereke'}</small></span>
                  <span className="direction-distance">{formatDistance(step.distance)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {isNavigating && route && (
          <div className="navigation-footer">
            <div className="footer-estimate"><Clock3 size={16} /><strong>{formatDuration(remainingDuration)}</strong><span>·</span><span>{formatDistance(remainingDistance)} mayî</span></div>
            <button type="button" className="stop-button" onClick={stopNavigation}><Square size={13} fill="currentColor" /> Dawî bîne</button>
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
        <div className="floating-route-pill"><Clock3 size={15} /><strong>{formatDuration(route.duration)}</strong><span>·</span><span>{formatDistance(route.distance)}</span></div>
      )}
    </main>
  )
}

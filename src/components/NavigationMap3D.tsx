import { useEffect, useRef, useState } from 'react'
import type { LatLngBounds, Map as LeafletMap, ZoomAnimEvent } from 'leaflet'
import type { GeoJSONSource, Map as VectorMap, Marker, MapLibreEvent } from 'maplibre-gl'
import type { NavigationRoute, Point } from '@/lib/navigation'
import { laneSignMarkup, type LaneGuidance } from '@/lib/lane-guidance'
import { getDrivingCamera, gpsAccuracyRing, projectToRoad, roadLengths, sampleRoad } from '@/lib/driving-perspective'
import { drivingLocationMarkup, locationMarkup, routePinMarkup, trafficSignalLabel, trafficSignalMarkup, type TrafficSignalNode } from '@/lib/map-markers'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

type NavigationMap3DProps = {
  leafletMap: LeafletMap
  enabled: boolean
  perspectivePitch: number
  laneGuidance: LaneGuidance | null
  visible: boolean
  origin: Point | null
  destination: Point | null
  currentLocation: Point | null
  route: NavigationRoute | null
  trafficSignals: TrafficSignalNode[]
  isNavigating: boolean
  followLocation: boolean
  headingUpEnabled: boolean
  heading: number | null
  speed: number | null
  gpsAccuracy: number | null
  activeStepIndex: number
  drivingPerspectiveRequest: number
  zoomRequest: { id: number; direction: -1 | 1 }
  onManualPan: () => void
  onViewportReady: (getBounds: (() => LatLngBounds) | null) => void
  onVisibleChange: (visible: boolean) => void
  onExited: () => void
  onUnavailable: () => void
}

const styleUrl = 'https://tiles.openfreemap.org/styles/liberty'

export default function NavigationMap3D(props: NavigationMap3DProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<VectorMap | null>(null)
  const moduleRef = useRef<typeof import('maplibre-gl') | null>(null)
  const propsRef = useRef(props)
  const markerRefs = useRef<{ origin?: Marker; destination?: Marker; location?: Marker }>({})
  const trafficMarkerRefs = useRef(new Map<number, Marker>())
  const cameraSourceRef = useRef<'leaflet' | 'vector' | null>(null)
  const syncingToLeafletRef = useRef(false)
  const applyingLeafletCameraRef = useRef(false)
  const pitchAnimationRef = useRef<number | null>(null)
  const laneMarkerRef = useRef<Marker | null>(null)
  const manualCameraRef = useRef(false)
  const drivingZoomRef = useRef<number | null>(null)
  const lastZoomRequestRef = useRef(props.zoomRequest.id)
  const [ready, setReady] = useState(false)
  const [worldView, setWorldView] = useState(props.leafletMap.getZoom() < 4)
  propsRef.current = props
  if (props.followLocation) manualCameraRef.current = false
  const followsDriving = () => {
    const current = propsRef.current
    return current.enabled && current.isNavigating && current.route?.mode === 'driving' && current.followLocation && !manualCameraRef.current
  }

  useEffect(() => {
    const leafletMap = props.leafletMap
    let disposed = false
    let resizeObserver: ResizeObserver | undefined
    let loadTimeout: ReturnType<typeof setTimeout> | undefined
    let syncFromLeaflet: (() => void) | undefined
    let syncZoomFromLeaflet: ((event: ZoomAnimEvent) => void) | undefined
    const fail = () => {
      if (!disposed) propsRef.current.onUnavailable()
    }

    void (async () => {
      try {
        const maplibre = await import('maplibre-gl')
        if (disposed || !containerRef.current) return
        moduleRef.current = maplibre
        maplibre.setWorkerUrl(workerUrl)
        maplibre.setWorkerCount(2)
        const center = leafletMap.getCenter()
        const map = new maplibre.Map({
          container: containerRef.current,
          style: styleUrl,
          center: [center.lng, center.lat],
          zoom: leafletMap.getZoom() - 1,
          bearing: -leafletMap.getBearing(),
          pitch: 0,
          minZoom: -1,
          maxZoom: 20,
          maxPitch: 55,
          renderWorldCopies: true,
          transformConstrain: (center, zoom) => ({
            center: new maplibre.LngLat(center.lng, Math.max(-85.051129, Math.min(85.051129, center.lat))),
            zoom: Math.max(-1, Math.min(20, zoom)),
          }),
          pixelRatio: Math.min(window.devicePixelRatio || 1, window.matchMedia('(max-width: 700px)').matches ? 1.5 : 2),
          maxTileCacheSize: 100,
          fadeDuration: 180,
          canvasContextAttributes: { antialias: true, powerPreference: 'default' },
          attributionControl: false,
        })
        mapRef.current = map
        map.addControl(new maplibre.AttributionControl({ compact: true }), 'bottom-right')
        map.touchZoomRotate.enable()
        map.touchPitch.enable()
        map.getCanvas().setAttribute('aria-label', 'Nexşeya 3D')
        map.getCanvas().addEventListener('webglcontextlost', fail)

        const readCamera = () => {
          const center = leafletMap.getCenter()
          return { center: [center.lng, center.lat] as [number, number], zoom: leafletMap.getZoom() - 1, bearing: -leafletMap.getBearing() }
        }
        syncFromLeaflet = () => {
          if (disposed || syncingToLeafletRef.current) return
          if (followsDriving()) return
          cameraSourceRef.current = 'leaflet'
          applyingLeafletCameraRef.current = true
          map.jumpTo(readCamera())
          applyingLeafletCameraRef.current = false
          cameraSourceRef.current = null
        }
        syncZoomFromLeaflet = (event) => {
          if (disposed || syncingToLeafletRef.current) return
          if (followsDriving()) {
            drivingZoomRef.current = event.zoom - 1
            map.easeTo({ zoom: event.zoom - 1, duration: 250 })
            return
          }
          cameraSourceRef.current = 'leaflet'
          applyingLeafletCameraRef.current = true
          map.easeTo({ center: [event.center.lng, event.center.lat], zoom: event.zoom - 1, bearing: -leafletMap.getBearing(), duration: 250 })
          applyingLeafletCameraRef.current = false
        }
        leafletMap.on('move rotate', syncFromLeaflet)
        leafletMap.on('zoomanim', syncZoomFromLeaflet)

        const syncToLeaflet = () => {
          if (disposed || cameraSourceRef.current === 'leaflet' || !propsRef.current.enabled) return
          if (followsDriving()) return
          const center = map.getCenter()
          const previous = leafletMap.getCenter()
          if (Math.abs(previous.lat - center.lat) < 1e-9 && Math.abs(previous.lng - center.lng) < 1e-9 &&
            Math.abs(leafletMap.getZoom() - map.getZoom() - 1) < 1e-9 &&
            Math.abs(((leafletMap.getBearing() + map.getBearing() + 540) % 360) - 180) < 1e-9) return
          cameraSourceRef.current = 'vector'
          syncingToLeafletRef.current = true
          leafletMap.setBearing(-map.getBearing())
          leafletMap.setView([center.lat, center.lng], map.getZoom() + 1, { animate: false })
          syncingToLeafletRef.current = false
        }
        map.on('movestart', (event) => {
          if (event.originalEvent) {
            cameraSourceRef.current = 'vector'
            syncingToLeafletRef.current = true
            leafletMap.stop()
            syncingToLeafletRef.current = false
          }
        })
        map.on('move', syncToLeaflet)
        map.on('zoomend', (event) => {
          setWorldView(map.getZoom() < 3)
          if (event.originalEvent && followsDriving()) drivingZoomRef.current = map.getZoom()
        })
        map.on('moveend', () => {
          if (applyingLeafletCameraRef.current) return
          if (followsDriving()) {
            leafletMap.fire('moveend')
            return
          }
          syncToLeaflet()
          if (cameraSourceRef.current === 'vector') {
            cameraSourceRef.current = 'leaflet'
            applyingLeafletCameraRef.current = true
            map.jumpTo(readCamera())
            applyingLeafletCameraRef.current = false
          }
          cameraSourceRef.current = null
          leafletMap.fire('moveend')
        })
        const handleManualPan = (event: MapLibreEvent) => {
          if (event.originalEvent && propsRef.current.enabled) {
            if (pitchAnimationRef.current !== null) cancelAnimationFrame(pitchAnimationRef.current)
            pitchAnimationRef.current = null
            manualCameraRef.current = true
            propsRef.current.onManualPan()
          }
        }
        map.on('dragstart', handleManualPan)
        map.on('rotatestart', handleManualPan)
        map.on('pitchstart', handleManualPan)

        propsRef.current.onViewportReady(() => {
          const bounds = map.getBounds()
          return leafletMap.getBounds()
            .extend([bounds.getSouth(), bounds.getWest()])
            .extend([bounds.getNorth(), bounds.getEast()])
        })

        map.on('load', () => {
          if (disposed) return
          if (loadTimeout) clearTimeout(loadTimeout)
          try {
            map.setProjection({ type: 'mercator' })
            map.setLight({ anchor: 'viewport', color: '#fff8ee', intensity: 0.35, position: [1.5, 210, 45] })
            map.setFilter('building-3d', ['!=', ['get', 'hide_3d'], true])
            map.setPaintProperty('building-3d', 'fill-extrusion-height', ['max', 0, ['coalesce', ['get', 'render_height'], 6]])
            map.setPaintProperty('building-3d', 'fill-extrusion-base', ['max', 0, ['coalesce', ['get', 'render_min_height'], 0]])
            map.setPaintProperty('building-3d', 'fill-extrusion-color', '#d6d0c5')
            map.setPaintProperty('building-3d', 'fill-extrusion-opacity', 0.88)
            const labelLayer = map.getStyle().layers?.find((layer) => layer.type === 'symbol' && layer.layout?.['text-field'])?.id
            map.addSource('navigation-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, tolerance: 0.2 })
            for (const casing of [true, false]) {
              map.addLayer({
                id: casing ? 'navigation-route-casing' : 'navigation-route-line',
                type: 'line',
                source: 'navigation-route',
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: { 'line-color': casing ? '#ffffff' : '#2875e5', 'line-width': casing ? 14 : 7, 'line-opacity': casing ? 0.98 : 0.97 },
              }, labelLayer)
            }
            map.addSource('navigation-maneuver', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, tolerance: 0 })
            map.addLayer({
              id: 'navigation-maneuver-line', type: 'line', source: 'navigation-maneuver',
              layout: { 'line-cap': 'round', 'line-join': 'round' },
              paint: { 'line-color': '#df861c', 'line-width': 6, 'line-opacity': 0.95 },
            }, labelLayer)
            map.addSource('navigation-accuracy', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, tolerance: 0 })
            map.addLayer({
              id: 'navigation-accuracy-area', type: 'fill', source: 'navigation-accuracy',
              paint: { 'fill-color': '#2875e5', 'fill-opacity': 0.1, 'fill-outline-color': '#2875e5' },
            }, labelLayer)
            setReady(true)
          } catch {
            fail()
          }
        })

        loadTimeout = setTimeout(fail, 20_000)
        resizeObserver = new ResizeObserver(() => map.resize())
        resizeObserver.observe(containerRef.current)
      } catch {
        fail()
      }
    })()

    return () => {
      disposed = true
      if (loadTimeout) clearTimeout(loadTimeout)
      resizeObserver?.disconnect()
      if (syncFromLeaflet) leafletMap.off('move rotate', syncFromLeaflet)
      if (syncZoomFromLeaflet) leafletMap.off('zoomanim', syncZoomFromLeaflet)
      propsRef.current.onViewportReady(null)
      for (const marker of Object.values(markerRefs.current)) marker?.remove()
      markerRefs.current = {}
      laneMarkerRef.current?.remove()
      laneMarkerRef.current = null
      for (const marker of trafficMarkerRefs.current.values()) marker.remove()
      trafficMarkerRefs.current.clear()
      mapRef.current?.getCanvas().removeEventListener('webglcontextlost', fail)
      mapRef.current?.remove()
      mapRef.current = null
      moduleRef.current = null
      cameraSourceRef.current = null
    }
  }, [props.leafletMap])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    let exitTimeout: ReturnType<typeof setTimeout> | undefined
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (followsDriving()) {
      propsRef.current.onVisibleChange(true)
      return
    }
    const initialPitch = map.getPitch()
    const targetPitch = !props.enabled || worldView ? 0 : props.isNavigating ? props.perspectivePitch : 50
    const duration = reduceMotion ? 0 : props.enabled ? 420 : 320
    const startedAt = performance.now()
    if (props.enabled) propsRef.current.onVisibleChange(true)
    const animatePitch = (now: number) => {
      const progress = duration === 0 ? 1 : Math.min(1, (now - startedAt) / duration)
      const easedProgress = 1 - Math.pow(1 - progress, 3)
      const previousSource = cameraSourceRef.current
      cameraSourceRef.current = 'leaflet'
      applyingLeafletCameraRef.current = true
      map.jumpTo({ pitch: initialPitch + (targetPitch - initialPitch) * easedProgress })
      applyingLeafletCameraRef.current = false
      cameraSourceRef.current = previousSource
      if (progress < 1) {
        pitchAnimationRef.current = requestAnimationFrame(animatePitch)
      } else if (!props.enabled) {
        propsRef.current.onVisibleChange(false)
        exitTimeout = setTimeout(() => propsRef.current.onExited(), reduceMotion ? 0 : 240)
      }
    }
    pitchAnimationRef.current = requestAnimationFrame(animatePitch)
    return () => {
      if (pitchAnimationRef.current !== null) cancelAnimationFrame(pitchAnimationRef.current)
      pitchAnimationRef.current = null
      if (exitTimeout) clearTimeout(exitTimeout)
    }
  }, [props.enabled, props.perspectivePitch, props.isNavigating, props.followLocation, props.drivingPerspectiveRequest, ready, worldView])

  useEffect(() => {
    if (props.followLocation) manualCameraRef.current = false
    drivingZoomRef.current = null
  }, [props.followLocation, props.drivingPerspectiveRequest, props.isNavigating])

  useEffect(() => {
    const map = mapRef.current
    if (!props.enabled) {
      lastZoomRequestRef.current = props.zoomRequest.id
      return
    }
    if (!map || !ready || props.zoomRequest.id === lastZoomRequestRef.current) return
    lastZoomRequestRef.current = props.zoomRequest.id
    const zoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), map.getZoom() + props.zoomRequest.direction))
    if (followsDriving()) drivingZoomRef.current = zoom
    map.easeTo({ zoom, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250 })
  }, [props.zoomRequest, props.enabled, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !followsDriving() || !props.route || !props.currentLocation) return
    const camera = getDrivingCamera(props.route, props.currentLocation, props.activeStepIndex, props.speed, props.headingUpEnabled ? props.heading : null)
      ?? { center: props.currentLocation, bearing: map.getBearing(), zoom: 18.5 }
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    cameraSourceRef.current = 'leaflet'
    map.easeTo({
      center: [camera.center.lon, camera.center.lat],
      bearing: props.headingUpEnabled ? camera.bearing : 0,
      zoom: drivingZoomRef.current ?? camera.zoom,
      pitch: props.perspectivePitch,
      offset: [0, Math.min(70, map.getContainer().clientHeight * 0.08)],
      duration: reduceMotion ? 0 : 900,
      essential: false,
    })
  }, [props.currentLocation, props.route, props.activeStepIndex, props.speed, props.heading, props.headingUpEnabled, props.followLocation, props.enabled, props.perspectivePitch, props.isNavigating, props.drivingPerspectiveRequest, ready])

  useEffect(() => {
    const map = mapRef.current
    const maplibre = moduleRef.current
    if (!map || !maplibre || !ready) return
    laneMarkerRef.current?.remove()
    laneMarkerRef.current = null
    if (!props.laneGuidance) return
    const element = document.createElement('div')
    element.className = 'map-lane-sign'
    element.setAttribute('role', 'img')
    element.setAttribute('aria-label', 'Rêberiya şerîtên li pêş — şematîk, ne cihê GPS')
    element.innerHTML = laneSignMarkup(props.laneGuidance)
    laneMarkerRef.current = new maplibre.Marker({ element, anchor: 'bottom', offset: [0, -16], pitchAlignment: 'viewport', rotationAlignment: 'viewport' })
      .setLngLat([props.laneGuidance.location.lon, props.laneGuidance.location.lat]).addTo(map)
  }, [props.laneGuidance, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const data: GeoJSON.FeatureCollection<GeoJSON.LineString> = { type: 'FeatureCollection', features: [] }
    const route = props.route
    const step = route?.steps[props.activeStepIndex]
    const approach = route?.steps[Math.max(0, props.activeStepIndex - 1)]
    if (props.isNavigating && route?.mode === 'driving' && props.currentLocation && step && approach && !['depart', 'arrive'].includes(step.maneuver.type)) {
      const coordinates = [...approach.geometry.coordinates, ...step.geometry.coordinates]
      if (coordinates.length >= 2) {
        const lengths = roadLengths(coordinates)
        const position = projectToRoad(props.currentLocation, coordinates, lengths)
        const target = projectToRoad({ lon: step.maneuver.location[0], lat: step.maneuver.location[1] }, coordinates, lengths)
        const distance = target.along - position.along
        if (position.distance <= 40 && distance >= -15 && distance <= 800 && step.geometry.coordinates.length >= 2) {
          const exitLengths = roadLengths(step.geometry.coordinates)
          const end = Math.min(220, exitLengths[exitLengths.length - 1])
          const exitCoordinates = step.geometry.coordinates.filter((_, index) => exitLengths[index] < end)
          const last = sampleRoad(step.geometry.coordinates, exitLengths, end)
          exitCoordinates.push([last.lon, last.lat])
          if (exitCoordinates.length >= 2) data.features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: exitCoordinates } })
        }
      }
    }
    ;(map.getSource('navigation-maneuver') as GeoJSONSource).setData(data)
  }, [props.route, props.currentLocation, props.activeStepIndex, props.isNavigating, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const source = map.getSource('navigation-accuracy') as GeoJSONSource
    source.setData(props.currentLocation ? gpsAccuracyRing(props.currentLocation, props.gpsAccuracy) : { type: 'FeatureCollection', features: [] })
  }, [props.currentLocation, props.gpsAccuracy, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const source = map.getSource('navigation-route') as GeoJSONSource
    source.setData({
      type: 'FeatureCollection',
      features: props.route ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: props.route.geometry.coordinates } }] : [],
    })
    const isFoot = props.route?.mode === 'foot'
    const driving = props.isNavigating && !isFoot
    map.setPaintProperty('navigation-route-casing', 'line-width', driving ? 7 : isFoot ? 12 : 14)
    map.setPaintProperty('navigation-route-line', 'line-width', driving ? 4 : isFoot ? 6 : 7)
    map.setPaintProperty('navigation-route-line', 'line-color', isFoot ? '#198a78' : '#2875e5')
    map.setPaintProperty('building-3d', 'fill-extrusion-opacity', driving ? 0.25 : 0.88)
  }, [props.route, props.isNavigating, ready])

  useEffect(() => {
    const map = mapRef.current
    const maplibre = moduleRef.current
    if (!map || !maplibre || !ready) return
    const updateMarker = (kind: 'origin' | 'destination' | 'location', point: Point | null) => {
      const previous = markerRefs.current[kind]
      const driving = kind === 'location' && props.isNavigating && props.route?.mode === 'driving'
      const course = driving && props.route && props.currentLocation
        ? getDrivingCamera(props.route, props.currentLocation, props.activeStepIndex, props.speed, props.heading)?.bearing ?? 0
        : 0
      if (!point) {
        previous?.remove()
        delete markerRefs.current[kind]
        return
      }
      if (previous) {
        previous.setLngLat([point.lon, point.lat])
        if (kind === 'location') {
          previous.getElement().innerHTML = driving ? drivingLocationMarkup : locationMarkup
          previous.setRotationAlignment(driving ? 'map' : 'viewport')
          previous.setRotation(course)
        }
        return
      }
      const element = document.createElement('div')
      element.className = `map-marker map-marker--${kind} map-3d-marker`
      element.innerHTML = kind === 'location' ? driving ? drivingLocationMarkup : locationMarkup : routePinMarkup(kind === 'origin' ? 'Startpunkt' : 'Ziel')
      markerRefs.current[kind] = new maplibre.Marker({
        element,
        anchor: kind === 'location' ? 'center' : 'bottom',
        offset: kind === 'location' ? [0, 0] : [0, 2],
        pitchAlignment: 'viewport',
        rotationAlignment: driving ? 'map' : 'viewport',
        rotation: course,
        subpixelPositioning: true,
      }).setLngLat([point.lon, point.lat]).addTo(map)
    }
    updateMarker('origin', props.origin)
    updateMarker('destination', props.destination)
    updateMarker('location', props.currentLocation)
  }, [props.origin, props.destination, props.currentLocation, props.heading, props.speed, props.route, props.isNavigating, props.activeStepIndex, ready])

  useEffect(() => {
    const map = mapRef.current
    const maplibre = moduleRef.current
    if (!map || !maplibre || !ready) return
    const visibleIds = new Set(props.trafficSignals.map((signal) => signal.id))
    for (const [signalId, marker] of trafficMarkerRefs.current) {
      if (!visibleIds.has(signalId)) {
        marker.remove()
        trafficMarkerRefs.current.delete(signalId)
      }
    }
    for (const signal of props.trafficSignals) {
      if (trafficMarkerRefs.current.has(signal.id)) continue
      const element = document.createElement('div')
      element.className = 'traffic-signal-marker map-3d-traffic-signal'
      element.innerHTML = trafficSignalMarkup
      element.title = trafficSignalLabel
      trafficMarkerRefs.current.set(signal.id, new maplibre.Marker({
        element,
        anchor: 'center',
        offset: [0, 0.5],
        pitchAlignment: 'viewport',
        rotationAlignment: 'viewport',
        subpixelPositioning: true,
      }).setLngLat([signal.lon, signal.lat]).addTo(map))
    }
  }, [props.trafficSignals, ready])

  return <div className={`map-3d-view${props.visible ? ' map-3d-view--visible' : ''}`} ref={containerRef} aria-hidden={!props.visible} inert={!props.visible || !props.enabled} />
}

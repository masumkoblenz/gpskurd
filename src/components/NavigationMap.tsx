import { useEffect, useRef, useState } from 'react'
import type { LatLngBounds, Map as LeafletMap, Marker, Polyline, TileLayer } from 'leaflet'
import type { NavigationRoute, Point } from '@/lib/navigation'
import { locationMarkup, routePinMarkup, trafficSignalLabel, trafficSignalMarkup, type TrafficSignalNode } from '@/lib/map-markers'

import NavigationMap3D from './NavigationMap3D'

export type ZoomRequest = { id: number; direction: -1 | 1 }

type NavigationMapProps = {
  origin: Point | null
  destination: Point | null
  currentLocation: Point | null
  route: NavigationRoute | null
  isNavigating: boolean
  darkMode: boolean
  speed: number | null
  gpsAccuracy: number | null
  activeStepIndex: number
  followLocation: boolean
  headingUpEnabled: boolean
  heading: number | null
  centerRequest: number
  drivingPerspectiveRequest: number
  zoomRequest: ZoomRequest
  onManualPan: () => void
  threeDEnabled: boolean
  perspectivePitch: number
  onThreeDUnavailable: () => void
}

const fallbackCenter: [number, number] = [36.1911, 44.0092]
const trafficSignalEndpoint = 'https://overpass-api.de/api/interpreter'
const minimumTrafficSignalZoom = 14
const minimumTrafficSignalRequestInterval = 60_000

async function fetchTrafficSignals(bounds: LatLngBounds, signal: AbortSignal) {
  const southWest = bounds.getSouthWest()
  const northEast = bounds.getNorthEast()
  const box = [southWest.lat, southWest.lng, northEast.lat, northEast.lng]
    .map((value) => value.toFixed(5))
    .join(',')
  const query = `[out:json][timeout:15];(node["highway"="traffic_signals"](${box});node["highway"="crossing"]["crossing"="traffic_signals"](${box});node["crossing:signals"="yes"](${box}););out body;`
  const response = await fetch(trafficSignalEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ data: query }),
    signal,
  })
  if (!response.ok) throw new Error(`Overpass request failed: ${response.status}`)
  const payload = (await response.json()) as { elements?: TrafficSignalNode[] }
  return (payload.elements ?? []).filter((element) =>
    element.type === 'node' &&
    Number.isFinite(element.id) &&
    Number.isFinite(element.lat) &&
    Number.isFinite(element.lon) &&
    (element.tags?.highway === 'traffic_signals' ||
      element.tags?.crossing === 'traffic_signals' ||
      element.tags?.['crossing:signals'] === 'yes'),
  )
}

export function NavigationMap({
  origin,
  destination,
  currentLocation,
  route,
  isNavigating,
  darkMode,
  speed,
  gpsAccuracy,
  activeStepIndex,
  followLocation,
  headingUpEnabled,
  heading,
  centerRequest,
  drivingPerspectiveRequest,
  zoomRequest,
  onManualPan,
  threeDEnabled,
  perspectivePitch,
  onThreeDUnavailable,
}: NavigationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const basemapRef = useRef<TileLayer | null>(null)
  const trafficViewportRef = useRef<(() => LatLngBounds) | null>(null)
  const [trafficSignals, setTrafficSignals] = useState<TrafficSignalNode[]>([])
  const [threeDMounted, setThreeDMounted] = useState(false)
  const [threeDVisible, setThreeDVisible] = useState(false)
  const [threeDError, setThreeDError] = useState(false)
  const hasTrafficSignalContextRef = useRef(Boolean(currentLocation || origin || destination || route))
  const [mapReady, setMapReady] = useState(false)
  const onManualPanRef = useRef(onManualPan)
  const manualCameraChangeRef = useRef(false)
  const cameraStateRef = useRef({
    origin: null as Point | null,
    destination: null as Point | null,
    currentLocation: null as Point | null,
    route: null as NavigationRoute | null,
    isNavigating: false,
    followLocation: true,
    centerRequest: 0,
    drivingPerspectiveRequest: 0,
  })
  const lastZoomRequestRef = useRef(0)
  const navigationZoomRef = useRef<number | null>(null)
  const layersRef = useRef<{
    origin: Marker | null
    destination: Marker | null
    location: Marker | null
    routeCasing: Polyline | null
    route: Polyline | null
  }>({ origin: null, destination: null, location: null, routeCasing: null, route: null })

  onManualPanRef.current = onManualPan
  hasTrafficSignalContextRef.current = hasTrafficSignalContextRef.current || Boolean(currentLocation || origin || destination || route)

  useEffect(() => {
    let disposed = false
    let resizeObserver: ResizeObserver | undefined
    let trafficSignalDebounceTimer: ReturnType<typeof setTimeout> | undefined
    let trafficSignalThrottleTimer: ReturnType<typeof setTimeout> | undefined
    let trafficSignalRequestController: AbortController | null = null
    void (async () => {
      const leaflet = await import('leaflet')
      await import('@tomickigrzegorz/leaflet-rotate')
      if (disposed || !containerRef.current) return
      const map = leaflet.map(containerRef.current, {
        zoomControl: false,
        attributionControl: true,
        minZoom: 0,
        maxZoom: 21,
        zoomSnap: 0.25,
        zoomDelta: 1,
        wheelPxPerZoomLevel: 120,
        zoomAnimation: true,
        fadeAnimation: true,
        markerZoomAnimation: true,
        bounceAtZoomLimits: false,
        touchZoom: true,
        rotate: true,
        touchRotate: true,
        dragRotate: true,
        shiftKeyRotate: true,
      }).setView(fallbackCenter, 13)
      const exitDrivingPerspective = () => {
        hasTrafficSignalContextRef.current = true
        manualCameraChangeRef.current = true
        onManualPanRef.current()
      }
      const enableTrafficSignalRequests = () => {
        hasTrafficSignalContextRef.current = true
      }
      map.on('dragstart', exitDrivingPerspective)
      map.on('rotatestart', exitDrivingPerspective)
      map.on('zoomstart', enableTrafficSignalRequests)
      basemapRef.current = leaflet
        .tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          className: 'navigation-basemap-tiles',
          minZoom: 0,
          maxZoom: 21,
          maxNativeZoom: 19,
          updateWhenZooming: false,
          keepBuffer: 3,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> Mitwirkende',
        })
        .addTo(map)
      mapRef.current = map
      setMapReady(true)
      const trafficSignalLayer = leaflet.layerGroup().addTo(map)
      let trafficSignalCoverage: LatLngBounds | null = null
      let trafficSignalRequestInFlight = false
      let lastTrafficSignalRequestAt = 0

      let refreshTrafficSignals: () => Promise<void> = async () => undefined
      const scheduleTrafficSignalRefresh = () => {
        if (!hasTrafficSignalContextRef.current) return
        if (trafficSignalDebounceTimer) clearTimeout(trafficSignalDebounceTimer)
        trafficSignalDebounceTimer = setTimeout(() => {
          trafficSignalDebounceTimer = undefined
          const waitTime = minimumTrafficSignalRequestInterval - (Date.now() - lastTrafficSignalRequestAt)
          if (waitTime > 0) {
            if (!trafficSignalThrottleTimer) {
              trafficSignalThrottleTimer = setTimeout(() => {
                trafficSignalThrottleTimer = undefined
                scheduleTrafficSignalRefresh()
              }, waitTime)
            }
            return
          }
          void refreshTrafficSignals()
        }, 650)
      }

      refreshTrafficSignals = async () => {
        if (disposed || mapRef.current !== map) return
        if (map.getZoom() < minimumTrafficSignalZoom) {
          trafficSignalLayer.clearLayers()
          setTrafficSignals([])
          trafficSignalCoverage = null
          return
        }

        const visibleBounds = trafficViewportRef.current?.() ?? map.getBounds()
        if (trafficSignalCoverage?.contains(visibleBounds)) return
        if (trafficSignalRequestInFlight) return

        const requestedBounds = visibleBounds.pad(0.5)
        const controller = new AbortController()
        trafficSignalRequestController = controller
        trafficSignalRequestInFlight = true
        lastTrafficSignalRequestAt = Date.now()
        try {
          const trafficSignals = await fetchTrafficSignals(requestedBounds, controller.signal)
          if (disposed || mapRef.current !== map) return
          if (map.getZoom() < minimumTrafficSignalZoom) {
            trafficSignalLayer.clearLayers()
            setTrafficSignals([])
            trafficSignalCoverage = null
            return
          }
          if (!requestedBounds.contains(trafficViewportRef.current?.() ?? map.getBounds())) {
            trafficSignalCoverage = null
            scheduleTrafficSignalRefresh()
            return
          }

          trafficSignalLayer.clearLayers()
          setTrafficSignals(trafficSignals)
          const renderedSignalIds = new Set<number>()
          for (const trafficSignal of trafficSignals) {
            if (renderedSignalIds.has(trafficSignal.id)) continue
            renderedSignalIds.add(trafficSignal.id)
            leaflet.marker([trafficSignal.lat, trafficSignal.lon], {
              icon: leaflet.divIcon({
                className: 'traffic-signal-marker',
                html: trafficSignalMarkup,
                iconSize: [18, 27],
                iconAnchor: [9, 13],
              }),
              interactive: false,
              keyboard: false,
              title: trafficSignalLabel,
            }).addTo(trafficSignalLayer)
          }
          trafficSignalCoverage = requestedBounds
        } catch {
          trafficSignalCoverage = null
        } finally {
          if (trafficSignalRequestController === controller) trafficSignalRequestController = null
          trafficSignalRequestInFlight = false
        }
      }

      map.on('moveend zoomend rotateend', scheduleTrafficSignalRefresh)
      scheduleTrafficSignalRefresh()
      resizeObserver = new ResizeObserver(() => {
        map.invalidateSize()
        scheduleTrafficSignalRefresh()
      })
      resizeObserver.observe(containerRef.current)
    })()
    return () => {
      disposed = true
      resizeObserver?.disconnect()
      if (trafficSignalDebounceTimer) clearTimeout(trafficSignalDebounceTimer)
      if (trafficSignalThrottleTimer) clearTimeout(trafficSignalThrottleTimer)
      trafficSignalRequestController?.abort()
      mapRef.current?.remove()
      mapRef.current = null
      basemapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const basemap = basemapRef.current
    if (!map || !basemap) return
    if (threeDEnabled) setThreeDError(false)
    if (threeDVisible && threeDEnabled) basemap.remove()
    else if (!map.hasLayer(basemap)) basemap.addTo(map)
  }, [threeDEnabled, threeDVisible, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (threeDVisible) {
      lastZoomRequestRef.current = zoomRequest.id
      return
    }
    if (zoomRequest.id === lastZoomRequestRef.current) return
    lastZoomRequestRef.current = zoomRequest.id
    if (zoomRequest.direction > 0) map.zoomIn(1)
    else map.zoomOut(1)
  }, [zoomRequest, mapReady, threeDVisible])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (headingUpEnabled && heading !== null) {
      map.setHeading(heading, { ease: 0.18, deadzone: 2 })
    } else {
      map.setHeading(null)
      if (!manualCameraChangeRef.current) map.setBearing(0)
      manualCameraChangeRef.current = false
    }
  }, [heading, headingUpEnabled, isNavigating, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    void import('leaflet').then((leaflet) => {
      if (mapRef.current !== map) return
      const layers = layersRef.current
      for (const layer of [layers.origin, layers.destination, layers.routeCasing, layers.route]) {
        if (layer) map.removeLayer(layer)
      }

      const makeMarker = (point: Point, className: string, label: string) =>
        leaflet
          .marker([point.lat, point.lon], {
            icon: leaflet.divIcon({
              className,
              html: routePinMarkup(label),
              iconSize: [36, 44],
              iconAnchor: [18, 42],
            }),
          })
          .addTo(map)

      layersRef.current.origin = origin ? makeMarker(origin, 'map-marker map-marker--origin', 'Startpunkt') : null
      layersRef.current.destination = destination
        ? makeMarker(destination, 'map-marker map-marker--destination', 'Ziel')
        : null
      const routeCoordinates = route?.geometry.coordinates.map(([lon, lat]) => leaflet.latLng(lat, lon))
      const routeMode = route?.mode === 'foot' ? 'foot' : 'driving'
      layersRef.current.routeCasing = routeCoordinates?.length
        ? leaflet.polyline(routeCoordinates, {
            className: `navigation-route-casing navigation-route--${routeMode}`,
            color: '#ffffff',
            weight: routeMode === 'foot' ? 12 : 14,
            opacity: 0.98,
            lineCap: 'round',
            lineJoin: 'round',
            interactive: false,
          }).addTo(map)
        : null
      layersRef.current.route = routeCoordinates?.length
        ? leaflet.polyline(routeCoordinates, {
            className: `navigation-route navigation-route--${routeMode}${isNavigating ? ' navigation-route--active' : ''}`,
            color: routeMode === 'foot' ? '#198a78' : '#2875e5',
            weight: routeMode === 'foot' ? 6 : 7,
            opacity: 0.97,
            lineCap: 'round',
            lineJoin: 'round',
            interactive: false,
          }).addTo(map)
        : null
    })
  }, [origin, destination, route, isNavigating, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    void import('leaflet').then((leaflet) => {
      if (mapRef.current !== map) return
      const locationMarker = layersRef.current.location
      if (!currentLocation) {
        if (locationMarker) map.removeLayer(locationMarker)
        layersRef.current.location = null
        return
      }
      if (locationMarker) {
        locationMarker.setLatLng([currentLocation.lat, currentLocation.lon])
        return
      }
      layersRef.current.location = leaflet
        .marker([currentLocation.lat, currentLocation.lon], {
          icon: leaflet.divIcon({
            className: 'map-marker map-marker--location',
            html: locationMarkup,
            iconSize: [44, 44],
            iconAnchor: [22, 22],
          }),
        })
        .addTo(map)
    })
  }, [currentLocation, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    const previous = cameraStateRef.current
    const navigationStarted = isNavigating && !previous.isNavigating
    const navigationStopped = !isNavigating && previous.isNavigating
    const centerRequested = centerRequest !== previous.centerRequest
    const drivingPerspectiveRequested = drivingPerspectiveRequest !== previous.drivingPerspectiveRequest
    const routeChanged = route !== previous.route
    const locationChanged = currentLocation !== previous.currentLocation
    const originChanged = origin !== previous.origin
    const destinationChanged = destination !== previous.destination
    const focus = currentLocation ?? origin ?? destination
    const showRoute = () => {
      if (!route?.geometry.coordinates.length) return false
      map.fitBounds(
        route.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]),
        { padding: [52, 52], maxZoom: 15, animate: true },
      )
      return true
    }

    if (drivingPerspectiveRequested && focus) {
      manualCameraChangeRef.current = false
      map.setBearing(0)
      map.setHeading(headingUpEnabled && heading !== null ? heading : null, { ease: 0.18, deadzone: 2 })
      const zoom = isNavigating ? navigationZoomRef.current ?? Math.max(map.getZoom(), 17) : undefined
      map.flyTo([focus.lat, focus.lon], zoom, { animate: true, duration: 0.65 })
    } else if (centerRequested && focus) {
      map.flyTo([focus.lat, focus.lon], undefined, { animate: true, duration: 0.65 })
    } else if (navigationStarted) {
      if (focus) {
        navigationZoomRef.current = Math.max(map.getZoom(), 17)
        map.setView([focus.lat, focus.lon], navigationZoomRef.current, { animate: true })
      }
      else showRoute()
    } else if (navigationStopped && route) {
      navigationZoomRef.current = null
      showRoute()
    } else if (!isNavigating && routeChanged && route) {
      showRoute()
    } else if (destinationChanged && destination && !route) {
      map.flyTo([destination.lat, destination.lon], 15, { animate: true })
    } else if (isNavigating && followLocation && locationChanged && currentLocation) {
      map.panTo([currentLocation.lat, currentLocation.lon], { animate: true, duration: 0.65 })
    } else if (!isNavigating && followLocation && !route && (originChanged || locationChanged) && focus) {
      map.setView([focus.lat, focus.lon], 15, { animate: true })
    } else if (!cameraStateRef.current.origin && !cameraStateRef.current.destination && focus) {
      map.setView([focus.lat, focus.lon], 15)
    }

    cameraStateRef.current = { origin, destination, currentLocation, route, isNavigating, followLocation, centerRequest, drivingPerspectiveRequest }
  }, [origin, destination, currentLocation, route, isNavigating, followLocation, heading, headingUpEnabled, centerRequest, drivingPerspectiveRequest, mapReady])

  return (
    <div className="map-canvas">
      <div className={`map-inner map-2d-view${threeDVisible ? ' map-2d-view--hidden' : ''}`} ref={containerRef} role="application" aria-label="OpenStreetMap-Karte" aria-hidden={threeDVisible} inert={threeDVisible} />
      {(threeDEnabled || threeDMounted) && mapReady && mapRef.current && (
          <NavigationMap3D
            leafletMap={mapRef.current}
            enabled={threeDEnabled}
            darkMode={darkMode}
            perspectivePitch={perspectivePitch}
            visible={threeDVisible}
            origin={origin}
            destination={destination}
            currentLocation={currentLocation}
            route={route}
            trafficSignals={trafficSignals}
            isNavigating={isNavigating}
            followLocation={followLocation}
            headingUpEnabled={headingUpEnabled}
            heading={heading}
            speed={speed}
            gpsAccuracy={gpsAccuracy}
            activeStepIndex={activeStepIndex}
            drivingPerspectiveRequest={drivingPerspectiveRequest}
            zoomRequest={zoomRequest}
            onManualPan={() => {
              hasTrafficSignalContextRef.current = true
              manualCameraChangeRef.current = true
              onManualPanRef.current()
            }}
            onViewportReady={(getBounds) => { trafficViewportRef.current = getBounds }}
            onVisibleChange={(visible) => {
              setThreeDMounted(true)
              setThreeDVisible(visible)
            }}
            onExited={() => {
              setThreeDVisible(false)
            }}
            onUnavailable={() => {
              setThreeDError(true)
              setThreeDMounted(false)
              setThreeDVisible(false)
              onThreeDUnavailable()
            }}
          />
      )}
      {threeDEnabled && !threeDVisible && <div className="map-3d-status" role="status">Nexşeya 3D tê barkirin…</div>}
      {threeDError && <div className="map-3d-status" role="alert">Nexşeya 3D ne berdest e. Nexşeya 2D çalak e.</div>}
    </div>
  )
}

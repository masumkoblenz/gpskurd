import { useEffect, useRef, useState } from 'react'
import type { Map as LeafletMap, Marker, Polyline } from 'leaflet'
import type { NavigationRoute, Point } from '@/lib/navigation'

export type ZoomRequest = { id: number; direction: -1 | 1 }

type NavigationMapProps = {
  origin: Point | null
  destination: Point | null
  currentLocation: Point | null
  route: NavigationRoute | null
  isNavigating: boolean
  followLocation: boolean
  headingUpEnabled: boolean
  heading: number | null
  centerRequest: number
  zoomRequest: ZoomRequest
  onManualPan: () => void
}

const fallbackCenter: [number, number] = [36.1911, 44.0092]

export function NavigationMap({
  origin,
  destination,
  currentLocation,
  route,
  isNavigating,
  followLocation,
  headingUpEnabled,
  heading,
  centerRequest,
  zoomRequest,
  onManualPan,
}: NavigationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const onManualPanRef = useRef(onManualPan)
  const cameraStateRef = useRef({
    origin: null as Point | null,
    destination: null as Point | null,
    currentLocation: null as Point | null,
    route: null as NavigationRoute | null,
    isNavigating: false,
    followLocation: true,
    centerRequest: 0,
  })
  const lastZoomRequestRef = useRef(0)
  const layersRef = useRef<{
    origin: Marker | null
    destination: Marker | null
    location: Marker | null
    route: Polyline | null
  }>({ origin: null, destination: null, location: null, route: null })

  onManualPanRef.current = onManualPan

  useEffect(() => {
    let disposed = false
    let resizeObserver: ResizeObserver | undefined
    void (async () => {
      const leaflet = await import('leaflet')
      await import('@tomickigrzegorz/leaflet-rotate')
      if (disposed || !containerRef.current) return
      const map = leaflet.map(containerRef.current, {
        zoomControl: false,
        attributionControl: true,
        minZoom: 8,
        maxZoom: 19,
        zoomSnap: 1,
        zoomDelta: 1,
        touchZoom: true,
        rotate: true,
        touchRotate: true,
        dragRotate: true,
        shiftKeyRotate: true,
      }).setView(fallbackCenter, 13)
      map.on('dragstart', () => onManualPanRef.current())
      leaflet
        .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> Mitwirkende',
        })
        .addTo(map)
      mapRef.current = map
      setMapReady(true)
      resizeObserver = new ResizeObserver(() => map.invalidateSize())
      resizeObserver.observe(containerRef.current)
    })()
    return () => {
      disposed = true
      resizeObserver?.disconnect()
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (zoomRequest.id === lastZoomRequestRef.current) return
    lastZoomRequestRef.current = zoomRequest.id
    if (zoomRequest.direction > 0) map.zoomIn(1)
    else map.zoomOut(1)
  }, [zoomRequest, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (isNavigating && headingUpEnabled && heading !== null) {
      map.setHeading(heading, { ease: 0.18, deadzone: 2 })
    } else {
      map.setHeading(null)
      map.setBearing(0)
    }
  }, [heading, headingUpEnabled, isNavigating, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    void import('leaflet').then((leaflet) => {
      if (mapRef.current !== map) return
      const layers = layersRef.current
      for (const layer of [layers.origin, layers.destination, layers.route]) {
        if (layer) map.removeLayer(layer)
      }

      const makeMarker = (point: Point, className: string, label: string) =>
        leaflet
          .marker([point.lat, point.lon], {
            icon: leaflet.divIcon({
              className,
              html: `<span aria-label="${label}"></span>`,
              iconSize: [28, 28],
              iconAnchor: [14, 14],
            }),
          })
          .addTo(map)

      layersRef.current.origin = origin ? makeMarker(origin, 'map-marker map-marker--origin', 'Startpunkt') : null
      layersRef.current.destination = destination
        ? makeMarker(destination, 'map-marker map-marker--destination', 'Ziel')
        : null
      layersRef.current.route = route
        ? leaflet
            .polyline(
              route.geometry.coordinates.map(([lon, lat]) => leaflet.latLng(lat, lon)),
              { color: '#1a73e8', weight: 6, opacity: 0.94, lineCap: 'round', lineJoin: 'round' },
            )
            .addTo(map)
        : null
    })
  }, [origin, destination, route, mapReady])

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
            html: '<span aria-label="Ihr Standort"></span>',
            iconSize: [28, 28],
            iconAnchor: [14, 14],
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

    if (centerRequested && focus) {
      map.flyTo([focus.lat, focus.lon], undefined, { animate: true, duration: 0.65 })
    } else if (navigationStarted) {
      if (focus) map.setView([focus.lat, focus.lon], Math.max(map.getZoom(), 16), { animate: true })
      else showRoute()
    } else if (navigationStopped && route) {
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

    cameraStateRef.current = { origin, destination, currentLocation, route, isNavigating, followLocation, centerRequest }
  }, [origin, destination, currentLocation, route, isNavigating, followLocation, centerRequest, mapReady])

  return (
    <div className="map-canvas">
      <div className="map-inner" ref={containerRef} role="application" aria-label="OpenStreetMap-Karte" />
    </div>
  )
}

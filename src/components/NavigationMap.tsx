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
  const manualCameraChangeRef = useRef(false)
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
    routeCasing: Polyline | null
    route: Polyline | null
  }>({ origin: null, destination: null, location: null, routeCasing: null, route: null })

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
      const exitDrivingPerspective = () => {
        manualCameraChangeRef.current = true
        onManualPanRef.current()
      }
      map.on('dragstart', exitDrivingPerspective)
      map.on('rotatestart', exitDrivingPerspective)
      leaflet
        .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          className: 'navigation-basemap-tiles',
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
              html: `<span role="img" aria-label="${label}"><svg viewBox="0 0 36 44" aria-hidden="true"><path d="M18 2C9.2 2 2 9.1 2 17.7c0 11.1 16 24.3 16 24.3s16-13.2 16-24.3C34 9.1 26.8 2 18 2Z"/><circle cx="18" cy="17" r="6"/></svg></span>`,
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
            html: '<span role="img" aria-label="Ihr Standort"><i></i></span>',
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

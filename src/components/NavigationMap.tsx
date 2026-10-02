import { useEffect, useRef, useState } from 'react'
import type { Map as LeafletMap, Marker, Polyline } from 'leaflet'
import type { NavigationRoute, Point } from '@/lib/navigation'

type NavigationMapProps = {
  origin: Point | null
  destination: Point | null
  currentLocation: Point | null
  route: NavigationRoute | null
  isNavigating: boolean
  centerRequest: number
}

const fallbackCenter: [number, number] = [36.1911, 44.0092]

export function NavigationMap({
  origin,
  destination,
  currentLocation,
  route,
  isNavigating,
  centerRequest,
}: NavigationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const cameraStateRef = useRef({
    origin: null as Point | null,
    currentLocation: null as Point | null,
    route: null as NavigationRoute | null,
    isNavigating: false,
    centerRequest: 0,
  })
  const cameraInitializedRef = useRef(false)
  const layersRef = useRef<{
    origin: Marker | null
    destination: Marker | null
    location: Marker | null
    route: Polyline | null
  }>({ origin: null, destination: null, location: null, route: null })

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
        rotate: true,
        touchRotate: true,
        dragRotate: true,
        shiftKeyRotate: true,
      }).setView(fallbackCenter, 13)
      leaflet.control.zoom({ position: 'bottomright' }).addTo(map)
      leaflet
        .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
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
    if (!map) return
    void import('leaflet').then((leaflet) => {
      const layers = layersRef.current
      for (const layer of [layers.origin, layers.destination, layers.location, layers.route]) {
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

      layersRef.current.origin = origin ? makeMarker(origin, 'map-marker map-marker--origin', 'Destpêk') : null
      layersRef.current.destination = destination
        ? makeMarker(destination, 'map-marker map-marker--destination', 'Armanc')
        : null
      layersRef.current.location = currentLocation
        ? makeMarker(currentLocation, 'map-marker map-marker--location', 'Cihê te')
        : null
      layersRef.current.route = route
        ? leaflet
            .polyline(
              route.geometry.coordinates.map(([lon, lat]) => leaflet.latLng(lat, lon)),
              { color: '#4285f4', weight: 4, opacity: 0.92, lineCap: 'round', lineJoin: 'round' },
            )
            .addTo(map)
        : null

    })
  }, [origin, destination, currentLocation, route, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const previous = cameraStateRef.current
    const navigationStarted = isNavigating && !previous.isNavigating
    const navigationStopped = !isNavigating && previous.isNavigating
    const centerRequested = centerRequest !== previous.centerRequest
    const routeChanged = route !== previous.route
    const locationChanged = currentLocation !== previous.currentLocation
    const originChanged = origin !== previous.origin
    const focus = currentLocation ?? origin
    const showRoute = () => {
      if (!route?.geometry.coordinates.length) return false
      map.fitBounds(
        route.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]),
        { padding: [52, 52], maxZoom: 13 },
      )
      return true
    }

    if (!cameraInitializedRef.current) {
      cameraInitializedRef.current = true
      if (isNavigating && route) {
        map.setBearing(0)
        showRoute()
      } else if (focus) {
        map.setView([focus.lat, focus.lon], 15)
      }
    } else if (navigationStarted) {
      map.setBearing(0)
      showRoute()
    } else if (centerRequested) {
      map.setBearing(0)
      if (focus) map.flyTo([focus.lat, focus.lon], isNavigating ? 18 : 15, { animate: true })
    } else if (navigationStopped && route) {
      showRoute()
    } else if (!isNavigating && routeChanged && !route && focus) {
      map.flyTo([focus.lat, focus.lon], 15, { animate: true })
    } else if (!isNavigating && !route && (locationChanged || originChanged) && focus) {
      map.setView([focus.lat, focus.lon], 15, { animate: true })
    }

    cameraStateRef.current = { origin, currentLocation, route, isNavigating, centerRequest }
  }, [origin, currentLocation, route, isNavigating, centerRequest, mapReady])

  return (
    <div className="map-canvas">
      <div className="map-inner" ref={containerRef} role="application" aria-label="Nexşeya OpenStreetMap" />
    </div>
  )
}

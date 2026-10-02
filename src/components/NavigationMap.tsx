import { useEffect, useRef, useState } from 'react'
import type { Map as LeafletMap, Marker, Polyline } from 'leaflet'
import type { NavigationRoute, Point } from '@/lib/navigation'

type NavigationMapProps = {
  origin: Point | null
  destination: Point | null
  currentLocation: Point | null
  route: NavigationRoute | null
  isNavigating: boolean
}

const fallbackCenter: [number, number] = [36.1911, 44.0092]

export function NavigationMap({
  origin,
  destination,
  currentLocation,
  route,
  isNavigating,
}: NavigationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const layersRef = useRef<{
    origin: Marker | null
    destination: Marker | null
    location: Marker | null
    route: Polyline | null
  }>({ origin: null, destination: null, location: null, route: null })

  useEffect(() => {
    let disposed = false
    let resizeObserver: ResizeObserver | undefined
    void import('leaflet').then((leaflet) => {
      if (disposed || !containerRef.current) return
      const map = leaflet.map(containerRef.current, {
        zoomControl: false,
        attributionControl: true,
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
    })
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
              { color: '#267d6a', weight: 6, opacity: 0.9, lineCap: 'round', lineJoin: 'round' },
            )
            .addTo(map)
        : null

      if (isNavigating && currentLocation) {
        map.setView([currentLocation.lat, currentLocation.lon], 17, { animate: true })
      } else if (route && route.geometry.coordinates.length) {
        map.fitBounds(layersRef.current.route!.getBounds(), { padding: [52, 52], maxZoom: 15 })
      } else if (currentLocation) {
        map.setView([currentLocation.lat, currentLocation.lon], 15)
      } else if (origin) {
        map.setView([origin.lat, origin.lon], 15)
      }
    })
  }, [origin, destination, currentLocation, route, isNavigating, mapReady])

  return (
    <div className="map-canvas">
      <div className="map-inner" ref={containerRef} role="application" aria-label="Nexşeya OpenStreetMap" />
    </div>
  )
}

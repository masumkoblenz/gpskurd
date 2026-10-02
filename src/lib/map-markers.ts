export type TrafficSignalNode = {
  type: string
  id: number
  lat: number
  lon: number
  tags?: Record<string, string>
}

export const trafficSignalLabel = 'Çiraya trafîkê — rewşa niha nayê zanîn'

export const trafficSignalMarkup = `<span role="img" aria-label="${trafficSignalLabel}"><svg viewBox="0 0 20 29" aria-hidden="true"><rect x="3" y="1" width="14" height="22" rx="4" fill="#28323b" stroke="#fff" stroke-width="1.2"/><g stroke="#182129" stroke-width=".8" fill-opacity=".75"><circle cx="10" cy="6" r="2.6" fill="#e53935"/><circle cx="10" cy="12" r="2.6" fill="#fbc02d"/><circle cx="10" cy="18" r="2.6" fill="#1aa653"/></g><path d="M10 23v5" stroke="#28323b" stroke-width="2" stroke-linecap="round"/></svg></span>`

export function routePinMarkup(label: string) {
  return `<span role="img" aria-label="${label}"><svg viewBox="0 0 36 44" aria-hidden="true"><path d="M18 2C9.2 2 2 9.1 2 17.7c0 11.1 16 24.3 16 24.3s16-13.2 16-24.3C34 9.1 26.8 2 18 2Z"/><circle cx="18" cy="17" r="6"/></svg></span>`
}

export const locationMarkup = '<span role="img" aria-label="Ihr Standort"><i></i></span>'

export const drivingLocationMarkup = '<span class="driving-location" role="img" aria-label="Cihê GPS — şerîta niha nayê zanîn"><svg viewBox="0 0 44 44" aria-hidden="true"><path d="M22 4 36 35 22 29 8 35Z" fill="#2875e5" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg></span>'

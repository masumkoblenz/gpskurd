# Rêber project guide

Rêber is a Kurmancî-first, responsive driving-navigation web app. It uses TanStack Start with React and Leaflet. The browser obtains location through the Geolocation API, finds places through Nominatim, requests driving routes from OSRM, and reads instructions with the Web Speech API.

## Structure

- `src/routes/index.tsx` contains the navigation flow and Kurmancî interface.
- `src/components/NavigationMap.tsx` owns the Leaflet map and its route/location layers.
- `src/lib/navigation.ts` contains geocoding, OSRM access, route instruction localization, and distance helpers.
- `src/routes/__root.tsx` provides document metadata, page language, and global CSS imports.
- `src/styles.css` contains the responsive map-and-navigation-panel design.
- `public/` holds static assets.

## Conventions and decisions

- Keep visible interface copy in Kurmancî and use semantic buttons/forms with accessible labels.
- Keep geolocation, mapping, search, and speech in browser APIs; do not add paid API keys or persistent storage for navigation state.
- Nominatim search runs only after the user submits a query; do not add autocomplete or high-frequency lookups.
- Preserve OpenStreetMap tile attribution. Public OSM, Nominatim, and OSRM endpoints are best-effort services and may apply usage limits.
- Leaflet is dynamically imported from the map component so server rendering does not access browser globals.
- Use local React state for the current route and active navigation session.

## Local development

Install dependencies with `pnpm install`, then run `pnpm dev`. GPS access requires a secure context such as `localhost` and user permission.

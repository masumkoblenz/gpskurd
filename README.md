# Rêber

Rêber is a responsive Kurmancî navigation app for phones and desktop. It combines an OpenStreetMap map, browser GPS, place search, OSRM driving routes, translated turn-by-turn instructions, off-route recalculation, and spoken Kurmancî guidance generated locally in the browser with Piper.

## Run locally

1. Install Node.js 22 or newer and pnpm.
2. Run `pnpm install` from the project directory.
3. Run `netlify dev --port 8889`.
4. Allow location access in the browser. GPS is available on `localhost` and on secure HTTPS sites.
5. Search for a destination, choose a result, calculate the route, then start guidance.

Map tiles come from OpenStreetMap, geocoding from Nominatim, and route calculation from the public OSRM demo service. Search is submitted manually rather than as-you-type. These shared public services are best-effort and may have usage limits or temporary outages; production traffic should use appropriately hosted services. The first spoken instruction downloads a 77 MB Kurmancî Piper model and supporting WebAssembly assets from Hugging Face and jsDelivr. The browser caches the model when storage is available and generates speech locally; navigation instructions are not sent to a TTS provider. No TTS API key is required.

The project uses TanStack Start, React, TypeScript, Leaflet, and lucide-react. Route state stays in the browser and is not saved.

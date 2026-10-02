# Rêber

Rêber is a responsive Kurmancî navigation app for phones and desktop. It combines an OpenStreetMap map, browser GPS, place search, OSRM driving routes, translated turn-by-turn instructions, off-route recalculation, and spoken Kurmancî guidance generated locally in the browser with Piper.

## Run locally

1. Install Node.js 22 or newer and pnpm.
2. Run `pnpm install` from the project directory.
3. Run `netlify dev --port 8889`.
4. Allow location access in the browser. GPS is available on `localhost` and on secure HTTPS sites.
5. Search for a destination, choose a result, calculate the route, then start guidance.

Map tiles come from OpenStreetMap, geocoding from Nominatim, and route calculation from the public OSRM demo service. Search is submitted manually rather than as-you-type. These shared public services are best-effort and may have usage limits or temporary outages; production traffic should use appropriately hosted services. The first spoken instruction downloads a 77 MB Kurmancî Piper model and supporting WebAssembly assets from Hugging Face and jsDelivr. The browser caches the model when storage is available and generates speech locally; navigation instructions are not sent to a TTS provider. No TTS API key is required.

## Driving perspective and lane guidance

Starting a driving session activates the tilted MapLibre view. The camera follows the GPS course, uses the nearby active route segment when a reliable course is unavailable, and looks ahead with speed-dependent framing. Manual map interaction pauses following; the driving-perspective control restores it. Zoom controls work in both map views, and Leaflet remains the fallback when the 3D renderer is unavailable.

Upcoming maneuvers highlight the actual outgoing route geometry. Where OSRM supplies intersection lane indications, every supplied lane is shown in left-to-right order in a schematic sign at that intersection and in the guidance panel, with recommended lanes in green. Guidance is available up to 800 route meters before the intersection. These intersection indications do not establish continuous lane geometry, lane width, or the driver's current lane, so they are not drawn as fabricated road surfaces. The GPS marker stays at the measured location, with an accuracy area in the 3D view; it is never moved onto a recommended lane. Missing lane data and the unknown current lane are explicitly identified in the Kurmancî interface. Unprovided lanes, exits, and lane-change trajectories are not inferred.

The project uses TanStack Start, React, TypeScript, Leaflet, MapLibre, and lucide-react. Route state stays in the browser and is not saved.

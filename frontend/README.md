# Frontend

The frontend is a React/Vite application consuming the backend API under `/api/v1`.

## Run locally

```bash
npm run dev --workspace frontend
```

Optional configuration in `frontend/.env` (the default uses the Vite proxy and
keeps the HttpOnly cookie on the frontend origin):

```dotenv
# Only set this when the API is intentionally hosted at another origin.
# VITE_API_BASE_URL=http://localhost:3000/api/v1
VITE_MAP_TILE_URL=https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png
```

## Implemented routes

- `/` — Ask/Bếp natural-language discovery home
- `/auth` — sign in, sign up, verification, password reset, and Google auth entry
- `/discover` — restaurant and dish discovery from the backend catalog
- `/search` — inspiration-first Explore page with cuisine, mood, occasion, seasonal, and trending sections
- `/map` — restaurant list with Leaflet map and list fallback
- `/saved` — authenticated saved restaurants
- `/profile` — authenticated preferences and account settings
- `/restaurants/:id` — restaurant detail, source link, contact data, dishes, and related places
- `/dishes/:id` — dish detail and places serving the dish

Routing is handled by React Router. API calls use the small typed client in
`src/lib/api.ts`; the project does not currently depend on TanStack Query.
Leaflet is used for the map with a list-based fallback for results.

## Current test boundary

The frontend has typecheck, production-build, native Node unit tests, and a
Playwright browser smoke suite. Coverage includes recommendation, empty/error
states, discovery and map navigation, Explore-to-Ask prompt handoff, auth
validation, and authenticated save flow. The remaining browser-quality work is
accessibility and visual polish for the portfolio release, not a missing E2E
foundation.

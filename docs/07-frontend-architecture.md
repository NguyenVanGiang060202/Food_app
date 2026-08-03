# Food Discovery Platform - Frontend Architecture

## 1. Purpose

This document defines the architecture of the Food Discovery Platform web application. The frontend provides a responsive discovery experience for searching, filtering, viewing, and saving restaurants while consuming the backend API as its only business-data source.

The frontend is a presentation and interaction layer. It must not crawl sources, normalize external data, own canonical restaurant data, or duplicate backend ranking rules.

---

## 2. Technology Baseline

| Area | Technology | Role |
| --- | --- | --- |
| Framework | React | Component-based web UI. |
| Language | TypeScript | Type-safe UI and API contracts. |
| Build tooling | Vite | Local development server and production builds. |
| Styling | Tailwind CSS | Responsive styling and reusable design tokens. |
| Map rendering | Leaflet | Interactive restaurant map and location features. |
| API transport | Fetch-based client or approved HTTP wrapper | Calls the REST API. |
| Server-state cache | React Query / TanStack Query | Fetching, caching, invalidation, and async states. |
| Client state | React state/context; a small store only when needed | UI-only state such as filters and map state. |

The final dependency list must be recorded in the frontend package manifest. New libraries require a clear purpose and must not duplicate an existing capability.

---

## 3. Design Principles

- **API-first:** Use backend APIs for all restaurant, search, user, and recommendation data.
- **Feature-oriented organization:** Group components, hooks, API functions, and tests by user-facing feature.
- **Server state is not client state:** Remote API data belongs in the query cache; transient UI state stays local or in a small UI store.
- **Responsive by default:** Primary flows must work on mobile, tablet, and desktop.
- **Accessible by default:** Use semantic HTML, keyboard navigation, labels, focus management, and sufficient contrast.
- **Graceful loading and errors:** Every async view has loading, empty, and error states.
- **Progressive enhancement:** Map, geolocation, and AI-enhanced features require useful fallbacks.
- **No domain duplication:** Search ranking, canonical formatting, authorization, and data-quality decisions remain backend responsibilities.

---

## 4. Application Structure

```text
frontend/
├── src/
│   ├── app/
│   │   ├── router/
│   │   ├── providers/
│   │   └── layouts/
│   ├── features/
│   │   ├── search/
│   │   ├── restaurants/
│   │   ├── categories/
│   │   ├── recommendations/
│   │   ├── auth/
│   │   ├── profile/
│   │   └── admin/
│   ├── components/
│   │   ├── ui/
│   │   └── shared/
│   ├── lib/
│   │   ├── api/
│   │   ├── formatters/
│   │   └── validation/
│   ├── hooks/
│   ├── styles/
│   ├── types/
│   └── main.tsx
├── public/
└── tests/
```

`features/` contains feature-specific views, components, hooks, API adapters, and tests. `components/ui/` contains generic reusable UI primitives with no restaurant-domain knowledge. Shared components should be introduced only after they are used by more than one feature.

---

## 5. Routing

Initial public routes:

| Route | Page | Purpose |
| --- | --- | --- |
| `/` | Home | Entry point, search prompt, featured discovery. |
| `/search` | Search results | Filtered list and map view for restaurant discovery. |
| `/restaurants/:restaurantId` | Restaurant detail | Full public restaurant information. |
| `/categories/:slug` | Category discovery | Restaurants for a category. |
| `/recommendations` | Recommendations | Contextual recommendation flow and results. |
| `/login` | Authentication | Sign-in flow when authentication is implemented. |
| `/profile` | User profile | Preferences and saved restaurants; authenticated. |
| `/admin/*` | Admin area | Protected operational and curation interfaces. |

Route parameters and query strings are validated before use. Search state that should be shareable or bookmarkable belongs in the URL, such as `query`, category, location context, sort order, and filter values.

---

## 6. Page and Feature Responsibilities

### Search and Discovery

The search feature:

- Reads query and filter state from the URL.
- Calls `GET /api/v1/search` or the structured restaurant-list endpoint.
- Displays loading, empty, error, and paginated-result states.
- Synchronizes result-list selection with the map when a map is available.
- Allows users to update filters without locally reimplementing ranking.

### Restaurant Detail

The restaurant-detail feature:

- Requests one canonical restaurant by public ID.
- Displays available address, map, categories, hours, dishes, images, and review summaries.
- Clearly handles absent or incomplete data.
- Supports save/unsave actions only for authenticated users.

### Recommendations

The recommendation feature:

- Captures a natural-language request and optional location.
- Calls the recommendation API.
- Displays ranked results and optional explanations.
- Treats AI explanations as supporting text, not as a source of unverified facts.

### Profile

The profile feature manages user-owned preferences and saved places through authenticated APIs. It must not store long-lived credentials in application state outside the approved authentication mechanism.

### Admin

The admin feature is a separate, protected surface for source status, crawl runs, processing failures, and data review. It must not expose raw credentials, restricted source payloads, or unrestricted crawl controls.

---

## 7. API Integration

All HTTP requests go through a centralized API client.

```text
Feature component
        ↓
Feature hook / query hook
        ↓
Typed API function
        ↓
Shared API client
        ↓
/api/v1 backend endpoint
```

The API client is responsible for base URL configuration, request IDs where applicable, authentication headers, response parsing, and conversion of non-success responses into typed application errors.

Feature code is responsible for using endpoint-specific request and response types. It must not call `fetch` directly from presentational components.

API types should be generated from OpenAPI when the backend documentation is stable. Until then, manually maintained types must stay aligned with [06-backend-api-design.md](06-backend-api-design.md) and contract tests.

---

## 8. Data Fetching and State Management

### Server state

Use a query cache for all API-backed data. Query keys must be stable and include every input that changes a result.

Examples:

```text
["restaurant", restaurantId]
["search", normalizedSearchParameters]
["categories"]
["savedRestaurants", currentUserId]
```

The query layer manages caching, refetching, loading, errors, pagination, and mutation invalidation.

### Client state

Keep UI-only state close to the component that owns it. Examples include modal visibility, selected map marker, temporary form values, and display-mode selection.

Use context or a small client-state store only for state shared across distant components, such as theme preference, authenticated-session summary, or a transient global notification queue.

Do not copy API responses into global client state unless there is a demonstrated reason.

---

## 9. Search and Filter UX

Search is a primary product flow. The UI must support:

- Free-text restaurant, dish, and food-intent queries.
- Category, rating, price, location, radius, and open-now filters when supported by the API.
- Sort choices provided by the backend.
- Clear filter chips and one-click removal.
- Reset behavior that preserves an understandable default search state.
- URL synchronization for shareable results.
- Debounced text input only where it does not interfere with explicit submit or accessibility.

The client sends declared filters to the API. It may apply presentation-only filtering to currently rendered content, but it must not claim that such filtering represents the complete catalog.

---

## 10. Map and Location Handling

Leaflet renders restaurant markers from canonical coordinates returned by the API.

### Requirements

- Request browser geolocation only after a clear user action and explain its purpose.
- Continue to work when the user denies location access.
- Use server-provided distance and search results as the ranking source.
- Cluster or virtualize markers when result volume requires it.
- Keep the selected result and selected marker synchronized accessibly.
- Use a configurable map-tile provider; do not hard-code provider-specific assumptions into feature components.

Client location is sensitive data. Do not persist it unless a user explicitly saves a location preference and the privacy model supports it.

---

## 11. UI System and Styling

Tailwind CSS provides implementation utilities, while the project maintains a small design system for consistency.

Shared primitives may include:

- Buttons, inputs, selects, checkboxes, and form-field wrappers.
- Cards, badges, tabs, dialogs, drawers, and alerts.
- Skeleton loaders, empty states, error states, and pagination controls.
- Restaurant-summary cards and map popups as domain-aware shared components.

Use semantic elements before generic containers. Design tokens for color, spacing, typography, radius, and breakpoints should be centralized in Tailwind configuration or CSS variables.

---

## 12. Accessibility

The application must meet a practical WCAG 2.1 AA baseline where applicable.

- Every interactive control is keyboard reachable and has an accessible name.
- Forms have labels, error descriptions, and clear validation feedback.
- Dialogs manage focus correctly and close predictably.
- Search results announce loading and update states appropriately.
- Color is not the only indicator of state.
- Images have meaningful alt text or are marked decorative.
- Map content has a list-based alternative for keyboard and screen-reader users.

Accessibility is part of feature acceptance criteria, not a final visual-polish step.

---

## 13. Error, Empty, and Loading States

Every data-backed screen must define:

| State | Required behavior |
| --- | --- |
| Loading | Show a meaningful skeleton or progress state without blocking unrelated UI. |
| Empty | Explain that no data matched and offer a useful next action. |
| Error | Show a safe, human-readable message and a retry action where appropriate. |
| Partial data | Render known values and label or hide unavailable fields appropriately. |
| Unauthorized | Explain sign-in requirements without exposing protected data. |

Errors from the backend should map to user-friendly messages while preserving a request ID for support and diagnostics.

---

## 14. Performance

- Code-split route-level pages and heavy optional features such as maps.
- Use responsive images and lazy-load non-critical media.
- Virtualize long results when necessary.
- Debounce high-frequency user input and cancel obsolete requests where supported.
- Avoid fetching restaurant details for every list item.
- Use cached API queries and prefetch only likely next navigation paths.
- Measure Core Web Vitals and user-visible search latency before optimizing prematurely.

---

## 15. Security

- Never embed backend secrets, crawler credentials, or AI provider keys in the frontend bundle.
- Treat all API responses as untrusted display data; escape or sanitize content according to rendering context.
- Use the approved authentication flow and secure token-storage strategy.
- Do not persist sensitive search or location context without clear product and privacy requirements.
- Restrict admin routes on both the client and backend; client route guards are not authorization.

---

## 16. Testing Strategy

| Test type | Scope |
| --- | --- |
| Unit tests | Formatters, validators, pure UI logic, and API parameter builders. |
| Component tests | Components, forms, loading states, accessibility behavior, and user interactions. |
| Integration tests | Feature flows with mocked API responses and query cache behavior. |
| End-to-end tests | Core search, filter, detail, and authentication flows against a test environment. |

Tests should use accessible queries and assert visible behavior rather than implementation details. Mocked API responses must follow the published API contract.

---

## 17. Related Documents

- [01-system-architecture.md](01-system-architecture.md) — Client-layer responsibilities.
- [02-tech-stack.md](02-tech-stack.md) — React, TypeScript, Vite, Tailwind, and Leaflet choices.
- [06-backend-api-design.md](06-backend-api-design.md) — API routes, responses, errors, and authorization.
- [08-ai-recommendation-system.md](08-ai-recommendation-system.md) — AI-assisted search and recommendation behavior.
- [09-development-rules.md](09-development-rules.md) — Frontend implementation standards.

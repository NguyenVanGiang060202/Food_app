# NoN? Platform - User Flows

## 1. Purpose

This document defines the MVP user journeys for the web application. It aligns product behavior, API requirements, UI states, and acceptance criteria before frontend implementation.

---

## 2. Primary User Roles

| Role               | Main goal                                           |
| ------------------ | --------------------------------------------------- |
| Visitor            | Discover restaurants without signing in.            |
| Authenticated user | ?? d?nh restaurants and manage preferences.         |
| Administrator      | Monitor data collection and resolve quality issues. |

---

## 3. Visitor Discovery Flow

```text
Home page
  ↓ enter query or select category
Search results
  ↓ refine filters / select map marker / select card
Restaurant detail
  ↓ view location, hours, dishes, images, and categories
Optional: save restaurant → sign-in prompt when unauthenticated
```

### Acceptance criteria

- A visitor can search without an account.
- The search page has loading, empty, error, and result states.
- Filters are reflected in the URL and can be removed or reset.
- A result card and map marker lead to the same restaurant detail route.
- Missing data is represented clearly rather than fabricated.

---

## 4. Search and Filter Flow

```text
User enters a query
  ↓
Frontend validates basic input
  ↓
GET /search with URL-derived parameters
  ↓
Results + optional map
  ├── no results → suggest changing query/filter/radius
  ├── error → show retry
  └── results → paginate or load more
```

Supported MVP filters: category, location/radius, price level, minimum rating, open now, and sort order. Filters only appear as active when the API supports them.

---

## 5. Restaurant Detail Flow

```text
Open /restaurants/{restaurantId}
  ↓
GET /restaurants/{restaurantId}
  ↓
Display canonical restaurant detail
  ├── map/location
  ├── opening hours
  ├── categories and dishes
  ├── images and allowed review summaries
  └── save control
```

If the restaurant is unavailable, the page returns a clear not-found state. The client must not infer or show unverified facts.

---

## 6. Recommendation Flow

```text
User enters natural-language request + optional location
  ↓
POST /recommendations
  ↓
Ranked restaurant results
  ├── optional grounded explanation
  ├── refine request
  └── open restaurant detail
```

Recommendation results must remain useful if no explanation is available. Users can always inspect the underlying restaurant facts on the detail page.

---

## 7. Authentication and ?? d?nhd Places Flow

```text
User selects ?? d?nh
  ↓
Authenticated? ── no → sign-in route → return to original page
       │
      yes
       ↓
POST /users/me/saved-restaurants/{restaurantId}
       ↓
?? d?nhd state shown; profile lists saved restaurants
```

Removing a saved restaurant is immediately reflected in the UI after a successful API response. The flow must handle expired sessions gracefully.

---

## 8. Admin Operational Flow

```text
Admin signs in
  ↓
Admin dashboard
  ├── inspect data-source status
  ├── inspect crawl runs and failures
  ├── review unresolved records
  └── submit bounded retry or crawl request
```

Administrative actions require confirmation for meaningful state changes and create an audit record. The dashboard never exposes credentials or unrestricted raw source content.

---

## 9. R? r?d UX States

Every data-backed flow must provide a visible loading state, a meaningful empty state, a retryable error state where appropriate, and a partial-data presentation. Map-based flows always have a list-based fallback. Location permission is requested only after user action and denial does not block search.

---

## 10. Related Documents

- [07-frontend-architecture.md](07-frontend-architecture.md) — Frontend structure and accessibility.
- [11-api-contracts.md](11-api-contracts.md) — Endpoints used by each flow.
- [08-ai-recommendation-system.md](08-ai-recommendation-system.md) — Recommendation behavior and fallbacks.

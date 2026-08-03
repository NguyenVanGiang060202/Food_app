# Food Discovery Platform - Backend API Design

## 1. Purpose

This document defines the backend API boundary for the Food Discovery Platform. The backend is the only public entry point for web clients, future mobile clients, bots, and approved third-party integrations.

The API exposes canonical data produced by the ingestion pipeline. It must not crawl external providers or perform long-running data processing during a user request.

---

## 2. Design Principles

- Use REST over HTTPS with JSON request and response bodies.
- Version public routes under `/api/v1`.
- Organize code and APIs by business domain, not database tables.
- Validate all external input at the API boundary.
- Return canonical records only; never leak raw provider payloads or secrets.
- Keep read requests fast and move long-running work to queues.
- Use consistent pagination, error formats, naming, and status codes.
- Preserve backward compatibility within an API version when practical.

---

## 3. Backend Module Structure

The NestJS backend should use domain modules with clear dependencies.

```text
App Module
├── Config Module
├── Health Module
├── Auth Module
├── Users Module
├── Restaurants Module
├── Search Module
├── Recommendations Module
├── Categories Module
├── Admin Module
│   ├── Data Sources
│   ├── Crawl Runs
│   ├── Processing Records
│   └── Data Review
├── Database Module
├── Cache Module
├── Queue Module
└── AI Provider Module
```

Controllers handle HTTP concerns. Services implement business rules. Repositories or data-access services isolate database queries. Background workers are separate processes or worker modules and must not be invoked synchronously from public controllers.

---

## 4. API Conventions

### Base URL and versioning

```text
https://{domain}/api/v1
```

Breaking changes require a new versioned route. Additive response fields are allowed when they do not change existing field semantics.

### JSON conventions

- Use `camelCase` for API request and response fields.
- Use ISO 8601 UTC timestamps, for example `2026-07-23T08:30:00Z`.
- Use UUID strings for public entity identifiers.
- Use `null` for a known but unavailable scalar value; omit fields only when the field is not applicable.
- Use arrays for collections, including empty collections.
- Round display values only at the presentation boundary; preserve precision internally.

### Pagination

List endpoints use cursor pagination where ordering must remain stable at scale.

```text
GET /api/v1/restaurants?limit=20&cursor={cursor}
```

Standard response envelope:

```json
{
  "data": [],
  "meta": {
    "nextCursor": null,
    "limit": 20
  }
}
```

Offset pagination may be used only for bounded administrative views where it is operationally appropriate.

---

## 5. Public API Domains

| Domain | Responsibility |
| --- | --- |
| Health | Service health and readiness checks. |
| Restaurants | Restaurant lists and details. |
| Search | Structured and natural-language food discovery. |
| Categories | Discoverable food and venue categories. |
| Recommendations | Contextual and personalized recommendations. |
| Users | Authentication, profiles, preferences, and saved places. |
| Admin | Controlled operations for sources, crawls, pipeline state, and data review. |

---

## 6. Restaurant APIs

### List restaurants

```text
GET /api/v1/restaurants
```

Supported initial filters:

| Parameter | Type | Meaning |
| --- | --- | --- |
| `query` | string | Restaurant or dish keyword. |
| `category` | string | Category slug. |
| `city` | string | City filter. |
| `district` | string | District filter. |
| `latitude` | number | User latitude; must be supplied with longitude. |
| `longitude` | number | User longitude; must be supplied with latitude. |
| `radiusMeters` | integer | Maximum nearby radius, subject to a server maximum. |
| `minRating` | number | Minimum rating. |
| `priceLevel` | integer | Controlled price level. |
| `openNow` | boolean | Current opening-status filter when reliable hours exist. |
| `sort` | enum | `relevance`, `distance`, `rating`, or `newest`. |
| `limit` | integer | Bounded page size. |
| `cursor` | string | Opaque pagination cursor. |

The response returns a lightweight restaurant summary with canonical name, location summary, categories, rating, review count, price level, cover image, and distance when location context was provided.

### Get restaurant detail

```text
GET /api/v1/restaurants/{restaurantId}
```

The detail response can include address, coordinates, categories, opening hours, dishes, image references, and up to 20 visible review texts ordered by review date. Review timestamps are returned as ISO 8601 UTC strings. Publicly available source attribution may be added when needed. It must not expose raw source payloads, internal processing state, or hidden review content.

### Restaurant response example

```json
{
  "data": {
    "id": "0b3db7e6-8c87-4828-900a-6ad09fc53a52",
    "name": "Example Restaurant",
    "description": "A casual Vietnamese restaurant known for noodle dishes.",
    "location": {
      "formattedAddress": "District 1, Ho Chi Minh City, VN",
      "latitude": 10.7769,
      "longitude": 106.7009
    },
    "categories": [
      { "slug": "vietnamese", "name": "Vietnamese" }
    ],
    "rating": 4.5,
    "reviewCount": 128,
    "priceLevel": 2,
    "distanceMeters": 650,
    "openingHours": [],
    "images": []
  }
}
```

---

## 7. Search APIs

### Hybrid search

```text
GET /api/v1/search
```

`query` is required. Optional geographic and structured filters use the same conventions as the restaurant-list endpoint.

Search combines keyword matching, controlled filters, geospatial candidates, and semantic retrieval as defined in [08-ai-recommendation-system.md](08-ai-recommendation-system.md). The API returns final ranked results, not individual vendor or model scores.

### Natural-language discovery

```text
POST /api/v1/search/interpret
```

This optional endpoint accepts a natural-language request and returns a normalized, reviewable interpretation for client use.

```json
{
  "query": "Quiet Italian restaurant in District 1 for a date"
}
```

```json
{
  "data": {
    "query": "Quiet Italian restaurant in District 1 for a date",
    "filters": {
      "category": "italian",
      "district": "District 1",
      "attributes": ["quiet", "date-friendly"]
    }
  }
}
```

The system may use an AI provider to interpret queries, but it must validate the result, apply only supported filters, and maintain a deterministic search fallback.

---

## 8. Category APIs

```text
GET /api/v1/categories
GET /api/v1/categories/{slug}
```

Category endpoints expose active controlled categories and their hierarchy. They do not expose provider-specific category labels unless explicitly mapped to public metadata.

---

## 9. Recommendation APIs

### Contextual recommendations

```text
POST /api/v1/recommendations
```

Example request:

```json
{
  "query": "Affordable coffee shop for working",
  "location": {
    "latitude": 10.7769,
    "longitude": 106.7009
  },
  "limit": 10
}
```

The response includes ranked restaurant summaries and may include a concise explanation per result. Explanations are optional enhancement data and must never assert facts unsupported by the canonical record.

### Personalized recommendations

```text
GET /api/v1/recommendations/for-you
```

This endpoint requires authentication. It is introduced only after user preferences and interactions are implemented. It must provide a useful non-personalized fallback for users with insufficient history.

---

## 10. Authentication and User APIs

Authentication is not required for public discovery. It is required for user-owned actions and administrative operations.

Initial protected user endpoints:

```text
GET    /api/v1/users/me
PATCH  /api/v1/users/me/preferences
GET    /api/v1/users/me/saved-restaurants
POST   /api/v1/users/me/saved-restaurants/{restaurantId}
DELETE /api/v1/users/me/saved-restaurants/{restaurantId}
```

The authentication mechanism, token lifetime, password policy, and social-login decisions must be documented before implementation. Authorization must be role-based at minimum, with distinct user and administrator permissions.

---

## 11. Administrative APIs

Administrative endpoints require administrator authorization and must be audited.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/admin/data-sources` | View configured providers and status. |
| `PATCH /api/v1/admin/data-sources/{id}` | Enable, disable, or update permitted provider settings. |
| `POST /api/v1/admin/crawl-runs` | Submit a bounded manual crawl request. |
| `GET /api/v1/admin/crawl-runs` | Inspect crawl history and metrics. |
| `GET /api/v1/admin/processing-records` | Inspect pipeline status and failures. |
| `POST /api/v1/admin/processing-records/{id}/retry` | Retry an eligible bounded processing task. |
| `GET /api/v1/admin/restaurants/unresolved` | Review ambiguous matching or quality issues. |
| `PATCH /api/v1/admin/restaurants/{id}` | Curate approved canonical fields. |

Manual crawl requests must be validated, rate-limited, bounded by target, and placed on the queue. They must never execute browser automation in the API request process.

---

## 12. Validation and Error Responses

All request input is validated using DTOs at the controller boundary. Validation errors must identify invalid fields without leaking implementation details.

Standard error response:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more request fields are invalid.",
    "details": [
      {
        "field": "radiusMeters",
        "message": "Must be between 1 and 50000."
      }
    ],
    "requestId": "req_01J..."
  }
}
```

| Status | Code example | Use |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Invalid query or request body. |
| 401 | `UNAUTHENTICATED` | Authentication is required or invalid. |
| 403 | `FORBIDDEN` | Authenticated actor lacks permission. |
| 404 | `NOT_FOUND` | Public resource does not exist or is unavailable. |
| 409 | `CONFLICT` | Request conflicts with current resource state. |
| 429 | `RATE_LIMITED` | API request limit exceeded. |
| 500 | `INTERNAL_ERROR` | Unexpected server error; details remain internal. |
| 503 | `SERVICE_UNAVAILABLE` | Temporary dependency or maintenance failure. |

---

## 13. Caching and Performance

- Cache stable public metadata, category lists, and appropriate read-heavy restaurant responses.
- Do not cache personalized responses across users.
- Use short, explicit cache lifetimes and invalidate or refresh after canonical data changes where needed.
- Bound list sizes, search radius, and query complexity.
- Use database indexes and projections before introducing additional search infrastructure.
- Track latency separately for database retrieval, semantic retrieval, ranking, and optional AI explanation generation.

---

## 14. Security and Operational Requirements

- Enforce HTTPS in production.
- Configure CORS only for approved clients and origins.
- Rate-limit public endpoints and more strictly protect authentication and admin routes.
- Store secrets outside source control.
- Log request IDs, timings, route status, and safe error categories.
- Never log passwords, access tokens, raw provider payloads, or restricted user data.
- Add health and readiness endpoints for deployment monitoring.

---

## 15. API Documentation and Testing

- Publish OpenAPI documentation generated from controllers and DTOs.
- Keep documented examples aligned with automated contract tests.
- Unit-test services and validation rules.
- Integration-test authorization, pagination, filter behavior, and error responses.
- Use a dedicated test database and never depend on live provider crawling for API tests.

---

## 16. Related Documents

- [01-system-architecture.md](01-system-architecture.md) — Backend role and component boundaries.
- [03-database-design.md](03-database-design.md) — Canonical entities and data access constraints.
- [04-crawler-system.md](04-crawler-system.md) — Asynchronous crawler operations.
- [05-data-pipeline.md](05-data-pipeline.md) — Canonical data production and quality states.
- [07-frontend-architecture.md](07-frontend-architecture.md) — Web client consumption patterns.
- [08-ai-recommendation-system.md](08-ai-recommendation-system.md) — Search interpretation, ranking, and explanations.
- [09-development-rules.md](09-development-rules.md) — API implementation standards.

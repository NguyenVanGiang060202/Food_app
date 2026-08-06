# Food Discovery Platform - API Contracts

## 1. Purpose

This document defines the initial HTTP contracts consumed by the web client and future integrations. It is the implementation-level companion to [06-backend-api-design.md](06-backend-api-design.md).

Base URL: `/api/v1`  
Content type: `application/json`  
Identifiers: UUID strings  
Timestamps: ISO 8601 UTC strings

---

## 2. Shared Contracts

### Success envelopes

Single resource:

```json
{ "data": {} }
```

Cursor-paginated collection:

```json
{
  "data": [],
  "meta": { "nextCursor": null, "limit": 20 }
}
```

### Error envelope

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more request fields are invalid.",
    "details": [{ "field": "limit", "message": "Must be between 1 and 50." }],
    "requestId": "req_01J..."
  }
}
```

| HTTP status | Error code            | Meaning                               |
| ----------- | --------------------- | ------------------------------------- |
| 400         | `VALIDATION_ERROR`    | Request input is invalid.             |
| 401         | `UNAUTHENTICATED`     | Authentication is missing or invalid. |
| 403         | `FORBIDDEN`           | Actor lacks required permission.      |
| 404         | `NOT_FOUND`           | Resource is unavailable.              |
| 409         | `CONFLICT`            | Request conflicts with current state. |
| 429         | `RATE_LIMITED`        | Request quota was exceeded.           |
| 500         | `INTERNAL_ERROR`      | Unexpected server failure.            |
| 503         | `SERVICE_UNAVAILABLE` | Temporary dependency failure.         |

All collection `limit` values must be between `1` and `50`. Unknown query parameters are rejected or ignored according to the endpoint DTO; this behavior must remain consistent.

---

## 3. Public Resource Types

### Restaurant summary

```json
{
  "id": "0b3db7e6-8c87-4828-900a-6ad09fc53a52",
  "name": "Example Restaurant",
  "location": {
    "formattedAddress": "District 1, Ho Chi Minh City, VN",
    "latitude": 10.7769,
    "longitude": 106.7009
  },
  "categories": [{ "slug": "vietnamese", "name": "Vietnamese" }],
  "rating": 4.5,
  "reviewCount": 128,
  "priceLevel": 2,
  "coverImageUrl": "https://images.example/cover.jpg",
  "distanceMeters": 650
}
```

`distanceMeters` is `null` or omitted when no location context was supplied. `rating`, `reviewCount`, `priceLevel`, and `coverImageUrl` may be `null` when unavailable.

### Restaurant detail

Restaurant detail extends the summary with `description`, `openingHours`, `dishes`, `images`, and public source attribution. Restricted source payloads and internal processing fields are never exposed.

---

## 4. Health

```text
GET /health
```

Response `200`:

```json
{ "data": { "status": "ok" } }
```

```text
GET /health/ready
```

Returns `200` only when required runtime dependencies are ready. It must not reveal secrets or detailed infrastructure configuration.

---

## 5. Restaurant Endpoints

### List restaurants

```text
GET /restaurants
```

| Query parameter         | Type       | Rules                                               |
| ----------------------- | ---------- | --------------------------------------------------- |
| `query`                 | string     | Maximum 200 characters.                             |
| `category`              | string     | Public category slug.                               |
| `city`, `district`      | string     | Maximum 100 characters each.                        |
| `latitude`, `longitude` | number     | Must be supplied together; valid geographic ranges. |
| `radiusMeters`          | integer    | `1`–`50000`; requires coordinates.                  |
| `minRating`             | number     | `0`–`5`.                                            |
| `priceLevel`            | integer    | Initial range `1`–`4`.                              |
| `openNow`               | boolean    | Applied only when reliable hours exist.             |
| `sort`                  | enum       | `relevance`, `distance`, `rating`, `newest`.        |
| `limit`, `cursor`       | pagination | Shared pagination rules.                            |

Response `200`: paginated `RestaurantSummary` values.

### Get restaurant detail

```text
GET /restaurants/{restaurantId}
```

`restaurantId` must be a UUID. Returns `404` for nonexistent, inactive, or non-public restaurants.

---

## 6. Search and Recommendation Endpoints

### Hybrid search

```text
GET /search?query={query}
```

`query` is required and must be 1–200 characters. The endpoint accepts the same public filtering and location parameters as `GET /restaurants`, and returns the same paginated summary contract. Ranking implementation details and raw model scores are internal.

### Query interpretation

```text
POST /search/interpret
```

Request:

```json
{ "query": "Quiet Italian restaurant in District 1 for a date" }
```

Response:

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

Only supported, validated filters are returned. The endpoint must work with deterministic parsing if AI interpretation is unavailable.

### Contextual recommendations

```text
POST /recommendations
```

Request:

```json
{
  "query": "Affordable coffee shop for working",
  "location": { "latitude": 10.7769, "longitude": 106.7009 },
  "filters": { "priceLevel": 2, "openNow": true },
  "limit": 10
}
```

Response:

```json
{
  "data": [
    {
      "restaurant": { "id": "0b3db7e6-8c87-4828-900a-6ad09fc53a52", "name": "Example Restaurant" },
      "explanation": "Matches your coffee and budget preferences near your location."
    }
  ]
}
```

`explanation` is nullable. It must be grounded in canonical facts and omission is preferred to unsupported generated text.

---

## 7. Category Endpoints

```text
GET /categories
GET /categories/{slug}
```

Category response:

```json
{ "data": { "slug": "vietnamese", "name": "Vietnamese", "parentSlug": null } }
```

Only active public categories are returned.

---

## 8. User Endpoints

The following routes require a valid authenticated user session:

```text
GET    /users/me
PATCH  /users/me/preferences
GET    /users/me/saved-restaurants
POST   /users/me/saved-restaurants/{restaurantId}
DELETE /users/me/saved-restaurants/{restaurantId}
```

`PATCH /users/me/preferences` accepts only defined fields, for example:

```json
{
  "favoriteCategorySlugs": ["vietnamese", "coffee-shop"],
  "dietaryPreferences": ["vegetarian"],
  "preferredPriceLevels": [1, 2]
}
```

The authentication protocol is finalized in `14-security.md` before implementation. Saved-restaurant creation is idempotent: saving an already saved restaurant returns success without creating a duplicate.

---

## 9. Administration Endpoints

All `/admin` routes require the administrator role and write operations must create audit-log entries.

| Method | Route                                  | Contract                                                         |
| ------ | -------------------------------------- | ---------------------------------------------------------------- |
| GET    | `/admin/data-sources`                  | Paginated provider status list.                                  |
| PATCH  | `/admin/data-sources/{id}`             | Allowed fields: enabled state and approved operational settings. |
| POST   | `/admin/crawl-runs`                    | Queues a bounded crawl request; returns `202 Accepted`.          |
| GET    | `/admin/crawl-runs`                    | Paginated operational history.                                   |
| GET    | `/admin/processing-records`            | Paginated failures and processing status.                        |
| POST   | `/admin/processing-records/{id}/retry` | Queues an eligible retry; returns `202 Accepted`.                |
| GET    | `/admin/restaurants/unresolved`        | Candidate records requiring data review.                         |
| PATCH  | `/admin/restaurants/{id}`              | Curates allowed canonical fields with audit trail.               |

Manual crawl request:

```json
{
  "providerCode": "example_provider",
  "jobType": "discovery",
  "target": { "city": "Ho Chi Minh City", "district": "District 1" }
}
```

The server validates target bounds, queue capacity, provider state, and authorization before returning `202`.

---

## 10. Contract Governance

- OpenAPI is the generated executable API reference.
- This document defines intended stable behavior and human-readable examples.
- A breaking request or response change requires a new API version or a documented migration plan.
- Contract tests must cover status codes, envelopes, validation, pagination, and authorization.
- Frontend types should be generated from OpenAPI once the specification is stable.

---

## 11. Related Documents

- [06-backend-api-design.md](06-backend-api-design.md) — API architecture and domain responsibilities.
- [07-frontend-architecture.md](07-frontend-architecture.md) — Client integration patterns.
- [14-security.md](14-security.md) — Authentication, authorization, and rate limiting.
- [15-testing-strategy.md](15-testing-strategy.md) — Contract and integration testing.

# Backend API

The backend exposes the public catalog API under `/api/v1`.

## Implemented public endpoints

- `GET /api/v1/health`
- `GET /api/v1/health/ready`
- `GET /api/v1/restaurants`
- `GET /api/v1/restaurants/:restaurantId`
- `GET /api/v1/search?query=...`
- `POST /api/v1/search/interpret`
- `POST /api/v1/recommendations`
- `GET /api/v1/categories`
- `GET /api/v1/categories/:slug`

## Implemented protected operations endpoints

These endpoints accept an authenticated session for a database user whose role
is `admin`. During operational migration they also accept the
`x-admin-api-key` header and the `ADMIN_API_KEY` environment variable when no
session credentials are supplied:

- `GET /api/v1/admin/data-sources`
- `POST /api/v1/admin/crawl-runs`
- `GET /api/v1/admin/crawl-runs`
- `GET /api/v1/admin/processing-records`
- `POST /api/v1/admin/processing-records/:id/retry`
- `GET /api/v1/admin/restaurants/unresolved`

To promote an already verified account, run the database operator script from a
trusted host. The script refuses accounts without `email_verified_at` and does
not expose a public self-service escalation endpoint:

```powershell
.\database\scripts\promote-admin.ps1 -Email admin@example.com
```

Authenticated admin sessions are preferred for admin requests. Keep the API-key
fallback only until all operational callers have migrated.

To enqueue a real bounded Playwright discovery run:

```powershell
$headers = @{ 'x-admin-api-key' = $env:ADMIN_API_KEY }
$body = @{ providerCode = 'google_maps_playwright'; jobType = 'discovery'; target = @{ query = 'noodle soup'; location = 'District 1, Ho Chi Minh City'; limit = 5 } } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/v1/admin/crawl-runs -Headers $headers -ContentType 'application/json' -Body $body
```

The request only queues work. Run the Playwright worker separately after reviewing
source terms, rate limits, and the bounded target:

```powershell
npm run worker:once --workspace crawler
```

Restaurant listing supports query, category, city, district, coordinates/radius,
minimum rating, price level, open-now, sort, limit, cursor, and trigram relevance ordering.

## Run locally

1. Start PostgreSQL and Redis with `docker compose up -d postgres redis`.
2. The database image automatically enables PostGIS, pgvector, pg_trgm, and pgcrypto,
   then applies the initial schema, reference data, and role migration. It does not
   create canonical restaurants; those must come from an approved real crawler or
   import job. Use `npm run db:migrate` for an existing volume so all numbered
   migrations are applied.
3. Start the API with `npm run start:dev --workspace backend`.

For admin endpoints, set:

```dotenv
ADMIN_API_KEY=replace-with-a-local-secret
```

To enable real verification and password-reset email delivery, configure SMTP. When
these variables are absent, local development keeps the existing development-link
behavior only when `AUTH_EXPOSE_VERIFICATION_LINK=true` or
`AUTH_EXPOSE_RESET_LINK=true` is explicitly enabled.

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=mailer@example.com
SMTP_PASSWORD=replace-with-an-app-password
SMTP_FROM=Food Discovery <mailer@example.com>
```

With SMTP configured, verification and reset links are sent by email and are not
included in API responses.

For any environment exposed beyond localhost, set a unique `AUTH_SECRET` and keep
both development link flags disabled:

```dotenv
AUTH_SECRET=replace-with-a-long-random-secret
AUTH_EXPOSE_VERIFICATION_LINK=false
AUTH_EXPOSE_RESET_LINK=false
```

The API uses `DATABASE_URL` when set, otherwise the `PG*` variables documented in the
root `.env.example`. Restaurant endpoints return `503 SERVICE_UNAVAILABLE` until the
canonical schema and required extensions are available.

Record retry is implemented through the real crawl queue: the endpoint accepts only failed
or skipped records from discovery runs under the retry limit, creates a new queued
`crawl_run` using the original target, and returns `retryRunId`. The original processing
record remains available for audit. Run the worker after queueing:

```bash
npm run worker:once --workspace crawler
```

Run backend unit tests without requiring PostgreSQL:

```bash
npm test --workspace backend
```

## Run the full backend stack

```bash
docker compose up -d --build postgres backend redis
```

The Compose backend receives `ADMIN_API_KEY` from the root `.env` file (or uses the
development fallback shown in `docker-compose.yml`). Change it before exposing the API
outside a local machine. Creating a crawl run only queues work; execute the crawler
worker separately with `npm run worker:once --workspace crawler`.

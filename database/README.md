# Database

PostgreSQL is the canonical source of truth for the application. The local image enables
PostGIS, pgvector, pg_trgm, and pgcrypto before applying the initial schema and seed data.

## Local setup

```bash
docker compose up -d --build postgres
```

Initialization files run only for a new PostgreSQL volume. For an existing volume, apply
pending version-controlled migrations without deleting data:

```powershell
npm run db:migrate
```

The runner creates `schema_migration`, bootstraps the initial schema only when needed, and
applies later migrations in filename order. It is safe to run repeatedly.

To recreate the local database after changing the initial schema:

```bash
docker compose down -v
docker compose up -d --build postgres
```

The seed contains only reference data (`data_source` and categories). It intentionally
does not create restaurants, dishes, images, or hours. Canonical catalog data must be
written by an approved crawler or an explicit import job.

For local pipeline testing only, the crawler's idempotent fixture import can be run
separately with:

```bash
npm run crawl:fixture --workspace crawler
```

The fixture command is a test harness, not an application startup step and should not
be used as a substitute for a production provider adapter.

Schema ownership remains in `database/migrations`; the backend accesses it through SQL
repositories and does not maintain a competing ORM schema.

The Playwright-only source policy is kept in
`database/migrations/003_playwright_only_source.sql`; the migration runner applies it
after the provider registration migration.

The deterministic fixture provider is not part of database initialization. It remains
available only to the explicit `crawl:fixture` test harness and is not registered by the
production worker. Migration `005_disable_fixture_source.sql` is retained for upgrading
older databases that still contain the historical fixture source row.

Migration `006_remove_inactive_sources.sql` removes the inactive `fixture` and legacy
`google_maps` source rows plus their source-specific crawl/provenance records. It keeps
canonical restaurants, dishes, locations, categories, and all Playwright-backed data.

Migration `004_crawl_run_lease.sql` adds worker leases. A crashed worker's expired run can
be claimed again, while an active worker renews its lease during long Playwright sessions.

## Local email verification flow

Migration `010_auth_email_verification.sql` adds email verification fields to `app_user`.
Existing users are marked as verified; new password registrations remain unverified until
their link is opened.

For local development without an SMTP provider, expose the one-time verification token in
the signup response (never enable this in production):

```powershell
$env:AUTH_SECRET = 'replace-with-a-long-local-secret'
$env:AUTH_EXPOSE_VERIFICATION_LINK = 'true'
npm run start:dev --workspace backend
```

Create an account in the frontend, copy `verificationToken` from the signup response, then
open `http://localhost:5173/verify-email?token=<token>`. After the page reports success,
sign in normally. In a deployed environment, replace this development hint with a mail
delivery provider and keep `AUTH_EXPOSE_VERIFICATION_LINK` disabled.

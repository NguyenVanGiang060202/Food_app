# Food Discovery Platform - Environment Setup

## 1. Purpose

This document defines the expected local development setup. It is intentionally tool-agnostic where implementation has not started; exact commands are added to the root `README.md` when the project scaffolding exists.

---

## 2. Required Tools

| Tool                                     | Purpose                                                 |
| ---------------------------------------- | ------------------------------------------------------- |
| Git                                      | Source control.                                         |
| Docker Desktop / Docker Engine + Compose | Run PostgreSQL, Redis, and local services consistently. |
| Node.js LTS                              | Run React, NestJS, crawler, and tooling.                |
| Package manager                          | Use one project-standard choice: npm, pnpm, or yarn.    |
| Optional database client                 | Inspect local PostgreSQL during development.            |

Pin Node and package-manager versions in repository configuration once selected.

---

## 3. Local Services

Docker Compose provides these initial services:

| Service         | Default local role                                                                       |
| --------------- | ---------------------------------------------------------------------------------------- |
| PostgreSQL      | Canonical database with PostGIS and pgvector enabled.                                    |
| Redis           | Available local Redis service; crawler currently uses PostgreSQL for crawl-run claiming. |
| Backend         | REST API.                                                                                |
| Crawler worker  | One-shot bounded provider collection job (`worker:once`).                                |
| Pipeline worker | Not currently implemented as a separate service.                                         |
| Frontend        | Vite development server or production-like local container.                              |

Expose only developer-needed ports to the host. Do not expose databases to non-local interfaces by default.

---

## 4. Configuration Files

Each application has a committed `.env.example`. Local secrets live in ignored `.env` files.

Initial root variables:

```dotenv
POSTGRES_DB=food_app
POSTGRES_USER=food_app
POSTGRES_PASSWORD=change-me-locally
DATABASE_URL=postgresql://food_app:change-me-locally@postgres:5432/food_app
REDIS_URL=redis://redis:6379 # architectural/future configuration; not read by current crawler
```

Backend variables:

```dotenv
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://food_app:change-me-locally@localhost:5432/food_app
REDIS_URL=redis://localhost:6379
APP_ORIGIN=http://localhost:5173
AUTH_API_ORIGIN=http://localhost:3000
AUTH_SECRET=replace-with-a-long-random-secret
AUTH_EXPOSE_VERIFICATION_LINK=false
AUTH_EXPOSE_RESET_LINK=false

# SMTP email delivery for account verification and password reset.
# Use either SMTP_URL or SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD.
SMTP_URL=
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=mailer@example.com
SMTP_PASSWORD=replace-with-an-app-password
SMTP_FROM="Food Discovery <mailer@example.com>"
```

Email verification and password reset links are generated from `APP_ORIGIN` and open
the frontend auth page as `/auth?verifyToken=...` or `/auth?resetToken=...`. In local
development without SMTP, enable `AUTH_EXPOSE_VERIFICATION_LINK=true` or
`AUTH_EXPOSE_RESET_LINK=true` only temporarily to expose development-only tokens in API
responses. Never enable those flags in production.

Frontend variables expose only safe public configuration:

```dotenv
VITE_API_BASE_URL=http://localhost:3000/api/v1
VITE_MAP_TILE_URL=https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png
```

Crawler variables currently include the PostgreSQL connection variables above and the
bounded Playwright variables documented in `crawler/README.md`. No Google API key is
required. Fixture target variables (`CRAWL_CITY`, `CRAWL_DISTRICT`, `CRAWL_CATEGORY`,
`CRAWL_LIMIT`) are read only by the fixture CLI. They must never use the `VITE_` prefix.

---

## 5. Initial Setup Workflow

```text
Clone repository
  ↓
Copy each .env.example to ignored .env files
  ↓
Install project dependencies
  ↓
Start Docker Compose dependencies
  ↓
Run database migrations and optional seed data
  ↓
Start backend, frontend, and workers
  ↓
Verify health endpoint and frontend access
```

The root README and `crawler/README.md` provide the currently verified npm commands.

---

## 6. Database Setup

Local PostgreSQL initialization must enable `postgis`, `vector`, `pg_trgm`, and the selected UUID extension through migrations or controlled initialization scripts.

Developers must use migrations to change the schema. Direct local database changes are acceptable only for investigation and must be converted into migrations before sharing.

Seed data should be synthetic or explicitly approved. It should provide enough restaurants, categories, locations, and source records to develop list, detail, filter, map, and pipeline behavior without live crawling.

---

## 7. Local Verification

After setup, verify:

- Database and Redis containers are healthy.
- Database migrations completed successfully.
- `GET /health` returns `200` from the backend.
- The frontend loads and can call the API.
- Test suite, linting, type checks, and build commands run locally.
- A safe fixture-based crawler/pipeline job can complete without external-provider access.

---

## 8. Troubleshooting Rules

- Do not delete Docker volumes or databases containing meaningful local data without confirming the target and impact.
- Check service logs and health checks before changing configuration.
- Use `docker compose down` carefully; add volume removal only when explicitly required.
- Never paste real credentials into issue trackers, commits, or shared logs.
- Document recurring setup problems in the root README or this file.

---

## 9. Related Documents

- [13-folder-structure.md](13-folder-structure.md) — Expected application directories.
- [03-database-design.md](03-database-design.md) — Required extensions and schema rules.
- [16-deployment.md](16-deployment.md) — Environment topology and operational deployment.
- [14-security.md](14-security.md) — Local secret-handling requirements.

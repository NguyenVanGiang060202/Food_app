# NoN? ? AI Food Recommendation Platform

> Intelligent food and restaurant recommendation platform powered by AI, Vector Search, and Multi-Source Data Collection.

---

# Vision

The goal of this project is to build an AI-native food recommendation platform instead of a traditional restaurant search application.

Rather than querying Google Maps or third-party APIs in real time, the system continuously collects public restaurant information from multiple data sources, normalizes the data, enriches it using AI, stores it locally, and serves recommendations through semantic search and large language models.

The platform is designed as a long-term extensible system that can support additional data providers, multiple client applications, and various AI models without major architectural changes.

---

# Core Principles

The system must always follow these principles:

- Database First
- AI Native
- Multi Source
- API First
- Production Ready
- Modular
- Extensible
- Open Source Friendly
- Cost Efficient
- Free Tier Friendly

---

# Goals

Primary goals:

- Discover nearby restaurants
- Recommend foods based on user preferences
- Recommend drinks
- Understand natural language
- Perform semantic search
- Explain recommendations
- Support future conversational AI

Secondary goals:

- Telegram Bot
- Mobile App
- Discord Bot
- Public REST API
- Admin Dashboard

---

# Non Goals

The project is NOT intended to become:

- Food delivery platform
- Payment gateway
- POS system
- Restaurant management software

---

# High Level Architecture

```text
Approved production provider
    ↓
Crawl run in PostgreSQL
    ↓
One-shot crawler worker
    ↓
DiscoveryCrawlExecutor
    ↓
Validation → normalization → canonical upsert
    ↓
PostgreSQL (canonical catalog + provenance + crawl operations)
    ↓
Backend REST API (/api/v1)
    ↓
React web client
```

The repository contains a working ingestion foundation, not the complete future
queue/AI platform described by the long-term design documents. PostgreSQL is the
current source of truth; Redis is available in Compose but is not currently used by
the crawler worker.

---

# Data Sources

The architecture must support multiple independent data providers.

Current provider adapters:

- `google_maps_playwright`: the only production provider; bounded public Google Maps
  result-page adapter available through the direct, batch, and one-shot worker paths.
- A deterministic fixture adapter remains available only in crawler tests; it is not a
  database source and is not registered in the production worker.

Future providers:

- TikTok
- Facebook
- YouTube
- Foody
- Instagram
- Community Contributions

Every provider must implement the same interface. No provider-specific logic should leak into the Recommendation Engine.

---

# Data Quality Policy

The platform only displays data that a crawler can observe directly from the source.
Anything that cannot be read reliably is treated as unknown and is not shown as fact.

This decision applies to the whole pipeline:

- Crawl only what is visible on the source page (name, address, coordinates, rating,
  review count when present, phone/website/image/opening hours when present).
- Do not fabricate a field because a value is missing. `NULL` means “not observed”,
  not “zero” or “unknown value provided by user”.
- Do not convert collected review text into a total `review_count`. The count shown on
  Google Maps is the aggregate; the number of review texts crawled is
  `reviews_collected_count` and is separate.
- Do not infer price, opening hours, phone, or images from photos or review text. Those
  fields may be estimated later by a separate enrichment step, never by the crawler.
- Categories come from the source when available. Automated classification is a
  separate enrichment concern.

Consumers (backend API, frontend, recommendation engine) must follow the same rule:

- Hide a field entirely when it is `NULL`/unknown instead of showing a placeholder
  value or a fake image.
- Provide a direct link to the source (Google Maps) so users can check the original
  information themselves.

The crawler persists the Google Maps URL in `restaurant_source.source_url`, and each
`raw_data` payload records which fields were actually extracted
(`raw_data->'extracted'`). Use these to audit coverage.

---

## Field-specific guidance

### Review count

- The total `review_count` must only ever be the aggregate count shown on the source.
- Do not derive it by counting the review texts that were crawled. Store that number
  separately (e.g. `reviews_collected_count`) if it is useful.
- If the source does not show an aggregate count, keep `review_count` as `NULL`. Never
  write `0` to mean “not observed”.

### Phone and website

- Optional. Only store the value when the source exposes it directly.
- Missing phone or website is not a crawl failure and should not be retried forever.
- Frontend should hide the contact block when both are `NULL`, not show empty pills.

### Images

- Only store image URLs observed on the source. Prefer the source CDN URL as crawled.
- Distinguish whether an image is business-provided, user-uploaded, or unverified; do
  not label it as an official restaurant photo without evidence.
- If no cover image exists, do not fall back to a static placeholder that implies the
  restaurant supplied it. Either show no image or a neutral placeholder clearly marked
  as “no photo yet”.
- Store the `alt_text` when available and limit the number of images stored per place.

### Price and price level

- The crawler must not write price or price level unless the source exposes it directly.
- Menu photo OCR and review-text mentions are enrichment inputs, not facts. Any future
  OCR/enrichment pipeline must store confidence and provenance separately and must not
  overwrite observed data.
- Frontend should render price as “not available” instead of guessing a price level.

### Opening hours

- Only store hours exposed directly by the source.
- Do not infer opening hours from review text or photos. A review that says “I came at
  9 PM” does not prove the restaurant opens until 21:00.
- If hours are absent, the frontend must show “Giờ mở cửa chưa rõ” and must not render a
  guessed open/closed state.

### Categories

- Prefer the category exposed by the source; map it to the canonical taxonomy.
- Automated classification is a separate enrichment concern and must record confidence.
  It should not silently replace the source category.

### Open in source

- Every restaurant detail should expose a link back to `restaurant_source.source_url`
  (Google Maps) so users can verify the original listing.

---

# Recommendation Strategy

Recommendations should NOT depend on distance only.

Ranking should combine:

- Geo Distance
- Food Category
- Food Ontology
- User Preferences
- Restaurant Rating
- Review Quality
- AI Metadata
- Semantic Similarity

---

# AI Usage

Large Language Models are NOT used as the search engine.

Instead:

```text
User Query
    ?
Hybrid Search
    ?
Top Candidates
    ?
LLM Explanation
```

This reduces latency and token usage.

---

# Supported Clients

Current:

- React Web

Future:

- Telegram
- Mobile
- Desktop
- Public API

All clients consume the same backend.

---

# Deployment

Development: Docker Compose

Production: Docker, reverse proxy, HTTPS. Domain optional. No cloud vendor lock-in.

---

# Technology Stack

Frontend:

- React
- TypeScript
- Vite
- Tailwind
- Leaflet

Backend:

- NestJS

Database:

- PostgreSQL

Vector:

- pgvector

ORM:

- Prisma (planned; current schema access uses SQL repositories)

Queue:

- BullMQ (planned)

Cache:

- Redis

Crawler:

- Bounded Google Maps Playwright adapter for public result pages.

AI:

- Gemini Flash
- Gemini Embedding

Deployment:

- Docker
- GitHub Actions

---

## Current implementation boundaries

The repository now includes a bounded Google Maps Playwright adapter for public result
pages. It is an optional real-source ingestion tool, not a general-purpose scraper: it
does not log in, bypass consent or CAPTCHA, evade access controls, or retain browser
sessions/cookies. Use it only after reviewing the source terms, applicable law, request
limits, and data-retention policy for the deployment.

The deterministic fixture provider remains a test harness only. It is not registered by
the production worker and is never loaded during database initialization.

The current implementation is a portfolio-ready MVP foundation rather than the
complete long-term platform. Authentication, saved places, personalized
recommendations, bounded data collection, and the public web experience are
implemented. Full data curation, enterprise observability, and continuously
supervised queue infrastructure remain future phases.

---

# Current implementation

The backend and database are the current implementation priority. The public API is exposed under `/api/v1`.

Prerequisites: Node.js `>=22 <23`, npm, and Docker Desktop/Engine with Compose.

Install dependencies from the repository root:

```powershell
npm install
```

Start the local database and API dependencies:

```powershell
docker compose up -d --build postgres redis
npm run start:dev --workspace backend
```

## Windows PowerShell commands

The project is developed from Windows PowerShell. Use the PowerShell-compatible
commands below rather than Bash examples. These rules are important:

- Run commands with ASCII-only text. Do not put Vietnamese search queries or
  Vietnamese request bodies directly in a PowerShell command; terminal encoding
  can cause the command to hang.
- Windows PowerShell 5.1 does not support `&&`. Run sequential commands on
  separate lines, or join them with `;` when stopping after a failure is not
  required.
- Use `curl.exe`, not the PowerShell `curl` alias, when you need curl flags such
  as `-H`, `-w`, or `-D`.
- Use `Start-Process` for a background service. Do not use Bash operators such
  as `&`, `> /dev/null`, or `\` line continuations.

Install and start the local services in separate PowerShell commands:

```powershell
npm install
docker compose up -d --build postgres redis
npm run start:dev --workspace backend
```

Start the frontend in a second PowerShell terminal:

```powershell
npm run dev --workspace frontend
```

Start the backend in the background when a terminal must remain available:

```powershell
Start-Process -FilePath "cmd.exe" -ArgumentList "/c","npm run start --workspace backend > backend-runtime.log 2>&1" -WindowStyle Hidden
```

Check the services without putting non-ASCII text in the query:

```powershell
curl.exe -s -o NUL -w "%{http_code}" "http://localhost:3000/api/v1/health"
curl.exe -s -o NUL -w "%{http_code}" "http://localhost:3000/api/v1/restaurants?limit=3"
curl.exe -s -o NUL -w "%{http_code}" "http://localhost:5174/"
```

For an API request with Vietnamese or other non-ASCII data, save the payload
as a UTF-8 JSON file and pass the file to the application or test harness. Do
not type that data inline in PowerShell.

Do not use `--data-raw "{\"query\":\"...\"}"` from PowerShell to send JSON with
escaped quotes. Windows PowerShell 5.1 strips the escaped double quotes, so the
server receives malformed JSON and returns `400 VALIDATION_ERROR`
(`Expected property name or '}' in JSON`). Write the body to a UTF-8 (no BOM)
file and send it with `-d @file`:

```powershell
# body.json (UTF-8, no BOM)
{"query":"phở","limit":6,"filters":{"taste":[],"openNow":false}}
curl.exe -sS -i -X POST http://localhost:3000/api/v1/recommendations -H "Content-Type: application/json" -d "@body.json"
```

Create a UTF-8 no-BOM body file from PowerShell:

```powershell
[System.IO.File]::WriteAllText("body.json", $json, (New-Object System.Text.UTF8Encoding($false)))
```

PowerShell process and port commands:

```powershell
netstat -ano | findstr :3000
taskkill /PID <PID> /F
Start-Sleep -Seconds 2
```

The equivalent project checks are also run one at a time:

```powershell
npm run check
npm run build --workspace frontend
npm test --workspace crawler
npm run build --workspace crawler
```

Run the local fixture ingestion harness after PostgreSQL is healthy:

```powershell
npm run crawl:fixture --workspace crawler
```

The fixture command writes deterministic sample records to PostgreSQL. It is a test
harness, not fake data loaded during database initialization and not a replacement for
an approved production provider.

To create a real queued crawl, use the protected admin endpoint with
`x-admin-api-key: $ADMIN_API_KEY`:

```powershell
curl.exe -X POST "http://localhost:3000/api/v1/admin/crawl-runs" -H "content-type: application/json" -H "x-admin-api-key: replace-with-a-local-secret" --data-binary "@recommendation-body.json"
npm run worker:once --workspace crawler
```

The Playwright provider requires a locally installed Playwright browser and bounded crawl
configuration. The worker claims one queued run with PostgreSQL `FOR UPDATE SKIP LOCKED`, processes it once, and exits; there is no
long-running polling loop or BullMQ integration in the current implementation.

Inspect status with:

```powershell
curl.exe "http://localhost:3000/api/v1/admin/crawl-runs?limit=20" -H "x-admin-api-key: replace-with-a-local-secret"
```

See:

- `backend/README.md`
- `crawler/README.md`
- `database/README.md`
- `docs/`

Important implementation boundaries:

- `crawler/src/providers/provider.interface.ts` — provider contract.
- `crawler/src/jobs/discovery-crawl.executor.ts` — discovery lifecycle.
- `crawler/src/validation/source-record.validation.ts` — record checks.
- `crawler/src/pipeline/normalizer.ts` — deterministic normalization.
- `crawler/src/pipeline/canonical-upsert.pipeline.ts` — PostgreSQL persistence and
  idempotent source/canonical upsert.
- `crawler/src/queue/crawl-run.repository.ts` — queued-run claim persistence.
- `crawler/src/jobs/crawl-run.worker.ts` — queued-run claim and one-shot execution.
- `database/migrations/001_initial_schema.sql` — canonical schema and crawl tables.

---

# Documentation

This repository intentionally separates architecture into multiple documents. The
numbered documents contain target architecture as well as implementation notes; when
they differ, the source code and the “current implementation” sections are authoritative.

- `docs/04-crawler-system.md` — current crawler contract and lifecycle.
- `docs/05-data-pipeline.md` — current implemented pipeline versus future stages.
- `docs/03-database-design.md` — database model and provenance.
- `docs/17-environment-setup.md` — verified local setup.

Each document is considered the single source of truth for its respective domain.

## Windows PowerShell note

See [docs/09-development-rules.md](docs/09-development-rules.md#16-windows-powershell-command-safety)
before running CLI commands. In particular, keep PowerShell commands ASCII-only, avoid
embedding Vietnamese query text because it can hang the terminal, and use `;` instead of
`&&` when chaining commands.

---

# Repository Philosophy

This repository is designed primarily for AI-assisted software development.

Every architectural decision should be documented before implementation.

Implementation must always follow documentation.

Documentation is the source of truth.

Code is the implementation.

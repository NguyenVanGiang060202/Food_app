# Food Discovery Platform - Crawler System

## 1. Purpose

This document defines the crawler system used to collect restaurant and food information from approved external sources. The crawler system is responsible for acquiring source data reliably and traceably; it is not responsible for canonical data modeling, search ranking, or user-facing API responses.

All collection must comply with applicable laws, the relevant source's terms, robots policies where applicable, rate limits, and the project's internal data-retention rules.

---

## 2. Goals

- Support multiple independent data providers through a shared crawler contract.
- Run collection asynchronously, reliably, and at controlled rates.
- Preserve sufficient source metadata for auditing and troubleshooting.
- Produce structured records for the data-processing pipeline.
- Allow providers to be added, paused, or removed without affecting the core application.
- Avoid unnecessary requests, duplicate collection, and provider-specific coupling.

---

## 3. Non-Goals

The crawler system does not:

- Serve synchronous user search requests.
- Define canonical restaurant records or final deduplication outcomes.
- Circumvent access controls, paywalls, CAPTCHAs, or technical restrictions.
- Bypass source terms, rate limits, robots policies, or legal requirements.
- Collect credentials, private user data, or content that the project is not allowed to retain.

---

## 4. Architecture

The currently implemented flow is:

```text
POST /api/v1/admin/crawl-runs
                ↓
         crawl_run(status=queued)
                ↓
  CrawlRunRepository.claimNext()
    (FOR UPDATE SKIP LOCKED)
                ↓
          CrawlRunWorker.runOnce()
                ↓
       DiscoveryCrawlExecutor
                ↓
 provider.discover(DiscoveryInput)
                ↓
 validate → normalize → CanonicalUpsertPipeline.process
                ↓
       finishCrawlRun / mark failed
```

The worker is a separate Node process, but the current entrypoint is one-shot. It
polls PostgreSQL once and exits; Redis/BullMQ scheduling, delayed jobs, and a
long-running polling supervisor are not implemented in the crawler runtime.

---

## 5. Provider Adapter Contract

Every external source is implemented as an adapter behind the same internal interface. The exact TypeScript types may evolve, but the behavioral contract must remain stable.

```ts
interface DataProviderAdapter {
  readonly providerCode: string;

  validateConfiguration(): Promise<void>;
  discover(input: DiscoveryInput): AsyncIterable<SourceRestaurantRecord>;
  fetchDetails?(input: SourceRecordReference): Promise<SourceRestaurantRecord>;
}
```

| Contract element         | Requirement                                                                       |
| ------------------------ | --------------------------------------------------------------------------------- |
| `providerCode`           | Must match one active `data_source.code` value.                                   |
| Configuration validation | Must fail early and safely if required configuration is absent.                   |
| Discovery                | Produces source records for a query, geographic area, or configured target.       |
| Detail refresh           | Optional; used only when a provider supports an approved detail endpoint or page. |
| Output                   | Must follow the normalized source-record schema below.                            |
| Errors                   | Must use typed, non-secret error details so retry policy can classify them.       |

Provider-specific selectors, request formats, authentication details, and parsing code must remain inside the adapter implementation.

---

## 6. Source Record Schema

The crawler produces a provider-neutral source record. Fields can be absent when the source does not expose them.

```text
SourceRestaurantRecord
├── providerCode
├── externalId
├── sourceUrl
├── collectedAt
├── name
├── address
├── coordinates (latitude, longitude)
├── phone
├── websiteUrl
├── openingHours[]
├── categories[]
├── priceLevel
├── rating
├── reviewCount
├── images[]
├── reviews[]
├── dishes[]
├── sourceMetadata
└── rawPayloadReference (optional)
```

`sourceMetadata` contains provider-specific values that are useful for audit or future parsing but do not belong in canonical domain fields. Sensitive data and unsupported raw content must not be written to the record.

---

## 7. Crawl Job Types

| Job type             | Trigger                   | Purpose                                                    |
| -------------------- | ------------------------- | ---------------------------------------------------------- |
| Discovery crawl      | Scheduled or manual       | Find restaurants in a target area or category.             |
| Detail refresh       | Scheduled                 | Refresh known restaurant details.                          |
| Review refresh       | Scheduled                 | Refresh allowed review metadata or content.                |
| Image refresh        | Scheduled or event-driven | Refresh permitted image references.                        |
| Reconciliation crawl | Scheduled                 | Check whether known source records still exist or changed. |
| Backfill crawl       | Manual, controlled        | Populate historical records for a bounded target.          |

The implemented executor accepts only `discovery`. The admin API can persist a
bounded target containing `city`, `district`, `category`, and `limit`; unsupported
target keys are rejected and `limit` is restricted to 1–50 by the API. Other job
types in the schema/design are future work and currently fail fast in the executor.

---

## 8. Scheduling and Freshness

Scheduling beyond manual API creation plus a one-shot worker is not currently
implemented. `crawl_run.started_at`, `finished_at`, `last_seen_at`, and the source
status fields provide the database foundation for later scheduling and freshness
policies.

Scheduling balances data freshness, provider impact, and operating cost. Initial defaults should be conservative and tuned only after observing real crawl volume and source rules.

| Data type                 | Initial refresh approach                                           |
| ------------------------- | ------------------------------------------------------------------ |
| New area discovery        | Manual or low-frequency scheduled crawl.                           |
| Restaurant details        | Refresh periodically, prioritizing active and high-traffic venues. |
| Opening hours and status  | Refresh more frequently than static details when permitted.        |
| Ratings and review counts | Refresh on a controlled schedule.                                  |
| Images and review content | Refresh only when needed and retention is permitted.               |

The scheduler must avoid overlapping jobs for the same provider and target unless explicitly configured. It should deduplicate queued work and record the desired freshness window for each source record.

---

## 9. Rate Limiting and Request Controls

Each provider adapter must define its own request policy. A policy includes:

- Maximum concurrent requests or browser sessions.
- Minimum delay or token-bucket rate limit.
- Request timeout.
- Daily or periodic request budget where needed.
- Retryable versus non-retryable response categories.
- A circuit breaker or pause mechanism for repeated failures.

The initial configuration should use low concurrency. Increasing crawler throughput requires explicit measurement, provider review, and operational approval.

Provider-specific request controls belong inside the provider. The production discovery
provider is `GoogleMapsPlaywrightProvider`, which uses a bounded Playwright browser
session, capped result scrolling, navigation/action timeouts, and optional bounded
review extraction. The provider must be run with conservative limits and stopped when
Google presents a consent wall, CAPTCHA, login requirement, or other access restriction;
the crawler must not attempt to bypass those controls.

The supported production entrypoints are:

- `npm run crawl:playwright --workspace crawler` for one bounded discovery target.
- `npm run crawl:playwright:batch --workspace crawler` for an explicitly bounded query plan.
- `npm run worker:once --workspace crawler` to claim one queued discovery run created by
  the admin API.

The fixture CLI is a test-only harness and must not be used to populate production data.

---

## 10. Error Handling and Retry Policy

Crawler errors are classified before retrying.

| Error class       | Examples                                                        | Initial handling                                                   |
| ----------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| Transient         | Network timeout, temporary provider error, queue interruption.  | Retry with exponential backoff and bounded attempts.               |
| Rate limited      | HTTP 429 or provider-throttling signal.                         | Delay work and reduce request rate.                                |
| Invalid input     | Malformed target, missing required provider record ID.          | Do not retry; mark failed.                                         |
| Parse failure     | Unexpected page or response structure.                          | Do not repeatedly retry unchanged input; alert for adapter review. |
| Access restricted | Login requirement, CAPTCHA, blocked access, policy restriction. | Stop collection and mark the provider or job for review.           |
| Configuration     | Missing credential or invalid environment configuration.        | Do not retry; fail fast and alert.                                 |

At runtime, a provider/configuration/executor failure causes the worker to call
`CrawlRunRepository.markFailed`; the run receives `failed`, `finished_at`, and
`error_message`. An individual record failure is logged as structured JSON by the
executor and does not stop the remaining records. The pipeline transaction rolls
back on a persistence error; the executor continues to the next record, while the
run-level counters count only successful persistence operations. There is no generic
queue retry implementation yet; the admin API can retry eligible processing records
up to the implemented attempt limit.

---

## 11. Data Quality Checks at Collection Time

The crawler performs lightweight checks before emitting records:

- `providerCode` and `externalId` are present.
- Coordinates, when present, are within valid latitude and longitude ranges.
- URLs are syntactically valid and use approved schemes.
- Ratings and review counts have valid numeric ranges.
- Duplicates in the same crawl page are removed by provider external ID.
- Required provider metadata is available for audit.

The crawler does not make final canonical matching decisions. Deep validation, normalization, and cross-source deduplication belong to [05-data-pipeline.md](05-data-pipeline.md).

---

## 12. Raw Data and Source Attribution

Source attribution is mandatory. Every collected record must include its provider code, provider-specific external ID, collection timestamp, and source URL when available.

Raw payload retention is optional and policy-controlled. If retained, raw data must:

- Be limited to the minimum necessary fields and retention period.
- Be linked to the corresponding provider and crawl run.
- Not contain secrets, session cookies, or private user data.
- Be protected from public API exposure.
- Be removable or expirable according to provider and project policy.

The canonical database must preserve source references even when raw payloads expire.

---

## 13. Observability and Administration

The current backend exposes these operational views to an admin-key-protected API:

- Provider enabled/disabled state.
- Crawl-run status, duration, target, `recordsFound`, `recordsProcessed`, and error.
- Processing record stage, status, attempts, error details, and processed time.
- Active data sources and source counts.
- Unresolved processing records.

Queue depth, worker health, rate-limit dashboards, and source freshness dashboards
are not currently implemented. Provider and record errors are written to stdout as
structured JSON where the current code logs them.

Logs must use structured fields, include a correlation ID or crawl-run ID, and avoid writing tokens, cookies, passwords, or sensitive raw payloads.

---

## 14. Provider Lifecycle

Adding a provider requires:

1. Confirming legal, terms, and data-retention compatibility.
2. Creating/activating a `data_source` record in the reference data or an approved
   migration.
3. Implementing `DataProviderAdapter` and emitting `SourceRestaurantRecord` values.
4. Registering the adapter in `crawler/src/cli/worker.ts`.
5. Adding mapping, validation/error, and worker/executor tests without live crawling.
6. Running a bounded crawl and reviewing the resulting source attribution and
   canonical rows before enabling it.

Pausing a provider must stop new jobs without deleting canonical restaurant data. Removing a provider requires a retention and source-attribution decision before its source records are archived or expired.

---

## 15. Security Rules

- Keep provider credentials in environment variables or a secrets manager, never in source code.
- Use least-privilege credentials and separate credentials by environment.
- Do not log authorization headers, cookies, tokens, or browser-session state.
- Restrict crawler administration APIs to authorized administrators.
- Review every new source for data handling and retention requirements.

---

## 16. Testing Strategy

Existing crawler tests cover fixture discovery, Google provider mapping/retry with
mocked HTTP, validation, normalization, executor counters, and worker failure paths.

Each future provider adapter requires:

- Unit tests for parsing and mapping known source fixtures.
- Tests for validation and error classification.
- Tests that assert provider external ID and attribution are retained.
- Integration tests with a controlled environment only when permitted.
- Contract tests that verify emitted records match `SourceRestaurantRecord` requirements.

Tests must not depend on unrestricted production crawling or expose provider credentials.

---

## 17. Related Documents

- [01-system-architecture.md](01-system-architecture.md) — System boundaries and async ingestion architecture.
- [02-tech-stack.md](02-tech-stack.md) — proposed versus implemented technologies.
- [03-database-design.md](03-database-design.md) — Source provenance, crawl runs, and processing records.
- [05-data-pipeline.md](05-data-pipeline.md) — Validation, normalization, matching, and enrichment.
- [06-backend-api-design.md](06-backend-api-design.md) — Administrative crawler APIs.
- [09-development-rules.md](09-development-rules.md) — Project engineering standards.

# Crawler and data ingestion

The crawler is intentionally provider-neutral. Provider-specific collection logic lives
behind `DataProviderAdapter`; the canonical upsert pipeline owns validation, normalization,
source provenance, and idempotent persistence.

## Production source: Google Maps Playwright

Production crawling uses only the bounded `google_maps_playwright` adapter. The project no
longer uses the Google Places API and does not require `GOOGLE_MAPS_API_KEY`.

## Fixture crawl (tests only)

After PostgreSQL has been initialized:

```bash
npm run crawl:fixture --workspace crawler
```

Optional bounded target variables:

```dotenv
CRAWL_CITY=Ho Chi Minh City
CRAWL_DISTRICT=District 1
CRAWL_CATEGORY=coffee-shop
CRAWL_LIMIT=10
```

The fixture provider is a local test adapter only. It does not access external sites and
is not used by the backend or by database initialization. It exists to verify the
pipeline against a real PostgreSQL instance without making external requests.
Every record is validated, normalized, linked to a `crawl_run`, upserted by
`(data_source, external_id)`, and tracked in `processing_record`.

## Google Maps Playwright crawl (real source)

The Playwright adapter is bounded and uses the public Google Maps result page. It
does not log in, bypass consent/CAPTCHA, evade access controls, or use private data.
Run it only after reviewing the source terms, applicable law, request limits, and
retention policy for your deployment.

The adapter writes through the same canonical pipeline as other providers. It creates
an active `crawl_run`, validates and normalizes each result, then upserts
`restaurant`, `location`, `restaurant_source`, supported categories, and
`review`, and `processing_record` rows. Review extraction is bounded by
`CRAWL_MAX_REVIEWS_PER_PLACE` (maximum 20, default 5) and is skipped when the public
review panel is unavailable. It does not write raw browser sessions or cookies.

The reference seed must have been applied so that `google_maps_playwright` exists as
an active `data_source`. Then configure a bounded query and run:

```dotenv
CRAWL_QUERY=bún bò
CRAWL_LOCATION=Quận 1, Hồ Chí Minh
CRAWL_MAX_RESULTS=10
CRAWL_MAX_REVIEWS_PER_PLACE=5
CRAWL_HEADLESS=true
DATABASE_URL=postgresql://food_app:change-me-locally@localhost:5432/food_app
```

```bash
npm run crawl:playwright --workspace crawler
```

### Batch discovery (recommended)

Một truy vấn Google Maps chỉ là một lát dữ liệu. Batch command tự chạy query plan bao
phủ nhiều nhóm món, sau đó canonical pipeline deduplicate theo `provider + external_id`
và upsert vào database. Bạn không cần đổi keyword thủ công:

```dotenv
CRAWL_CITY=Ho Chi Minh City
CRAWL_DISTRICT=District 1
CRAWL_LIMIT_PER_QUERY=10
CRAWL_MAX_QUERIES=50
CRAWL_MAX_REVIEWS_PER_PLACE=3
CRAWL_HEADLESS=true
DATABASE_URL=postgresql://food_app:change-me-locally@localhost:5432/food_app
```

```bash
npm run crawl:playwright:batch --workspace crawler
```

## Menu images -> OCR -> dishes -> restaurant profile

Menu extraction is a second pass after the Google Maps crawl. The crawler first opens
the dedicated `Menu/Thực đơn` surface when Google exposes one, snapshots the image URLs
already present, clicks the menu surface, and keeps newly loaded menu images. This avoids
feeding the entire restaurant gallery to OCR. The remaining detail-panel images are only
a fallback when the menu surface is active but does not expose a distinct new URL.

Run the OCR/dish pass after crawling:

```bash
npm run enrich:menu-images --workspace crawler -- --limit 100
```

Each accepted result is stored as `menu_image_extraction`, each dish is stored in `dish`,
and `dish_evidence` keeps the exact menu image/name/price that supports it. Known dishes
also receive deterministic `dish_attribute` links. When a new menu dish is found, the
restaurant's cached `semantic_profile` is invalidated so the next AI enrichment includes
the new menu data.

Then rebuild the natural-language restaurant profile:

```bash
npm run enrich:ai --workspace crawler
```

The resulting profile is the useful downstream product: menu dishes become searchable
restaurant facts and become input to the semantic profile/embedding path. A menu image is
never treated as a dish unless the vision result identifies it as a high-confidence menu.

Mặc định batch dùng các nhóm tổng quát như `quán ăn`, `nhà hàng`, `món Việt`, `bún phở`,
`cơm`, `lẩu`, `nướng`, `hải sản`, món Nhật/Hàn, cà phê và tráng miệng. Có thể thay bằng
danh sách riêng, phân cách bằng dấu phẩy trong `CRAWL_QUERIES` (ví dụ
`phở,bún bò,chay`). Nên chạy tuần tự theo từng quận và giới hạn mỗi query để tôn trọng
tải, điều khoản nguồn và quota vận hành.
For the normal asynchronous path, create an Admin API crawl run with
`providerCode: "google_maps_playwright"`, `jobType: "discovery"`, and a target
containing `query`, `location`, and `limit` (or the shared `city`, `district`,
`category`, and `limit` fields), then run:

`npm run worker:once --workspace crawler`.

The inactive `fixture` and legacy `google_maps` sources have been removed from the
database. The worker registers only `google_maps_playwright`; fixture code, where
retained, is test-only and cannot be enqueued through the production database.

Real provider adapters must comply with the source terms, rate limits, retention rules,
and access restrictions documented in `docs/04-crawler-system.md`.

## Crawl-run worker foundation

`CrawlRunRepository` claims queued runs from PostgreSQL with a short transaction using
`FOR UPDATE SKIP LOCKED`. This allows multiple worker processes to poll the same table
without claiming the same run. A claimed run is changed to `running` before the provider
is validated or executed; provider/configuration/executor failures are recorded as
`failed` with a finish timestamp and error message.

Runs carry a worker lease (`worker_id`, `lease_expires_at`). The worker renews its lease
while a long Playwright crawl is active; if a process crashes, another worker can reclaim
the run after the lease expires. Set `CRAWL_WORKER_ID` for a stable deployment identity and
`CRAWL_LEASE_SECONDS` to change the minimum 60-second lease duration.

`CrawlRunWorker` is provider-neutral. The application composes a registry of approved
`DataProviderAdapter` instances and supplies an executor that maps the run target to the
provider discovery/pipeline flow. The worker currently exposes `runOnce()` deliberately:
process supervision, polling interval, and retry policy remain deployment concerns until
a real provider and operational requirements are selected.

The current executor intentionally accepts only `discovery` crawl runs. The API may store
other job types for future phases, but those jobs fail fast rather than being interpreted
as discovery jobs. Provider registry entries are also checked against their declared
`providerCode` before execution.

The worker does not register the fixture provider automatically and does not create crawl
runs by itself. This prevents test data from entering the production ingestion path.

Record-level validation and upsert failures are persisted to `processing_record` with stage,
attempt count, and JSON error details. The crawl continues with later records, so operators
can inspect them through `GET /admin/processing-records?processingStatus=failed`. Retrying
an item with `POST /admin/processing-records/:id/retry` enqueues a new bounded discovery crawl
run using the original run target; it returns `retryRunId`. The old record is retained as
`skipped` with the retry link because the current discovery worker processes crawl runs, not
individual processing-record rows. Only records from discovery runs are retryable until
workers for other job types are implemented.

The one-shot entrypoint is available for process supervisors:

```bash
npm run worker:once --workspace crawler
```

The worker registers `GoogleMapsPlaywrightProvider` explicitly. The fixture provider remains
available only through the fixture CLI and is never registered by the worker.

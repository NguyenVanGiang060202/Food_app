// Review backfill CLI.
//
// Discovery crawl upserts restaurant rows but review extraction is best-effort:
// Google has far more reviews per place than we captured (and reviews drive the
// AI semantic profiles / embedding search). This tool re-opens each place's
// Google Maps page directly from the stored source_url, re-extracts reviews,
// and upserts them so the existing restaurant row gets richer review context.
//
// Because it navigates a saved place URL instead of running a search, it does
// NOT collide with hasCompletedRun() de-duplication — a full batch-crawl re-run
// is skipped as completed, but this deliberate backfill is the correct path.
//
//   npm run review:refresh --workspace crawler                  # all gaps
//   npm run review:refresh --workspace crawler -- --limit 200
//   npm run review:refresh --workspace crawler -- --threshold 3  # <3 reviews
//   npm run review:refresh --workspace crawler -- --dry-run
//
// Tuning (env):
//   CRAWL_MAX_REVIEWS_PER_PLACE=20  how many reviews to pull per place (caps at 20)
//   CRAWL_DELAY_MS=2500             pause between places to avoid rate limits
//   CRAWL_CONCURRENCY=2             parallel browsers (raise with a 20h budget)

import { Pool } from 'pg';
import { GoogleMapsPlaywrightProvider } from '../providers/google-maps/google-maps-playwright.provider';
import { CanonicalUpsertPipeline } from '../pipeline/canonical-upsert.pipeline';
import { normalizeSourceRecord } from '../pipeline/normalizer';
import { validateSourceRecord } from '../validation/source-record.validation';
import type { SourceRestaurantRecord } from '../types/source-record';

const THRESHOLD = clampInt(process.env.REVIEW_REFRESH_THRESHOLD ?? '', 20, 0, 100);
const DELAY_MS = clampInt(process.env.CRAWL_DELAY_MS ?? '', 2500, 0, 120_000);
const CONCURRENCY = clampInt(process.env.CRAWL_CONCURRENCY ?? '', 2, 1, 8);
const HEARTBEAT_SECONDS = clampInt(process.env.CRAWL_HEARTBEAT_SECONDS ?? '', 30, 5, 600);
const MAX_REVIEWS_PER_PLACE = clampInt(
  process.env.CRAWL_MAX_REVIEWS_PER_PLACE ?? '',
  20,
  1,
  20,
);

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = raw ? Number(raw) : NaN;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

interface ReviewTarget {
  sourceId: string;
  restaurantId: string;
  externalId: string;
  sourceUrl: string;
  name: string;
}

function parseArgs(argv: string[]): { limit: number; dryRun: boolean; threshold: number } {
  let limit = 0;
  let dryRun = false;
  let threshold = THRESHOLD;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--limit') {
      limit = Number(argv[index + 1]);
      if (!Number.isInteger(limit) || limit < 0) {
        throw new Error('--limit must be a non-negative integer.');
      }
    } else if (argv[index] === '--dry-run') {
      dryRun = true;
    } else if (argv[index] === '--threshold') {
      threshold = Number(argv[index + 1]);
      if (!Number.isInteger(threshold) || threshold < 0) {
        throw new Error('--threshold must be a non-negative integer.');
      }
    }
  }
  return { limit, dryRun, threshold };
}

async function main(): Promise<void> {
  const { limit, dryRun, threshold } = parseArgs(process.argv.slice(2));
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? 'food_app',
    user: process.env.PGUSER ?? 'food_app',
    password: process.env.PGPASSWORD ?? 'change-me-locally',
    max: 5,
    connectionTimeoutMillis: 3000,
  });
  const pipeline = new CanonicalUpsertPipeline();
  const provider = new GoogleMapsPlaywrightProvider({
    maxReviewsPerPlace: MAX_REVIEWS_PER_PLACE,
    headless: process.env.CRAWL_HEADLESS !== 'false',
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
  });

  try {
    const { rows } = await pool.query<ReviewTarget>(
      `SELECT rs.id AS "sourceId", rs.restaurant_id AS "restaurantId",
              rs.external_id AS "externalId", rs.source_url AS "sourceUrl", r.name
       FROM restaurant_source rs
       JOIN restaurant r ON r.id = rs.restaurant_id
       JOIN data_source ds ON ds.id = rs.data_source_id
       WHERE ds.code = 'google_maps_playwright'
         AND rs.status = 'active'
         AND rs.source_url IS NOT NULL
         AND r.status = 'active'
         AND (
           SELECT count(*)
           FROM review v
           WHERE v.restaurant_source_id = rs.id
             AND (v.is_visible IS TRUE OR v.is_visible IS NULL)
         ) < $1
       ORDER BY (
           SELECT count(*)
           FROM review v
           WHERE v.restaurant_source_id = rs.id
             AND (v.is_visible IS TRUE OR v.is_visible IS NULL)
         ), r.name
       ${limit > 0 ? 'LIMIT ' + limit : ''}`,
      [threshold],
    );
    const candidates = rows;
    if (candidates.length === 0) {
      console.log(
        JSON.stringify({
          event: 'review_refresh_completed',
          dryRun,
          threshold,
          scanned: 0,
          placesFetched: 0,
          recordsProcessed: 0,
          failed: 0,
          noReviewsFound: 0,
        }),
      );
      return;
    }

    console.error(
      JSON.stringify({
        event: 'review_refresh_start',
        dryRun,
        threshold,
        targets: candidates.length,
        maxReviewsPerPlace: MAX_REVIEWS_PER_PLACE,
        concurrency: CONCURRENCY,
        delayMs: DELAY_MS,
      }),
    );

    let crawlRunId: string | undefined;
    if (!dryRun) {
      crawlRunId = await pipeline.createCrawlRun(provider.providerCode, {
        type: 'review-refresh',
        threshold,
        limit: limit > 0 ? limit : candidates.length,
      });
    }

    let scanCursor = 0;
    let scanned = 0;
    let placesFetched = 0;
    let recordsProcessed = 0;
    let failed = 0;
    let noReviewsFound = 0;
    const heartbeat = setInterval(() => {
      console.error(
        JSON.stringify({
          event: 'review_refresh_heartbeat',
          scanned,
          placesFetched,
          recordsProcessed,
          failed,
          noReviewsFound,
          total: candidates.length,
        }),
      );
    }, HEARTBEAT_SECONDS * 1_000);
    heartbeat.unref();

    const worker = async (): Promise<void> => {
      while (scanCursor < candidates.length) {
        const target = candidates[scanCursor];
        scanCursor += 1;
        try {
          const record = await provider.fetchPlaceReviewsByUrl(
            target.sourceUrl,
            target.name,
          );
          scanned += 1;
          if (!record) {
            noReviewsFound += 1;
            continue;
          }
          placesFetched += 1;

          // Pin the record to the exact restaurant_source already in the DB so
          // the upsert targets the same row (external/review ids match) instead
          // of creating a second source row for the same place.
          const pinned: SourceRestaurantRecord = {
            ...record,
            externalId: target.externalId,
            sourceUrl: target.sourceUrl,
            name: record.name || target.name,
          };
          if (!dryRun && crawlRunId) {
            validateSourceRecord(pinned);
            await pipeline.process(crawlRunId, normalizeSourceRecord(pinned));
          }
          recordsProcessed += 1;
        } catch (error) {
          failed += 1;
          console.error(
            JSON.stringify({
              event: 'review_refresh_failed',
              name: target.name,
              message: error instanceof Error ? error.message : String(error),
            }),
          );
        }
        if (DELAY_MS > 0 && scanCursor < candidates.length) {
          await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
        }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    clearInterval(heartbeat);

    if (crawlRunId) {
      await pipeline.finishCrawlRun(crawlRunId, scanned, recordsProcessed);
    }

    console.log(
      JSON.stringify({
        event: 'review_refresh_completed',
        dryRun,
        threshold,
        scanned,
        placesFetched,
        recordsProcessed,
        failed,
        noReviewsFound,
      }),
    );
  } finally {
    await pipeline.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'review_refresh_fatal', message: String(error) }));
  process.exitCode = 1;
});

// Playwright can surface an internal assertion from the browser process on the
// event loop after a page/browser is torn down. That kills the whole 20h run
// unless we catch it here and turn it into a logged, retriable failure.
process.on('uncaughtException', (error) => {
  console.error(
    JSON.stringify({
      event: 'review_refresh_uncaught_exception',
      message: error instanceof Error ? error.stack ?? error.message : String(error),
    }),
  );
  process.exitCode = 2;
});
process.on('unhandledRejection', (reason) => {
  console.error(
    JSON.stringify({
      event: 'review_refresh_unhandled_rejection',
      message: reason instanceof Error ? reason.stack ?? reason.message : String(reason),
    }),
  );
  process.exitCode = 2;
});
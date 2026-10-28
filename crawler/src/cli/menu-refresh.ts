// Refresh Google Maps menu-tab images for existing active restaurants.
//
// This deliberately navigates stored place URLs instead of doing discovery.
// It only persists images that the crawler found after opening the dedicated
// Menu/Thực đơn tab; gallery photos are not treated as menu evidence.

import { Pool } from 'pg';
import { GoogleMapsPlaywrightProvider } from '../providers/google-maps/google-maps-playwright.provider';
import { CanonicalUpsertPipeline } from '../pipeline/canonical-upsert.pipeline';
import { normalizeSourceRecord } from '../pipeline/normalizer';
import { validateSourceRecord } from '../validation/source-record.validation';
import type { SourceRestaurantRecord } from '../types/source-record';

const DEFAULT_DISH_TARGETS = [
  'phở bò',
  'phở gà',
  'bún bò Huế',
  'bún riêu',
  'bún thịt nướng',
  'cơm tấm',
  'cơm gà',
  'hủ tiếu Nam Vang',
  'mì Quảng',
  'lẩu bò',
  'gà nướng',
  'bánh canh cua',
  'bánh mì thịt',
  'bánh mì thịt nướng',
  'mì xào hải sản',
  'bánh xèo',
  'món chay',
  'chè',
];

interface Target {
  restaurantId: string;
  sourceId: string;
  externalId: string;
  sourceUrl: string;
  name: string;
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : fallback;
}

function parseArgs(argv: string[]) {
  let limit = intEnv('MENU_REFRESH_LIMIT', 24, 1, 200);
  let concurrency = intEnv('MENU_REFRESH_CONCURRENCY', 2, 1, 4);
  let delayMs = intEnv('MENU_REFRESH_DELAY_MS', 1500, 0, 120_000);
  let name: string | null = null;
  let restaurantId: string | null = null;
  let targets = [...DEFAULT_DISH_TARGETS];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--limit') limit = intEnvValue(argv[++index], '--limit', 1, 200);
    else if (arg === '--concurrency') concurrency = intEnvValue(argv[++index], '--concurrency', 1, 4);
    else if (arg === '--delay-ms') delayMs = intEnvValue(argv[++index], '--delay-ms', 0, 120_000);
    else if (arg === '--name') name = argv[++index]?.trim() || null;
    else if (arg === '--restaurant-id') {
      restaurantId = argv[++index] ?? null;
      if (!restaurantId || !/^[0-9a-f-]{36}$/i.test(restaurantId)) throw new Error('--restaurant-id must be a UUID.');
    } else if (arg === '--dish') {
      const dish = argv[++index]?.trim();
      if (!dish) throw new Error('--dish requires a value.');
      if (targets.length === DEFAULT_DISH_TARGETS.length && targets.every((value, i) => value === DEFAULT_DISH_TARGETS[i])) targets = [];
      targets.push(dish);
    }
  }
  return { limit, concurrency, delayMs, name, restaurantId, targets };
}

function intEnvValue(raw: string | undefined, flag: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${flag} must be an integer from ${min} to ${max}.`);
  return value;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const pipeline = new CanonicalUpsertPipeline();
  const provider = new GoogleMapsPlaywrightProvider({
    headless: process.env.CRAWL_HEADLESS !== 'false',
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
    maxReviewsPerPlace: 0,
    reuseBrowser: true,
    browserRestartEvery: 30,
  });

  try {
    const values: unknown[] = [];
    const filters = [
      `r.status = 'active'`,
      `rs.status = 'active'`,
      `rs.source_url IS NOT NULL`,
    ];
    if (options.restaurantId) {
      values.push(options.restaurantId);
      filters.push(`r.id = $${values.length}::uuid`);
    }
    // A restaurant may already have a menu-tab photo for another dish or an
    // earlier partial crawl. That must not suppress a refresh for the exact
    // dish currently missing coverage. Keep the skip optimization only for
    // broad maintenance runs, while an explicit restaurant is always allowed
    // to re-open the current Maps menu.
    if (!options.restaurantId && options.targets.length) {
      values.push(options.targets);
      filters.push(`NOT EXISTS (
        SELECT 1
        FROM dish target_dish
        JOIN dish_evidence target_evidence
          ON target_evidence.dish_id = target_dish.id
         AND target_evidence.evidence_type = 'menu_image'
        JOIN menu_image_extraction target_extraction
          ON target_extraction.restaurant_image_id = target_evidence.restaurant_image_id
         AND target_extraction.status = 'completed'
         AND target_extraction.model IN ('website:menu:v1', 'website:menu-image-curated:v1', 'google_maps:menu-curated:v1')
        WHERE target_dish.restaurant_id = r.id
          AND target_dish.status = 'available'
          AND lower(unaccent(target_dish.normalized_name)) = ANY (
            SELECT lower(unaccent(value)) FROM unnest($${values.length}::text[]) AS value
          )
      )`);
    } else if (!options.restaurantId) {
      filters.push(
        `NOT EXISTS (SELECT 1 FROM restaurant_image menu_image WHERE menu_image.restaurant_id = r.id AND menu_image.status = 'active' AND menu_image.alt_text ILIKE '%Google Maps menu tab%')`,
      );
    }
    if (options.name) {
      values.push(`%${options.name}%`);
      filters.push(`r.name ILIKE $${values.length}`);
    }
    if (options.targets.length) {
      values.push(options.targets);
      filters.push(`(
        lower(unaccent(r.name)) LIKE ANY (SELECT '%' || lower(unaccent(value)) || '%' FROM unnest($${values.length}::text[]) AS value)
        OR lower(unaccent(COALESCE(rs.raw_data->>'query', ''))) LIKE ANY (SELECT '%' || lower(unaccent(value)) || '%' FROM unnest($${values.length}::text[]) AS value)
      )`);
    }
    const limit = options.limit;
    const { rows: targets } = await pool.query<Target>(
      `SELECT r.id AS "restaurantId", rs.id AS "sourceId", rs.external_id AS "externalId",
              rs.source_url AS "sourceUrl", r.name
       FROM restaurant r
       JOIN restaurant_source rs ON rs.restaurant_id = r.id
       JOIN data_source ds ON ds.id = rs.data_source_id AND ds.code = 'google_maps_playwright'
       WHERE ${filters.join(' AND ')}
       ORDER BY r.review_count DESC NULLS LAST, r.rating DESC NULLS LAST, r.name
       LIMIT ${limit}`,
      values,
    );

    console.error(JSON.stringify({ event: 'menu_refresh_start', targets: targets.length, limit, concurrency: options.concurrency, delayMs: options.delayMs, dishTargets: options.targets }));
    if (!targets.length) return;

    const crawlRunId = await pipeline.createCrawlRun(provider.providerCode, { type: 'menu-refresh', limit, targets: options.targets });
    let cursor = 0;
    let scanned = 0;
    let withMenu = 0;
    let failed = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const target = targets[cursor++];
        if (!target) return;
        try {
          const record = await provider.fetchPlaceReviewsByUrl(target.sourceUrl, target.name);
          scanned += 1;
          if (!record) continue;
          const pinned: SourceRestaurantRecord = {
            ...record,
            externalId: target.externalId,
            sourceUrl: target.sourceUrl,
            name: record.name || target.name,
            reviews: [],
          };
          validateSourceRecord(pinned);
          await pipeline.process(crawlRunId, normalizeSourceRecord(pinned));
          const menuCount = (record.images ?? []).filter((image) => /menu|thực đơn/i.test(image.altText ?? '')).length;
          if (menuCount > 0) withMenu += 1;
          console.error(JSON.stringify({ event: 'menu_refresh_place', name: target.name, scanned, menuImages: menuCount }));
        } catch (error) {
          failed += 1;
          console.error(JSON.stringify({ event: 'menu_refresh_failed', name: target.name, message: error instanceof Error ? error.message : String(error) }));
        }
        if (options.delayMs > 0 && cursor < targets.length) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
    };
    await Promise.all(Array.from({ length: Math.min(options.concurrency, targets.length) }, () => worker()));
    await pipeline.finishCrawlRun(crawlRunId, scanned, withMenu);
    console.log(JSON.stringify({ event: 'menu_refresh_complete', scanned, withMenu, failed, total: targets.length }));
  } finally {
    await provider.close();
    await pipeline.close();
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({ event: 'menu_refresh_fatal', message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});

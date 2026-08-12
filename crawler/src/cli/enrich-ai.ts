// AI semantic-profile enrichment.
//
// The rule/AI category taxonomy is too coarse to express what a Vietnamese
// restaurant really is ("bún bò Huế cay, nước dùng ngọt, khách khen no bụng").
// This one-shot CLI asks the runtime LLM (OpenAI-compatible, e.g. Groq) to
// write a natural-language food profile (2–4 sentences) per restaurant — main
// dishes, flavor, texture/feel, portion, cooking style, and what reviewers
// praise — from the restaurant name, extracted dish names and the latest
// visible reviews. Profiles become the semantic document for embedding-based
// search, so free-form user chat no longer needs a fixed category to match.
//
// The LLM also returns a best-guess category slug as a soft signal (kept for
// the existing category chips/filters), but the profile is the primary output.
// Idempotent: only restaurants without a profile yet are processed; the run is
// recorded in `enrichment_log`.
//
//   npm run enrich:ai --workspace crawler                 # all gaps
//   npm run enrich:ai --workspace crawler -- --limit 300
//   npm run enrich:ai --workspace crawler -- --dry-run
//
// Requires AI_API_KEY / AI_BASE_URL / AI_MODEL (same env as the backend) and a
// migrated database (022_enrichment_provenance.sql + 026_semantic_profile.sql).

import { Pool } from 'pg';

interface CategoryRow {
  id: string;
  slug: string;
}
interface RestaurantRow {
  id: string;
  name: string;
  dishes: string[];
  reviews: string[];
}
interface ProfileItem {
  index: number;
  profile: string | null;
  category: string | null;
}

const CATEGORY_SOURCE = 'enrichment:category:ai:v1';
const CATEGORY_CONFIDENCE = 0.8;

// Tunable from the shell so a run can be shaped to the provider rate limits
// without a code change, e.g.
//   AI_BATCH_SIZE=3 AI_MAX_ATTEMPTS=5 AI_BATCH_COOLDOWN_MS=2000 docker compose run ...
const BATCH_SIZE = clampInt(process.env.AI_BATCH_SIZE, 10, 1, 50);
const MAX_ATTEMPTS = clampInt(process.env.AI_MAX_ATTEMPTS, 8, 1, 20);
const BATCH_COOLDOWN_MS = clampInt(process.env.AI_BATCH_COOLDOWN_MS, 1_000, 0, 60_000);
const MAX_RETRY_WAIT_MS = 60_000;
const MAX_CONSECUTIVE_BATCH_FAILURES = 3;
// Some OpenAI-compatible gateways (e.g. api.shineshop.dev) reject requests that
// omit max_tokens / max_output_tokens. Groq accepts it as an optional param, so
// this is safe when switching back to Groq.
const MAX_OUTPUT_TOKENS = clampInt(process.env.AI_MAX_OUTPUT_TOKENS, 8_192, 256, 128_000);
const MAX_REVIEWS = 4;
const REVIEW_EXCERPT_LENGTH = 110;
const MAX_DISHES = 6;

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = raw ? Number(raw) : NaN;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function parseArgs(argv: string[]): { limit: number; dryRun: boolean } {
  let limit = 0;
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--limit') {
      limit = Number(argv[index + 1]);
      if (!Number.isInteger(limit) || limit < 0) {
        throw new Error('--limit must be a non-negative integer.');
      }
    } else if (argv[index] === '--dry-run') {
      dryRun = true;
    }
  }
  return { limit, dryRun };
}

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function generateProfiles(
  baseUrl: string,
  apiKey: string,
  model: string,
  slugs: string[],
  batch: RestaurantRow[],
): Promise<ProfileItem[]> {
  const list = batch
    .map((row, index) => {
      const dishes = row.dishes.length ? ` món: ${row.dishes.join(', ')}` : '';
      const reviews = row.reviews.length
        ? ` review: ${row.reviews.map((review) => `"${review}"`).join('; ')}`
        : '';
      return `${index}. ${row.name}${dishes}${reviews}`;
    })
    .join('\n');
  const system = [
    'Bạn là chuyên gia ẩm thực Việt Nam.',
    'Với MỖI quán, viết "profile": 2-4 câu tiếng Việt tự nhiên, chỉ dựa trên thông tin được cung cấp (tên, món, review).',
    'Gồm: món chính/tinh hoa, hương vị (mặn/ngọt/cay/đậm đà...), độ no/khẩu phần, cách chế biến, điểm khách khen hoặc không gian nếu có.',
    'KHÔNG bịa món không xuất hiện trong thông tin; không nói giá, địa chỉ, giờ mở cửa.',
    `Đồng thời gán "category" bằng đúng một trong các slug: ${slugs.join(', ')}, nếu không rõ thì null.`,
    'Trả về JSON object duy nhất dạng {"items":[{"index":0,"profile":"...","category":"bun"}]}. Không markdown, không giải thích thêm.',
  ].join('\n');
  const user = `Viết hồ sơ món ăn cho từng quán.\n\n${list}`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: MAX_OUTPUT_TOKENS,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: controller.signal,
      });
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get('retry-after'));
        // Never scale a provider-provided retry-after by the attempt counter —
        // at attempt 8 that used to mean hours of sleep per batch (the run
        // looked hung). Cap any single wait so the process always makes
        // progress and eventually exits.
        const delayMs =
          retryAfter > 0
            ? Math.min(retryAfter * 1000, MAX_RETRY_WAIT_MS)
            : Math.min(3_000 * Math.pow(2, attempt - 1), MAX_RETRY_WAIT_MS);
        console.error(
          JSON.stringify({ event: 'ai_batch_retry', attempt, status: response.status, delayMs }),
        );
        await sleep(delayMs);
        continue;
      }
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`AI provider ${response.status}: ${body.slice(0, 300)}`);
      }
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error('AI provider returned an empty response.');
      const parsed = JSON.parse(content) as unknown;
      const items = (parsed as { items?: unknown } | undefined)?.items;
      if (!Array.isArray(items)) throw new Error('AI response is missing an items array.');
      const profiles: ProfileItem[] = [];
      const seen = new Set<number>();
      for (const entry of items) {
        if (!entry || typeof entry !== 'object') continue;
        const index = (entry as { index?: unknown }).index;
        const profile = (entry as { profile?: unknown }).profile;
        const category = (entry as { category?: unknown }).category;
        if (typeof index !== 'number' || !Number.isInteger(index)) continue;
        if (index < 0 || index >= batch.length || seen.has(index)) continue;
        seen.add(index);
        profiles.push({
          index,
          profile:
            typeof profile === 'string' && profile.trim().length > 0
              ? truncate(profile.trim(), 1500)
              : null,
          category:
            typeof category === 'string' && slugs.includes(category) ? category : null,
        });
      }
      return profiles;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.error(JSON.stringify({ event: 'ai_batch_timeout', attempt }));
        await sleep(3_000 * attempt);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('AI batch failed after retries.');
}

async function main(): Promise<void> {
  const { limit, dryRun } = parseArgs(process.argv.slice(2));
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

  const baseUrl = (process.env.AI_BASE_URL ?? '').replace(/\/+$/, '');
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL ?? 'llama-3.3-70b-versatile';
  if (!baseUrl || !apiKey) {
    console.error(
      JSON.stringify({
        event: 'enrichment_failed',
        message: 'AI_BASE_URL / AI_API_KEY not configured.',
      }),
    );
    process.exitCode = 1;
    await pool.end();
    return;
  }

  const logId = dryRun
    ? null
    : await pool
        .query(
          `INSERT INTO enrichment_log (run_type, model, params)
           VALUES ('profile+category:ai', $1, $2) RETURNING id`,
          [`ai:${model}`, { limit, dryRun, batchSize: BATCH_SIZE }],
        )
        .then((result) => result.rows[0].id as number);

  try {
    const categories = (
      await pool.query<CategoryRow>(`SELECT id, slug FROM category WHERE is_active = true`)
    ).rows;
    const slugSet = new Set(categories.map((category) => category.slug));

    let sql = `
      SELECT r.id, r.name,
        COALESCE((
          SELECT jsonb_agg(x.n)
          FROM (
            SELECT d.normalized_name AS n
            FROM dish d
            WHERE d.restaurant_id = r.id
              AND d.status = 'available'
              AND d.normalized_name IS NOT NULL
              AND length(trim(d.normalized_name)) > 0
            ORDER BY d.id
            LIMIT ${MAX_DISHES}
          ) x
        ), '[]'::jsonb) AS dishes
      FROM restaurant r
      WHERE r.status = 'active'
        AND (r.semantic_profile IS NULL OR btrim(r.semantic_profile) = '')
      ORDER BY r.name`;
    if (limit > 0) sql += ` LIMIT ${limit}`;
    const restaurants = (
      await pool.query<{ id: string; name: string; dishes: string[] }>(sql)
    ).rows;
    if (!restaurants.length) {
      console.log(
        JSON.stringify({
          event: 'enrichment_completed',
          dryRun,
          scanned: 0,
          profilesApplied: 0,
          categoriesApplied: 0,
          failedBatches: 0,
          missing: 0,
        }),
      );
      return;
    }

    const { rows: reviewRows } = await pool.query<{
      restaurant_id: string;
      content: string;
    }>(
      `SELECT restaurant_id, content
       FROM review
       WHERE content IS NOT NULL
         AND (is_visible IS TRUE OR is_visible IS NULL)
         AND restaurant_id = ANY($1)
       ORDER BY restaurant_id, reviewed_at DESC NULLS LAST, id DESC`,
      [restaurants.map((row) => row.id)],
    );
    const reviewsByRestaurant = new Map<string, string[]>();
    for (const review of reviewRows) {
      const list = reviewsByRestaurant.get(review.restaurant_id) ?? [];
      if (list.length < MAX_REVIEWS) {
        list.push(truncate(review.content, REVIEW_EXCERPT_LENGTH));
      }
      reviewsByRestaurant.set(review.restaurant_id, list);
    }
    const rows: RestaurantRow[] = restaurants.map((row) => ({
      id: row.id,
      name: row.name,
      dishes: row.dishes ?? [],
      reviews: reviewsByRestaurant.get(row.id) ?? [],
    }));

    let profilesApplied = 0;
    let categoriesApplied = 0;
    let scanned = 0;
    let failedBatches = 0;
    let consecutiveFailures = 0;
    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
      const batch = rows.slice(offset, offset + BATCH_SIZE);
      let items: ProfileItem[];
      try {
        items = await generateProfiles(baseUrl, apiKey, model, [...slugSet], batch);
        consecutiveFailures = 0;
      } catch (error) {
        // Idempotency makes a skipped batch safe: it is simply picked up on the
        // next run. Stop early only when the provider is clearly down, so a
        // terminal rate limit does not burn through every remaining batch.
        consecutiveFailures += 1;
        failedBatches += 1;
        console.error(
          JSON.stringify({
            event: 'ai_batch_failed',
            offset,
            consecutiveFailures,
            message: error instanceof Error ? error.message : String(error),
          }),
        );
        if (consecutiveFailures >= MAX_CONSECUTIVE_BATCH_FAILURES) {
          throw new Error(`Stopping early after ${MAX_CONSECUTIVE_BATCH_FAILURES} consecutive AI batch failures.`);
        }
        continue;
      }
      scanned += batch.length;

      const profileValues: string[] = [];
      const profileParams: unknown[] = [];
      let index = 1;
      for (const item of items) {
        const row = batch[item.index];
        if (!row || !item.profile) continue;
        profileParams.push(row.id, item.profile);
        profileValues.push(`($${index}::uuid, $${index + 1}::text)`);
        index += 2;
        profilesApplied += 1;
      }

      const categoryValues: string[] = [];
      const categoryParams: unknown[] = [];
      let categoryIndex = 1;
      for (const item of items) {
        const row = batch[item.index];
        if (!row || !item.category || !slugSet.has(item.category)) continue;
        categoryParams.push(row.id, item.category, CATEGORY_SOURCE);
        categoryValues.push(
          `($${categoryIndex}::uuid, $${categoryIndex + 1}::text, $${categoryIndex + 2}::text)`,
        );
        categoryIndex += 3;
        categoriesApplied += 1;
      }

      if (!dryRun) {
        if (profileValues.length) {
          await pool.query(
            `UPDATE restaurant r
             SET semantic_profile = v.profile, updated_at = now()
             FROM (VALUES ${profileValues.join(', ')})
                  AS v(restaurant_id, profile)
             WHERE r.id = v.restaurant_id
               AND (r.semantic_profile IS NULL OR btrim(r.semantic_profile) = '')`,
            profileParams,
          );
        }
        if (categoryValues.length) {
          await pool.query(
            `INSERT INTO restaurant_category (restaurant_id, category_id, source, confidence, updated_at)
             SELECT v.restaurant_id, c.id, v.source, ${CATEGORY_CONFIDENCE}, now()
             FROM (VALUES ${categoryValues.join(', ')})
                  AS v(restaurant_id, category_slug, source)
             JOIN category c ON c.slug = v.category_slug AND c.is_active = true
             ON CONFLICT (restaurant_id, category_id) DO NOTHING`,
            categoryParams,
          );
        }
      }
      console.log(
        JSON.stringify({
          event: 'batch',
          dryRun,
          scanned,
          profilesApplied,
          categoriesApplied,
          failedBatches,
        }),
      );
      if (BATCH_COOLDOWN_MS > 0 && offset + BATCH_SIZE < rows.length) {
        await sleep(BATCH_COOLDOWN_MS);
      }
    }

    const missing = rows.length - scanned;

    if (logId !== null) {
      await pool.query(
        `UPDATE enrichment_log
            SET status = 'completed', finished_at = now(),
                restaurants_scanned = $2, categories_applied = $3
          WHERE id = $1`,
        [logId, scanned, profilesApplied],
      );
    }
    console.log(
      JSON.stringify({
        event: 'enrichment_completed',
        dryRun,
        scanned,
        profilesApplied,
        categoriesApplied,
        failedBatches,
        missing,
        hint: missing > 0 ? `re-run to cover ${missing} remaining (idempotent)` : undefined,
      }),
    );
  } catch (error) {
    if (logId !== null) {
      await pool
        .query(
          `UPDATE enrichment_log
              SET status = 'failed', finished_at = now(), failure_message = $2
            WHERE id = $1`,
          [logId, error instanceof Error ? error.message : String(error)],
        )
        .catch(() => undefined);
    }
    console.error(JSON.stringify({ event: 'enrichment_failed', message: String(error) }));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'enrichment_failed', message: String(error) }));
  process.exitCode = 1;
});

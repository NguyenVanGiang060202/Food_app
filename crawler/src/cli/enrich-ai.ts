// AI-assisted category classification for enrichment.
//
// The deterministic rule-based classifier (`enrich.ts` / category-classifier)
// only recognizes obvious names (cà phê, chay, cơm tấm, bún, phở, bánh mì…).
// Many real names ("À Lôi BBQ", "Ẩm thực Nhật Bản Ajido", "3AM ĐỒ ĂN - TRÀ - TRÁNG
// MIỆNG") have no rule, so they stay uncategorized and invisible to search.
//
// This one-shot CLI closes that gap by asking the runtime LLM (OpenAI-compatible,
// e.g. Groq) to map each restaurant name — plus a short review excerpt — to one
// of the ACTIVE category slugs in the database. It only touches restaurants with
// no category yet, writes with `source = enrichment:category:ai:v1`, and never
// overrides crawler/fixture/rule-observed facts.
//
//   npm run enrich:ai --workspace crawler                 # all gaps
//   npm run enrich:ai --workspace crawler -- --limit 300
//   npm run enrich:ai --workspace crawler -- --dry-run
//
// Requires AI_API_KEY / AI_BASE_URL / AI_MODEL (same env as the backend) and a
// migrated database (022_enrichment_provenance.sql).

import { Pool } from 'pg';

interface CategoryRow {
  id: string;
  slug: string;
}
interface RestaurantRow {
  id: string;
  name: string;
  review: string | null;
}
interface Classification {
  index: number;
  slug: string | null;
}

const AI_SOURCE = 'enrichment:category:ai:v1';
const AI_CONFIDENCE = 0.9;
const BATCH_SIZE = 20;
const REVIEW_EXCERPT_LENGTH = 60;
const MAX_ATTEMPTS = 8;

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

async function classifyBatch(
  baseUrl: string,
  apiKey: string,
  model: string,
  slugs: string[],
  batch: RestaurantRow[],
): Promise<Classification[]> {
  const list = batch
    .map(
      (row, index) =>
        `${index}. ${row.name}${row.review ? ` — trích đánh giá: ${truncate(row.review, REVIEW_EXCERPT_LENGTH)}` : ''}`,
    )
    .join('\n');
  const system = [
    'Bạn là trợ lý phân loại quán ăn tiếng Việt.',
    `BẮT BUỘC chỉ dùng đúng một trong các category slug: ${slugs.join(', ')}.`,
    'Nếu không chắc chắn hoặc không thuộc bất kỳ slug nào, dùng null.',
    'Trả về JSON object duy nhất dạng {"items": [{"index": 0, "slug": "coffee-shop", "reason": "..."}]}. Không markdown, không giải thích thêm.',
  ].join('\n');
  const user = `Phân loại từng quán theo tên (và trích đánh giá nếu có).\n\n${list}`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
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
        const delayMs = (retryAfter > 0 ? retryAfter * 1000 : 3_000) * Math.pow(2, attempt - 1);
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
      const classifications: Classification[] = [];
      const seen = new Set<number>();
      for (const entry of items) {
        if (!entry || typeof entry !== 'object') continue;
        const index = (entry as { index?: unknown }).index;
        const slug = (entry as { slug?: unknown }).slug;
        if (typeof index !== 'number' || !Number.isInteger(index)) continue;
        if (index < 0 || index >= batch.length || seen.has(index)) continue;
        seen.add(index);
        if (typeof slug === 'string' && slugs.includes(slug)) {
          classifications.push({ index, slug });
        } else if (slug === null) {
          classifications.push({ index, slug: null });
        }
      }
      return classifications;
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
           VALUES ('category:ai', $1, $2) RETURNING id`,
          [`ai:${model}`, { limit, dryRun, batchSize: BATCH_SIZE }],
        )
        .then((result) => result.rows[0].id as number);

  try {
    const categories = (
      await pool.query<CategoryRow>(`SELECT id, slug FROM category WHERE is_active = true`)
    ).rows;
    const slugSet = new Set(categories.map((category) => category.slug));
    if (!slugSet.size) throw new Error('No active categories found.');

    let sql = `
      SELECT r.id, r.name,
        (SELECT v.content
           FROM review v
          WHERE v.restaurant_id = r.id
            AND v.is_visible = true
            AND v.content IS NOT NULL
            AND length(trim(v.content)) > 0
          ORDER BY v.reviewed_at DESC NULLS LAST, v.id DESC
          LIMIT 1) AS review
      FROM restaurant r
      WHERE r.status = 'active'
        AND NOT EXISTS (
          SELECT 1
          FROM restaurant_category rc
          JOIN category c ON c.id = rc.category_id AND c.is_active = true
          WHERE rc.restaurant_id = r.id
        )
      ORDER BY r.name`;
    if (limit > 0) sql += ` LIMIT ${limit}`;
    const restaurants = (await pool.query<RestaurantRow>(sql)).rows;
    if (!restaurants.length) {
      console.log(
        JSON.stringify({ event: 'enrichment_completed', dryRun, scanned: 0, categoriesApplied: 0 }),
      );
      return;
    }

    let applied = 0;
    let scanned = 0;
    for (let offset = 0; offset < restaurants.length; offset += BATCH_SIZE) {
      const batch = restaurants.slice(offset, offset + BATCH_SIZE);
      const classifications = await classifyBatch(baseUrl, apiKey, model, [...slugSet], batch);
      scanned += batch.length;

      const values: string[] = [];
      const params: unknown[] = [];
      let index = 1;
      for (const item of classifications) {
        const row = batch[item.index];
        if (!row || !item.slug || !slugSet.has(item.slug)) continue;
        params.push(row.id, item.slug, AI_SOURCE);
        values.push(`($${index}::uuid, $${index + 1}, $${index + 2})`);
        index += 3;
        applied += 1;
      }

      if (!dryRun && values.length) {
        await pool.query(
          `INSERT INTO restaurant_category (restaurant_id, category_id, source, confidence, updated_at)
           SELECT v.restaurant_id, c.id, v.source, ${AI_CONFIDENCE}, now()
           FROM (VALUES ${values.join(', ')})
                AS v(restaurant_id, category_slug, source)
           JOIN category c ON c.slug = v.category_slug AND c.is_active = true
           ON CONFLICT (restaurant_id, category_id) DO NOTHING`,
          params,
        );
      }
      console.log(JSON.stringify({ event: 'batch', dryRun, scanned, applied }));
    }

    if (logId !== null) {
      await pool.query(
        `UPDATE enrichment_log
            SET status = 'completed', finished_at = now(),
                restaurants_scanned = $2, categories_applied = $3
          WHERE id = $1`,
        [logId, scanned, applied],
      );
    }
    console.log(
      JSON.stringify({ event: 'enrichment_completed', dryRun, scanned, categoriesApplied: applied }),
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
    console.error(
      JSON.stringify({ event: 'enrichment_failed', message: String(error) }),
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'enrichment_failed', message: String(error) }));
  process.exitCode = 1;
});

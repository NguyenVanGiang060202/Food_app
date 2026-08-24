// Extracts auditable dish data from restaurant images using an OpenAI-compatible
// vision endpoint. The model is only allowed to transcribe what is visible.

import { Pool } from 'pg';
import { parseMenuImageResult } from '../enrichment/menu-image-extractor';

interface ImageRow {
  id: string;
  restaurant_id: string;
  url: string;
}

interface Options {
  limit: number;
  dryRun: boolean;
  refresh: boolean;
}

const MODEL_SOURCE = 'menu_image:vision:v1';

function parseArgs(argv: string[]): Options {
  let limit = 0;
  let dryRun = false;
  let refresh = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--limit') {
      limit = Number(argv[index + 1]);
      if (!Number.isInteger(limit) || limit < 0)
        throw new Error('--limit must be a non-negative integer.');
    } else if (argv[index] === '--dry-run') {
      dryRun = true;
    } else if (argv[index] === '--refresh') {
      refresh = true;
    }
  }
  return { limit, dryRun, refresh };
}

async function inspectImage(
  baseUrl: string,
  apiKey: string,
  model: string,
  imageUrl: string,
): Promise<unknown> {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You extract restaurant menus from images. Return only JSON: {"isMenu":boolean,"confidence":0..1,"ocrText":"visible text","dishes":[{"name":"exact visible dish name","priceAmount":number|null,"rawPrice":"exact visible price or null"}]}. Set isMenu=false unless the image is clearly a menu or price list. Never infer, translate, complete, or invent dishes. Preserve Vietnamese spelling exactly as visible.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Inspect this restaurant image.' },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
    }),
  });
  if (!response.ok)
    throw new Error(
      `Vision provider returned ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('Vision provider returned an empty response.');
  return JSON.parse(content) as unknown;
}

async function persistResult(
  pool: Pool,
  image: ImageRow,
  model: string,
  result: NonNullable<ReturnType<typeof parseMenuImageResult>>,
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO menu_image_extraction (restaurant_image_id, status, model, confidence, raw_ocr_text, error_message, extracted_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NULL, now(), now())
       ON CONFLICT (restaurant_image_id) DO UPDATE SET status = EXCLUDED.status, model = EXCLUDED.model, confidence = EXCLUDED.confidence, raw_ocr_text = EXCLUDED.raw_ocr_text, error_message = NULL, extracted_at = now(), updated_at = now()`,
      [
        image.id,
        result.isMenu && result.confidence >= 0.65 ? 'completed' : 'not_menu',
        model,
        result.confidence,
        result.ocrText || null,
      ],
    );
    let dishesApplied = 0;
    for (const item of result.dishes) {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM dish WHERE restaurant_id = $1 AND normalized_name = $2 ORDER BY id LIMIT 1`,
        [image.restaurant_id, item.normalizedName],
      );
      let dishId = existing.rows[0]?.id;
      if (!dishId) {
        dishId = (
          await client.query<{ id: string }>(
            `INSERT INTO dish (restaurant_id, name, normalized_name, price_amount, currency_code, status, source, confidence)
             VALUES ($1, $2, $3, $4, $5, 'available', $6, $7) RETURNING id`,
            [
              image.restaurant_id,
              item.name,
              item.normalizedName,
              item.priceAmount,
              item.currencyCode,
              MODEL_SOURCE,
              result.confidence,
            ],
          )
        ).rows[0].id;
      } else {
        await client.query(
          `UPDATE dish SET price_amount = COALESCE(price_amount, $2), currency_code = COALESCE(currency_code, $3), source = CASE WHEN source LIKE 'enrichment:%' THEN $4 ELSE source END, confidence = GREATEST(COALESCE(confidence, 0), $5) WHERE id = $1`,
          [dishId, item.priceAmount, item.currencyCode, MODEL_SOURCE, result.confidence],
        );
      }
      await client.query(
        `INSERT INTO dish_evidence (dish_id, restaurant_image_id, evidence_type, raw_name, raw_price, confidence)
         VALUES ($1, $2, 'menu_image', $3, $4, $5)
         ON CONFLICT (dish_id, restaurant_image_id, evidence_type) DO UPDATE
           SET raw_name = EXCLUDED.raw_name, raw_price = EXCLUDED.raw_price, confidence = EXCLUDED.confidence, verified_at = now()`,
        [dishId, image.id, item.name, item.rawPrice, result.confidence],
      );
      dishesApplied += 1;
    }
    await client.query('COMMIT');
    return dishesApplied;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const { limit, dryRun, refresh } = parseArgs(process.argv.slice(2));
  const baseUrl = (process.env.AI_BASE_URL ?? '').replace(/\/+$/, '');
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_VISION_MODEL ?? process.env.AI_MODEL;
  if (!baseUrl || !apiKey || !model)
    throw new Error('AI_BASE_URL, AI_API_KEY, and AI_VISION_MODEL (or AI_MODEL) are required.');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? 'food_app',
    user: process.env.PGUSER ?? 'food_app',
    password: process.env.PGPASSWORD ?? 'change-me-locally',
  });
  try {
    let sql = `SELECT ri.id, ri.restaurant_id, ri.url FROM restaurant_image ri JOIN restaurant r ON r.id = ri.restaurant_id WHERE ri.status = 'active' AND r.status = 'active'`;
    if (!refresh)
      sql += ` AND NOT EXISTS (SELECT 1 FROM menu_image_extraction mie WHERE mie.restaurant_image_id = ri.id AND mie.status IN ('completed', 'not_menu'))`;
    sql += ' ORDER BY ri.id';
    if (limit > 0) sql += ` LIMIT ${limit}`;
    const images = (await pool.query<ImageRow>(sql)).rows;
    let menus = 0;
    let dishesApplied = 0;
    let failed = 0;
    for (const image of images) {
      try {
        const result = parseMenuImageResult(await inspectImage(baseUrl, apiKey, model, image.url));
        if (!result) throw new Error('Vision provider returned invalid menu JSON.');
        if (result.isMenu && result.confidence >= 0.65) menus += 1;
        if (!dryRun) dishesApplied += await persistResult(pool, image, model, result);
      } catch (error) {
        failed += 1;
        if (!dryRun)
          await pool.query(
            `INSERT INTO menu_image_extraction (restaurant_image_id, status, model, error_message, extracted_at, updated_at) VALUES ($1, 'failed', $2, $3, now(), now()) ON CONFLICT (restaurant_image_id) DO UPDATE SET status = 'failed', model = EXCLUDED.model, error_message = EXCLUDED.error_message, extracted_at = now(), updated_at = now()`,
            [
              image.id,
              model,
              error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
            ],
          );
      }
    }
    console.log(
      JSON.stringify({
        event: 'menu_image_enrichment_completed',
        dryRun,
        scanned: images.length,
        menus,
        dishesApplied,
        failed,
      }),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: 'menu_image_enrichment_failed',
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});

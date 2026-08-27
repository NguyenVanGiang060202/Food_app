// Extracts auditable dish data from restaurant images using an OpenAI-compatible
// vision endpoint. The model is only allowed to transcribe what is visible.

import { Pool } from 'pg';
import { parseMenuImageResult } from '../enrichment/menu-image-extractor';
import { classifyAttributes } from '../enrichment/attribute-classifier';

interface ImageRow {
  id: string;
  restaurant_id: string;
  url: string;
}

interface Options {
  limit: number;
  batchSize: number;
  dryRun: boolean;
  refresh: boolean;
}

const MODEL_SOURCE = 'menu_image:vision:v1';

function parseArgs(argv: string[]): Options {
  let limit = 0;
  let batchSize = 0;
  let dryRun = false;
  let refresh = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--limit') {
      limit = Number(argv[index + 1]);
      if (!Number.isInteger(limit) || limit < 0)
        throw new Error('--limit must be a non-negative integer.');
    } else if (argv[index] === '--batch-size') {
      batchSize = Number(argv[index + 1]);
      if (!Number.isInteger(batchSize) || batchSize < 0)
        throw new Error('--batch-size must be a non-negative integer.');
    } else if (argv[index] === '--dry-run') {
      dryRun = true;
    } else if (argv[index] === '--refresh') {
      refresh = true;
    }
  }
  return { limit, batchSize, dryRun, refresh };
}

function normalizeDishName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePrice(raw: string | undefined): { amount: number | null; raw: string | null } {
  if (!raw) return { amount: null, raw: null };
  const cleaned = raw.replace(/[.,\s]/g, '').trim();
  const match = cleaned.match(/(\d+)\s*(k|000|₫|VND)?$/i);
  if (!match) return { amount: null, raw };
  let amount = Number(match[1]);
  if (match[2] && /k/i.test(match[2])) amount *= 1000;
  return { amount: Number.isFinite(amount) ? amount : null, raw };
}

function parseDishesFromProse(text: string): Array<{ name: string; priceAmount: number | null; rawPrice: string | null }> {
  const dishes: Array<{ name: string; priceAmount: number | null; rawPrice: string | null }> = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const priceMatch = line.match(
      /^(.+?)\s*[-–—:]\s*(\d[\d.,]*\s*(?:k|000|₫|VND)?)\s*$/i,
    );
    if (priceMatch) {
      const name = priceMatch[1].replace(/^[\d•*.\-\s]+/, '').trim();
      if (name.length >= 2 && name.length <= 160) {
        const p = parsePrice(priceMatch[2]);
        dishes.push({ name, priceAmount: p.amount, rawPrice: p.raw });
      }
      continue;
    }
    const bulletMatch = line.match(/^[\d•*.\-]+\s*(.+?)\s*[-–—:]\s*(\d[\d.,]*\s*(?:k|000|₫|VND)?)\s*$/i);
    if (bulletMatch) {
      const name = bulletMatch[1].trim();
      if (name.length >= 2 && name.length <= 160) {
        const p = parsePrice(bulletMatch[2]);
        dishes.push({ name, priceAmount: p.amount, rawPrice: p.raw });
      }
    }
  }
  return dishes;
}

async function callVision(
  baseUrl: string,
  apiKey: string,
  model: string,
  imageDataUrl: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const isCloudflare = /\/ai\/v1\/?$/.test(baseUrl);
  const endpoint = isCloudflare
    ? `${baseUrl.replace(/\/ai\/v1\/?$/, '')}/ai/run/${model}`
    : `${baseUrl}/chat/completions`;
  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        { type: 'text', text: userPrompt },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ],
    },
  ];
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      ...(isCloudflare ? {} : { model }),
      temperature: 0,
      messages,
    }),
  });
  if (!response.ok)
    throw new Error(
      `Vision provider returned ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  const payload = (await response.json()) as {
    result?: { response?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  return payload.result?.response ?? payload.choices?.[0]?.message?.content ?? '';
}

function parseDishNamesFromProse(text: string): string[] {
  const names: string[] = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const cleaned = line
      .replace(/^[\d•*.\-]+\s*/, '')
      .replace(/\s*[-–—:]\s*(none|no price|giá.*|price.*)$/i, '')
      .trim();
    if (cleaned.length >= 2 && cleaned.length <= 160 && !/^(dish|name|food|item)/i.test(cleaned)) {
      names.push(cleaned);
    }
  }
  return names;
}

async function inspectImage(
  baseUrl: string,
  apiKey: string,
  model: string,
  imageUrl: string,
): Promise<unknown> {
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Could not download menu image: HTTP ${imageResponse.status}`);
  }
  const contentType = imageResponse.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
  if (!contentType.startsWith('image/')) {
    throw new Error(`Menu image URL returned non-image content: ${contentType}`);
  }
  const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
  if (imageBytes.length > 20 * 1024 * 1024) {
    throw new Error('Menu image exceeds the 20 MB Vision input limit.');
  }
  const imageDataUrl = `data:${contentType};base64,${imageBytes.toString('base64')}`;

  const classifyPrompt =
    'Classify this restaurant image into ONE of these categories:\n' +
    '- menu: a printed/digital menu, price list, or food ordering card with dish names and prices\n' +
    '- food_photo: a photo of a prepared dish/food (plate, bowl, etc.)\n' +
    '- other: anything else (restaurant exterior, interior, people, logo, etc.)\n' +
    'Answer with ONLY the category word: menu, food_photo, or other';
  const classifyResult = (await callVision(baseUrl, apiKey, model, imageDataUrl, '', classifyPrompt))
    .trim()
    .toLowerCase();

  if (classifyResult.includes('menu')) {
    const ocrPrompt =
      'This image IS a restaurant menu or price list. Extract ALL visible dishes and their prices.\n' +
      'List each dish on its own line in this exact format:\n' +
      'DISH_NAME - PRICE_VND\n' +
      'For example:\n' +
      'Bun bo hue - 45000\n' +
      'Com tam - 35000\n' +
      'Banh mi - 25000\n\n' +
      'Rules:\n' +
      '- Use the EXACT Vietnamese spelling visible on the menu\n' +
      '- Price should be the raw number (45000, not 45k)\n' +
      '- If no price is visible, write: DISH_NAME - none\n' +
      '- Do NOT add descriptions, categories, or explanations\n' +
      '- Do NOT infer or invent dishes not visible\n' +
      '- List EVERY dish you can read, even partial text';
    const ocrText = await callVision(baseUrl, apiKey, model, imageDataUrl, '', ocrPrompt);
    const dishes = parseDishesFromProse(ocrText);
    return {
      isMenu: true,
      confidence: dishes.length > 0 ? 0.85 : 0.5,
      ocrText: ocrText.slice(0, 12_000),
      dishes: dishes.map((d) => ({
        name: d.name,
        normalizedName: normalizeDishName(d.name),
        priceAmount: d.priceAmount,
        currencyCode: 'VND',
        rawPrice: d.rawPrice,
      })),
    };
  }

  if (classifyResult.includes('food_photo')) {
    const dishPrompt =
      'This image shows a prepared food dish. What Vietnamese dish is this?\n' +
      'Answer with ONLY the dish name in Vietnamese, nothing else.\n' +
      'For example: Bún bò huế, Cơm tấm, Phở bò, Bánh mì thịt\n' +
      'If you cannot identify the dish, answer: unknown';
    const dishName = (await callVision(baseUrl, apiKey, model, imageDataUrl, '', dishPrompt)).trim();
    if (dishName && dishName !== 'unknown' && dishName.length >= 2) {
      return {
        isMenu: true,
        confidence: 0.7,
        ocrText: `food_photo: ${dishName}`,
        dishes: [
          {
            name: dishName,
            normalizedName: normalizeDishName(dishName),
            priceAmount: null,
            currencyCode: 'VND',
            rawPrice: null,
          },
        ],
      };
    }
    return { isMenu: false, confidence: 0, ocrText: `food_photo: ${dishName}`, dishes: [] };
  }

  return { isMenu: false, confidence: 0, ocrText: `classify: ${classifyResult}`, dishes: [] };
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
          `UPDATE dish SET price_amount = COALESCE($2, price_amount), currency_code = COALESCE($3, currency_code), source = CASE WHEN source LIKE 'enrichment:%' OR source IS NULL THEN $4 ELSE source END, confidence = GREATEST(COALESCE(confidence, 0), $5) WHERE id = $1`,
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
      for (const attribute of classifyAttributes(item.normalizedName)) {
        await client.query(
          `INSERT INTO dish_attribute (dish_id, attribute_id, source, confidence)
           SELECT $1, fa.id, $3, $4
           FROM food_attribute fa
           WHERE fa.code = $2 AND fa.is_active = true
           ON CONFLICT (dish_id, attribute_id) DO NOTHING`,
          [dishId, attribute.code, MODEL_SOURCE, attribute.confidence],
        );
      }
      dishesApplied += 1;
    }
    if (dishesApplied > 0) {
      // A new menu item changes the restaurant's semantic food profile. Clear
      // the cached profile so the next `enrich:ai` run regenerates it from the
      // newly OCR'd menu instead of silently keeping stale text.
      await client.query(
        `UPDATE restaurant SET semantic_profile = NULL, updated_at = now() WHERE id = $1`,
        [image.restaurant_id],
      );
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
  const { limit, batchSize, dryRun, refresh } = parseArgs(process.argv.slice(2));
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
    sql += ` ORDER BY ri.id`;
    if (batchSize > 0) sql += ` LIMIT ${batchSize}`;
    else if (limit > 0) sql += ` LIMIT ${limit}`;
    const images = (await pool.query<ImageRow>(sql)).rows;
    console.error(JSON.stringify({ event: 'menu_image_enrichment_started', totalImages: images.length, dryRun, refresh }));
    let menus = 0;
    let dishesApplied = 0;
    let failed = 0;
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      try {
        const result = parseMenuImageResult(await inspectImage(baseUrl, apiKey, model, image.url));
        if (!result) throw new Error('Vision provider returned invalid menu JSON.');
        if (result.isMenu && result.confidence >= 0.65) menus += 1;
        if (!dryRun) dishesApplied += await persistResult(pool, image, model, result);
        if ((index + 1) % 100 === 0 || index === images.length - 1) {
          console.error(JSON.stringify({
            event: 'menu_image_progress',
            processed: index + 1,
            total: images.length,
            menus,
            dishesApplied,
            failed,
          }));
        }
      } catch (error) {
        failed += 1;
        console.error(
          JSON.stringify({
            event: 'menu_image_failed',
            imageId: image.id,
            imageUrl: image.url,
            message: error instanceof Error ? error.message : String(error),
          }),
        );
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

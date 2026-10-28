// Extracts auditable dish data from restaurant images using an OpenAI-compatible
// vision endpoint. The model is only allowed to transcribe what is visible.

import { Pool } from 'pg';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { parseMenuImageResult } from '../enrichment/menu-image-extractor';
import { classifyAttributes } from '../enrichment/attribute-classifier';

interface ImageRow {
  id: string;
  restaurant_id: string;
  url: string;
  source_url: string | null;
  cached_object_key: string | null;
  cached_content_type: string | null;
  is_cover?: boolean;
  sort_order?: number;
  alt_text?: string | null;
}

interface Options {
  limit: number;
  batchSize: number;
  concurrency: number;
  menuOnly: boolean;
  dryRun: boolean;
  refresh: boolean;
  retryFailed: boolean;
  restaurantIds: string[];
  targeted: boolean;
  targetDishes: string[];
  perRestaurant: number;
  capPerRestaurant: number;
  imageIds: string[];
  selectionFile: string | null;
}

const MODEL_SOURCE = 'menu_image:vision:v1';

function resolveVisionBaseUrl(raw: string): string {
  // `.env` is shared with the Docker backend, where host.docker.internal is
  // the correct route to Ollama on the host. The same hostname is not
  // resolvable by a crawler started directly from Windows, so make the local
  // operator workflow use the native Ollama endpoint automatically.
  if (process.platform !== 'linux' && /^https?:\/\/host\.docker\.internal(?=[:/]|$)/i.test(raw)) {
    return raw.replace('host.docker.internal', 'localhost');
  }
  return raw;
}

function parseArgs(argv: string[]): Options {
  let limit = 0;
  let batchSize = 0;
  let concurrency = 1;
  let menuOnly = false;
  let dryRun = false;
  let refresh = false;
  let retryFailed = false;
  const restaurantIds: string[] = [];
  let targeted = false;
  const targetDishes: string[] = [];
  let perRestaurant = 3;
  let capPerRestaurant = 0;
  const imageIds: string[] = [];
  let selectionFile: string | null = null;
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
    } else if (argv[index] === '--retry-failed') {
      retryFailed = true;
    } else if (argv[index] === '--restaurant-id') {
      const id = argv[index + 1];
      if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('--restaurant-id must be a UUID.');
      restaurantIds.push(id);
    } else if (argv[index] === '--concurrency') {
      concurrency = Number(argv[index + 1]);
      if (!Number.isInteger(concurrency) || concurrency < 1)
        throw new Error('--concurrency must be a positive integer.');
    } else if (argv[index] === '--menu-only') {
      menuOnly = true;
    } else if (argv[index] === '--targeted') {
      targeted = true;
    } else if (argv[index] === '--dish') {
      const dish = argv[index + 1]?.trim();
      if (dish) targetDishes.push(dish);
    } else if (argv[index] === '--per-restaurant') {
      perRestaurant = Number(argv[index + 1]);
      if (!Number.isInteger(perRestaurant) || perRestaurant < 1)
        throw new Error('--per-restaurant must be a positive integer.');
    } else if (argv[index] === '--cap-per-restaurant') {
      capPerRestaurant = Number(argv[index + 1]);
      if (!Number.isInteger(capPerRestaurant) || capPerRestaurant < 1)
        throw new Error('--cap-per-restaurant must be a positive integer.');
    } else if (argv[index] === '--image-id') {
      const id = argv[index + 1];
      if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('--image-id must be a UUID.');
      imageIds.push(id);
    } else if (argv[index] === '--selection-file') {
      selectionFile = argv[index + 1] ?? null;
    }
  }
  if (targeted && targetDishes.length === 0)
    throw new Error('--targeted requires at least one --dish.');
  return {
    limit,
    batchSize,
    concurrency,
    menuOnly,
    dryRun,
    refresh,
    retryFailed,
    restaurantIds,
    targeted,
    targetDishes,
    perRestaurant,
    capPerRestaurant,
    imageIds,
    selectionFile,
  };
}

function normalizeDishName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function targetTextClause(column: string, parameter: string): string {
  // Tone marks are semantically important here: cháo is not chảo. Keep the
  // accented comparison primary and only use unaccent for ASCII targets.
  return `(
    lower(${column}) LIKE '%' || lower(${parameter}) || '%'
    OR (${parameter} !~ '[áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]'
        AND lower(unaccent(${column})) LIKE '%' || lower(unaccent(${parameter})) || '%')
  )`;
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

function parseDishesFromProse(
  text: string,
): Array<{ name: string; priceAmount: number | null; rawPrice: string | null }> {
  const dishes: Array<{ name: string; priceAmount: number | null; rawPrice: string | null }> = [];
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const priceMatch = line.match(/^(.+?)\s*[-–—:]\s*(\d[\d.,]*\s*(?:k|000|₫|VND)?)\s*$/i);
    if (priceMatch) {
      const name = priceMatch[1].replace(/^[\d•*.\-\s]+/, '').trim();
      if (name.length >= 2 && name.length <= 160) {
        const p = parsePrice(priceMatch[2]);
        dishes.push({ name, priceAmount: p.amount, rawPrice: p.raw });
      }
      continue;
    }
    const bulletMatch = line.match(
      /^[\d•*.\-]+\s*(.+?)\s*[-–—:]\s*(\d[\d.,]*\s*(?:k|000|₫|VND)?)\s*$/i,
    );
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

function compactMenuOcrText(text: string): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^(dish[_ ]?name|price[_ ]?vnd|name\s*[-:]?\s*price)/i.test(line)) continue;
    const key = line
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  return lines.join('\n').slice(0, 12_000);
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
  const isSiliconFlow = /siliconflow\.(cn|com)/i.test(baseUrl);
  const endpoint = isCloudflare
    ? `${baseUrl.replace(/\/ai\/v1\/?$/, '')}/ai/run/${model}`
    : `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({
    role: 'user',
    content: [
      { type: 'text', text: userPrompt },
      { type: 'image_url', image_url: { url: imageDataUrl } },
    ],
  });
  const body: Record<string, unknown> = {
    temperature: 0,
    // Local vision models can keep generating indefinitely when the provider
    // default is large. Menu OCR only needs a bounded list of dish rows; a
    // hard cap prevents one bad image from monopolizing Ollama for minutes.
    max_tokens: Number(process.env.AI_MAX_OUTPUT_TOKENS ?? (isCloudflare || isSiliconFlow ? 4096 : 768)),
    stream: false,
    messages,
  };
  if (!isCloudflare) body.model = model;
  if (isSiliconFlow) {
    body.max_tokens = 4096;
    body.stream = false;
  }
  const timeoutMs = Math.max(15_000, Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 90_000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Vision provider timed out after ${timeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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

async function prepareVisionImage(
  browser: Browser | undefined,
  imageDataUrl: string,
): Promise<string> {
  // Small menu images do not benefit enough from a browser round-trip to make
  // preprocessing worthwhile. Keep the original bytes for those inputs.
  if (!browser || imageDataUrl.length < 2_000_000) return imageDataUrl;
  const configuredDimension = Number(process.env.AI_MAX_IMAGE_DIMENSION ?? 1600);
  const maxDimension = Math.min(Math.max(Number.isFinite(configuredDimension) ? configuredDimension : 1600, 768), 3000);
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.setContent(`<img id="source" src="${imageDataUrl}" />`, { waitUntil: 'load' });
    await page.locator('#source').waitFor({ state: 'visible', timeout: 15_000 });
    const resized = await page.evaluate((dimension) => {
      const image = document.querySelector<HTMLImageElement>('#source');
      if (!image || !image.naturalWidth || !image.naturalHeight) return null;
      const scale = Math.min(1, dimension / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.86);
    }, maxDimension);
    return resized && resized.startsWith('data:image/') ? resized : imageDataUrl;
  } catch {
    // Preprocessing is an optimization only. If the browser cannot decode a
    // format, Vision should still receive the original cached bytes.
    return imageDataUrl;
  } finally {
    await context.close().catch(() => undefined);
  }
}

function parseDishNamesFromProse(text: string): string[] {
  const names: string[] = [];
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
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
  browser?: Browser,
  sourceUrl?: string | null,
  cachedFile?: string,
  cachedContentType = 'image/jpeg',
  knownMenu = false,
): Promise<unknown> {
  if (cachedFile) {
    let cachedImageDataUrl: string | undefined;
    try {
      await access(cachedFile);
      const bytes = await readFile(cachedFile);
      if (bytes.length > 20 * 1024 * 1024) throw new Error('Cached menu image exceeds the 20 MB Vision input limit.');
      cachedImageDataUrl = `data:${cachedContentType};base64,${bytes.toString('base64')}`;
    } catch (error) {
      // A prior worker may have recorded a cache key before the file was
      // copied/migrated. Fall back to the current CDN URL instead of losing a
      // potentially useful menu image forever.
      if (error instanceof Error && error.message.includes('20 MB')) throw error;
    }
    // Keep Vision/Ollama failures outside the cache-read fallback. A timeout
    // here means the cached bytes were valid but inference failed; retrying the
    // old CDN URL only wastes time and produces misleading "fetch failed"
    // records for an otherwise healthy local cache.
    if (cachedImageDataUrl) {
      return processImage(
        baseUrl,
        apiKey,
        model,
        await prepareVisionImage(browser, cachedImageDataUrl),
        knownMenu,
      );
    }
  }
  const maxRetries = 3;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let imageResponse: Response;
    try {
      imageResponse = await fetch(imageUrl, {
        signal: AbortSignal.timeout(30000),
        headers: {
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          Referer: 'https://www.google.com/maps/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        },
      });
    } catch (fetchErr) {
      if (attempt < maxRetries) {
        const waitMs = Math.min(3000 * Math.pow(2, attempt), 30000);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw new Error(
        `Could not download menu image: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
      );
    }
    if (imageResponse.ok) {
      const contentType = imageResponse.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
      if (!contentType.startsWith('image/')) {
        throw new Error(`Menu image URL returned non-image content: ${contentType}`);
      }
      const imageBytes = Buffer.from(await imageResponse.arrayBuffer());
      if (imageBytes.length > 20 * 1024 * 1024) {
        throw new Error('Menu image exceeds the 20 MB Vision input limit.');
      }
      const imageDataUrl = `data:${contentType};base64,${imageBytes.toString('base64')}`;
      // ... rest of function
      return await processImage(
        baseUrl,
        apiKey,
        model,
        await prepareVisionImage(browser, imageDataUrl),
        knownMenu,
      );
    }
    if ((imageResponse.status === 403 || imageResponse.status === 404) && browser && sourceUrl) {
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        locale: 'vi-VN',
        extraHTTPHeaders: { Referer: 'https://www.google.com/maps/' },
      });
      const page = await context.newPage();
      try {
        const response = await page.goto(sourceUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });
        if (response?.ok()) {
          await page.waitForTimeout(3000);
          const index = await page.evaluate(
            (target) =>
              Array.from(document.images).findIndex(
                (img) => img.currentSrc === target || img.src === target,
              ),
            imageUrl,
          );
          if (index >= 0) {
            const imageBytes = await page.locator('img').nth(index).screenshot({ type: 'png' });
            return await processImage(
              baseUrl,
              apiKey,
              model,
              await prepareVisionImage(
                browser,
                `data:image/png;base64,${imageBytes.toString('base64')}`,
              ),
              knownMenu,
            );
          }
        }
      } finally {
        await context.close();
      }
    }
    if (attempt < maxRetries) {
      const waitMs = Math.min(2000 * Math.pow(2, attempt), 30000);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    throw new Error(`Could not download menu image: HTTP ${imageResponse.status}`);
  }
  throw lastError;
}

async function processImage(
  baseUrl: string,
  apiKey: string,
  model: string,
  imageDataUrl: string,
  knownMenu = false,
): Promise<unknown> {
  const classifyPrompt =
    'Classify this restaurant image into ONE of these categories:\n' +
    '- menu: a printed/digital menu, price list, or food ordering card with dish names and prices\n' +
    '- food_photo: a photo of a prepared dish/food (plate, bowl, etc.)\n' +
    '- other: anything else (restaurant exterior, interior, people, logo, etc.)\n' +
    'Answer with ONLY the category word: menu, food_photo, or other';
  const classifyResult = knownMenu
    ? 'menu'
    : (
        await callVision(baseUrl, apiKey, model, imageDataUrl, '', classifyPrompt)
      )
        .trim()
        .toLowerCase();

  if (classifyResult.includes('menu')) {
    const ocrPrompt =
      'This image IS a restaurant menu or price list. Transcribe ONLY clearly readable dish rows and prices.\n' +
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
      '- Maximum 20 rows. Omit blurry or uncertain rows instead of guessing.\n' +
      '- Never repeat words or invent variants to fill the list.\n' +
      '- Do not output section headings such as "Món thêm" or "Thức uống" as dishes.';
    const rawOcrText = await callVision(baseUrl, apiKey, model, imageDataUrl, '', ocrPrompt);
    const ocrText = compactMenuOcrText(rawOcrText);
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
    const dishName = (
      await callVision(baseUrl, apiKey, model, imageDataUrl, '', dishPrompt)
    ).trim();
    if (dishName && dishName !== 'unknown' && dishName.length >= 2) {
      return {
        // A plated-food photo is useful for visual audit, but it is not a
        // menu. Do not turn the classifier's dish guess into purchasable
        // menu evidence.
        isMenu: false,
        confidence: 0,
        ocrText: `food_photo: ${dishName}`,
        dishes: [],
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
    // A manual/first-party menu is the trust boundary for exact-dish
    // recommendation. Re-running Ollama must never downgrade it or remove
    // the operator-curated evidence attached to the same image.
    const existingExtraction = await client.query<{ model: string | null; has_curated_evidence: boolean }>(
      `SELECT mie.model,
              EXISTS (
                SELECT 1
                FROM dish_evidence de
                JOIN dish d ON d.id = de.dish_id
                WHERE de.restaurant_image_id = mie.restaurant_image_id
                  AND de.evidence_type = 'menu_image'
                  AND d.source = 'menu_image:curated'
              ) AS has_curated_evidence
       FROM menu_image_extraction mie
       WHERE restaurant_image_id = $1
       FOR UPDATE`,
      [image.id],
    );
    const existingModel = existingExtraction.rows[0]?.model ?? '';
    if (
      existingModel === 'website:menu:v1' ||
      existingModel === 'website:menu-image-curated:v1' ||
      existingModel === 'google_maps:menu-curated:v1' ||
      existingExtraction.rows[0]?.has_curated_evidence
    ) {
      await client.query('COMMIT');
      return 0;
    }

    // Refreshing OCR replaces the non-trusted vision facts for this image.
    // Without this cleanup, stale hallucinated rows survive a re-OCR run and
    // continue to leak into generic dish/category retrieval. Curated rows are
    // intentionally preserved even if an older extraction row was overwritten.
    await client.query(
      `DELETE FROM dish_evidence de
       USING dish d
       WHERE de.dish_id = d.id
         AND de.restaurant_image_id = $1
         AND de.evidence_type = 'menu_image'
         AND d.source = $2`,
      [image.id, MODEL_SOURCE],
    );
    await client.query(
      `UPDATE dish d
       SET status = 'unavailable', confidence = LEAST(COALESCE(d.confidence, 0), 0.1)
       WHERE d.source = $1
         AND d.status = 'available'
         AND NOT EXISTS (
           SELECT 1
           FROM dish_evidence de
           JOIN menu_image_extraction mie ON mie.restaurant_image_id = de.restaurant_image_id
           WHERE de.dish_id = d.id
             AND de.evidence_type = 'menu_image'
             AND mie.status = 'completed'
             AND mie.model IN ('website:menu:v1', 'website:menu-image-curated:v1', 'google_maps:menu-curated:v1')
         )`,
      [MODEL_SOURCE],
    );
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
    // A vision response may contain guessed dish rows even when the image was
    // classified as food_photo/other. Never persist those guesses as menu
    // facts: only a completed, sufficiently confident menu extraction can
    // create purchasable dish evidence.
    const trustedMenu = result.isMenu && result.confidence >= 0.65;
    if (!trustedMenu) {
      await client.query('COMMIT');
      return 0;
    }
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
          `UPDATE dish SET price_amount = COALESCE($2, price_amount), currency_code = COALESCE($3, currency_code), status = 'available', source = CASE WHEN source LIKE 'enrichment:%' OR source IS NULL THEN $4 ELSE source END, confidence = GREATEST(COALESCE(confidence, 0), $5) WHERE id = $1`,
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
  const {
    limit,
    batchSize,
    concurrency,
    menuOnly,
    dryRun,
    refresh,
    retryFailed,
    restaurantIds,
    targeted,
    targetDishes,
    perRestaurant,
    capPerRestaurant,
    imageIds: parsedImageIds,
    selectionFile,
  } = parseArgs(process.argv.slice(2));
  const imageIds = [...parsedImageIds];
  if (selectionFile) {
    const selected = await readFile(selectionFile, 'utf8');
    for (const line of selected.split(/\r?\n/)) {
      const id = line.replace(/#.*/, '').trim();
      if (!id) continue;
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error(`Invalid image UUID in selection file: ${id}`);
      imageIds.push(id);
    }
  }
  const baseUrl = resolveVisionBaseUrl((process.env.AI_BASE_URL ?? '').replace(/\/+$/, ''));
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
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-gpu', '--no-sandbox'],
  });
  try {
    // The CLI runs from the crawler workspace, while the shared cache lives at
    // the repository root. Keep the default aligned with cache-restaurant-images
    // so cached files are actually reusable by OCR.
    const storageRoot = process.env.IMAGE_STORAGE_DIR ?? join(process.cwd(), '..', 'storage', 'restaurant-images');
    const values: unknown[] = [];
    let sql = `SELECT ri.id, ri.restaurant_id, ri.url, ri.cached_object_key, ri.cached_content_type,
      ri.is_cover, ri.sort_order, ri.alt_text, source.source_url
      FROM restaurant_image ri
      JOIN restaurant r ON r.id = ri.restaurant_id
      LEFT JOIN LATERAL (
        SELECT rs.source_url
        FROM restaurant_source rs
        WHERE rs.restaurant_id = r.id AND rs.status = 'active' AND rs.source_url IS NOT NULL
        ORDER BY rs.last_seen_at DESC NULLS LAST
        LIMIT 1
      ) source ON true
      WHERE ri.status = 'active' AND r.status = 'active' AND ri.cached_object_key IS NOT NULL`;
    if (restaurantIds.length) {
      values.push(restaurantIds);
      sql += ` AND ri.restaurant_id = ANY($${values.length}::uuid[])`;
    }
    if (imageIds.length) {
      values.push([...new Set(imageIds)]);
      sql += ` AND ri.id = ANY($${values.length}::uuid[])`;
    }
    if (targeted) {
      values.push(targetDishes);
      const dishParam = `$${values.length}::text[]`;
      sql += ` AND (
        EXISTS (SELECT 1 FROM unnest(${dishParam}) AS target_dish WHERE ${targetTextClause('r.name', 'target_dish')})
        OR EXISTS (
          SELECT 1
          FROM restaurant_source target_source
          WHERE target_source.restaurant_id = r.id
            AND target_source.status = 'active'
            AND EXISTS (SELECT 1 FROM unnest(${dishParam}) AS target_dish WHERE ${targetTextClause("COALESCE(target_source.raw_data->>'query', '')", 'target_dish')})
        )
        OR EXISTS (
          SELECT 1
          FROM dish target_dish_row
          WHERE target_dish_row.restaurant_id = r.id
            AND target_dish_row.status = 'available'
            AND lower(unaccent(target_dish_row.normalized_name)) = ANY (
              SELECT lower(unaccent(normalize_target_dish)) FROM unnest(${dishParam}) AS normalize_target_dish
            )
        )
      )`;
    }
    if (menuOnly) {
      // Prefer operator-supplied and first-party menu candidates. The old
      // Google Maps marker was frequently attached to ordinary food photos;
      // those images are useful for visual search but are not good OCR input.
      sql += ` AND (
        ri.alt_text ILIKE '%local-menu%'
        OR ri.alt_text ILIKE '%website menu%'
        OR ri.alt_text ILIKE '%Google Maps menu tab%'
        OR (
          (ri.alt_text ILIKE '%menu%' OR ri.alt_text ILIKE '%thực đơn%')
        )
      )`;
    }
    if (!refresh && retryFailed)
      sql += ` AND EXISTS (SELECT 1 FROM menu_image_extraction mie WHERE mie.restaurant_image_id = ri.id AND mie.status = 'failed')`;
    else if (!refresh)
      sql += ` AND NOT EXISTS (SELECT 1 FROM menu_image_extraction mie WHERE mie.restaurant_image_id = ri.id AND mie.status IN ('completed', 'not_menu', 'failed'))`;
    const restaurantCap = capPerRestaurant > 0 ? capPerRestaurant : targeted ? perRestaurant : 0;
    if (restaurantCap > 0) {
      sql = `WITH targeted_images AS (${sql}), ranked AS (
        SELECT targeted_images.*,
               row_number() OVER (
                 PARTITION BY targeted_images.restaurant_id
                 ORDER BY CASE WHEN targeted_images.alt_text ILIKE '%menu%' OR targeted_images.alt_text ILIKE '%thực đơn%' THEN 0 ELSE 1 END,
                          targeted_images.is_cover DESC,
                          targeted_images.sort_order,
                          targeted_images.id
               ) AS targeted_rank
        FROM targeted_images
      )
      SELECT id, restaurant_id, url, cached_object_key, cached_content_type, source_url, is_cover, sort_order, alt_text
      FROM ranked
      WHERE targeted_rank <= ${restaurantCap}
      ORDER BY restaurant_id, targeted_rank`;
    } else {
      sql += ` ORDER BY ri.id`;
    }
    if (batchSize > 0) sql += ` LIMIT ${batchSize}`;
    else if (limit > 0) sql += ` LIMIT ${limit}`;
    const images = (await pool.query<ImageRow>(sql, values)).rows;
    console.error(
      JSON.stringify({
        event: 'menu_image_enrichment_started',
        totalImages: images.length,
        dryRun,
        refresh,
        concurrency,
      }),
    );
    let menus = 0;
    let dishesApplied = 0;
    let failed = 0;
    let processed = 0;
    const delayMs = Number(process.env.AI_DELAY_MS ?? '500');

    async function processOne(image: ImageRow): Promise<void> {
      const cachedFile = image.cached_object_key ? join(storageRoot, image.cached_object_key) : undefined;
      try {
        const result = parseMenuImageResult(
          await inspectImage(baseUrl, apiKey!, model!, image.url, browser, image.source_url, cachedFile, image.cached_content_type ?? 'image/jpeg', Boolean(image.alt_text && /menu|thực đơn/i.test(image.alt_text))),
        );
        if (!result) throw new Error('Vision provider returned invalid menu JSON.');
        if (result.isMenu && result.confidence >= 0.65) menus += 1;
        if (!dryRun) dishesApplied += await persistResult(pool, image, model!, result);
      } catch (error) {
        failed += 1;
        console.error(
          JSON.stringify({
            event: 'menu_image_failed',
            imageId: image.id,
            imageUrl: image.url,
            input: cachedFile ? 'cached_file' : 'cdn_fallback',
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
      } finally {
        processed += 1;
        if (processed % 100 === 0 || processed === images.length) {
          console.error(
            JSON.stringify({
              event: 'menu_image_progress',
              processed,
              total: images.length,
              menus,
              dishesApplied,
              failed,
            }),
          );
        }
      }
    }

    if (concurrency <= 1) {
      for (let index = 0; index < images.length; index += 1) {
        await processOne(images[index]);
        if (delayMs > 0 && index < images.length - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    } else {
      const queue = [...images];
      const running = new Set<Promise<void>>();
      while (queue.length > 0 || running.size > 0) {
        while (running.size < concurrency && queue.length > 0) {
          const image = queue.shift()!;
          const p = processOne(image).then(() => {
            running.delete(p);
          });
          running.add(p);
          if (delayMs > 0 && queue.length > 0) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }
        if (running.size > 0) {
          await Promise.race(running);
        }
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
    await browser.close();
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

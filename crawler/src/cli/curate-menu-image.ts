// Promote operator-verified rows from a cached menu image into trusted exact
// recommendation evidence. OCR remains raw/auditable; this command is the
// explicit trust boundary for Google Maps menu photos.

import { Pool } from 'pg';

type Entry = { name: string; price: number | null; rawPrice: string | null; attributes: string[] };
type OfficialPdf = { url: string; page: number };
type OfficialImage = { url: string; sha256: string };

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parsePrice(raw: string | undefined): { amount: number | null; raw: string | null } {
  if (!raw || !raw.trim()) return { amount: null, raw: null };
  const cleaned = raw.trim().replace(/[.,\s]/g, '');
  const match = cleaned.match(/^(\d+)(k|000|₫|vnd)?$/i);
  if (!match) throw new Error(`Invalid price: ${raw}`);
  let amount = Number(match[1]);
  if (/k/i.test(match[2] ?? '')) amount *= 1000;
  return { amount, raw: raw.trim() };
}

export function parseArgs(argv: string[]): { restaurantId: string; imageId: string; entries: Entry[]; officialPdf: OfficialPdf | null; officialImage: OfficialImage | null } {
  let restaurantId = '';
  let imageId = '';
  let officialPdfUrl = '';
  let officialPdfPage = 0;
  let officialImageUrl = '';
  let officialImageSha256 = '';
  const entries: Entry[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--restaurant-id') restaurantId = argv[++index] ?? '';
    else if (arg === '--image-id') imageId = argv[++index] ?? '';
    else if (arg === '--official-pdf-url') officialPdfUrl = argv[++index] ?? '';
    else if (arg === '--official-pdf-page') officialPdfPage = Number(argv[++index]);
    else if (arg === '--official-menu-image-url') officialImageUrl = argv[++index] ?? '';
    else if (arg === '--official-menu-image-sha256') officialImageSha256 = argv[++index] ?? '';
    else if (arg === '--entry') {
      const raw = argv[++index] ?? '';
      const split = raw.split('|');
      const name = split[0]?.trim() ?? '';
      if (name.length < 2) throw new Error('--entry must be "dish name|price"; price may be empty.');
      if (split.length > 3) throw new Error('--entry must be "dish name|price|attribute1,attribute2".');
      const parsed = parsePrice(split[1]);
      const attributes = (split[2] ?? '').split(',').map((value) => normalize(value)).filter(Boolean);
      entries.push({ name, price: parsed.amount, rawPrice: parsed.raw, attributes });
    }
  }
  if (!/^[0-9a-f-]{36}$/i.test(restaurantId)) throw new Error('--restaurant-id must be a UUID.');
  if (!/^[0-9a-f-]{36}$/i.test(imageId)) throw new Error('--image-id must be a UUID.');
  if (!entries.length) throw new Error('Provide at least one --entry "dish name|price|optional attributes".');
  if (Boolean(officialImageUrl) !== Boolean(officialImageSha256)) throw new Error('Official menu image requires both URL and SHA-256.');
  if (officialImageUrl && (officialPdfUrl || officialPdfPage)) throw new Error('Provide only one official menu source.');
  if (officialPdfUrl || officialPdfPage) {
    let url: URL;
    try { url = new URL(officialPdfUrl); } catch { throw new Error('Provide a valid --official-pdf-url.'); }
    if (url.protocol !== 'https:' || !url.pathname.toLowerCase().endsWith('.pdf') || !Number.isInteger(officialPdfPage) || officialPdfPage < 1 || officialPdfPage > 200) {
      throw new Error('Official PDF evidence requires an HTTPS .pdf URL and page number 1..200.');
    }
  }
  let officialImage: OfficialImage | null = null;
  if (officialImageUrl) {
    let url: URL;
    try { url = new URL(officialImageUrl); } catch { throw new Error('Provide a valid --official-menu-image-url.'); }
    if (url.protocol !== 'https:' || !/\.(?:png|jpe?g|webp)$/i.test(url.pathname)) {
      throw new Error('Official menu image evidence requires an HTTPS PNG, JPEG or WebP URL.');
    }
    if (!/^[0-9a-f]{64}$/i.test(officialImageSha256)) throw new Error('Official menu image SHA-256 must be 64 hex characters.');
    officialImage = { url: officialImageUrl, sha256: officialImageSha256.toLowerCase() };
  }
  return { restaurantId, imageId, entries, officialPdf: officialPdfUrl ? { url: officialPdfUrl, page: officialPdfPage } : null, officialImage };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const model = options.officialImage
    ? 'website:menu-image-curated:v1'
    : options.officialPdf ? 'website:menu:v1' : 'google_maps:menu-curated:v1';
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const image = await client.query<{ restaurant_id: string; cached_object_key: string | null; cached_content_hash: string | null; alt_text: string | null; restaurant_name: string; raw_ocr_text: string | null }>(
      `SELECT ri.restaurant_id, ri.cached_object_key, ri.cached_content_hash, ri.alt_text, r.name AS restaurant_name,
              mie.raw_ocr_text
       FROM restaurant_image ri JOIN restaurant r ON r.id = ri.restaurant_id
       LEFT JOIN menu_image_extraction mie ON mie.restaurant_image_id = ri.id
       WHERE ri.id = $1 AND ri.restaurant_id = $2 AND ri.status = 'active' AND r.status = 'active'`,
      [options.imageId, options.restaurantId],
    );
    if (!image.rows[0]) throw new Error('Active restaurant image was not found for this restaurant.');
    if (!image.rows[0].cached_object_key) throw new Error('Image is not cached locally; cache it before curating.');
    if (options.officialImage && image.rows[0].cached_content_hash?.toLowerCase() !== options.officialImage.sha256) {
      throw new Error('Cached image SHA-256 does not match the reviewed official menu image.');
    }

    // Put the visually verified lines first for exact matching, but retain the
    // original OCR for audit and for future (still untrusted) discovery.
    const originalOcr = image.rows[0].raw_ocr_text?.split(/\r?\n/) ?? [];
    const rawOcrText = [...new Set([
      ...(options.officialPdf ? [`Official first-party PDF menu: ${options.officialPdf.url}#page=${options.officialPdf.page}`] : []),
      ...(options.officialImage ? [`Official first-party menu image: ${options.officialImage.url}`] : []),
      ...options.entries.flatMap((entry) => [
        `${entry.name} - ${entry.rawPrice ?? 'none'}`,
        normalize(entry.name),
      ]),
      ...originalOcr,
    ].map((line) => line.trim()).filter(Boolean))].join('\n').slice(0, 12_000);
    await client.query(
      `INSERT INTO menu_image_extraction
         (restaurant_image_id, status, model, confidence, raw_ocr_text, error_message, extracted_at, updated_at)
       VALUES ($1, 'completed', $3, 0.98, $2, NULL, now(), now())
       ON CONFLICT (restaurant_image_id) DO UPDATE SET
         status='completed', model=EXCLUDED.model, confidence=0.98,
         raw_ocr_text=EXCLUDED.raw_ocr_text, error_message=NULL, extracted_at=now(), updated_at=now()`,
      [options.imageId, rawOcrText, model],
    );
    if (options.officialPdf) {
      await client.query(
        `UPDATE restaurant_image SET alt_text=$2 WHERE id=$1`,
        [options.imageId, `Operator-reviewed official PDF menu page ${options.officialPdf.page}: ${options.officialPdf.url}`],
      );
    }
    if (options.officialImage) {
      await client.query(
        `UPDATE restaurant_image SET alt_text=$2 WHERE id=$1`,
        [options.imageId, `Operator-reviewed official menu image: ${options.officialImage.url}`],
      );
    }

    // Curation is a replacement set for this image, not an append-only
    // operation. Remove older manually curated rows that are no longer in the
    // operator's verified list, while leaving evidence from other images
    // untouched.
    const normalizedEntries = options.entries.map((entry) => normalize(entry.name));
    await client.query(
      `DELETE FROM dish_evidence de
       USING dish d
       WHERE de.dish_id = d.id
         AND de.restaurant_image_id = $1
         AND de.evidence_type = 'menu_image'
         AND d.source = 'menu_image:curated'
         AND NOT (d.normalized_name = ANY($2::text[]))`,
      [options.imageId, normalizedEntries],
    );
    // Vision evidence stays available for audit; its source is not trusted by
    // exact-dish retrieval and must not be silently promoted with this image.
    await client.query(
      `UPDATE dish d
       SET status = 'unavailable', confidence = LEAST(COALESCE(d.confidence, 0), 0.1)
       WHERE d.source = 'menu_image:curated'
         AND d.restaurant_id = $1
         AND d.status = 'available'
         AND NOT EXISTS (
           SELECT 1 FROM dish_evidence de
           JOIN menu_image_extraction mie ON mie.restaurant_image_id = de.restaurant_image_id
           WHERE de.dish_id = d.id
             AND de.evidence_type = 'menu_image'
             AND mie.status = 'completed'
             AND mie.model IN ('website:menu:v1', 'website:menu-image-curated:v1', 'google_maps:menu-curated:v1')
        )`,
      [options.restaurantId],
    );

    for (const entry of options.entries) {
      const normalized = normalize(entry.name);
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM dish WHERE restaurant_id=$1 AND normalized_name=$2 ORDER BY id LIMIT 1`,
        [options.restaurantId, normalized],
      );
      let dishId = existing.rows[0]?.id;
      if (!dishId) {
        dishId = (await client.query<{ id: string }>(
          `INSERT INTO dish (restaurant_id, name, normalized_name, price_amount, currency_code, status, source, confidence)
           VALUES ($1,$2,$3,$4,'VND','available','menu_image:curated',0.98) RETURNING id`,
          [options.restaurantId, entry.name, normalized, entry.price],
        )).rows[0].id;
      } else {
        await client.query(
          `UPDATE dish SET name=$2, price_amount=COALESCE($3,price_amount), currency_code='VND', status='available', source='menu_image:curated', confidence=GREATEST(COALESCE(confidence,0),0.98) WHERE id=$1`,
          [dishId, entry.name, entry.price],
        );
      }
      await client.query(
        `INSERT INTO dish_evidence (dish_id, restaurant_image_id, evidence_type, raw_name, raw_price, confidence)
         VALUES ($1,$2,'menu_image',$3,$4,0.98)
         ON CONFLICT (dish_id, restaurant_image_id, evidence_type) DO UPDATE SET raw_name=EXCLUDED.raw_name, raw_price=EXCLUDED.raw_price, confidence=0.98, verified_at=now()`,
        [dishId, options.imageId, entry.name, entry.rawPrice],
      );
      // Optional operator-reviewed attributes are inferred from the visible
      // preparation/name, never inherited from the untrusted vision OCR.
      for (const attribute of entry.attributes) {
        const inserted = await client.query(
          `INSERT INTO dish_attribute (dish_id, attribute_id, source, confidence)
           SELECT $1, fa.id, 'operator:menu-derived', 0.85
           FROM food_attribute fa WHERE fa.normalized = $2 AND fa.is_active = true
           ON CONFLICT (dish_id, attribute_id) DO UPDATE SET
             source = EXCLUDED.source, confidence = GREATEST(COALESCE(dish_attribute.confidence, 0), EXCLUDED.confidence)`,
          [dishId, attribute],
        );
        if (inserted.rowCount !== 1) throw new Error(`Unknown active food attribute: ${attribute}`);
      }
    }
    await client.query(`UPDATE restaurant SET semantic_profile=NULL, updated_at=now() WHERE id=$1`, [options.restaurantId]);
    await client.query('COMMIT');
    console.log(JSON.stringify({ event: 'menu_image_curated', restaurantId: options.restaurantId, restaurant: image.rows[0].restaurant_name, imageId: options.imageId, entries: options.entries }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv.some((argument) => /curate-menu-image(?:\.ts|\.js)?$/.test(argument))) {
  void main().catch((error) => { console.error(JSON.stringify({ event: 'menu_image_curation_failed', message: error instanceof Error ? error.message : String(error) })); process.exitCode = 1; });
}

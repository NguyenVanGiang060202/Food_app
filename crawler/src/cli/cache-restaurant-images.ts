import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Pool } from 'pg';

type ImageRow = { id: string; url: string; is_cover: boolean; sort_order: number };
type Options = { limit: number; concurrency: number; force: boolean; retryFailed: boolean; menuOnly: boolean; restaurantIds: string[] };

function args(argv: string[]): Options {
  let limit = 0;
  let concurrency = 6;
  let force = false;
  let retryFailed = false;
  let menuOnly = false;
  const restaurantIds: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--limit') limit = Math.max(0, Number(argv[++i]));
    else if (argv[i] === '--concurrency') concurrency = Math.min(16, Math.max(1, Number(argv[++i])));
    else if (argv[i] === '--force') force = true;
    else if (argv[i] === '--retry-failed') retryFailed = true;
    else if (argv[i] === '--menu-only') menuOnly = true;
    else if (argv[i] === '--restaurant-id') {
      const id = argv[++i];
      if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid --restaurant-id.');
      restaurantIds.push(id);
    }
  }
  if (!Number.isInteger(limit) || !Number.isInteger(concurrency)) throw new Error('Invalid cache options.');
  return { limit, concurrency, force, retryFailed, menuOnly, restaurantIds };
}

function extension(contentType: string, url: string): string {
  const type = contentType.split(';')[0].toLowerCase();
  if (type === 'image/png') return '.png';
  if (type === 'image/webp') return '.webp';
  if (type === 'image/avif') return '.avif';
  if (type === 'image/gif') return '.gif';
  const suffix = extname(new URL(url).pathname).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'].includes(suffix) ? suffix : '.jpg';
}

function preferredImageUrl(url: string): string {
  // Google Maps thumbnails are often only 112–200px wide. Those are fine for
  // cards but consistently bad OCR input. Ask the same CDN object for a large
  // rendition before storing it in the local cache.
  if (url.includes('googleusercontent.com')) {
    const upgraded = url.replace(/=w\d+-h\d+[^?]*$/i, '=w1600-h1600-k-no');
    return upgraded || url;
  }
  return url;
}

async function main(): Promise<void> {
  const options = args(process.argv.slice(2));
  // The crawler CLI runs from <repo>/crawler, while shared media is stored at
  // <repo>/storage so backend/frontend can serve the same objects.
  const root = process.env.IMAGE_STORAGE_DIR ?? join(process.cwd(), '..', 'storage', 'restaurant-images');
  await mkdir(root, { recursive: true });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const limit = options.limit > 0 ? `LIMIT ${options.limit}` : '';
  const values: unknown[] = [];
  let restaurantFilter = '';
  if (options.restaurantIds.length) {
    values.push(options.restaurantIds);
    restaurantFilter = ` AND ri.restaurant_id = ANY($${values.length}::uuid[])`;
  }
  const menuFilter = options.menuOnly
    ? ` AND (
        ri.alt_text ILIKE '%Google Maps menu tab%'
        OR ri.alt_text ILIKE '%local-menu%'
        OR ri.alt_text ILIKE '%website menu%'
        OR EXISTS (SELECT 1 FROM menu_image_extraction mie_filter WHERE mie_filter.restaurant_image_id = ri.id AND mie_filter.model IN ('website:menu:v1', 'website:menu-image-curated:v1'))
      )`
    : '';
  const result = await pool.query<ImageRow>(`SELECT ri.id, ri.url, ri.is_cover, ri.sort_order
    FROM restaurant_image ri JOIN restaurant r ON r.id = ri.restaurant_id
    WHERE ri.status = 'active' AND r.status = 'active'
      AND (${options.force ? 'true' : options.retryFailed ? "ri.cache_status IN ('pending','failed')" : "ri.cache_status IS NULL OR ri.cache_status = 'pending'"})${restaurantFilter}
      ${menuFilter}
      ORDER BY ri.is_cover DESC, ri.sort_order, ri.id ${limit}`, values);
  let done = 0;
  let failed = 0;
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const row = result.rows[cursor++];
      if (!row) return;
      try {
        const fetchUrl = preferredImageUrl(row.url);
        const response = await fetch(fetchUrl, { signal: AbortSignal.timeout(25_000), headers: {
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          Referer: 'https://www.google.com/maps/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
        }});
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const contentType = response.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
        if (!contentType.startsWith('image/')) throw new Error(`not an image: ${contentType}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length === 0 || bytes.length > 20 * 1024 * 1024) throw new Error('invalid image size');
        const hash = createHash('sha256').update(bytes).digest('hex');
        const key = `${hash}${extension(contentType, fetchUrl)}`;
        const file = join(root, key);
        try { await writeFile(`${file}.tmp`, bytes, { flag: 'wx' }); await rename(`${file}.tmp`, file); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        await pool.query(`UPDATE restaurant_image SET cached_object_key=$2, cached_content_hash=$3,
          cached_content_type=$4, cached_file_size=$5, cached_at=now(), cache_status='cached', cache_error=NULL WHERE id=$1`,
          [row.id, key, hash, contentType, bytes.length]);
        done += 1;
      } catch (error) {
        failed += 1;
        await pool.query(`UPDATE restaurant_image SET cache_status='failed', cache_error=$2 WHERE id=$1`, [row.id, String(error).slice(0, 500)]);
      }
      if ((done + failed) % 25 === 0) console.log(`image-cache ${done + failed}/${result.rows.length} cached=${done} failed=${failed}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, Math.max(1, result.rows.length)) }, () => worker()));
  console.log(`image-cache complete total=${result.rows.length} cached=${done} failed=${failed}`);
  await pool.end();
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });

import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { Pool } from 'pg';

type Options = { restaurantId: string; files: string[] };

function parseArgs(argv: string[]): Options {
  let restaurantId = '';
  const files: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--restaurant-id') restaurantId = argv[++index] ?? '';
    else if (argv[index] === '--file') files.push(argv[++index] ?? '');
  }
  if (!/^[0-9a-f-]{36}$/i.test(restaurantId)) throw new Error('--restaurant-id must be a UUID.');
  if (!files.length || files.some((file) => !file)) throw new Error('Provide at least one --file.');
  return { restaurantId, files: files.map((file) => resolve(file)) };
}

function contentType(file: string): string {
  switch (extname(file).toLowerCase()) {
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    case '.avif': return 'image/avif';
    case '.gif': return 'image/gif';
    case '.jpeg':
    case '.jpg': return 'image/jpeg';
    default: throw new Error(`Unsupported menu image extension: ${file}`);
  }
}

async function persistFile(root: string, bytes: Buffer, type: string): Promise<{ key: string; hash: string }> {
  const hash = createHash('sha256').update(bytes).digest('hex');
  const extension = type === 'image/png' ? '.png' : type === 'image/webp' ? '.webp' : type === 'image/avif' ? '.avif' : type === 'image/gif' ? '.gif' : '.jpg';
  const key = `${hash}${extension}`;
  const target = join(root, key);
  try {
    await access(target);
  } catch {
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, target);
  }
  return { key, hash };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const root = process.env.IMAGE_STORAGE_DIR ?? join(process.cwd(), '..', 'storage', 'restaurant-images');
  await mkdir(root, { recursive: true });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const restaurant = await pool.query<{ name: string }>(
      `SELECT name FROM restaurant WHERE id = $1 AND status = 'active'`,
      [options.restaurantId],
    );
    if (!restaurant.rows[0]) throw new Error('Restaurant was not found or is not active.');

    const imported: Array<{ file: string; imageId: string; key: string }> = [];
    for (let index = 0; index < options.files.length; index += 1) {
      const file = options.files[index];
      const type = contentType(file);
      const info = await stat(file);
      if (!info.isFile()) throw new Error(`Not a file: ${file}`);
      if (info.size === 0 || info.size > 20 * 1024 * 1024) throw new Error(`Menu image must be between 1 byte and 20 MB: ${file}`);
      const bytes = await readFile(file);
      const stored = await persistFile(root, bytes, type);
      const result = await pool.query<{ id: string }>(
        `INSERT INTO restaurant_image
          (restaurant_id, restaurant_source_id, url, alt_text, sort_order, is_cover, status,
           cached_object_key, cached_content_hash, cached_content_type, cached_file_size, cached_at, cache_status, cache_error)
         VALUES ($1, NULL, $2, $3, $4, false, 'active', $5, $6, $7, $8, now(), 'cached', NULL)
         ON CONFLICT (restaurant_id, COALESCE(restaurant_source_id, '00000000-0000-0000-0000-000000000000'::uuid), url)
         DO UPDATE SET alt_text = EXCLUDED.alt_text, status = 'active', cached_object_key = EXCLUDED.cached_object_key,
           cached_content_hash = EXCLUDED.cached_content_hash, cached_content_type = EXCLUDED.cached_content_type,
           cached_file_size = EXCLUDED.cached_file_size, cached_at = now(), cache_status = 'cached', cache_error = NULL
         RETURNING id`,
        [options.restaurantId, `local-menu://${stored.hash}`, `Operator supplied menu image: ${file.split(/[\\/]/).pop() ?? file}`, 800 + index, stored.key, stored.hash, type, bytes.length],
      );
      imported.push({ file, imageId: result.rows[0].id, key: stored.key });
    }
    console.log(JSON.stringify({
      event: 'local_menu_imported',
      restaurantId: options.restaurantId,
      restaurant: restaurant.rows[0].name,
      images: imported,
      next: `npm run enrich:menu-images --workspace crawler -- --restaurant-id ${options.restaurantId} --concurrency 1`,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

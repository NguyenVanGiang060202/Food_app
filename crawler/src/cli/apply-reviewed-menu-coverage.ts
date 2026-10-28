// Reapply a small, visually reviewed menu manifest after its cached images
// have been ingested. Nothing is written unless --apply is supplied.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

type ManifestItem = { restaurantKey: string; imageKey: string; entries: string[] };
type ResolvedItem = ManifestItem & { restaurantId: string; imageId: string; restaurantName: string };

function connectionString(): string {
  const localEnv = resolve(__dirname, '../../../.env');
  if (!process.env.DATABASE_URL && existsSync(localEnv)) process.loadEnvFile(localEnv);
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (!process.env.POSTGRES_DB || !process.env.POSTGRES_USER || !process.env.POSTGRES_PASSWORD) {
    throw new Error('Set DATABASE_URL or POSTGRES_DB, POSTGRES_USER and POSTGRES_PASSWORD.');
  }
  const url = new URL('postgresql://127.0.0.1');
  url.username = process.env.POSTGRES_USER;
  url.password = process.env.POSTGRES_PASSWORD;
  url.port = process.env.POSTGRES_PORT || '5432';
  url.pathname = `/${process.env.POSTGRES_DB}`;
  return url.toString();
}

function readManifest(path: string): ManifestItem[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('Menu manifest must be a nonempty array.');
  for (const item of parsed) {
    if (!item || typeof item !== 'object') throw new Error('Invalid manifest item.');
    const row = item as Partial<ManifestItem>;
    if (typeof row.restaurantKey !== 'string' || !row.restaurantKey.trim()) throw new Error('Missing restaurantKey.');
    if (typeof row.imageKey !== 'string' || !/^[a-f0-9]{64}\.(?:jpg|jpeg|png|webp)$/iu.test(row.imageKey)) {
      throw new Error(`Invalid imageKey for ${row.restaurantKey}.`);
    }
    if (!Array.isArray(row.entries) || !row.entries.length || row.entries.some((entry) =>
      typeof entry !== 'string' || entry.split('|').length < 2 || entry.split('|').length > 3)) {
      throw new Error(`Invalid entries for ${row.restaurantKey}.`);
    }
  }
  return parsed as ManifestItem[];
}

async function main(): Promise<void> {
  const apply = process.argv.slice(2).includes('--apply');
  const path = resolve(__dirname, '../../data/verified-menu-coverage-2026-10-21.json');
  const manifest = readManifest(path);
  const databaseUrl = connectionString();
  const pool = new Pool({ connectionString: databaseUrl });
  const resolved: ResolvedItem[] = [];
  try {
    // Resolve the entire manifest before the first write. A missing or
    // ambiguous image therefore cannot cause a silent partial curation.
    for (const item of manifest) {
      const found = await pool.query<{ restaurant_id: string; image_id: string; restaurant_name: string }>(
        `SELECT r.id AS restaurant_id, ri.id AS image_id, r.name AS restaurant_name
         FROM restaurant_image ri JOIN restaurant r ON r.id = ri.restaurant_id
         LEFT JOIN menu_image_extraction mie ON mie.restaurant_image_id = ri.id
         WHERE ri.cached_object_key = $1 AND r.normalized_name = $2
           AND ri.status = 'active' AND r.status = 'active'
         ORDER BY (mie.model = 'google_maps:menu-curated:v1') DESC NULLS LAST, ri.id LIMIT 10`,
        [item.imageKey, item.restaurantKey],
      );
      if (!found.rows.length) throw new Error(`Cached image not found: ${item.restaurantKey} / ${item.imageKey}`);
      if (new Set(found.rows.map((row) => row.restaurant_id)).size !== 1) {
        throw new Error(`Ambiguous restaurant: ${item.restaurantKey} / ${item.imageKey}`);
      }
      const row = found.rows[0];
      resolved.push({ ...item, restaurantId: row.restaurant_id, imageId: row.image_id, restaurantName: row.restaurant_name });
    }
  } finally {
    await pool.end();
  }

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', images: resolved.map(({ restaurantName, imageId, entries }) => ({ restaurantName, imageId, dishes: entries.length })) }, null, 2));
  if (!apply) return;
  const compiled = resolve(__dirname, 'curate-menu-image.js');
  const script = existsSync(compiled) ? compiled : resolve(__dirname, 'curate-menu-image.ts');
  for (const item of resolved) {
    const args = [
      ...(script.endsWith('.ts') ? ['--require', 'ts-node/register'] : []),
      script, '--restaurant-id', item.restaurantId, '--image-id', item.imageId,
      ...item.entries.flatMap((entry) => ['--entry', entry]),
    ];
    const result = spawnSync(process.execPath, args, {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Curation failed for ${item.restaurantName} / ${item.imageId}.`);
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({ event: 'reviewed_menu_coverage_failed', message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});

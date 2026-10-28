import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Pool } from 'pg';

const DEFAULT_DISHES = [
  'phở bò', 'phở gà', 'bún bò Huế', 'bún riêu', 'bún thịt nướng',
  'bánh mì thịt nướng', 'mì xào hải sản', 'cơm gà', 'món chay', 'lẩu bò', 'gà nướng',
];

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function targetTextClause(column: string, parameter: string): string {
  // Tone marks are semantically important: cháo is not chảo. Keep the
  // accented comparison primary and only use unaccent for ASCII targets.
  return `(
    lower(${column}) LIKE '%' || lower(${parameter}) || '%'
    OR (${parameter} !~ '[áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]'
        AND lower(unaccent(${column})) LIKE '%' || lower(unaccent(${parameter})) || '%')
  )`;
}

// Keep the audit aligned with RestaurantsRepository's precision gate. A
// completed OCR row is not automatically trusted: food-photo guesses and
// repeated stock-template output must not inflate coverage numbers.
const trustedExtraction = (alias: string) => `
  ${alias}.status = 'completed'
  AND ${alias}.model IN ('website:menu:v1', 'website:menu-image-curated:v1', 'google_maps:menu-curated:v1')`;

function parseArgs(argv: string[]): { dishes: string[]; output: string } {
  const dishes: string[] = [];
  let output = resolve('artifacts/menu-coverage-audit.json');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--dish' && argv[index + 1]) dishes.push(argv[++index]);
    else if (argv[index] === '--output' && argv[index + 1]) output = resolve(argv[++index]);
  }
  return { dishes: dishes.length ? dishes : DEFAULT_DISHES, output };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const coverage: unknown[] = [];
    for (const dish of options.dishes) {
      const normalized = normalize(dish);
      const count = await pool.query<{ restaurants: number; evidence: number }>(
        `SELECT count(DISTINCT d.restaurant_id)::int AS restaurants, count(DISTINCT de.id)::int AS evidence
         FROM dish d
         JOIN dish_evidence de ON de.dish_id = d.id AND de.evidence_type = 'menu_image'
         JOIN menu_image_extraction mie ON mie.restaurant_image_id = de.restaurant_image_id
         WHERE d.status = 'available' AND ${trustedExtraction('mie')}
           AND (left(regexp_replace(lower(unaccent(COALESCE(mie.raw_ocr_text, ''))), '\\s+', ' ', 'g'), 700) LIKE '%' || $1 || '%'
             OR EXISTS (SELECT 1 FROM canonical_dish cd LEFT JOIN canonical_dish_alias ca ON ca.canonical_dish_id = cd.id WHERE cd.id = d.canonical_dish_id AND (cd.normalized_name = $1 OR ca.normalized_alias = $1)))
           AND ((d.normalized_name = $1 OR d.normalized_name LIKE $2) OR EXISTS (SELECT 1 FROM canonical_dish cd3 LEFT JOIN canonical_dish_alias ca3 ON ca3.canonical_dish_id = cd3.id WHERE cd3.id = d.canonical_dish_id AND (cd3.normalized_name = $1 OR ca3.normalized_alias = $1)))`,
        [normalized, `${normalized} %`],
      );
      const missing = await pool.query<{
        id: string; name: string; address: string | null; website_url: string | null;
        cached_images: number; menu_candidates: number;
      }>(
        `SELECT r.id, r.name, l.formatted_address AS address, r.website_url,
                count(DISTINCT ri.id) FILTER (WHERE ri.cache_status = 'cached')::int AS cached_images,
                count(DISTINCT ri.id) FILTER (WHERE ri.alt_text ILIKE '%menu%' OR ri.alt_text ILIKE '%thực đơn%')::int AS menu_candidates
         FROM restaurant r
         LEFT JOIN location l ON l.id = r.location_id
         LEFT JOIN restaurant_image ri ON ri.restaurant_id = r.id AND ri.status = 'active'
         WHERE r.status = 'active'
           AND ${targetTextClause('r.name', '$1')}
           AND NOT EXISTS (
             SELECT 1 FROM dish d2
             JOIN dish_evidence de2 ON de2.dish_id = d2.id AND de2.evidence_type = 'menu_image'
             JOIN menu_image_extraction mie2 ON mie2.restaurant_image_id = de2.restaurant_image_id
             WHERE d2.restaurant_id = r.id AND d2.status = 'available' AND ${trustedExtraction('mie2')}
               AND (left(regexp_replace(lower(unaccent(COALESCE(mie2.raw_ocr_text, ''))), '\\s+', ' ', 'g'), 700) LIKE '%' || $2 || '%'
                 OR EXISTS (SELECT 1 FROM canonical_dish cd2 LEFT JOIN canonical_dish_alias ca2 ON ca2.canonical_dish_id = cd2.id WHERE cd2.id = d2.canonical_dish_id AND (cd2.normalized_name = $2 OR ca2.normalized_alias = $2)))
               AND ((d2.normalized_name = $2 OR d2.normalized_name LIKE $3) OR EXISTS (SELECT 1 FROM canonical_dish cd4 LEFT JOIN canonical_dish_alias ca4 ON ca4.canonical_dish_id = cd4.id WHERE cd4.id = d2.canonical_dish_id AND (cd4.normalized_name = $2 OR ca4.normalized_alias = $2)))
           )
         GROUP BY r.id, l.id
         ORDER BY menu_candidates DESC, cached_images DESC, r.name
         LIMIT 25`,
        [dish, normalized, `${normalized} %`],
      );
      coverage.push({
        dish,
        normalized,
        trustedRestaurants: count.rows[0]?.restaurants ?? 0,
        trustedEvidence: count.rows[0]?.evidence ?? 0,
        priorityMissingRestaurants: missing.rows,
      });
    }
    const report = { generatedAt: new Date().toISOString(), coverage };
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify({ event: 'menu_coverage_audit_complete', output: options.output, coverage }, null, 2));
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

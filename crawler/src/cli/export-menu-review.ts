import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';

type ImageRow = {
  image_id: string;
  restaurant_id: string;
  restaurant_name: string;
  address: string | null;
  source_url: string | null;
  source_external_id: string | null;
  dish_targets: string[];
  cached_object_key: string;
  alt_text: string | null;
  raw_ocr_text: string | null;
  sort_order: number;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function fileSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'menu';
}

function targetTextClause(column: string, parameter: string): string {
  // Do not use unaccent as the primary match: cháo and chảo are different
  // dishes and should produce different targeted batches.
  return `(
    lower(${column}) LIKE '%' || lower(${parameter}) || '%'
    OR (${parameter} !~ '[áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]'
        AND lower(unaccent(${column})) LIKE '%' || lower(unaccent(${parameter})) || '%')
  )`;
}

function parseArgs(argv: string[]): { dishes: string[]; perRestaurant: number; limit: number; outputDir: string; menuOnly: boolean } {
  const dishes: string[] = [];
  let perRestaurant = 8;
  let limit = 60;
  let outputDir = join(process.cwd(), 'artifacts', 'menu-review');
  // A review page must be safe by default. Generic restaurant photos are not
  // useful for menu curation and can make an operator accidentally promote
  // false dish evidence. Use --candidate-batch only when deliberately asking
  // for unverified photos.
  let menuOnly = true;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dish' && argv[index + 1]) dishes.push(argv[++index].trim());
    else if (arg === '--per-restaurant') perRestaurant = Math.max(1, Number(argv[++index]));
    else if (arg === '--limit') limit = Math.max(1, Number(argv[++index]));
    else if (arg === '--output-dir' && argv[index + 1]) outputDir = argv[++index];
    else if (arg === '--menu-only') menuOnly = true;
    else if (arg === '--candidate-batch') menuOnly = false;
  }
  if (!dishes.length) throw new Error('At least one --dish is required.');
  if (!Number.isInteger(perRestaurant) || !Number.isInteger(limit)) throw new Error('Invalid numeric option.');
  return { dishes, perRestaurant, limit, outputDir, menuOnly };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await mkdir(options.outputDir, { recursive: true });
  const selectionPath = join(options.outputDir, 'selected-menu-image-ids.txt');
  const selectionFileName = `selected-menu-image-ids-${fileSlug(options.dishes.join('-'))}.txt`;
  const priorSelectedIds = new Set<string>();
  try {
    const priorSelection = await readFile(selectionPath, 'utf8');
    for (const line of priorSelection.split(/\r?\n/)) {
      const id = line.replace(/#.*/, '').trim();
      if (/^[0-9a-f-]{36}$/i.test(id)) priorSelectedIds.add(id);
    }
  } catch {
    // First export: there is no prior operator selection to preserve.
  }
  try {
    const targetPatterns = options.dishes.map((dish) => `%${dish}%`);
    const restaurants = await pool.query<{
      id: string;
      name: string;
      address: string | null;
      matched_dish: string;
    }>(
      `SELECT DISTINCT ON (r.id, target_dish)
         r.id,
         r.name,
         l.formatted_address AS address,
         target_dish
       FROM restaurant r
       JOIN location l ON l.id = r.location_id
       CROSS JOIN unnest($1::text[]) AS target_dish
       WHERE r.status = 'active'
         AND (
           ${targetTextClause('r.name', 'target_dish')}
           OR EXISTS (
             SELECT 1 FROM restaurant_source rs
             WHERE rs.restaurant_id = r.id
               AND rs.status = 'active'
               AND ${targetTextClause("COALESCE(rs.raw_data->>'query', '')", 'target_dish')}
           )
         )
         AND NOT EXISTS (
           SELECT 1
           FROM dish d
           JOIN dish_evidence de ON de.dish_id = d.id AND de.evidence_type = 'menu_image'
           JOIN menu_image_extraction mie ON mie.restaurant_image_id = de.restaurant_image_id
           WHERE d.restaurant_id = r.id
             AND d.status = 'available'
             AND mie.status = 'completed'
             AND lower(unaccent(d.normalized_name)) = lower(unaccent(target_dish))
         )
       ORDER BY r.id, target_dish, r.rating DESC NULLS LAST, r.updated_at DESC
       LIMIT $2`,
      [targetPatterns.map((pattern) => pattern.slice(1, -1)), options.limit * options.dishes.length],
    );

    const restaurantIds = [...new Set(restaurants.rows.map((row) => row.id))];
    if (!restaurantIds.length) throw new Error('No active target restaurants found.');
    const images = await pool.query<ImageRow>(
      `WITH deduped AS (
         SELECT DISTINCT ON (ri.restaurant_id, ri.cached_object_key)
                ri.id AS image_id,
                ri.restaurant_id,
                r.name AS restaurant_name,
                l.formatted_address AS address,
                ri.cached_object_key,
                ri.alt_text,
                mie.raw_ocr_text AS raw_ocr_text,
                ri.sort_order,
                ri.is_cover,
                source.source_url,
                source.external_id AS source_external_id
         FROM restaurant_image ri
         JOIN restaurant r ON r.id = ri.restaurant_id
         JOIN location l ON l.id = r.location_id
         LEFT JOIN menu_image_extraction mie ON mie.restaurant_image_id = ri.id
         LEFT JOIN LATERAL (
           SELECT rs.source_url, rs.external_id
           FROM restaurant_source rs
           JOIN data_source ds ON ds.id = rs.data_source_id
           WHERE rs.restaurant_id = r.id
             AND rs.status = 'active'
             AND ds.code = 'google_maps_playwright'
           ORDER BY rs.last_seen_at DESC NULLS LAST, rs.id
           LIMIT 1
         ) source ON true
         WHERE ri.restaurant_id = ANY($2::uuid[])
         AND ri.status = 'active'
           AND ri.cached_object_key IS NOT NULL
           ${options.menuOnly ? "AND (ri.alt_text ILIKE '%Google Maps menu tab%' OR ri.alt_text ILIKE '%local-menu%' OR ri.alt_text ILIKE '%website menu%' OR ri.alt_text ILIKE '%official menu image%') AND EXISTS (SELECT 1 FROM menu_image_extraction mie_filter WHERE mie_filter.restaurant_image_id = ri.id AND mie_filter.status = 'completed' AND mie_filter.confidence >= 0.65 AND mie_filter.model IN ('website:menu:v1', 'website:menu-image-curated:v1', 'google_maps:menu-curated:v1') AND COALESCE(mie_filter.raw_ocr_text, '') NOT ILIKE 'food_photo:%' AND COALESCE(mie_filter.raw_ocr_text, '') NOT ILIKE 'classify: other%' AND COALESCE(mie_filter.raw_ocr_text, '') NOT ILIKE '%dish_name%' AND COALESCE(mie_filter.raw_ocr_text, '') NOT ILIKE '%price_vnd%') AND NOT EXISTS (SELECT 1 FROM menu_image_extraction mie_reject WHERE mie_reject.restaurant_image_id = ri.id AND mie_reject.status = 'not_menu')" : ''}
         ORDER BY ri.restaurant_id,
                  ri.cached_object_key,
                  (ri.alt_text ILIKE '%Google Maps menu tab%') DESC,
                  ri.is_cover DESC,
                  ri.sort_order,
                   ri.id
       ), ranked AS (
         SELECT ri.image_id,
                ri.restaurant_id,
                r.name AS restaurant_name,
                l.formatted_address AS address,
                ri.cached_object_key,
                ri.alt_text,
                 ri.raw_ocr_text,
                ri.sort_order,
                ri.source_url,
                ri.source_external_id,
                ARRAY_AGG(DISTINCT target.target_dish) AS dish_targets,
                row_number() OVER (PARTITION BY ri.restaurant_id ORDER BY ri.is_cover DESC, ri.sort_order, ri.image_id) AS image_rank
         FROM deduped ri
         JOIN restaurant r ON r.id = ri.restaurant_id
         JOIN location l ON l.id = r.location_id
         JOIN LATERAL unnest($1::text[]) AS target(target_dish) ON
           ${targetTextClause('r.name', 'target.target_dish')}
           OR EXISTS (
             SELECT 1 FROM restaurant_source rs
             WHERE rs.restaurant_id = r.id
               AND rs.status = 'active'
               AND ${targetTextClause("COALESCE(rs.raw_data->>'query', '')", 'target.target_dish')}
           )
         GROUP BY ri.image_id, ri.restaurant_id, r.name, l.formatted_address, ri.cached_object_key, ri.alt_text, ri.raw_ocr_text, ri.sort_order, ri.is_cover, ri.source_url, ri.source_external_id
       )
       SELECT image_id, restaurant_id, restaurant_name, address, source_url, source_external_id, dish_targets, cached_object_key, alt_text, raw_ocr_text, sort_order
       FROM ranked
       WHERE image_rank <= $3
       ORDER BY restaurant_name,
                CASE WHEN alt_text ILIKE '%Google Maps menu tab%' THEN 0 ELSE 1 END,
                image_rank,
                image_id`,
      [options.dishes, restaurantIds, options.perRestaurant],
    );

    const manifest = {
      generatedAt: new Date().toISOString(),
      dishes: options.dishes,
      perRestaurant: options.perRestaurant,
      menuOnly: options.menuOnly,
      status: images.rows.length ? 'ready_for_operator_review' : 'no_verified_menu_images',
      message: images.rows.length
        ? 'Chỉ gồm ảnh đã qua gate menu; operator vẫn phải kiểm tra tên món và giá trước khi chọn.'
        : 'Không có ảnh menu đã xác minh cho batch này. Hãy bổ sung menu từ website/local rồi chạy lại; không dùng ảnh candidate để làm bằng chứng.',
      images: images.rows.map((row) => ({
        imageId: row.image_id,
        restaurantId: row.restaurant_id,
        restaurantName: row.restaurant_name,
        address: row.address,
        sourceUrl: row.source_url,
        sourceExternalId: row.source_external_id,
        dishes: row.dish_targets,
        cachedObjectKey: row.cached_object_key,
        altText: row.alt_text,
        ocrText: row.raw_ocr_text,
        sortOrder: row.sort_order,
        // Use the backend's local media endpoint so review works from a
        // browser served over localhost and never depends on an expired CDN.
        previewUrl: `http://localhost:3000/api/v1/media/restaurant-images/${row.image_id}`,
      })),
    };
    await writeFile(join(options.outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    const currentImageIds = new Set(images.rows.map((row) => row.image_id));
    const preservedSelection = [...priorSelectedIds].filter((id) => currentImageIds.has(id));
    await writeFile(
      selectionPath,
      preservedSelection.length
        ? `# Operator-selected menu images\n${preservedSelection.join('\n')}\n`
        : '# Operator-selected menu images\n',
      'utf8',
    );

    const reviewModeText = options.menuOnly
      ? 'Chỉ hiển thị ảnh đã lấy từ tab Thực đơn Google Maps và đã qua bước xác nhận menu. Chọn ảnh có món + giá rõ ràng; link Google Maps dùng để đối chiếu đúng quán.'
      : 'Đây là candidate batch không xác minh menu. Chỉ dùng để tìm nguồn bổ sung; không chọn trực tiếp để tạo bằng chứng món.';
    const sourceText = options.menuOnly
      ? 'Nguồn: ảnh menu đã qua gate tự động; vẫn cần operator chọn ảnh có món + giá rõ.'
      : 'Nguồn: ảnh cache của quán mục tiêu; CHƯA xác minh là menu.';
    const cards = images.rows
      .map(
        (row) => `<article class="card" data-dishes="${escapeHtml(row.dish_targets.join(' '))}" data-restaurant="${escapeHtml(row.restaurant_name)}">
          <label><input type="checkbox" value="${row.image_id}"${preservedSelection.includes(String(row.image_id)) ? ' checked' : ''}> chọn menu</label>
          <img loading="lazy" src="${escapeHtml(`http://localhost:3000/api/v1/media/restaurant-images/${row.image_id}`)}" alt="${escapeHtml(row.restaurant_name)}">
          <div class="name">${escapeHtml(row.restaurant_name)}</div>
          <div class="meta">${escapeHtml(row.dish_targets.join(', '))}</div>
          <div class="meta">${escapeHtml(row.address ?? '')}</div>
          <div class="meta">${escapeHtml(sourceText)}</div>
          ${row.raw_ocr_text ? `<details><summary>OCR preview</summary><pre>${escapeHtml(row.raw_ocr_text.slice(0, 1800))}</pre></details>` : ''}
          ${row.source_url ? `<a href="${escapeHtml(row.source_url)}" target="_blank" rel="noreferrer">Mở quán trên Google Maps</a>` : '<div class="meta">Không có Google Maps URL trong database</div>'}
          <code>${row.image_id}</code>
        </article>`,
      )
      .join('\n');
    const emptyState = images.rows.length
      ? ''
      : '<section class="empty"><strong>Chưa có ảnh menu hợp lệ</strong><p>Batch này không có ảnh đã qua gate menu. Không có gì để chọn. Hãy dùng menu website hoặc cung cấp ảnh menu local rồi chạy lại.</p></section>';
    const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>Menu review</title>
<style>body{font-family:system-ui;margin:20px;background:#f5f5f5}.toolbar{position:sticky;top:0;background:white;padding:12px;z-index:2;border-bottom:1px solid #ddd}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}.card{background:white;padding:10px;border-radius:10px;box-shadow:0 1px 4px #0002}.card img{width:100%;height:220px;object-fit:contain;background:#eee;margin-top:8px}.name{font-weight:700;margin-top:8px}.meta{font-size:12px;color:#555;margin-top:3px}pre{white-space:pre-wrap;font-size:11px;max-height:180px;overflow:auto;background:#f8fafc;padding:8px}code{font-size:10px;word-break:break-all}.selected{outline:3px solid #16a34a}.empty{max-width:720px;margin:40px auto;padding:24px;background:#fff7ed;border:1px solid #fdba74;border-radius:12px;color:#7c2d12}</style></head>
<body><h1>Menu review</h1><p>${escapeHtml(reviewModeText)}</p>
<div class="toolbar"><input id="filter" placeholder="lọc quán hoặc món" style="width:280px;padding:8px"${images.rows.length ? '' : ' disabled'}><button id="export"${images.rows.length ? '' : ' disabled'}>Xuất ${escapeHtml(selectionFileName)}</button> <span id="count"></span></div>
${emptyState}<main class="grid">${cards}</main>
<script>const cards=[...document.querySelectorAll('.card')], filter=document.querySelector('#filter'), count=document.querySelector('#count');
function refresh(){const q=filter.value.toLowerCase();let n=0;cards.forEach(c=>{const show=!q||c.innerText.toLowerCase().includes(q);c.style.display=show?'':'none';const cb=c.querySelector('input');c.classList.toggle('selected',cb.checked);if(cb.checked)n++});count.textContent=n+' ảnh đã chọn';}
document.querySelectorAll('input[type=checkbox]').forEach(x=>x.addEventListener('change',refresh));filter.addEventListener('input',refresh);refresh();
document.querySelector('#export').addEventListener('click',()=>{const ids=[...document.querySelectorAll('input[type=checkbox]:checked')].map(x=>x.value);const blob=new Blob(['# Selected menu image IDs\\n',...ids.map(x=>x+'\\n')],{type:'text/plain'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=${JSON.stringify(selectionFileName)};a.click();});</script></body></html>`;
    await writeFile(join(options.outputDir, 'index.html'), html, 'utf8');
    console.log(JSON.stringify({ event: 'menu_review_exported', restaurants: restaurantIds.length, images: images.rows.length, outputDir: options.outputDir }));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: 'menu_review_export_failed',
    message: error instanceof Error ? error.message : String(error),
    detail: error && typeof error === 'object' ? { code: (error as { code?: string }).code, detail: (error as { detail?: string }).detail, hint: (error as { hint?: string }).hint, stack: (error as Error).stack } : undefined,
  }));
  process.exitCode = 1;
});

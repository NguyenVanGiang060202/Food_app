// Promote only high-precision dish names from operator-selected menu images.
// The operator has already verified the image is a food menu; this command
// still keeps OCR text behind a conservative exact-food lexicon gate so drinks,
// add-ons, and corrupted OCR never become recommendation truth automatically.

import { Pool } from 'pg';

type ImageRow = {
  imageId: string;
  restaurantId: string;
  restaurantName: string;
  extractionModel: string | null;
  extractionStatus: string | null;
  rawOcrText: string | null;
};

type DishRow = {
  imageId: string;
  rawName: string;
  rawPrice: string | null;
  source: string;
};

type Entry = { name: string; price: number | null; rawPrice: string | null; rawName: string };

type TargetDish =
  | 'pho-bo'
  | 'pho-ga'
  | 'bun-rieu'
  | 'bun-thit-nuong'
  | 'com-tam-suon'
  | 'lau-bo'
  | 'bun-bo-hue'
  | 'banh-canh-cua'
  | 'banh-mi-thit-nuong'
  | 'mi-xao-hai-san'
  | 'bun-ca'
  | 'chao'
  | 'hu-tieu';

// This is deliberately an exact, longest-first menu lexicon. It is not a
// category mapper: "bún chả cá" must never become "bún chả", and bare
// groups such as "bún", "cơm", "mì" and "món" are rejected.
const DISH_PATTERNS: Array<{ normalized: string; display: string }> = [
  ['bun rieu ca be', 'Bún riêu cá bể'],
  ['bun rieu cha ruoi', 'Bún riêu chả rươi'],
  ['bun rieu cha bo', 'Bún riêu chả bò'],
  ['bun rieu cuon day du', 'Bún riêu cuốn đầy đủ'],
  ['bun rieu cuon goc pho', 'Bún riêu cuốn Góc Phố'],
  ['bun rieu cuon truyen thong', 'Bún riêu cuốn truyền thống'],
  ['bun rieu cuon treuyen thong', 'Bún riêu cuốn truyền thống'],
  ['bun rieu cuon', 'Bún riêu cuốn'],
  ['bun rieu truyen thong', 'Bún riêu truyền thống'],
  ['bun rieu truyen thong', 'Bún riêu truyền thống'],
  ['bun rieu muc', 'Bún riêu mực'],
  ['bun rieu xao', 'Bún riêu xào'],
  ['bun rieu cua', 'Bún riêu cua'],
  ['bun rieu ca bi', 'Bún riêu cá bì'],
  ['bun rieu ca', 'Bún riêu cá'],
  ['bun rieu oc', 'Bún riêu ốc'],
  ['bun rieu cha', 'Bún riêu chả'],
  ['bun rieu canh bun', 'Bún riêu canh bún'],
  ['bun cha tra vinh', 'Bún chả Trà Vinh'],
  ['bun cha gio', 'Bún chả giò'],
  ['bun cha ca', 'Bún chả cá'],
  ['bun cha hue', 'Bún chả Huế'],
  ['bun thit nuong dac biet', 'Bún thịt nướng đặc biệt'],
  ['bun thit nuong day du', 'Bún thịt nướng đầy đủ'],
  ['bun nem nuong', 'Bún nem nướng'],
  ['bun nem nuong cha gio', 'Bún nem nướng chả giò'],
  ['bun bo hue', 'Bún bò Huế'],
  ['bun thit nuong', 'Bún thịt nướng'],
  ['bun rieu', 'Bún riêu'],
  ['bun cha', 'Bún chả'],
  ['bun mam', 'Bún mắm'],
  ['bun oc', 'Bún ốc'],
  ['bun ga', 'Bún gà'],
  ['bun ca', 'Bún cá'],
  ['bun vit', 'Bún vịt'],
  ['bun dau mam tom', 'Bún đậu mắm tôm'],
  ['bun go heo', 'Bún giò heo'],
  ['pho tai nam', 'Phở tái nạm'],
  ['pho tai', 'Phở tái'],
  ['pho chin', 'Phở chín'],
  ['pho dac biet', 'Phở đặc biệt'],
  ['pho bo', 'Phở bò'],
  ['pho ga', 'Phở gà'],
  ['beef brisket pho', 'Phở bò nạm'],
  ['rare beef pho', 'Phở tái'],
  ['chicken pho', 'Phở gà'],
  ['hu tieu nam vang', 'Hủ tiếu Nam Vang'],
  ['hu tieu mi', 'Hủ tiếu mì'],
  ['hu tieu ga', 'Hủ tiếu gà'],
  ['hu tieu muc', 'Hủ tiếu mực'],
  ['hu tieu bo vien', 'Hủ tiếu bò viên'],
  ['hu tieu suon', 'Hủ tiếu sườn'],
  ['mi quang', 'Mì Quảng'],
  ['mi xao gion', 'Mì xào giòn'],
  ['mi xao bo', 'Mì xào bò'],
  ['mi xao hai san', 'Mì xào hải sản'],
  ['mi xao', 'Mì xào'],
  ['mi ga', 'Mì gà'],
  ['mi vit tiem', 'Mì vịt tiềm'],
  ['banh hoi heo dac biet', 'Bánh hỏi heo đặc biệt'],
  ['banh hoi heo quy', 'Bánh hỏi heo quý'],
  ['banh hoi heo', 'Bánh hỏi heo'],
  ['banh mi chao', 'Bánh mì chảo'],
  ['banh mi thit nuong', 'Bánh mì thịt nướng'],
  ['banh mi thit', 'Bánh mì thịt'],
  ['banh mi trung', 'Bánh mì trứng'],
  ['banh mi', 'Bánh mì'],
  ['banh xeo', 'Bánh xèo'],
  ['banh cuon', 'Bánh cuốn'],
  ['banh canh hue', 'Bánh canh Huế'],
  ['banh canh cua', 'Bánh canh cua'],
  ['banh canh', 'Bánh canh'],
  ['banh trang tron', 'Bánh tráng trộn'],
  ['banh bao', 'Bánh bao'],
  ['banh bot chien', 'Bánh bột chiên'],
  ['com bo luc lac', 'Cơm bò lúc lắc'],
  ['com thap cam', 'Cơm thập cẩm'],
  ['com tam suon nuong', 'Cơm tấm sườn nướng'],
  ['com tam suon', 'Cơm tấm sườn'],
  ['com suon', 'Cơm sườn'],
  ['com tam', 'Cơm tấm'],
  ['com ga', 'Cơm gà'],
  ['com rang', 'Cơm rang'],
  ['com hen', 'Cơm hến'],
  ['com chay', 'Cơm chay'],
  ['goi cuon bo', 'Gỏi cuốn bò'],
  ['goi cuon', 'Gỏi cuốn'],
  ['cha gio', 'Chả giò'],
  ['nem ran', 'Nem rán'],
  ['nem nuong', 'Nem nướng'],
  ['chao bo', 'Cháo bò'],
  ['chao bo bam', 'Cháo bò băm'],
  ['chao ga', 'Cháo gà'],
  ['chao long', 'Cháo lòng'],
  ['chao vit', 'Cháo vịt'],
  ['chao suon', 'Cháo sườn'],
  ['chao hau', 'Cháo hàu'],
  ['chao hai san', 'Cháo hải sản'],
  ['chao ca', 'Cháo cá'],
  ['chao tom', 'Cháo tôm'],
  ['chao ech', 'Cháo ếch'],
  ['xoi ga', 'Xôi gà'],
  ['xoi man', 'Xôi mặn'],
  ['lau duoi bo', 'Lẩu đuôi bò'],
  ['lau suon', 'Lẩu sườn'],
  ['lau xi quach', 'Lẩu xí quách'],
  ['lau bo', 'Lẩu bò'],
  ['lau ga', 'Lẩu gà'],
  ['lau tom', 'Lẩu tôm'],
  ['lau oc', 'Lẩu ốc'],
  ['ga nuong lu', 'Gà nướng lu'],
  ['ga nuong luan', 'Gà nướng Luân'],
  ['ga nuong', 'Gà nướng'],
  ['suon nuong', 'Sườn nướng'],
  ['bo nuong', 'Bò nướng'],
  ['bo kho', 'Bò kho'],
].map(([normalized, display]) => ({ normalized, display })).sort(
  (left, right) => right.normalized.length - left.normalized.length,
);

function parseArgs(argv: string[]): { selectionFile: string; manifestFile: string; apply: boolean; replaceTarget: boolean; targetDish: TargetDish } {
  let selectionFile = '';
  let manifestFile = '';
  let apply = false;
  let replaceTarget = false;
  let targetDish = '' as TargetDish;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--selection-file') selectionFile = argv[++index] ?? '';
    else if (argv[index] === '--manifest-file') manifestFile = argv[++index] ?? '';
    else if (argv[index] === '--apply') apply = true;
    else if (argv[index] === '--replace-target') replaceTarget = true;
    else if (argv[index] === '--target-dish') targetDish = argv[++index] as TargetDish;
  }
  if (!selectionFile && !manifestFile) throw new Error('--selection-file or --manifest-file is required.');
  if (apply && !selectionFile)
    throw new Error('--apply requires --selection-file; --manifest-file is dry-run only.');
  if (!targetDish || !TARGET_DISHES.has(targetDish))
    throw new Error('--target-dish must be one of: ' + [...TARGET_DISHES].join(', '));
  return { selectionFile, manifestFile, apply, replaceTarget, targetDish };
}

const TARGET_DISHES = new Set<TargetDish>([
  'pho-bo',
  'pho-ga',
  'bun-rieu',
  'bun-thit-nuong',
  'com-tam-suon',
  'lau-bo',
  'bun-bo-hue',
  'banh-canh-cua',
  'banh-mi-thit-nuong',
  'mi-xao-hai-san',
  'bun-ca',
  'chao',
  'hu-tieu',
]);

const TARGET_LABELS: Record<TargetDish, string> = {
  'pho-bo': 'Phở bò',
  'pho-ga': 'Phở gà',
  'bun-rieu': 'Bún riêu',
  'bun-thit-nuong': 'Bún thịt nướng',
  'com-tam-suon': 'Cơm tấm sườn',
  'lau-bo': 'Lẩu bò',
  'bun-bo-hue': 'Bún bò Huế',
  'banh-canh-cua': 'Bánh canh cua',
  'banh-mi-thit-nuong': 'Bánh mì thịt nướng',
  'mi-xao-hai-san': 'Mì xào hải sản',
  'bun-ca': 'Bún cá',
  'chao': 'Cháo',
  'hu-tieu': 'Hủ tiếu',
};

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseRawPrice(rawPrice: string | null): number | null {
  if (!rawPrice) return null;
  const raw = rawPrice.trim();
  if (!raw || /^none$/i.test(raw)) return null;
  const compact = raw.toLowerCase().replace(/[\s,._₫]/g, '');
  const match = compact.match(/^(\d+)(k|000|vnd)?$/i);
  if (!match) return null;
  let amount = Number(match[1]);
  if (/^k$/i.test(match[2] ?? '')) amount *= 1000;
  if (!Number.isFinite(amount) || amount < 1000 || amount > 2_000_000) return null;
  return amount;
}

function inferDish(rawName: string): { normalized: string; display: string } | null {
  // Chinese glyphs, replacement characters and other non-Latin OCR artifacts
  // are a strong signal that the line should stay untrusted until reviewed.
  if (/[�\u{2E80}-\u{9FFF}]/u.test(rawName)) return null;
  const normalizedRaw = normalize(rawName);
  if (!normalizedRaw || /^(bun|com|mi|pho|mon|do uong|nuoc)$/.test(normalizedRaw)) return null;
  const tokens = normalizedRaw.split(' ').filter(Boolean);
  const allowedPrefix = new Set(['mon', 'bun', 'pho']);
  const allowedSuffix = new Set([
    '1', '2', '3', '4', '5', '6', '10', '12', '100', '150', '200', '300', '350', '650',
    'con', 'to', 'lon', 'nho', 'phan', 'vat', 'ngui', 'nguoi', 'nguyen',
    'k', '000', 'vnd', 'g', 'kg', 'ml', 'khong', 'oc', 'gio',
  ]);
  const isAllowedRemainder = (remainder: string[]): boolean =>
    remainder.length === 0 || remainder.every((token) => /^\d+\/\d+$/.test(token) || allowedSuffix.has(token));
  const match = DISH_PATTERNS.find((candidate) => {
    const dishTokens = candidate.normalized.split(' ');
    for (let start = 0; start <= tokens.length - dishTokens.length; start += 1) {
      const found = dishTokens.every((token, offset) => tokens[start + offset] === token);
      if (!found) continue;
      const prefix = tokens.slice(0, start);
      const suffix = tokens.slice(start + dishTokens.length);
      if (prefix.every((token) => allowedPrefix.has(token)) && isAllowedRemainder(suffix)) return true;
    }
    return false;
  });
  return match ?? null;
}

function belongsToTarget(dish: { normalized: string; display: string }, target: TargetDish): boolean {
  const value = dish.normalized;
  switch (target) {
    case 'pho-bo':
      return (
        value === 'pho bo' ||
        value.startsWith('pho bo ') ||
        value === 'pho tai' ||
        value.startsWith('pho tai ') ||
        value === 'pho chin' ||
        value.startsWith('pho chin ') ||
        value === 'pho tai nam' ||
        value === 'beef brisket pho' ||
        value === 'rare beef pho'
      );
    case 'pho-ga':
      return value === 'pho ga' || value.startsWith('pho ga ') || value === 'chicken pho';
    case 'bun-rieu':
      return value === 'bun rieu' || value.startsWith('bun rieu ');
    case 'bun-thit-nuong':
      return value === 'bun thit nuong' || value.startsWith('bun thit nuong ');
    case 'com-tam-suon':
      return value === 'com tam suon' || value.startsWith('com tam suon ');
    case 'lau-bo':
      return value === 'lau bo' || value.startsWith('lau bo ') || value === 'lau duoi bo';
    case 'bun-bo-hue':
      return value === 'bun bo hue' || value.startsWith('bun bo hue ');
    case 'banh-canh-cua':
      return value === 'banh canh cua' || value.startsWith('banh canh cua ');
    case 'banh-mi-thit-nuong':
      return value === 'banh mi thit nuong' || value.startsWith('banh mi thit nuong ');
    case 'mi-xao-hai-san':
      return value === 'mi xao hai san' || value.startsWith('mi xao hai san ');
    case 'bun-ca':
      return value === 'bun ca' || value.startsWith('bun ca ');
    case 'chao':
      return value.startsWith('chao ');
    case 'hu-tieu':
      return value === 'hu tieu' || value.startsWith('hu tieu ');
  }
}

function preferEntry(candidate: Entry, current: Entry): Entry {
  const candidateExact = normalize(candidate.rawName) === normalize(candidate.name);
  const currentExact = normalize(current.rawName) === normalize(current.name);
  if (candidateExact !== currentExact) return candidateExact ? candidate : current;
  if (candidate.price !== null && current.price !== null && candidate.price !== current.price)
    return candidate.price < current.price ? candidate : current;
  return current;
}

async function readSelection(path: string): Promise<string[]> {
  const text = await import('node:fs/promises').then((fs) => fs.readFile(path, 'utf8'));
  return [...new Set(text.split(/\r?\n/).map((line) => line.replace(/#.*/, '').trim()).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
}

async function readManifestSelection(path: string): Promise<string[]> {
  const manifest = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(path, 'utf8'))) as {
    images?: Array<{ imageId?: string }>;
  };
  return [...new Set((manifest.images ?? []).map((image) => image.imageId ?? '').filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
}

function parseRawOcrEntries(text: string | null): DishRow[] {
  if (!text) return [];
  const entries: DishRow[] = [];
  for (const line of text.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    const match = line.match(/^(.+?)\s*[-–—:]\s*(\d[\d.,]*\s*(?:k|000|₫|VND)?)\s*$/i);
    if (!match) continue;
    const rawName = match[1].replace(/^[\d•*\.\-\s]+/, '').trim();
    if (rawName.length < 2 || rawName.length > 160) continue;
    entries.push({ imageId: '', rawName, rawPrice: match[2], source: 'menu_image:vision:v1' });
  }
  return entries;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const imageIds = [
    ...(options.selectionFile ? await readSelection(options.selectionFile) : []),
    ...(options.manifestFile ? await readManifestSelection(options.manifestFile) : []),
  ].filter((id, index, ids) => ids.indexOf(id) === index);
  if (!imageIds.length) throw new Error('Selection file contains no image UUIDs.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const images = await pool.query<ImageRow>(
      `SELECT ri.id AS "imageId", ri.restaurant_id AS "restaurantId", r.name AS "restaurantName",
              mie.model AS "extractionModel", mie.status AS "extractionStatus", mie.raw_ocr_text AS "rawOcrText"
       FROM restaurant_image ri
       JOIN restaurant r ON r.id = ri.restaurant_id
       LEFT JOIN menu_image_extraction mie ON mie.restaurant_image_id = ri.id
       WHERE ri.id = ANY($1::uuid[]) AND ri.status = 'active' AND r.status = 'active'`,
      [imageIds],
    );
    const imageMap = new Map(images.rows.map((row) => [row.imageId, row]));
    const dishRows = await pool.query<DishRow>(
      `SELECT de.restaurant_image_id AS "imageId", de.raw_name AS "rawName", de.raw_price AS "rawPrice", d.source
       FROM dish_evidence de
       JOIN dish d ON d.id = de.dish_id
       JOIN menu_image_extraction mie ON mie.restaurant_image_id = de.restaurant_image_id
       WHERE de.restaurant_image_id = ANY($1::uuid[])
         AND de.evidence_type = 'menu_image'
         AND d.source IN ('menu_image:vision:v1', 'menu_image:curated')
         AND mie.status = 'completed'
         AND (
           mie.model LIKE 'minicpm-v%'
           OR mie.model = 'google_maps:menu-curated:v1'
           OR mie.model = 'website:menu:v1'
           OR mie.model = 'website:menu-image-curated:v1'
         )
       ORDER BY de.restaurant_image_id, de.raw_name`,
      [imageIds],
    );
    const dishRowsByImage = new Map<string, DishRow[]>();
    for (const row of dishRows.rows) {
      const rows = dishRowsByImage.get(row.imageId) ?? [];
      rows.push(row);
      dishRowsByImage.set(row.imageId, rows);
    }
    // OCR candidate rows are persisted during enrichment before they become
    // dish_evidence. Selected/manifest images are the operator boundary, so
    // inspect raw OCR here and promote only exact lexicon matches.
    for (const image of images.rows) {
      const rows = dishRowsByImage.get(image.imageId) ?? [];
      for (const row of parseRawOcrEntries(image.rawOcrText)) rows.push({ ...row, imageId: image.imageId });
      dishRowsByImage.set(image.imageId, rows);
    }

    const grouped = new Map<string, Entry[]>();
    for (const row of [...dishRowsByImage.values()].flat()) {
      const dish = inferDish(row.rawName);
      if (!dish) continue;
      const parsedPrice = parseRawPrice(row.rawPrice);
      if (!belongsToTarget(dish, options.targetDish)) continue;
      const entries = grouped.get(row.imageId) ?? [];
      const nextEntry = { name: dish.display, price: parsedPrice, rawPrice: row.rawPrice, rawName: row.rawName };
      const duplicateIndex = entries.findIndex((entry) => entry.name === dish.display);
      if (duplicateIndex < 0) entries.push(nextEntry);
      else entries[duplicateIndex] = preferEntry(nextEntry, entries[duplicateIndex]);
      grouped.set(row.imageId, entries);
    }

    const suggestions = [...grouped.entries()]
      .map(([imageId, entries]) => ({ image: imageMap.get(imageId), imageId, entries }))
      .filter((row) => row.image && row.entries.length > 0) as Array<{ image: ImageRow; imageId: string; entries: Entry[] }>;

    console.log(JSON.stringify({
      event: options.apply ? 'selected_menu_curation_started' : 'selected_menu_curation_dry_run',
      targetDish: options.targetDish,
      targetLabel: TARGET_LABELS[options.targetDish],
      replaceTarget: options.replaceTarget,
      selectedImages: imageIds.length,
      menuImages: images.rows.filter((row) => row.extractionStatus === 'completed').length,
      suggestedImages: suggestions.length,
      suggestedEntries: suggestions.reduce((sum, row) => sum + row.entries.length, 0),
      suggestions: suggestions.map((row) => ({ imageId: row.imageId, restaurant: row.image.restaurantName, entries: row.entries })),
    }, null, 2));

    if (!options.apply) return;
    let applied = 0;
    const suggestionByImage = new Map(suggestions.map((suggestion) => [suggestion.imageId, suggestion]));
    for (const image of images.rows) {
      const suggestion = suggestionByImage.get(image.imageId);
      const entries = suggestion?.entries ?? [];
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const existingRaw = image.rawOcrText?.trim() ?? '';
        const curatedLines = entries.map(
          (entry) => `${entry.name} - ${entry.rawPrice ?? 'none'}`,
        );
        // Keep the operator-approved target lines first so the runtime can
        // ground them cheaply, while retaining the original OCR as discovery
        // signal for other dishes that are visible on the same menu.
        if (suggestion) {
          const rawOcrText = [...new Set([...curatedLines, ...(existingRaw ? existingRaw.split(/\r?\n/) : [])])]
            .filter(Boolean)
            .join('\n')
            .slice(0, 12_000);
          await client.query(
          `INSERT INTO menu_image_extraction (restaurant_image_id, status, model, confidence, raw_ocr_text, error_message, extracted_at, updated_at)
             VALUES ($1, 'completed', 'google_maps:menu-curated:v1', 0.97, $2, NULL, now(), now())
             ON CONFLICT (restaurant_image_id) DO UPDATE SET status='completed', model='google_maps:menu-curated:v1', confidence=GREATEST(COALESCE(menu_image_extraction.confidence, 0), 0.97), raw_ocr_text=EXCLUDED.raw_ocr_text, extracted_at=now(), updated_at=now()`,
            [image.imageId, rawOcrText],
          );
        }
        // A selected batch is a trust boundary for one target dish. When
        // requested, remove older curated evidence from this image that is
        // not present in the current target suggestions. Raw OCR remains in
        // menu_image_extraction and the original vision evidence remains
        // available as an untrusted candidate signal.
        if (options.replaceTarget) {
          const allowedNames = entries.map((entry) => normalize(entry.name));
          await client.query(
            `INSERT INTO dish_evidence_quarantine
               (id, dish_id, restaurant_image_id, evidence_type, raw_name, raw_price, confidence, verified_at, quarantined_at, quarantine_reason)
             SELECT de.id, de.dish_id, de.restaurant_image_id, de.evidence_type, de.raw_name, de.raw_price, de.confidence, de.verified_at, now(), $3
             FROM dish_evidence de
             JOIN dish d ON d.id = de.dish_id
             WHERE de.restaurant_image_id = $1
               AND de.evidence_type = 'menu_image'
               AND d.source = 'menu_image:curated'
               AND NOT (d.normalized_name = ANY($2::text[]))
             ON CONFLICT (id) DO NOTHING`,
            [image.imageId, allowedNames, `replaced by selected target: ${options.targetDish}`],
          );
          await client.query(
            `DELETE FROM dish_evidence de
             USING dish d
             WHERE de.dish_id = d.id
               AND de.restaurant_image_id = $1
               AND de.evidence_type = 'menu_image'
               AND d.source = 'menu_image:curated'
               AND NOT (d.normalized_name = ANY($2::text[]))`,
            [image.imageId, allowedNames],
          );
        }
        for (const entry of entries) {
          const normalized = normalize(entry.name);
          const existing = await client.query<{ id: string }>(
            `SELECT id FROM dish WHERE restaurant_id=$1 AND normalized_name=$2 ORDER BY id LIMIT 1`,
            [image.restaurantId, normalized],
          );
          const dishId = existing.rows[0]?.id ?? (await client.query<{ id: string }>(
            `INSERT INTO dish (restaurant_id,name,normalized_name,price_amount,currency_code,status,source,confidence)
             VALUES ($1,$2,$3,$4,'VND','available','menu_image:curated',0.97) RETURNING id`,
            [image.restaurantId, entry.name, normalized, entry.price],
          )).rows[0].id;
          await client.query(
            `UPDATE dish SET name=$2, price_amount=COALESCE($3,price_amount), currency_code='VND', status='available', source='menu_image:curated', confidence=GREATEST(COALESCE(confidence,0),0.97) WHERE id=$1`,
            [dishId, entry.name, entry.price],
          );
          await client.query(
            `INSERT INTO dish_evidence (dish_id,restaurant_image_id,evidence_type,raw_name,raw_price,confidence)
             VALUES ($1,$2,'menu_image',$3,$4,0.97)
             ON CONFLICT (dish_id,restaurant_image_id,evidence_type) DO UPDATE SET raw_name=EXCLUDED.raw_name,raw_price=EXCLUDED.raw_price,confidence=0.97,verified_at=now()`,
            [dishId, image.imageId, entry.rawName, entry.rawPrice],
          );
          applied += 1;
        }
        await client.query(
          `UPDATE dish d
           SET status = 'unavailable', confidence = LEAST(COALESCE(d.confidence, 0), 0.1)
           WHERE d.source = 'menu_image:curated'
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
        );
        await client.query(`UPDATE restaurant SET semantic_profile=NULL, updated_at=now() WHERE id=$1`, [image.restaurantId]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    console.log(JSON.stringify({ event: 'selected_menu_curation_completed', applied }));
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({ event: 'selected_menu_curation_failed', message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});

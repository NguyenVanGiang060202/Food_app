import { normalizeText } from './dish-extractor';

export interface ExtractedMenuDish {
  name: string;
  normalizedName: string;
  priceAmount: number | null;
  currencyCode: 'VND' | null;
  rawPrice: string | null;
}

export interface MenuImageResult {
  isMenu: boolean;
  confidence: number;
  ocrText: string;
  dishes: ExtractedMenuDish[];
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const text = (value: unknown, max = 500): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

const confidence = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

const price = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.round(value);
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const parsed = Number(digits);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed < 1000 && /k\b/i.test(value) ? parsed * 1000 : parsed;
};

// Vision OCR sometimes returns confident-looking gibberish for blurred menu
// photos. False dish facts are more damaging than missing facts, so require a
// conservative food-language signal before persisting a menu item.
const FOOD_NAME_HINTS = new Set([
  'an', 'banh', 'beef', 'bo', 'bun', 'ca', 'cafe', 'canh', 'cao', 'che', 'chien',
  'chicken', 'chay', 'com', 'cua', 'ga', 'goi', 'heo', 'hu', 'hu tieu', 'lau',
  'mi', 'muc', 'nam', 'ngheu', 'oc', 'pho', 'pizza', 'suon', 'sushi', 'tom',
  'thit', 'trung', 'vit', 'xao', 'nuong', 'kho', 'luoc', 'hap', 'sot', 'mon',
]);

const isPlausibleDishName = (name: string, normalizedName: string): boolean => {
  if (/[�<>|{}\\]/u.test(name)) return false;
  const words = normalizedName.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > 14) return false;
  const hint = words.some((word, index) => FOOD_NAME_HINTS.has(word) || FOOD_NAME_HINTS.has(words.slice(index, index + 2).join(' ')));
  // Do not accept arbitrary multi-word Latin text: OCR corruption often looks
  // like plausible English/Vietnamese tokens. Unknown names can be recovered
  // by a later reprocess, but must not become recommendation truth now.
  return hint;
};

// Some vision runs emitted a stock three-row menu on unrelated photos. A
// single stock row mixed with an explicit `none` price and only a few other
// OCR rows is also a strong corruption signal. Missing a menu is safer than
// turning that output into recommendation truth.
const isTemplateContaminated = (ocrText: string): boolean => {
  const lines = ocrText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const normalizedLines = lines.map((line) => normalizeText(line));
  const templates = ['bun bo hue', 'com tam', 'banh mi'];
  const templateHits = templates.filter((dish) =>
    normalizedLines.some((line) => new RegExp(`^${dish.replaceAll(' ', '\\s+')}\\s*[-:]`).test(line)),
  ).length;
  if (templateHits >= 2) return true;
  if (templateHits !== 1 || !lines.some((line) => /[-:]\s*none\s*$/i.test(line))) return false;
  const nonTemplatePricedRows = normalizedLines.filter(
    (line) => /[-:]\s*\d[\d.,]*\s*(?:k|000|₫|vnd)?\s*$/i.test(line)
      && !templates.some((dish) => new RegExp(`^${dish.replaceAll(' ', '\\s+')}\\s*[-:]`).test(line)),
  );
  return nonTemplatePricedRows.length <= 3;
};

// MiniCPM occasionally hallucinates a menu by extending one row repeatedly:
// "Bún riêu" -> "Bún riêu cá" -> "Bún riêu cá và ốc".  It can also return a
// long list of `- none` rows when no price is legible.  Neither output is safe
// exact-dish evidence, even when the top-level vision response says `isMenu`.
export const isProgressiveHallucination = (ocrText: string): boolean => {
  if (/the image shows|here is the information transcribed/i.test(ocrText)) return true;
  const lines = ocrText
    .split(/\r?\n/)
    .map((line) => normalizeText(line.replace(/\s*[-:–—]\s*(?:\d[\d.,]*\s*(?:k|000|₫|vnd)?|none)\s*$/i, '')))
    .filter(Boolean);
  if (lines.length < 3) return false;
  const noneCount = (ocrText.match(/[-:]\s*none\b/gi) ?? []).length;
  const pricedCount = (ocrText.match(/[-:]\s*\d[\d.,]*\s*(?:k|000|₫|vnd)?\b/gi) ?? []).length;
  if (noneCount >= 2 && pricedCount <= 2) return true;
  let extensions = 0;
  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1];
    const current = lines[index];
    if (current.startsWith(`${previous} `) || previous.startsWith(`${current} `)) extensions += 1;
  }
  return extensions >= 3;
};

/** Validates untrusted vision output before it can become restaurant data. */
export function parseMenuImageResult(value: unknown): MenuImageResult | null {
  const root = asRecord(value);
  if (!root || typeof root.isMenu !== 'boolean') return null;
  const ocrText = text(root.ocrText, 12_000) ?? '';
  const result: MenuImageResult = {
    isMenu: root.isMenu,
    confidence: confidence(root.confidence),
    ocrText,
    dishes: [],
  };
  if (result.isMenu && isTemplateContaminated(ocrText)) {
    return { ...result, isMenu: false, confidence: 0 };
  }
  if (result.isMenu && isProgressiveHallucination(ocrText)) {
    return { ...result, isMenu: false, confidence: 0, dishes: [] };
  }
  if (!result.isMenu || result.confidence < 0.65) return result;
  const unique = new Set<string>();
  for (const item of Array.isArray(root.dishes) ? root.dishes : []) {
    const row = asRecord(item);
    const name = text(row?.name, 160);
    if (!name) continue;
    const normalizedName = normalizeText(name);
    if (normalizedName.length < 2 || unique.has(normalizedName)) continue;
    if (!isPlausibleDishName(name, normalizedName)) continue;
    unique.add(normalizedName);
    const rawPrice = text(row?.rawPrice, 80);
    result.dishes.push({
      name,
      normalizedName,
      priceAmount: price(row?.priceAmount ?? rawPrice),
      currencyCode: 'VND',
      rawPrice,
    });
  }
  return result;
}

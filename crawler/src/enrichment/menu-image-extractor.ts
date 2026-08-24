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
  if (!result.isMenu || result.confidence < 0.65) return result;
  const unique = new Set<string>();
  for (const item of Array.isArray(root.dishes) ? root.dishes : []) {
    const row = asRecord(item);
    const name = text(row?.name, 160);
    if (!name) continue;
    const normalizedName = normalizeText(name);
    if (normalizedName.length < 2 || unique.has(normalizedName)) continue;
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

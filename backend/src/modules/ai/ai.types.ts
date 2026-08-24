// Structured intent produced by the runtime LLM for "Hỏi bếp".
//
// The LLM translates free-form Vietnamese into a bounded, validated object that
// maps to the exact SQL filters in `RestaurantsRepository.list`. Retrieval stays
// grounded in the database; the LLM never names restaurants itself. When the
// provider is not configured or errors, callers fall back to the deterministic
// `interpretQuery` rules in `search.controller.ts`.

export interface AiIntent {
  categories: string[];
  dishes: string[];
  tastes: string[];
  district: string | null;
  priceLevel: number | null;
  minRating: number | null;
  openNow: boolean | null;
  distanceKm: number | null;
  summary: string | null;
  semanticQuery: string | null;
  canonicalDishes: CanonicalDishIntent[];
}

export interface CanonicalDishIntent {
  dish: string;
  confidence: number;
  evidence: 'exact' | 'similarity';
}

export interface RawAiIntent {
  categories?: unknown;
  dishes?: unknown;
  tastes?: unknown;
  district?: unknown;
  priceLevel?: unknown;
  minRating?: unknown;
  openNow?: unknown;
  distanceKm?: unknown;
  summary?: unknown;
  semanticQuery?: unknown;
}

const firstStringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

// Canonical district strings recognized by the location taxonomy. The database
// currently stores "Quận 1".."Quận 12"; named HCMC districts are included so a
// future data refresh (adding Bình Thạnh, Gò Vấp, …) works without code changes.
export const HCMC_DISTRICT_NAMES = [
  'Quận 1',
  'Quận 2',
  'Quận 3',
  'Quận 4',
  'Quận 5',
  'Quận 6',
  'Quận 7',
  'Quận 8',
  'Quận 9',
  'Quận 10',
  'Quận 11',
  'Quận 12',
  'Bình Thạnh',
  'Gò Vấp',
  'Phú Nhuận',
  'Tân Bình',
  'Tân Phú',
  'Bình Tân',
  'Thủ Đức',
  'Hóc Môn',
  'Củ Chi',
  'Bình Chánh',
  'Nhà Bè',
  'Cần Giờ',
] as const;

const uniqueStrings = (value: unknown, options: { max: number; maxLength?: number }): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (options.maxLength !== undefined && trimmed.length > options.maxLength) continue;
    const key = trimmed.toLocaleLowerCase('vi-VN');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
    if (result.length >= options.max) break;
  }
  return result;
};

const validNumber = (value: unknown, min: number, max: number): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return value;
};

const normalizeDistrict = (value: string | null): string | null => {
  if (!value) return null;
  const match = value.trim().match(/^(?:quận|district|q)\s*(\d{1,2})$/i);
  if (match) return `Quận ${match[1]}`;
  const found = HCMC_DISTRICT_NAMES.find(
    (name) => name.toLocaleLowerCase('vi-VN') === value.trim().toLocaleLowerCase('vi-VN'),
  );
  return found ?? null;
};

const normalizeBoolean = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;

export function normalizeAiIntent(
  input: RawAiIntent,
  allowedCategories: ReadonlySet<string>,
): AiIntent {
  const lowerAllowed = new Set(
    [...allowedCategories].map((slug) => slug.toLocaleLowerCase('vi-VN')),
  );
  return {
    categories: uniqueStrings(input.categories, { max: 4, maxLength: 40 }).filter((slug) =>
      lowerAllowed.has(slug.toLocaleLowerCase('vi-VN')),
    ),
    dishes: uniqueStrings(input.dishes, { max: 8, maxLength: 60 }),
    tastes: uniqueStrings(input.tastes, { max: 8, maxLength: 40 }),
    district: normalizeDistrict(firstStringOrNull(input.district)),
    priceLevel: validNumber(input.priceLevel, 1, 4),
    minRating: validNumber(input.minRating, 3, 5),
    openNow: normalizeBoolean(input.openNow),
    distanceKm: validNumber(input.distanceKm, 1, 60),
    summary: firstStringOrNull(input.summary)?.slice(0, 200) ?? null,
    semanticQuery: firstStringOrNull(input.semanticQuery)?.slice(0, 200) ?? null,
    canonicalDishes: [],
  };
}

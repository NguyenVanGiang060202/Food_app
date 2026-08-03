export interface ParsedPlace {
  name: string | undefined;
  rating: number | undefined;
  reviewCount: number | undefined;
  address: string | undefined;
  category: string | undefined;
  url: string | undefined;
  phone: string | undefined;
  website: string | undefined;
  priceLevel: number | undefined;
  openingHours: ParsedOpeningHour[];
  coordinates: { latitude: number; longitude: number } | undefined;
  images?: Array<{ url: string; altText?: string; isCover?: boolean; sortOrder?: number }>;
  reviews: ParsedReview[];
}

export interface ParsedOpeningHour {
  dayOfWeek: number;
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
  spansNextDay?: boolean;
}

export interface ParsedReview {
  externalReviewId: string;
  rating: number | undefined;
  content: string | undefined;
  reviewedAt: string | undefined;
  languageCode: string | undefined;
}

export function parseRating(text: string | undefined | null): number | undefined {
  if (!text) return undefined;
  const cleaned = text.trim().replace(',', '.');
  const match = cleaned.match(/^(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const val = Number(match[1]);
  return Number.isFinite(val) && val >= 0 && val <= 5 ? val : undefined;
}

export function parseReviewCount(text: string | undefined | null): number | undefined {
  if (!text) return undefined;
  const cleaned = text.trim();
  if (!cleaned) return undefined;

  const toCount = (group: string): number | undefined => {
    const digits = group.replace(/[^0-9]/g, '');
    if (!digits) return undefined;
    const val = Number(digits);
    return Number.isFinite(val) && val >= 0 ? val : undefined;
  };

  const parenthesized = cleaned.match(/[([]\s*(\d[\d.,]*)\s*[)\]]/);
  if (parenthesized) return toCount(parenthesized[1]);

  const keywordMatch = cleaned.match(/(\d[\d.,]*)\s*(?:reviews?|đánh giá|review|avis)/i);
  if (keywordMatch) return toCount(keywordMatch[1]);

  const groups = cleaned.match(/\d[\d.,]*/g);
  if (!groups || groups.length === 0) return undefined;
  const last = groups[groups.length - 1];
  if (groups.length === 1 && /^\d[.,]\d$/.test(last) && Number(last.replace(',', '.')) <= 5) return undefined;
  return toCount(last);
}

export function isLikelyRestaurantName(name: string | undefined | null): boolean {
  if (!name?.trim()) return false;
  const normalized = name.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return !/(^|\b)(thanh pho|city|district|quan|phuong|ward|tinh|province|huyen|county)\b/.test(normalized);
}

export function parseCoordinatesFromUrl(url: string | undefined | null): { latitude: number; longitude: number } | undefined {
  if (!url) return undefined;
  const match = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
    ?? url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return undefined;
  return { latitude, longitude };
}

export function normalizeCategorySlug(category: string | undefined | null): string | undefined {
  if (!category?.trim()) return undefined;
  const normalized = category.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const aliases: Record<string, string> = {
    'coffee': 'coffee-shop',
    'coffee-shop': 'coffee-shop',
    'cafe': 'coffee-shop',
    'restaurant': 'restaurant',
    'vietnamese-restaurant': 'vietnamese',
    'vegetarian-restaurant': 'vegetarian',
    'quan-chay': 'vegetarian',
    'chay': 'vegetarian',
    'quan-an-viet-nam': 'vietnamese',
    'vietnamese-food': 'vietnamese',
  };
  return aliases[normalized] ?? normalized;
}

export function normalizeGoogleImageUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  if (!url.includes('googleusercontent.com')) return url;
  return url.replace(/=[^/?]+$/, '');
}

export function normalizeImages(images: Array<{ url: string; altText?: string }>): Array<{ url: string; altText?: string }> {
  const seen = new Map<string, { url: string; altText?: string }>();
  for (const image of images) {
    const normalized = normalizeGoogleImageUrl(image.url);
    if (!normalized) continue;
    const existing = seen.get(normalized);
    if (!existing || (image.altText && !existing.altText)) {
      seen.set(normalized, { url: normalized, altText: image.altText ?? existing?.altText });
    }
  }
  return Array.from(seen.values());
}

export function parseNameFromListItem(elementText: string | undefined | null): string | undefined {
  if (!elementText) return undefined;
  const trimmed = elementText.trim();
  return trimmed || undefined;
}

export function extractPlaceIdFromUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const cidMatch = url.match(/[?&]cid=([a-zA-Z0-9_\-]+)/);
  if (cidMatch) return cidMatch[1];
  const dataMatch = url.match(/!1s([a-zA-Z0-9_:]+)!/);
  if (dataMatch) return dataMatch[1];
  const placeMatch = url.match(/\/place\/([^/@?]+)/);
  if (placeMatch) return decodeURIComponent(placeMatch[1]);
  return undefined;
}

const REVIEW_UNIT_MS: Record<string, number> = {
  minute: 60_000, minutes: 60_000, phút: 60_000,
  hour: 3_600_000, hours: 3_600_000, giờ: 3_600_000,
  day: 86_400_000, days: 86_400_000, ngày: 86_400_000,
  week: 604_800_000, weeks: 604_800_000, tuần: 604_800_000,
  month: 2_592_000_000, months: 2_592_000_000, tháng: 2_592_000_000,
  year: 31_536_000_000, years: 31_536_000_000, năm: 31_536_000_000,
};

const REVIEW_NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, vài: 2,
  một: 1, hai: 2, ba: 3, bốn: 4, năm: 5, sáu: 6, bảy: 7, tám: 8, chín: 9, mười: 10,
};

const REVIEW_UNIT_PATTERN = 'minutes?|hours?|days?|weeks?|months?|years?|phút|giờ|ngày|tuần|tháng|năm';
const REVIEW_NUMBER_PATTERN = '\\d+(?:[.,]\\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|vài|một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười';

export function parseReviewDate(text: string | undefined | null): string | undefined {
  if (!text?.trim()) return undefined;
  const value = text.trim();

  const englishDate = value.match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})$/i,
  );
  if (englishDate) {
    const month = [
      'january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december',
    ].indexOf(englishDate[1].toLowerCase());
    const day = Number(englishDate[2]);
    const year = Number(englishDate[3]);
    if (month >= 0 && day >= 1 && day <= 31) {
      return new Date(Date.UTC(year, month, day)).toISOString();
    }
  }

  const isoDate = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) {
    return new Date(Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]))).toISOString();
  }

  const specials: Record<string, number> = { 'hôm nay': 0, today: 0, 'hôm qua': 1, yesterday: 1 };
  const special = specials[value.toLowerCase()];
  if (special !== undefined) {
    return new Date(Date.now() - special * 86_400_000).toISOString();
  }

  const relative = value.match(
    new RegExp(`^(?:(${REVIEW_NUMBER_PATTERN})\\s+)?(${REVIEW_UNIT_PATTERN})\\s+(?:trước|ago)$`, 'i'),
  );
  if (relative) {
    const numberText = relative[1];
    const unit = relative[2].toLowerCase();
    const unitMs = REVIEW_UNIT_MS[unit];
    if (!unitMs) return undefined;
    const amount = numberText
      ? (Number(numberText.replace(',', '.')) || REVIEW_NUMBER_WORDS[numberText.toLowerCase()])
      : 1;
    if (!Number.isFinite(amount) || amount <= 0) return undefined;
    return new Date(Date.now() - amount * unitMs).toISOString();
  }

  return undefined;
}

export function inferLanguageCode(text: string | undefined | null): string | undefined {
  if (!text?.trim()) return undefined;
  const sample = text.trim();
  if (/[ăâđêôơưĂÂĐÊÔƠƯ]/.test(sample)) return 'vi';
  if (/[a-zA-Z]/.test(sample)) return 'en';
  return undefined;
}

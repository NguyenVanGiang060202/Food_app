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

const MAX_REVIEW_COUNT = 1_000_000;

export function parseReviewCount(text: string | undefined | null): number | undefined {
  if (!text) return undefined;
  const cleaned = text.trim();
  if (!cleaned) return undefined;

  const toCount = (group: string): number | undefined => {
    const digits = group.replace(/[^0-9]/g, '');
    if (!digits) return undefined;
    const val = Number(digits);
    if (!Number.isFinite(val) || val < 0 || val > MAX_REVIEW_COUNT) return undefined;
    return val;
  };

  const parenthesized = cleaned.match(/[([]\s*(\d[\d.,]*)\s*[)\]]/);
  if (parenthesized) return toCount(parenthesized[1]);

  const keywordMatch = cleaned.match(/(\d[\d.,]*)\s*(?:reviews?|đánh giá|review|avis)/i);
  if (keywordMatch) return toCount(keywordMatch[1]);

  const groups = cleaned.match(/\d[\d.,]*/g);
  if (!groups || groups.length === 0) return undefined;
  const last = groups[groups.length - 1];
  if (groups.length === 1 && /^\d[.,]\d$/.test(last) && Number(last.replace(',', '.')) <= 5)
    return undefined;
  return toCount(last);
}

export function isLikelyRestaurantName(name: string | undefined | null): boolean {
  if (!name?.trim()) return false;
  const normalized = name
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return !/(^|\b)(thanh pho|city|district|quan|phuong|ward|tinh|province|huyen|county)\b/.test(
    normalized,
  );
}

function normalizeMatchKey(value: string | undefined | null): string | undefined {
  if (!value?.trim()) return undefined;
  return value
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Google's category label is a generic business type ("Bệnh viện", "Massage",
// "Siêu thị", ...), so whole-word matching is safe even when the place name
// itself looks like a food business. Spa/massage shops stay rejected here; a
// coffee shop whose name merely mentions "spa" survives because its category
// is "Coffee shop", not "Spa".
const NON_FOOD_CATEGORY_PATTERNS: RegExp[] = [
  /\bbenh vien\b/,
  /\bhospital\b/,
  /\bphong kham\b/,
  /\bclinic\b/,
  /\bmedical\b/,
  /\bnha khoa\b/,
  /\bdentist\b/,
  /\bdental\b/,
  /\bnha thuoc\b/,
  /\bpharmacy\b/,
  /\bkaraoke\b/,
  /\bktv\b/,
  /\bspa\b/,
  /\bmassage\b/,
  /\bnails\b/,
  /\bhair\b/,
  /\bbarber\b/,
  /\bsalon\b/,
  /\bcat toc\b/,
  /\btattoo\b/,
  /\bpiercing\b/,
  /\btrang trai\b/,
  /\bnong trai\b/,
  /\bnong truong\b/,
  /\bnong san\b/,
  /\bnong nghiep\b/,
  /\bfarm\b/,
  /\bsieu thi\b/,
  /\bsupermarket\b/,
  /\bmall\b/,
  /\bmarket\b/,
  /\bcho\b/,
  /\btap hoa\b/,
  /\btruong\b/,
  /\bschool\b/,
  /\buniversity\b/,
  /\bdai hoc\b/,
  /\bngan hang\b/,
  /\bbank\b/,
  /\bvan phong\b/,
  /\bchua\b/,
  /\bnha tho\b/,
  /\btemple\b/,
  /\bchurch\b/,
  /\bpagoda\b/,
  /\bhoi nghi\b/,
  /\byen tiec\b/,
  /\bconvention\b/,
  /\bwedding\b/,
  /\bsu kien\b/,
  /\bcay xang\b/,
  /\bgas station\b/,
  /\bsua xe\b/,
  /\brua xe\b/,
  /\bcar wash\b/,
  /\bgarage\b/,
  /\bkhach san\b/,
  /\bhotel\b/,
  /\bresort\b/,
  /\bhomestay\b/,
  /\bnha nghi\b/,
  /\bthu y\b/,
  /\bveterinarian\b/,
  /\bpet\b/,
  /\bgym\b/,
  /\bfitness\b/,
  /\bphong tap\b/,
  /\bhoa\b/,
  /\bflower\b/,
  /\bflorist\b/,
  /\bcay canh\b/,
  /\bdien thoai\b/,
  /\bmay tinh\b/,
  /\belectronics\b/,
  /\bbat dong san\b/,
  /\breal estate\b/,
  /\bchung cu\b/,
];

// Junk/misplaced names that are not real food businesses. Medical prefixes are
// anchored so legit names such as "PHỞ BÒ NGA - GẦN BỆNH VIỆN TÂN PHÚ"
// survive. Spa/massage words are intentionally absent from this name list so a
// coffee shop advertising "spa/massage" on its sign is still a food place.
const NON_FOOD_NAME_PATTERNS: RegExp[] = [
  /^cho\b/,
  /^benh vien\b/,
  /^nha khoa\b/,
  /^trung tam y te\b/,
  /^phong kham\b/,
  /^karaoke\b/,
  /\bktv\b/,
  /\bfarm\b/,
  /\btrang trai\b/,
  /\bnong trai\b/,
  /\bnong truong\b/,
  /\bnong san\b/,
  /^da dong cua\b/,
  /\bkhong ten\b/,
  /^go!/,
  /^trung tam (hoi nghi|yen tiec|su kien)\b/,
  /^(nha be|binh chanh|can gio|cu chi|hoc mon|thu duc)$/,
];

function isAddressOnlyName(key: string): boolean {
  if (!/^[0-9]/.test(key)) return false;
  return /\bphuong\b/.test(key) && /\bquan\b/.test(key) && /\bthanh pho\b/.test(key);
}

export function rejectsNonFoodPlace(
  name: string | undefined | null,
  category: string | undefined | null,
): boolean {
  const nameKey = normalizeMatchKey(name);
  const categoryKey = normalizeMatchKey(category);

  if (categoryKey && NON_FOOD_CATEGORY_PATTERNS.some((pattern) => pattern.test(categoryKey))) {
    return true;
  }
  if (nameKey) {
    if (NON_FOOD_NAME_PATTERNS.some((pattern) => pattern.test(nameKey))) return true;
    if (isAddressOnlyName(nameKey)) return true;
  }
  return false;
}

export function parseCoordinatesFromUrl(
  url: string | undefined | null,
): { latitude: number; longitude: number } | undefined {
  if (!url) return undefined;
  const match =
    url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) ??
    url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  )
    return undefined;
  return { latitude, longitude };
}

// Canonical slugs defined in database/seeds/001_reference_data.sql
const CANONICAL_CATEGORY_SLUGS = new Set([
  'vietnamese',
  'coffee-shop',
  'vegetarian',
  'noodle',
  'dessert',
  'bun',
  'rice',
  'snack',
  'beverage',
]);

// Ordered, specific-first label rules: the first pattern that matches the
// accent-free lowercase label wins, so "Bánh mì" maps to snack (not noodle).
const CATEGORY_LABEL_RULES: ReadonlyArray<{ slug: string; patterns: RegExp[] }> = [
  {
    slug: 'dessert',
    patterns: [
      /\bbanh kem\b/,
      /\bbanh ngot\b/,
      /\bsua chua\b/,
      /\bdessert\b/,
      /\btiramisu\b/,
      /\bmousse\b/,
      /\bbakery\b/,
      /\btrai cay\b/,
      /\btrang mieng\b/,
      /\bang ngot\b/,
    ],
  },
  {
    slug: 'snack',
    patterns: [
      /\bbanh mi\b/,
      /\ban vat\b/,
      /\bstreet food\b/,
      /\bfood truck\b/,
      /\bfast food\b/,
      /\bbanh xeo\b/,
      /\bgoi cuon\b/,
      /\bsnack\b/,
    ],
  },
  {
    slug: 'bun',
    patterns: [
      /\bbun cha\b/,
      /\bbun bo\b/,
      /\bbun rieu\b/,
      /\bbun thit nuong\b/,
      /\bbun oc\b/,
      /\bbun ca\b/,
      /\bbun gan\b/,
      /\bbun\b/,
    ],
  },
  {
    slug: 'noodle',
    patterns: [
      /\bpho\b/,
      /\bhu tieu\b/,
      /\bmi quang\b/,
      /\bmi xao\b/,
      /\bmi ga\b/,
      /\bbanh canh\b/,
      /\bnoodle\b/,
      /\bmy\b/,
      /\bmi\b/,
    ],
  },
  {
    slug: 'rice',
    patterns: [
      /\bcom suon\b/,
      /\bcom tam\b/,
      /\bcom ga\b/,
      /\bcom rang\b/,
      /\bcom thap cam\b/,
      /\bcom bo\b/,
      /\bcom chay\b/,
      /\brice\b/,
      /^com\b/,
    ],
  },
  {
    slug: 'beverage',
    patterns: [
      /\btra sua\b/,
      /\btra chanh\b/,
      /\bsinh to\b/,
      /\bnuoc ep\b/,
      /\bsmoothie\b/,
      /\bjuice\b/,
      /\bbubble tea\b/,
      /\bdo uong\b/,
      /\bdrink\b/,
    ],
  },
  {
    slug: 'coffee-shop',
    patterns: [
      /\bca phe\b/,
      /\bcoffee\b/,
      /\bcafe\b/,
      /\bcapuchino\b/,
      /\blatte\b/,
      /\bespresso\b/,
    ],
  },
  {
    slug: 'vegetarian',
    patterns: [/\bchay\b/, /\bvegan\b/, /\bvegetarian\b/],
  },
  {
    slug: 'vietnamese',
    patterns: [/\bvietnamese\b/, /\bquan an viet nam\b/, /\bmon viet\b/],
  },
];

function classifyCategoryLabel(text: string): string | undefined {
  for (const rule of CATEGORY_LABEL_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) return rule.slug;
  }
  return undefined;
}

export function normalizeCategorySlug(category: string | undefined | null): string | undefined {
  if (!category?.trim()) return undefined;
  const normalized = category
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  const matched = classifyCategoryLabel(normalized);
  if (matched) return matched;

  const slug = normalized
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (CANONICAL_CATEGORY_SLUGS.has(slug)) return slug;

  const aliases: Record<string, string> = {
    coffee: 'coffee-shop',
    cafe: 'coffee-shop',
    restaurant: 'restaurant',
    'vietnamese-restaurant': 'vietnamese',
    'quan-an-viet-nam': 'vietnamese',
    'vietnamese-food': 'vietnamese',
  };
  return aliases[slug] ?? undefined;
}

export function normalizeGoogleImageUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  if (!isRestaurantPhotoUrl(url)) return undefined;
  if (!url.includes('googleusercontent.com')) return url;
  return url.replace(/=[^/?]+$/, '');
}

const MAX_IMAGE_URL_LENGTH = 2000;

export function isRestaurantPhotoUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  if (url.length > MAX_IMAGE_URL_LENGTH) return false;
  const blocked =
    url.includes('/maps/vt/') ||
    url.includes('streetviewpixels') ||
    url.includes('googlesyndication') ||
    url.includes('google.com/maps') ||
    url.includes('gstatic.com') ||
    url.includes('googleusercontent.com/googlelogo') ||
    url.includes('/a-/ALV-') ||
    /\/a\/[^/]+\d+$/.test(url);
  return !blocked;
}

export function normalizeImages(
  images: Array<{ url: string; altText?: string }>,
): Array<{ url: string; altText?: string }> {
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
  minute: 60_000,
  minutes: 60_000,
  phút: 60_000,
  hour: 3_600_000,
  hours: 3_600_000,
  giờ: 3_600_000,
  day: 86_400_000,
  days: 86_400_000,
  ngày: 86_400_000,
  week: 604_800_000,
  weeks: 604_800_000,
  tuần: 604_800_000,
  month: 2_592_000_000,
  months: 2_592_000_000,
  tháng: 2_592_000_000,
  year: 31_536_000_000,
  years: 31_536_000_000,
  năm: 31_536_000_000,
};

const REVIEW_NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  vài: 2,
  một: 1,
  hai: 2,
  ba: 3,
  bốn: 4,
  năm: 5,
  sáu: 6,
  bảy: 7,
  tám: 8,
  chín: 9,
  mười: 10,
};

const REVIEW_UNIT_PATTERN =
  'minutes?|hours?|days?|weeks?|months?|years?|phút|giờ|ngày|tuần|tháng|năm';
const REVIEW_NUMBER_PATTERN =
  '\\d+(?:[.,]\\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|vài|một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười';

export function parseReviewDate(text: string | undefined | null): string | undefined {
  if (!text?.trim()) return undefined;
  const value = text.trim();

  const englishDate = value.match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})$/i,
  );
  if (englishDate) {
    const month = [
      'january',
      'february',
      'march',
      'april',
      'may',
      'june',
      'july',
      'august',
      'september',
      'october',
      'november',
      'december',
    ].indexOf(englishDate[1].toLowerCase());
    const day = Number(englishDate[2]);
    const year = Number(englishDate[3]);
    if (month >= 0 && day >= 1 && day <= 31) {
      return new Date(Date.UTC(year, month, day)).toISOString();
    }
  }

  const isoDate = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) {
    return new Date(
      Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3])),
    ).toISOString();
  }

  const specials: Record<string, number> = { 'hôm nay': 0, today: 0, 'hôm qua': 1, yesterday: 1 };
  const special = specials[value.toLowerCase()];
  if (special !== undefined) {
    return new Date(Date.now() - special * 86_400_000).toISOString();
  }

  const relative = value.match(
    new RegExp(
      `^(?:(${REVIEW_NUMBER_PATTERN})\\s+)?(${REVIEW_UNIT_PATTERN})\\s+(?:trước|ago)$`,
      'i',
    ),
  );
  if (relative) {
    const numberText = relative[1];
    const unit = relative[2].toLowerCase();
    const unitMs = REVIEW_UNIT_MS[unit];
    if (!unitMs) return undefined;
    const amount = numberText
      ? Number(numberText.replace(',', '.')) || REVIEW_NUMBER_WORDS[numberText.toLowerCase()]
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

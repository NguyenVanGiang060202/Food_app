// Deterministic Vietnamese category classifier for enrichment.
//
// Rules are keyword/pattern based over an accent-free lowercase text so the
// result is explainable and unit-testable. Precision-first: an unknown name
// yields no suggestion rather than a guessed category. AI is intentionally not
// used here so enrichment stays deterministic (docs/05 principle 2.6).

export interface CategorySuggestion {
  slug: string;
  confidence: number;
}

interface Rule {
  slug: string;
  patterns: RegExp[];
  confidence: number;
}

// Anchor-only patterns must match the start of the name (a shop called
// "Cơm tấm ..."). Substring patterns can appear anywhere.
const RULES: Rule[] = [
  {
    slug: 'coffee-shop',
    patterns: [/\bca phe\b/, /\bcoffee\b/, /\bcafe\b/, /\bcapuchino\b/, /\blatte\b/, /\bespresso\b/],
    confidence: 0.95,
  },
  {
    slug: 'beverage',
    patterns: [/\btra sua\b/, /\btra chanh\b/, /\bsinh to\b/, /\bnuoc ep\b/, /\bsmoothie\b/, /\bjuice\b/],
    confidence: 0.9,
  },
  {
    slug: 'vegetarian',
    patterns: [/\bchay\b/, /\bvegan\b/, /\bvegetarian\b/],
    confidence: 0.95,
  },
  {
    slug: 'dessert',
    patterns: [
      /\bbanh kem\b/,
      /\bbanh ngot\b/,
      /\bsua chua\b/,
      /\bdessert\b/,
      /\btiramisu\b/,
      /\bmousse\b/,
    ],
    confidence: 0.9,
  },
  {
    slug: 'bun',
    patterns: [/\bbun(?: bo| rieu| cha| ca| oc| thit nuong| ga| hen| mang)?\b/],
    confidence: 0.85,
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
      /(?<!banh )\bmi\b/,
      /\bnoodle\b/,
    ],
    confidence: 0.85,
  },
  {
    slug: 'rice',
    patterns: [
      /^com\b/,
      /\bcom tam\b/,
      /\bcom rang\b/,
      /\bcom ga\b/,
      /\bcom suon\b/,
      /\bcom thap cam\b/,
      /\bcom bo\b/,
    ],
    confidence: 0.9,
  },
  {
    slug: 'snack',
    patterns: [
      /\bbanh mi\b/,
      /\bbanh xeo\b/,
      /\bbanh cuon\b/,
      /\bbanh bao\b/,
      /\bgoi cuon\b/,
      /\bcha gio\b/,
      /\bbanh trang tron\b/,
      /\bbot chien\b/,
      /\ban vat\b/,
      /\bstreet food\b/,
    ],
    confidence: 0.85,
  },
  {
    slug: 'vietnamese',
    patterns: [/\bmon viet\b/, /\ban viet\b/, /\bvietnamese\b/, /\bcom viec\b/],
    confidence: 0.8,
  },
];

// Normalize Vietnamese text to a comparison form (lowercase, no diacritics).
export function normalizeForClassification(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('vi-VN')
    .replace(/\s+/g, ' ');
}

export function classifyCategory(name: string | undefined | null): CategorySuggestion | undefined {
  const haystack = normalizeForClassification(name ?? '');
  if (!haystack) return undefined;

  let bestConfidence = 0;
  const topSlugs = new Set<string>();
  for (const rule of RULES) {
    if (!rule.patterns.some((pattern) => pattern.test(haystack))) continue;
    if (rule.confidence > bestConfidence) {
      bestConfidence = rule.confidence;
      topSlugs.clear();
      topSlugs.add(rule.slug);
    } else if (rule.confidence === bestConfidence) {
      topSlugs.add(rule.slug);
    }
  }

  // Ambiguous equal-confidence matches are skipped to protect precision.
  const first = topSlugs.values().next().value;
  return topSlugs.size === 1 && first !== undefined
    ? { slug: first, confidence: bestConfidence }
    : undefined;
}

export const CATEGORY_MIN_CONFIDENCE = 0.75;

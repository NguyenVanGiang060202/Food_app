// Deterministic Vietnamese dish extractor for enrichment.
//
// Derives candidate dish names from restaurant names and visible review text.
// Only known dish phrases from a curated lexicon are recognized; nothing is
// invented, and no price is inferred (README Data Quality Policy). Phrases are
// matched on an accent-free lowercase comparison form so the result is stable
// and unit-testable.

export interface DishSuggestion {
  normalized: string;
  display: string;
  confidence: number;
}

interface DishEntry {
  normalized: string;
  display: string;
  confidence: number;
}

const LEXICON: DishEntry[] = [
  // Phở
  { normalized: 'pho bo', display: 'Phở bò', confidence: 0.95 },
  { normalized: 'pho ga', display: 'Phở gà', confidence: 0.95 },
  { normalized: 'pho tai', display: 'Phở tái', confidence: 0.9 },
  { normalized: 'pho chin', display: 'Phở chín', confidence: 0.9 },
  // Bún
  { normalized: 'bun bo hue', display: 'Bún bò Huế', confidence: 0.95 },
  { normalized: 'bun rieu', display: 'Bún riêu', confidence: 0.95 },
  { normalized: 'bun cha', display: 'Bún chả', confidence: 0.95 },
  { normalized: 'bun oc', display: 'Bún ốc', confidence: 0.9 },
  { normalized: 'bun ga', display: 'Bún gà', confidence: 0.9 },
  { normalized: 'bun ca', display: 'Bún cá', confidence: 0.9 },
  { normalized: 'bun thit nuong', display: 'Bún thịt nướng', confidence: 0.9 },
  { normalized: 'bun mam', display: 'Bún mắm', confidence: 0.9 },
  // Hủ tiếu, mì
  { normalized: 'hu tieu nam vang', display: 'Hủ tiếu Nam Vang', confidence: 0.95 },
  { normalized: 'hu tieu mi', display: 'Hủ tiếu mì', confidence: 0.9 },
  { normalized: 'hu tieu ga', display: 'Hủ tiếu gà', confidence: 0.9 },
  { normalized: 'mi quang', display: 'Mì Quảng', confidence: 0.95 },
  { normalized: 'mi xao gion', display: 'Mì xào giòn', confidence: 0.9 },
  { normalized: 'mi ga', display: 'Mì gà', confidence: 0.9 },
  { normalized: 'mi vit tim', display: 'Mì vịt tiềm', confidence: 0.95 },
  // Bánh
  { normalized: 'banh mi thit', display: 'Bánh mì thịt', confidence: 0.9 },
  { normalized: 'banh mi trung', display: 'Bánh mì trứng', confidence: 0.9 },
  { normalized: 'banh mi chao', display: 'Bánh mì chảo', confidence: 0.9 },
  { normalized: 'banh xeo', display: 'Bánh xèo', confidence: 0.95 },
  { normalized: 'banh cuon', display: 'Bánh cuốn', confidence: 0.9 },
  { normalized: 'banh canh', display: 'Bánh canh', confidence: 0.9 },
  { normalized: 'banh trang tron', display: 'Bánh tráng trộn', confidence: 0.95 },
  { normalized: 'banh bao', display: 'Bánh bao', confidence: 0.9 },
  { normalized: 'banh bot chien', display: 'Bánh bột chiên', confidence: 0.9 },
  { normalized: 'banh tieu', display: 'Bánh tiêu', confidence: 0.85 },
  { normalized: 'banh flan', display: 'Bánh flan', confidence: 0.9 },
  { normalized: 'banh kem', display: 'Bánh kem', confidence: 0.9 },
  // Cơm
  { normalized: 'com tam', display: 'Cơm tấm', confidence: 0.95 },
  { normalized: 'com rang', display: 'Cơm rang', confidence: 0.9 },
  { normalized: 'com ga', display: 'Cơm gà', confidence: 0.9 },
  { normalized: 'com suon', display: 'Cơm sườn', confidence: 0.9 },
  { normalized: 'com thap cam', display: 'Cơm thập cẩm', confidence: 0.9 },
  { normalized: 'com bo luc lac', display: 'Cơm bò lúc lắc', confidence: 0.95 },
  { normalized: 'com hen', display: 'Cơm hến', confidence: 0.95 },
  { normalized: 'com chay', display: 'Cơm chay', confidence: 0.9 },
  // Gỏi, nem, chả
  { normalized: 'goi cuon', display: 'Gỏi cuốn', confidence: 0.95 },
  { normalized: 'cha gio', display: 'Chả giò', confidence: 0.9 },
  { normalized: 'nem ran', display: 'Nem rán', confidence: 0.9 },
  { normalized: 'nem nuong', display: 'Nem nướng', confidence: 0.9 },
  // Cháo, xôi
  { normalized: 'chao ga', display: 'Cháo gà', confidence: 0.9 },
  { normalized: 'chao long', display: 'Cháo lòng', confidence: 0.9 },
  { normalized: 'xoi ga', display: 'Xôi gà', confidence: 0.9 },
  { normalized: 'xoi man', display: 'Xôi mặn', confidence: 0.85 },
  // Lẩu, nướng
  { normalized: 'lau bo', display: 'Lẩu bò', confidence: 0.9 },
  { normalized: 'lau ga', display: 'Lẩu gà', confidence: 0.9 },
  { normalized: 'lau tom', display: 'Lẩu tôm', confidence: 0.9 },
  { normalized: 'lau oc', display: 'Lẩu ốc', confidence: 0.9 },
  { normalized: 'ga nuong', display: 'Gà nướng', confidence: 0.85 },
  { normalized: 'suon nuong', display: 'Sườn nướng', confidence: 0.85 },
  { normalized: 'bo nuong', display: 'Bò nướng', confidence: 0.85 },
  // Tráng miệng, đồ uống
  { normalized: 'sua chua nep cam', display: 'Sữa chua nếp cẩm', confidence: 0.95 },
  { normalized: 'che ba mau', display: 'Chè ba màu', confidence: 0.9 },
  { normalized: 'che dau xanh', display: 'Chè đậu xanh', confidence: 0.9 },
  { normalized: 'tra sua tran chau', display: 'Trà sữa trân châu', confidence: 0.95 },
  { normalized: 'ca phe sua da', display: 'Cà phê sữa đá', confidence: 0.95 },
  { normalized: 'ca phe den', display: 'Cà phê đen', confidence: 0.9 },
  { normalized: 'nuoc mia', display: 'Nước mía', confidence: 0.95 },
  { normalized: 'sinh to xoai', display: 'Sinh tố xoài', confidence: 0.9 },
];

const SORTED = [...LEXICON].sort(
  (a, b) => b.normalized.length - a.normalized.length || a.normalized.localeCompare(b.normalized),
);

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('vi-VN')
    .replace(/\s+/g, ' ')
    .trim();
}

const boundary = (term: string): RegExp =>
  new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}($|[^a-z0-9])`, 'i');

function collect(text: string): Set<string> {
  const hit = new Set<string>();
  const haystack = normalizeText(text);
  if (!haystack) return hit;
  for (const entry of SORTED) {
    if (boundary(entry.normalized).test(haystack)) hit.add(entry.normalized);
  }
  return hit;
}

export interface DishExtraction {
  restaurantId: string;
  name: string;
  suggestions: DishSuggestion[];
}

// Extracts dish candidates for one restaurant from its name and review content.
// A phrase found in the restaurant name is the strongest signal; otherwise the
// more distinct reviews mention it, the higher the confidence.
export function extractDishesFromText(
  restaurantId: string,
  name: string,
  reviews: string[],
): DishSuggestion[] {
  const found = new Map<string, { display: string; base: number }>();
  const mentionCount = new Map<string, number>();
  const nameHits = collect(name ?? '');

  for (const review of reviews) {
    const hit = collect(review);
    for (const normalized of hit) {
      mentionCount.set(normalized, (mentionCount.get(normalized) ?? 0) + 1);
    }
  }

  for (const normalized of new Set([...nameHits, ...mentionCount.keys()])) {
    if (!found.has(normalized)) {
      const entry = SORTED.find((candidate) => candidate.normalized === normalized);
      if (entry) found.set(normalized, { display: entry.display, base: entry.confidence });
    }
  }

  const suggestions: DishSuggestion[] = [];
  for (const [normalized, value] of found) {
    const inName = nameHits.has(normalized);
    const count = mentionCount.get(normalized) ?? 0;
    const confidence = inName ? 0.95 : count >= 2 ? 0.9 : count === 1 ? 0.7 : value.base;
    suggestions.push({ normalized, display: value.display, confidence });
  }
  return suggestions;
}


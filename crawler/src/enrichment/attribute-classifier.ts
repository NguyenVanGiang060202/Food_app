// Deterministic Vietnamese food-attribute classifier for enrichment.
//
// Maps a known dish phrase (from the dish lexicon) to a curated set of
// attribute codes from the `food_attribute` taxonomy (khẩu vị, nguyên liệu,
// cách ăn, cảm giác). Like category classification this is an explainable
// curated lookup, NOT a model: precision-first and stable, so a dish either
// resolves to a known set of codes or to nothing.

// Attribute codes are the `code` values defined in
// database/migrations/024_food_attribute_taxonomy.sql. Keep them in sync.
export interface AttributeSuggestion {
  code: string;
  confidence: number;
}

// Curated lookup from a dish's accent-free normalized phrase to attribute
// codes. Confidence is fixed because the mapping is deterministic knowledge,
// not a statistical guess.
const DISH_ATTRIBUTES: Record<string, string[]> = {
  // Phở
  'pho bo': ['hot', 'beef'],
  'pho ga': ['hot', 'chicken'],
  'pho tai': ['hot', 'beef'],
  'pho chin': ['hot', 'beef'],
  // Bún
  'bun bo hue': ['hot', 'spicy', 'beef', 'filling'],
  'bun rieu': ['hot', 'spicy', 'crab', 'filling'],
  'bun cha': ['grilled', 'pork', 'street'],
  'bun oc': ['hot', 'snail', 'filling'],
  'bun ga': ['hot', 'chicken', 'filling'],
  'bun ca': ['hot', 'fish', 'filling'],
  'bun thit nuong': ['grilled', 'sweet', 'pork', 'filling'],
  'bun mam': ['hot', 'salty', 'bold', 'seafood'],
  // Hủ tiếu, mì
  'hu tieu nam vang': ['hot', 'pork', 'shrimp', 'filling'],
  'hu tieu mi': ['hot', 'filling'],
  'hu tieu ga': ['hot', 'chicken', 'filling'],
  'mi quang': ['hot', 'pork', 'shrimp', 'filling'],
  'mi xao gion': ['fried', 'crispy', 'pork', 'shrimp', 'filling'],
  'mi ga': ['hot', 'chicken', 'filling'],
  'mi vit tim': ['hot'],
  // Bánh
  'banh mi thit': ['street', 'pork', 'filling'],
  'banh mi trung': ['street', 'egg'],
  'banh mi chao': ['street', 'fried', 'pork', 'egg', 'filling'],
  'banh xeo': ['street', 'fried', 'crispy', 'pork', 'shrimp'],
  'banh cuon': ['steamed', 'light', 'pork'],
  'banh canh': ['hot', 'filling'],
  'banh trang tron': ['street', 'snack', 'spicy'],
  'banh bao': ['steamed', 'snack', 'pork', 'filling'],
  'banh bot chien': ['street', 'fried', 'crispy', 'snack'],
  'banh tieu': ['sweet', 'snack'],
  'banh flan': ['sweet', 'cool', 'snack'],
  'banh kem': ['sweet', 'snack'],
  // Cơm
  'com tam': ['grilled', 'pork', 'filling'],
  'com rang': ['fried', 'filling'],
  'com ga': ['fried', 'chicken', 'filling'],
  'com suon': ['grilled', 'pork', 'filling'],
  'com thap cam': ['pork', 'filling'],
  'com bo luc lac': ['beef', 'filling'],
  'com hen': ['light', 'fresh', 'filling'],
  'com chay': ['vegetarian', 'light'],
  // Gỏi, nem, chả
  'goi cuon': ['fresh', 'light', 'pork', 'shrimp'],
  'cha gio': ['fried', 'crispy', 'pork'],
  'nem ran': ['fried', 'crispy', 'pork'],
  'nem nuong': ['grilled', 'sweet', 'pork', 'street'],
  // Cháo, xôi
  'chao ga': ['hot', 'light-belly', 'chicken'],
  'chao long': ['hot', 'light-belly'],
  'xoi ga': ['street', 'chicken', 'filling'],
  'xoi man': ['street', 'filling'],
  // Lẩu, nướng
  'lau bo': ['hot', 'beef', 'filling'],
  'lau ga': ['hot', 'chicken', 'filling'],
  'lau tom': ['hot', 'seafood', 'shrimp', 'filling'],
  'lau oc': ['hot', 'snail', 'filling'],
  'ga nuong': ['grilled', 'chicken'],
  'suon nuong': ['grilled', 'pork'],
  'bo nuong': ['grilled', 'beef'],
  // Tráng miệng, đồ uống
  'sua chua nep cam': ['sweet', 'cool', 'snack'],
  'che ba mau': ['sweet', 'cool', 'snack'],
  'che dau xanh': ['sweet', 'cool', 'snack'],
  'tra sua tran chau': ['sweet', 'cool', 'snack'],
  'ca phe sua da': ['sweet', 'cool'],
  'ca phe den': ['cool'],
  'nuoc mia': ['sweet', 'cool', 'fresh'],
  'sinh to xoai': ['sweet', 'cool', 'fresh'],
};

const ATTRIBUTE_CONFIDENCE = 0.9;

export function classifyAttributes(normalizedDish: string): AttributeSuggestion[] {
  const codes = DISH_ATTRIBUTES[normalizedDish];
  if (!codes) return [];
  return codes.map((code) => ({ code, confidence: ATTRIBUTE_CONFIDENCE }));
}

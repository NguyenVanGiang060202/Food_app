import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Optional,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  InterpretSearchDto,
  ListRestaurantsQueryDto,
  RecommendationDto,
  RecommendationInteractionDto,
  RestaurantSort,
} from '../restaurants/restaurants.dto';
import { RestaurantsService } from '../restaurants/restaurants.service';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { AiIntentService } from '../ai/ai-intent.service';
import { EmbeddingService } from '../ai/embedding.service';
import type { AiIntent, CanonicalDishIntent } from '../ai/ai.types';
import type { RestaurantFilters } from '../restaurants/restaurants.types';
import { RecommendationEventsRepository } from './recommendation-events.repository';

interface InterpretedFilters {
  category?: string;
  /** True when the category came from an explicit dish-type word (bún, cơm, phở…). */
  categoryFromDishType?: boolean;
  district?: string;
  attributes: string[];
  tastes: string[];
  /** Deterministic fallback for the embedding input when the LLM is offline. */
  semanticQuery?: string;
  /** Weather-derived comfort taste ("nóng" for rain/cold, "mát" for heat). */
  comfortTaste?: string;
  dishStyle?: 'dry' | 'brothy';
  /** The query reduced to meaningful food terms only (filler/location/taste words removed). */
  query?: string;
  /** The user-written menu phrase before cuisine/taste extraction, for exact catalog lookup. */
  menuLookupQuery?: string;
}

interface AuthenticatedRequest {
  user?: AuthUser;
  params?: { restaurantId?: string };
}

interface RecommendationUnderstanding {
  query: string;
  aiSummary: string | null;
  filters: {
    category?: string;
    district?: string;
    attributes: string[];
    tastes: string[];
    excludedFoods?: string[];
    ingredients?: string[];
    dishes?: Array<{ dish: string; confidence: number; evidence: string }>;
    dishStyle?: 'dry' | 'brothy';
    priceLevel?: number;
    minRating?: number;
    openNow?: boolean;
    distanceKm?: number;
  };
}

const dishUnderstanding = (dishQueries: string[], intent: AiIntent | null): CanonicalDishIntent[] =>
  dishQueries.map(
    (dish) =>
      intent?.canonicalDishes?.find(
        (candidate) =>
          candidate.dish.toLocaleLowerCase('vi-VN') === dish.toLocaleLowerCase('vi-VN'),
      ) ?? { dish, confidence: 1, evidence: 'menu_evidence' },
  );

const DISH_TYPE_ALIASES: ReadonlyArray<readonly [string, string]> = [
  // "bánh mì" is a sandwich, NOT a noodle dish — it must be matched as a whole
  // phrase before the shorter "mì" alias fires, otherwise a "bánh mì" query is
  // misread as `noodle` and returns hủ tiếu/bánh canh.
  ['bánh mì', 'snack'],
  ['bún', 'bun'],
  ['mì / phở', 'noodle'],
  ['mì', 'noodle'],
  ['phở', 'noodle'],
  ['cơm', 'rice'],
  ['ăn vặt', 'snack'],
  ['đồ uống', 'beverage'],
];

const CATEGORY_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['coffee-shop', 'coffee-shop'],
  ['cà phê', 'coffee-shop'],
  ['cafe', 'coffee-shop'],
  ['coffee', 'coffee-shop'],
  ['vegetarian', 'vegetarian'],
  ['chay', 'vegetarian'],
  ['italian', 'italian'],
  ['món ý', 'italian'],
  ['ẩm thực ý', 'italian'],
  ['vietnamese', 'vietnamese'],
  ['việt', 'vietnamese'],
  ['phở', 'noodle'],
  ['noodle', 'noodle'],
  ['món việt', 'vietnamese'],
  ['ẩm thực việt', 'vietnamese'],
  ['bbq', 'bbq'],
  ['nướng', 'bbq'],
  ['sushi', 'sushi'],
  ['pizza', 'pizza'],
  ['lẩu', 'hotpot'],
  ['hotpot', 'hotpot'],
  ['hàn quốc', 'korean'],
  ['korean', 'korean'],
  ['hải sản', 'seafood'],
  ['seafood', 'seafood'],
  ['tráng miệng', 'dessert'],
  ['dessert', 'dessert'],
  ['kem', 'dessert'],
  ['chè', 'dessert'],
  ['bánh ngọt', 'dessert'],
  ['bánh kem', 'dessert'],
  ['sữa chua', 'dessert'],
];

// Category aliases are merged with dish-type aliases so a chat prompt like
// "bún bò huế" resolves to the `bun` category filter, not just a text match.
const ALL_CATEGORY_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ...DISH_TYPE_ALIASES,
  ...CATEGORY_ALIASES,
];

// Only these slugs are guaranteed by the reference taxonomy. Other aliases
// are still useful for interpretation/explanations, but must not become an
// SQL category filter until the corresponding taxonomy exists in the DB.
const FILTERABLE_CATEGORY_SLUGS = new Set([
  'coffee-shop',
  'vegetarian',
  'vietnamese',
  'noodle',
  'dessert',
  'bun',
  'rice',
  'snack',
  'beverage',
]);

// A recommendations cursor carries the fully resolved filters (including any
// AI interpretation and taxonomy fallbacks) plus an offset, so a later page
// re-runs the exact same query deterministically without invoking the LLM
// again. The repository itself only understands a bare { offset } cursor.
interface RecommendationCursorPayload {
  offset: number;
  filters: Omit<RestaurantFilters, 'limit'>;
}
const encodeOffsetCursor = (offset: number): string =>
  Buffer.from(JSON.stringify({ offset })).toString('base64url');
const decodeOffsetCursor = (cursor: string | null): number | null => {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      offset?: number;
    };
    return typeof parsed.offset === 'number' ? parsed.offset : null;
  } catch {
    return null;
  }
};
const encodeRecommendationCursor = (payload: RecommendationCursorPayload): string =>
  Buffer.from(JSON.stringify(payload)).toString('base64url');
const decodeRecommendationCursor = (cursor: string): RecommendationCursorPayload | null => {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as RecommendationCursorPayload;
    if (
      !parsed ||
      typeof parsed.offset !== 'number' ||
      !parsed.filters ||
      typeof parsed.filters !== 'object'
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Removes a whole word/phrase (case-insensitive, Unicode word boundaries) so
// "bình thạnh" is stripped as a unit instead of leaving "thạnh" behind.
const removePhrase = (text: string, phrase: string): string =>
  text.replace(
    new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(phrase)}(?=$|[^\\p{L}\\p{N}])`, 'giu'),
    ' ',
  );

const DISTRICT_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['quận 12', 'Quận 12'],
  ['district 12', 'Quận 12'],
  ['quận 11', 'Quận 11'],
  ['district 11', 'Quận 11'],
  ['quận 10', 'Quận 10'],
  ['district 10', 'Quận 10'],
  ['quận 9', 'Quận 9'],
  ['district 9', 'Quận 9'],
  ['quận 8', 'Quận 8'],
  ['district 8', 'Quận 8'],
  ['quận 7', 'Quận 7'],
  ['district 7', 'Quận 7'],
  ['quận 6', 'Quận 6'],
  ['district 6', 'Quận 6'],
  ['quận 5', 'Quận 5'],
  ['district 5', 'Quận 5'],
  ['quận 4', 'Quận 4'],
  ['district 4', 'Quận 4'],
  ['quận 3', 'Quận 3'],
  ['district 3', 'Quận 3'],
  ['quận 2', 'Quận 2'],
  ['district 2', 'Quận 2'],
  ['quận 1', 'Quận 1'],
  ['district 1', 'Quận 1'],
  ['bình thạnh', 'Bình Thạnh'],
  ['gò vấp', 'Gò Vấp'],
  ['phú nhuận', 'Phú Nhuận'],
  ['tân bình', 'Tân Bình'],
  ['tân phú', 'Tân Phú'],
  ['bình tân', 'Bình Tân'],
  ['thủ đức', 'Thủ Đức'],
  ['hóc môn', 'Hóc Môn'],
  ['củ chi', 'Củ Chi'],
  ['bình chánh', 'Bình Chánh'],
  ['nhà bè', 'Nhà Bè'],
  ['cần giờ', 'Cần Giờ'],
];

const TASTE_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['ngọt', 'ngọt'],
  ['ngọt ngọt', 'ngọt'],
  ['chua chua', 'chua'],
  ['chua ngọt', 'chua'],
  ['thanh mát', 'mát'],
  ['béo ngậy', 'béo'],
  ['cay nhẹ', 'cay'],
  ['cay', 'cay'],
  ['mặn', 'mặn'],
  ['chua', 'chua'],
  ['béo', 'béo'],
  ['nóng', 'nóng'],
  ['mát', 'mát'],
  ['lạnh', 'mát'],
  ['giòn', 'giòn'],
  ['hấp', 'hấp'],
  ['nướng', 'nướng'],
  ['chiên dầu nhiều', 'thanh đạm'],
  ['đồ chiên dầu nhiều', 'thanh đạm'],
  ['chiên', 'chiên'],
  // Normalize low-oil wording into the deterministic light-food filter.
  ['ít dầu mỡ', 'thanh đạm'],
  ['ít dầu', 'thanh đạm'],
  ['thanh đạm', 'thanh đạm'],
  ['nhẹ bụng', 'nhẹ bụng'],
  ['nhẹ', 'nhẹ bụng'],
  ['no lâu', 'no lâu'],
  ['đầy bữa', 'đầy bữa'],
  ['đậm đà', 'đậm đà'],
  ['đậm vị', 'đậm đà'],
  ['nhiều gia vị', 'đậm đà'],
  ['tươi', 'tươi'],
  ['khô', 'khô'],
  ['món nước', 'nước'],
  ['đồ nước', 'nước'],
  ['nước dùng', 'nước'],
  ['nước', 'nước'],
];

// Weather words that imply a comfort-food direction without the user naming a
// taste. Cold/rainy weather → hot hearty dishes ("trời mưa" → "nóng"); hot/sunny
// weather → cold, refreshing dishes ("trời nóng" → "mát"). Kept separate from
// TASTE_ALIASES so the weather reading wins ("trời nóng" must never become the
// hot-food taste "nóng") and the taste stays AND-able as an exact attribute.
const WEATHER_COMFORT_PHRASES: ReadonlyArray<readonly [string, string]> = [
  // Cold / rainy → hot comfort food.
  ['hiện tại trời đang mưa', 'nóng'],
  ['trời đang mưa', 'nóng'],
  ['đang mưa', 'nóng'],
  ['trời mưa', 'nóng'],
  ['mưa rét', 'nóng'],
  ['trời lạnh', 'nóng'],
  ['trời trở lạnh', 'nóng'],
  ['lạnh buốt', 'nóng'],
  ['se lạnh', 'nóng'],
  ['mùa mưa', 'nóng'],
  ['gió lạnh', 'nóng'],
  // Hot / sunny → cold, refreshing food. Longer phrases first so compound
  // readings like "trời nắng nóng" are consumed whole before a shorter phrase
  // leaves a stray "nóng" behind (which TASTE_ALIASES would read as hot food).
  ['trời đang nóng', 'mát'],
  ['trời nắng nóng', 'mát'],
  ['thời tiết nóng', 'mát'],
  ['nắng nóng', 'mát'],
  ['nóng bức', 'mát'],
  ['nóng nực', 'mát'],
  ['nắng gắt', 'mát'],
  ['oi bức', 'mát'],
  ['trời nóng', 'mát'],
  ['trời nắng', 'mát'],
  ['trời oi', 'mát'],
];

// Semantic phrase embedded for a weather-derived comfort taste. "Mát" must not
// reuse the hot-food template ("món mát ấm bụng" is contradictory), so it gets
// its own cold/refreshing phrasing.
const COMFORT_SEMANTIC_QUERY: Readonly<Record<string, string>> = {
  nóng: 'món nóng ấm bụng',
  mát: 'món mát lạnh',
};

const FILLER_WORDS: readonly string[] = [
  'tìm',
  'cho',
  'tôi',
  'mình',
  'muốn',
  'cần',
  'xin',
  'giúp',
  'gì',
  'đó',
  'nào',
  'một',
  'món',
  'quán',
  'quầy',
  'ngon',
  'nhất',
  'ạ',
  'nha',
  'nè',
  'nhé',
  'ơi',
  'đừng',
  'hay',
  'và',
  'có',
  'không',
  'của',
  'tại',
  'ra',
  'để',
  'đi',
  'bữa',
  'gần',
  'đây',
  'hả',
  'ha',
  'khu',
  'vực',
  'ở',
  'ngay',
  'cạnh',
  'buổi',
  'sáng',
  'trưa',
  'chiều',
  'tối',
  'nay',
  'hôm',
  'lúc',
  'giờ',
  'thêm',
  'nữa',
  'được',
  'không',
  'nên',
  'hoặc',
  'vị',
  'hơi',
  'thôi',
  'phải',
  'quá',
  'thích',
  'thơm',
  'còn',
  'ít',
  'quanh',
  'giống',
  'nhưng',
  'dùng',
  'thì',
  'theo',
  'với',
  'phù hợp',
  'thích hợp',
  'chỗ',
  'nơi',
  'xem',
  'ăn',
  'uống',
  'đồ',
  'vặt',
  'giá',
  'dưới',
  'trong',
  'vòng',
  'cách',
  'xa',
  'rẻ',
  'đắt',
  'xịn',
  'sang',
  'tiền',
  'đang',
  'vừa',
  'đói',
  'no',
  'hãy',
  'hiện',
  'bây',
  'giờ',
  'này',
];

const FILLER_PHRASES: readonly string[] = [
  // City qualifiers are location context, not food keywords. Removing them
  // also keeps "Quận 1, TP.HCM" on the deterministic district path.
  'thành phố hồ chí minh',
  'thành phố hcm',
  'tp.hcm',
  'tp hcm',
  'hồ chí minh',
  'sài gòn',
  'gần đây',
  'trong bán kính',
  'bán kính',
  'cách chỗ tôi',
  'cách chỗ mình',
  'cách tôi',
  'cách mình',
  'không quá xa',
  'đừng chọn quán quá xa',
  'quá xa',
  'cho tôi',
  'cho mình',
  'món gì',
  'gì đó',
  'một món',
  'quán gì',
  'ở đâu',
  'gần nhà',
  'bình dân',
  'giá rẻ',
  'cao cấp',
  'hiện tại',
  'phù hợp với thời tiết này',
  'hợp với thời tiết này',
  'với thời tiết này',
  'thời tiết này',
  'tồn tại',
  'gợi ý',
  'có thể là',
  'đổi món',
  'trong tủ lạnh',
  'có thể nấu',
  'giống phở',
  'không dùng thịt bò',
  'món việt nam',
  'ẩm thực việt nam',
  'giá hợp lý',
  'gần trường đại học',
  'trường đại học',
  'chưa biết',
  'không biết',
  'chưa rõ',
  'muốn ăn gì',
  'hôm nay ăn gì',
  'ăn gì hôm nay',
  'đang đói',
  'đói bụng',
  'ăn gì cho no',
  'ăn gì',
];

// Subjective quality/filler words an LLM may wrongly put into `tastes`. They
// are not food attributes — keeping them turns into AND'd dish-name filters
// that silently match nothing (e.g. tastes ["ngon", "phở"] requires a dish
// whose name contains BOTH words).
const NON_TASTE_WORDS = new Set([
  'ngon',
  'ngon nhất',
  'ngon bổ rẻ',
  'sạch',
  'sạch sẽ',
  'chất lượng',
  'uy tín',
  'bổ',
  'đẹp',
  'gần',
  'tiện',
  'mát mẻ',
  'thân thiện',
  'chuẩn',
  'đúng chuẩn',
  'chuẩn vị',
  'nổi tiếng',
  'nức tiếng',
  'xịn',
  'sang',
  'quen',
  'đông',
  'vắng',
  'lạ',
  'độc lạ',
  'mới',
  'tươi ngon',
  'ngon miệng',
  'hợp',
  'đầy đủ',
  'review',
  'ngon tuyệt',
  'tuyệt',
  'ok',
  'đãi',
  'tiết kiệm',
  'phù hợp',
  'thích hợp',
  'hợp',
  'thời tiết',
  'đang',
  'ngoài trời',
  'ngoại trời',
  'nhóm đông',
  'đông người',
  'hội bạn',
]);
const cleanTasteTerms = (terms: string[]): string[] =>
  terms.filter((term) => !NON_TASTE_WORDS.has(term.toLocaleLowerCase('vi-VN')));

// Merge explicit (UI-picked) + deterministic + LLM tastes. When a weather
// phrase picked a comfort direction, that reading wins: drop the LLM's
// opposite temperature ("trời nóng" → deterministic "mát" must not be AND-ed
// with the LLM's "nóng", which would match nothing) while keeping every other
// inferred taste.
const mergeComfortTastes = (
  deterministic: string[],
  intent: AiIntent | null,
  comfortTaste: string | undefined,
  query: string,
  explicit: string[] = [],
): string[] => {
  const opposite = comfortTaste === 'mát' ? 'nóng' : comfortTaste === 'nóng' ? 'mát' : undefined;
  // Deterministic parsing is the source of truth for weather and explicit
  // Vietnamese taste words. The local vision model is useful for broad
  // semantic intent, but it can emit noisy attributes ("mặn", "nướng", or
  // malformed tokens) for a weather-only sentence. Those extra AND filters
  // shrink recall and can make a verified hot dish lose to unrelated rows.
  // Keep only LLM tastes that are explicitly present in the user's query;
  // canonical weather/taste terms are already captured by `deterministic`.
  const normalizedQuery = query.toLocaleLowerCase('vi-VN');
  const knownTastes = new Set(TASTE_ALIASES.map(([, canonical]) => canonical));
  const intentTastes = cleanTasteTerms(intent?.tastes ?? []).filter(
    (taste) =>
      knownTastes.has(taste) &&
      taste !== opposite &&
      normalizedQuery.includes(taste.toLocaleLowerCase('vi-VN')),
  );
  return [...new Set([...explicit, ...deterministic, ...intentTastes])];
};

const canonicalDishQueries = (
  intent: AiIntent | null,
  interpreted: InterpretedFilters,
): string[] => {
  // The user's explicit named dish is stronger than a model suggestion of a
  // broader ingredient ("mì hải sản" must not become just "hải sản").
  const isConcreteDish = Boolean(
    interpreted.query &&
    CONCRETE_DISH_PHRASES.some(
      (phrase) => interpreted.query?.toLocaleLowerCase('vi-VN') === phrase,
    ),
  );
  const canonical = (intent?.canonicalDishes ?? []).map((dish) => dish.dish).filter(Boolean);
  if (isConcreteDish) {
    const normalizedDish = normalizeLocationText(interpreted.query!);
    return [canonical.find((dish) => normalizeLocationText(dish) === normalizedDish) ?? interpreted.query!];
  }
  if (canonical.length) return [...new Set(canonical)].slice(0, 4);
  // When the LLM is unavailable, an explicit dish-type phrase is still a hard
  // dish signal. Keep the distilled phrase as direct menu evidence rather than
  // letting it become a broad restaurant/category text search.
  // Concrete phrases that use a non-taxonomy word (for example "lẩu bò" or
  // "gà nướng") need the same treatment even though `lẩu` is not a filterable
  // dish-type alias. Without this branch a zero-evidence exact dish silently
  // falls back to unrelated highly-rated restaurants.
  return interpreted.query && (interpreted.categoryFromDishType || isConcreteDish)
    ? [interpreted.query]
    : [];
};

const safeAiSummary = (
  intent: AiIntent | null,
  interpreted: InterpretedFilters,
  dishQueries: string[],
): string | null => {
  // Exact-dish understanding must stay deterministic. Local models can
  // return fluent but unrelated prose in `summary` even when the structured
  // dish intent is correct, so do not expose that text for exact retrieval.
  if (dishQueries.length) return `Bếp hiểu bạn muốn tìm món ${dishQueries.join(', ')}.`;
  if (interpreted.dishStyle === 'dry') return 'Bếp hiểu bạn muốn tìm món khô.';
  if (interpreted.dishStyle === 'brothy') return 'Bếp hiểu bạn muốn tìm món nước.';
  if (interpreted.query) return `Bếp hiểu bạn muốn tìm ${interpreted.query}.`;
  if (!interpreted.comfortTaste) return intent?.summary ?? null;
  if (interpreted.comfortTaste === 'nóng') return 'Món nóng, ấm bụng phù hợp trời mưa.';
  if (interpreted.comfortTaste === 'mát') return 'Món mát, thanh nhẹ phù hợp thời tiết nóng.';
  return intent?.summary ?? null;
};

// These are deliberately exact menu identities, not broad taxonomy labels.
// They provide a concrete rainy-day shortlist only when the database has
// completed menu evidence for at least one of them.
const RAINY_WEATHER_DISHES = [
  'bún bò Huế',
  'phở bò',
  'phở gà',
  'bún riêu',
  'lẩu bò',
  'bánh canh cua',
  'bún cá',
  'hủ tiếu',
  'cháo',
];

// Taste words are also part of many concrete dish identities. The
// deterministic parser removes "nướng"/"chiên" as filters, but must preserve
// them when they are inside a known dish phrase ("bún thịt nướng" must not
// degrade to the incomplete query "bún thịt"). This is intentionally a small
// precision-first lexicon, not a replacement for menu evidence.
const CONCRETE_DISH_PHRASES = [
  'chả giò xuân hương',
  'gỏi bò wasabi',
  'gà đất hấp niêu',
  'súp hải sản',
  'đậu hũ chiên sả ớt',
  'cơm cháy kho quẹt',
  'truffle & shroom pizza',
  'truffle shroom pizza',
  'pizza pepperoni',
  'the margherita',
  'the fisherman',
  'the pepperoni',
  'bánh kem mousse chanh dây',
  'bánh kem mousse trà xanh',
  'bánh kem bắp trái cây',
  'bánh kem bento 90k',
  'bánh kem tiramisu',
  'phở gà trống thiến thập cẩm',
  'phở lòng gà trứng non',
  'cơm gỏi gà xé',
  'xôi gà ta xé',
  'hủ tíu nam vang nước tô đặc biệt',
  'hủ tíu nam vang khô tô đặc biệt',
  'hủ tíu nước bình thường',
  'hủ tíu khô bình thường',
  'hủ tíu nước nhỏ',
  'hủ tíu khô nhỏ',
  'hủ tíu em bé',
  'mì bò viên triều châu',
  'mì kim chi thập cẩm',
  'mì kim chi sò điệp',
  'mì kim chi hải sản',
  'mì kim chi bò mỹ',
  'mì kim chi bò',
  'mì ý hải sản',
  'mì ý',
  'pizza margherita',
  'pizza calzone',
  'salad cá hồi',
  'salad hải sản',
  'cơm ý hải sản',
  'súp bí đỏ',
  'california maki',
  'ebi tempura',
  'hotate sashimi',
  'beef salad',
  'pizza hải sản',
  'mì udon thịt bò',
  'cơm chiên tôm',
  'cơm tấm đùi gà',
  'cơm tấm sườn',
  'canh khổ qua',
  'bánh mì bà huynh đặc biệt',
  'bánh mì trứng ốp la',
  'bánh mì nem nướng',
  'bún khô lụi heo nướng',
  'cuốn lụi bò',
  'cuốn lụi heo',
  'gỏi tré trộn xoài',
  'mì bò đài loan',
  'mì sườn bò hầm',
  'mì sủi cảo tôm',
  'mì gà chiên',
  'mì khô xá xíu',
  'chả cá đế vương',
  'lẩu cá lăng',
  'lẩu cá tầm',
  'lẩu đầu cá',
  'salad da cá',
  'cháo cá',
  'nem cá',
  'hủ tiếu xào hải sản',
  'mì vịt tiềm',
  'cơm chiên hải sản',
  'bánh xèo miền tây',
  'bún đậu homemade đặc biệt',
  'bún đậu homemade',
  'bún đậu',
  'bún thịt nướng',
  'bún bò huế',
  'bún bò',
  'bún cá lóc',
  'bún cá',
  'bún chả',
  'bún riêu',
  'phở bò tái',
  'phở bò chín',
  'phở tái',
  'phở bò',
  'phở gà',
  'lẩu bò',
  'bánh canh cua',
  'bánh mì thịt nướng',
  'mì xào hải sản',
  'mì hải sản',
  'hủ tiếu nam vang',
  'hủ tiếu',
  'cháo lòng',
  'cháo gà',
  'cháo',
  'mì quảng',
  'cơm tấm',
  'cơm gà',
  'cơm niêu',
  'cơm sườn nướng',
  'sườn nướng',
  'gà nướng',
  'bò nướng',
  'nem nướng',
  'mì xào giòn',
  'mì xào',
];

const CONCRETE_DISH_MENU_ALIASES: Readonly<Record<string, string>> = {
  'pizza pepperoni': 'the pepperoni',
  'truffle & shroom pizza': 'truffle shroom pizza',
};

// A named dish followed immediately by an ingredient is a narrower menu item,
// not a synonym for the base dish. Keep the qualifier on the same dish query so
// "bánh canh cua tôm" cannot match a shop that only lists bánh canh cua.
const DISH_VARIANT_SUFFIXES: ReadonlyArray<readonly [string, string]> = [
  ['chay', 'chay'],
  ['gio cha cua', 'giò chả cua'],
  ['gio cha', 'giò chả'],
  ['tai cha', 'tái chả'],
  ['cha cua', 'chả cua'],
  ['tai nam', 'tái nạm'],
  ['dac biet', 'đặc biệt'],
  ['hai san', 'hải sản'],
  ['dau hu', 'đậu hũ'],
  ['cha', 'chả'],
  ['gio', 'giò'],
  ['tai', 'tái'],
  ['tom', 'tôm'],
  ['muc', 'mực'],
  ['nam', 'nấm'],
  ['trung', 'trứng'],
];

const preserveExplicitDishVariant = (dish: string, query: string): string => {
  const base = normalizeLocationText(dish);
  const request = ` ${normalizeLocationText(query)} `;
  for (const [normalizedSuffix, suffix] of DISH_VARIANT_SUFFIXES) {
    if (request.includes(` ${base} ${normalizedSuffix} `)) return `${dish} ${suffix}`;
  }
  return dish;
};

const HARD_CUISINE_PHRASES = ['pizza'];

// These concepts are food anchors even when the taxonomy is incomplete. They
// must stay lexical/menu-grounded instead of falling through to a broad
// semantic_profile search that can return unrelated restaurants.
const HARD_FOOD_PHRASES = [
  ...HARD_CUISINE_PHRASES,
  'hải sản',
  'seafood',
  'lẩu',
  'hotpot',
  'nướng',
  'bbq',
  'sushi',
  'món ý',
  'italian',
  'hàn quốc',
  'korean',
];

const normalizeLocationText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const containsNormalizedPhrase = (text: string, phrase: string): boolean =>
  new RegExp(`(?:^| )${escapeRegExp(phrase)}(?: |$)`, 'u').test(text);

const isHardFoodIntent = (query: string, interpreted: InterpretedFilters): boolean => {
  if (interpreted.dishStyle) return true;
  const normalized = normalizeLocationText(query);
  return Boolean(
    interpreted.query &&
    (CONCRETE_DISH_PHRASES.some((phrase) =>
      containsNormalizedPhrase(normalized, normalizeLocationText(phrase)),
    ) ||
      HARD_FOOD_PHRASES.some((phrase) =>
        containsNormalizedPhrase(normalized, normalizeLocationText(phrase)),
      )),
  );
};

const hardCuisineFromQuery = (query: string): string | undefined => {
  const normalized = normalizeLocationText(query);
  return HARD_CUISINE_PHRASES.find((phrase) =>
    containsNormalizedPhrase(normalized, normalizeLocationText(phrase)),
  );
};

const hardFoodFromQuery = (query: string): string | undefined => {
  const normalized = normalizeLocationText(query);
  // A full dish name wins over a broad ingredient/cuisine word inside it.
  if (CONCRETE_DISH_PHRASES.some((phrase) =>
    containsNormalizedPhrase(normalized, normalizeLocationText(phrase)),
  )) return undefined;
  return HARD_FOOD_PHRASES.find((phrase) =>
    containsNormalizedPhrase(normalized, normalizeLocationText(phrase)),
  );
};

const excludedFoodFromQuery = (query: string): string[] => {
  const normalized = normalizeLocationText(query);
  const exclusions = new Set<string>();
  // Only inspect the words following an actual negation. A trailing question
  // particle ("có ... không?") is not a negative food preference.
  for (const fragment of normalized.split(/(?:^| )khong |(?:^| )dung /u).slice(1)) {
    const scope = fragment.split(/ (?:nhung|gio|hay tim|thay vao do) /u)[0].slice(0, 55);
    if (/\bga ran\b/u.test(scope)) exclusions.add('gà rán');
    if (/\bga chien\b/u.test(scope)) exclusions.add('gà chiên');
    if (/\bthit bo\b/u.test(scope)) exclusions.add('thịt bò');
    if (/\bpho bo\b/u.test(scope)) {
      exclusions.add('phở bò');
      exclusions.add('thịt bò');
    }
    if (/\b(?:com|bun|cay)\b/u.test(scope)) {
      if (/\bcom\b/u.test(scope)) exclusions.add('cơm');
      if (/\bbun\b/u.test(scope)) exclusions.add('bún');
      if (/\bcay\b/u.test(scope)) exclusions.add('cay');
    }
    if (/\bchien dau nhieu\b/u.test(scope)) exclusions.add('chiên');
  }
  return [...exclusions];
};

const ingredientTermsFromQuery = (query: string, exclusions: string[]): string[] => {
  const normalized = normalizeLocationText(query);
  const ingredients: ReadonlyArray<readonly [string, RegExp]> = [
    ['đậu phụ', /\b(?:dau phu|dau hu|tofu)\b/u],
    ['hải sản', /\bhai san\b/u],
    ['mì', /\bmi\b/u],
    ['thịt bò', /\b(?:thit )?bo\b/u],
    ['thịt gà', /\b(?:thit )?ga\b/u],
    ['thịt heo', /\b(?:thit )?heo\b/u],
    ['khoai tây', /\bkhoai tay\b/u],
    ['cà chua', /\bca chua\b/u],
    ['hành lá', /\bhanh la\b/u],
    ['trứng', /\btrung\b/u],
    ['nấm', /\bnam\b/u],
    ['tôm', /\btom\b/u],
    ['mực', /\bmuc\b/u],
    ['rau', /\brau\b/u],
  ];
  return ingredients
    .filter(([ingredient, pattern]) =>
      pattern.test(normalized) && !exclusions.some((term) =>
        normalizeLocationText(term).includes(normalizeLocationText(ingredient))))
    .map(([ingredient]) => ingredient);
};

const hasExplicitNearbyIntent = (query: string): boolean => {
  const normalized = normalizeLocationText(query);
  return (
    [
      'gan day',
      'gan toi',
      'gan minh',
      'gan nha',
      'quanh day',
      'quanh toi',
      'xung quanh',
      'o day',
      'ngay gan day',
      'ban kinh',
      'khong qua xa',
      'dung qua xa',
      'qua xa',
    ].some((phrase) => normalized.includes(phrase)) ||
    /\bgan\s+(quan|phuong|xa|thanh pho|district)\b/u.test(normalized) ||
    /\b\d+(?:[.,]\d+)?\s*(km|cay so)\b/u.test(normalized)
  );
};

const explicitNearbyDistanceKm = (query: string): number => {
  const normalized = normalizeLocationText(query);
  const match = normalized.match(/(\d+(?:[.,]\d+)?)\s*(?:km|cay so)\b/u);
  if (!match) return 5;
  const value = Number(match[1].replace(',', '.'));
  return Number.isFinite(value) ? Math.min(60, Math.max(1, value)) : 5;
};

// An LLM may output a valid district from the taxonomy even when it was not
// present in the user's request. A valid taxonomy value is not proof that it
// is the requested location. Deterministic text evidence wins.
const groundedDistrict = (
  query: string,
  interpreted: InterpretedFilters,
  aiDistrict: string | null | undefined,
): string | undefined => {
  if (interpreted.district) return interpreted.district;
  if (!aiDistrict) return undefined;
  const queryText = normalizeLocationText(query);
  const districtText = normalizeLocationText(aiDistrict);
  return queryText.includes(districtText) ? aiDistrict : undefined;
};

function interpretQuery(query: string): InterpretedFilters {
  const normalized = query.toLocaleLowerCase('vi-VN');
  // Match aliases as whole words/phrases so short aliases like "ý" or "mì"
  // cannot fire inside unrelated words ("gợi ý", "mì" inside "mì tôm").
  const hasPhrase = (phrase: string): boolean =>
    new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(phrase)}(?=$|[^\\p{L}\\p{N}])`, 'u').test(
      normalized,
    );
  const negatedDishType = /\b(?:không|đừng|không phải)\b[^.!?]{0,40}\b(?:cơm|bún|mì|phở|bánh mì)\b/iu.test(
    normalized,
  );
  const dishTypeCategory = negatedDishType
    ? undefined
    : DISH_TYPE_ALIASES.find(([alias]) => hasPhrase(alias))?.[1];
  const category = dishTypeCategory ?? CATEGORY_ALIASES.find(([alias]) => hasPhrase(alias))?.[1];
  const attributes = [
    ...(normalized.includes('quiet') || normalized.includes('yên tĩnh') ? ['quiet'] : []),
    ...(normalized.includes('date') || normalized.includes('hẹn hò') ? ['date-friendly'] : []),
    ...(normalized.includes('working') ||
    normalized.includes('work') ||
    normalized.includes('làm việc')
      ? ['work-friendly']
      : []),
  ];

  // Distill the raw sentence down to the meaningful food terms. Location and
  // taste words become structured filters instead of SQL text matches, so
  // "ngọt" no longer accidentally matches restaurants whose menu contains
  // "binh"/"thanh"/"do" from the surrounding filler words.
  let refined = query.trim();
  let district: string | undefined;
  for (const [alias, canonical] of [...DISTRICT_ALIASES].sort(
    (left, right) => right[0].length - left[0].length,
  )) {
    const next = removePhrase(refined, alias);
    if (next !== refined) {
      district = canonical;
      refined = next;
      break;
    }
  }
  let menuLookupText = refined;
  // Price clauses qualify the food request but are not part of a catalog
  // dish name. Strip the complete clause before exact first-party lookup.
  if (numericBudgetFromQuery(query)) {
    menuLookupText = menuLookupText.replace(
      /(?:giá\s+|ngân sách\s+)?(?:dưới|tối đa|không quá|ngân sách(?:\s+là)?)\s*\d{1,7}(?:[.,]\d{3})*\s*(?:k|nghìn|ngàn|đồng|đ)?(?=$|[^\p{L}\p{N}])/giu,
      ' ',
    );
  }
  for (const phrase of FILLER_PHRASES) menuLookupText = removePhrase(menuLookupText, phrase);
  for (const word of FILLER_WORDS) {
    // A possessive can be part of an official dish title ("Chè của mẹ").
    // Preserve it for catalog lookup; the broader intent pass below still
    // removes it when no exact reviewed menu row exists.
    if (word === 'của') continue;
    if (word === 'đồ' && /(?:^|[^\p{L}\p{N}])đồ\s+chua\s+riêng(?=$|[^\p{L}\p{N}])/iu.test(menuLookupText)) continue;
    if (word === 'lúc' && /\blúc\s+lắc\b/iu.test(menuLookupText)) continue;
    if (word === 'vị' && /(?:^|[^\p{L}\p{N}])tứ\s+vị(?=$|[^\p{L}\p{N}])/iu.test(menuLookupText)) continue;
    if (word === 'no' && /(?:^|[^\p{L}\p{N}])no\s+nê(?=$|[^\p{L}\p{N}])/iu.test(menuLookupText)) continue;
    menuLookupText = removePhrase(menuLookupText, word);
  }
  menuLookupText = menuLookupText
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:km|cây số)\b/giu, ' ')
    .replace(/\b\d{1,3}(?:[.,]\d{3})+\s*(?:k|đ|đồng|dong|nghìn|ngàn)?\b/giu, ' ')
    .replace(/\b\d+\s*(?:k|đ|đồng|dong|nghìn|ngàn)\b/giu, ' ');
  const menuLookupQuery = menuLookupText.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const tastes: string[] = [];
  let dishStyle: 'dry' | 'brothy' | undefined;
  // Weather words ("trời mưa", "trời nóng"…) imply a comfort direction without
  // naming a taste. Run BEFORE TASTE_ALIASES so "trời trở lạnh" is consumed as a
  // weather phrase instead of "lạnh" → "mát" (cold drinks), and "trời nóng" is
  // consumed as "mát" (cold food) instead of "nóng" (hot food).
  let comfortTaste: string | undefined;
  for (const [phrase, taste] of WEATHER_COMFORT_PHRASES) {
    const next = removePhrase(refined, phrase);
    if (next !== refined) {
      refined = next;
      comfortTaste = taste;
      break;
    }
  }
  for (const [alias, canonical] of TASTE_ALIASES) {
    const next = removePhrase(refined, alias);
    if (next !== refined) {
      if (canonical === 'khô') dishStyle = 'dry';
      else if (canonical === 'nước') dishStyle = 'brothy';
      else tastes.push(canonical);
      refined = next;
    }
  }
  // Taxonomy words are structured filters, not free-text terms. Removing
  // them prevents generic requests such as "món chay thanh đạm" or
  // "món ngọt, chè hoặc bánh" from becoming literal text searches for
  // "chay"/"chè" after the category has already been detected.
  for (const [alias] of [...DISH_TYPE_ALIASES, ...CATEGORY_ALIASES].sort(
    (left, right) => right[0].length - left[0].length,
  )) {
    if ((HARD_FOOD_PHRASES as readonly string[]).includes(alias)) continue;
    refined = removePhrase(refined, alias);
  }
  if (category === 'dessert') refined = removePhrase(refined, 'bánh');
  for (const phrase of FILLER_PHRASES) refined = removePhrase(refined, phrase);
  for (const word of FILLER_WORDS) {
    // "Lúc" is filler in time expressions, but part of the dish name
    // "bò lúc lắc"; removing it breaks exact catalog lookup.
    if (word === 'lúc' && /\blúc\s+lắc\b/iu.test(refined)) continue;
    if (word === 'vị' && /(?:^|[^\p{L}\p{N}])tứ\s+vị(?=$|[^\p{L}\p{N}])/iu.test(refined)) continue;
    if (word === 'no' && /(?:^|[^\p{L}\p{N}])no\s+nê(?=$|[^\p{L}\p{N}])/iu.test(refined)) continue;
    refined = removePhrase(refined, word);
  }
  // Distance values are structured filters, never part of the dish phrase.
  // Without this cleanup, "bún bò trong bán kính 3 km" becomes an exact
  // dish called "bún bò trong bán kính 3 km" and can trigger an expensive
  // menu-evidence scan with no chance of matching.
  refined = refined
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:km|cây số)\b/giu, ' ')
    .replace(/\b\d{1,3}(?:[.,]\d{3})+\s*(?:k|đ|đồng|dong|nghìn|ngàn)?\b/giu, ' ')
    .replace(/\b\d+\s*(?:k|đ|đồng|dong|nghìn|ngàn)\b/giu, ' ');

  const queryTerm = refined.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const concreteDish = CONCRETE_DISH_PHRASES.find((phrase) => hasPhrase(phrase));
  // "Ấm bụng" is a comfort description, not a dish name, when it follows a
  // deterministic weather reading. Keep it searchable as a semantic phrase
  // for a standalone query, but do not let it become a broad SQL text filter
  // for rainy-weather retrieval.
  const weatherComfortOnly = Boolean(comfortTaste) && /^(ấm bụng|ấm áp|ấm lòng)$/iu.test(queryTerm);
  return {
    ...(category ? { category } : {}),
    ...(category ? { categoryFromDishType: Boolean(dishTypeCategory) } : {}),
    ...(district ? { district } : {}),
    attributes,
    tastes: comfortTaste && !tastes.includes(comfortTaste) ? [...tastes, comfortTaste] : tastes,
    ...(comfortTaste ? { comfortTaste } : {}),
    ...(comfortTaste ? { semanticQuery: COMFORT_SEMANTIC_QUERY[comfortTaste] } : {}),
    // "Khô"/"nước" can be part of an exact menu name. A named dish already
    // carries that constraint; adding a generic style scan is redundant and
    // can time out on the full menu-evidence catalog.
    ...(dishStyle && !concreteDish ? { dishStyle } : {}),
    ...(concreteDish
      ? { query: CONCRETE_DISH_MENU_ALIASES[concreteDish] ?? concreteDish }
      : queryTerm && !weatherComfortOnly
        ? { query: queryTerm }
        : {}),
    ...(menuLookupQuery ? { menuLookupQuery } : {}),
  };
}

function firstFilterableCategory(
  intent: AiIntent | null,
  interpreted: InterpretedFilters,
  query: string,
): string | undefined {
  // An explicit dish-type word in the query (bún, cơm, mì, phở, ăn vặt…) is an
  // exact, reliable category signal. Prefer it over the LLM's broader guess so
  // "bún bò huế" matches `bun` restaurants instead of the LLM's "noodle".
  if (interpreted.categoryFromDishType && FILTERABLE_CATEGORY_SLUGS.has(interpreted.category!)) {
    const normalizedQuery = normalizeLocationText(query);
    const explicitAlias = ALL_CATEGORY_ALIASES.some(
      ([alias, canonical]) =>
        canonical === interpreted.category &&
        containsNormalizedPhrase(normalizedQuery, normalizeLocationText(alias)),
    );
    if (explicitAlias) return interpreted.category;
  }
  // A strong non-filterable dish-type signal (nướng→bbq, lẩu→hotpot, hải sản…)
  // means the query is really about that cuisine, not the generic category the
  // LLM happened to guess ("snack" for a BBQ grill). Leave the category unset so
  // the taste + semantic ranking drives the result instead of an unrelated
  // taxonomy filter.
  if (interpreted.category && !FILTERABLE_CATEGORY_SLUGS.has(interpreted.category)) {
    return undefined;
  }
  if (intent && intent.categories.length) {
    const normalizedQuery = normalizeLocationText(query);
    const fromIntent = intent.categories.find(
      (slug) =>
        FILTERABLE_CATEGORY_SLUGS.has(slug) &&
        ALL_CATEGORY_ALIASES.some(
          ([alias, canonical]) =>
            canonical === slug &&
            containsNormalizedPhrase(normalizedQuery, normalizeLocationText(alias)),
        ),
    );
    if (fromIntent) return fromIntent;
  }
  return interpreted.category && FILTERABLE_CATEGORY_SLUGS.has(interpreted.category)
    ? interpreted.category
    : undefined;
}

const hasExplicitPriceIntent = (query: string): boolean =>
  /(?:giá|price|rẻ|bình dân|cao cấp|sang|tiết kiệm|ngân sách|budget|\b\d+(?:[.,]\d+)?\s*(?:k|đ|dong|đồng)\b)/iu.test(
    query,
  );

// A numeric VND budget is not the restaurant's ordinal price_level (1–4).
// Applying the latter as a hard filter can remove every relevant dish while
// still not proving the actual menu price is below the requested amount.
const numericBudgetFromQuery = (query: string): { amount: number; exclusive: boolean } | undefined => {
  const match = query.match(/(dưới|tối đa|không quá|ngân sách)\s*(?:là\s*)?(\d{1,7}(?:[.,]\d{3})*)\s*(k(?![a-z])|nghìn|ngàn|đồng|đ)?(?=$|[^\p{L}\p{N}])/iu);
  if (!match) return undefined;
  // A distance written in metres can exceed 1000; it is still not money.
  if (/^\s*(?:km|m|mét|met|cây số)(?=$|[^\p{L}\p{N}])/iu.test(query.slice(match.index! + match[0].length)))
    return undefined;
  const amount = Number(match[2].replace(/[.,]/gu, '')) *
    (match[3] && /^(?:k|nghìn|ngàn)$/iu.test(match[3]) ? 1000 : 1);
  // An unqualified small number is likely a distance ("dưới 3 km"), not VND.
  if (!Number.isSafeInteger(amount) || amount < 1000 || amount > 10_000_000) return undefined;
  return { amount, exclusive: match[1].toLocaleLowerCase('vi-VN') === 'dưới' };
};
const hasNumericBudget = (query: string): boolean => Boolean(numericBudgetFromQuery(query));

const hasExplicitRatingIntent = (query: string): boolean =>
  /(?:đánh giá|rating|review|\d(?:[.,]\d+)?\s*(?:sao|điểm)|(?:từ|trên|ít nhất)\s+\d(?:[.,]\d+)?)/iu.test(
    query,
  );

const hasExplicitOpenNowIntent = (query: string): boolean =>
  /(?:đang mở|mở cửa|còn mở|mở ngay|open now|giờ này|hiện đang mở)/iu.test(query);

// A concrete dish phrase, taste, district, numeric budget and UI filters are
// already deterministic. Call the model only for natural-language constraints
// that this parser cannot represent yet (qualitative price, rating, open-now).
const shouldUseAiForExactDish = (
  query: string,
  body: RecommendationDto,
): boolean => {
  const normalized = query.toLocaleLowerCase('vi-VN');
  const exactDish = CONCRETE_DISH_PHRASES.find((phrase) =>
    new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(phrase)}(?=$|[^\\p{L}\\p{N}])`, 'u').test(
      normalized,
    ),
  );
  if (!exactDish) return true;
  return Boolean(
    (hasExplicitPriceIntent(query) && !hasNumericBudget(query) && body.filters?.priceLevel === undefined) ||
    (hasExplicitRatingIntent(query) && body.filters?.minRating === undefined) ||
    (hasExplicitOpenNowIntent(query) && body.filters?.openNow === undefined),
  );
};

// Weather-only prompts are fully resolved by the deterministic parser:
// comfort direction, optional nearby radius, and user-provided location are
// already available without a model call. Skipping AI here avoids a multi-
// second local/provider round trip and prevents invented dishes from
// widening the candidate set. Keep AI enabled when the user adds a constraint
// that needs interpretation (price, rating, open-now, or an ambiguous phrase).
const isDeterministicWeatherOnly = (
  query: string,
  body: RecommendationDto,
  interpreted: InterpretedFilters,
): boolean =>
  Boolean(
    interpreted.comfortTaste &&
    !interpreted.query &&
    !interpreted.district &&
    !interpreted.attributes.length &&
    !hasExplicitPriceIntent(query) &&
    !hasExplicitRatingIntent(query) &&
    !hasExplicitOpenNowIntent(query) &&
    body.filters?.area === undefined &&
    body.filters?.priceLevel === undefined &&
    body.filters?.minRating === undefined &&
    body.filters?.openNow === undefined &&
    !body.filters?.dishTypes?.length,
  );

// Short food lookups are already represented by the deterministic parser.
// Calling the local model and then Ollama for a single token (including an
// unknown token such as "xyzabc") only adds two timeout windows and cannot
// improve retrieval. Rich natural-language prompts still use AI below.
const isSimpleFoodLookup = (query: string, interpreted: InterpretedFilters): boolean => {
  if (
    !interpreted.query ||
    interpreted.district ||
    interpreted.comfortTaste ||
    interpreted.dishStyle
  ) {
    return false;
  }
  if (interpreted.attributes.length || interpreted.tastes.length) return false;
  // Canonical taste aliases are already parsed into SQL filters. Only keep
  // the AI path when another constraint still needs interpretation.
  if (
    interpreted.tastes.length &&
    (hasExplicitPriceIntent(query) || hasExplicitRatingIntent(query) || hasExplicitOpenNowIntent(query))
  )
    return false;
  // Preserve the canonical display/evidence resolution for known dishes and
  // cuisine aliases; the fast path is for unknown/simple free-text lookups.
  const normalized = normalizeLocationText(query);
  if (
    CONCRETE_DISH_PHRASES.some((phrase) =>
      containsNormalizedPhrase(normalized, normalizeLocationText(phrase)),
    ) ||
    HARD_FOOD_PHRASES.some((phrase) =>
      containsNormalizedPhrase(normalized, normalizeLocationText(phrase)),
    )
  ) {
    return false;
  }
  const terms = interpreted.query.trim().split(/\s+/u).filter(Boolean);
  // Wrappers such as "trong bán kính 3 km" and "cách tôi" can make the raw
  // sentence long even though the food anchor is still a short deterministic
  // lookup. Count the distilled food terms instead of letting those wrappers
  // trigger a 10-60s AI round trip.
  return terms.length <= 3;
};

// Do not turn a completely underspecified request into a semantic search over
// the whole catalog.  A phrase such as "tôi muốn ăn gì đó ngon" contains no
// food anchor after deterministic parsing; asking the LLM to invent one makes
// the result look fluent but unrelated, and can also spend a full provider
// timeout before falling back to popular restaurants.  The UI can use the
// explicit quality code to ask the user for a dish/category/taste instead.
const needsFoodClarification = (
  query: string,
  body: RecommendationDto,
  interpreted: InterpretedFilters,
): boolean => {
  if (excludedFoodFromQuery(query).length) return false;
  // A district-qualified restaurant discovery request is actionable even
  // without a named dish (for example, "quán ăn ngon ở Quận 1"). Let the
  // district filter rank the local catalog instead of asking for a food anchor.
  if (
    interpreted.district &&
    /(?:quán|nhà hàng|tiệm|địa điểm ăn|ăn ngon)/iu.test(query)
  )
    return false;
  if (interpreted.district || isBroadDiscoveryIntent(query)) return false;
  if (
    interpreted.query ||
    interpreted.category ||
    interpreted.comfortTaste ||
    interpreted.dishStyle ||
    interpreted.tastes.length ||
    interpreted.attributes.length ||
    hardFoodFromQuery(query)
  )
    return false;
  if (body.filters?.taste?.length || body.filters?.dishTypes?.length) return false;
  return true;
};

// Category, taste, and preparation-style requests already have deterministic
// database filters. They do not need the local model or a remote embedding;
// skipping both keeps queries such as "món cay" fast and prevents an optional
// semantic provider from widening a structured result set.
const isDeterministicStructuredLookup = (interpreted: InterpretedFilters): boolean =>
  !interpreted.query &&
  Boolean(
    interpreted.category ||
    interpreted.district ||
    interpreted.tastes.length ||
    interpreted.dishStyle ||
    interpreted.comfortTaste,
  );

// Generic discovery is actionable in production. A user who says
// "hôm nay ăn gì", "quán ăn gần tôi", or "ăn tối giá rẻ" is asking for a
// ranked broad catalog, not a clarification prompt. Keep the model out of
// this path so it cannot invent a dish and turn a broad request into a false
// menu-evidence lookup.
const isBroadDiscoveryIntent = (query: string): boolean => {
  const normalized = normalizeLocationText(query);
  if (
    CONCRETE_DISH_PHRASES.some((phrase) =>
      containsNormalizedPhrase(normalized, normalizeLocationText(phrase)),
    ) ||
    HARD_FOOD_PHRASES.some((phrase) =>
      containsNormalizedPhrase(normalized, normalizeLocationText(phrase)),
    )
  )
    return false;
  return [
    'an gi',
    'mon gi',
    'mon nao',
    'goi y',
    'quan an',
    'nha hang',
    'dia diem an',
    'an sang',
    'an trua',
    'an toi',
    'bua sang',
    'bua trua',
    'bua toi',
    'doi mon',
    'khong muon an',
    'gia re',
    'binh dan',
    'gan toi',
    'gan day',
    'ban kinh',
    'dang mo',
    'mo cua',
    'qua xa',
  ].some((phrase) => containsNormalizedPhrase(normalized, phrase)) ||
    // A VND budget can qualify a newly curated named dish that is not in the
    // hand-written phrase list. Do not suppress its exact catalog lookup.
    /\bkhong dat\b/u.test(normalized);
};

const clarificationUnderstanding = (query: string): RecommendationUnderstanding => ({
  query,
  aiSummary: 'Bếp chưa xác định được bạn muốn ăn nhóm món nào.',
  filters: { attributes: [], tastes: [] },
});

@Controller('search')
export class SearchController {
  constructor(
    private readonly restaurantsService: RestaurantsService,
    @Optional() private readonly aiIntent?: AiIntentService,
  ) {}
  @Get()
  async search(@Query() query: ListRestaurantsQueryDto) {
    if (!query.query?.trim()) throw new BadRequestException('query is required.');
    const locationError = query.validateLocationPair();
    if (locationError) throw new BadRequestException(locationError);
    const interpreted = interpretQuery(query.query);
    const normalizedQuery = query.query.toLocaleLowerCase('vi-VN');
    const categoryAlias =
      interpreted.category && CATEGORY_ALIASES.some(([alias]) => normalizedQuery.includes(alias));
    return this.restaurantsService.list({
      ...query,
      category: query.category ?? interpreted.category,
      // “coffee”, “cà phê”, “món Việt”, etc. are taxonomy searches. Do
      // not require the word to appear in every restaurant's name/menu;
      // the chat recommendation endpoint already follows this behavior.
      query: categoryAlias ? undefined : query.query,
    });
  }

  @Post('interpret')
  async interpret(@Body() body: InterpretSearchDto) {
    const interpreted = interpretQuery(body.query);
    // Avoid an unnecessary model round trip for a query with no actionable
    // food signal.  In particular, never let a model invent a dish for a
    // generic request just to make the response look populated.
    const intent = needsFoodClarification(body.query, { query: body.query, limit: 10 }, interpreted)
      ? null
      : this.aiIntent?.isEnabled() &&
          !isDeterministicStructuredLookup(interpreted) &&
          !isBroadDiscoveryIntent(body.query)
        ? await this.aiIntent.interpret(body.query)
        : null;
    // For generic weather/context prompts, AI-proposed dishes are alternatives
    // for the weather shortlist, not an exact user request. Keeping them as
    // exact dishes would let menu confidence outrank the explicitly requested
    // nearby radius. A concrete dish left in the deterministic query remains
    // authoritative.
    const dishQueries =
      interpreted.comfortTaste && !interpreted.query
        ? []
        : canonicalDishQueries(intent, interpreted);
    const strictFoodQuery = hardFoodFromQuery(body.query);
    // A verified exact dish is more specific than its broad taxonomy (for
    // example, "bún bò Huế" is not merely "bún"). Keep the dish as the
    // primary intent and let the repository's hard menu-evidence constraint
    // retrieve restaurants. The category remains useful for generic queries
    // such as "quán bún" but must not leak into recommendation explanations.
    const category = dishQueries.length
      ? undefined
      : firstFilterableCategory(intent, interpreted, body.query);
    const dishQueriesAny =
      !dishQueries.length && interpreted.comfortTaste === 'nóng' ? RAINY_WEATHER_DISHES : [];
    const filters: InterpretedFilters & {
      priceLevel?: number;
      minRating?: number;
      openNow?: boolean;
      distanceKm?: number;
      dishes?: AiIntent['canonicalDishes'];
    } = {
      ...(category ? { category } : {}),
      ...(dishQueries.length ? { dishes: dishUnderstanding(dishQueries, intent) } : {}),
      ...(groundedDistrict(body.query, interpreted, intent?.district)
        ? { district: groundedDistrict(body.query, interpreted, intent?.district) }
        : {}),
      attributes: interpreted.attributes,
      tastes: mergeComfortTastes(interpreted.tastes, intent, interpreted.comfortTaste, body.query),
      ...(intent?.priceLevel && hasExplicitPriceIntent(body.query) && !hasNumericBudget(body.query)
        ? { priceLevel: intent.priceLevel }
        : {}),
      ...(intent?.minRating && hasExplicitRatingIntent(body.query)
        ? { minRating: intent.minRating }
        : {}),
      ...(intent?.openNow === true && hasExplicitOpenNowIntent(body.query)
        ? { openNow: true }
        : {}),
      ...(intent?.distanceKm && hasExplicitNearbyIntent(body.query)
        ? { distanceKm: intent.distanceKm }
        : {}),
    };
    return {
      data: {
        query: body.query,
        aiSummary: safeAiSummary(intent, interpreted, dishQueries),
        filters,
      },
    };
  }
}

@Controller('recommendations')
export class RecommendationsController {
  constructor(
    private readonly restaurantsService: RestaurantsService,
    @Optional() private readonly auth?: AuthService,
    @Optional() private readonly aiIntent?: AiIntentService,
    @Optional() private readonly embedding?: EmbeddingService,
    @Optional() private readonly recommendationEvents?: RecommendationEventsRepository,
  ) {}
  // Embeds the food-only phrase and resolves the active stored model so the
  // search query compares against the vectors that actually exist. Returns
  // null (semantic path off) when the provider is unset or the DB has no
  // vectors yet — the request then runs the structured/keyword pipeline.
  private async resolveEmbedding(
    text: string,
  ): Promise<{ vector: number[]; model: string } | null> {
    if (!this.embedding?.isEnabled()) return null;
    try {
      const [model, vector] = await Promise.all([
        this.embedding.activeModel(),
        this.embedding.embed(text),
      ]);
      if (!model) return null;
      return { vector, model };
    } catch {
      // Semantic retrieval is optional. A provider failure must degrade to
      // deterministic SQL filters instead of surfacing as a 5xx/timeout.
      return null;
    }
  }
  @Post()
  async recommend(@Body() body: RecommendationDto, @Req() request?: AuthenticatedRequest) {
    if (body.cursor) return this.recommendNextPage(body, request);
    const interpreted = interpretQuery(body.query);
    if (needsFoodClarification(body.query, body, interpreted)) {
      return {
        data: [],
        meta: {
          nextCursor: null,
          understanding: clarificationUnderstanding(body.query),
          quality: {
            code: 'NEEDS_CLARIFICATION',
            message:
              'Bạn muốn ăn món hoặc nhóm món nào? Ví dụ: pizza, bún bò, món khô, món chay hoặc món cay.',
          },
        },
      };
    }
    const deterministicStructuredLookup = isDeterministicStructuredLookup(interpreted);
    const simpleFoodLookup = isSimpleFoodLookup(body.query, interpreted);
    // Resolve a full, user-written menu name against trusted dish evidence.
    // This lets newly curated menus work without adding every dish to the
    // small deterministic phrase lexicon. The final list still enforces its
    // full menu-evidence and location gates.
    const lookupDistrict = body.filters?.area ?? interpreted.district;
    const catalogExactDish = interpreted.menuLookupQuery && !isBroadDiscoveryIntent(body.query)
      ? (await this.restaurantsService.findExactVerifiedDishName?.(interpreted.menuLookupQuery)) ??
        (interpreted.query && interpreted.query !== interpreted.menuLookupQuery
          ? await this.restaurantsService.findExactVerifiedDishName?.(interpreted.query)
          : undefined) ??
        await this.restaurantsService.findUniqueVerifiedParentheticalDishName?.(
          interpreted.menuLookupQuery, lookupDistrict,
        ) ??
        (lookupDistrict
          ? await this.restaurantsService.findUniqueVerifiedOrderedDishNameInDistrict?.(
            interpreted.menuLookupQuery, lookupDistrict,
          ) : undefined)
      : undefined;
    const hardFoodTerm = catalogExactDish ? undefined : hardFoodFromQuery(body.query);
    const excludedFoodTerms = excludedFoodFromQuery(body.query);
    const normalizedFoodRequest = normalizeLocationText(body.query);
    const phoWithoutBeef = excludedFoodTerms.includes('phở bò') ||
      (excludedFoodTerms.includes('thịt bò') &&
      containsNormalizedPhrase(normalizedFoodRequest, 'giong pho'));
    const explicitIngredients = ingredientTermsFromQuery(body.query, excludedFoodTerms);
    const hasNamedDish = Boolean(catalogExactDish) || CONCRETE_DISH_PHRASES.some((phrase) =>
      containsNormalizedPhrase(normalizedFoodRequest, normalizeLocationText(phrase)));
    // The shared `noodle` category also contains phở, bánh canh and some
    // unrelated places. A generic request for mì needs a food signal beyond
    // that category, while a named dish keeps its exact-menu path below.
    const genericMiLookup =
      interpreted.category === 'noodle' &&
      !interpreted.query &&
      !hardFoodTerm &&
      containsNormalizedPhrase(normalizedFoodRequest, 'mi') &&
      !containsNormalizedPhrase(normalizedFoodRequest, 'banh mi') &&
      !hasNamedDish;
    const strictFoodQuery =
      hardFoodTerm ??
      (genericMiLookup ? 'mì' : undefined) ??
      (phoWithoutBeef ? 'phở' : undefined) ??
      (excludedFoodTerms.some((term) => term === 'gà rán' || term === 'gà chiên') &&
      interpreted.query ? 'gà' : undefined);
    const intent =
      this.aiIntent?.isEnabled() &&
      !catalogExactDish &&
      shouldUseAiForExactDish(body.query, body) &&
      !deterministicStructuredLookup &&
      !simpleFoodLookup &&
      !(explicitIngredients.length > 0 && !hasNamedDish) &&
      !isBroadDiscoveryIntent(body.query) &&
      !interpreted.dishStyle &&
      !strictFoodQuery &&
      !isDeterministicWeatherOnly(body.query, body, interpreted)
        ? await this.aiIntent.interpret(body.query)
        : null;
    const dishQueries = phoWithoutBeef ? ['phở gà'] : catalogExactDish ? [catalogExactDish] : (
      (interpreted.comfortTaste && !interpreted.query) ||
      (explicitIngredients.length >= 2 && !hasNamedDish)
        ? []
        : canonicalDishQueries(intent, interpreted)
    ).filter((dish) => !excludedFoodTerms.some((term) =>
      normalizeLocationText(dish) === normalizeLocationText(term)))
      .map((dish) => preserveExplicitDishVariant(dish, body.query))
      // A bare "mì Ý" asks for spaghetti as a family. A following ingredient
      // is a different dish request and must keep its full name.
      .map((dish) => normalizeLocationText(dish) === 'mi y' &&
        /(?:^| )mi y(?:$| (?:o|tai|quan|q|gan|trong|cach) )/u.test(normalizedFoodRequest)
          ? 'spaghetti' : dish);
    // Exact dish intent takes precedence over its coarse category. This keeps
    // "cơm tấm" from being treated as a generic rice recommendation while the
    // SQL layer still requires completed, non-food-photo menu evidence.
    const explicitVegetarian = /(?:^|\s)(?:chay|vegan|vegetarian)(?:\s|$)/iu.test(body.query);
    const candidateCategory = dishQueries.length
      ? undefined
      : firstFilterableCategory(intent, interpreted, body.query);
    // A named vegetarian dish must be proven by that exact menu label.
    // Requiring the venue's coarse vegetarian category here excludes mixed
    // restaurants that genuinely serve the requested chay variant.
    const category = explicitVegetarian && !dishQueries.length
      ? 'vegetarian'
      : (candidateCategory === 'rice' && excludedFoodTerms.includes('cơm')) ||
          (candidateCategory === 'bun' && excludedFoodTerms.includes('bún'))
        ? undefined
        : candidateCategory;
    const ingredientTerms = dishQueries.length ||
      excludedFoodTerms.some((term) => term === 'gà rán' || term === 'gà chiên')
      ? []
      : explicitIngredients;
    const dishQueriesAny =
      !dishQueries.length && interpreted.comfortTaste === 'nóng' ? RAINY_WEATHER_DISHES : [];
    const numericBudget = numericBudgetFromQuery(body.query);
    const verifiedDishBudget = dishQueries.length ? numericBudget : undefined;
    const verifiedMenuOnly = Boolean(catalogExactDish) || phoWithoutBeef || Boolean(verifiedDishBudget) ||
      (explicitVegetarian && dishQueries.some((dish) => normalizeLocationText(dish).endsWith(' chay'))) ||
      dishQueries.some((dish) =>
        ['cha gio xuan huong', 'goi bo wasabi', 'ga dat hap nieu', 'sup hai san', 'dau hu chien sa ot', 'com chay kho quet', 'truffle shroom pizza', 'the margherita', 'the fisherman', 'the pepperoni', 'banh kem mousse chanh day', 'banh kem mousse tra xanh', 'banh kem bap trai cay', 'banh kem bento 90k', 'banh kem tiramisu', 'pho ga trong thien thap cam', 'pho long ga trung non', 'com goi ga xe', 'xoi ga ta xe', 'hu tiu nam vang nuoc to dac biet', 'hu tiu nam vang kho to dac biet', 'hu tiu nuoc binh thuong', 'hu tiu kho binh thuong', 'hu tiu nuoc nho', 'hu tiu kho nho', 'hu tiu em be', 'mi bo vien trieu chau', 'mi kim chi thap cam', 'mi kim chi so diep', 'mi kim chi hai san', 'mi kim chi bo my', 'mi kim chi bo', 'mi y hai san', 'mi y', 'spaghetti', 'pizza margherita', 'pizza calzone', 'salad ca hoi', 'salad hai san', 'com y hai san', 'sup bi do', 'california maki', 'ebi tempura', 'hotate sashimi', 'beef salad', 'pizza hai san', 'hu tieu xao hai san', 'mi vit tiem', 'com chien hai san', 'com chien tom', 'mi udon thit bo', 'com tam dui ga', 'com tam suon', 'canh kho qua', 'banh mi ba huynh dac biet', 'banh mi trung op la', 'banh mi nem nuong', 'bun kho lui heo nuong', 'cuon lui bo', 'cuon lui heo', 'goi tre tron xoai', 'mi bo dai loan', 'mi suon bo ham', 'mi sui cao tom', 'mi ga chien', 'mi kho xa xiu', 'cha ca de vuong', 'lau ca lang', 'lau ca tam', 'lau dau ca', 'salad da ca', 'chao ca', 'nem ca', 'banh xeo mien tay']
          .includes(normalizeLocationText(dish)));
    const district =
      body.filters?.area ?? groundedDistrict(body.query, interpreted, intent?.district);
    const priceLevel =
      body.filters?.priceLevel ??
      (intent?.priceLevel && hasExplicitPriceIntent(body.query) && !hasNumericBudget(body.query)
        ? intent.priceLevel : undefined);
    const minRating =
      body.filters?.minRating ??
      (intent?.minRating && hasExplicitRatingIntent(body.query) ? intent.minRating : undefined);
    const openNow =
      body.filters?.openNow ??
      (intent?.openNow === true && hasExplicitOpenNowIntent(body.query) ? true : undefined);
    // Weather changes food preference, not search scope. A radius is valid
    // only when the request explicitly carries one or the user explicitly
    // asked for nearby/distance context.
    const explicitIntentDistanceKm = hasExplicitNearbyIntent(body.query)
      ? explicitNearbyDistanceKm(body.query)
      : undefined;
    const radiusMeters =
      body.filters?.radiusMeters ??
      (explicitIntentDistanceKm ? explicitIntentDistanceKm * 1000 : undefined);
    const parsedTastes = mergeComfortTastes(
      interpreted.tastes ?? [],
      intent,
      interpreted.comfortTaste,
      body.query,
      body.filters?.taste ?? [],
    );
    // Tastes the user explicitly picked in the UI (vs. inferred from the
    // sentence or the LLM) are intent, not decoration: they are kept when the
    // fallback chain relaxes the inferred keyword filters.
    const explicitTastes = body.filters?.taste ?? [];
    const positiveDeterministicTastes = interpreted.tastes.filter((taste) =>
      !excludedFoodTerms.some((term) =>
        normalizeLocationText(term).includes(normalizeLocationText(taste))));
    // A cooking-method word can be part of the dish identity itself
    // ("bún thịt nướng"). Once that phrase is promoted to a hard dish query,
    // do not AND a second inferred attribute onto it: the dish evidence is the
    // authority, and some older rows have no reliable attribute link.
    const normalizeFoodText = (value: string) =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('vi-VN')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    const normalizedDishQueries = dishQueries.map(normalizeFoodText);
    const tastes = parsedTastes.filter(
      (taste) =>
        !excludedFoodTerms.some((term) =>
          normalizeLocationText(term).includes(normalizeLocationText(taste))) &&
        (explicitTastes.includes(taste) ||
          !normalizedDishQueries.some((dish) => dish.includes(normalizeFoodText(taste)))),
    );
    // A distilled food-only phrase (from the LLM, or a deterministic weather/
    // comfort fallback) becomes the embedding input, so fuzzy intent ("ấm
    // bụng", "kiểu đồ ăn Đà Nẵng", "trời mưa") can rank restaurants by their
    // semantic_profile even when no taxonomy filter matches. Falls back
    // silently when the provider/vectors are unavailable. A deterministic
    // weather reading takes precedence over the LLM so "trời nóng" embeds the
    // cold/refreshing phrase and not whatever temperature the LLM guessed.
    const semanticText =
      (
        interpreted.semanticQuery?.trim() ||
        intent?.semanticQuery?.trim() ||
        // The distilled food phrase (filler/location words removed) is a much
        // cleaner embedding input than the raw sentence: "bánh mì ngon" embeds
        // "bánh mì", "nhóm đông nướng ngoài trời" embeds the dish phrase. The
        // inferred tastes are appended so a cooking method like "nướng" keeps
        // its weight even after the SQL taste filter is relaxed away.
        [interpreted.query, ...(tastes.length ? [tastes.join(' ')] : [])]
          .filter(Boolean)
          .join(' ')
          .trim() ||
        body.query.trim() ||
        ''
      ).slice(0, 200) || undefined;
    // Exact dish retrieval is already grounded by the trusted menu gate. A
    // second vector search only adds latency and can let generic similarity
    // compete with the exact menu ordering, so reserve embeddings for fuzzy
    // and contextual recommendations.
    // A strict cuisine/style request is already constrained by structured
    // evidence. Do not enqueue an Ollama embedding for it: semantic similarity
    // cannot improve precision here and concurrent local embedding calls can
    // otherwise make unrelated recommendation requests wait behind the model.
    const semanticEmbedding =
      simpleFoodLookup ||
      dishQueries.length ||
      dishQueriesAny.length ||
      strictFoodQuery ||
      interpreted.dishStyle ||
      deterministicStructuredLookup
        ? null
        : semanticText
          ? await this.resolveEmbedding(semanticText)
          : null;

    const understanding: RecommendationUnderstanding = {
      query: body.query,
      aiSummary: safeAiSummary(intent, interpreted, dishQueries),
      filters: {
        ...(category ? { category } : {}),
        ...(dishQueries.length ? { dishes: dishUnderstanding(dishQueries, intent) } : {}),
        ...(district ? { district } : {}),
        attributes: interpreted.attributes,
        tastes,
        ...(excludedFoodTerms.length ? { excludedFoods: excludedFoodTerms } : {}),
        ...(ingredientTerms.length ? { ingredients: ingredientTerms } : {}),
        ...(interpreted.dishStyle ? { dishStyle: interpreted.dishStyle } : {}),
        ...(strictFoodQuery ? { food: strictFoodQuery } : {}),
        ...(priceLevel !== undefined ? { priceLevel } : {}),
        ...(minRating !== undefined ? { minRating } : {}),
        ...(openNow !== undefined ? { openNow } : {}),
        ...(radiusMeters !== undefined ? { distanceKm: radiusMeters / 1000 } : {}),
      },
    };
    const filters = {
      // Only the distilled food phrase becomes the SQL text filter. When the
      // interpretation consumed the whole sentence into structured filters
      // (weather → comfort taste + semantic query), `interpreted.query` is
      // empty and falling back to the raw sentence would add a LIKE filter on
      // words like "trời"/"nóng" that match almost nothing. The semantic
      // embedding already encodes that intent.
      query: phoWithoutBeef
        ? 'phở'
        : excludedFoodTerms.some((term) => term === 'gà rán' || term === 'gà chiên')
          ? 'gà'
          : excludedFoodTerms.reduce<string | undefined>(
            (value, term) => value ? removePhrase(value, term).trim() || undefined : value,
            interpreted.query || (genericMiLookup ? 'mì' : undefined),
          ),
      category,
      latitude: body.location?.latitude,
      longitude: body.location?.longitude,
      radiusMeters,
      minRating,
      priceLevel,
      openNow,
      sort: body.filters?.sort,
      district,
      dishTypes: body.filters?.dishTypes?.map(
        (value) =>
          DISH_TYPE_ALIASES.find(([label]) => label === value.toLocaleLowerCase('vi-VN'))?.[1] ??
          value,
      ),
      tastes,
      // Words such as "nước" can be part of a verified dish name (for
      // example "Thịt kho trứng nước dừa"), not a request for soup. Once
      // the full catalog label is confirmed, do not layer a style filter
      // over its exact menu-evidence match.
      ...(interpreted.dishStyle && !catalogExactDish ? { dishStyle: interpreted.dishStyle } : {}),
      ...(strictFoodQuery ? { strictFoodQuery } : {}),
      ...(excludedFoodTerms.length ? { excludedFoodTerms } : {}),
      ...(ingredientTerms.length ? { ingredientTerms } : {}),
      dishQueries,
      ...(verifiedDishBudget ? {
        maxDishPriceVnd: verifiedDishBudget.amount,
        maxDishPriceExclusive: verifiedDishBudget.exclusive,
      } : {}),
      ...(verifiedMenuOnly ? { verifiedMenuOnly: true } : {}),
      ...(catalogExactDish && normalizeLocationText(catalogExactDish).split(' ').length >= 3
        ? { exactDishNameOnly: true }
        : {}),
      dishQueriesAny,
      limit: body.limit,
      semanticQuery: semanticText,
      embedding: semanticEmbedding ?? undefined,
      ...(request?.user ? { personalizationUserId: request.user.id } : {}),
    };
    // Track the exact filters that produced the returned page so a follow-up
    // (cursor) request can replay the same query without re-running the LLM.
    // Filters the user explicitly picked in the UI are intent and are kept
    // through every fallback; filters the LLM/interpretation inferred (area,
    // price level, rating, open-now) are "nice to have" and are dropped one by
    // one when the current dataset cannot satisfy them (e.g. the DB has almost
    // no price_level values, and Bình Thạnh has not been crawled yet).
    const explicit = {
      // A district written in the user's sentence is explicit intent too. It
      // must never be relaxed merely because the current crawl is sparse.
      district: body.filters?.area !== undefined || interpreted.district !== undefined,
      priceLevel: body.filters?.priceLevel !== undefined,
      minRating: body.filters?.minRating !== undefined,
      openNow: body.filters?.openNow !== undefined,
    };
    let effective: RestaurantFilters = filters;
    // The user's original intent (before the fallback chain relaxes inferred
    // filters that the current dataset cannot satisfy). The explanation still
    // references it — guarded by the restaurant's real categories — so a page
    // like "quán chay thanh đạm" keeps saying "nhóm vegetarian" even when the
    // too-narrow inferred filters had to be dropped to produce results.
    const intended = {
      category: filters.category,
      tastes: filters.tastes,
      dishQueries: filters.dishQueries,
      ingredientTerms: filters.ingredientTerms,
      weatherComfort: Boolean(filters.dishQueriesAny?.length),
    };
    let page = await this.restaurantsService.list(effective);
    if (!page.data.length && catalogExactDish && effective.exactDishNameOnly &&
      effective.district && interpreted.menuLookupQuery) {
      // An exact dish elsewhere must not make a user-specified district look
      // empty when its local first-party menu names the same food as the
      // leading alternative of a slash-composite label. Resolve that full
      // local label first; never relax the district or admit a mere photo.
      const localComposite = await this.restaurantsService.findVerifiedSlashDishNameInDistrict?.(
        interpreted.menuLookupQuery, effective.district,
      );
      if (localComposite) {
        effective = { ...effective, query: undefined, dishQueries: [localComposite] };
        intended.dishQueries = [localComposite];
        understanding.filters.dishes = dishUnderstanding([localComposite], intent);
        page = await this.restaurantsService.list(effective);
      }
    }
    if (
      !page.data.length &&
      !effective.dishQueries?.length &&
      effective.district &&
      !explicit.district
    ) {
      effective = { ...effective, district: undefined };
      page = await this.restaurantsService.list(effective);
    }
    if (
      !page.data.length &&
      !effective.dishQueries?.length &&
      effective.priceLevel !== undefined &&
      !explicit.priceLevel
    ) {
      effective = { ...effective, priceLevel: undefined };
      page = await this.restaurantsService.list(effective);
    }
    if (
      !page.data.length &&
      !effective.dishQueries?.length &&
      effective.minRating !== undefined &&
      !explicit.minRating
    ) {
      effective = { ...effective, minRating: undefined };
      page = await this.restaurantsService.list(effective);
    }
    if (
      !page.data.length &&
      !effective.dishQueries?.length &&
      effective.openNow &&
      !explicit.openNow
    ) {
      effective = { ...effective, openNow: undefined };
      page = await this.restaurantsService.list(effective);
    }
    if (
      !effective.dishQueries?.length &&
      !page.data.length &&
      effective.query &&
      (effective.category || effective.dishTypes?.length) &&
      effective.category !== 'vegetarian'
    ) {
      // The category/dish-type taxonomy can be incomplete for a restaurant
      // that clearly serves something (e.g. mì without the `noodle` link).
      // Retry keeping the query text and the explicit taste filters, which
      // now resolve through dish attributes (food_attribute / dish_attribute).
      effective = { ...effective, category: undefined, dishTypes: undefined };
      page = await this.restaurantsService.list(effective);
    }
    const explicitFoodQuery = isHardFoodIntent(body.query, interpreted);
    const residualQueryTermCount = effective.query?.trim().split(/\s+/u).filter(Boolean).length ?? 0;
    if (
      !effective.dishQueries?.length &&
      !effective.dishQueriesAny?.length &&
      !page.data.length &&
      Boolean(effective.query) &&
      residualQueryTermCount >= 2 &&
      !explicitFoodQuery &&
      !effective.ingredientTerms?.length &&
      !/(?:protein|nhiều đạm|giàu đạm)/iu.test(body.query) &&
      !effective.dishStyle
    ) {
      // Multi-constraint natural language such as "gà ít dầu mỡ, nhiều rau"
      // is not an exact dish. If the catalog cannot satisfy every lexical term,
      // retry as broad discovery while retaining location, price and open-now
      // constraints. This gives the user useful candidates; a one-token
      // unknown lookup such as "xyzabc" remains strict and empty.
      effective = { ...effective, query: undefined, sort: RestaurantSort.Rating };
      page = await this.restaurantsService.list(effective);
    }
    if (
      !page.data.length &&
      effective.category === 'vegetarian' &&
      effective.query &&
      !effective.dishQueries?.length &&
      !effective.ingredientTerms?.length &&
      /(?:protein|nhiều đạm|giàu đạm)/iu.test(body.query)
    ) {
      // Nutrition is not in the verified menu schema. A vegetarian venue is
      // still a useful scoped candidate, provided the response explicitly
      // discloses that its protein content has not been checked.
      effective = { ...effective, query: undefined, sort: RestaurantSort.Rating };
      page = await this.restaurantsService.list(effective);
    }
    // Keep a meaningful food phrase as a hard retrieval constraint. Dropping
    // it and retrying with an empty query turns an unknown dish into unrelated
    // top-rated restaurants (for example "xyzabc" returning ramen/pizza).
    // Broad fallback is reserved for prompts that were fully consumed into
    // structured context such as weather, category, or explicit UI filters.
    // With a live embedding, an inferred taste can AND the candidates down to a
    // handful of rows (e.g. only 12 restaurants carry the "mát" attribute in a
    // 2.5k-restaurant DB), leaving the semantic ranking almost nothing to sort.
    // The query vector already encodes the taste, so when the page is short of
    // the requested limit, drop the inferred tastes (never the explicit UI
    // picks) and let the semantic score fill the page.
    if (
      !effective.dishQueries?.length &&
      page.data.length < body.limit &&
      effective.embedding &&
      interpreted.comfortTaste !== 'nóng' &&
      // A deterministic taste written by the user ("món nướng", "đồ cay")
      // is a real hard intent and must not be relaxed just because the vector
      // page is short. Only LLM-inferred tastes may be widened here.
      (effective.tastes ?? []).some(
        (taste) =>
          !explicitTastes.includes(taste) &&
          (!(interpreted.tastes ?? []).includes(taste) || taste === interpreted.comfortTaste),
      )
    ) {
      effective = { ...effective, tastes: explicitTastes };
      page = await this.restaurantsService.list(effective);
    }
    if (
      !effective.dishQueries?.length &&
      !page.data.length &&
      !effective.query &&
      effective.category === 'dessert' &&
      (effective.tastes ?? []).includes('ngọt') &&
      explicitTastes.length === 0
    ) {
      // "Chè/bánh ngọt" has an independent dessert-category/name signal even
      // when dish-level taste annotations are absent. Show these as category
      // candidates, not as verified sweet dishes.
      effective = { ...effective, tastes: [] };
      page = await this.restaurantsService.list(effective);
    }
    if (
      !effective.dishQueries?.length &&
      !page.data.length &&
      !effective.query &&
      !effective.dishStyle &&
      (effective.tastes?.length ?? 0) > 0 &&
      positiveDeterministicTastes.length === 0 &&
      explicitTastes.length === 0
    ) {
      // Taste/attribute coverage is often sparser than restaurant coverage.
      // If there is no exact dish and the taste is inferred from natural
      // language, keep category/location/price/open-now constraints but retry
      // without the taste as a hard AND filter. The ranking can still use the
      // restaurant profile, while production avoids an empty page solely
      // because an attribute row has not been enriched yet.
      effective = { ...effective, tastes: [], sort: RestaurantSort.Rating };
      page = await this.restaurantsService.list(effective);
    }
    if (
      !effective.dishQueries?.length &&
      !page.data.length &&
      !effective.query &&
      !explicitFoodQuery &&
      (positiveDeterministicTastes.length === 0 || explicitTastes.length > 0) &&
      !effective.dishStyle
    ) {
      // A natural-language prompt is a discovery entry point, but the user's
      // explicit taste/category/distance filters are intent, not decoration.
      // Drop only the free-text query and rank the remaining candidates by
      // rating. Never silently drop the filters and return unrelated
      // top-rated restaurants (e.g. Cơm tấm for a "món ngọt nóng" filter).
      // With a live embedding, keep ranking by semantic score instead of
      // rating so the fuzzy intent still drives the ordering. The inferred
      // taste words ("cay đậm đà") are AND-ed in the repository and usually
      // match nothing on their own, so they are dropped here too — the query
      // vector already encodes them, and only explicitly chosen UI tastes
      // stay respected.
      effective = {
        ...effective,
        query: undefined,
        tastes: effective.embedding ? explicitTastes : effective.tastes,
        sort: effective.embedding ? RestaurantSort.Relevance : RestaurantSort.Rating,
      };
      page = await this.restaurantsService.list(effective);
    }
    const menuEvidenceMissing = Boolean(
      (effective.dishQueries?.length || effective.dishQueriesAny?.length) && !page.data.length,
    );
    const unresolvedFoodQuery = Boolean(effective.query && !page.data.length);
    const unresolvedIngredients = Boolean(effective.ingredientTerms?.length && !page.data.length);
    const unverifiedTaste = Boolean(!page.data.length && positiveDeterministicTastes.length);
    const missingEvidenceDishes = effective.dishQueries?.length
      ? effective.dishQueries
      : effective.dishQueriesAny;
    const missingEvidenceMessage = effective.dishQueries?.length
      ? `Chưa tìm thấy quán có món ${effective.dishQueries.join(', ')} với menu${verifiedDishBudget ? ' và giá' : ''} đã xác minh${verifiedDishBudget ? ` đáp ứng ngân sách ${verifiedDishBudget.exclusive ? 'dưới' : 'tối đa'} ${verifiedDishBudget.amount.toLocaleString('vi-VN')} đồng` : ''} trong các bộ lọc hiện tại.`
      : 'Chưa tìm thấy món nóng/ấm bụng có menu đã xác minh trong các bộ lọc hiện tại.';
    const unverifiedConstraints = [
      /(?:protein|nhiều đạm|giàu đạm)/iu.test(body.query) ? 'hàm lượng protein' : null,
      /(?:bỏ da|không có da|không ăn da)/iu.test(body.query) ? 'yêu cầu bỏ da' : null,
      effective.ingredientTerms?.length && page.data.some((item) =>
        item.dishEvidenceStatus !== 'verified_menu')
        ? 'thành phần món ở một số quán' : null,
      hasNumericBudget(body.query) && !verifiedDishBudget
        ? 'giá món theo ngân sách' : null,
    ].filter((value): value is string => Boolean(value));
    const snapshot: Omit<RestaurantFilters, 'limit'> = { ...effective };
    delete (snapshot as { limit?: number }).limit;
    delete (snapshot as { personalizationUserId?: string }).personalizationUserId;
    // The vector is large (~1-2KB serialized floats) and would bloat the
    // cursor. Re-embed the stored `semanticQuery` on replay instead.
    delete (snapshot as { embedding?: unknown }).embedding;
    const nextOffset = page.meta.nextCursor ? decodeOffsetCursor(page.meta.nextCursor) : null;
    return {
      data: page.data.slice(0, body.limit).map((restaurant) => ({
        restaurant,
        explanation: this.explain(
          restaurant.categories.map((c) => c.slug),
          {
            category: intended.category,
            district: effective.district,
            priceLevel: effective.priceLevel,
            openNow: effective.openNow,
            tastes: effective.tastes,
            location: effective.latitude !== undefined ? true : undefined,
            dishes: intended.dishQueries,
            ingredientTerms: intended.ingredientTerms,
            matchedDishes: restaurant.matchedDishes,
            dishEvidenceStatus: restaurant.dishEvidenceStatus,
            weatherComfort: intended.weatherComfort,
            distanceMeters: restaurant.distanceMeters,
          },
        ),
      })),
      meta: {
        nextCursor:
          nextOffset !== null
            ? encodeRecommendationCursor({ offset: nextOffset, filters: snapshot })
            : null,
        understanding,
        ...(menuEvidenceMissing && Boolean(effective.dishQueries?.length) && unverifiedTaste
          ? {
              quality: {
                code: 'NO_VERIFIED_COMBINATION',
                message: `Chưa tìm thấy quán đáp ứng đồng thời món ${missingEvidenceDishes?.join(', ')} và khẩu vị ${[...new Set(positiveDeterministicTastes)].join(', ')} trong các bộ lọc hiện tại. Bạn có thể mở rộng khu vực hoặc đổi một điều kiện.`,
              },
            }
          : menuEvidenceMissing
          ? {
              quality: {
                code: 'MENU_EVIDENCE_MISSING',
                message: missingEvidenceMessage,
                dishes: missingEvidenceDishes,
              },
            }
          : unresolvedIngredients
            ? {
                quality: {
                  code: 'NO_VERIFIED_INGREDIENT_MATCH',
                  message: `Chưa tìm thấy món có đủ ${effective.ingredientTerms?.join(' và ')} trong dữ liệu menu đáng tin cậy.`,
                },
              }
          : unresolvedFoodQuery
            ? {
                quality: {
                  code: 'NO_RELEVANT_RESULTS',
                  message: `Chưa tìm thấy kết quả phù hợp với "${effective.query}".`,
                },
              }
            : unverifiedTaste
              ? {
                  quality: {
                    code: 'NO_VERIFIED_TASTE_MATCH',
                    message: `Chưa có món đủ bằng chứng cho khẩu vị ${[...new Set(positiveDeterministicTastes)].join(', ')}; Bếp không muốn gợi ý sai.`,
                  },
                }
            : page.data.length && unverifiedConstraints.length
              ? {
                  quality: {
                    code: 'CONSTRAINT_UNVERIFIED',
                    message: `Chưa xác minh được ${unverifiedConstraints.join(', ')} từ menu hiện có; hãy hỏi quán trước khi đặt.`,
                  },
                }
              : {}),
      },
    };
  }

  @Post('interactions')
  @UseGuards(AuthGuard)
  async interaction(
    @Req() request: AuthenticatedRequest,
    @Body() body: RecommendationInteractionDto,
  ) {
    if (!this.recommendationEvents)
      throw new BadRequestException('Interaction tracking unavailable.');
    if (!['open', 'save', 'dismiss'].includes(body.type))
      throw new BadRequestException('Unsupported recommendation interaction.');
    await this.recommendationEvents.record(
      request.user!.id,
      body.restaurantId,
      body.type,
      body.query,
    );
    return { recorded: true };
  }

  private async recommendNextPage(body: RecommendationDto, request?: AuthenticatedRequest) {
    const decoded = decodeRecommendationCursor(body.cursor!);
    if (!decoded) throw new BadRequestException('Invalid recommendations cursor.');
    const embedding =
      decoded.filters.semanticQuery && !decoded.filters.embedding
        ? await this.resolveEmbedding(decoded.filters.semanticQuery)
        : decoded.filters.embedding;
    const page = await this.restaurantsService.list({
      ...decoded.filters,
      ...(request?.user ? { personalizationUserId: request.user.id } : {}),
      embedding: embedding ?? undefined,
      limit: body.limit,
      cursor: encodeOffsetCursor(decoded.offset),
    });
    const nextOffset = page.meta.nextCursor ? decodeOffsetCursor(page.meta.nextCursor) : null;
    return {
      data: page.data.slice(0, body.limit).map((restaurant) => ({
        restaurant,
        explanation: this.explain(
          restaurant.categories.map((c) => c.slug),
          {
            category: decoded.filters.category,
            district: decoded.filters.district,
            priceLevel: decoded.filters.priceLevel,
            openNow: decoded.filters.openNow,
            tastes: decoded.filters.tastes,
            location: decoded.filters.latitude !== undefined ? true : undefined,
            dishes: decoded.filters.dishQueries,
            ingredientTerms: decoded.filters.ingredientTerms,
            matchedDishes: restaurant.matchedDishes,
            dishEvidenceStatus: restaurant.dishEvidenceStatus,
            weatherComfort: Boolean(decoded.filters.dishQueriesAny?.length),
            distanceMeters: restaurant.distanceMeters,
          },
        ),
      })),
      meta: {
        nextCursor:
          nextOffset !== null
            ? encodeRecommendationCursor({ offset: nextOffset, filters: decoded.filters })
            : null,
        quality: null,
      },
    };
  }

  @Get('for-you')
  @UseGuards(AuthGuard)
  async forYou(@Req() request: AuthenticatedRequest) {
    if (!this.auth) throw new BadRequestException('Personalized recommendations are unavailable.');
    const preferences = await this.auth.getPreferences(request.user!.id);
    const categories = [...new Set(preferences.favoriteCategorySlugs)].slice(0, 4);
    const priceLevels = [...new Set(preferences.preferredPriceLevels)].slice(0, 4);
    const tastes = [...new Set(preferences.dietaryPreferences)].slice(0, 6);
    const combinations =
      categories.length && priceLevels.length
        ? categories.flatMap((category) =>
            priceLevels.map((priceLevel) => ({ category, priceLevel })),
          )
        : categories.length
          ? categories.map((category) => ({ category }))
          : priceLevels.map((priceLevel) => ({ priceLevel }));
    const queries = combinations.length ? combinations : [{}];
    const pages = await Promise.all(
      queries.map((filters) =>
        this.restaurantsService.list({ ...filters, tastes, sort: RestaurantSort.Rating, limit: 8 }),
      ),
    );
    const candidates = new Map(
      pages.flatMap((page) => page.data).map((restaurant) => [restaurant.id, restaurant]),
    );
    let restaurants = [...candidates.values()]
      .sort(
        (left, right) =>
          (right.rating ?? 0) - (left.rating ?? 0) ||
          (right.reviewCount ?? 0) - (left.reviewCount ?? 0),
      )
      .slice(0, 8);
    if (!restaurants.length && (categories.length || priceLevels.length || tastes.length)) {
      const fallback = await this.restaurantsService.list({
        sort: RestaurantSort.Rating,
        limit: 8,
      });
      restaurants = fallback.data;
    }
    return {
      data: restaurants.map((restaurant) => ({
        restaurant,
        explanation: this.forYouExplanation(
          restaurant.categories.map((c) => c.name),
          categories,
          tastes,
          priceLevels,
        ),
      })),
    };
  }

  private forYouExplanation(
    categories: string[],
    favoriteCategories: string[],
    tastes: string[] = [],
    priceLevels: number[] = [],
  ): string {
    const reasons: string[] = [];
    if (
      favoriteCategories.length &&
      favoriteCategories.some((category) =>
        categories.some((value) =>
          value.toLocaleLowerCase('vi-VN').includes(category.replace('-', ' ')),
        ),
      )
    )
      reasons.push('nhóm món bạn thích');
    if (tastes.length) reasons.push('khẩu vị đã lưu');
    if (priceLevels.length) reasons.push(`mức giá ${priceLevels.join(', ')}`);
    return reasons.length
      ? `Gợi ý dựa trên ${reasons.join(', ')}.`
      : 'Được chọn từ những quán được đánh giá cao.';
  }

  private explain(
    categories: string[],
    applied: {
      category?: string;
      district?: string;
      priceLevel?: number;
      openNow?: boolean;
      tastes?: string[];
      location?: boolean;
      dishes?: string[];
      ingredientTerms?: string[];
      matchedDishes?: string[];
      dishEvidenceStatus?: 'verified_menu' | 'candidate_signal';
      weatherComfort?: boolean;
      distanceMeters?: number | null;
    },
  ): string | null {
    const reasons: string[] = [];
    if (applied.dishes?.length && applied.dishEvidenceStatus === 'candidate_signal') {
      reasons.push(
        `quán có tín hiệu phù hợp với món ${applied.dishes.join(', ')}; cần kiểm tra menu`,
      );
    } else if (applied.dishes?.length) {
      reasons.push(`menu đã xác minh món ${applied.dishes.join(', ')}`);
    } else if (applied.weatherComfort && applied.dishEvidenceStatus === 'candidate_signal') {
      reasons.push('quán có tín hiệu món nóng/ấm bụng; cần kiểm tra menu');
    } else if (applied.weatherComfort) {
      reasons.push(
        applied.matchedDishes?.length
          ? `menu đã xác minh món ${applied.matchedDishes.join(', ')} phù hợp trời mưa/lạnh`
          : 'menu đã xác minh món nóng phù hợp trời mưa/lạnh',
      );
    } else if (applied.matchedDishes?.length && applied.tastes?.length) {
      reasons.push(
        `menu đã xác minh món ${applied.matchedDishes.join(', ')} phù hợp khẩu vị ${applied.tastes.join(', ')}`,
      );
    } else if (applied.ingredientTerms?.length) {
      reasons.push(`tín hiệu món có ${applied.ingredientTerms.join(' và ')}; cần kiểm tra menu`);
    } else if (applied.category && categories.includes(applied.category)) {
      reasons.push(`nhóm ${applied.category.replace('-', ' ')}`);
    }
    if (applied.priceLevel !== undefined && applied.priceLevel !== null)
      reasons.push(`mức giá ${applied.priceLevel}`);
    if (applied.openNow) reasons.push('đang mở cửa');
    if (
      applied.tastes?.length &&
      !applied.weatherComfort &&
      (!applied.matchedDishes?.length || Boolean(applied.dishes?.length))
    )
      reasons.push(`khẩu vị ${applied.tastes.join(', ')}`);
    if (applied.district) reasons.push(`khu vực ${applied.district}`);
    if (applied.distanceMeters !== null && applied.distanceMeters !== undefined) {
      reasons.push(`cách bạn ${(applied.distanceMeters / 1000).toFixed(1)} km`);
    } else if (applied.location) {
      reasons.push('vị trí của bạn');
    }
    return reasons.length ? `Phù hợp với ${reasons.join(', ')}.` : null;
  }
}

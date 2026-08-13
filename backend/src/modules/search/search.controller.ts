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
  RestaurantSort,
} from '../restaurants/restaurants.dto';
import { RestaurantsService } from '../restaurants/restaurants.service';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { AiIntentService } from '../ai/ai-intent.service';
import { EmbeddingService } from '../ai/embedding.service';
import type { AiIntent } from '../ai/ai.types';
import type { RestaurantFilters } from '../restaurants/restaurants.types';

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
  /** The query reduced to meaningful food terms only (filler/location/taste words removed). */
  query?: string;
}

interface AuthenticatedRequest {
  user?: AuthUser;
}

const DISH_TYPE_ALIASES: ReadonlyArray<readonly [string, string]> = [
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
  ['chiên', 'chiên'],
  ['thanh đạm', 'thanh đạm'],
  ['nhẹ bụng', 'nhẹ bụng'],
  ['nhẹ', 'nhẹ bụng'],
  ['no lâu', 'no lâu'],
  ['đầy bữa', 'đầy bữa'],
  ['đậm đà', 'đậm đà'],
  ['tươi', 'tươi'],
];

// Weather words that imply a comfort-food direction without the user naming a
// taste. Cold/rainy weather → hot hearty dishes ("trời mưa" → "nóng"); hot/sunny
// weather → cold, refreshing dishes ("trời nóng" → "mát"). Kept separate from
// TASTE_ALIASES so the weather reading wins ("trời nóng" must never become the
// hot-food taste "nóng") and the taste stays AND-able as an exact attribute.
const WEATHER_COMFORT_PHRASES: ReadonlyArray<readonly [string, string]> = [
  // Cold / rainy → hot comfort food.
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
  'của',
  'tại',
  'ra',
  'để',
  'đi',
  'bữa',
  'gần',
  'đây',
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
  'lúc',
  'giờ',
  'thêm',
  'nữa',
  'được',
  'không',
  'chỗ',
  'nơi',
  'xem',
  'ăn',
  'uống',
  'đồ',
  'vặt',
  'giá',
  'rẻ',
  'đắt',
  'xịn',
  'sang',
  'tiền',
  'đang',
  'hãy',
  'hiện',
  'bây',
  'giờ',
  'này',
];

const FILLER_PHRASES: readonly string[] = [
  'gần đây',
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
  'gợi ý',
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
  explicit: string[] = [],
): string[] => {
  const opposite =
    comfortTaste === 'mát' ? 'nóng' : comfortTaste === 'nóng' ? 'mát' : undefined;
  const intentTastes = cleanTasteTerms([
    ...(intent?.tastes ?? []),
    ...(intent?.dishes ?? []),
  ]).filter((taste) => taste !== opposite);
  return [...new Set([...explicit, ...deterministic, ...intentTastes])];
};

function interpretQuery(query: string): InterpretedFilters {
  const normalized = query.toLocaleLowerCase('vi-VN');
  // Match aliases as whole words/phrases so short aliases like "ý" or "mì"
  // cannot fire inside unrelated words ("gợi ý", "mì" inside "mì tôm").
  const hasPhrase = (phrase: string): boolean =>
    new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeRegExp(phrase)}(?=$|[^\\p{L}\\p{N}])`,
      'u',
    ).test(normalized);
  const dishTypeCategory = DISH_TYPE_ALIASES.find(([alias]) => hasPhrase(alias))?.[1];
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
  const tastes: string[] = [];
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
      tastes.push(canonical);
      refined = next;
    }
  }
  for (const phrase of FILLER_PHRASES) refined = removePhrase(refined, phrase);
  for (const word of FILLER_WORDS) refined = removePhrase(refined, word);

  const queryTerm = refined.replace(/\s+/g, ' ').trim();
  return {
    ...(category ? { category } : {}),
    ...(category ? { categoryFromDishType: Boolean(dishTypeCategory) } : {}),
    ...(district ? { district } : {}),
    attributes,
    tastes: comfortTaste && !tastes.includes(comfortTaste) ? [...tastes, comfortTaste] : tastes,
    ...(comfortTaste ? { comfortTaste } : {}),
    ...(comfortTaste ? { semanticQuery: COMFORT_SEMANTIC_QUERY[comfortTaste] } : {}),
    ...(queryTerm ? { query: queryTerm } : {}),
  };
}

function firstFilterableCategory(
  intent: AiIntent | null,
  interpreted: InterpretedFilters,
): string | undefined {
  // An explicit dish-type word in the query (bún, cơm, mì, phở, ăn vặt…) is an
  // exact, reliable category signal. Prefer it over the LLM's broader guess so
  // "bún bò huế" matches `bun` restaurants instead of the LLM's "noodle".
  if (interpreted.categoryFromDishType && FILTERABLE_CATEGORY_SLUGS.has(interpreted.category!)) {
    return interpreted.category;
  }
  if (intent && intent.categories.length) {
    const fromIntent = intent.categories.find((slug) => FILTERABLE_CATEGORY_SLUGS.has(slug));
    if (fromIntent) return fromIntent;
  }
  return interpreted.category && FILTERABLE_CATEGORY_SLUGS.has(interpreted.category)
    ? interpreted.category
    : undefined;
}

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
    const intent = this.aiIntent?.isEnabled() ? await this.aiIntent.interpret(body.query) : null;
    const interpreted = interpretQuery(body.query);
    const filters: InterpretedFilters & {
      priceLevel?: number;
      minRating?: number;
      openNow?: boolean;
      distanceKm?: number;
    } = {
      ...(intent?.categories?.[0]
        ? { category: intent.categories[0] }
        : interpreted.category
          ? { category: interpreted.category }
          : {}),
      ...(intent?.district
        ? { district: intent.district }
        : interpreted.district
          ? { district: interpreted.district }
          : {}),
      attributes: interpreted.attributes,
      tastes: mergeComfortTastes(interpreted.tastes, intent, interpreted.comfortTaste),
      ...(intent?.priceLevel ? { priceLevel: intent.priceLevel } : {}),
      ...(intent?.minRating ? { minRating: intent.minRating } : {}),
      ...(intent?.openNow === null || intent === null ? {} : { openNow: intent?.openNow }),
      ...(intent?.distanceKm ? { distanceKm: intent.distanceKm } : {}),
    };
    return {
      data: {
        query: body.query,
        aiSummary: intent?.summary ?? null,
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
  ) {}
  // Embeds the food-only phrase and resolves the active stored model so the
  // search query compares against the vectors that actually exist. Returns
  // null (semantic path off) when the provider is unset or the DB has no
  // vectors yet — the request then runs the structured/keyword pipeline.
  private async resolveEmbedding(text: string): Promise<{ vector: number[]; model: string } | null> {
    if (!this.embedding?.isEnabled()) return null;
    const [model, vector] = await Promise.all([
      this.embedding.activeModel(),
      this.embedding.embed(text),
    ]);
    if (!model) return null;
    return { vector, model };
  }
  @Post()
  async recommend(@Body() body: RecommendationDto) {
    if (body.cursor) return this.recommendNextPage(body);
    const interpreted = interpretQuery(body.query);
    const intent = this.aiIntent?.isEnabled() ? await this.aiIntent.interpret(body.query) : null;
    const category = firstFilterableCategory(intent, interpreted);
    const district = body.filters?.area ?? intent?.district ?? interpreted.district;
    const priceLevel = body.filters?.priceLevel ?? intent?.priceLevel ?? undefined;
    const minRating = body.filters?.minRating ?? intent?.minRating ?? undefined;
    const openNow = body.filters?.openNow ?? intent?.openNow ?? undefined;
    const radiusMeters =
      body.filters?.radiusMeters ?? (intent?.distanceKm ? intent.distanceKm * 1000 : undefined);
    const tastes = mergeComfortTastes(
      interpreted.tastes ?? [],
      intent,
      interpreted.comfortTaste,
      body.filters?.taste ?? [],
    );
    // Tastes the user explicitly picked in the UI (vs. inferred from the
    // sentence or the LLM) are intent, not decoration: they are kept when the
    // fallback chain relaxes the inferred keyword filters.
    const explicitTastes = body.filters?.taste ?? [];
    // A distilled food-only phrase (from the LLM, or a deterministic weather/
    // comfort fallback) becomes the embedding input, so fuzzy intent ("ấm
    // bụng", "kiểu đồ ăn Đà Nẵng", "trời mưa") can rank restaurants by their
    // semantic_profile even when no taxonomy filter matches. Falls back
    // silently when the provider/vectors are unavailable. A deterministic
    // weather reading takes precedence over the LLM so "trời nóng" embeds the
    // cold/refreshing phrase and not whatever temperature the LLM guessed.
    const semanticText =
      (interpreted.semanticQuery?.trim() ||
        intent?.semanticQuery?.trim() ||
        body.query.trim() ||
        '').slice(0, 200) || undefined;
    const semanticEmbedding = semanticText ? await this.resolveEmbedding(semanticText) : null;
    const filters = {
      // Only the distilled food phrase becomes the SQL text filter. When the
      // interpretation consumed the whole sentence into structured filters
      // (weather → comfort taste + semantic query), `interpreted.query` is
      // empty and falling back to the raw sentence would add a LIKE filter on
      // words like "trời"/"nóng" that match almost nothing. The semantic
      // embedding already encodes that intent.
      query: interpreted.query,
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
      limit: body.limit,
      semanticQuery: semanticText,
      embedding: semanticEmbedding ?? undefined,
    };
    // Track the exact filters that produced the returned page so a follow-up
    // (cursor) request can replay the same query without re-running the LLM.
    // Filters the user explicitly picked in the UI are intent and are kept
    // through every fallback; filters the LLM/interpretation inferred (area,
    // price level, rating, open-now) are "nice to have" and are dropped one by
    // one when the current dataset cannot satisfy them (e.g. the DB has almost
    // no price_level values, and Bình Thạnh has not been crawled yet).
    const explicit = {
      district: body.filters?.area !== undefined,
      priceLevel: body.filters?.priceLevel !== undefined,
      minRating: body.filters?.minRating !== undefined,
      openNow: body.filters?.openNow !== undefined,
    };
    let effective: RestaurantFilters = filters;
    let page = await this.restaurantsService.list(effective);
    if (!page.data.length && effective.district && !explicit.district) {
      effective = { ...effective, district: undefined };
      page = await this.restaurantsService.list(effective);
    }
    if (!page.data.length && effective.priceLevel !== undefined && !explicit.priceLevel) {
      effective = { ...effective, priceLevel: undefined };
      page = await this.restaurantsService.list(effective);
    }
    if (!page.data.length && effective.minRating !== undefined && !explicit.minRating) {
      effective = { ...effective, minRating: undefined };
      page = await this.restaurantsService.list(effective);
    }
    if (!page.data.length && effective.openNow && !explicit.openNow) {
      effective = { ...effective, openNow: undefined };
      page = await this.restaurantsService.list(effective);
    }
    if (!page.data.length && effective.query && (effective.category || effective.dishTypes?.length)) {
      // The category/dish-type taxonomy can be incomplete for a restaurant
      // that clearly serves something (e.g. mì without the `noodle` link).
      // Retry keeping the query text and the explicit taste filters, which
      // now resolve through dish attributes (food_attribute / dish_attribute).
      effective = { ...effective, category: undefined, dishTypes: undefined };
      page = await this.restaurantsService.list(effective);
    }
    if (!page.data.length && effective.query) {
      effective = { ...effective, query: undefined };
      page = await this.restaurantsService.list(effective);
    }
    // With a live embedding, an inferred taste can AND the candidates down to a
    // handful of rows (e.g. only 12 restaurants carry the "mát" attribute in a
    // 2.5k-restaurant DB), leaving the semantic ranking almost nothing to sort.
    // The query vector already encodes the taste, so when the page is short of
    // the requested limit, drop the inferred tastes (never the explicit UI
    // picks) and let the semantic score fill the page.
    if (
      page.data.length < body.limit &&
      effective.embedding &&
      (effective.tastes ?? []).some((taste) => !explicitTastes.includes(taste))
    ) {
      effective = { ...effective, tastes: explicitTastes };
      page = await this.restaurantsService.list(effective);
    }
    if (!page.data.length) {
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
    const snapshot: Omit<RestaurantFilters, 'limit'> = { ...effective };
    delete (snapshot as { limit?: number }).limit;
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
            category: effective.category,
            district: effective.district,
            priceLevel: effective.priceLevel,
            openNow: effective.openNow,
            tastes: effective.tastes,
            location: effective.latitude !== undefined ? true : undefined,
          },
        ),
      })),
      meta: {
        nextCursor:
          nextOffset !== null
            ? encodeRecommendationCursor({ offset: nextOffset, filters: snapshot })
            : null,
      },
    };
  }

  private async recommendNextPage(body: RecommendationDto) {
    const decoded = decodeRecommendationCursor(body.cursor!);
    if (!decoded) throw new BadRequestException('Invalid recommendations cursor.');
    const embedding =
      decoded.filters.semanticQuery && !decoded.filters.embedding
        ? await this.resolveEmbedding(decoded.filters.semanticQuery)
        : decoded.filters.embedding;
    const page = await this.restaurantsService.list({
      ...decoded.filters,
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
          },
        ),
      })),
      meta: {
        nextCursor:
          nextOffset !== null
            ? encodeRecommendationCursor({ offset: nextOffset, filters: decoded.filters })
            : null,
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
    },
  ): string | null {
    const reasons: string[] = [];
    if (applied.category && categories.includes(applied.category))
      reasons.push(`nhóm ${applied.category.replace('-', ' ')}`);
    if (applied.priceLevel !== undefined && applied.priceLevel !== null)
      reasons.push(`mức giá ${applied.priceLevel}`);
    if (applied.openNow) reasons.push('đang mở cửa');
    if (applied.tastes?.length) reasons.push(`khẩu vị ${applied.tastes.join(', ')}`);
    if (applied.district) reasons.push(`khu vực ${applied.district}`);
    if (applied.location) reasons.push('vị trí của bạn');
    return reasons.length ? `Phù hợp với ${reasons.join(', ')}.` : null;
  }
}

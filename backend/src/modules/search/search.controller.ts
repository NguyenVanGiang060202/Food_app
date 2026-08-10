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
import type { AiIntent } from '../ai/ai.types';
import type { RestaurantFilters } from '../restaurants/restaurants.types';

interface InterpretedFilters {
  category?: string;
  district?: string;
  attributes: string[];
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
  ['ý', 'italian'],
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

function interpretQuery(query: string): InterpretedFilters {
  const normalized = query.toLocaleLowerCase('vi-VN');
  const category = CATEGORY_ALIASES.find(([alias]) => normalized.includes(alias))?.[1];
  const districtMatch = normalized.match(/\b(?:district|quận)\s*(\d{1,2})\b/i);
  const district = districtMatch ? `District ${districtMatch[1]}` : undefined;
  const attributes = [
    ...(normalized.includes('quiet') || normalized.includes('yên tĩnh') ? ['quiet'] : []),
    ...(normalized.includes('date') || normalized.includes('hẹn hò') ? ['date-friendly'] : []),
    ...(normalized.includes('working') ||
    normalized.includes('work') ||
    normalized.includes('làm việc')
      ? ['work-friendly']
      : []),
  ];

  return { ...(category ? { category } : {}), ...(district ? { district } : {}), attributes };
}

function firstFilterableCategory(
  intent: AiIntent | null,
  interpreted: InterpretedFilters,
): string | undefined {
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
  ) {}
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
    const tastes = [
      ...(body.filters?.taste ?? []),
      ...(intent?.tastes ?? []),
      ...(intent?.dishes ?? []),
    ];
    const filters = {
      query: body.query,
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
    };
    // Track the exact filters that produced the returned page so a follow-up
    // (cursor) request can replay the same query without re-running the LLM.
    let effective: RestaurantFilters = filters;
    let page = await this.restaurantsService.list(effective);
    if (!page.data.length && filters.query && (filters.category || filters.dishTypes?.length)) {
      // The category/dish-type taxonomy can be incomplete for a restaurant
      // that clearly serves something (e.g. mì without the `noodle` link).
      // Retry keeping the query text and the explicit taste filters, which
      // now resolve through dish attributes (food_attribute / dish_attribute).
      effective = { ...filters, category: undefined, dishTypes: undefined };
      page = await this.restaurantsService.list(effective);
    }
    if (!page.data.length && filters.query) {
      effective = { ...filters, query: undefined };
      page = await this.restaurantsService.list(effective);
    }
    if (!page.data.length) {
      // A natural-language prompt is a discovery entry point, but the user's
      // explicit taste/category/distance filters are intent, not decoration.
      // Drop only the free-text query and rank the remaining candidates by
      // rating. Never silently drop the filters and return unrelated
      // top-rated restaurants (e.g. Cơm tấm for a "món ngọt nóng" filter).
      effective = { ...filters, query: undefined, sort: RestaurantSort.Rating };
      page = await this.restaurantsService.list(effective);
    }
    const snapshot: Omit<RestaurantFilters, 'limit'> = { ...effective };
    delete (snapshot as { limit?: number }).limit;
    const nextOffset = page.meta.nextCursor ? decodeOffsetCursor(page.meta.nextCursor) : null;
    return {
      data: page.data.slice(0, body.limit).map((restaurant) => ({
        restaurant,
        explanation: this.explain(
          restaurant.categories.map((c) => c.slug),
          {
            category,
            district,
            priceLevel,
            openNow,
            tastes,
            location: body.location ? true : undefined,
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
    const page = await this.restaurantsService.list({
      ...decoded.filters,
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

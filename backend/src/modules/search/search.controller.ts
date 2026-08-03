import { BadRequestException, Body, Controller, Get, Optional, Post, Query, Req, UseGuards } from '@nestjs/common';
import { InterpretSearchDto, ListRestaurantsQueryDto, RecommendationDto, RestaurantSort } from '../restaurants/restaurants.dto';
import { RestaurantsService } from '../restaurants/restaurants.service';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';

interface InterpretedFilters {
    category?: string;
    district?: string;
    attributes: string[];
}

interface AuthenticatedRequest { user?: AuthUser; }

const DISH_TYPE_ALIASES: ReadonlyArray<readonly [string, string]> = [
    ['bún', 'bun'], ['mì / phở', 'noodle'], ['mì', 'noodle'], ['phở', 'noodle'],
    ['cơm', 'rice'], ['ăn vặt', 'snack'], ['đồ uống', 'beverage'],
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
const FILTERABLE_CATEGORY_SLUGS = new Set(['coffee-shop', 'vegetarian', 'vietnamese', 'noodle', 'dessert', 'bun', 'rice', 'snack', 'beverage']);

function interpretQuery(query: string): InterpretedFilters {
    const normalized = query.toLocaleLowerCase('vi-VN');
    const category = CATEGORY_ALIASES.find(([alias]) => normalized.includes(alias))?.[1];
    const districtMatch = normalized.match(/\b(?:district|quận)\s*(\d{1,2})\b/i);
    const district = districtMatch ? `District ${districtMatch[1]}` : undefined;
    const attributes = [
        ...(normalized.includes('quiet') || normalized.includes('yên tĩnh') ? ['quiet'] : []),
        ...(normalized.includes('date') || normalized.includes('hẹn hò') ? ['date-friendly'] : []),
        ...(normalized.includes('working') || normalized.includes('work') || normalized.includes('làm việc') ? ['work-friendly'] : []),
    ];

    return { ...(category ? { category } : {}), ...(district ? { district } : {}), attributes };
}

@Controller('search')
export class SearchController {
    constructor(private readonly restaurantsService: RestaurantsService) { }
    @Get()
    async search(@Query() query: ListRestaurantsQueryDto) {
        if (!query.query?.trim()) throw new BadRequestException('query is required.');
        const locationError = query.validateLocationPair();
        if (locationError) throw new BadRequestException(locationError);
        const interpreted = interpretQuery(query.query);
        const normalizedQuery = query.query.toLocaleLowerCase('vi-VN');
        const categoryAlias = interpreted.category && CATEGORY_ALIASES.some(([alias]) => normalizedQuery.includes(alias));
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
    interpret(@Body() body: InterpretSearchDto) {
        return { data: { query: body.query, filters: interpretQuery(body.query) } };
    }
}

@Controller('recommendations')
export class RecommendationsController {
    constructor(private readonly restaurantsService: RestaurantsService, @Optional() private readonly auth?: AuthService) { }
    @Post()
    async recommend(@Body() body: RecommendationDto) {
        const interpreted = interpretQuery(body.query);
        const filters = {
            query: body.query,
            category: interpreted.category && FILTERABLE_CATEGORY_SLUGS.has(interpreted.category) ? interpreted.category : undefined,
            latitude: body.location?.latitude,
            longitude: body.location?.longitude,
            radiusMeters: body.filters?.radiusMeters,
            minRating: body.filters?.minRating,
            priceLevel: body.filters?.priceLevel,
            openNow: body.filters?.openNow,
            sort: body.filters?.sort,
            district: body.filters?.area ?? interpreted.district,
            dishTypes: body.filters?.dishTypes?.map(value => DISH_TYPE_ALIASES.find(([label]) => label === value.toLocaleLowerCase('vi-VN'))?.[1] ?? value),
            tastes: body.filters?.taste,
            limit: body.limit,
        };
        let page = await this.restaurantsService.list(filters);
        if (!page.data.length && filters.query && (filters.category || filters.dishTypes?.length || filters.tastes?.length)) {
            // Query text is more reliable than taxonomy for Vietnamese dish names.
            // A restaurant may serve mì without having the `noodle` category linked.
            page = await this.restaurantsService.list({
                query: filters.query,
                latitude: filters.latitude,
                longitude: filters.longitude,
                radiusMeters: filters.radiusMeters,
                limit: filters.limit,
            });
        }
        if (!page.data.length && filters.query) {
            page = await this.restaurantsService.list({ ...filters, query: undefined });
        }
        if (!page.data.length) {
            // A natural-language prompt is a discovery entry point, not a
            // strict SQL query. Do not leave the user with an empty page when
            // a taste/category phrase has no exact data match. Preserve an
            // explicit location radius when available, then rank candidates.
            page = await this.restaurantsService.list({
                latitude: filters.latitude,
                longitude: filters.longitude,
                radiusMeters: filters.radiusMeters,
                sort: RestaurantSort.Rating,
                limit: filters.limit,
            });
        }
        return { data: page.data.slice(0, body.limit).map(restaurant => ({ restaurant, explanation: this.explain(restaurant.categories.map(c => c.slug), interpreted, body) })) };
    }

    @Get('for-you')
    @UseGuards(AuthGuard)
    async forYou(@Req() request: AuthenticatedRequest) {
        if (!this.auth) throw new BadRequestException('Personalized recommendations are unavailable.');
        const preferences = await this.auth.getPreferences(request.user!.id);
        const categories = [...new Set(preferences.favoriteCategorySlugs)].slice(0, 4);
        const priceLevels = [...new Set(preferences.preferredPriceLevels)].slice(0, 4);
        const tastes = [...new Set(preferences.dietaryPreferences)].slice(0, 6);
        const combinations = categories.length && priceLevels.length
            ? categories.flatMap(category => priceLevels.map(priceLevel => ({ category, priceLevel })))
            : categories.length
                ? categories.map(category => ({ category }))
                : priceLevels.map(priceLevel => ({ priceLevel }));
        const queries = combinations.length ? combinations : [{ }];
        const pages = await Promise.all(queries.map(filters => this.restaurantsService.list({ ...filters, tastes, sort: RestaurantSort.Rating, limit: 8 })));
        const candidates = new Map(pages.flatMap(page => page.data).map(restaurant => [restaurant.id, restaurant]));
        let restaurants = [...candidates.values()].sort((left, right) => (right.rating ?? 0) - (left.rating ?? 0) || (right.reviewCount ?? 0) - (left.reviewCount ?? 0)).slice(0, 8);
        if (!restaurants.length && (categories.length || priceLevels.length || tastes.length)) {
            const fallback = await this.restaurantsService.list({ sort: RestaurantSort.Rating, limit: 8 });
            restaurants = fallback.data;
        }
        return { data: restaurants.map(restaurant => ({ restaurant, explanation: this.forYouExplanation(restaurant.categories.map(c => c.name), categories, tastes, priceLevels) })) };
    }

    private forYouExplanation(categories: string[], favoriteCategories: string[], tastes: string[] = [], priceLevels: number[] = []): string {
        const reasons: string[] = [];
        if (favoriteCategories.length && favoriteCategories.some(category => categories.some(value => value.toLocaleLowerCase('vi-VN').includes(category.replace('-', ' '))))) reasons.push('nhóm món bạn thích');
        if (tastes.length) reasons.push('khẩu vị đã lưu');
        if (priceLevels.length) reasons.push(`mức giá ${priceLevels.join(', ')}`);
        return reasons.length ? `Gợi ý dựa trên ${reasons.join(', ')}.` : 'Được chọn từ những quán được đánh giá cao.';
    }

    private explain(categories: string[], interpreted: InterpretedFilters, body: RecommendationDto): string | null {
        const reasons: string[] = [];
        if (interpreted.category && categories.includes(interpreted.category)) reasons.push(`nhóm ${interpreted.category.replace('-', ' ')}`);
        if (body.filters?.priceLevel !== undefined && body.filters.priceLevel !== null) reasons.push(`mức giá ${body.filters.priceLevel}`);
        if (body.filters?.openNow) reasons.push('đang mở cửa');
        if (body.filters?.taste?.length) reasons.push(`khẩu vị ${body.filters.taste.join(', ')}`);
        if (body.filters?.dishTypes?.length) reasons.push(`món ${body.filters.dishTypes.join(', ')}`);
        if (body.filters?.area) reasons.push(`khu vực ${body.filters.area}`);
        if (body.location) reasons.push('vị trí của bạn');
        return reasons.length ? `Phù hợp với ${reasons.join(', ')}.` : null;
    }
}

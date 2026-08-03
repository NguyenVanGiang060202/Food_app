import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { DatabaseUnavailableException } from '../../common/database-unavailable.exception';

interface DishRow { id: string; name: string; description: string | null; price_amount: number | string | null; currency_code: string | null; is_popular: boolean; restaurant_name: string; restaurant_id: string; cover_image_url: string | null; category_name: string | null; }

@Controller('dishes')
export class DishesController {
    constructor(private readonly database: DatabaseService) { }

    @Get()
    async list(@Query('limit') rawLimit?: string, @Query('query') query?: string, @Query('category') category?: string, @Query('priceLevel') rawPriceLevel?: string, @Query('openNow') rawOpenNow?: string) {
        const limit = Math.min(Math.max(Number(rawLimit) || 20, 1), 50);
        const normalizedQuery = query?.trim();
        const normalizedCategory = category?.trim();
        const priceLevel = rawPriceLevel ? Number(rawPriceLevel) : undefined;
        const openNow = rawOpenNow === 'true';
        try {
            const values: unknown[] = [limit];
            const clauses: string[] = [];
            if (normalizedQuery) values.push(`%${normalizedQuery}%`);
            if (normalizedQuery) clauses.push(`(d.name ILIKE $${values.length} OR d.normalized_name ILIKE $${values.length} OR unaccent(d.name) ILIKE unaccent($${values.length}) OR unaccent(d.normalized_name) ILIKE unaccent($${values.length}) OR COALESCE(d.description, '') ILIKE $${values.length} OR r.name ILIKE $${values.length})`);
            if (normalizedCategory) { values.push(normalizedCategory); clauses.push(`EXISTS (SELECT 1 FROM restaurant_category rc_filter JOIN category c_filter ON c_filter.id = rc_filter.category_id WHERE rc_filter.restaurant_id = r.id AND c_filter.slug = $${values.length} AND c_filter.is_active = true)`); }
            if (priceLevel !== undefined && Number.isInteger(priceLevel) && priceLevel >= 1 && priceLevel <= 4) { values.push(priceLevel); clauses.push(`r.price_level = $${values.length}`); }
            if (openNow) clauses.push(`EXISTS (SELECT 1 FROM restaurant_hour oh WHERE oh.restaurant_id = r.id AND oh.day_of_week = EXTRACT(ISODOW FROM CURRENT_DATE)::smallint AND oh.is_closed = false AND ((oh.spans_next_day = false AND CURRENT_TIME BETWEEN oh.opens_at AND oh.closes_at) OR (oh.spans_next_day = true AND (CURRENT_TIME >= oh.opens_at OR CURRENT_TIME <= oh.closes_at))))`);
            const result = await this.database.query<DishRow>(`SELECT d.id, d.name, d.description, d.price_amount, d.currency_code, d.is_popular, r.id AS restaurant_id, r.name AS restaurant_name, cover.url AS cover_image_url, category.name AS category_name
                FROM dish d JOIN restaurant r ON r.id = d.restaurant_id AND r.status = 'active'
                LEFT JOIN LATERAL (SELECT ri.url FROM restaurant_image ri WHERE ri.restaurant_id = r.id AND ri.is_cover = true AND ri.status = 'active' ORDER BY ri.sort_order, ri.id LIMIT 1) cover ON true
                LEFT JOIN LATERAL (SELECT c.name FROM restaurant_category rc JOIN category c ON c.id = rc.category_id AND c.is_active = true WHERE rc.restaurant_id = r.id ORDER BY c.name LIMIT 1) category ON true
                WHERE d.status = 'available' ${clauses.length ? `AND ${clauses.join(' AND ')}` : ''} ORDER BY d.is_popular DESC, r.rating DESC NULLS LAST, d.name LIMIT $1`, values);
            return { data: result.rows.map((row) => ({ id: row.id, name: row.name, description: row.description, priceAmount: row.price_amount === null ? null : Number(row.price_amount), currencyCode: row.currency_code, isPopular: row.is_popular, restaurantId: row.restaurant_id, restaurantName: row.restaurant_name, imageUrl: row.cover_image_url, category: row.category_name })) };
        } catch { throw new DatabaseUnavailableException(); }
    }

    @Get(':dishId')
    async getById(@Param('dishId', new ParseUUIDPipe()) dishId: string) {
        try {
            const result = await this.database.query<DishRow>(`SELECT d.id, d.name, d.description, d.price_amount, d.currency_code, d.is_popular, r.id AS restaurant_id, r.name AS restaurant_name, cover.url AS cover_image_url, category.name AS category_name
                FROM dish d JOIN restaurant r ON r.id = d.restaurant_id AND r.status = 'active'
                LEFT JOIN LATERAL (SELECT ri.url FROM restaurant_image ri WHERE ri.restaurant_id = r.id AND ri.is_cover = true AND ri.status = 'active' ORDER BY ri.sort_order, ri.id LIMIT 1) cover ON true
                LEFT JOIN LATERAL (SELECT c.name FROM restaurant_category rc JOIN category c ON c.id = rc.category_id AND c.is_active = true WHERE rc.restaurant_id = r.id ORDER BY c.name LIMIT 1) category ON true
                WHERE d.id = $1 AND d.status = 'available'`, [dishId]);
            const row = result.rows[0];
            if (!row) return { data: null };
            return { data: { id: row.id, name: row.name, description: row.description, priceAmount: row.price_amount === null ? null : Number(row.price_amount), currencyCode: row.currency_code, isPopular: row.is_popular, restaurantId: row.restaurant_id, restaurantName: row.restaurant_name, imageUrl: row.cover_image_url, category: row.category_name } };
        } catch { throw new DatabaseUnavailableException(); }
    }
}
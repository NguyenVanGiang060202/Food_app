import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { RestaurantSummary } from '../restaurants/restaurants.types';

export interface SavedListOptions { limit?: number; cursor?: string; }

interface SavedCursor { createdAt: string; restaurantId: string; }
interface SavedRow { id: string; name: string; formatted_address: string; latitude: number | string | null; longitude: number | string | null; rating: number | string | null; review_count: number | null; price_level: number | null; cover_image_url: string | null; source_url: string | null; categories: Array<{ slug: string; name: string }> | null; created_at: string; }

const decodeCursor = (cursor?: string): SavedCursor | undefined => { if (!cursor) return undefined; try { const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as SavedCursor; return parsed.createdAt && parsed.restaurantId ? parsed : undefined; } catch { return undefined; } };
const encodeCursor = (row: SavedRow): string => Buffer.from(JSON.stringify({ createdAt: row.created_at, restaurantId: row.id })).toString('base64url');

@Injectable()
export class SavedRepository {
    constructor(private readonly database: DatabaseService) {}
    async list(userId: string, query: SavedListOptions = { limit: 12 }): Promise<{ data: RestaurantSummary[]; meta: { nextCursor: string | null; limit: number; totalCount: number; totalPages: number } }> {
        const requestedLimit = Number(query.limit ?? 12);
        const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 50) : 12;
        const cursor = decodeCursor(query.cursor);
        const values: unknown[] = [userId];
        const cursorClause = cursor ? ` AND (sr.created_at, sr.restaurant_id) < ($2::timestamptz, $3::uuid)` : '';
        if (cursor) values.push(cursor.createdAt, cursor.restaurantId);
        values.push(limit);
        const countResult = await this.database.query<{ count: string }>('SELECT COUNT(*)::bigint AS count FROM saved_restaurant sr JOIN restaurant r ON r.id = sr.restaurant_id JOIN location l ON l.id = r.location_id WHERE sr.user_id = $1 AND r.status = \'active\'', [userId]);
        const result = await this.database.query<SavedRow>(`SELECT r.id, r.name, l.formatted_address, ST_Y(l.coordinates::geometry) AS latitude, ST_X(l.coordinates::geometry) AS longitude, r.rating, r.review_count, r.price_level, cover.url AS cover_image_url, source.source_url, NULL::double precision AS distance_meters, sr.created_at, COALESCE(json_agg(DISTINCT jsonb_build_object('slug', c.slug, 'name', c.name)) FILTER (WHERE c.id IS NOT NULL), '[]') AS categories FROM saved_restaurant sr JOIN restaurant r ON r.id = sr.restaurant_id JOIN location l ON l.id = r.location_id LEFT JOIN restaurant_category rc ON rc.restaurant_id = r.id LEFT JOIN category c ON c.id = rc.category_id AND c.is_active = true LEFT JOIN LATERAL (SELECT ri.url FROM restaurant_image ri WHERE ri.restaurant_id = r.id AND ri.is_cover = true AND ri.status = 'active' ORDER BY ri.sort_order, ri.id LIMIT 1) cover ON true LEFT JOIN LATERAL (SELECT rs.source_url FROM restaurant_source rs JOIN data_source ds ON ds.id = rs.data_source_id WHERE rs.restaurant_id = r.id AND rs.status = 'active' AND ds.code = 'google_maps_playwright' AND rs.source_url IS NOT NULL ORDER BY rs.last_seen_at DESC, rs.id LIMIT 1) source ON true WHERE sr.user_id = $1 AND r.status = 'active'${cursorClause} GROUP BY sr.created_at, sr.restaurant_id, r.id, l.id, cover.url, source.source_url ORDER BY sr.created_at DESC, sr.restaurant_id DESC LIMIT $${values.length}`, values);
        const rows = result.rows.slice(0, limit);
        let hasNext = false;
        if (rows.length === limit && rows.length > 0) {
            const last = rows[rows.length - 1];
            const nextResult = await this.database.query<{ exists: boolean }>(
                'SELECT EXISTS (SELECT 1 FROM saved_restaurant sr JOIN restaurant r ON r.id = sr.restaurant_id JOIN location l ON l.id = r.location_id WHERE sr.user_id = $1 AND r.status = \'active\' AND (sr.created_at, sr.restaurant_id) < ($2::timestamptz, $3::uuid)) AS exists',
                [userId, last.created_at, last.id],
            );
            hasNext = Boolean(nextResult.rows[0]?.exists);
        }
        const totalCount = Number(countResult.rows[0]?.count ?? 0);
        return { data: rows.map(row => ({ id: row.id, name: row.name, location: { formattedAddress: row.formatted_address, latitude: row.latitude === null ? null : Number(row.latitude), longitude: row.longitude === null ? null : Number(row.longitude) }, rating: row.rating === null ? null : Number(row.rating), reviewCount: row.review_count === null ? null : Number(row.review_count), priceLevel: row.price_level, coverImageUrl: row.cover_image_url, sourceUrl: row.source_url, categories: row.categories ?? [] })), meta: { nextCursor: hasNext && rows.length ? encodeCursor(rows[rows.length - 1]) : null, limit, totalCount, totalPages: Math.ceil(totalCount / limit) } };
    }
    async save(userId: string, restaurantId: string) {
        const restaurant = await this.database.query('SELECT 1 FROM restaurant WHERE id = $1 AND status = \'active\'', [restaurantId]);
        if (!restaurant.rowCount) throw new NotFoundException('Restaurant was not found.');
        await this.database.query('INSERT INTO saved_restaurant (user_id, restaurant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, restaurantId]);
    }
    async remove(userId: string, restaurantId: string) { await this.database.query('DELETE FROM saved_restaurant WHERE user_id = $1 AND restaurant_id = $2', [userId, restaurantId]); }
    async has(userId: string, restaurantId: string) { const result = await this.database.query('SELECT 1 FROM saved_restaurant WHERE user_id = $1 AND restaurant_id = $2', [userId, restaurantId]); return Boolean(result.rowCount); }
}
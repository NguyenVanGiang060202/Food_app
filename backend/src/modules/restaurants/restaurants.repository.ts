import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type {
  OpeningHour,
  RestaurantCategory,
  RestaurantDetail,
  RestaurantFilters,
  RestaurantImage,
  RestaurantPage,
  RestaurantReview,
  RestaurantSummary,
} from './restaurants.types';
import { RestaurantSort } from './restaurants.dto';

interface Cursor {
  updatedAt?: string;
  id?: string;
  offset?: number;
}
interface SummaryRow {
  id: string;
  name: string;
  formatted_address: string;
  latitude: number | string | null;
  longitude: number | string | null;
  rating: number | string | null;
  review_count: number | null;
  price_level: number | null;
  cover_image_url: string | null;
  source_url: string | null;
  categories: RestaurantCategory[] | null;
  distance_meters: number | string | null;
  updated_at: string;
}
interface ReviewRow {
  id: string;
  rating: number | string | null;
  content: string | null;
  reviewed_at: Date | string | null;
  language_code: string | null;
}

const numberOrNull = (value: number | string | null): number | null =>
  value === null ? null : Number(value);
const decodeCursor = (cursor?: string): Cursor | undefined => {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Cursor;
    if (typeof parsed.offset === 'number') return parsed;
    if (parsed.updatedAt && parsed.id) return parsed;
    return undefined;
  } catch {
    return undefined;
  }
};
const encodeCursor = (row: SummaryRow): string =>
  Buffer.from(JSON.stringify({ updatedAt: row.updated_at, id: row.id })).toString('base64url');
const encodeOffsetCursor = (offset: number): string =>
  Buffer.from(JSON.stringify({ offset })).toString('base64url');

@Injectable()
export class RestaurantsRepository {
  constructor(private readonly database: DatabaseService) {}

  async list(filters: RestaurantFilters): Promise<RestaurantPage> {
    const values: unknown[] = [];
    const where: string[] = ["r.status = 'active'"];
    const add = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    let distanceSelect = 'NULL::double precision AS distance_meters';
    let distanceOrder = '';
    let relevanceExpr = '0::real';
    let semanticExpr = 'NULL::real';
    let relevanceSelect = `${relevanceExpr} AS relevance_score`;
    let semanticSelect = `${semanticExpr} AS semantic_score`;
    if (filters.embedding) {
      const vectorLiteral = `[${filters.embedding.vector.map((value) => value.toFixed(8)).join(',')}]`;
      const vector = add(vectorLiteral);
      const model = add(filters.embedding.model);
      // Scalar subquery keeps the GROUP BY unchanged and tolerates multiple
      // hashes per (restaurant, model). The table is small (a few thousand
      // rows), so the per-row cosine is cheap; the HNSW index still helps a
      // future direct vector-search pre-filter.
      semanticExpr = `(SELECT COALESCE(1 - (emb.embedding <=> ${vector}::vector), 0)
         FROM restaurant_embedding emb
        WHERE emb.restaurant_id = r.id AND emb.model = ${model}
        ORDER BY emb.created_at DESC, emb.id DESC LIMIT 1)`;
      semanticSelect = `${semanticExpr} AS semantic_score`;
    }
    if (filters.query) {
      const query = filters.query.trim();
      const normalizedQuery = query
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      const p = add(`%${query}%`);
      const normalized = add(`%${normalizedQuery}%`);
      const exact = add(filters.query);
      const stopWords = new Set([
        'an',
        'cho',
        'co',
        'di',
        'gi',
        'gan',
        'minh',
        'muon',
        'nay',
        'nhe',
        'nhung',
        'quan',
        'tim',
        'va',
        'voi',
        'o',
        'mon',
        'theo',
        'dang',
        'bua',
        'buoi',
      ]);
      const terms = [
        ...new Set(
          normalizedQuery
            .split(/[^a-z0-9]+/)
            .filter((term) => term.length >= 2 && !stopWords.has(term)),
        ),
      ].slice(0, 6);
      const termClauses = terms.map((term) => {
        const termParam = add(`%${term}%`);
        return `(r.normalized_name ILIKE ${termParam} OR EXISTS (SELECT 1 FROM dish term_ds WHERE term_ds.restaurant_id = r.id AND term_ds.status = 'available' AND term_ds.normalized_name ILIKE ${termParam}) OR COALESCE(r.semantic_profile, '') ILIKE ${termParam})`;
      });
      relevanceExpr = `GREATEST(similarity(r.name, ${exact}), similarity(r.normalized_name, ${exact}))`;
      relevanceSelect = `${relevanceExpr} AS relevance_score`;
      // Search through the stored normalized columns instead of calling
      // PostgreSQL's optional `unaccent` extension at request time. The
      // extension is useful for migrations, but a missing extension must
      // not turn every natural-language recommendation into a 500.
      where.push(
        `(r.name ILIKE ${p} OR r.normalized_name ILIKE ${p} OR r.normalized_name ILIKE ${normalized} OR EXISTS (SELECT 1 FROM dish ds WHERE ds.restaurant_id = r.id AND ds.status = 'available' AND (ds.name ILIKE ${p} OR ds.normalized_name ILIKE ${p} OR ds.normalized_name ILIKE ${normalized})) OR COALESCE(r.semantic_profile, '') ILIKE ${p} OR COALESCE(r.semantic_profile, '') ILIKE ${normalized}${termClauses.length ? ` OR ${termClauses.join(' OR ')}` : ''})`,
      );
    }
    if (filters.category) {
      const p = add(filters.category);
      where.push(
        `EXISTS (SELECT 1 FROM restaurant_category f_rc JOIN category f_c ON f_c.id = f_rc.category_id WHERE f_rc.restaurant_id = r.id AND f_c.slug = ${p} AND f_c.is_active = true)`,
      );
    }
    for (const dishType of filters.dishTypes ?? []) {
      const p = add(dishType);
      where.push(
        `EXISTS (SELECT 1 FROM restaurant_category dt_rc JOIN category dt_c ON dt_c.id = dt_rc.category_id WHERE dt_rc.restaurant_id = r.id AND dt_c.slug = ${p} AND dt_c.is_active = true)`,
      );
    }
    for (const taste of filters.tastes ?? []) {
      const normalizedTaste = taste
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      const p = add(`%${taste}%`);
      const normalized = add(`%${normalizedTaste}%`);
      const attributeNormalized = add(normalizedTaste);
      // Prefer the food-attribute taxonomy (dish_attribute links produced by
      // enrichment). Only fall back to a literal dish-name match for values
      // that are not canonical attributes (e.g. "bún bò huế" from intent).
      where.push(
        `(EXISTS (SELECT 1 FROM dish_attribute taste_da JOIN food_attribute taste_fa ON taste_fa.id = taste_da.attribute_id JOIN dish taste_ds ON taste_ds.id = taste_da.dish_id WHERE taste_ds.restaurant_id = r.id AND taste_ds.status = 'available' AND taste_fa.normalized = ${attributeNormalized} AND taste_fa.is_active = true) OR EXISTS (SELECT 1 FROM dish taste_ds2 WHERE taste_ds2.restaurant_id = r.id AND taste_ds2.status = 'available' AND (taste_ds2.name ILIKE ${p} OR taste_ds2.normalized_name ILIKE ${p} OR taste_ds2.normalized_name ILIKE ${normalized} OR COALESCE(taste_ds2.description, '') ILIKE ${p})))`,
      );
    }
    if (filters.city) {
      const p = add(`%${filters.city}%`);
      where.push(`l.city ILIKE ${p}`);
    }
    if (filters.district) {
      const p = add(`%${filters.district}%`);
      where.push(`l.district ILIKE ${p}`);
    }
    if (filters.minRating !== undefined) where.push(`r.rating >= ${add(filters.minRating)}`);
    if (filters.priceLevel !== undefined) where.push(`r.price_level = ${add(filters.priceLevel)}`);
    if (filters.latitude !== undefined && filters.longitude !== undefined) {
      const point = `ST_SetSRID(ST_MakePoint(${add(filters.longitude)}, ${add(filters.latitude)}), 4326)::geography`;
      distanceSelect = `ST_Distance(l.coordinates, ${point}) AS distance_meters`;
      if (filters.radiusMeters !== undefined)
        where.push(
          `l.coordinates IS NOT NULL AND ST_DWithin(l.coordinates, ${point}, ${add(filters.radiusMeters)})`,
        );
      distanceOrder = 'distance_meters ASC NULLS LAST, ';
    }
    if (filters.openNow)
      where.push(
        `EXISTS (SELECT 1 FROM restaurant_hour oh WHERE oh.restaurant_id = r.id AND oh.day_of_week = EXTRACT(ISODOW FROM CURRENT_DATE)::smallint AND oh.is_closed = false AND ((oh.spans_next_day = false AND CURRENT_TIME BETWEEN oh.opens_at AND oh.closes_at) OR (oh.spans_next_day = true AND (CURRENT_TIME >= oh.opens_at OR CURRENT_TIME <= oh.closes_at))))`,
      );
    const cursor = decodeCursor(filters.cursor);
    const offset = cursor?.offset ?? 0;
    if (cursor?.updatedAt && cursor?.id && filters.sort === RestaurantSort.Newest)
      where.push(
        `(r.updated_at, r.id) < (${add(cursor.updatedAt)}::timestamptz, ${add(cursor.id)}::uuid)`,
      );
    const order =
      filters.sort === RestaurantSort.Distance && filters.latitude !== undefined
        ? `${distanceOrder}r.updated_at DESC, r.id DESC`
        : filters.sort === RestaurantSort.Rating
          ? 'r.rating DESC NULLS LAST, r.review_count DESC NULLS LAST, r.id DESC'
          : filters.sort === RestaurantSort.Newest
            ? 'r.updated_at DESC, r.id DESC'
            : filters.embedding
              ? `${distanceOrder}(COALESCE(${relevanceExpr}, 0) + 0.7 * COALESCE(${semanticExpr}, 0)) DESC, r.rating DESC NULLS LAST, r.updated_at DESC, r.id DESC`
              : `${distanceOrder}relevance_score DESC, r.rating DESC NULLS LAST, r.updated_at DESC, r.id DESC`;
    const limit = Math.min(filters.limit, 50);
    const limitParam = add(limit + 1);
    const offsetParam = offset > 0 ? add(offset) : null;
    const result = await this.database.query<SummaryRow>(
      `SELECT r.id, r.name, l.formatted_address, ST_Y(l.coordinates::geometry) AS latitude, ST_X(l.coordinates::geometry) AS longitude, r.rating, r.review_count, r.price_level, cover.url AS cover_image_url, source.source_url, ${distanceSelect}, ${relevanceSelect}, ${semanticSelect}, r.updated_at,
            COALESCE(json_agg(DISTINCT jsonb_build_object('slug', c.slug, 'name', c.name)) FILTER (WHERE c.id IS NOT NULL), '[]') AS categories
          FROM restaurant r JOIN location l ON l.id = r.location_id LEFT JOIN restaurant_category rc ON rc.restaurant_id = r.id LEFT JOIN category c ON c.id = rc.category_id AND c.is_active = true
          LEFT JOIN LATERAL (SELECT ri.url FROM restaurant_image ri WHERE ri.restaurant_id = r.id AND ri.is_cover = true AND ri.status = 'active' ORDER BY ri.sort_order, ri.id LIMIT 1) cover ON true
          LEFT JOIN LATERAL (SELECT rs.source_url FROM restaurant_source rs JOIN data_source ds ON ds.id = rs.data_source_id WHERE rs.restaurant_id = r.id AND rs.status = 'active' AND ds.code = 'google_maps_playwright' AND rs.source_url IS NOT NULL ORDER BY rs.last_seen_at DESC, rs.id LIMIT 1) source ON true
          WHERE ${where.join(' AND ')} GROUP BY r.id, l.id, cover.url, source.source_url ORDER BY ${order} LIMIT ${limitParam}${offsetParam ? ` OFFSET ${offsetParam}` : ''}`,
      values,
    );
    const hasNext = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    return {
      data: rows.map((row) => this.toSummary(row)),
      meta: {
        nextCursor:
          hasNext && rows.length
            ? filters.sort === RestaurantSort.Newest
              ? encodeCursor(rows[rows.length - 1])
              : encodeOffsetCursor(offset + rows.length)
            : null,
        limit,
      },
    };
  }

  async listSimilar(id: string, limit = 12): Promise<RestaurantSummary[]> {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 20);
    const result = await this.database.query<SummaryRow>(
      `WITH target AS (
              SELECT r.id, r.name, r.normalized_name, r.price_level, l.city, l.district
              FROM restaurant r JOIN location l ON l.id = r.location_id
              WHERE r.id = $1 AND r.status = 'active'
            ), target_categories AS (
              SELECT rc.category_id
              FROM restaurant_category rc
              JOIN category c ON c.id = rc.category_id AND c.is_active = true
              WHERE rc.restaurant_id = $1
            ), target_dishes AS (
              SELECT DISTINCT d.normalized_name
              FROM dish d
              WHERE d.restaurant_id = $1
                AND d.status = 'available'
                AND d.normalized_name <> ''
            ), scored AS (
              SELECT r.id,
                (GREATEST(similarity(r.name, target.name), similarity(r.normalized_name, target.normalized_name))) AS name_similarity,
                (
                  SELECT COUNT(DISTINCT rc.category_id)::int
                  FROM restaurant_category rc
                  JOIN target_categories tc ON tc.category_id = rc.category_id
                  JOIN category c ON c.id = rc.category_id AND c.is_active = true
                  WHERE rc.restaurant_id = r.id
                ) AS category_overlap,
                (
                  SELECT COUNT(DISTINCT candidate_dish.id)::int
                  FROM dish candidate_dish
                  JOIN target_dishes target_dish
                    ON candidate_dish.normalized_name = target_dish.normalized_name
                    OR similarity(candidate_dish.normalized_name, target_dish.normalized_name) >= 0.62
                  WHERE candidate_dish.restaurant_id = r.id
                    AND candidate_dish.status = 'available'
                ) AS dish_overlap,
                (
                  SELECT COUNT(DISTINCT rc.category_id)::int
                  FROM restaurant_category rc
                  JOIN category c ON c.id = rc.category_id AND c.is_active = true
                  WHERE rc.restaurant_id = r.id
                ) AS candidate_category_count,
                (SELECT COUNT(*)::int FROM target_categories) AS target_category_count,
                CASE WHEN r.price_level IS NOT NULL AND r.price_level = target.price_level THEN 1 ELSE 0 END AS price_match,
                CASE WHEN target.district IS NOT NULL AND l.district = target.district THEN 1 ELSE 0 END AS district_match,
                CASE WHEN target.city IS NOT NULL AND l.city = target.city THEN 1 ELSE 0 END AS city_match
              FROM restaurant r
              JOIN location l ON l.id = r.location_id
              CROSS JOIN target
              WHERE r.status = 'active' AND r.id <> target.id
            )
            SELECT r.id, r.name, l.formatted_address, ST_Y(l.coordinates::geometry) AS latitude, ST_X(l.coordinates::geometry) AS longitude,
              r.rating, r.review_count, r.price_level, cover.url AS cover_image_url, source.source_url,
              NULL::double precision AS distance_meters, 0::real AS relevance_score, r.updated_at,
              COALESCE(json_agg(DISTINCT jsonb_build_object('slug', c.slug, 'name', c.name)) FILTER (WHERE c.id IS NOT NULL), '[]') AS categories
            FROM scored s JOIN restaurant r ON r.id = s.id JOIN location l ON l.id = r.location_id
            LEFT JOIN restaurant_category rc ON rc.restaurant_id = r.id
            LEFT JOIN category c ON c.id = rc.category_id AND c.is_active = true
            LEFT JOIN LATERAL (SELECT ri.url FROM restaurant_image ri WHERE ri.restaurant_id = r.id AND ri.is_cover = true AND ri.status = 'active' ORDER BY ri.sort_order, ri.id LIMIT 1) cover ON true
            LEFT JOIN LATERAL (SELECT rs.source_url FROM restaurant_source rs JOIN data_source ds ON ds.id = rs.data_source_id WHERE rs.restaurant_id = r.id AND rs.status = 'active' AND ds.code = 'google_maps_playwright' AND rs.source_url IS NOT NULL ORDER BY rs.last_seen_at DESC, rs.id LIMIT 1) source ON true
            GROUP BY r.id, l.id, cover.url, source.source_url, s.name_similarity, s.category_overlap, s.dish_overlap, s.candidate_category_count, s.target_category_count, s.price_match, s.district_match, s.city_match
            ORDER BY (CASE WHEN s.category_overlap > 0 OR s.dish_overlap > 0 THEN 1 ELSE 0 END) DESC,
              (s.category_overlap * 12
                + s.dish_overlap * 10
                + CASE WHEN s.target_category_count > 0 THEN (s.category_overlap::real / s.target_category_count) * 8 ELSE 0 END
                + CASE WHEN s.candidate_category_count > 0 THEN (s.category_overlap::real / s.candidate_category_count) * 4 ELSE 0 END
                + s.name_similarity * 30
                + s.price_match * 4 + s.district_match * 3 + s.city_match * 1) DESC,
              r.rating DESC NULLS LAST, r.review_count DESC NULLS LAST, r.updated_at DESC, r.id DESC
            LIMIT $2`,
      [id, boundedLimit],
    );
    return result.rows.map((row) => this.toSummary(row));
  }

  async findById(id: string): Promise<RestaurantDetail | undefined> {
    const base = await this.database.query<
      SummaryRow & { description: string | null; phone: string | null; website_url: string | null }
    >(
      `SELECT r.id, r.name, r.description, r.phone, r.website_url, l.formatted_address, ST_Y(l.coordinates::geometry) AS latitude, ST_X(l.coordinates::geometry) AS longitude, r.rating, r.review_count, r.price_level, cover.url AS cover_image_url, source.source_url, NULL::double precision AS distance_meters, 0::real AS relevance_score, r.updated_at,
          COALESCE(json_agg(DISTINCT jsonb_build_object('slug', c.slug, 'name', c.name)) FILTER (WHERE c.id IS NOT NULL), '[]') AS categories
          FROM restaurant r JOIN location l ON l.id = r.location_id LEFT JOIN restaurant_category rc ON rc.restaurant_id = r.id LEFT JOIN category c ON c.id = rc.category_id AND c.is_active = true
          LEFT JOIN LATERAL (SELECT ri.url FROM restaurant_image ri WHERE ri.restaurant_id = r.id AND ri.is_cover = true AND ri.status = 'active' ORDER BY ri.sort_order, ri.id LIMIT 1) cover ON true
          LEFT JOIN LATERAL (SELECT rs.source_url FROM restaurant_source rs JOIN data_source ds ON ds.id = rs.data_source_id WHERE rs.restaurant_id = r.id AND rs.status = 'active' AND ds.code = 'google_maps_playwright' AND rs.source_url IS NOT NULL ORDER BY rs.last_seen_at DESC, rs.id LIMIT 1) source ON true
          WHERE r.id = $1 AND r.status = 'active' GROUP BY r.id, l.id, cover.url, source.source_url`,
      [id],
    );
    const row = base.rows[0];
    if (!row) return undefined;
    const [hours, dishes, images, reviews] = await Promise.all([
      this.database.query<
        OpeningHour & {
          day_of_week: number;
          opens_at: string | null;
          closes_at: string | null;
          is_closed: boolean;
          spans_next_day: boolean;
        }
      >(
        "SELECT day_of_week, to_char(opens_at, 'HH24:MI') AS opens_at, to_char(closes_at, 'HH24:MI') AS closes_at, is_closed, spans_next_day FROM restaurant_hour WHERE restaurant_id = $1 ORDER BY day_of_week, opens_at",
        [id],
      ),
      this.database.query<{
        id: string;
        name: string;
        description: string | null;
        price_amount: number | string | null;
        currency_code: string | null;
        is_popular: boolean;
      }>(
        "SELECT id, name, description, price_amount, currency_code, is_popular FROM dish WHERE restaurant_id = $1 AND status = 'available' ORDER BY is_popular DESC, name",
        [id],
      ),
      this.database.query<RestaurantImage>(
        'SELECT id, url, alt_text AS "altText", is_cover AS "isCover", sort_order AS "sortOrder" FROM restaurant_image WHERE restaurant_id = $1 AND status = \'active\' ORDER BY sort_order, id',
        [id],
      ),
      this.database.query<ReviewRow>(
        'SELECT id, rating, content, reviewed_at, language_code FROM review WHERE restaurant_id = $1 AND is_visible = true AND content IS NOT NULL AND length(trim(content)) > 0 ORDER BY reviewed_at DESC NULLS LAST, id DESC LIMIT 20',
        [id],
      ),
    ]);
    return {
      ...this.toSummary(row),
      description: row.description,
      phone: row.phone,
      websiteUrl: row.website_url,
      openingHours: hours.rows.map((h) => ({
        dayOfWeek: h.day_of_week,
        opensAt: h.opens_at,
        closesAt: h.closes_at,
        isClosed: h.is_closed,
        spansNextDay: h.spans_next_day,
      })),
      dishes: dishes.rows.map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description,
        priceAmount: numberOrNull(d.price_amount),
        currencyCode: d.currency_code,
        isPopular: d.is_popular,
      })),
      images: images.rows,
      reviews: reviews.rows.map<RestaurantReview>((review) => ({
        id: review.id,
        rating: numberOrNull(review.rating),
        content: review.content,
        reviewedAt:
          review.reviewed_at instanceof Date
            ? review.reviewed_at.toISOString()
            : review.reviewed_at,
        languageCode: review.language_code,
      })),
    };
  }

  private toSummary(row: SummaryRow): RestaurantSummary {
    return {
      id: row.id,
      name: row.name,
      location: {
        formattedAddress: row.formatted_address,
        latitude: numberOrNull(row.latitude),
        longitude: numberOrNull(row.longitude),
      },
      categories: row.categories ?? [],
      rating: numberOrNull(row.rating),
      reviewCount: numberOrNull(row.review_count),
      priceLevel: row.price_level,
      coverImageUrl: row.cover_image_url,
      sourceUrl: row.source_url,
      ...(row.distance_meters !== null
        ? { distanceMeters: numberOrNull(row.distance_meters) }
        : {}),
    };
  }
}

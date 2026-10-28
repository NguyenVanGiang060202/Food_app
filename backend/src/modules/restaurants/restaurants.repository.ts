import { Injectable, Logger } from '@nestjs/common';
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
  matched_dishes: string[] | null;
  dish_candidate: boolean | null;
  dish_evidence_status: 'verified_menu' | 'candidate_signal' | null;
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

// A source row can carry a plausible-looking district label while its
// coordinates point at another district. Keep the exact text filter, then
// apply this conservative geographic sanity check for known HCMC districts.
// It is a retrieval guard only; it does not rewrite source data.
const DISTRICT_LOCATION_GUARDS: Record<
  string,
  { latitude: number; longitude: number; radiusMeters: number }
> = {
  'quận 1': { latitude: 10.7757, longitude: 106.7004, radiusMeters: 4500 },
  'quận 2': { latitude: 10.787, longitude: 106.749, radiusMeters: 9000 },
  'quận 3': { latitude: 10.783, longitude: 106.684, radiusMeters: 5000 },
  'quận 4': { latitude: 10.761, longitude: 106.705, radiusMeters: 4500 },
  'quận 5': { latitude: 10.755, longitude: 106.667, radiusMeters: 5000 },
  'quận 6': { latitude: 10.746, longitude: 106.635, radiusMeters: 6500 },
  'quận 7': { latitude: 10.733, longitude: 106.722, radiusMeters: 9000 },
  'quận 8': { latitude: 10.725, longitude: 106.677, radiusMeters: 6500 },
  'quận 9': { latitude: 10.83, longitude: 106.79, radiusMeters: 10000 },
  'quận 10': { latitude: 10.773, longitude: 106.667, radiusMeters: 4500 },
  'quận 11': { latitude: 10.763, longitude: 106.648, radiusMeters: 4500 },
  'quận 12': { latitude: 10.862, longitude: 106.65, radiusMeters: 9000 },
  'bình tân': { latitude: 10.747, longitude: 106.605, radiusMeters: 9000 },
  'bình thạnh': { latitude: 10.812, longitude: 106.708, radiusMeters: 6500 },
  'gò vấp': { latitude: 10.838, longitude: 106.665, radiusMeters: 6500 },
  'phú nhuận': { latitude: 10.799, longitude: 106.68, radiusMeters: 4500 },
  'tân bình': { latitude: 10.802, longitude: 106.65, radiusMeters: 6500 },
  'tân phú': { latitude: 10.79, longitude: 106.63, radiusMeters: 6500 },
  'thủ đức': { latitude: 10.85, longitude: 106.78, radiusMeters: 18000 },
  'hóc môn': { latitude: 10.89, longitude: 106.595, radiusMeters: 15000 },
  'củ chi': { latitude: 11.02, longitude: 106.51, radiusMeters: 25000 },
  'bình chánh': { latitude: 10.7, longitude: 106.6, radiusMeters: 22000 },
  'nhà bè': { latitude: 10.68, longitude: 106.73, radiusMeters: 15000 },
  'cần giờ': { latitude: 10.41, longitude: 106.95, radiusMeters: 30000 },
};

@Injectable()
export class RestaurantsRepository {
  private readonly logger = new Logger(RestaurantsRepository.name);

  constructor(private readonly database: DatabaseService) {}

  async findExactVerifiedDishName(query: string): Promise<string | undefined> {
    const normalized = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const words = normalized.split(' ').filter(Boolean);
    if (words.length < 2 || words.length > 12 || normalized.length > 120) return undefined;
    const result = await this.database.query<{ name: string }>(
      `SELECT d.name
         FROM dish d
         JOIN restaurant r ON r.id = d.restaurant_id AND r.status = 'active'
         JOIN dish_evidence de ON de.dish_id = d.id AND de.evidence_type = 'menu_image'
         JOIN menu_image_extraction mie ON mie.restaurant_image_id = de.restaurant_image_id
        WHERE (d.normalized_name = $1
          OR (d.normalized_name IN ($1 || ' s', $1 || ' v')
            AND right(d.name, 3) IN ('(s)', '(v)')))
          AND d.status = 'available'
          AND d.source IN ('menu_image:curated', 'website:menu:v1')
          AND mie.status = 'completed'
          AND mie.model IN ('website:menu:v1', 'website:menu-image-curated:v1', 'google_maps:menu-curated:v1')
          AND COALESCE(mie.raw_ocr_text, '') NOT ILIKE 'food_photo:%'
          AND (mie.model <> 'website:menu-image-curated:v1'
            OR lower(unaccent(de.raw_name)) = d.normalized_name)
        ORDER BY (d.normalized_name = $1) DESC,
          (mie.model = 'website:menu-image-curated:v1') DESC, d.confidence DESC, d.name
        LIMIT 1`,
      [normalized],
    );
    return result.rows[0]?.name;
  }

  async findUniqueVerifiedParentheticalDishName(query: string, district?: string): Promise<string | undefined> {
    const normalized = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (normalized.split(' ').length < 3 || normalized.length > 120) return undefined;
    const result = await this.database.query<{ name: string }>(
      `SELECT DISTINCT ON (d.normalized_name) d.name
         FROM dish d
         JOIN restaurant r ON r.id=d.restaurant_id AND r.status='active'
         JOIN location l ON l.id=r.location_id
         JOIN dish_evidence de ON de.dish_id=d.id AND de.evidence_type='menu_image'
         JOIN menu_image_extraction mie ON mie.restaurant_image_id=de.restaurant_image_id
        WHERE ($2::text IS NULL OR lower(unaccent(l.district))=lower(unaccent($2)))
          AND d.normalized_name LIKE $1 || ' %'
          AND d.name ~ '\\([^()]{1,30}\\)$'
          AND d.status='available'
          AND d.source IN ('menu_image:curated','website:menu:v1')
          AND mie.status='completed'
          AND mie.model IN ('website:menu:v1','website:menu-image-curated:v1','google_maps:menu-curated:v1')
          AND COALESCE(mie.raw_ocr_text,'') NOT ILIKE 'food_photo:%'
          AND (mie.model <> 'website:menu-image-curated:v1'
            OR lower(unaccent(de.raw_name))=d.normalized_name)
          AND (mie.model <> 'website:menu:v1'
            OR btrim(regexp_replace(lower(unaccent(de.raw_name)),'[^a-z0-9]+',' ','g'))=d.normalized_name)
        ORDER BY d.normalized_name,d.confidence DESC,d.name
        LIMIT 2`,
      [normalized, district ?? null],
    );
    // Multiple verified suffix variants need a choice from the user; taking
    // the first one would silently switch between nước/khô or other options.
    return result.rows.length === 1 ? result.rows[0].name : undefined;
  }

  async findUniqueVerifiedOrderedDishNameInDistrict(query: string, district: string): Promise<string | undefined> {
    const normalized = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const words = normalized.split(' ').filter(Boolean);
    // This is only for a fairly specific dish phrase. A short food category
    // such as "cơm chiên cua" must not become a guessed exact menu item.
    if (words.length < 4 || words.length > 7 || normalized.length > 80) return undefined;
    const orderedWords = `(^| )${words.join('( [a-z0-9]+){0,2} ')}( |$)`;
    const result = await this.database.query<{ name: string }>(
      `SELECT DISTINCT ON (d.normalized_name) d.name
         FROM dish d
         JOIN restaurant r ON r.id=d.restaurant_id AND r.status='active'
         JOIN location l ON l.id=r.location_id
         JOIN dish_evidence de ON de.dish_id=d.id AND de.evidence_type='menu_image'
         JOIN menu_image_extraction mie ON mie.restaurant_image_id=de.restaurant_image_id
        WHERE lower(unaccent(l.district))=lower(unaccent($2))
          AND d.normalized_name ~ $1
          AND d.status='available'
          AND d.source IN ('menu_image:curated','website:menu:v1')
          AND mie.status='completed'
          AND mie.model IN ('website:menu:v1','website:menu-image-curated:v1','google_maps:menu-curated:v1')
          AND COALESCE(mie.raw_ocr_text,'') NOT ILIKE 'food_photo:%'
          AND (mie.model <> 'website:menu-image-curated:v1'
            OR lower(unaccent(de.raw_name))=d.normalized_name)
          AND (mie.model <> 'website:menu:v1'
            OR btrim(regexp_replace(lower(unaccent(de.raw_name)),'[^a-z0-9]+',' ','g'))=d.normalized_name)
        ORDER BY d.normalized_name,d.confidence DESC,d.name
        LIMIT 2`,
      [orderedWords, district],
    );
    return result.rows.length === 1 ? result.rows[0].name : undefined;
  }

  async findVerifiedSlashDishNameInDistrict(query: string, district: string): Promise<string | undefined> {
    const normalized = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (normalized.split(' ').length < 3 || normalized.length > 120) return undefined;
    const result = await this.database.query<{ name: string }>(
      `SELECT d.name
         FROM dish d
         JOIN restaurant r ON r.id = d.restaurant_id AND r.status = 'active'
         JOIN location l ON l.id = r.location_id
         JOIN dish_evidence de ON de.dish_id = d.id AND de.evidence_type = 'menu_image'
         JOIN menu_image_extraction mie ON mie.restaurant_image_id = de.restaurant_image_id
        WHERE lower(unaccent(l.district)) = lower(unaccent($2))
          AND d.normalized_name LIKE $1 || ' %'
          AND (lower(unaccent(d.name)) LIKE $1 || '/%'
            OR lower(unaccent(d.name)) LIKE $1 || ' /%')
          AND d.status = 'available'
          AND d.source IN ('menu_image:curated', 'website:menu:v1')
          AND mie.status = 'completed'
          AND mie.model IN ('website:menu:v1', 'website:menu-image-curated:v1', 'google_maps:menu-curated:v1')
          AND COALESCE(mie.raw_ocr_text, '') NOT ILIKE 'food_photo:%'
          AND (mie.model <> 'website:menu-image-curated:v1'
            OR lower(unaccent(de.raw_name)) = d.normalized_name)
          AND (mie.model <> 'website:menu:v1'
            OR btrim(regexp_replace(lower(unaccent(de.raw_name)), '[^a-z0-9]+', ' ', 'g')) = d.normalized_name)
        ORDER BY d.confidence DESC, d.name
        LIMIT 1`,
      [normalized, district],
    );
    return result.rows[0]?.name;
  }

  async list(filters: RestaurantFilters): Promise<RestaurantPage> {
    const values: unknown[] = [];
    const where: string[] = ["r.status = 'active'"];
    const add = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };
    let distanceSelect = 'NULL::double precision AS distance_meters';
    let distanceOrder = '';
    let nearbyCte = '';
    let nearbyJoin = '';
    let dryMatchCte = '';
    let dryMatchJoin = '';
    let brothyMatchCte = '';
    let brothyMatchJoin = '';
    let dishMatchCte = '';
    let dishMatchJoin = '';
    let weatherMatchCte = '';
    let weatherMatchJoin = '';
    let weatherMatchedDishesSelect = '';
    let relevanceExpr = '0::real';
    let evidenceExpr = '0::real';
    let dishMatchExpr = '0::real';
    let dishEvidenceExpr = '0::real';
    let dishCandidateSelect = 'false::boolean AS dish_candidate';
    let dishEvidenceStatusSelect = 'NULL::text AS dish_evidence_status';
    const exactDishExpressions: string[] = [];
    const candidateDishExpressions: string[] = [];
    let tasteMatchExpr = '0::real';
    // A ready food profile is useful for tie-breaking, but it must never create
    // dish candidates. Dish availability is still enforced by dish_evidence in
    // the hard WHERE clause below.
    // A missing profile must contribute zero. Otherwise the scalar subquery
    // returns NULL, making the whole relevance score NULL; PostgreSQL sorts
    // those rows first for DESC and hides exact-name matches below them.
    const profileQualityExpr = `COALESCE((SELECT CASE WHEN fp.status = 'ready' THEN LEAST(0.08::real, COALESCE(fp.evidence_coverage, 0)::real * 0.08) ELSE 0::real END
    FROM restaurant_food_profile fp WHERE fp.restaurant_id = r.id), 0::real)`;
    let semanticExpr = 'NULL::real';
    // The spatial candidate set is assembled below, but exact-dish CTEs are
    // built earlier. Keep the condition available up front so those CTEs can
    // still join the bounded nearby set before scanning menu/OCR evidence.
    const hasNearbyRadius =
      filters.latitude !== undefined &&
      filters.longitude !== undefined &&
      filters.radiusMeters !== undefined;
    // Recommendation V2 keeps relevance/semantic intent dominant, then adds
    // bounded quality and proximity signals. These weights are deliberately
    // small so popularity or distance cannot swamp a strong food match.
    const qualityWeight = Number(process.env.RECOMMENDATION_QUALITY_WEIGHT ?? 0.16);
    const semanticWeight = Number(process.env.RECOMMENDATION_SEMANTIC_WEIGHT ?? 1.2);
    const distanceWeight = Number(process.env.RECOMMENDATION_DISTANCE_WEIGHT ?? 0.12);
    const qualityExpr = `(${((qualityWeight * 2) / 3).toFixed(6)} * LEAST(COALESCE(r.rating, 0) / 5.0, 1.0)
      + ${(qualityWeight / 3).toFixed(6)} * LEAST(LN(1 + COALESCE(r.review_count, 0)) / LN(101), 1.0))`;
    let distanceScoreExpr = '0::real';
    const interactionExpr = filters.personalizationUserId
      ? `(SELECT LEAST(0.08::real, GREATEST(-0.08::real,
          SUM(CASE ri.interaction_type WHEN 'save' THEN 0.04 WHEN 'open' THEN 0.012 WHEN 'dismiss' THEN -0.03 ELSE 0 END)
          * EXP(-EXTRACT(EPOCH FROM (NOW() - MAX(ri.created_at))) / 2592000.0)))
         FROM recommendation_interaction ri
        WHERE ri.restaurant_id = r.id AND ri.user_id = ${add(filters.personalizationUserId)})`
      : '0::real';
    // This fingerprint was produced by a broken OCR/template path and was
    // copied into unrelated restaurants. It is quarantined in the database
    // migration too, but the runtime guard protects older deployments.
    const trustedMenuExtraction = (alias: string) =>
      `(${alias}.model IN ('website:menu:v1', 'website:menu-image-curated:v1', 'google_maps:menu-curated:v1')) AND COALESCE(${alias}.raw_ocr_text, '') NOT ILIKE 'food_photo:%' AND COALESCE(${alias}.raw_ocr_text, '') NOT ILIKE '%dish_name%' AND COALESCE(${alias}.raw_ocr_text, '') NOT ILIKE '%price_vnd%' AND (${alias}.model IN ('website:menu-image-curated:v1', 'google_maps:menu-curated:v1') OR (length(COALESCE(${alias}.raw_ocr_text, '')) <= 1800 AND regexp_count(COALESCE(${alias}.raw_ocr_text, ''), '\\s-\\s') <= 25)) AND NOT ((
        (CASE WHEN left(regexp_replace(lower(unaccent(COALESCE(${alias}.raw_ocr_text, ''))), '\\s+', ' ', 'g'), 700) LIKE '%bun bo hue - %' THEN 1 ELSE 0 END)
        + (CASE WHEN left(regexp_replace(lower(unaccent(COALESCE(${alias}.raw_ocr_text, ''))), '\\s+', ' ', 'g'), 700) LIKE '%com tam - %' THEN 1 ELSE 0 END)
        + (CASE WHEN left(regexp_replace(lower(unaccent(COALESCE(${alias}.raw_ocr_text, ''))), '\\s+', ' ', 'g'), 700) LIKE '%banh mi - %' THEN 1 ELSE 0 END)
      ) >= 2) AND regexp_count(
        lower(unaccent(COALESCE(${alias}.raw_ocr_text, ''))),
        '(bun bo hue|com tam|banh mi) - '
      ) <= 3`;
    // A restaurant name is not menu evidence. In particular, accepting the
    // name as an exception would let contaminated OCR make a bánh mì
    // restaurant appear to serve bún bò Huế. Exact-dish retrieval must be
    // grounded in a trusted completed menu extraction only.
    const dishEvidenceScope = (alias: string, normalizedDish: string, dishAlias?: string) => {
      const dishParam = add(`%${normalizedDish}%`);
      const normalizedOcr = `left(regexp_replace(lower(unaccent(COALESCE(${alias}.raw_ocr_text, ''))), '\\s+', ' ', 'g'), 700)`;
      const trustedDish = dishAlias
        ? `${dishAlias}.source IN ('menu_image:curated', 'website:menu:v1')`
        : 'TRUE';
      if (!dishAlias)
        return `${trustedMenuExtraction(alias)} AND ${normalizedOcr} LIKE ${dishParam}`;
      const canonicalParam = add(normalizedDish);
      return `${trustedMenuExtraction(alias)} AND ${trustedDish} AND (${normalizedOcr} LIKE ${dishParam} OR (${alias}.model = 'website:menu-image-curated:v1' AND EXISTS (
        SELECT 1 FROM dish_evidence verified_de
        WHERE verified_de.dish_id = ${dishAlias}.id
          AND verified_de.restaurant_image_id = ${alias}.restaurant_image_id
          AND lower(unaccent(verified_de.raw_name)) LIKE ${dishParam}
      )) OR EXISTS (
        SELECT 1 FROM canonical_dish evidence_cd
        LEFT JOIN canonical_dish_alias evidence_alias ON evidence_alias.canonical_dish_id = evidence_cd.id
        WHERE evidence_cd.id = ${dishAlias}.canonical_dish_id
          AND (evidence_cd.normalized_name = ${canonicalParam} OR evidence_alias.normalized_alias = ${canonicalParam})
      ))`;
    };
    // Generic taste retrieval must not surface confident-looking OCR noise
    // such as "BAPH KEN ..." merely because it contains "nuong".
    const recognizableDishName = (alias: string) =>
      `${alias}.normalized_name ~ '(^| )(ga|bo|heo|thit|suon|nem|banh|bun|pho|ramen|udon|com|ca|tom|de|lau|mi|cua|muc|oc|chao|xoi|goi|pizza|sushi)( |$)'`;
    let relevanceSelect = `${relevanceExpr} AS relevance_score`;
    let semanticSelect = `${semanticExpr} AS semantic_score`;
    if (filters.embedding) {
      const vectorLiteral = `[${filters.embedding.vector.map((value) => value.toFixed(8)).join(',')}]`;
      const vector = add(vectorLiteral);
      const model = `${add(filters.embedding.model)}::text`;
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
    // Exact dish retrieval has its own bounded CTE and evidence join below.
    // Do not also run the broad text path: it scans restaurant names,
    // semantic profiles and reviews, and can both widen candidates and make
    // PostgreSQL infer untyped placeholders on slow prepared statements.
    if (filters.query && !filters.dishQueries?.length) {
      const query = filters.query.trim();
      const normalizedQuery = query
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      // Strict food queries do not use the broad text terms below. Do not
      // allocate their SQL parameters in that branch: PostgreSQL rejects
      // dangling placeholders whose values never appear in the statement.
      const p = filters.strictFoodQuery ? null : `${add(`%${query}%`)}::text`;
      const normalized = filters.strictFoodQuery ? null : `${add(`%${normalizedQuery}%`)}::text`;
      const exact = `${add(filters.query)}::text`;
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
      const termClauses = filters.strictFoodQuery
        ? []
        : terms.map((term) => {
            const termParam = `${add(`%${term}%`)}::text`;
            return `(r.normalized_name ILIKE ${termParam} OR EXISTS (SELECT 1 FROM dish term_ds WHERE term_ds.restaurant_id = r.id AND term_ds.status = 'available' AND term_ds.normalized_name ILIKE ${termParam}) OR COALESCE(r.semantic_profile, '') ILIKE ${termParam})`;
          });
      // These parameters are referenced only by the relevance ORDER BY.
      // Allocating them for rating/newest/distance leaves untyped, unused
      // placeholders in the prepared statement and PostgreSQL returns 503.
      const usesRelevanceOrder =
        filters.sort !== RestaurantSort.Rating &&
        filters.sort !== RestaurantSort.Newest &&
        !(filters.sort === RestaurantSort.Distance && filters.latitude !== undefined);
      const evidenceTerms = filters.strictFoodQuery || !usesRelevanceOrder
        ? []
        : terms.map((term) => {
            const termParam = `${add(term)}::text`;
            return `EXISTS (
          SELECT 1
          FROM dish evidence_ds
          JOIN dish_attribute evidence_da ON evidence_da.dish_id = evidence_ds.id
          JOIN food_attribute evidence_fa ON evidence_fa.id = evidence_da.attribute_id
          WHERE evidence_ds.restaurant_id = r.id
            AND evidence_ds.status = 'available'
            AND evidence_fa.is_active = true
            AND evidence_fa.normalized = ${termParam}
        )`;
          });
      if (evidenceTerms.length) {
        // Query terms such as "nướng", "chay", "hải sản" can have a direct
        // canonical attribute signal even when the restaurant name does not
        // contain the term. Keep it bounded so structured evidence helps
        // semantic relevance without becoming a category-specific hard rule.
        evidenceExpr = `CASE WHEN ${evidenceTerms.join(' OR ')} THEN 0.25::real ELSE 0::real END`;
      }
      relevanceExpr = `GREATEST(similarity(r.name, ${exact}), similarity(r.normalized_name, ${exact}))`;
      relevanceSelect = `${relevanceExpr} AS relevance_score`;
      // Search through the stored normalized columns instead of calling
      // PostgreSQL's optional `unaccent` extension at request time. The
      // extension is useful for migrations, but a missing extension must
      // not turn every natural-language recommendation into a 500.
      if (filters.strictFoodQuery) {
        let strictRestaurantName: string;
        let strictDishName: string;
        if (filters.strictFoodQuery === 'mì') {
          // The broad noodle category includes phở, bánh canh and noisy
          // classification. Match mì or its named equivalents as whole words;
          // a bánh mì shop is a sandwich result, not a mì result.
          const noodleName = add('(^|[^[:alpha:]])(mì|mỳ|ramen|udon|soba)([^[:alpha:]]|$)');
          const sandwichName = add('(^|[^[:alpha:]])bánh[[:space:]]+mì([^[:alpha:]]|$)');
          strictRestaurantName = `(r.name ~* ${noodleName} AND r.name !~* ${sandwichName})`;
          strictDishName = `(strict_ds.name ~* ${noodleName} AND strict_ds.name !~* ${sandwichName})`;
        } else {
          const strict = add(`%${filters.strictFoodQuery}%`);
          // For Vietnamese phrases with diacritics, matching only the stored
          // normalized_name can create collisions such as "lẩu" -> "lau" and
          // accidentally match "lầu 7". Prefer the original name/dish text in
          // that case; normalized matching remains useful for ASCII aliases.
          const strictHasDiacritics = /[^\u0000-\u007f]/u.test(filters.strictFoodQuery);
          const strictNormalized = strictHasDiacritics
            ? null
            : add(
                `%${filters.strictFoodQuery
                  .normalize('NFD')
                  .replace(/[\u0300-\u036f]/g, '')
                  .toLowerCase()}%`,
              );
          strictRestaurantName = strictHasDiacritics
            ? `r.name ILIKE ${strict}`
            : `(r.name ILIKE ${strict} OR r.normalized_name ILIKE ${strictNormalized!})`;
          strictDishName = strictHasDiacritics
            ? `(strict_ds.name ILIKE ${strict})`
            : `(strict_ds.name ILIKE ${strict} OR strict_ds.normalized_name ILIKE ${strictNormalized!})`;
        }
        // Strict cuisine intent may match a restaurant name, a taxonomy row,
        // or a dish row, but never the broad semantic_profile.
        where.push(`(
          ${strictRestaurantName}
          OR EXISTS (
            SELECT 1 FROM restaurant_category strict_rc
            JOIN category strict_c ON strict_c.id = strict_rc.category_id AND strict_c.is_active = true
            WHERE strict_rc.restaurant_id = r.id AND strict_c.slug = ${exact}::text
          )
          OR EXISTS (
            SELECT 1 FROM dish strict_ds
            WHERE strict_ds.restaurant_id = r.id AND strict_ds.status = 'available'
              ${filters.strictFoodQuery === 'mì' ? "AND strict_ds.source IN ('menu_image:curated', 'website:menu:v1')" : ''}
              AND ${strictDishName}
          )
        )`);
        // A strict cuisine/style phrase can be grounded by the restaurant or
        // dish name even when no trusted menu extraction exists. Surface that
        // distinction to the API so the client can label it for manual review.
        if (!filters.tastes?.length && !filters.dishStyle && !filters.dishQueries?.length) {
          dishEvidenceStatusSelect = `'candidate_signal'::text AS dish_evidence_status`;
        }
      } else {
        where.push(
          `(r.name ILIKE ${p!} OR r.normalized_name ILIKE ${p!} OR r.normalized_name ILIKE ${normalized!} OR EXISTS (SELECT 1 FROM dish ds WHERE ds.restaurant_id = r.id AND ds.status = 'available' AND (ds.name ILIKE ${p!} OR ds.normalized_name ILIKE ${normalized!})) OR COALESCE(r.semantic_profile, '') ILIKE ${p!} OR COALESCE(r.semantic_profile, '') ILIKE ${normalized!}${termClauses.length ? ` OR ${termClauses.join(' OR ')}` : ''})`,
        );
      }
    }
    if (filters.category) {
      const p = add(filters.category);
      where.push(
        `EXISTS (SELECT 1 FROM restaurant_category f_rc JOIN category f_c ON f_c.id = f_rc.category_id WHERE f_rc.restaurant_id = r.id AND f_c.slug = ${p} AND f_c.is_active = true)`,
      );
      // The imported vegetarian taxonomy contains some clearly non-vegetarian
      // venues. Require an independent name signal before claiming the venue
      // is vegetarian; menu-only proof can be added when coverage improves.
      if (filters.category === 'vegetarian') {
        where.push(`r.normalized_name ~ '(^| )(chay|vegan|vegetarian)( |$)'`);
      }
      if (filters.category === 'dessert') {
        where.push(`r.normalized_name ~ '(^| )(che|kem|bakery|cake|banh ngot|banh kem|gelato|dessert)( |$)'`);
      }
    }
    for (const term of filters.excludedFoodTerms ?? []) {
      const isBeef = term === 'thịt bò';
      const p = add(isBeef ? '(^| )bo( |$)' : `%${term}%`);
      const venueMatch = isBeef ? `r.normalized_name ~ ${p}` : `r.name ILIKE ${p}`;
      const dishMatch = isBeef
        ? `excluded_ds.normalized_name ~ ${p}`
        : `excluded_ds.name ILIKE ${p}`;
      where.push(`(NOT (${venueMatch}) AND NOT EXISTS (
        SELECT 1 FROM dish excluded_ds
        WHERE excluded_ds.restaurant_id = r.id
          AND excluded_ds.status = 'available'
          AND excluded_ds.source IN ('menu_image:curated', 'website:menu:v1')
          AND ${dishMatch}
      ))`);
    }
    if (filters.ingredientTerms?.length) {
      const ingredientTerms = filters.ingredientTerms;
      const aliases: Record<string, string[]> = {
        'đậu phụ': ['dau phu', 'dau hu', 'tofu'],
        'hải sản': ['hai san'],
        'mì': ['mi', 'my', 'ramen', 'udon'],
        'thịt bò': ['bo'],
        'thịt gà': ['ga'],
        'thịt heo': ['heo'],
        'khoai tây': ['khoai tay'],
        'cà chua': ['ca chua'],
        'hành lá': ['hanh la'],
        'trứng': ['trung'],
        'nấm': ['nam'],
        'tôm': ['tom'],
        'mực': ['muc'],
        'rau': ['rau'],
      };
      const groups = ingredientTerms.map((term) =>
        `${add((aliases[term] ?? [term]).map((alias) => `(^| )${alias}( |$)`))}::text[]`);
      const ingredientName = (column: string, term: string) =>
        // Mắm tôm is a condiment, not evidence that shrimp is the main
        // ingredient. Keep another "tôm" in the same name if one exists.
        term === 'tôm'
          ? `regexp_replace(${column}, '(^| )mam tom( |$)', ' ', 'g')`
          : column;
      // A multi-ingredient request must match one dish, not unrelated terms in
      // different reviews or the broad semantic profile. Venue-name signals
      // remain candidates when no verified menu has been curated yet.
      where.push(`(( ${groups.map((group, index) => `${ingredientName('r.normalized_name', ingredientTerms[index])} ~ ANY (${group})`).join(' AND ')} ) OR EXISTS (
        SELECT 1 FROM dish ingredient_ds
        WHERE ingredient_ds.restaurant_id = r.id
          AND ingredient_ds.status = 'available'
          AND ingredient_ds.source IN ('menu_image:curated', 'website:menu:v1')
          AND ${groups.map((group, index) => `${ingredientName('ingredient_ds.normalized_name', ingredientTerms[index])} ~ ANY (${group})`).join(' AND ')}
      ))`);
      dishEvidenceStatusSelect = `'candidate_signal'::text AS dish_evidence_status`;
    }
    if (filters.dishStyle === 'dry') {
      // Món-khô retrieval used to run the trusted OCR expression as a
      // correlated EXISTS for every restaurant. Materialize the eligible
      // restaurant ids once so nearby searches do not repeatedly normalize
      // and scan the same menu text.
      const dryNearbyJoin = nearbyCte
        ? ' JOIN nearby_restaurants dry_nearby ON dry_nearby.id = dry_ds.restaurant_id'
        : '';
      dryMatchCte = `dry_menu_matches AS MATERIALIZED (
        SELECT dry_ds.restaurant_id,
               (array_agg(DISTINCT dry_ds.name ORDER BY dry_ds.name))[1:3] AS matched_dishes
          FROM dish dry_ds
          JOIN dish_evidence dry_de
            ON dry_de.dish_id = dry_ds.id
           AND dry_de.evidence_type = 'menu_image'
          JOIN menu_image_extraction dry_mie
            ON dry_mie.restaurant_image_id = dry_de.restaurant_image_id
          JOIN restaurant dry_r ON dry_r.id = dry_ds.restaurant_id${dryNearbyJoin}
         WHERE dry_ds.status = 'available'
           AND dry_ds.source IN ('menu_image:curated', 'website:menu:v1')
           AND dry_mie.status = 'completed'
           AND ${trustedMenuExtraction('dry_mie')}
           AND left(regexp_replace(lower(unaccent(COALESCE(dry_mie.raw_ocr_text, ''))), '\\s+', ' ', 'g'), 700)
                 LIKE '%' || dry_ds.normalized_name || '%'
           AND NOT (dry_ds.normalized_name ILIKE ANY (ARRAY[
             '%pho%', '%bun bo%', '%bun rieu%', '%bun mam%', '%bun nuoc%',
             '%hu tieu%', '%banh canh%', '%chao%', '%lau%', '%canh%',
             '%sup%', '%mien nuoc%', '%mi nuoc%', '%mi soup%'
           ]::text[]))
           AND dry_ds.normalized_name ~ '(com|mi xao|mi chien|banh mi|pizza|banh xeo|nuong|chien|kho|xao|rang|cuon|goi|sushi|salad|khoai|bap|nem|sot|trung|chien)'
           -- A broth/hotpot venue is not a good generic dry-food result
           -- merely because one side dish on its menu happens to be dry.
           AND NOT (dry_r.normalized_name ILIKE ANY (ARRAY[
             '%pho%', '%bun bo%', '%bun rieu%', '%bun mam%', '%bun nuoc%',
             '%hu tieu%', '%banh canh%', '%chao%', '%lau%', '%canh%',
             '%sup%', '%mi nuoc%', '%mi soup%'
           ]::text[]))
         GROUP BY dry_ds.restaurant_id
      )`;
      dryMatchJoin = ' JOIN dry_menu_matches dry_match ON dry_match.restaurant_id = r.id';
      dishEvidenceStatusSelect = `'verified_menu'::text AS dish_evidence_status`;
    }
    if (filters.dishStyle === 'brothy') {
      const brothyNearbyJoin = nearbyCte
        ? ' JOIN nearby_restaurants brothy_nearby ON brothy_nearby.id = brothy_ds.restaurant_id'
        : '';
      brothyMatchCte = `brothy_menu_matches AS MATERIALIZED (
        SELECT brothy_ds.restaurant_id,
               (array_agg(DISTINCT brothy_ds.name ORDER BY brothy_ds.name))[1:3] AS matched_dishes
          FROM dish brothy_ds${brothyNearbyJoin}
          JOIN dish_evidence brothy_de ON brothy_de.dish_id = brothy_ds.id AND brothy_de.evidence_type = 'menu_image'
          JOIN menu_image_extraction brothy_mie ON brothy_mie.restaurant_image_id = brothy_de.restaurant_image_id
         WHERE brothy_ds.status = 'available'
           AND brothy_ds.source IN ('menu_image:curated', 'website:menu:v1')
           AND brothy_mie.status = 'completed'
           AND ${trustedMenuExtraction('brothy_mie')}
           AND left(regexp_replace(lower(unaccent(COALESCE(brothy_mie.raw_ocr_text, ''))), '\\s+', ' ', 'g'), 700) LIKE '%' || brothy_ds.normalized_name || '%'
           AND brothy_ds.normalized_name ~ '(pho|bun|canh|lau|chao|sup|mien nuoc|mi nuoc|hu tieu|bun nuoc|nuoc dung)'
           -- Do not treat dry dishes that happen to contain "bún/mì" as
           -- broth evidence (for example bún thịt nướng or bún chả).
           AND NOT (brothy_ds.normalized_name ILIKE ANY (ARRAY[
             '%bun thit nuong%', '%bun cha%', '%bun dau%', '%bun nuong%',
             '%com%', '%banh mi%', '%mi xao%', '%mi chien%', '%pizza%',
             '%banh xeo%', '%nuong%', '%chien%', '%xao%', '%rang%',
             '%cuon%', '%goi%', '%salad%'
           ]::text[]))
         GROUP BY brothy_ds.restaurant_id
      )`;
      brothyMatchJoin =
        ' JOIN brothy_menu_matches brothy_match ON brothy_match.restaurant_id = r.id';
      dishEvidenceStatusSelect = `'verified_menu'::text AS dish_evidence_status`;
    }
    for (const dishType of filters.dishTypes ?? []) {
      const p = add(dishType);
      where.push(
        `EXISTS (SELECT 1 FROM restaurant_category dt_rc JOIN category dt_c ON dt_c.id = dt_rc.category_id WHERE dt_rc.restaurant_id = r.id AND dt_c.slug = ${p} AND dt_c.is_active = true)`,
      );
    }
    if (filters.dishQueries?.length) {
      const normalizedDishQueries = filters.dishQueries.map((dish) =>
        dish
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[đĐ]/g, 'd')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim(),
      );
      const exactNames = add(normalizedDishQueries);
      const verifiedDishPriceLimit = filters.maxDishPriceVnd !== undefined
        ? `AND exact_ds.currency_code = 'VND' AND exact_ds.price_amount >= 1000
           AND exact_ds.price_amount ${filters.maxDishPriceExclusive ? '<' : '<='} ${add(filters.maxDishPriceVnd)}
           AND exact_de.raw_price IS NOT NULL`
        : '';
      // Full-label searches stay strict, but a curator may verify that the
      // same first-party menu image prints an exact bilingual translation.
      // Admit only that reviewed identity, never a fuzzy description/alias.
      const curatedBilingualMatch = `(exact_mie.model = 'website:menu-image-curated:v1' AND EXISTS (
        SELECT 1 FROM canonical_dish exact_bilingual_cd
        JOIN canonical_dish_alias exact_bilingual_alias
          ON exact_bilingual_alias.canonical_dish_id = exact_bilingual_cd.id
        WHERE exact_bilingual_cd.id = exact_ds.canonical_dish_id
          AND exact_bilingual_cd.normalized_name = exact_query.query_normalized
          AND exact_bilingual_alias.normalized_alias = exact_ds.normalized_name
          AND exact_bilingual_alias.source = 'curated_bilingual_menu:v1'
      ))`;
      dishMatchCte = `verified_exact_menu AS MATERIALIZED (
        SELECT exact_ds.restaurant_id, exact_ds.id AS dish_id, exact_ds.name,
               exact_ds.name AS display_name,
               exact_ds.normalized_name, exact_query.query_normalized,
               COALESCE(exact_de.confidence, 0)::real AS confidence
          FROM dish exact_ds
          JOIN dish_evidence exact_de
            ON exact_de.dish_id = exact_ds.id
           AND exact_de.evidence_type = 'menu_image'
          JOIN menu_image_extraction exact_mie
            ON exact_mie.restaurant_image_id = exact_de.restaurant_image_id
          ${hasNearbyRadius ? 'JOIN nearby_restaurants exact_nearby ON exact_nearby.id = exact_ds.restaurant_id' : ''}
          CROSS JOIN LATERAL unnest(${exactNames}::text[]) AS exact_query(query_normalized)
         WHERE exact_ds.status = 'available'
           AND exact_ds.source IN ('menu_image:curated', 'website:menu:v1')
           ${verifiedDishPriceLimit}
           AND exact_mie.status = 'completed'
           AND ${trustedMenuExtraction('exact_mie')}
           AND (
             exact_ds.normalized_name = exact_query.query_normalized
             ${filters.exactDishNameOnly ? `OR ${curatedBilingualMatch}` : ''}
             ${filters.exactDishNameOnly ? '' : `
             OR exact_ds.normalized_name LIKE exact_query.query_normalized || ' %'
             -- A first-party catalog can label a pizza simply "Seafood" while
             -- its reviewed description identifies the full Vietnamese dish.
             -- Descriptions are never enough without completed menu evidence.
             OR (exact_ds.source = 'website:menu:v1'
               AND lower(unaccent(COALESCE(exact_ds.description, '')))
                 LIKE '%' || exact_query.query_normalized || '%')
             OR EXISTS (
               SELECT 1
                 FROM canonical_dish exact_cd
                 LEFT JOIN canonical_dish_alias exact_alias
                   ON exact_alias.canonical_dish_id = exact_cd.id
                WHERE exact_cd.id = exact_ds.canonical_dish_id
                  AND (exact_cd.normalized_name = exact_query.query_normalized
                    OR exact_alias.normalized_alias = exact_query.query_normalized)
             )
             `}
           )
           AND (
             left(regexp_replace(lower(unaccent(COALESCE(exact_mie.raw_ocr_text, ''))), '\\s+', ' ', 'g'), 700)
               LIKE '%' || exact_query.query_normalized || '%'
             OR (exact_mie.model = 'website:menu-image-curated:v1'
               AND lower(unaccent(exact_de.raw_name)) = exact_query.query_normalized)
             OR (exact_mie.model = 'website:menu:v1'
               AND btrim(regexp_replace(lower(unaccent(exact_de.raw_name)), '[^a-z0-9]+', ' ', 'g'))
                 = exact_query.query_normalized)
             ${filters.exactDishNameOnly ? `OR ${curatedBilingualMatch}` : ''}
             ${filters.exactDishNameOnly ? '' : `
             OR (exact_ds.source = 'website:menu:v1'
               AND lower(unaccent(COALESCE(exact_ds.description, '')))
                 LIKE '%' || exact_query.query_normalized || '%')
             OR EXISTS (
               SELECT 1
                 FROM canonical_dish exact_raw_cd
                 LEFT JOIN canonical_dish_alias exact_raw_alias
                   ON exact_raw_alias.canonical_dish_id = exact_raw_cd.id
                WHERE exact_raw_cd.id = exact_ds.canonical_dish_id
                  AND (exact_raw_cd.normalized_name = exact_query.query_normalized
                    OR exact_raw_alias.normalized_alias = exact_query.query_normalized)
             )
             `}
           )
      ), candidate_menu_matches AS MATERIALIZED (
        SELECT DISTINCT candidate_image.restaurant_id, candidate_query.query_normalized
          FROM menu_image_extraction candidate_mie
          JOIN restaurant_image candidate_image
            ON candidate_image.id = candidate_mie.restaurant_image_id
          ${hasNearbyRadius ? 'JOIN nearby_restaurants candidate_menu_nearby ON candidate_menu_nearby.id = candidate_image.restaurant_id' : ''}
          CROSS JOIN LATERAL unnest(${exactNames}::text[]) AS candidate_query(query_normalized)
         WHERE candidate_image.status = 'active'
           AND candidate_mie.status = 'completed'
           AND COALESCE(candidate_mie.raw_ocr_text, '') NOT ILIKE 'food_photo:%'
           AND candidate_mie.model IN ('website:menu:v1', 'website:menu-image-curated:v1', 'google_maps:menu-curated:v1')
           AND (lower(unaccent(COALESCE(candidate_mie.raw_ocr_text, ''))) LIKE '%' || candidate_query.query_normalized || '%'
             OR lower(unaccent(COALESCE(candidate_image.alt_text, ''))) LIKE '%' || candidate_query.query_normalized || '%')
           -- Nearby exact-dish retrieval must stay responsive. The exact
           -- menu CTE above is authoritative; broad OCR candidate scans are
           -- intentionally skipped when a radius already bounds the catalog.
           ${hasNearbyRadius ? 'AND false' : ''}
      ), candidate_dish_matches AS MATERIALIZED (
        SELECT candidate_r.id AS restaurant_id, candidate_query.query_normalized
               , CASE
                   WHEN candidate_r.normalized_name ILIKE '%' || candidate_query.query_normalized || '%'
                     OR (candidate_query.query_normalized = 'com tam suon' AND candidate_r.normalized_name ILIKE '%com tam%')
                     THEN 0.34::real
                   WHEN candidate_menu_match.restaurant_id IS NOT NULL THEN 0.28::real
                   ELSE 0.12::real
                 END AS candidate_score
          FROM restaurant candidate_r
          ${hasNearbyRadius ? 'JOIN nearby_restaurants candidate_nearby ON candidate_nearby.id = candidate_r.id' : ''}
          CROSS JOIN LATERAL unnest(${exactNames}::text[]) AS candidate_query(query_normalized)
          LEFT JOIN candidate_menu_matches candidate_menu_match
            ON candidate_menu_match.restaurant_id = candidate_r.id
           AND candidate_menu_match.query_normalized = candidate_query.query_normalized
         WHERE candidate_r.status = 'active'
           AND (
             candidate_r.normalized_name ILIKE '%' || candidate_query.query_normalized || '%'
             OR (candidate_query.query_normalized = 'com tam suon' AND candidate_r.normalized_name ILIKE '%com tam%')
             OR candidate_menu_match.restaurant_id IS NOT NULL
           )
      )`;
    }
    if (filters.dishQueries?.length && dishMatchCte) {
      dishMatchCte += `, exact_dish_matches AS MATERIALIZED (
        SELECT restaurant_id,
               bool_or(true) AS exact_match,
               MAX(confidence)::real AS max_confidence,
               COUNT(DISTINCT dish_id)::int AS match_count,
               (array_agg(DISTINCT display_name ORDER BY display_name))[1:3] AS matched_dishes
          FROM verified_exact_menu
         GROUP BY restaurant_id
      ), candidate_dish_matches_by_restaurant AS MATERIALIZED (
        SELECT restaurant_id, bool_or(true) AS candidate_match, MAX(candidate_score)::real AS candidate_score
          FROM candidate_dish_matches
         GROUP BY restaurant_id
      ), dish_matches AS MATERIALIZED (
        SELECT COALESCE(exact_match.restaurant_id, candidate_match.restaurant_id) AS restaurant_id,
               COALESCE(exact_match.exact_match, false) AS exact_match,
               COALESCE(candidate_match.candidate_match, false) AS candidate_match,
               COALESCE(candidate_match.candidate_score, 0)::real AS candidate_score,
               COALESCE(exact_match.max_confidence, 0)::real AS max_confidence,
               COALESCE(exact_match.match_count, 0)::int AS match_count,
               COALESCE(exact_match.matched_dishes, ARRAY[]::text[]) AS matched_dishes
          FROM exact_dish_matches exact_match
          FULL OUTER JOIN candidate_dish_matches_by_restaurant candidate_match
            ON candidate_match.restaurant_id = exact_match.restaurant_id
      )`;
      dishMatchJoin = ' JOIN dish_matches dish_match ON dish_match.restaurant_id = r.id';
      where.push(filters.verifiedMenuOnly
        ? 'dish_match.exact_match'
        : '(dish_match.exact_match OR dish_match.candidate_match)');
      dishCandidateSelect =
        '(dish_match.candidate_match AND NOT dish_match.exact_match) AS dish_candidate';
      dishEvidenceStatusSelect = `(CASE WHEN dish_match.exact_match THEN 'verified_menu' WHEN dish_match.candidate_match THEN 'candidate_signal' ELSE NULL END) AS dish_evidence_status`;
      dishMatchExpr =
        'CASE WHEN dish_match.exact_match THEN 0.45::real WHEN dish_match.candidate_match THEN 0.16::real + LEAST(COALESCE(dish_match.candidate_score, 0)::real, 0.34::real) * 0.15::real ELSE 0::real END';
      dishEvidenceExpr = `LEAST(0.18::real,
        dish_match.max_confidence * 0.12
        + LEAST(dish_match.match_count, 3)::real * 0.02)`;
    }
    if (filters.dishQueriesAny?.length) {
      // Contextual recommendations such as rainy-day food used to repeat one
      // correlated EXISTS tree per alternative in WHERE, SELECT and ORDER BY.
      // On a populated catalog that made PostgreSQL re-run the same OCR
      // quality guards many times and occasionally hit statement_timeout.
      // Materialize the verified menu facts once, then join the small
      // restaurant-level match set. This keeps the exact-menu gate while
      // making weather + optional radius predictable.
      const weatherDishes = filters.dishQueriesAny.map((dish) =>
        dish
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[đĐ]/g, 'd')
          .toLowerCase()
          .trim(),
      );
      const weatherVariants = weatherDishes.map((dish) => `${dish} %`);
      const weatherNamesParam = add(weatherDishes);
      const weatherVariantsParam = add(weatherVariants);
      const weatherCandidateLikeParam = add(weatherDishes.map((dish) => `%${dish}%`));
      const weatherCandidateNamesParam = add(weatherDishes);
      const weatherCandidateVariantsParam = add(weatherVariants);
      weatherMatchCte = `verified_weather_menu AS MATERIALIZED (
        SELECT weather_d.restaurant_id, weather_d.id AS dish_id, weather_d.name,
               weather_d.name AS display_name,
               weather_d.normalized_name, COALESCE(weather_de.confidence, 0)::real AS confidence,
               left(regexp_replace(lower(unaccent(COALESCE(weather_mie.raw_ocr_text, ''))), '\\s+', ' ', 'g'), 700) AS normalized_ocr
          FROM dish weather_d
          JOIN dish_evidence weather_de
            ON weather_de.dish_id = weather_d.id
           AND weather_de.evidence_type = 'menu_image'
          JOIN menu_image_extraction weather_mie
            ON weather_mie.restaurant_image_id = weather_de.restaurant_image_id
          /* WEATHER_NEARBY_JOIN */
         WHERE weather_d.status = 'available'
           AND weather_d.source IN ('menu_image:curated', 'website:menu:v1')
           AND weather_mie.status = 'completed'
           AND ${trustedMenuExtraction('weather_mie')}
           AND (weather_d.normalized_name = ANY (${weatherNamesParam}::text[])
             OR weather_d.normalized_name LIKE ANY (${weatherVariantsParam}::text[]))
      ), weather_matches AS MATERIALIZED (
        SELECT restaurant_id,
               COUNT(DISTINCT dish_id)::int AS match_count,
               MAX(confidence)::real AS max_confidence,
               (array_agg(DISTINCT display_name ORDER BY display_name))[1:6] AS matched_dishes
          FROM verified_weather_menu
         WHERE normalized_ocr LIKE '%' || normalized_name || '%'
         GROUP BY restaurant_id
      ), weather_candidates AS MATERIALIZED (
        SELECT candidate_r.id AS restaurant_id
          FROM restaurant candidate_r
         /* The nearby CTE is already the hard spatial boundary. Joining it
          * here prevents the candidate branch from scanning every active
          * restaurant and running three correlated menu/name checks across
          * the full catalog. */
         /* WEATHER_CANDIDATE_NEARBY_JOIN */
         WHERE candidate_r.status = 'active'
           AND (
             candidate_r.normalized_name ILIKE ANY (${weatherCandidateLikeParam}::text[])
             OR EXISTS (
               SELECT 1 FROM dish candidate_ds
                WHERE candidate_ds.restaurant_id = candidate_r.id
                  AND candidate_ds.status = 'available'
                  AND candidate_ds.source = 'enrichment:dish:lexicon:v1'
                  AND (candidate_ds.normalized_name = ANY (${weatherCandidateNamesParam}::text[])
                    OR candidate_ds.normalized_name LIKE ANY (${weatherCandidateVariantsParam}::text[]))
             )
             OR EXISTS (
               SELECT 1
                 FROM menu_image_extraction candidate_mie
                 JOIN restaurant_image candidate_image ON candidate_image.id = candidate_mie.restaurant_image_id
                WHERE candidate_image.restaurant_id = candidate_r.id
                  AND candidate_image.status = 'active'
                  -- Keep weather candidates grounded in accepted extraction
                  -- output. This prevents stale/contaminated OCR from a
                  -- rejected photo (for example a coffee-shop image) from
                  -- becoming a nearby hot-food recommendation.
                  AND candidate_mie.status = 'completed'
                  AND COALESCE(candidate_mie.raw_ocr_text, '') NOT ILIKE 'food_photo:%'
                  AND candidate_mie.model IN ('website:menu:v1', 'website:menu-image-curated:v1', 'google_maps:menu-curated:v1')
                  AND lower(unaccent(COALESCE(candidate_mie.raw_ocr_text, ''))) LIKE ANY (${weatherCandidateLikeParam}::text[])
             )
           )
      )`;
      weatherMatchJoin =
        ' LEFT JOIN weather_matches weather_match ON weather_match.restaurant_id = r.id LEFT JOIN weather_candidates weather_candidate ON weather_candidate.restaurant_id = r.id';
      where.push(
        '(COALESCE(weather_match.match_count, 0) > 0 OR weather_candidate.restaurant_id IS NOT NULL)',
      );
      // weather_candidates is an inner join, so every returned row is either
      // a verified weather-menu match or a candidate signal. Avoid selecting
      // the join key itself here; PostgreSQL would otherwise require another
      // GROUP BY term for the restaurant aggregate query.
      dishCandidateSelect = `(CASE WHEN COALESCE(weather_match.match_count, 0) = 0 THEN true ELSE false END) AS dish_candidate`;
      dishEvidenceStatusSelect = `(CASE WHEN COALESCE(weather_match.match_count, 0) > 0 THEN 'verified_menu' ELSE 'candidate_signal' END) AS dish_evidence_status`;
      dishMatchExpr = `GREATEST(${dishMatchExpr}, CASE WHEN COALESCE(weather_match.match_count, 0) > 0 THEN 0.45::real ELSE 0.12::real END)`;
      dishEvidenceExpr = `GREATEST(${dishEvidenceExpr}, LEAST(0.18::real,
        COALESCE(weather_match.max_confidence, 0)::real * 0.12
        + LEAST(COALESCE(weather_match.match_count, 0), 3)::real * 0.02))`;
      weatherMatchedDishesSelect =
        'COALESCE(weather_match.matched_dishes[1:3], ARRAY[]::text[]) AS matched_dishes';
    }
    const matchedDishQueries = [
      ...(filters.dishQueries ?? []),
      ...(filters.dishQueriesAny ?? []),
    ].map((dish) =>
      dish
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, 'd')
        .toLowerCase()
        .trim(),
    );
    const matchedDishVariants = matchedDishQueries.map((dish) => `${dish} %`);
    const matchedTasteValues =
      filters.dishQueries?.length || filters.dishQueriesAny?.length ? [] : (filters.tastes ?? []);
    const normalizedMatchedTasteValues = matchedTasteValues
      .map((taste) =>
        taste
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[đĐ]/g, 'd')
          .toLowerCase()
          .trim(),
      )
      .filter(Boolean);
    const normalizedMatchedTasteLikeValues = normalizedMatchedTasteValues.map(
      (taste) => `%${taste}%`,
    );
    const matchedDishSelect =
      filters.dishQueriesAny?.length && !filters.dishQueries?.length
        ? weatherMatchedDishesSelect
        : filters.dishQueries?.length && dishMatchCte
          ? 'dish_match.matched_dishes AS matched_dishes'
          : filters.dishStyle === 'dry'
          ? 'dry_match.matched_dishes AS matched_dishes'
          : filters.dishStyle === 'brothy'
            ? 'brothy_match.matched_dishes AS matched_dishes'
            : matchedDishQueries.length
                ? `(SELECT COALESCE((array_agg(DISTINCT matched_ds.name ORDER BY matched_ds.name))[1:3], ARRAY[]::text[])
           FROM dish matched_ds
           LEFT JOIN canonical_dish matched_cd ON matched_cd.id = matched_ds.canonical_dish_id
          WHERE matched_ds.restaurant_id = r.id
            AND matched_ds.status = 'available'
            AND matched_ds.source IN ('menu_image:curated', 'website:menu:v1')
            AND (
              matched_ds.normalized_name = ANY (${add(matchedDishQueries)}::text[])
              OR matched_ds.normalized_name LIKE ANY (${add(matchedDishVariants)}::text[])
              OR EXISTS (
                SELECT 1
                FROM canonical_dish matched_query_cd
                LEFT JOIN canonical_dish_alias matched_query_alias
                  ON matched_query_alias.canonical_dish_id = matched_query_cd.id
                WHERE matched_query_cd.id = matched_ds.canonical_dish_id
                  AND (matched_query_cd.normalized_name = ANY (${add(matchedDishQueries)}::text[])
                    OR matched_query_alias.normalized_alias = ANY (${add(matchedDishQueries)}::text[]))
              )
            )
            AND EXISTS (
              SELECT 1
              FROM dish_evidence matched_de
              JOIN menu_image_extraction matched_mie
                ON matched_mie.restaurant_image_id = matched_de.restaurant_image_id
             WHERE matched_de.dish_id = matched_ds.id
               AND matched_de.evidence_type = 'menu_image'
               AND matched_mie.status = 'completed'
               AND ${trustedMenuExtraction('matched_mie')}
               AND left(regexp_replace(lower(unaccent(COALESCE(matched_mie.raw_ocr_text, ''))), '\\s+', ' ', 'g'), 700) LIKE '%' || matched_ds.normalized_name || '%'
            )) AS matched_dishes`
                : matchedTasteValues.length
                  ? `(SELECT COALESCE((array_agg(DISTINCT matched_taste_ds.name ORDER BY matched_taste_ds.name))[1:3], ARRAY[]::text[])
             FROM dish matched_taste_ds
             LEFT JOIN canonical_dish matched_taste_cd ON matched_taste_cd.id = matched_taste_ds.canonical_dish_id
             JOIN dish_evidence matched_taste_de ON matched_taste_de.dish_id = matched_taste_ds.id
             JOIN menu_image_extraction matched_taste_mie
               ON matched_taste_mie.restaurant_image_id = matched_taste_de.restaurant_image_id
             LEFT JOIN dish_attribute matched_taste_da ON matched_taste_da.dish_id = matched_taste_ds.id
             LEFT JOIN food_attribute matched_taste_fa ON matched_taste_fa.id = matched_taste_da.attribute_id
            WHERE matched_taste_ds.restaurant_id = r.id
              AND matched_taste_ds.status = 'available'
              AND matched_taste_de.evidence_type = 'menu_image'
              AND matched_taste_mie.status = 'completed'
              AND ${trustedMenuExtraction('matched_taste_mie')}
              AND left(regexp_replace(lower(unaccent(COALESCE(matched_taste_mie.raw_ocr_text, ''))), '\\s+', ' ', 'g'), 700) LIKE '%' || matched_taste_ds.normalized_name || '%'
              AND (
                (matched_taste_fa.is_active = true AND matched_taste_fa.normalized = ANY (${add(normalizedMatchedTasteValues)}::text[]))
                OR (
                  matched_taste_ds.normalized_name <> ALL (${add(normalizedMatchedTasteValues)}::text[])
                  AND ${recognizableDishName('matched_taste_ds')}
                  AND (matched_taste_ds.normalized_name ILIKE ANY (${add(normalizedMatchedTasteLikeValues)}::text[])
                    OR matched_taste_ds.name ILIKE ANY (${add(normalizedMatchedTasteLikeValues)}::text[]))
                )
              )
          ) AS matched_dishes`
                  : 'ARRAY[]::text[] AS matched_dishes';
    for (const taste of filters.tastes ?? []) {
      const normalizedTaste = taste
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, 'd')
        .toLowerCase();
      // "nóng/mát" is inferred comfort context for weather alternatives, not
      // a hard taxonomy filter. Keeping it as a WHERE condition removes
      // candidate venues before they can be shown with the manual-check label.
      if (filters.dishQueriesAny?.length && ['nong', 'mat'].includes(normalizedTaste)) continue;
      const p = add(`%${taste}%`);
      const normalized = add(`%${normalizedTaste}%`);
      const attributeNormalized = add(normalizedTaste);
      const verifiedDish = (alias: string, evidenceAlias: string) =>
        `(${alias}.source IN ('menu_image:curated', 'website:menu:v1') AND EXISTS (SELECT 1 FROM dish_evidence ${evidenceAlias} JOIN menu_image_extraction ${evidenceAlias}_mie ON ${evidenceAlias}_mie.restaurant_image_id = ${evidenceAlias}.restaurant_image_id WHERE ${evidenceAlias}.dish_id = ${alias}.id AND ${evidenceAlias}.evidence_type = 'menu_image' AND ${evidenceAlias}_mie.status = 'completed' AND ${trustedMenuExtraction(`${evidenceAlias}_mie`)} AND left(regexp_replace(lower(unaccent(COALESCE(${evidenceAlias}_mie.raw_ocr_text, ''))), '\\s+', ' ', 'g'), 700) LIKE '%' || ${alias}.normalized_name || '%'))`;
      // Prefer the food-attribute taxonomy (dish_attribute links produced by
      // enrichment). Only fall back to a literal dish-name match for values
      // that are not canonical attributes (e.g. "bún bò huế" from intent).
      where.push(
        `(EXISTS (SELECT 1 FROM dish_attribute taste_da JOIN food_attribute taste_fa ON taste_fa.id = taste_da.attribute_id JOIN dish taste_ds ON taste_ds.id = taste_da.dish_id WHERE taste_ds.restaurant_id = r.id AND taste_ds.status = 'available' AND ${verifiedDish('taste_ds', 'taste_de')} AND taste_fa.normalized = ${attributeNormalized} AND taste_fa.is_active = true) OR EXISTS (SELECT 1 FROM dish taste_ds2 WHERE taste_ds2.restaurant_id = r.id AND taste_ds2.status = 'available' AND ${verifiedDish('taste_ds2', 'taste_de2')} AND taste_ds2.normalized_name <> ${attributeNormalized} AND ${recognizableDishName('taste_ds2')} AND (taste_ds2.name ILIKE ${p} OR taste_ds2.normalized_name ILIKE ${p} OR taste_ds2.normalized_name ILIKE ${normalized} OR COALESCE(taste_ds2.description, '') ILIKE ${p})))`,
      );
      if (!filters.dishQueries?.length && !filters.dishQueriesAny?.length) {
        dishEvidenceStatusSelect = `'verified_menu'::text AS dish_evidence_status`;
      }
      tasteMatchExpr = `GREATEST(${tasteMatchExpr}, CASE WHEN EXISTS (
        SELECT 1 FROM dish_attribute score_da
        JOIN food_attribute score_fa ON score_fa.id = score_da.attribute_id
        JOIN dish score_ds ON score_ds.id = score_da.dish_id
        WHERE score_ds.restaurant_id = r.id AND score_ds.status = 'available' AND ${verifiedDish('score_ds', 'score_de')}
          AND score_fa.normalized = ${attributeNormalized} AND score_fa.is_active = true
      ) THEN 0.32::real WHEN EXISTS (
        SELECT 1 FROM dish score_ds2
        WHERE score_ds2.restaurant_id = r.id AND score_ds2.status = 'available' AND ${verifiedDish('score_ds2', 'score_de2')}
          AND score_ds2.normalized_name <> ${attributeNormalized}
          AND ${recognizableDishName('score_ds2')}
          AND (score_ds2.name ILIKE ${p} OR score_ds2.normalized_name ILIKE ${p}
            OR score_ds2.normalized_name ILIKE ${normalized}
            OR COALESCE(score_ds2.description, '') ILIKE ${p})
      ) THEN 0.12::real ELSE 0::real END)`;
    }
    if (filters.city) {
      const p = add(`%${filters.city}%`);
      where.push(`l.city ILIKE ${p}`);
    }
    if (filters.district) {
      // Exact canonical district matching prevents Quận 1 from matching
      // Quận 10, Quận 11 and Quận 12.
      const p = add(filters.district);
      where.push(`LOWER(TRIM(l.district)) = LOWER(TRIM(${p}::text))`);
      const districtGuard = DISTRICT_LOCATION_GUARDS[filters.district.trim().toLocaleLowerCase('vi-VN')];
      if (districtGuard) {
        const longitude = add(districtGuard.longitude);
        const latitude = add(districtGuard.latitude);
        const radius = add(districtGuard.radiusMeters);
        where.push(`(
          l.coordinates IS NULL OR ST_DWithin(
            l.coordinates,
            ST_SetSRID(ST_MakePoint(${longitude}::double precision, ${latitude}::double precision), 4326)::geography,
            ${radius}::double precision
          )
        )`);
      }
    }
    if (filters.minRating !== undefined) where.push(`r.rating >= ${add(filters.minRating)}`);
    if (filters.priceLevel !== undefined) where.push(`r.price_level = ${add(filters.priceLevel)}`);
    if (filters.latitude !== undefined && filters.longitude !== undefined) {
      const point = `ST_SetSRID(ST_MakePoint(${add(filters.longitude)}::double precision, ${add(filters.latitude)}::double precision), 4326)::geography`;
      distanceSelect = `ST_Distance(l.coordinates, ${point}) AS distance_meters`;
      // Exponential decay gives nearby results a modest boost while preserving
      // query relevance. The requested radius remains the hard boundary.
      distanceScoreExpr = `CASE WHEN l.coordinates IS NOT NULL THEN (${distanceWeight.toFixed(6)} * EXP(-ST_Distance(l.coordinates, ${point}) / 5000.0)) ELSE 0::real END`;
      if (filters.radiusMeters !== undefined) {
        // Materialize the spatial candidate set before evaluating the much
        // heavier verified-menu/evidence expressions. Without this boundary,
        // PostgreSQL may run those correlated subqueries for the whole active
        // catalog and only apply ST_DWithin afterwards, making the nearby
        // filter time out on a populated catalog.
        const radius = `${add(filters.radiusMeters)}::double precision`;
        nearbyCte = `WITH nearby_restaurants AS MATERIALIZED (
          SELECT nearby_r.id
          FROM restaurant nearby_r
          JOIN location nearby_l ON nearby_l.id = nearby_r.location_id
          WHERE nearby_r.status = 'active'
            AND nearby_l.coordinates IS NOT NULL
            AND ST_DWithin(nearby_l.coordinates, ${point}, ${radius})
        ) `;
        nearbyJoin = ' JOIN nearby_restaurants nearby ON nearby.id = r.id';
      }
      distanceOrder = 'distance_meters ASC NULLS LAST, ';
    }
    if (weatherMatchCte) {
      weatherMatchCte = weatherMatchCte.replace(
        '/* WEATHER_NEARBY_JOIN */',
        nearbyCte
          ? 'JOIN nearby_restaurants weather_nearby ON weather_nearby.id = weather_d.restaurant_id'
          : '',
      );
      weatherMatchCte = weatherMatchCte.replace(
        '/* WEATHER_CANDIDATE_NEARBY_JOIN */',
        nearbyCte
          ? 'JOIN nearby_restaurants weather_candidate_nearby ON weather_candidate_nearby.id = candidate_r.id'
          : '',
      );
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
    // A user-enabled radius is a stronger contextual constraint than the
    // small generic proximity boost. For weather alternatives, keep verified
    // menu evidence first, then prefer the nearest matching restaurant. When
    // the nearby filter is off, distance must remain only a bounded ranking
    // signal and must not change the normal relevance ordering.
    const nearbyContextOrder =
      filters.dishQueriesAny?.length && filters.radiusMeters !== undefined
        ? 'distance_meters ASC NULLS LAST, '
        : '';
    const weatherNearbyOrder =
      filters.dishQueriesAny?.length && filters.radiusMeters !== undefined
        ? 'distance_meters ASC NULLS LAST, weather_match.max_confidence DESC, '
        : '';
    const hardFoodNearbyOrder =
      filters.radiusMeters !== undefined &&
      (filters.strictFoodQuery || filters.dishStyle || filters.dishQueries?.length)
        ? 'distance_meters ASC NULLS LAST, '
        : '';
    const order =
      filters.sort === RestaurantSort.Distance && filters.latitude !== undefined
        ? `${distanceOrder}r.updated_at DESC, r.id DESC`
        : filters.sort === RestaurantSort.Rating
          ? 'r.rating DESC NULLS LAST, r.review_count DESC NULLS LAST, r.id DESC'
          : filters.sort === RestaurantSort.Newest
            ? 'r.updated_at DESC, r.id DESC'
            : filters.embedding
              ? `${filters.dishQueries?.length ? `${dishMatchExpr} DESC, ${dishEvidenceExpr} DESC, ` : ''}${filters.dishQueriesAny?.length && !filters.dishQueries?.length ? `${dishMatchExpr} DESC, ${weatherNearbyOrder || `${dishEvidenceExpr} DESC, ${nearbyContextOrder}`}${qualityExpr} DESC, ` : ''}${!filters.dishQueriesAny?.length ? hardFoodNearbyOrder : ''}(COALESCE(${relevanceExpr}, 0) + ${semanticWeight.toFixed(6)} * COALESCE(${semanticExpr}, 0) + COALESCE(${evidenceExpr}, 0) + ${dishMatchExpr} + ${dishEvidenceExpr} + ${tasteMatchExpr} + ${profileQualityExpr} + ${qualityExpr} + ${distanceScoreExpr} + ${interactionExpr}) DESC, r.rating DESC NULLS LAST, r.updated_at DESC, r.id DESC`
              : `${filters.dishQueries?.length ? `${dishMatchExpr} DESC, ${dishEvidenceExpr} DESC, ` : ''}${filters.dishQueriesAny?.length && !filters.dishQueries?.length ? `${dishMatchExpr} DESC, ${weatherNearbyOrder || `${dishEvidenceExpr} DESC, ${nearbyContextOrder}`}${qualityExpr} DESC, ` : ''}${!filters.dishQueriesAny?.length ? hardFoodNearbyOrder : ''}(COALESCE(${relevanceExpr}, 0) + COALESCE(${evidenceExpr}, 0) + ${dishMatchExpr} + ${dishEvidenceExpr} + ${tasteMatchExpr} + ${profileQualityExpr} + ${qualityExpr} + ${distanceScoreExpr} + ${interactionExpr}) DESC, r.rating DESC NULLS LAST, r.updated_at DESC, r.id DESC`;
    const limit = Math.min(filters.limit, 50);
    const limitParam = `${add(limit + 1)}::int`;
    const offsetParam = offset > 0 ? `${add(offset)}::int` : null;
    const queryStartedAt = Date.now();
    let result;
    let cteSql = nearbyCte;
    if (dryMatchCte) cteSql += `${cteSql ? ', ' : 'WITH '}${dryMatchCte}`;
    if (brothyMatchCte) cteSql += `${cteSql ? ', ' : 'WITH '}${brothyMatchCte}`;
    if (dishMatchCte) cteSql += `${cteSql ? ', ' : 'WITH '}${dishMatchCte}`;
    if (weatherMatchCte) cteSql += `${cteSql ? ', ' : 'WITH '}${weatherMatchCte}`;
    try {
      result = await this.database.query<SummaryRow>(
        `${cteSql}SELECT r.id, r.name, l.formatted_address, ST_Y(l.coordinates::geometry) AS latitude, ST_X(l.coordinates::geometry) AS longitude, r.rating, r.review_count, r.price_level, cover.url AS cover_image_url, source.source_url, ${distanceSelect}, ${relevanceSelect}, ${semanticSelect}, ${matchedDishSelect}, ${dishCandidateSelect}, ${dishEvidenceStatusSelect}, r.updated_at,
            COALESCE(json_agg(DISTINCT jsonb_build_object('slug', c.slug, 'name', c.name)) FILTER (WHERE c.id IS NOT NULL), '[]') AS categories
          FROM restaurant r${nearbyJoin}${dryMatchJoin}${brothyMatchJoin}${dishMatchJoin}${weatherMatchJoin} JOIN location l ON l.id = r.location_id LEFT JOIN restaurant_category rc ON rc.restaurant_id = r.id LEFT JOIN category c ON c.id = rc.category_id AND c.is_active = true
          LEFT JOIN LATERAL (SELECT CASE WHEN ri.cached_object_key IS NOT NULL THEN '/api/v1/media/restaurant-images/' || ri.id::text ELSE ri.url END AS url FROM restaurant_image ri WHERE ri.restaurant_id = r.id AND ri.is_cover = true AND ri.status = 'active' ORDER BY (ri.cached_object_key IS NOT NULL) DESC, ri.sort_order, ri.id LIMIT 1) cover ON true
          LEFT JOIN LATERAL (SELECT rs.source_url FROM restaurant_source rs JOIN data_source ds ON ds.id = rs.data_source_id WHERE rs.restaurant_id = r.id AND rs.status = 'active' AND ds.code = 'google_maps_playwright' AND rs.source_url IS NOT NULL ORDER BY rs.last_seen_at DESC, rs.id LIMIT 1) source ON true
          WHERE ${where.join(' AND ')} GROUP BY r.id, l.id, cover.url, source.source_url${dryMatchCte ? ', dry_match.matched_dishes' : ''}${brothyMatchCte ? ', brothy_match.matched_dishes' : ''}${dishMatchCte ? ', dish_match.exact_match, dish_match.candidate_match, dish_match.candidate_score, dish_match.max_confidence, dish_match.match_count, dish_match.matched_dishes' : ''}${weatherMatchCte ? ', weather_match.match_count, weather_match.max_confidence, weather_match.matched_dishes' : ''} ORDER BY ${order} LIMIT ${limitParam}${offsetParam ? ` OFFSET ${offsetParam}` : ''}`,
        values,
      );
    } catch (error) {
      this.logger.error(
        `restaurant list failed after ${Date.now() - queryStartedAt}ms (query=${filters.query && !filters.dishQueries?.length ? 'text' : 'none'}, exactDishes=${filters.dishQueries?.length ?? 0}, alternativeDishes=${filters.dishQueriesAny?.length ?? 0}, radius=${filters.radiusMeters ?? 'none'}, embedding=${Boolean(filters.embedding)})`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
    const queryDurationMs = Date.now() - queryStartedAt;
    if (queryDurationMs >= 3000) {
      this.logger.warn(
        `slow restaurant list ${queryDurationMs}ms (query=${filters.query && !filters.dishQueries?.length ? 'text' : 'none'}, exactDishes=${filters.dishQueries?.length ?? 0}, alternativeDishes=${filters.dishQueriesAny?.length ?? 0}, radius=${filters.radiusMeters ?? 'none'}, embedding=${Boolean(filters.embedding)})`,
      );
    }
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
                AND EXISTS (
                  SELECT 1
                  FROM dish_evidence target_de
                  JOIN menu_image_extraction target_mie
                    ON target_mie.restaurant_image_id = target_de.restaurant_image_id
                  WHERE target_de.dish_id = d.id
                    AND target_de.evidence_type = 'menu_image'
                    AND target_mie.status = 'completed'
                    AND target_mie.model IN ('website:menu:v1', 'website:menu-image-curated:v1', 'google_maps:menu-curated:v1')
                    AND COALESCE(target_mie.raw_ocr_text, '') NOT ILIKE 'food_photo:%'
                )
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
                    AND EXISTS (
                      SELECT 1
                      FROM dish_evidence similar_de
                      JOIN menu_image_extraction similar_mie
                        ON similar_mie.restaurant_image_id = similar_de.restaurant_image_id
                      WHERE similar_de.dish_id = candidate_dish.id
                        AND similar_de.evidence_type = 'menu_image'
                        AND similar_mie.status = 'completed'
                        AND similar_mie.model IN ('website:menu:v1', 'website:menu-image-curated:v1', 'google_maps:menu-curated:v1')
                        AND COALESCE(similar_mie.raw_ocr_text, '') NOT ILIKE 'food_photo:%'
                    )
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
            LEFT JOIN LATERAL (SELECT CASE WHEN ri.cached_object_key IS NOT NULL THEN '/api/v1/media/restaurant-images/' || ri.id::text ELSE ri.url END AS url FROM restaurant_image ri WHERE ri.restaurant_id = r.id AND ri.is_cover = true AND ri.status = 'active' ORDER BY (ri.cached_object_key IS NOT NULL) DESC, ri.sort_order, ri.id LIMIT 1) cover ON true
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
            LEFT JOIN LATERAL (SELECT CASE WHEN ri.cached_object_key IS NOT NULL THEN '/api/v1/media/restaurant-images/' || ri.id::text ELSE ri.url END AS url FROM restaurant_image ri WHERE ri.restaurant_id = r.id AND ri.is_cover = true AND ri.status = 'active' ORDER BY (ri.cached_object_key IS NOT NULL) DESC, ri.sort_order, ri.id LIMIT 1) cover ON true
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
        `SELECT id, name, description, price_amount, currency_code, is_popular
           FROM dish
          WHERE restaurant_id = $1
            AND status = 'available'
            AND EXISTS (
              SELECT 1
              FROM dish_evidence detail_de
              JOIN menu_image_extraction detail_mie
                ON detail_mie.restaurant_image_id = detail_de.restaurant_image_id
              WHERE detail_de.dish_id = dish.id
                AND detail_de.evidence_type = 'menu_image'
                AND detail_mie.status = 'completed'
                AND detail_mie.model IN ('website:menu:v1', 'website:menu-image-curated:v1', 'google_maps:menu-curated:v1')
                AND COALESCE(detail_mie.raw_ocr_text, '') NOT ILIKE 'food_photo:%'
            )
          ORDER BY is_popular DESC, name`,
        [id],
      ),
      this.database.query<RestaurantImage>(
        'SELECT id, CASE WHEN cached_object_key IS NOT NULL THEN \'/api/v1/media/restaurant-images/\' || id::text ELSE url END AS url, alt_text AS "altText", is_cover AS "isCover", sort_order AS "sortOrder" FROM restaurant_image WHERE restaurant_id = $1 AND status = \'active\' ORDER BY (cached_object_key IS NOT NULL) DESC, sort_order, id',
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
      ...(row.matched_dishes?.length
        ? { matchedDishes: row.matched_dishes.map(formatDishDisplayName) }
        : {}),
      ...(row.dish_candidate ? { dishCandidate: true } : {}),
      ...(row.dish_evidence_status ? { dishEvidenceStatus: row.dish_evidence_status } : {}),
      ...(row.distance_meters !== null
        ? { distanceMeters: numberOrNull(row.distance_meters) }
        : {}),
    };
  }
}

// Some first-party menu pages expose a product slug instead of a human dish
// label. Keep the stored identity/evidence untouched, but make the public
// recommendation understandable. Non-slug labels (including OCR labels with
// accents) pass through unchanged.
const DISH_DISPLAY_TOKENS: Record<string, string> = {
  banh: 'bánh',
  bo: 'bò',
  bun: 'bún',
  ca: 'cá',
  cali: 'Cali',
  canh: 'canh',
  com: 'cơm',
  cot: 'cốt',
  cua: 'cua',
  ga: 'gà',
  gio: 'giò',
  heo: 'heo',
  hu: 'hủ',
  lau: 'lẩu',
  mi: 'mì',
  mam: 'mắm',
  roi: 'rọi',
  ngon: 'ngon',
  nuoc: 'nước',
  nuong: 'nướng',
  pho: 'phở',
  rieu: 'riêu',
  suon: 'sườn',
  tam: 'tấm',
  tom: 'tôm',
  trung: 'trứng',
  xao: 'xào',
  let: 'lết',
};

function formatDishDisplayName(value: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(value)) return value;
  const words = value
    .split('-')
    .map((word) => DISH_DISPLAY_TOKENS[word.toLocaleLowerCase('vi-VN')] ?? word);
  if (!words.length) return value;
  words[0] = `${words[0].charAt(0).toLocaleUpperCase('vi-VN')}${words[0].slice(1)}`;
  return words.join(' ');
}

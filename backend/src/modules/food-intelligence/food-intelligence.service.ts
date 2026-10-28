import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

interface DishRow { id: string; canonical_dish_id: string | null; name: string; normalized_name: string; price_amount: string | null; evidence_count: string; }
interface OpinionRow { dish_name: string | null; dish_id: string | null; canonical_dish_id: string | null; aspect: string; sentiment: number; count: string; }
interface ReviewRow { id: string; restaurant_id: string; content: string | null; language_code: string | null; }

type ExtractedOpinion = { dishId: string | null; canonicalDishId: string | null; aspect: string; sentiment: -1 | 0 | 1; mention: string; confidence: number };

const OPINION_ASPECTS: Array<{ aspect: string; terms: string[] }> = [
  { aspect: 'flavor', terms: ['ngon', 'dở', 'do', 'đậm đà', 'dam da', 'nhạt', 'nhat', 'thơm', 'thom', 'cay', 'béo', 'beo', 'ngọt', 'ngot', 'mặn', 'man'] },
  { aspect: 'texture', terms: ['giòn', 'gion', 'mềm', 'mem', 'dai', 'cứng', 'cung', 'mịn', 'min'] },
  { aspect: 'portion', terms: ['nhiều', 'nhieu', 'ít', 'it', 'đầy đặn', 'day dan'] },
  { aspect: 'value', terms: ['đáng tiền', 'dang tien', 'rẻ', 're', 'đắt', 'dat', 'giá cao', 'gia cao'] },
  { aspect: 'service', terms: ['phục vụ', 'phuc vu', 'nhanh', 'chậm', 'cham', 'thân thiện', 'than thien', 'tệ', 'te'] },
];
const POSITIVE_TERMS = ['ngon', 'tuyệt', 'tuyet', 'thích', 'thich', 'đậm đà', 'dam da', 'thơm', 'thom', 'giòn', 'gion', 'mềm', 'mem', 'đáng tiền', 'dang tien', 'rẻ', 're', 'siu re', 'nhiều', 'nhieu', 'nhanh', 'thân thiện', 'than thien'];
const NEGATIVE_TERMS = ['dở', 'do', 'tệ', 'te', 'nhạt', 'nhat', 'cứng', 'cung', 'ít', 'it', 'đắt', 'dat', 'giá cao', 'gia cao', 'chậm', 'cham'];

function normalizeForMatch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function containsTerm(text: string, term: string): boolean {
  return ` ${normalizeForMatch(text)} `.includes(` ${normalizeForMatch(term)} `);
}
function sentimentFor(text: string): -1 | 0 | 1 {
  const positive = POSITIVE_TERMS.filter((term) => containsTerm(text, term)).length;
  const negative = NEGATIVE_TERMS.filter((term) => containsTerm(text, term)).length;
  if (positive === negative) return 0;
  return positive > negative ? 1 : -1;
}

@Injectable()
export class FoodIntelligenceService {
  constructor(private readonly database: DatabaseService) {}

  async extractReviewOpinions(reviewId: string): Promise<{ reviewId: string; inserted: number; opinions: ExtractedOpinion[] }> {
    const reviewResult = await this.database.query<ReviewRow>(
      `SELECT id, restaurant_id, content, language_code FROM review WHERE id = $1 AND is_visible = true`, [reviewId]);
    const review = reviewResult.rows[0];
    if (!review?.content?.trim()) return { reviewId, inserted: 0, opinions: [] };

    const dishesResult = await this.database.query<{ id: string; name: string; normalized_name: string; canonical_dish_id: string | null }>(
      `SELECT id, name, normalized_name, canonical_dish_id FROM dish WHERE restaurant_id = $1 AND status = 'available' ORDER BY length(name) DESC, id`, [review.restaurant_id]);
    const opinions: ExtractedOpinion[] = [];
    const sentences = review.content.split(/(?<=[.!?。！？])\s+|[\n;]+/).map((s) => s.trim()).filter(Boolean);
    for (const sentence of sentences) {
      const dish = dishesResult.rows.find((candidate) => containsTerm(sentence, candidate.name));
      if (!dish) continue;
      const matchedAspects = OPINION_ASPECTS.filter(({ terms }) => terms.some((term) => containsTerm(sentence, term)));
      if (!matchedAspects.length) continue;
      const sentiment = sentimentFor(sentence);
      for (const { aspect } of matchedAspects) opinions.push({
        dishId: dish.id, canonicalDishId: dish.canonical_dish_id, aspect, sentiment,
        mention: sentence.slice(0, 500),
        confidence: Math.min(0.99, 0.72 + (dish.canonical_dish_id ? 0.08 : 0) + (sentiment !== 0 ? 0.08 : 0) + (sentence.length < 240 ? 0.05 : 0)),
      });
    }
    const unique = opinions.filter((opinion, index, all) => all.findIndex((candidate) =>
      candidate.dishId === opinion.dishId && candidate.aspect === opinion.aspect && candidate.sentiment === opinion.sentiment && candidate.mention === opinion.mention) === index);
    for (const opinion of unique) {
      await this.database.query(
        `INSERT INTO review_opinion (review_id, dish_id, canonical_dish_id, aspect, sentiment, mention, confidence, extraction_method, model_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'deterministic_lexicon_v1', 'food-opinion-1')
         ON CONFLICT (review_id, dish_id, aspect, sentiment, mention) DO UPDATE SET
           confidence = GREATEST(review_opinion.confidence, EXCLUDED.confidence), canonical_dish_id = EXCLUDED.canonical_dish_id,
           extraction_method = EXCLUDED.extraction_method, model_version = EXCLUDED.model_version`,
        [review.id, opinion.dishId, opinion.canonicalDishId, opinion.aspect, opinion.sentiment, opinion.mention, opinion.confidence]);
    }
    return { reviewId, inserted: unique.length, opinions: unique };
  }

  async extractPendingReviewOpinions(options: { limit?: number } = {}): Promise<{ scanned: number; extracted: number; opinions: number; failed: number }> {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 1000);
    const result = await this.database.query<{ id: string }>(
      `SELECT rv.id
       FROM review rv
       WHERE rv.is_visible = true
         AND rv.content IS NOT NULL
         AND length(trim(rv.content)) > 0
         AND NOT EXISTS (SELECT 1 FROM review_opinion ro WHERE ro.review_id = rv.id)
       ORDER BY rv.reviewed_at DESC NULLS LAST, rv.id DESC
       LIMIT $1`, [limit]);
    let extracted = 0;
    let opinions = 0;
    let failed = 0;
    for (const row of result.rows) {
      try {
        const extraction = await this.extractReviewOpinions(row.id);
        extracted += 1;
        opinions += extraction.inserted;
      } catch {
        failed += 1;
      }
    }
    return { scanned: result.rows.length, extracted, opinions, failed };
  }

  async rebuildRestaurantProfile(restaurantId: string): Promise<{ version: number; profile: object }> {
    await this.database.query('SELECT mark_food_profile_stale($1)', [restaurantId]);
    const dishes = await this.database.query<DishRow>(
      `SELECT d.id, d.canonical_dish_id, d.name, d.normalized_name, d.price_amount,
              count(DISTINCT de.id) FILTER (WHERE mie.id IS NOT NULL)::text AS evidence_count
       FROM dish d
       LEFT JOIN dish_evidence de ON de.dish_id = d.id
       LEFT JOIN menu_image_extraction mie ON mie.restaurant_image_id = de.restaurant_image_id
         AND mie.status = 'completed'
         AND mie.model IN ('website:menu:v1', 'website:menu-image-curated:v1', 'google_maps:menu-curated:v1')
       WHERE d.restaurant_id = $1 AND d.status = 'available'
         AND EXISTS (
           SELECT 1
           FROM dish_evidence trusted_de
           JOIN menu_image_extraction trusted_mie ON trusted_mie.restaurant_image_id = trusted_de.restaurant_image_id
           WHERE trusted_de.dish_id = d.id
             AND trusted_de.evidence_type = 'menu_image'
             AND trusted_mie.status = 'completed'
             AND trusted_mie.model IN ('website:menu:v1', 'website:menu-image-curated:v1', 'google_maps:menu-curated:v1')
         )
       GROUP BY d.id
       ORDER BY d.is_popular DESC, count(DISTINCT de.id) DESC, d.name
       LIMIT 100`, [restaurantId]);
    const opinions = await this.database.query<OpinionRow>(
      `SELECT d.name AS dish_name, ro.dish_id, ro.canonical_dish_id, ro.aspect, ro.sentiment, count(*)::text AS count
       FROM review_opinion ro
       JOIN review rv ON rv.id = ro.review_id
       LEFT JOIN dish d ON d.id = ro.dish_id
       WHERE rv.restaurant_id = $1 AND ro.confidence >= 0.5
       GROUP BY d.name, ro.dish_id, ro.canonical_dish_id, ro.aspect, ro.sentiment
       ORDER BY count(*) DESC LIMIT 30`, [restaurantId]);
    const menuEvidence = await this.database.query<{ count: string }>(
      `SELECT count(DISTINCT de.id)::text AS count
         FROM dish_evidence de
         JOIN dish d ON d.id = de.dish_id
         JOIN menu_image_extraction mie ON mie.restaurant_image_id = de.restaurant_image_id
        WHERE d.restaurant_id = $1
          AND de.evidence_type = 'menu_image'
          AND mie.status = 'completed'
          AND mie.model IN ('website:menu:v1', 'website:menu-image-curated:v1', 'google_maps:menu-curated:v1')`, [restaurantId]);
    const aggregatedOpinions = opinions.rows.reduce((acc, row) => {
      const key = `${row.dish_id ?? row.canonical_dish_id ?? row.dish_name ?? 'unknown'}:${row.aspect}`;
      const current = acc.get(key) ?? { dish: row.dish_name, dishId: row.dish_id, canonicalDishId: row.canonical_dish_id, aspect: row.aspect, positive: 0, negative: 0, neutral: 0, total: 0 };
      const count = Number(row.count);
      current.total += count;
      if (row.sentiment > 0) current.positive += count;
      else if (row.sentiment < 0) current.negative += count;
      else current.neutral += count;
      acc.set(key, current);
      return acc;
    }, new Map<string, { dish: string | null; dishId: string | null; canonicalDishId: string | null; aspect: string; positive: number; negative: number; neutral: number; total: number }>());
    const profile = {
      signatureDishes: dishes.rows.slice(0, 12).map((d) => ({ name: d.name, price: d.price_amount, evidenceCount: Number(d.evidence_count) })),
      dishes: dishes.rows.map((d) => ({ name: d.name, canonicalId: d.canonical_dish_id, evidenceCount: Number(d.evidence_count) })),
      opinions: opinions.rows.map((o) => ({ dish: o.dish_name, dishId: o.dish_id, canonicalDishId: o.canonical_dish_id, aspect: o.aspect, sentiment: o.sentiment, count: Number(o.count) })),
      aggregateOpinionSignals: [...aggregatedOpinions.values()].map((o) => ({
        dish: o.dish, dishId: o.dishId, canonicalDishId: o.canonicalDishId, aspect: o.aspect,
        positive: o.positive, negative: o.negative, neutral: o.neutral, total: o.total,
        netSentiment: o.total ? Number(((o.positive - o.negative) / o.total).toFixed(3)) : 0,
      })).sort((a, b) => b.total - a.total),
      generatedFrom: {
        dishCount: dishes.rows.length,
        menuEvidenceCount: Number(menuEvidence.rows[0]?.count ?? 0),
        opinionCount: opinions.rows.reduce((sum, row) => sum + Number(row.count), 0),
      },
    };
    const semanticText = this.buildSemanticText(restaurantId, profile);
    const coverage = dishes.rows.length ? Math.min(1, Number(menuEvidence.rows[0]?.count ?? 0) / dishes.rows.length) : 0;
    const result = await this.database.query<{ version: number }>(
      `INSERT INTO restaurant_food_profile (restaurant_id, version, status, profile, evidence_coverage, semantic_text, built_at, invalidated_at)
       VALUES ($1, 1, 'ready', $2::jsonb, $3, $4, now(), now())
       ON CONFLICT (restaurant_id) DO UPDATE SET
         version = restaurant_food_profile.version + 1, status = 'ready', profile = EXCLUDED.profile,
         evidence_coverage = EXCLUDED.evidence_coverage, semantic_text = EXCLUDED.semantic_text,
         semantic_model = NULL, semantic_updated_at = NULL, built_at = now(), updated_at = now()
       RETURNING version`, [restaurantId, JSON.stringify(profile), coverage, semanticText]);
    return { version: result.rows[0].version, profile: { ...profile, semanticText } };
  }

  private buildSemanticText(restaurantId: string, profile: object): string {
    const value = profile as {
      signatureDishes?: Array<{ name: string }>;
      aggregateOpinionSignals?: Array<{
        dish: string | null;
        aspect: string;
        total: number;
        netSentiment: number;
      }>;
    };
    const dishes = (value.signatureDishes ?? []).map((dish) => dish.name).filter(Boolean).slice(0, 12);
    const signals = (value.aggregateOpinionSignals ?? [])
      .filter((signal) => signal.total > 0)
      .slice(0, 20)
      .map((signal) => `${signal.dish ?? 'món'} ${signal.aspect} ${signal.netSentiment >= 0.25 ? 'được khen' : signal.netSentiment <= -0.25 ? 'bị chê' : 'ý kiến trái chiều'}`);
    return [
      dishes.length ? `signature dishes: ${dishes.join(', ')}` : '',
      signals.length ? `review signals: ${signals.join('; ')}` : '',
      'Food profile generated from persisted menu evidence and review opinions.',
    ].filter(Boolean).join('. ').slice(0, 4000);
  }

  async getRestaurantProfile(restaurantId: string) {
    const result = await this.database.query<{ version: number; status: string; profile: object; evidence_coverage: string; built_at: Date | null }>(
      `SELECT version, status, profile, evidence_coverage, built_at FROM restaurant_food_profile WHERE restaurant_id = $1`, [restaurantId]);
    return result.rows[0] ?? null;
  }
}

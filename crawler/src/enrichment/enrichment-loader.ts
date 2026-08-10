// One-shot enrichment loader.
//
// Applies the deterministic category classifier and dish extractor to canonical
// restaurants (docs/05 Stage 6). It is idempotent: categories and dishes are
// only written when the restaurant has none yet, so it never overrides
// crawler/fixture-observed facts. Derived rows carry `source` + `confidence`.
//
// The run is recorded in `enrichment_log`; a dry run computes counts without
// writing anything.

import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { CATEGORY_MIN_CONFIDENCE, classifyCategory } from './category-classifier';
import { extractDishesFromText } from './dish-extractor';
import { classifyAttributes } from './attribute-classifier';

const CATEGORY_SOURCE = 'enrichment:category:rules:v1';
const DISH_SOURCE = 'enrichment:dish:lexicon:v1';
const ATTRIBUTE_SOURCE = 'enrichment:attribute:rules:v1';

export interface EnrichmentSummary {
  scanned: number;
  categoriesApplied: number;
  dishesApplied: number;
  attributesApplied: number;
}

export interface EnrichOptions {
  limit?: number;
  dryRun?: boolean;
}

export class EnrichmentLoader {
  private readonly pool: Pool;

  constructor(connectionString?: string) {
    this.pool = new Pool({
      connectionString: connectionString || process.env.DATABASE_URL,
      host: process.env.PGHOST ?? 'localhost',
      port: Number(process.env.PGPORT ?? 5432),
      database: process.env.PGDATABASE ?? 'food_app',
      user: process.env.PGUSER ?? 'food_app',
      password: process.env.PGPASSWORD ?? 'change-me-locally',
      max: 5,
      connectionTimeoutMillis: 3000,
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async enrich({ limit = 0, dryRun = false }: EnrichOptions = {}): Promise<EnrichmentSummary> {
    const summary: EnrichmentSummary = {
      scanned: 0,
      categoriesApplied: 0,
      dishesApplied: 0,
      attributesApplied: 0,
    };

    const logId = dryRun
      ? null
      : await this.pool
          .query(
            `INSERT INTO enrichment_log (run_type, model, params)
             VALUES ($1, $2, $3) RETURNING id`,
            [
              'category+dish+attribute',
              'category:rules:v1;dish:lexicon:v1;attribute:rules:v1',
              { limit, dryRun },
            ],
          )
          .then((result) => result.rows[0].id as number);

    try {
      summary.categoriesApplied = await this.applyCategories(limit, summary, dryRun);
      summary.dishesApplied = await this.applyDishes(limit, summary, dryRun);
      summary.attributesApplied = await this.applyAttributes(dryRun);

      if (logId !== null) {
        await this.pool.query(
          `UPDATE enrichment_log
             SET status = 'completed', finished_at = now(),
                 restaurants_scanned = $2, categories_applied = $3, dishes_applied = $4,
                 attributes_applied = $5
           WHERE id = $1`,
          [
            logId,
            summary.scanned,
            summary.categoriesApplied,
            summary.dishesApplied,
            summary.attributesApplied,
          ],
        );
      }
    } catch (error) {
      if (logId !== null) {
        await this.pool
          .query(
            `UPDATE enrichment_log
               SET status = 'failed', finished_at = now(), failure_message = $2
             WHERE id = $1`,
            [logId, error instanceof Error ? error.message : String(error)],
          )
          .catch(() => undefined);
      }
      throw error;
    }

    return summary;
  }

  private async applyCategories(
    limit: number,
    summary: EnrichmentSummary,
    dryRun: boolean,
  ): Promise<number> {
    const params: string[] = [];
    let sql = `
      SELECT r.id, r.name, r.normalized_name
      FROM restaurant r
      WHERE r.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM restaurant_category rc WHERE rc.restaurant_id = r.id)`;
    if (limit > 0) {
      params.push(String(limit));
      sql += ` LIMIT $${params.length}`;
    }
    const { rows } = await this.pool.query<{ id: string; name: string; normalized_name: string }>(
      sql,
      params,
    );

    let applied = 0;
    const values: string[] = [];
    const valueParams: unknown[] = [];
    let valueIndex = 1;
    for (const row of rows) {
      summary.scanned += 1;
      const suggestion = classifyCategory(row.normalized_name || row.name);
      if (!suggestion || suggestion.confidence < CATEGORY_MIN_CONFIDENCE) continue;
      valueParams.push(row.id, suggestion.slug, CATEGORY_SOURCE, suggestion.confidence);
      values.push(
        `($${valueIndex}::uuid, $${valueIndex + 1}, $${valueIndex + 2}, $${valueIndex + 3}::numeric)`,
      );
      valueIndex += 4;
      applied += 1;
    }

    if (!dryRun && values.length > 0) {
      await this.pool.query(
        `INSERT INTO restaurant_category (restaurant_id, category_id, source, confidence, updated_at)
         SELECT v.restaurant_id, c.id, v.source, v.confidence, now()
         FROM (VALUES ${values.join(', ')})
              AS v(restaurant_id, category_slug, source, confidence)
         JOIN category c ON c.slug = v.category_slug AND c.is_active = true
         ON CONFLICT (restaurant_id, category_id) DO NOTHING`,
        valueParams,
      );
    }

    return applied;
  }

  private async applyDishes(
    limit: number,
    summary: EnrichmentSummary,
    dryRun: boolean,
  ): Promise<number> {
    const params: string[] = [];
    let sql = `
      SELECT r.id, r.name
      FROM restaurant r
      WHERE r.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM dish d WHERE d.restaurant_id = r.id)`;
    if (limit > 0) {
      params.push(String(limit));
      sql += ` LIMIT $${params.length}`;
    }
    const { rows } = await this.pool.query<{ id: string; name: string }>(sql, params);
    if (rows.length === 0) return 0;

    const { rows: reviewRows } = await this.pool.query<{
      restaurant_id: string;
      content: string;
    }>(
      `SELECT restaurant_id, content
       FROM review
       WHERE content IS NOT NULL
         AND (is_visible IS TRUE OR is_visible IS NULL)
         AND restaurant_id = ANY($1)`,
      [rows.map((row) => row.id)],
    );

    const reviewsByRestaurant = new Map<string, string[]>();
    for (const review of reviewRows) {
      const list = reviewsByRestaurant.get(review.restaurant_id) ?? [];
      list.push(review.content);
      reviewsByRestaurant.set(review.restaurant_id, list);
    }

    const values: string[] = [];
    const valueParams: unknown[] = [];
    let valueIndex = 1;
    let applied = 0;
    for (const row of rows) {
      summary.scanned += 1;
      const suggestions = extractDishesFromText(
        row.id,
        row.name,
        reviewsByRestaurant.get(row.id) ?? [],
      );
      for (const dish of suggestions) {
        valueParams.push(
          randomUUID(),
          row.id,
          dish.display,
          dish.normalized,
          DISH_SOURCE,
          dish.confidence,
        );
        values.push(
          `($${valueIndex}::uuid, $${valueIndex + 1}::uuid, $${valueIndex + 2}, $${valueIndex + 3}, $${valueIndex + 4}, $${valueIndex + 5}::numeric)`,
        );
        valueIndex += 6;
        applied += 1;
      }
    }

    if (!dryRun && values.length > 0) {
      await this.pool.query(
        `INSERT INTO dish (id, restaurant_id, name, normalized_name, price_amount,
                           currency_code, is_popular, status, source, confidence)
         SELECT v.id, v.restaurant_id, v.name, v.normalized_name, NULL, NULL, false,
                'available', v.source, v.confidence
         FROM (VALUES ${values.join(', ')})
              AS v(id, restaurant_id, name, normalized_name, source, confidence)
         WHERE NOT EXISTS (
           SELECT 1 FROM dish d WHERE d.restaurant_id = v.restaurant_id
             AND d.normalized_name = v.normalized_name
         )`,
        valueParams,
      );
    }

    return applied;
  }

  // Links known dishes to their food attributes (khẩu vị, nguyên liệu, cách ăn,
  // cảm giác) from the curated attribute classifier. Runs over every available
  // dish, not just the ones inserted in this run, so previously enriched data is
  // updated if the taxonomy grows. Idempotent via ON CONFLICT DO NOTHING.
  private async applyAttributes(dryRun: boolean): Promise<number> {
    const { rows } = await this.pool.query<{ id: string; normalized_name: string }>(
      `SELECT id, normalized_name
       FROM dish
       WHERE status = 'available'
         AND normalized_name IS NOT NULL
         AND length(trim(normalized_name)) > 0`,
    );

    const values: string[] = [];
    const valueParams: unknown[] = [];
    let valueIndex = 1;
    for (const row of rows) {
      const suggestions = classifyAttributes(row.normalized_name);
      for (const suggestion of suggestions) {
        valueParams.push(row.id, suggestion.code, ATTRIBUTE_SOURCE, suggestion.confidence);
        values.push(
          `($${valueIndex}::uuid, $${valueIndex + 1}, $${valueIndex + 2}, $${valueIndex + 3}::numeric)`,
        );
        valueIndex += 4;
      }
    }

    if (!dryRun && values.length > 0) {
      await this.pool.query(
        `INSERT INTO dish_attribute (dish_id, attribute_id, source, confidence)
         SELECT v.dish_id, fa.id, v.source, v.confidence
         FROM (VALUES ${values.join(', ')})
              AS v(dish_id, attribute_code, source, confidence)
         JOIN food_attribute fa ON fa.code = v.attribute_code AND fa.is_active = true
         ON CONFLICT (dish_id, attribute_id) DO NOTHING`,
        valueParams,
      );
    }

    return values.length;
  }
}

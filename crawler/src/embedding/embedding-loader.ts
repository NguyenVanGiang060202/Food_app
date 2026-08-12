// One-shot embedding loader for Stage 7 (docs/05 section 11).
//
// Generates vector embeddings from deterministic search documents and upserts
// them into `restaurant_embedding`. Derived data only: embedding generation
// never mutates canonical records. `scanned` counts evaluated eligible
// restaurants; `embedded` + `refreshed` counts vectors written (or, for a dry
// run, vectors that would be written).
//
// A `refresh` run also re-embeds restaurants whose search content changed; the
// default backfill only embeds restaurants that have no vector for the active
// embedding model yet. Old vectors for the same (restaurant, model) are removed
// so at most one active embedding exists per restaurant and model version.
//
// The run is recorded in `enrichment_log` with `run_type = 'embedding'`.

import { Pool } from 'pg';
import {
  buildSearchDocument,
  contentHash,
  EMBEDDING_TEMPLATE_VERSION,
  embeddingModelId,
  RestaurantEmbeddingSource,
} from './search-document';
import { EmbeddingProvider, OpenAICompatibleEmbeddingProvider } from './embedding-provider';

export interface EmbeddingSummary {
  scanned: number;
  embedded: number;
  refreshed: number;
  skipped: number;
}

export interface EmbedOptions {
  limit?: number;
  dryRun?: boolean;
  refresh?: boolean;
}

export interface EmbeddingTarget {
  restaurantId: string;
  document: string;
  documentHash: string;
  hasExisting: boolean;
}

export interface EmbeddingCandidateRow {
  restaurantId: string;
  source: RestaurantEmbeddingSource;
  existingHash: string | null;
}

export function selectEmbeddingTargets(
  candidates: EmbeddingCandidateRow[],
  options: { refresh: boolean },
): EmbeddingTarget[] {
  const targets: EmbeddingTarget[] = [];
  for (const row of candidates) {
    const document = buildSearchDocument(row.source);
    const documentHash = contentHash(document);
    const isRefresh = options.refresh && row.existingHash !== documentHash;
    if (row.existingHash === null || isRefresh) {
      targets.push({
        restaurantId: row.restaurantId,
        document,
        documentHash,
        hasExisting: row.existingHash !== null,
      });
    }
  }
  return targets;
}

interface EmbeddingRow {
  id: string;
  name: string;
  normalized_name: string;
  price_level: number | null;
  semantic_profile: string | null;
  district: string | null;
  city: string | null;
  categories: string[] | null;
  dishes: string[] | null;
  existing_hash: string | null;
}

export class EmbeddingLoader {
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

  async embed({
    limit = 0,
    dryRun = false,
    refresh = false,
  }: EmbedOptions = {}): Promise<EmbeddingSummary> {
    const providerModel = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small';
    const model = embeddingModelId(providerModel);

    let provider: EmbeddingProvider | null = null;
    if (!dryRun) {
      const apiKey = process.env.EMBEDDING_API_KEY;
      if (!apiKey) {
        throw new Error('EMBEDDING_API_KEY is required for a real embedding run.');
      }
      provider = new OpenAICompatibleEmbeddingProvider({
        baseUrl: process.env.EMBEDDING_BASE_URL ?? 'https://api.openai.com/v1',
        apiKey,
        model: providerModel,
        dimensions: process.env.EMBEDDING_DIMENSIONS
          ? Number(process.env.EMBEDDING_DIMENSIONS)
          : undefined,
      });
    }

    const logId = dryRun
      ? null
      : await this.pool
          .query(
            `INSERT INTO enrichment_log (run_type, model, params)
             VALUES ('embedding', $1, $2) RETURNING id`,
            [
              model,
              {
                providerModel,
                template: `search-document:${EMBEDDING_TEMPLATE_VERSION}`,
                refresh,
                limit,
              },
            ],
          )
          .then((result) => result.rows[0].id as number);

    const summary: EmbeddingSummary = {
      scanned: 0,
      embedded: 0,
      refreshed: 0,
      skipped: 0,
    };

    try {
      const { rows } = await this.pool.query<EmbeddingRow>(
        `SELECT r.id,
                r.name,
                r.normalized_name,
                r.price_level,
                r.semantic_profile,
                loc.district,
                loc.city,
                COALESCE(
                  (SELECT jsonb_agg(DISTINCT c.name)
                     FROM restaurant_category rc
                     JOIN category c ON c.id = rc.category_id
                    WHERE rc.restaurant_id = r.id), '[]'::jsonb
                ) AS categories,
                COALESCE(
                  (SELECT jsonb_agg(DISTINCT d.normalized_name)
                     FROM dish d
                    WHERE d.restaurant_id = r.id), '[]'::jsonb
                ) AS dishes,
                (SELECT e.content_hash
                   FROM restaurant_embedding e
                  WHERE e.restaurant_id = r.id
                    AND e.model = $1
                  ORDER BY e.created_at DESC, e.id DESC
                  LIMIT 1) AS existing_hash
         FROM restaurant r
         JOIN location loc ON loc.id = r.location_id
        WHERE r.status IN ('active', 'temporarily_closed')
        ORDER BY r.id`,
        [model],
      );
      summary.scanned = rows.length;

      const candidates: EmbeddingCandidateRow[] = rows.map((row) => ({
        restaurantId: row.id,
        source: {
          name: row.name,
          normalizedName: row.normalized_name,
          priceLevel: row.price_level,
          district: row.district,
          city: row.city,
          categories: row.categories ?? [],
          dishes: row.dishes ?? [],
          profile: row.semantic_profile ?? null,
        },
        existingHash: row.existing_hash,
      }));

      const targets = selectEmbeddingTargets(candidates, { refresh });
      const bounded = limit > 0 && targets.length > limit ? targets.slice(0, limit) : targets;

      if (!dryRun && provider !== null) {
        await Promise.all(
          bounded.map(async (target) => {
            const vector = await provider.generateEmbedding(target.document);
            await this.upsertEmbedding(target.restaurantId, model, target.documentHash, vector);
            if (target.hasExisting) {
              summary.refreshed += 1;
            } else {
              summary.embedded += 1;
            }
          }),
        );
      } else {
        for (const target of bounded) {
          if (target.hasExisting) {
            summary.refreshed += 1;
          } else {
            summary.embedded += 1;
          }
        }
      }
      summary.skipped = rows.length - bounded.length;

      if (logId !== null) {
        await this.pool.query(
          `UPDATE enrichment_log
             SET status = 'completed', finished_at = now(),
                 restaurants_scanned = $2, embeddings_applied = $3
           WHERE id = $1`,
          [logId, summary.scanned, summary.embedded + summary.refreshed],
        );
      }
    } catch (error) {
      if (logId !== null) {
        await this.pool.query(
          `UPDATE enrichment_log
             SET status = 'failed', finished_at = now(),
                 failure_message = $2
           WHERE id = $1`,
          [logId, String(error)],
        );
      }
      throw error;
    }

    return summary;
  }

  private async upsertEmbedding(
    restaurantId: string,
    model: string,
    documentHash: string,
    vector: number[],
  ): Promise<void> {
    const literal = `[${vector.map((value) => value.toFixed(8)).join(',')}]`;
    await this.pool.query(
      `DELETE FROM restaurant_embedding
        WHERE restaurant_id = $1 AND model = $2`,
      [restaurantId, model],
    );
    await this.pool.query(
      `INSERT INTO restaurant_embedding (restaurant_id, embedding, model, content_hash)
       VALUES ($1, $2::vector, $3, $4)`,
      [restaurantId, literal, model, documentHash],
    );
  }
}

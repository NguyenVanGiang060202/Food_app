// Runtime query embedding for semantic (pgvector) restaurant search.
//
// The crawler builds offline embeddings for every restaurant and stores them in
// `restaurant_embedding` (model name encodes the document template, e.g.
// `bge-m3@doc:v3`). At request time this service embeds the user's semantic
// query with the same OpenAI-compatible `/embeddings` protocol and resolves the
// active model from the database so the backend never hard-codes the document
// version. When the provider is not configured or fails, `isEnabled()` /
// `activeModel()` make the whole semantic path opt-out, so search falls back to
// the keyword/structured pipeline.

import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

const ACTIVE_MODEL_CACHE_TTL_MS = 60_000;

@Injectable()
export class EmbeddingService {
  private readonly baseUrl: string | null;
  private readonly apiKey: string | null;
  private readonly model: string | null;
  private readonly dimensions: number | null;
  private readonly timeoutMs: number;
  private activeModelCache: { expiresAt: number; model: string | null } | null = null;

  constructor(private readonly database: DatabaseService) {
    this.baseUrl = process.env.EMBEDDING_BASE_URL
      ? process.env.EMBEDDING_BASE_URL.replace(/\/+$/, '')
      : null;
    this.apiKey = process.env.EMBEDDING_API_KEY ?? null;
    this.model = process.env.EMBEDDING_MODEL ?? null;
    this.dimensions = process.env.EMBEDDING_DIMENSIONS
      ? Number(process.env.EMBEDDING_DIMENSIONS)
      : null;
    this.timeoutMs = Number(process.env.EMBEDDING_TIMEOUT_MS ?? 15_000);
  }

  isEnabled(): boolean {
    return this.baseUrl !== null && this.apiKey !== null && this.model !== null;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.baseUrl || !this.apiKey || !this.model) {
      throw new Error('Embedding provider is not configured.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: text,
          encoding_format: 'float',
          ...(this.dimensions !== null ? { dimensions: this.dimensions } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`embedding provider ${response.status}: ${body.slice(0, 500)}`);
      }
      const payload = (await response.json()) as {
        data?: Array<{ embedding?: number[] }>;
      };
      const vector = payload.data?.[0]?.embedding;
      if (!Array.isArray(vector)) {
        throw new Error('embedding provider response is missing embedding data.');
      }
      if (this.dimensions !== null && vector.length !== this.dimensions) {
        throw new Error(
          `embedding dimension mismatch: expected ${this.dimensions}, got ${vector.length}.`,
        );
      }
      return vector;
    } finally {
      clearTimeout(timer);
    }
  }

  // Returns the most recently embedded model (e.g. "bge-m3@doc:v3") so the
  // search query filters `restaurant_embedding` by exactly the vectors that
  // exist, decoupling the backend from the crawler's document version.
  async activeModel(): Promise<string | null> {
    const now = Date.now();
    if (this.activeModelCache && this.activeModelCache.expiresAt > now) {
      return this.activeModelCache.model;
    }
    let model: string | null = null;
    try {
      const result = await this.database.query<{ model: string }>(
        `SELECT model
           FROM restaurant_embedding
          GROUP BY model
          ORDER BY MAX(created_at) DESC, MIN(id) DESC
          LIMIT 1`,
      );
      model = result.rows[0]?.model ?? null;
    } catch {
      // Missing table / no pgvector: the semantic path simply stays off and
      // search continues with the keyword/structured pipeline.
      model = null;
    }
    this.activeModelCache = { expiresAt: now + ACTIVE_MODEL_CACHE_TTL_MS, model };
    return model;
  }
}

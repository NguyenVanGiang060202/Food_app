// Deterministic search-document builder for Stage 7 embeddings.
//
// The embedding input is versioned with the document template so that the
// model, dimension, distance metric, and template are versioned together
// (docs/08 section 7). `buildSearchDocument` is pure and deterministic for a
// given canonical record. `contentHash` hashes the versioned document; the hash
// detects content changes so embeddings are regenerated only when needed.

import { createHash } from 'node:crypto';

export const EMBEDDING_TEMPLATE_VERSION = 'v1';

export interface RestaurantEmbeddingSource {
  name: string;
  normalizedName: string;
  categories: string[];
  dishes: string[];
  district?: string | null;
  city?: string | null;
  priceLevel?: number | null;
}

export function buildSearchDocument(source: RestaurantEmbeddingSource): string {
  const parts: string[] = [source.name.trim()];

  if (source.categories.length > 0) {
    parts.push(`categories: ${source.categories.join(', ')}`);
  }
  if (source.dishes.length > 0) {
    parts.push(`dishes: ${source.dishes.join(', ')}`);
  }
  const location = [source.district, source.city].filter(Boolean).join(', ');
  if (location) {
    parts.push(`location: ${location}`);
  }
  if (source.priceLevel !== undefined && source.priceLevel !== null) {
    parts.push(`price level: ${source.priceLevel}/4`);
  }
  parts.push(`normalized name: ${source.normalizedName.trim()}`);
  return parts.join(' | ');
}

export function contentHash(searchDocument: string): string {
  const payload = JSON.stringify({
    template: `search-document:${EMBEDDING_TEMPLATE_VERSION}`,
    document: searchDocument,
  });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function embeddingModelId(providerModel: string): string {
  return `${providerModel}@doc:${EMBEDDING_TEMPLATE_VERSION}`;
}
// Deterministic search-document builder for Stage 7 embeddings.
//
// The embedding input is versioned with the document template so that the
// model, dimension, distance metric, and template are versioned together
// (docs/08 section 7). `buildSearchDocument` is pure and deterministic for a
// given canonical record. `contentHash` hashes the versioned document; the hash
// detects content changes so embeddings are regenerated only when needed.

import { createHash } from 'node:crypto';

export const EMBEDDING_TEMPLATE_VERSION = 'v3';

// Cloudflare Workers AI bge-m3 rejects inputs beyond ~8192 tokens (returns 400
// "invalid input"). Roughly 6k-8k chars of Vietnamese text fits safely; cap the
// document so embedding never 400s. Kept far below the model limit to leave
// headroom for tokenizer differences.
export const MAX_DOCUMENT_CHARS = 8000;

// Strip unpaired UTF-16 surrogates so the document serializes to valid UTF-8
// (embedding providers reject lone surrogates with a 400 "invalid input").
const cleanSurrogates = (text: string): string => {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += text[i] + text[i + 1];
        i += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      continue;
    }
    result += text[i];
  }
  return result;
};

export interface RestaurantEmbeddingSource {
  name: string;
  normalizedName: string;
  categories: string[];
  dishes: string[];
  district?: string | null;
  city?: string | null;
  priceLevel?: number | null;
  profile?: string | null;
  attributes?: string[];
  reviews?: string[];
}

export function buildSearchDocument(source: RestaurantEmbeddingSource): string {
  const parts: string[] = [cleanSurrogates(source.name).trim()];

  if (source.profile) {
    parts.push(`profile: ${cleanSurrogates(source.profile)}`);
  }
  if (source.categories.length > 0) {
    parts.push(`categories: ${source.categories.map(cleanSurrogates).join(', ')}`);
  }
  if (source.dishes.length > 0) {
    parts.push(`dishes: ${source.dishes.map(cleanSurrogates).join(', ')}`);
  }
  if (source.attributes && source.attributes.length > 0) {
    parts.push(`attributes: ${source.attributes.map(cleanSurrogates).join(', ')}`);
  }
  if (source.reviews && source.reviews.length > 0) {
    parts.push(`reviews: ${source.reviews.map(cleanSurrogates).join('; ')}`);
  }
  const location = [source.district, source.city].filter(Boolean).join(', ');
  if (location) {
    parts.push(`location: ${location}`);
  }
  if (source.priceLevel !== undefined && source.priceLevel !== null) {
    parts.push(`price level: ${source.priceLevel}/4`);
  }
  parts.push(`normalized name: ${cleanSurrogates(source.normalizedName).trim()}`);

  // Keep the leading parts (name, profile, categories, dishes) intact; drop
  // trailing parts first, then hard-truncate if still over the cap so the
  // embedding request never exceeds the provider's input limit.
  let result = '';
  for (const part of parts) {
    const next = result ? `${result} | ${part}` : part;
    if (next.length > MAX_DOCUMENT_CHARS && result) {
      break;
    }
    result = next;
  }
  if (result.length > MAX_DOCUMENT_CHARS) {
    result = result.slice(0, MAX_DOCUMENT_CHARS);
  }
  return result;
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

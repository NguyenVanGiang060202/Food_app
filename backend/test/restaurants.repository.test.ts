import assert from 'node:assert/strict';
import test from 'node:test';
import { RestaurantsRepository } from '../src/modules/restaurants/restaurants.repository';
import { RestaurantSort } from '../src/modules/restaurants/restaurants.dto';

test('listSimilar ranks candidates using menu and category signals before fallback signals', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return {
        rows: [
          {
            id: 'restaurant-2',
            name: 'Similar Kitchen',
            formatted_address: 'District 1',
            latitude: 10.77,
            longitude: 106.7,
            rating: 4.7,
            review_count: 80,
            price_level: 2,
            cover_image_url: null,
            source_url: null,
            categories: [{ slug: 'noodles', name: 'Noodles' }],
            distance_meters: null,
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ],
        rowCount: 1,
      } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  const result = await repository.listSimilar('restaurant-1', 6);

  assert.equal(result[0]?.id, 'restaurant-2');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, ['restaurant-1', 6]);
  assert.match(calls[0].text, /target_categories/);
  assert.match(calls[0].text, /target_dishes/);
  assert.match(
    calls[0].text,
    /similarity\(candidate_dish\.normalized_name, target_dish\.normalized_name\) >= 0\.62/,
  );
  assert.match(calls[0].text, /s\.category_overlap \* 12/);
  assert.match(calls[0].text, /s\.dish_overlap \* 10/);
  assert.match(
    calls[0].text,
    /CASE WHEN s\.category_overlap > 0 OR s\.dish_overlap > 0 THEN 1 ELSE 0 END/,
  );
});

test('listSimilar clamps the requested limit to the public maximum', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.listSimilar('restaurant-1', 999);

  assert.deepEqual(calls[0].values, ['restaurant-1', 20]);
});

test('list matches known taste values through the dish attribute taxonomy', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({ tastes: ['nóng'], limit: 10 });

  assert.equal(calls.length, 1);
  // A canonical attribute ("nóng" -> normalized "nong") is matched via
  // dish_attribute joined to food_attribute, not by a literal dish-name ILIKE.
  assert.match(calls[0].text, /dish_attribute taste_da/);
  assert.match(calls[0].text, /food_attribute taste_fa/);
  assert.match(calls[0].text, /taste_fa\.normalized/);
  assert.ok(calls[0].values.includes('nong'));
  // The literal dish-name fallback remains as an OR branch so an unknown
  // dish phrase (e.g. "bún bò huế" from intent) still matches names.
  assert.match(calls[0].text, /OR EXISTS \(SELECT 1 FROM dish taste_ds2/);
});

test('list matches the semantic_profile column in keyword and per-term clauses', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({ query: 'bún cay', limit: 10 });

  assert.equal(calls.length, 1);
  const semanticMatches = (calls[0].text.match(/COALESCE\(r\.semantic_profile, ''\) ILIKE/g) ?? [])
    .length;
  // Both the whole-query push and each per-term clause search the profile.
  assert.ok(semanticMatches >= 3, `expected semantic_profile ILIKE clauses, got ${semanticMatches}`);
  assert.match(calls[0].text, /term_ds\.normalized_name ILIKE/);
});

test('list ranks by weighted relevance + semantic score when an embedding is attached', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({
    query: 'bún bò huế',
    embedding: { vector: [0.1, 0.2, 0.3], model: 'bge-m3@doc:v3' },
    limit: 10,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /FROM restaurant_embedding emb/);
  assert.match(calls[0].text, /emb\.embedding <=>/);
  assert.match(calls[0].text, /emb\.model = \$\d+/);
  assert.match(calls[0].text, /AS semantic_score/);
  assert.ok(calls[0].values.includes('[0.10000000,0.20000000,0.30000000]'));
  assert.ok(calls[0].values.includes('bge-m3@doc:v3'));
  assert.match(
    calls[0].text,
    /COALESCE\(relevance_score, 0\) \+ 0\.4 \* COALESCE\(semantic_score, 0\)/,
  );
});

test('list keeps the rating order without the semantic rank for non-default sorts', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({
    query: 'bún',
    sort: RestaurantSort.Rating,
    embedding: { vector: [0.1], model: 'bge-m3@doc:v3' },
    limit: 10,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /r\.review_count DESC NULLS LAST/);
  assert.ok(
    !/0\.4 \* COALESCE\(semantic_score, 0\)/.test(calls[0].text),
    'rating sort must not use the semantic rank in ORDER BY',
  );
});

test('list supports pure semantic discovery without a text query', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new RestaurantsRepository(database as never);

  await repository.list({
    embedding: { vector: [0.1], model: 'bge-m3@doc:v3' },
    limit: 10,
  });

  assert.equal(calls.length, 1);
  // No text query means no keyword/ILIKE clauses, but the semantic score is
  // still selected and drives the default (relevance) ordering.
  assert.ok(!/ILIKE/.test(calls[0].text));
  assert.match(calls[0].text, /0::real AS relevance_score/);
  assert.match(calls[0].text, /AS semantic_score/);
  assert.match(
    calls[0].text,
    /COALESCE\(relevance_score, 0\) \+ 0\.4 \* COALESCE\(semantic_score, 0\)/,
  );
});

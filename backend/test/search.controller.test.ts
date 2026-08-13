import assert from 'node:assert/strict';
import test from 'node:test';
import { RecommendationsController } from '../src/modules/search/search.controller';
import type {
  RestaurantPage,
  RestaurantSummary,
} from '../src/modules/restaurants/restaurants.types';

const restaurant = (id: string): RestaurantSummary => ({
  id,
  name: `Restaurant ${id}`,
  location: { formattedAddress: 'District 1', latitude: 10.77, longitude: 106.7 },
  categories: [{ slug: 'vegetarian', name: 'Vegetarian' }],
  rating: 4.5,
  reviewCount: 10,
  priceLevel: 2,
  coverImageUrl: null,
});

const page = (data: RestaurantSummary[]): RestaurantPage => ({
  data,
  meta: { nextCursor: null, limit: 20 },
});

test('recommendation forwards taste filters and applies the requested limit', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('one'), restaurant('two')]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  const result = await controller.recommend({
    query: 'vegetarian food',
    filters: { taste: ['vegetarian'], priceLevel: 2 },
    limit: 1,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].tastes, ['vegetarian']);
  assert.equal(calls[0].priceLevel, 2);
  assert.equal(result.data.length, 1);
  assert.equal(typeof result.data[0].explanation, 'string');
  assert.match(result.data[0].explanation ?? '', /vegetarian/);
});

test('recommendation retries without the query when the first search is empty', async () => {
  const queries: Array<string | undefined> = [];
  const databaseService = {
    list: async (filters: { query?: string }) => {
      queries.push(filters.query);
      return filters.query ? page([]) : page([restaurant('fallback')]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  const result = await controller.recommend({ query: 'unknown dish', limit: 10 });

  assert.deepEqual(queries, ['unknown dish', undefined]);
  assert.equal(result.data[0].restaurant.id, 'fallback');
});

test('recommendation falls back to rated restaurants but preserves the taste filters', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return filters.sort === 'rating' ? page([restaurant('rated')]) : page([]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  const result = await controller.recommend({
    query: 'món nóng có nước',
    filters: { taste: ['nóng'] },
    limit: 10,
  });

  assert.equal(result.data[0].restaurant.id, 'rated');
  assert.equal(calls.at(-1)?.sort, 'rating');
  // The discovery fallback drops only the free-text query; the user's explicit
  // taste filter remains so we never return unrelated top-rated restaurants.
  assert.deepEqual(calls.at(-1)?.tastes, ['nóng']);
});

test('unsupported cuisine aliases do not become impossible category filters', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return filters.sort === 'rating' ? page([restaurant('cuisine-fallback')]) : page([]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  const result = await controller.recommend({ query: 'Gợi ý quán BBQ ngon gần tôi', limit: 5 });

  assert.equal(result.data[0].restaurant.id, 'cuisine-fallback');
  assert.equal(calls[0].category, undefined);
});

test('"gợi ý" does not map to the Italian cuisine alias', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('any')]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  await controller.recommend({ query: 'hiện tại trời mưa, hãy gợi ý cho tôi quán gần đây', limit: 5 });

  assert.equal(calls[0].category, undefined);
});

test('rainy weather maps to a hot-comfort taste and semantic query', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('warm')]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  await controller.recommend({ query: 'trời mưa rét, quán nào ấm bụng', limit: 5 });

  assert.deepEqual(calls[0].tastes, ['nóng']);
  assert.equal(calls[0].semanticQuery, 'món nóng ấm bụng');
});

test('cold weather maps to hot comfort food instead of the "mát" taste', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('warm')]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  await controller.recommend({ query: 'trời trở lạnh, ăn gì cho ấm', limit: 5 });

  assert.deepEqual(calls[0].tastes, ['nóng']);
  assert.equal(calls[0].semanticQuery, 'món nóng ấm bụng');
});

test('hot weather maps to cold/refreshing food instead of the "nóng" taste', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('cool')]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  await controller.recommend({ query: 'trời đang nóng, tìm gì đó phù hợp gần đây cho tôi', limit: 5 });

  assert.deepEqual(calls[0].tastes, ['mát']);
  assert.equal(calls[0].semanticQuery, 'món mát lạnh');
});

test('hot weather wins over the LLM reading the word "nóng" as hot food', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('cool')]);
    },
  };
  const aiIntent = {
    isEnabled: () => true,
    interpret: async () => ({
      categories: [],
      dishes: [],
      tastes: ['nóng', 'phù hợp'],
      district: null,
      priceLevel: null,
      minRating: null,
      openNow: null,
      distanceKm: null,
      summary: 'Bếp hiểu trời đang nóng.',
      semanticQuery: 'món ăn cho thời tiết nóng',
    }),
  };
  const controller = new RecommendationsController(
    databaseService as never,
    undefined,
    aiIntent as never,
  );

  await controller.recommend({ query: 'trời nóng, tìm gì đó phù hợp gần đây cho tôi', limit: 5 });

  // Deterministic weather reading ("mát") wins; the LLM's "nóng" + "phù hợp"
  // are dropped so they cannot AND into a filter that matches nothing.
  assert.deepEqual(calls[0].tastes, ['mát']);
  assert.equal(calls[0].semanticQuery, 'món mát lạnh');
});

test('solar heat phrases like "nắng nóng" also map to cold food', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('cool')]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  await controller.recommend({ query: 'trời nắng nóng quá, quán nào có kem gần đây', limit: 5 });

  assert.deepEqual(calls[0].tastes, ['mát']);
});

test('recommendation uses the LLM intent when the AI service is enabled', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('ai-restaurant')]);
    },
  };
  const aiIntent = {
    isEnabled: () => true,
    interpret: async () => ({
      categories: ['bun'],
      dishes: ['bún bò huế'],
      tastes: ['nóng'],
      district: 'Quận 1',
      priceLevel: 3,
      minRating: 4.4,
      openNow: false,
      distanceKm: 5,
      summary: 'Bếp hiểu bạn muốn món bún.',
    }),
  };
  const controller = new RecommendationsController(
    databaseService as never,
    undefined,
    aiIntent as never,
  );

  const result = await controller.recommend({
    query: 'món gì nóng bưng gần đây',
    limit: 5,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].category, 'bun');
  assert.equal(calls[0].priceLevel, 3);
  assert.equal(calls[0].minRating, 4.4);
  assert.equal(calls[0].openNow, false);
  assert.equal(calls[0].radiusMeters, 5000);
  assert.deepEqual(calls[0].tastes, ['nóng', 'bún bò huế']);
  assert.match(result.data[0].explanation ?? '', /nóng/);
});

test('for-you uses all saved category and price preferences and removes duplicates', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      const category = filters.category as string | undefined;
      const priceLevel = filters.priceLevel as number | undefined;
      return page([
        restaurant(`${category ?? 'none'}-${priceLevel ?? 'none'}`),
        restaurant('shared'),
      ]);
    },
  };
  const auth = {
    getPreferences: async () => ({
      favoriteCategorySlugs: ['pho', 'bun'],
      dietaryPreferences: ['vegetarian'],
      preferredPriceLevels: [1, 2],
    }),
  };
  const controller = new RecommendationsController(databaseService as never, auth as never);

  const result = await controller.forYou({
    user: { id: 'user-1', email: 'user@example.com', displayName: null },
  });

  assert.equal(calls.length, 4);
  assert.ok(calls.every((call) => JSON.stringify(call.tastes) === JSON.stringify(['vegetarian'])));
  assert.equal(result.data.length, 5);
  assert.equal(new Set(result.data.map((item) => item.restaurant.id)).size, result.data.length);
  assert.match(result.data[0].explanation ?? '', /mức giá 1, 2/);
});

test('for-you falls back to rating when saved preferences have no matches', async () => {
  let calls = 0;
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls += 1;
      return filters.sort === 'rating' && calls > 1 ? page([restaurant('fallback')]) : page([]);
    },
  };
  const auth = {
    getPreferences: async () => ({
      favoriteCategorySlugs: ['pho'],
      dietaryPreferences: [],
      preferredPriceLevels: [],
    }),
  };
  const controller = new RecommendationsController(databaseService as never, auth as never);

  const result = await controller.forYou({
    user: { id: 'user-2', email: 'user@example.com', displayName: null },
  });

  assert.equal(result.data[0].restaurant.id, 'fallback');
  assert.equal(calls, 2);
});

test('recommendation does not turn the raw sentence into a text filter when interpretation consumed it', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('cool')]);
    },
  };
  const controller = new RecommendationsController(databaseService as never);

  await controller.recommend({ query: 'trời đang nóng', limit: 5 });

  // The whole sentence became a comfort taste + semantic query; the SQL text
  // filter must stay undefined instead of LIKE-matching "trời"/"nóng".
  assert.equal(calls[0].query, undefined);
  assert.deepEqual(calls[0].tastes, ['mát']);
  assert.equal(calls[0].semanticQuery, 'món mát lạnh');
});

test('recommendation relaxes inferred tastes when the embedding page is short', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const embedding = {
    isEnabled: () => true,
    activeModel: async () => 'bge-m3@doc:v3',
    embed: async () => new Array(1024).fill(0),
  };
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      // First call: taste filter matches only 1 row (< limit 5). Second call
      // (tastes relaxed) returns a full page so the semantic rank can fill it.
      return (filters.tastes as string[])?.length ? page([restaurant('one')]) : page([restaurant('a'), restaurant('b'), restaurant('c')]);
    },
  };
  const controller = new RecommendationsController(
    databaseService as never,
    undefined,
    undefined,
    embedding as never,
  );

  const result = await controller.recommend({ query: 'trời đang nóng', limit: 5 });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].tastes, ['mát']);
  // Inferred taste dropped, explicit UI tastes (none here) kept.
  assert.deepEqual(calls[1].tastes, []);
  assert.equal(result.data.length, 3);
});

test('recommendation keeps explicit UI tastes when the embedding page is short', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const embedding = {
    isEnabled: () => true,
    activeModel: async () => 'bge-m3@doc:v3',
    embed: async () => new Array(1024).fill(0),
  };
  const databaseService = {
    list: async (filters: Record<string, unknown>) => {
      calls.push(filters);
      return page([restaurant('one')]);
    },
  };
  const controller = new RecommendationsController(
    databaseService as never,
    undefined,
    undefined,
    embedding as never,
  );

  await controller.recommend({
    query: 'trời đang nóng',
    filters: { taste: ['mát'] },
    limit: 5,
  });

  // Only one call: the explicitly chosen taste is intent, never dropped.
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].tastes, ['mát']);
});

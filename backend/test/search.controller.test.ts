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

test('recommendation falls back to rated restaurants when taste filters have no exact match', async () => {
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
  assert.equal(calls.at(-1)?.tastes, undefined);
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

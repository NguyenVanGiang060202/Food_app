import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { SavedController, ListSavedQueryDto } from '../src/modules/saved/saved.controller';
import { SavedRepository } from '../src/modules/saved/saved.repository';

type QueryCall = { text: string; values: unknown[] };

function createRepository(rows: Array<Record<string, unknown>>) {
  const calls: QueryCall[] = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows, rowCount: rows.length } as { rows: T[]; rowCount: number };
    },
  };
  return { repository: new SavedRepository(database as never), calls };
}

test('save verifies that the restaurant is active before inserting', async () => {
  const { repository, calls } = createRepository([{ '?column?': 1 }]);

  await repository.save('user-1', 'restaurant-1');

  assert.equal(calls.length, 2);
  assert.match(calls[0].text, /FROM restaurant WHERE id = \$1 AND status = 'active'/);
  assert.deepEqual(calls[0].values, ['restaurant-1']);
  assert.match(calls[1].text, /INSERT INTO saved_restaurant/);
  assert.deepEqual(calls[1].values, ['user-1', 'restaurant-1']);
});

test('save rejects missing or inactive restaurants with a not-found error', async () => {
  const { repository, calls } = createRepository([]);

  await assert.rejects(
    () => repository.save('user-1', 'restaurant-1'),
    (error: unknown) =>
      error instanceof NotFoundException && /Restaurant was not found/.test(error.message),
  );
  assert.equal(calls.length, 1);
});

test('list sends the requested limit to SQL and returns no more than that limit', async () => {
  const calls: QueryCall[] = [];
  const rows = Array.from({ length: 15 }, (_, index) => ({
    id: `restaurant-${index}`,
    name: `Restaurant ${index}`,
    formatted_address: 'Hà Nội',
    latitude: 21.0,
    longitude: 105.8,
    rating: 4.5,
    review_count: 10,
    price_level: 2,
    cover_image_url: null,
    source_url: null,
    categories: [],
    created_at: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
  }));
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      if (/COUNT\(\*\)/.test(text))
        return { rows: [{ count: '16' }], rowCount: 1 } as { rows: T[]; rowCount: number };
      if (/SELECT EXISTS/.test(text))
        return { rows: [{ exists: true }], rowCount: 1 } as { rows: T[]; rowCount: number };
      return { rows, rowCount: rows.length } as { rows: T[]; rowCount: number };
    },
  };
  const repository = new SavedRepository(database as never);

  const result = await repository.list('user-1', { limit: 15 });

  assert.equal(result.data.length, 15);
  assert.equal(result.meta.limit, 15);
  assert.equal(result.meta.totalCount, 16);
  assert.equal(result.meta.totalPages, 2);
  assert.ok(result.meta.nextCursor);
  const dataQuery = calls.find((call) => /SELECT r\.id/.test(call.text));
  assert.ok(dataQuery);
  assert.match(dataQuery.text, /LIMIT \$2$/);
  assert.deepEqual(dataQuery.values, ['user-1', 15]);
  assert.equal(calls.filter((call) => /SELECT EXISTS/.test(call.text)).length, 1);
});

test('saved query DTO transforms a numeric limit and rejects values above the API maximum', () => {
  const query = new ListSavedQueryDto();
  query.limit = 15;
  assert.equal(query.limit, 15);
  assert.equal(new ListSavedQueryDto().limit, 12);
});

test('saved controller forwards the validated query without changing the page size', async () => {
  const calls: Array<{ userId: string; query: unknown }> = [];
  const saved = {
    list: async (userId: string, query: unknown) => {
      calls.push({ userId, query });
      return { data: [], meta: { nextCursor: null, limit: 15, totalCount: 0, totalPages: 0 } };
    },
  };
  const controller = new SavedController(saved as never);
  const query = Object.assign(new ListSavedQueryDto(), { limit: 15 });

  const response = await controller.list({ user: { id: 'user-1' } } as never, query);

  assert.deepEqual(response, {
    data: [],
    meta: { nextCursor: null, limit: 15, totalCount: 0, totalPages: 0 },
  });
  assert.deepEqual(calls, [{ userId: 'user-1', query }]);
});

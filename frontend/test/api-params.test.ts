import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDishQuery, buildRestaurantQuery, buildSearchQuery } from '../src/lib/api-params.ts';

test('restaurant query keeps bounded filters and repeated tastes', () => {
  const params = new URLSearchParams(
    buildRestaurantQuery({
      limit: 12,
      category: 'pho bo',
      latitude: 10.77,
      longitude: 106.7,
      radiusMeters: 2500,
      openNow: false,
      sort: 'distance',
      tastes: ['cay', 'nhẹ bụng'],
    }),
  );
  assert.equal(params.get('limit'), '12');
  assert.equal(params.get('category'), 'pho bo');
  assert.equal(params.get('openNow'), 'false');
  assert.deepEqual(params.getAll('tastes'), ['cay', 'nhẹ bụng']);
});

test('search query only sends radius when both coordinates are present', () => {
  const missingLocation = new URLSearchParams(
    buildSearchQuery('  cà phê  ', { radiusMeters: 1000, latitude: 10.7 }),
  );
  assert.equal(missingLocation.get('query'), 'cà phê');
  assert.equal(missingLocation.get('radiusMeters'), null);

  const withLocation = new URLSearchParams(
    buildSearchQuery('  cà phê  ', { radiusMeters: 1000, latitude: 10.7, longitude: 106.6 }),
  );
  assert.equal(withLocation.get('radiusMeters'), '1000');
});

test('dish query omits empty optional filters', () => {
  assert.equal(buildDishQuery(20, '   '), 'limit=20');
  const params = new URLSearchParams(
    buildDishQuery(10, 'bún bò', { category: 'noodles', openNow: true }),
  );
  assert.equal(params.get('query'), 'bún bò');
  assert.equal(params.get('category'), 'noodles');
  assert.equal(params.get('openNow'), 'true');
});

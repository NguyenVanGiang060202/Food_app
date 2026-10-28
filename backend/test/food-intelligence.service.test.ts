import assert from 'node:assert/strict';
import test from 'node:test';
import { FoodIntelligenceService } from '../src/modules/food-intelligence/food-intelligence.service';

test('rebuildRestaurantProfile derives facts, aggregate opinions and semantic text', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      if (text.includes('mark_food_profile_stale')) return { rows: [], rowCount: 1 };
      if (text.includes('FROM dish d')) return { rows: [{ id: 'dish-1', canonical_dish_id: 'canonical-1', name: 'Bún bò Huế', normalized_name: 'bun bo hue', price_amount: '55000', evidence_count: '2' }], rowCount: 1 } as { rows: T[]; rowCount: number };
      if (text.includes('FROM review_opinion')) return { rows: [{ dish_name: 'Bún bò Huế', dish_id: 'dish-1', canonical_dish_id: 'canonical-1', aspect: 'flavor', sentiment: 1, count: '3' }], rowCount: 1 } as { rows: T[]; rowCount: number };
      if (text.includes('FROM dish_evidence')) return { rows: [{ count: '2' }], rowCount: 1 } as { rows: T[]; rowCount: number };
      return { rows: [{ version: 2 }], rowCount: 1 } as { rows: T[]; rowCount: number };
    },
  };
  const service = new FoodIntelligenceService(database as never);
  const result = await service.rebuildRestaurantProfile('restaurant-1');
  assert.equal(result.version, 2);
  assert.equal((result.profile as { aggregateOpinionSignals: unknown[] }).aggregateOpinionSignals.length, 1);
  assert.match(String((result.profile as { semanticText: string }).semanticText), /signature dishes: Bún bò Huế/);
  assert.match(String((result.profile as { semanticText: string }).semanticText), /flavor được khen/);
  assert.equal(calls[0].values[0], 'restaurant-1');
  assert.match(calls.at(-1)!.text, /semantic_text/);
});

test('getRestaurantProfile returns null when absent', async () => {
  const database = { async query<T extends object>() { return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number }; } };
  const service = new FoodIntelligenceService(database as never);
  assert.equal(await service.getRestaurantProfile('missing'), null);
});

test('extractReviewOpinions extracts dish-linked subjective opinions idempotently', async () => {
  const inserts: unknown[][] = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      if (text.includes('FROM review')) return { rows: [{ id: 'review-1', restaurant_id: 'restaurant-1', content: 'Bún bò Huế ngon, nước dùng đậm đà. Phở hơi nhạt.', language_code: 'vi' }], rowCount: 1 } as { rows: T[]; rowCount: number };
      if (text.includes('FROM dish')) return { rows: [
        { id: 'dish-1', name: 'Bún bò Huế', normalized_name: 'bun bo hue', canonical_dish_id: 'canonical-1' },
        { id: 'dish-2', name: 'Phở', normalized_name: 'pho', canonical_dish_id: 'canonical-2' },
      ], rowCount: 2 } as { rows: T[]; rowCount: number };
      if (text.includes('INSERT INTO review_opinion')) inserts.push(values);
      return { rows: [], rowCount: 1 } as { rows: T[]; rowCount: number };
    },
  };
  const service = new FoodIntelligenceService(database as never);
  const result = await service.extractReviewOpinions('review-1');
  assert.equal(result.inserted, 2);
  assert.deepEqual(result.opinions.map(({ dishId, aspect, sentiment }) => ({ dishId, aspect, sentiment })), [
    { dishId: 'dish-1', aspect: 'flavor', sentiment: 1 },
    { dishId: 'dish-2', aspect: 'flavor', sentiment: -1 },
  ]);
  assert.equal(inserts.length, 2);
});

test('extractReviewOpinions ignores reviews without dish/aspect evidence', async () => {
  const database = {
    async query<T extends object>(text: string) {
      if (text.includes('FROM review')) return { rows: [{ id: 'review-2', restaurant_id: 'restaurant-1', content: 'Quán có bán món này.', language_code: 'vi' }], rowCount: 1 } as { rows: T[]; rowCount: number };
      if (text.includes('FROM dish')) return { rows: [{ id: 'dish-1', name: 'Bún bò Huế', normalized_name: 'bun bo hue', canonical_dish_id: 'canonical-1' }], rowCount: 1 } as { rows: T[]; rowCount: number };
      throw new Error('unexpected persistence');
    },
  };
  const service = new FoodIntelligenceService(database as never);
  assert.deepEqual(await service.extractReviewOpinions('review-2'), { reviewId: 'review-2', inserted: 0, opinions: [] });
});

test('extractPendingReviewOpinions counts extraction failures without stopping the batch', async () => {
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      if (text.includes('NOT EXISTS (SELECT 1 FROM review_opinion')) return { rows: [{ id: 'review-new' }, { id: 'review-empty' }], rowCount: 2 } as { rows: T[]; rowCount: number };
      if (text.includes('FROM review') && values[0] === 'review-new') return { rows: [{ id: 'review-new', restaurant_id: 'restaurant-1', content: 'Bún bò Huế ngon.', language_code: 'vi' }], rowCount: 1 } as { rows: T[]; rowCount: number };
      if (text.includes('FROM review') && values[0] === 'review-empty') throw new Error('simulated extraction failure');
      if (text.includes('FROM dish')) return { rows: [{ id: 'dish-1', name: 'Bún bò Huế', normalized_name: 'bun bo hue', canonical_dish_id: 'canonical-1' }], rowCount: 1 } as { rows: T[]; rowCount: number };
      if (text.includes('INSERT INTO review_opinion')) return { rows: [], rowCount: 1 } as { rows: T[]; rowCount: number };
      throw new Error(`unexpected query: ${text}`);
    },
  };
  const service = new FoodIntelligenceService(database as never);
  assert.deepEqual(await service.extractPendingReviewOpinions({ limit: 10 }), { scanned: 2, extracted: 1, opinions: 1, failed: 1 });
});

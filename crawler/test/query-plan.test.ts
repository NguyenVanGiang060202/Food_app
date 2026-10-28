import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlaywrightQueryPlan } from '../src/cli/playwright-query-plan';

test('query plan creates bounded targets and removes duplicate queries', () => {
  const plan = buildPlaywrightQueryPlan({
    city: 'Ho Chi Minh City',
    district: 'District 1',
    limitPerQuery: 100,
    queries: ['quán ăn', ' QUÁN ĂN ', 'bún bò'],
  });
  assert.deepEqual(plan, [
    { query: 'quán ăn', location: 'District 1, Ho Chi Minh City', limit: 50 },
    { query: 'bún bò', location: 'District 1, Ho Chi Minh City', limit: 50 },
  ]);
});

test('query plan supplies concrete dish defaults for dish-first coverage', () => {
  const plan = buildPlaywrightQueryPlan({ city: 'Ho Chi Minh City', limitPerQuery: 10 });
  assert.ok(plan.length > 10);
  assert.ok(plan.some((target) => target.query === 'bún bò Huế'));
  assert.ok(plan.some((target) => target.query === 'cơm tấm sườn'));
  assert.ok(plan.some((target) => target.query === 'bánh mì thịt nướng'));
  assert.ok(plan.some((target) => target.query === 'mì xào hải sản'));
  assert.ok(plan.every((target) => !['quán ăn', 'bún phở', 'cơm'].includes(target.query)));
  assert.equal(
    plan.every((target) => target.limit === 10),
    true,
  );
});

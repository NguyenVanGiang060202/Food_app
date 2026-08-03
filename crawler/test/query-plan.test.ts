import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlaywrightQueryPlan } from '../src/cli/playwright-query-plan';

test('query plan creates bounded targets and removes duplicate queries', () => {
    const plan = buildPlaywrightQueryPlan({ city: 'Ho Chi Minh City', district: 'District 1', limitPerQuery: 100, queries: ['quán ăn', ' QUÁN ĂN ', 'bún bò'] });
    assert.deepEqual(plan, [
        { query: 'quán ăn', location: 'District 1, Ho Chi Minh City', limit: 50 },
        { query: 'bún bò', location: 'District 1, Ho Chi Minh City', limit: 50 },
    ]);
});

test('query plan supplies broad defaults without requiring one keyword per dish', () => {
    const plan = buildPlaywrightQueryPlan({ city: 'Ho Chi Minh City', limitPerQuery: 10 });
    assert.ok(plan.length > 10);
    assert.equal(plan.every((target) => target.limit === 10), true);
});
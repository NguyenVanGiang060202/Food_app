import assert from 'node:assert/strict';
import test from 'node:test';
import { RestaurantsRepository } from '../src/modules/restaurants/restaurants.repository';

test('listSimilar ranks candidates using menu and category signals before fallback signals', async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const database = {
        async query<T extends object>(text: string, values: unknown[] = []) {
            calls.push({ text, values });
            return {
                rows: [{
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
                }],
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
    assert.match(calls[0].text, /similarity\(candidate_dish\.normalized_name, target_dish\.normalized_name\) >= 0\.62/);
    assert.match(calls[0].text, /s\.category_overlap \* 12/);
    assert.match(calls[0].text, /s\.dish_overlap \* 10/);
    assert.match(calls[0].text, /CASE WHEN s\.category_overlap > 0 OR s\.dish_overlap > 0 THEN 1 ELSE 0 END/);
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
import assert from 'node:assert/strict';
import test from 'node:test';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListRestaurantsQueryDto, RecommendationFiltersDto } from '../src/modules/restaurants/restaurants.dto';

test('restaurant list accepts one taste query parameter as an array', () => {
  const dto = plainToInstance(ListRestaurantsQueryDto, { tastes: 'thanh đạm' });
  assert.deepEqual(dto.tastes, ['thanh đạm']);
  assert.deepEqual(validateSync(dto), []);
});

test('recommendation taste filter accepts one string without changing array inputs', () => {
  const single = plainToInstance(RecommendationFiltersDto, { taste: 'thanh đạm' });
  const multiple = plainToInstance(RecommendationFiltersDto, { taste: ['cay', 'ngọt'] });
  assert.deepEqual(single.taste, ['thanh đạm']);
  assert.deepEqual(multiple.taste, ['cay', 'ngọt']);
  assert.deepEqual(validateSync(single), []);
  assert.deepEqual(validateSync(multiple), []);
});

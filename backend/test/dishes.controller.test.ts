import assert from 'node:assert/strict';
import test from 'node:test';
import { DishesController } from '../src/modules/categories/dishes.controller';

test('dish listing exposes only completed trusted menu evidence', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const controller = new DishesController(database as never);

  await controller.list('10', 'phở');

  assert.match(calls[0].text, /FROM dish_evidence trusted_de/);
  assert.match(calls[0].text, /JOIN menu_image_extraction trusted_mie/);
  assert.match(calls[0].text, /trusted_mie\.status = 'completed'/);
  assert.match(calls[0].text, /website:menu:v1/);
  assert.match(calls[0].text, /google_maps:menu-curated:v1/);
  assert.match(calls[0].text, /trusted_mie\.raw_ocr_text.*food_photo:/);
});

test('dish detail does not expose an unverified legacy dish', async () => {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number };
    },
  };
  const controller = new DishesController(database as never);

  await controller.getById('00000000-0000-0000-0000-000000000001');

  assert.match(calls[0].text, /d\.status = 'available'/);
  assert.match(calls[0].text, /trusted_mie\.model IN/);
  assert.match(calls[0].text, /trusted_mie\.raw_ocr_text.*food_photo:/);
});

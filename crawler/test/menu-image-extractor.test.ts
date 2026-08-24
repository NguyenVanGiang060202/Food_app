import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMenuImageResult } from '../src/enrichment/menu-image-extractor';

test('accepts high-confidence menu dishes and normalizes prices', () => {
  const result = parseMenuImageResult({
    isMenu: true,
    confidence: 0.91,
    ocrText: 'Bún bò Huế 45k',
    dishes: [{ name: 'Bún bò Huế', rawPrice: '45k' }],
  });
  assert.ok(result?.isMenu);
  assert.deepEqual(result?.dishes, [
    {
      name: 'Bún bò Huế',
      normalizedName: 'bun bo hue',
      priceAmount: 45000,
      currencyCode: 'VND',
      rawPrice: '45k',
    },
  ]);
});

test('does not accept dish claims when the image is not a confident menu', () => {
  const result = parseMenuImageResult({
    isMenu: false,
    confidence: 0.98,
    ocrText: '',
    dishes: [{ name: 'Phở bò' }],
  });
  assert.ok(result);
  assert.deepEqual(result.dishes, []);
});

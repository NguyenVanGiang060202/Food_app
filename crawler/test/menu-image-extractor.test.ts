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

test('does not treat a prepared-food photo classification as menu evidence', () => {
  const result = parseMenuImageResult({
    isMenu: false,
    confidence: 0,
    ocrText: 'food_photo: Bún bò Huế',
    dishes: [],
  });
  assert.ok(result);
  assert.equal(result.isMenu, false);
  assert.deepEqual(result.dishes, []);
});

test('rejects confident-looking OCR gibberish before persisting a dish', () => {
  const result = parseMenuImageResult({
    isMenu: true,
    confidence: 0.85,
    ocrText: 'Chènidl trét - 45000',
    dishes: [{ name: 'Chènidl trét', rawPrice: '45000' }],
  });
  assert.ok(result);
  assert.equal(result.dishes.length, 0);
});

test('keeps concrete Vietnamese dish names from menu OCR', () => {
  const result = parseMenuImageResult({
    isMenu: true,
    confidence: 0.85,
    ocrText: 'Bún bò Huế - 45000',
    dishes: [{ name: 'Bún bò Huế', rawPrice: '45000' }],
  });
  assert.ok(result);
  assert.equal(result.dishes[0]?.normalizedName, 'bun bo hue');
});

test('rejects the repeated stock menu template before persistence', () => {
  const result = parseMenuImageResult({
    isMenu: true,
    confidence: 0.85,
    ocrText: 'Bun bo hue - 45000\nCom tam - 35000\nBanh mi - 25000\nDISH_NAME - none',
    dishes: [{ name: 'Bun bo hue', rawPrice: '45000' }],
  });
  assert.equal(result?.isMenu, false);
  assert.deepEqual(result?.dishes, []);
});

test('rejects a single stock row mixed with short corrupted OCR', () => {
  const result = parseMenuImageResult({
    isMenu: true,
    confidence: 0.85,
    ocrText: 'Cam - none\nChop hanh de - 35000\nKieng - 25000\nBun bo hue - 45000',
    dishes: [{ name: 'Bún bò Huế', rawPrice: '45000' }],
  });
  assert.equal(result?.isMenu, false);
  assert.deepEqual(result?.dishes, []);
});

test('rejects progressive hallucinated menu variants', () => {
  const result = parseMenuImageResult({
    isMenu: true,
    confidence: 0.85,
    ocrText: 'Bún riêu - 45000\nBún riêu cá - 45000\nBún riêu cá và ốc - 45000\nBún riêu cá và ốc và rau - 45000',
    dishes: [{ name: 'Bún riêu', rawPrice: '45000' }],
  });
  assert.equal(result?.isMenu, false);
  assert.deepEqual(result?.dishes, []);
});

test('rejects explanatory prose from vision OCR', () => {
  const result = parseMenuImageResult({
    isMenu: true,
    confidence: 0.85,
    ocrText: 'The image shows a restaurant menu. Here is the information transcribed:\nBún bò Huế - 45000',
    dishes: [{ name: 'Bún bò Huế', rawPrice: '45000' }],
  });
  assert.equal(result?.isMenu, false);
  assert.deepEqual(result?.dishes, []);
});

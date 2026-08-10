import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCategory,
  normalizeForClassification,
  CATEGORY_MIN_CONFIDENCE,
} from '../src/enrichment/category-classifier';
import { extractDishesFromText, normalizeText } from '../src/enrichment/dish-extractor';
import { classifyAttributes } from '../src/enrichment/attribute-classifier';

test('normalizeForClassification strips diacritics and lowercases', () => {
  assert.equal(normalizeForClassification('Cà Phê Sài Gòn'), 'ca phe sai gon');
});

test('classifyCategory recognizes coffee shop names', () => {
  const suggestion = classifyCategory('Kingdom Coffee Quận 1');
  assert.ok(suggestion);
  assert.equal(suggestion?.slug, 'coffee-shop');
  assert.ok(suggestion!.confidence >= CATEGORY_MIN_CONFIDENCE);
});

test('classifyCategory recognizes tea/beverage shops', () => {
  const suggestion = classifyCategory('Trà Sữa Tocotoco');
  assert.equal(suggestion?.slug, 'beverage');
});

test('classifyCategory recognizes vegetarian shops', () => {
  const suggestion = classifyCategory('Quán Chay An Nhiên');
  assert.equal(suggestion?.slug, 'vegetarian');
});

test('classifyCategory recognizes noodle shops', () => {
  const suggestion = classifyCategory('Bánh Canh Cô Nguyệt');
  assert.equal(suggestion?.slug, 'noodle');
});

test('classifyCategory recognizes rice shops by leading token', () => {
  const suggestion = classifyCategory('Cơm Tấm Sài Gòn');
  assert.equal(suggestion?.slug, 'rice');
});

test('classifyCategory recognizes snack street-food names', () => {
  const suggestion = classifyCategory('Bánh Mì Huỳnh Hoa');
  assert.equal(suggestion?.slug, 'snack');
});

test('classifyCategory returns undefined for unrelated names', () => {
  assert.equal(classifyCategory('ABC Logistics'), undefined);
  assert.equal(classifyCategory(''), undefined);
  assert.equal(classifyCategory(undefined), undefined);
});

test('classifyCategory skips ambiguous equal-confidence names', () => {
  assert.equal(classifyCategory('Phở Bún Quận 1'), undefined);
});

test('normalizeText strips diacritics', () => {
  assert.equal(normalizeText('Phở bò Huế'), 'pho bo hue');
});

test('extractDishesFromText finds a dish in a single review', () => {
  const suggestions = extractDishesFromText('r1', 'Quán Ăn Sài Gòn', [
    'Bún riêu ở đây ngon, khách đông',
    'Bún riêu không bị nhạt',
  ]);
  const bun = suggestions.find((suggestion) => suggestion.normalized === 'bun rieu');
  assert.ok(bun);
  assert.equal(bun.display, 'Bún riêu');
  assert.equal(bun.confidence, 0.9);
});

test('extractDishesFromText boosts name hits', () => {
  const suggestions = extractDishesFromText('r2', 'Phở Bò Ơ Kìa', ['Quán sạch sẽ']);
  const pho = suggestions.find((suggestion) => suggestion.normalized === 'pho bo');
  assert.ok(pho);
  assert.equal(pho.confidence, 0.95);
});

test('extractDishesFromText returns nothing for unrelated reviews', () => {
  const suggestions = extractDishesFromText('r3', 'Không Tên', ['Chỗ đông người, giá rẻ.']);
  assert.equal(suggestions.length, 0);
});

test('extractDishesFromText requires a real phrase, not a token fragment', () => {
  // "mi" must not match inside unrelated words (e.g. "mì" not present, or a
  // substring of a longer word).
  const suggestions = extractDishesFromText('r4', 'Không Tên', ['Vừa ăn xong mới ra.']);
  assert.equal(
    suggestions.find((suggestion) => suggestion.normalized === 'mi ga'),
    undefined,
  );
});

test('classifyAttributes tags a spicy beef noodle dish across dimensions', () => {
  const attributes = classifyAttributes('bun bo hue');
  const codes = attributes.map((attribute) => attribute.code);
  assert.ok(codes.includes('hot'));
  assert.ok(codes.includes('spicy'));
  assert.ok(codes.includes('beef'));
  assert.ok(codes.includes('filling'));
});

test('classifyAttributes tags a dessert as sweet and cool', () => {
  const codes = classifyAttributes('sua chua nep cam').map((attribute) => attribute.code);
  assert.deepEqual([...codes].sort(), ['cool', 'snack', 'sweet']);
});

test('classifyAttributes returns nothing for an unknown dish', () => {
  assert.deepEqual(classifyAttributes('bi mat'), []);
});

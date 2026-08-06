import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearSearchFilters,
  readOptionalNumber,
  updateSearchParam,
} from '../src/lib/search-url.ts';

test('updateSearchParam preserves existing filters and encodes new values', () => {
  assert.equal(
    updateSearchParam('q=pho&sort=rating', 'category', 'noodles'),
    '/search?q=pho&sort=rating&category=noodles',
  );
});

test('updateSearchParam removes a filter without dropping the query', () => {
  assert.equal(
    updateSearchParam('q=pho&open=true&sort=rating', 'open'),
    '/search?q=pho&sort=rating',
  );
});

test('clearSearchFilters keeps only a trimmed query', () => {
  assert.equal(clearSearchFilters('q=%20pho%20&category=noodles&open=true'), '/search?q=pho');
  assert.equal(clearSearchFilters('category=noodles'), '/search');
});

test('readOptionalNumber preserves zero and rejects invalid values', () => {
  assert.equal(readOptionalNumber('0'), 0);
  assert.equal(readOptionalNumber(' 10.75 '), 10.75);
  assert.equal(readOptionalNumber(''), undefined);
  assert.equal(readOptionalNumber('not-a-number'), undefined);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { hasLocationIntent } from '../src/lib/location-intent.ts';

test('detects common near-me phrases', () => {
  const hits = [
    'quán ăn gần đây',
    'gần đây có gì ngon',
    'bún bò huế gần tôi',
    'quanh đây chỗ nào ngon',
    'gần nhà tôi có quán phở nào',
    'ăn gì ở đây',
    'gần chỗ này quán nào mở muộn',
    'có gì ngon quanh đây',
    'xung quanh đây có quán chay không',
    'GẦN ĐÂY QUÁN NGON',
  ];
  for (const query of hits) assert.equal(hasLocationIntent(query), true, query);
});

test('rejects non-location queries', () => {
  const misses = [
    'phở nóng',
    'bún bò huế cay đậm đà',
    'quán ăn ngon',
    'trời gần tối ăn gì', // gần tối = near evening, not near me
    'gần đầy đủ món', // gần đầy = nearly full
    '',
  ];
  for (const query of misses) assert.equal(hasLocationIntent(query), false, query);
});

test('gần tối is not location intent while gần tôi is', () => {
  assert.equal(hasLocationIntent('trời gần tối'), false);
  assert.equal(hasLocationIntent('gần tôi'), true);
});

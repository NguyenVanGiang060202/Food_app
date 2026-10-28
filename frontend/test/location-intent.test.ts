import assert from 'node:assert/strict';
import test from 'node:test';
import { hasLocationIntent, hasWeatherIntent } from '../src/lib/location-intent.ts';

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

test('detects radius and distance constraints as location intent', () => {
  const hits = [
    'bún bò trong bán kính 3 km',
    'quán cách tôi dưới 3 km',
    'đừng chọn quán quá xa',
  ];
  for (const query of hits) assert.equal(hasLocationIntent(query), true, query);
});

test('weather is separate from explicit location intent', () => {
  assert.equal(hasWeatherIntent('hiện tại trời đang mưa, ăn gì phù hợp'), true);
  assert.equal(hasWeatherIntent('trời se lạnh nên ăn gì'), true);
  assert.equal(hasLocationIntent('hiện tại trời đang mưa, ăn gì phù hợp'), false);
  assert.equal(hasLocationIntent('trời se lạnh nên ăn gì'), false);
});

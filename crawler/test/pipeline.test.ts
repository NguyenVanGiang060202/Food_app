import test from 'node:test';
import assert from 'node:assert/strict';
import { FixtureProvider } from '../src/providers/fixture/fixture.provider';
import { normalizeSourceRecord } from '../src/pipeline/normalizer';
import { validateSourceRecord } from '../src/validation/source-record.validation';

test('fixture provider respects bounded filters', async () => {
  const names: string[] = [];
  for await (const record of new FixtureProvider().discover({ district: 'District 1', limit: 1 }))
    names.push(record.name);
  assert.equal(names.length, 1);
});

test('normalizer creates a stable accent-free comparison name', () => {
  const normalized = normalizeSourceRecord({
    providerCode: 'google_maps_playwright',
    externalId: 'x',
    collectedAt: new Date().toISOString(),
    name: '  Bếp   Nhà Mình  ',
    sourceMetadata: {},
  });
  assert.equal(normalized.name, 'Bếp Nhà Mình');
  assert.equal(normalized.normalizedName, 'bep nha minh');
});

test('source validation rejects invalid coordinates', () => {
  assert.throws(
    () =>
      validateSourceRecord({
        providerCode: 'google_maps_playwright',
        externalId: 'x',
        collectedAt: new Date().toISOString(),
        name: 'Test',
        coordinates: { latitude: 100, longitude: 0 },
        sourceMetadata: {},
      }),
    /coordinates/,
  );
});

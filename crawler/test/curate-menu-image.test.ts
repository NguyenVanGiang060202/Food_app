import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/cli/curate-menu-image';

const base = [
  '--restaurant-id', '00000000-0000-0000-0000-000000000001',
  '--image-id', '00000000-0000-0000-0000-000000000002',
  '--entry', 'Bún bò Góc Huế đặc biệt|87000',
];

test('official PDF curation requires an HTTPS PDF and a bounded page number', () => {
  const valid = parseArgs([...base, '--official-pdf-url', 'https://example.test/menu.pdf', '--official-pdf-page', '4']);
  assert.deepEqual(valid.officialPdf, { url: 'https://example.test/menu.pdf', page: 4 });
  assert.equal(parseArgs(base).officialPdf, null);
  assert.throws(() => parseArgs([...base, '--official-pdf-url', 'https://example.test/menu.pdf']));
  assert.throws(() => parseArgs([...base, '--official-pdf-page', '4']));
  assert.throws(() => parseArgs([...base, '--official-pdf-url', 'http://example.test/menu.pdf', '--official-pdf-page', '4']));
  assert.throws(() => parseArgs([...base, '--official-pdf-url', 'https://example.test/menu.html', '--official-pdf-page', '4']));
});

test('official menu image curation requires HTTPS image URL and reviewed SHA-256', () => {
  const sha256 = 'a'.repeat(64);
  const imageArgs = ['--official-menu-image-url', 'https://example.test/menu-page.png', '--official-menu-image-sha256', sha256];
  assert.deepEqual(parseArgs([...base, ...imageArgs]).officialImage, { url: 'https://example.test/menu-page.png', sha256 });
  assert.equal(parseArgs(base).officialImage, null);
  assert.throws(() => parseArgs([...base, '--official-menu-image-url', 'https://example.test/menu.png']));
  assert.throws(() => parseArgs([...base, '--official-menu-image-sha256', sha256]));
  assert.throws(() => parseArgs([...base, '--official-menu-image-url', 'http://example.test/menu.png', '--official-menu-image-sha256', sha256]));
  assert.throws(() => parseArgs([...base, '--official-menu-image-url', 'https://example.test/menu.html', '--official-menu-image-sha256', sha256]));
  assert.throws(() => parseArgs([...base, '--official-menu-image-url', 'https://example.test/menu.png', '--official-menu-image-sha256', 'bad']));
  assert.throws(() => parseArgs([...base, ...imageArgs, '--official-pdf-url', 'https://example.test/menu.pdf', '--official-pdf-page', '1']));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  buildSearchDocument,
  contentHash,
  EMBEDDING_TEMPLATE_VERSION,
  embeddingModelId,
} from '../src/embedding/search-document';
import { OpenAICompatibleEmbeddingProvider } from '../src/embedding/embedding-provider';
import { selectEmbeddingTargets, EmbeddingCandidateRow } from '../src/embedding/embedding-loader';

const baseSource = {
  name: 'Bún Bò Huế Cô Hường',
  normalizedName: 'bun bo hue co huong',
  categories: ['noodle'],
  dishes: ['Bún bò Huế', 'Bún riêu'],
  district: 'Quận 1',
  city: 'Hồ Chí Minh',
  priceLevel: 2,
  profile: 'Nước dùng đậm đà, thịt bò mềm, khách khen no bụng.',
  attributes: ['Cay', 'Nóng', 'Thịt bò'],
  reviews: ['Nước dùng ngon, khách đông nhưng phục vụ nhanh'],
};

test('buildSearchDocument is deterministic and includes structured fields', () => {
  const first = buildSearchDocument(baseSource);
  const second = buildSearchDocument(baseSource);
  assert.equal(first, second);
  assert.match(first, /Bún Bò Huế Cô Hường/);
  assert.match(first, /profile: Nước dùng đậm đà/);
  assert.match(first, /categories: noodle/);
  assert.match(first, /dishes: Bún bò Huế, Bún riêu/);
  assert.match(first, /attributes: Cay, Nóng, Thịt bò/);
  assert.match(first, /reviews: Nước dùng ngon/);
  assert.match(first, /location: Quận 1, Hồ Chí Minh/);
  assert.match(first, /price level: 2\/4/);
});

test('buildSearchDocument omits empty optional fields', () => {
  const doc = buildSearchDocument({
    name: 'Quán A',
    normalizedName: 'quan a',
    categories: [],
    dishes: [],
    priceLevel: null,
    district: null,
    city: null,
  });
  assert.equal(doc, 'Quán A | normalized name: quan a');
});

test('contentHash is stable and changes when the document changes', () => {
  const hashA = contentHash(buildSearchDocument(baseSource));
  const hashB = contentHash(buildSearchDocument(baseSource));
  assert.equal(hashA, hashB);
  const changed = contentHash(buildSearchDocument({ ...baseSource, dishes: ['Bún bò Huế'] }));
  assert.notEqual(changed, hashA);
  assert.match(hashA, /^[0-9a-f]{64}$/);
});

test('embeddingModelId binds the provider model to the template version', () => {
  assert.equal(
    embeddingModelId('text-embedding-3-small'),
    `text-embedding-3-small@doc:${EMBEDDING_TEMPLATE_VERSION}`,
  );
});

test('selectEmbeddingTargets backfills only restaurants without a vector', () => {
  const candidates: EmbeddingCandidateRow[] = [
    {
      restaurantId: 'a',
      source: baseSource,
      existingHash: null,
    },
    {
      restaurantId: 'b',
      source: baseSource,
      existingHash: 'some-hash',
    },
  ];
  const targets = selectEmbeddingTargets(candidates, { refresh: false });
  assert.equal(targets.length, 1);
  assert.equal(targets[0].restaurantId, 'a');
  assert.equal(targets[0].hasExisting, false);
  assert.match(targets[0].documentHash, /^[0-9a-f]{64}$/);
});

test('selectEmbeddingTargets refresh re-embeds only changed documents', () => {
  const candidates: EmbeddingCandidateRow[] = [
    {
      restaurantId: 'unchanged',
      source: baseSource,
      existingHash: contentHash(buildSearchDocument(baseSource)),
    },
    {
      restaurantId: 'changed',
      source: { ...baseSource, dishes: ['Bún bò Huế'] },
      existingHash: contentHash(buildSearchDocument(baseSource)),
    },
  ];
  const targets = selectEmbeddingTargets(candidates, { refresh: true });
  assert.equal(targets.length, 1);
  assert.equal(targets[0].restaurantId, 'changed');
  assert.equal(targets[0].hasExisting, true);
});

test('provider posts an OpenAI-compatible embeddings request', async () => {
  const server = await startEmbeddingServer({ dimensions: 3 });
  try {
    const provider = new OpenAICompatibleEmbeddingProvider({
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
      apiKey: 'secret-key',
      model: 'test-model',
      dimensions: 3,
    });
    const vector = await provider.generateEmbedding('phở bò');
    assert.deepEqual(vector, [0.1, 0.2, 0.3]);
  } finally {
    server.close();
  }
});

test('provider throws on a non-2xx response', async () => {
  const server = await startEmbeddingServer({ dimensions: 3, status: 429 });
  try {
    const provider = new OpenAICompatibleEmbeddingProvider({
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
      apiKey: 'secret-key',
      model: 'test-model',
    });
    await assert.rejects(provider.generateEmbedding('phở bò'), /embedding provider 429/);
  } finally {
    server.close();
  }
});

test('provider rejects a dimension mismatch', async () => {
  const server = await startEmbeddingServer({ dimensions: 3 });
  try {
    const provider = new OpenAICompatibleEmbeddingProvider({
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
      apiKey: 'secret-key',
      model: 'test-model',
      dimensions: 5,
    });
    await assert.rejects(
      provider.generateEmbedding('phở bò'),
      /dimension mismatch: expected 5, got 3/,
    );
  } finally {
    server.close();
  }
});

function startEmbeddingServer(options: {
  dimensions: number;
  status?: number;
}): Promise<{ port: number; close: () => void }> {
  const server: Server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const payload = JSON.parse(body);
      const vector = Array.from({ length: options.dimensions }, (_, index) => (index + 1) / 10);
      response.writeHead(options.status ?? 200, {
        'Content-Type': 'application/json',
      });
      response.end(
        JSON.stringify({
          model: payload.model,
          data: [{ embedding: vector }],
          usage: { total_tokens: 1 },
        }),
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        close: () => server.close(),
      });
    });
  });
}

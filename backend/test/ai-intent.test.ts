import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { normalizeAiIntent } from '../src/modules/ai/ai.types';
import { OpenAICompatibleAiClient } from '../src/modules/ai/openai-compatible-ai.client';
import { AiIntentService } from '../src/modules/ai/ai-intent.service';

test('normalizeAiIntent keeps only taxonomy categories and bounds fields', () => {
  const allowed = new Set(['noodle', 'bun', 'coffee-shop']);
  const intent = normalizeAiIntent(
    {
      categories: ['noodle', 'bun', 'made-up-category'],
      dishes: ['Phở bò', 'Phở bò', 'Bún riêu'],
      tastes: ['nóng', 'cay', 'nóng'],
      district: 'quận 1',
      priceLevel: 2,
      minRating: 4.5,
      openNow: true,
      distanceKm: 7,
      summary: '  Bếp hiểu bạn muốn ăn mì ở quận 1.  ',
    },
    allowed,
  );
  assert.deepEqual(intent.categories, ['noodle', 'bun']);
  assert.deepEqual(intent.dishes, ['Phở bò', 'Bún riêu']);
  assert.deepEqual(intent.tastes, ['nóng', 'cay']);
  assert.equal(intent.district, 'Quận 1');
  assert.equal(intent.priceLevel, 2);
  assert.equal(intent.minRating, 4.5);
  assert.equal(intent.openNow, true);
  assert.equal(intent.distanceKm, 7);
  assert.equal(intent.summary, 'Bếp hiểu bạn muốn ăn mì ở quận 1.');
});

test('normalizeAiIntent rejects out-of-range and malformed fields', () => {
  const intent = normalizeAiIntent(
    {
      categories: [],
      dishes: 'not-an-array',
      priceLevel: 9,
      minRating: 2.1,
      openNow: 'yes',
      distanceKm: 100,
      district: 'Hà Nội',
      summary: 42,
    },
    new Set(['noodle', 'bun']),
  );
  assert.deepEqual(intent.categories, []);
  assert.deepEqual(intent.dishes, []);
  assert.equal(intent.priceLevel, null);
  assert.equal(intent.minRating, null);
  assert.equal(intent.openNow, null);
  assert.equal(intent.distanceKm, null);
  assert.equal(intent.district, null);
  assert.equal(intent.summary, null);
});

test('client posts an OpenAI-compatible chat request and parses JSON', async () => {
  const server = await startMockServer('{"categories":["noodle"]}');
  try {
    const client = new OpenAICompatibleAiClient({
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
      apiKey: 'test-key',
      model: 'gemini-flash',
      timeoutMs: 5000,
    });
    const result = await client.chatJson('system', 'user');
    assert.deepEqual(result, { categories: ['noodle'] });
  } finally {
    server.close();
  }
});

test('client throws on a non-2xx response', async () => {
  const server = await startMockServer('{}', { status: 429 });
  try {
    const client = new OpenAICompatibleAiClient({
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
      apiKey: 'test-key',
      model: 'x',
      timeoutMs: 5000,
    });
    await assert.rejects(client.chatJson('system', 'user'), /AI provider 429/);
  } finally {
    server.close();
  }
});

test('AiIntentService is disabled when no API key is configured', async () => {
  const previous = process.env.AI_API_KEY;
  delete process.env.AI_API_KEY;
  try {
    const service = new AiIntentService({} as never);
    assert.equal(service.isEnabled(), false);
    assert.equal(await service.interpret('phở nóng quận 1'), null);
  } finally {
    if (previous !== undefined) process.env.AI_API_KEY = previous;
  }
});

test('AiIntentService interprets and keeps only database taxonomy categories', async () => {
  const database = {
    query: async () => ({ rows: [{ slug: 'noodle' }, { slug: 'bun' }] }),
  };
  const client = {
    chatJson: async () => ({
      categories: ['noodle', 'made-up'],
      dishes: ['phở bò'],
      tastes: ['nóng'],
      district: 'Quận 1',
      priceLevel: null,
      minRating: null,
      openNow: null,
      distanceKm: 5,
      summary: 'Bếp sẽ tìm món phở.',
    }),
  };
  const service = new AiIntentService(database as never, client as never);
  const intent = await service.interpret('quán phở nóng gần quận 1');
  assert.ok(intent);
  assert.deepEqual(intent.categories, ['noodle']);
  assert.deepEqual(intent.dishes, ['phở bò']);
  assert.equal(intent.district, 'Quận 1');
  assert.equal(intent.distanceKm, 5);
});

test('AiIntentService falls back to null when the provider fails', async () => {
  const database = { query: async () => ({ rows: [{ slug: 'noodle' }] }) };
  const client = {
    chatJson: async () => {
      throw new Error('provider down');
    },
  };
  const service = new AiIntentService(database as never, client as never);
  assert.equal(await service.interpret('phở'), null);
});

function startMockServer(
  content: string,
  options: { status?: number } = {},
): Promise<{ port: number; close: () => void }> {
  const server: Server = createServer((request, response) => {
    let payload = '';
    request.on('data', (chunk) => {
      payload += chunk;
    });
    request.on('end', () => {
      if (request.headers.authorization !== 'Bearer test-key') {
        response.writeHead(401, { 'Content-Type': 'application/json' });
        response.end('{}');
        return;
      }
      const json = JSON.parse(payload);
      assert.deepEqual(json.response_format, { type: 'json_object' });
      response.writeHead(options.status ?? 200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content } }],
        }),
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ port, close: () => server.close() });
    });
  });
}

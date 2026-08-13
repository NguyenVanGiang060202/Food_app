import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EmbeddingService } from '../src/modules/ai/embedding.service';

const EMBEDDING_ENV = [
  'EMBEDDING_BASE_URL',
  'EMBEDDING_API_KEY',
  'EMBEDDING_MODEL',
  'EMBEDDING_DIMENSIONS',
  'EMBEDDING_TIMEOUT_MS',
] as const;

function withEmbeddingEnv(
  values: Partial<Record<(typeof EMBEDDING_ENV)[number], string>>,
  run: () => void | Promise<void>,
): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const key of EMBEDDING_ENV) {
    previous.set(key, process.env[key]);
  }
  for (const key of EMBEDDING_ENV) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const key of EMBEDDING_ENV) {
        const value = previous.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test('EmbeddingService is disabled when the provider is not fully configured', async () => {
  await withEmbeddingEnv(
    { EMBEDDING_BASE_URL: 'http://localhost:11434/v1', EMBEDDING_MODEL: 'bge-m3' },
    () => {
      const service = new EmbeddingService({} as never);
      assert.equal(service.isEnabled(), false);
    },
  );
  await withEmbeddingEnv(
    {
      EMBEDDING_BASE_URL: 'http://localhost:11434/v1',
      EMBEDDING_API_KEY: 'ollama',
      EMBEDDING_MODEL: 'bge-m3',
    },
    () => {
      const service = new EmbeddingService({} as never);
      assert.equal(service.isEnabled(), true);
    },
  );
});

test('embed posts an OpenAI-compatible /embeddings request and returns the vector', async () => {
  const server = await startEmbeddingServer((body) => {
    assert.equal(body.model, 'bge-m3');
    assert.equal(body.input, 'bún bò huế cay đậm đà');
    assert.equal(body.encoding_format, 'float');
  });
  try {
    await withEmbeddingEnv(
      {
        EMBEDDING_BASE_URL: `http://127.0.0.1:${server.port}/v1`,
        EMBEDDING_API_KEY: 'ollama',
        EMBEDDING_MODEL: 'bge-m3',
      },
      async () => {
        const service = new EmbeddingService({} as never);
        const vector = await service.embed('bún bò huế cay đậm đà');
        assert.deepEqual(vector, [0.1, 0.2, 0.3]);
      },
    );
  } finally {
    server.close();
  }
});

test('embed forwards the requested dimensions and rejects mismatched vectors', async () => {
  const server = await startEmbeddingServer((body) => {
    assert.equal(body.dimensions, 3);
  });
  try {
    await withEmbeddingEnv(
      {
        EMBEDDING_BASE_URL: `http://127.0.0.1:${server.port}/v1`,
        EMBEDDING_API_KEY: 'ollama',
        EMBEDDING_MODEL: 'bge-m3',
        EMBEDDING_DIMENSIONS: '3',
      },
      async () => {
        const service = new EmbeddingService({} as never);
        // Default mock response is 3 dimensions, so this matches and returns.
        assert.deepEqual(await service.embed('x'), [0.1, 0.2, 0.3]);
        server.respondWith({ data: [{ embedding: [0.1, 0.2] }] });
        await assert.rejects(service.embed('x'), /dimension mismatch: expected 3, got 2/);
      },
    );
  } finally {
    server.close();
  }
});

test('embed throws on a non-2xx response from the provider', async () => {
  const server = await startEmbeddingServer(() => {}, { status: 429 });
  try {
    await withEmbeddingEnv(
      {
        EMBEDDING_BASE_URL: `http://127.0.0.1:${server.port}/v1`,
        EMBEDDING_API_KEY: 'ollama',
        EMBEDDING_MODEL: 'bge-m3',
      },
      async () => {
        const service = new EmbeddingService({} as never);
        await assert.rejects(service.embed('x'), /embedding provider 429/);
      },
    );
  } finally {
    server.close();
  }
});

test('embed throws when the provider response has no embedding data', async () => {
  const server = await startEmbeddingServer(() => {});
  try {
    server.respondWith({ data: [{ embedding: undefined }] });
    await withEmbeddingEnv(
      {
        EMBEDDING_BASE_URL: `http://127.0.0.1:${server.port}/v1`,
        EMBEDDING_API_KEY: 'ollama',
        EMBEDDING_MODEL: 'bge-m3',
      },
      async () => {
        const service = new EmbeddingService({} as never);
        await assert.rejects(service.embed('x'), /missing embedding data/);
      },
    );
  } finally {
    server.close();
  }
});

test('activeModel returns the most recently embedded model from the database', async () => {
  const calls: string[] = [];
  const database = {
    query: async <T extends object>(text: string) => {
      calls.push(text);
      return { rows: [{ model: 'bge-m3@doc:v3' }] as T[], rowCount: 1 };
    },
  };
  const service = new EmbeddingService(database as never);
  const model = await service.activeModel();
  assert.equal(model, 'bge-m3@doc:v3');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /ORDER BY MAX\(created_at\) DESC/);
});

test('activeModel caches the resolved model for the cache window', async () => {
  let calls = 0;
  const database = {
    query: async <T extends object>() => {
      calls += 1;
      return { rows: [{ model: 'bge-m3@doc:v3' }] as T[], rowCount: 1 };
    },
  };
  const service = new EmbeddingService(database as never);
  assert.equal(await service.activeModel(), 'bge-m3@doc:v3');
  assert.equal(await service.activeModel(), 'bge-m3@doc:v3');
  assert.equal(calls, 1);
});

test('activeModel degrades to null when the embedding table is missing', async () => {
  const database = {
    query: async () => {
      throw new Error('relation "restaurant_embedding" does not exist');
    },
  };
  const service = new EmbeddingService(database as never);
  assert.equal(await service.activeModel(), null);
  assert.equal(await service.activeModel(), null);
});

function startEmbeddingServer(
  onBody: (body: { model: string; input: string; encoding_format?: string; dimensions?: number }) => void,
  options: { status?: number } = {},
): Promise<{ port: number; close: () => void; respondWith: (payload: unknown) => void }> {
  let pendingResponse: unknown = null;
  const server: Server = createServer((request, response) => {
    let payload = '';
    request.on('data', (chunk) => {
      payload += chunk;
    });
    request.on('end', () => {
      if (request.headers.authorization !== 'Bearer ollama') {
        response.writeHead(401, { 'Content-Type': 'application/json' });
        response.end('{}');
        return;
      }
      onBody(JSON.parse(payload));
      const content = JSON.stringify(
        pendingResponse ?? { data: [{ embedding: [0.1, 0.2, 0.3] }] },
      );
      response.writeHead(options.status ?? 200, { 'Content-Type': 'application/json' });
      response.end(content);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        close: () => server.close(),
        respondWith: (payload: unknown) => {
          pendingResponse = payload;
        },
      });
    });
  });
}

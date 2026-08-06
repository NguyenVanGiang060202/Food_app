import assert from 'node:assert/strict';
import test from 'node:test';
import { readSessionResponse } from '../src/lib/auth-session.ts';

function response(status: number, body: unknown) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

test('readSessionResponse returns the user for a valid session', async () => {
  const user = { id: 'user-1', email: 'user@example.com' };
  assert.deepEqual(await readSessionResponse(response(200, { user })), user);
});

test('readSessionResponse returns null for an unauthenticated session', async () => {
  assert.equal(await readSessionResponse(response(401, { error: 'unauthorized' })), null);
  assert.equal(await readSessionResponse(response(403, { error: 'forbidden' })), null);
});

test('readSessionResponse preserves server failures as errors', async () => {
  await assert.rejects(() => readSessionResponse(response(503, { error: 'unavailable' })));
});

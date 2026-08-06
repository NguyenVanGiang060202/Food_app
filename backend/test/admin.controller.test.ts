import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AdminController } from '../src/modules/admin/admin.controller';

type QueryCall = { text: string; values: unknown[] };

function createController(rows: Array<Record<string, unknown>>) {
  const calls: QueryCall[] = [];
  const database = {
    async query<T extends object>(text: string, values: unknown[] = []) {
      calls.push({ text, values });
      return { rows } as { rows: T[] };
    },
  };
  return { controller: new AdminController(database as never), calls };
}

test('retryProcessing enqueues a discovery crawl run and returns its id', async () => {
  const { controller, calls } = createController([
    { id: 'record-1', attempt_count: 2, retry_run_id: 'run-2' },
  ]);

  const response = await controller.retryProcessing({ id: 'record-1' });

  assert.deepEqual(response, {
    data: { id: 'record-1', status: 'queued', retryRunId: 'run-2', attemptCount: 2 },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, ['record-1']);
  assert.match(calls[0].text, /cr\.job_type = 'discovery'/);
  assert.match(calls[0].text, /INSERT INTO crawl_run/);
  assert.match(calls[0].text, /SET status = 'skipped'/);
});

test('retryProcessing rejects records that cannot be re-enqueued', async () => {
  const { controller } = createController([]);

  await assert.rejects(
    () => controller.retryProcessing({ id: 'record-1' }),
    (error: unknown) => error instanceof ConflictException && /not eligible/.test(error.message),
  );
});

test('createCrawlRun queues an active Playwright discovery run with a bounded target', async () => {
  const { controller, calls } = createController([{ id: 'run-1' }]);

  const response = await controller.createCrawlRun({
    providerCode: 'google_maps_playwright',
    jobType: 'discovery',
    target: { query: 'bún bò', location: 'District 1, Ho Chi Minh City', limit: 5 },
  });

  assert.deepEqual(response, {
    data: {
      id: 'run-1',
      providerCode: 'google_maps_playwright',
      jobType: 'discovery',
      status: 'queued',
      target: { query: 'bún bò', location: 'District 1, Ho Chi Minh City', limit: 5 },
    },
  });
  assert.deepEqual(calls[0].values, [
    'google_maps_playwright',
    'discovery',
    JSON.stringify({ query: 'bún bò', location: 'District 1, Ho Chi Minh City', limit: 5 }),
  ]);
  assert.match(calls[0].text, /is_active = true/);
  assert.match(calls[0].text, /'queued'/);
});

test('createCrawlRun rejects an unbounded target field', async () => {
  const { controller, calls } = createController([{ id: 'run-1' }]);

  await assert.rejects(
    () =>
      controller.createCrawlRun({
        providerCode: 'google_maps_playwright',
        jobType: 'discovery',
        target: { query: 'bún bò', cookies: 'not allowed' },
      }),
    (error: unknown) =>
      error instanceof BadRequestException &&
      /Unsupported crawl target field: cookies/.test(error.message),
  );
  assert.equal(calls.length, 0);
});

test('createCrawlRun rejects inactive providers', async () => {
  const { controller } = createController([]);

  await assert.rejects(
    () =>
      controller.createCrawlRun({
        providerCode: 'google_maps',
        jobType: 'discovery',
        target: { query: 'phở', limit: 1 },
      }),
    (error: unknown) => error instanceof ConflictException && /not active/.test(error.message),
  );
});

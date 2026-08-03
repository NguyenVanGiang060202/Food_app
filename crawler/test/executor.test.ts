import test from 'node:test';
import assert from 'node:assert/strict';
import type { DataProviderAdapter } from '../src/providers/provider.interface';
import type { SourceRestaurantRecord } from '../src/types/source-record';
import { DiscoveryCrawlExecutor, type CrawlRunPipeline } from '../src/jobs/discovery-crawl.executor';
import type { CrawlRunJob } from '../src/queue/crawl-run.repository';

const job: CrawlRunJob = { id: 'run-1', providerCode: 'provider', jobType: 'discovery', target: { city: 'HCMC', limit: 2.9 } };
const validRecord: SourceRestaurantRecord = { providerCode: 'provider', externalId: 'restaurant-1', collectedAt: '2026-01-01T00:00:00.000Z', name: ' Nhà   Mình ', sourceMetadata: {} };

test('discovery executor processes valid records and completes with counters', async () => {
    const processed: string[] = [];
    const failures: unknown[] = [];
    let completed: [string, number, number] | undefined;
    const pipeline: CrawlRunPipeline = {
        async process(runId, record) { processed.push(`${runId}:${record.normalizedName}`); return 'restaurant-1'; },
        async recordFailure(...args) { failures.push(args); },
        async finishCrawlRun(...args) { completed = args; },
    };
    const provider: DataProviderAdapter = { providerCode: 'provider', async validateConfiguration() { }, async *discover(input) { assert.equal(input.limit, 2); yield validRecord; } };

    await new DiscoveryCrawlExecutor(pipeline).execute(job, provider);

    assert.deepEqual(processed, ['run-1:nha minh']);
    assert.deepEqual(completed, ['run-1', 1, 1]);
    assert.deepEqual(failures, []);
});

test('discovery executor skips invalid records but still completes the run', async () => {
    let processed = 0;
    const failures: Array<[string, string | undefined, 'validation' | 'normalization', unknown]> = [];
    let completed: [string, number, number] | undefined;
    const invalidRecord = { ...validRecord, externalId: 'invalid', name: '' };
    const pipeline: CrawlRunPipeline = {
        async process() { processed += 1; return 'restaurant-1'; },
        async recordFailure(...args) { failures.push(args); },
        async finishCrawlRun(...args) { completed = args; },
    };
    const provider: DataProviderAdapter = { providerCode: 'provider', async validateConfiguration() { }, async *discover() { yield invalidRecord; yield validRecord; } };

    await new DiscoveryCrawlExecutor(pipeline).execute(job, provider);

    assert.equal(processed, 1);
    assert.deepEqual(completed, ['run-1', 2, 1]);
    assert.equal(failures.length, 1);
    assert.deepEqual(failures[0].slice(0, 3), ['run-1', 'invalid', 'validation']);
});

test('discovery executor rejects unsupported crawl job types', async () => {
    const pipeline: CrawlRunPipeline = {
        async process() { return 'restaurant-1'; },
        async recordFailure() { throw new Error('must not record'); },
        async finishCrawlRun() { throw new Error('must not finish'); },
    };
    const provider: DataProviderAdapter = { providerCode: 'provider', async validateConfiguration() { }, async *discover() { } };

    await assert.rejects(
        () => new DiscoveryCrawlExecutor(pipeline).execute({ ...job, jobType: 'backfill' }, provider),
        /Unsupported crawl job type/,
    );
});
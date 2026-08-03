import test from 'node:test';
import assert from 'node:assert/strict';
import type { DataProviderAdapter } from '../src/providers/provider.interface';
import type { CrawlRunJob } from '../src/queue/crawl-run.repository';
import { CrawlRunWorker, type CrawlRunStore } from '../src/jobs/crawl-run.worker';

const provider: DataProviderAdapter = {
    providerCode: 'approved-provider',
    async validateConfiguration() { },
    async *discover() { },
};

const job: CrawlRunJob = { id: 'run-1', providerCode: provider.providerCode, jobType: 'discovery', target: {} };

function store(next: CrawlRunJob | undefined): CrawlRunStore & { failed: Array<{ id: string; error: unknown }> } {
    const failed: Array<{ id: string; error: unknown }> = [];
    return { failed, async claimNext() { return next; }, async markFailed(id, error) { failed.push({ id, error }); } };
}

test('worker returns false when no queued crawl run exists', async () => {
    const repository = store(undefined);
    const worker = new CrawlRunWorker(repository, new Map([[provider.providerCode, provider]]), { async execute() { throw new Error('must not execute'); } });
    assert.equal(await worker.runOnce(), false);
    assert.deepEqual(repository.failed, []);
});

test('worker fails a run when its provider is not registered', async () => {
    const repository = store({ ...job, providerCode: 'missing-provider' });
    const worker = new CrawlRunWorker(repository, new Map(), { async execute() { throw new Error('must not execute'); } });
    assert.equal(await worker.runOnce(), true);
    assert.equal(repository.failed.length, 1);
    assert.match(String(repository.failed[0].error), /No provider adapter/);
});

test('worker validates provider and records executor failures', async () => {
    const repository = store(job);
    let validated = false;
    const configuredProvider: DataProviderAdapter = { ...provider, async validateConfiguration() { validated = true; } };
    const worker = new CrawlRunWorker(repository, new Map([[provider.providerCode, configuredProvider]]), { async execute() { throw new Error('executor failed'); } });
    assert.equal(await worker.runOnce(), true);
    assert.equal(validated, true);
    assert.equal(repository.failed[0].id, job.id);
    assert.match(String(repository.failed[0].error), /executor failed/);
});

test('worker rejects a provider registry identity mismatch', async () => {
    const repository = store(job);
    const mismatchedProvider: DataProviderAdapter = { ...provider, providerCode: 'different-provider' };
    const worker = new CrawlRunWorker(repository, new Map([[provider.providerCode, mismatchedProvider]]), { async execute() { throw new Error('must not execute'); } });

    assert.equal(await worker.runOnce(), true);
    assert.match(String(repository.failed[0].error), /identity mismatch/);
});
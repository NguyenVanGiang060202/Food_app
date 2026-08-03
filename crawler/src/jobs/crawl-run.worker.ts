import type { DataProviderAdapter } from '../providers/provider.interface';
import type { CrawlRunJob } from '../queue/crawl-run.repository';

export interface CrawlRunStore {
    claimNext(): Promise<CrawlRunJob | undefined>;
    markFailed(id: string, error: unknown): Promise<void>;
    renewLease?(id: string): Promise<void>;
}

export interface CrawlRunExecutor {
    execute(job: CrawlRunJob, provider: DataProviderAdapter): Promise<void>;
}

export class CrawlRunWorker {
    constructor(
        private readonly repository: CrawlRunStore,
        private readonly providers: ReadonlyMap<string, DataProviderAdapter>,
        private readonly executor: CrawlRunExecutor,
    ) { }

    async runOnce(): Promise<boolean> {
        const job = await this.repository.claimNext();
        if (!job) return false;
        const provider = this.providers.get(job.providerCode);
        if (!provider) {
            await this.repository.markFailed(job.id, new Error(`No provider adapter is registered for '${job.providerCode}'.`));
            return true;
        }
        if (provider.providerCode !== job.providerCode) {
            await this.repository.markFailed(job.id, new Error(`Provider registry identity mismatch for '${job.providerCode}'.`));
            return true;
        }
        try {
            await provider.validateConfiguration();
            const heartbeat = this.repository.renewLease
                ? setInterval(() => void this.repository.renewLease!(job.id), 30_000)
                : undefined;
            try {
                await this.executor.execute(job, provider);
            } finally {
                if (heartbeat) clearInterval(heartbeat);
            }
        } catch (error) {
            await this.repository.markFailed(job.id, error);
        }
        return true;
    }
}
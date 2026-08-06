import { normalizeSourceRecord } from '../pipeline/normalizer';
import { validateSourceRecord } from '../validation/source-record.validation';
import type { DataProviderAdapter } from '../providers/provider.interface';
import type { DiscoveryInput, SourceRestaurantRecord } from '../types/source-record';
import type { CrawlRunExecutor } from './crawl-run.worker';
import type { CrawlRunJob } from '../queue/crawl-run.repository';

export interface CrawlRunPipeline {
  process(crawlRunId: string, record: ReturnType<typeof normalizeSourceRecord>): Promise<string>;
  recordFailure(
    crawlRunId: string,
    externalId: string | undefined,
    stage: 'validation' | 'normalization',
    error: unknown,
  ): Promise<void>;
  finishCrawlRun(crawlRunId: string, recordsFound: number, recordsProcessed: number): Promise<void>;
}

export class DiscoveryCrawlExecutor implements CrawlRunExecutor {
  constructor(private readonly pipeline: CrawlRunPipeline) {}

  async execute(job: CrawlRunJob, provider: DataProviderAdapter): Promise<void> {
    if (job.jobType !== 'discovery') {
      throw new Error(
        `Unsupported crawl job type '${job.jobType}'. Discovery executor accepts only 'discovery'.`,
      );
    }
    const input = toDiscoveryInput(job.target);
    let recordsFound = 0;
    let recordsProcessed = 0;

    for await (const record of provider.discover(input)) {
      recordsFound += 1;
      try {
        try {
          validateSourceRecord(record);
        } catch (error) {
          await this.pipeline.recordFailure(job.id, record.externalId, 'validation', error);
          throw error;
        }
        try {
          await this.pipeline.process(job.id, normalizeSourceRecord(record));
        } catch (error) {
          await this.pipeline.recordFailure(job.id, record.externalId, 'normalization', error);
          throw error;
        }
        recordsProcessed += 1;
      } catch (error) {
        reportRecordFailure(record, error);
      }
    }

    await this.pipeline.finishCrawlRun(job.id, recordsFound, recordsProcessed);
  }
}

function toDiscoveryInput(target: Record<string, unknown>): DiscoveryInput {
  const limit =
    typeof target.limit === 'number' && Number.isFinite(target.limit)
      ? Math.max(1, Math.floor(target.limit))
      : 50;
  return {
    city: optionalString(target.city),
    district: optionalString(target.district),
    category: optionalString(target.category),
    query: optionalString(target.query),
    location: optionalString(target.location),
    limit,
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function reportRecordFailure(record: SourceRestaurantRecord, error: unknown): void {
  console.error(
    JSON.stringify({
      event: 'crawl_record_failed',
      externalId: record.externalId,
      message: error instanceof Error ? error.message : 'Unknown record failure.',
    }),
  );
}

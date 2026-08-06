import { GoogleMapsPlaywrightProvider } from '../providers/google-maps/google-maps-playwright.provider';
import { CanonicalUpsertPipeline } from '../pipeline/canonical-upsert.pipeline';
import { DiscoveryCrawlExecutor } from '../jobs/discovery-crawl.executor';
import type { CrawlRunJob } from '../queue/crawl-run.repository';

const QUERY = process.env.CRAWL_QUERY || 'bún bò';
const LOCATION = process.env.CRAWL_LOCATION || 'Quận 1, Hồ Chí Minh';
const MAX_RESULTS = Number(process.env.CRAWL_MAX_RESULTS) || 10;
const HEADLESS = process.env.CRAWL_HEADLESS !== 'false';

async function main(): Promise<void> {
  const provider = new GoogleMapsPlaywrightProvider({
    maxResults: MAX_RESULTS,
    maxScrollAttempts: 10,
    headless: HEADLESS,
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
    maxReviewsPerPlace: Number(process.env.CRAWL_MAX_REVIEWS_PER_PLACE) || 5,
  });

  console.error(
    JSON.stringify({
      event: 'crawl_start',
      query: QUERY,
      location: LOCATION,
      maxResults: MAX_RESULTS,
    }),
  );

  const pipeline = new CanonicalUpsertPipeline();
  let crawlRunId: string | undefined;
  const target = {
    query: QUERY,
    location: LOCATION,
    limit: Math.min(Math.max(MAX_RESULTS, 1), 50),
  };

  try {
    await provider.validateConfiguration();
    crawlRunId = await pipeline.createCrawlRun(provider.providerCode, target);
    const job: CrawlRunJob = {
      id: crawlRunId,
      providerCode: provider.providerCode,
      jobType: 'discovery',
      target,
    };
    await new DiscoveryCrawlExecutor(pipeline).execute(job, provider);
    console.error(JSON.stringify({ event: 'crawl_complete', crawlRunId }));
  } catch (error) {
    if (crawlRunId) {
      await pipeline.failCrawlRun(crawlRunId, 0, 0, error);
    }
    throw error;
  } finally {
    await pipeline.close();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: 'crawl_fatal',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
  );
  process.exitCode = 1;
});

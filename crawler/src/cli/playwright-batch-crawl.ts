import { GoogleMapsPlaywrightProvider } from '../providers/google-maps/google-maps-playwright.provider';
import { CanonicalUpsertPipeline } from '../pipeline/canonical-upsert.pipeline';
import { DiscoveryCrawlExecutor } from '../jobs/discovery-crawl.executor';
import { buildPlaywrightQueryPlan } from './playwright-query-plan';
import type { CrawlRunJob } from '../queue/crawl-run.repository';

const CITY = process.env.CRAWL_CITY || 'Ho Chi Minh City';
const DISTRICTS = process.env.CRAWL_DISTRICTS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
const LIMIT_PER_QUERY = Number(process.env.CRAWL_LIMIT_PER_QUERY || 10);
const MAX_QUERIES = Math.min(Math.max(Number(process.env.CRAWL_MAX_QUERIES || 500), 1), 500);
const HEARTBEAT_SECONDS = Math.max(Number(process.env.CRAWL_HEARTBEAT_SECONDS || 30), 5);
const QUERIES = process.env.CRAWL_QUERIES
    ?.split(',')
    .map((query) => query.trim())
    .filter(Boolean);

const DEFAULT_DISTRICTS = [
    'Quận 1', 'Quận 3', 'Quận 4', 'Quận 5', 'Quận 6', 'Quận 7', 'Quận 8',
    'Quận 10', 'Quận 11', 'Quận 12',
    'Bình Thạnh', 'Phú Nhuận', 'Tân Bình', 'Tân Phú', 'Gò Vấp', 'Bình Tân',
    'Thủ Đức', 'Nhà Bè', 'Bình Chánh', 'Hóc Môn', 'Củ Chi', 'Cần Giờ',
];

async function main(): Promise<void> {
    const activeDistricts = DISTRICTS.length > 0 ? DISTRICTS : DEFAULT_DISTRICTS;
    const plan = buildPlaywrightQueryPlan({
        city: CITY,
        districts: activeDistricts,
        limitPerQuery: LIMIT_PER_QUERY,
        queries: QUERIES,
    }).slice(0, MAX_QUERIES);
    const provider = new GoogleMapsPlaywrightProvider({
        maxResults: LIMIT_PER_QUERY,
        maxScrollAttempts: Number(process.env.CRAWL_MAX_SCROLL_ATTEMPTS || 20),
        headless: process.env.CRAWL_HEADLESS !== 'false',
        navigationTimeout: 90_000,
        actionTimeout: 30_000,
        maxReviewsPerPlace: Number(process.env.CRAWL_MAX_REVIEWS_PER_PLACE || 5),
    });
    const pipeline = new CanonicalUpsertPipeline();
    const executor = new DiscoveryCrawlExecutor(pipeline);
    let completed = 0;
    let failed = 0;
    let currentTarget = 'initializing';
    const heartbeat = setInterval(() => {
        console.error(JSON.stringify({
            event: 'batch_crawl_heartbeat',
            completed,
            failed,
            total: plan.length,
            currentTarget,
        }));
    }, HEARTBEAT_SECONDS * 1_000);
    heartbeat.unref();

    console.error(JSON.stringify({ event: 'batch_crawl_start', city: CITY, districts: activeDistricts.length, targets: plan.length, limitPerQuery: LIMIT_PER_QUERY }));
    try {
        await provider.validateConfiguration();
        for (const [index, target] of plan.entries()) {
            const jobTarget: Record<string, unknown> = { query: target.query, location: target.location, limit: target.limit };
            currentTarget = `${index + 1}/${plan.length} ${target.query} @ ${target.location}`;
            if (await pipeline.hasCompletedRun(provider.providerCode, target.query, target.location)) {
                completed += 1;
                console.error(JSON.stringify({ event: 'batch_query_skipped', query: target.query, location: target.location }));
                continue;
            }
            const crawlRunId = await pipeline.createCrawlRun(provider.providerCode, jobTarget);
            const job: CrawlRunJob = { id: crawlRunId, providerCode: provider.providerCode, jobType: 'discovery', target: jobTarget };
            console.error(JSON.stringify({ event: 'batch_query_start', crawlRunId, query: target.query, location: target.location }));
            try {
                await executor.execute(job, provider);
                completed += 1;
            } catch (error) {
                failed += 1;
                await pipeline.failCrawlRun(crawlRunId, 0, 0, error);
                console.error(JSON.stringify({ event: 'batch_query_failed', crawlRunId, query: target.query, message: error instanceof Error ? error.message : String(error) }));
            }
        }
        console.error(JSON.stringify({ event: 'batch_crawl_complete', completed, failed, total: plan.length }));
    } finally {
        clearInterval(heartbeat);
        await pipeline.close();
    }
}

main().catch((error) => {
    console.error(JSON.stringify({ event: 'batch_crawl_fatal', message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
});
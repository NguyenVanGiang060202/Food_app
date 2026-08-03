import { CrawlRunWorker } from '../jobs/crawl-run.worker';
import { DiscoveryCrawlExecutor } from '../jobs/discovery-crawl.executor';
import { CanonicalUpsertPipeline } from '../pipeline/canonical-upsert.pipeline';
import { CrawlRunRepository } from '../queue/crawl-run.repository';
import { GoogleMapsPlaywrightProvider } from '../providers/google-maps/google-maps-playwright.provider';

async function main(): Promise<void> {
    const repository = new CrawlRunRepository();
    const pipeline = new CanonicalUpsertPipeline();
    const googleMapsPlaywright = new GoogleMapsPlaywrightProvider();
    const providers = new Map<string, import('../providers/provider.interface').DataProviderAdapter>();
    providers.set(googleMapsPlaywright.providerCode, googleMapsPlaywright);
    const worker = new CrawlRunWorker(repository, providers, new DiscoveryCrawlExecutor(pipeline));

    try {
        const claimed = await worker.runOnce();
        console.log(JSON.stringify({ event: 'crawl_worker_poll', claimed }));
    } finally {
        await pipeline.close();
        await repository.close();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
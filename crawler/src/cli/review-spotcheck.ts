// Temporary debug CLI: crawl a single place URL and report how many reviews
// the current extraction actually pulls from the live Google Maps DOM.
// Usage:
//   docker compose --profile production run --rm \
//     --entrypoint "node crawler/dist/cli/review-spotcheck.js" crawler "URL"

import { Pool } from 'pg';
import { GoogleMapsPlaywrightProvider } from '../providers/google-maps/google-maps-playwright.provider';

async function main(): Promise<void> {
  const urlArg = process.argv[2];
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let url = urlArg;
  let name: string | undefined;

  if (!url) {
    const { rows } = await pool.query<{ source_url: string; name: string }>(
      `SELECT rs.source_url, r.name
       FROM restaurant_source rs JOIN restaurant r ON r.id = rs.restaurant_id
       WHERE rs.source_url IS NOT NULL
       ORDER BY random() LIMIT 1`,
    );
    url = rows[0]?.source_url;
    name = rows[0]?.name;
  }

  if (!url) throw new Error('No URL available.');

  const provider = new GoogleMapsPlaywrightProvider({
    maxReviewsPerPlace: 20,
    headless: true,
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
  });

  console.log(`SPOTCHECK name=${name} url=${url}`);
  const started = Date.now();
  const record = await provider.fetchPlaceReviewsByUrl(url, name);
  console.log(
    JSON.stringify({
      event: 'spotcheck_result',
      elapsedMs: Date.now() - started,
      name: record?.name,
      reviewCount: record?.reviewCount,
      reviewsCaptured: record?.reviews?.length ?? 0,
      reviews: record?.reviews?.slice(0, 5),
    }),
  );
  await provider.close();
  await pool.end();
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'spotcheck_fatal', message: String(error) }));
  process.exitCode = 1;
});
// Temporary debug CLI: test whether navigating through the Google Maps search
// flow (search -> click result) renders the reviews section when a direct
// goto of the place URL serves a stripped-down DOM.
// Usage:
//   docker compose --profile production run --rm \
//     --entrypoint "node crawler/dist/cli/review-searchcheck.js" crawler

import { Pool } from 'pg';
import { chromium, type Page } from 'playwright';
import { SELECTORS } from '../providers/google-maps/selectors';

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query<{ name: string; review_count: number | null }>(
    `SELECT r.name, r.review_count
     FROM restaurant r
     WHERE r.review_count IS NOT NULL AND r.review_count > 100
     ORDER BY random() LIMIT 1`,
  );
  const name = rows[0]?.name;
  if (!name) throw new Error('No restaurant with reviews found.');
  console.log(JSON.stringify({ event: 'searchcheck_start', name, reviewCount: rows[0]?.review_count }));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'vi-VN', viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto('https://www.google.com/maps', { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(3_000);

  const searchBox = page.locator(SELECTORS.searchBoxAny).first();
  console.log(JSON.stringify({ event: 'searchcheck_searchbox', count: await searchBox.count() }));
  if ((await searchBox.count()) === 0) {
    console.log(JSON.stringify({ event: 'searchcheck_no_searchbox' }));
    await context.close();
    await browser.close();
    await pool.end();
    return;
  }
  await searchBox.fill(name);
  await searchBox.press('Enter');
  await page.waitForTimeout(6_000);

  const result = page.locator(SELECTORS.resultItemContainer).first();
  console.log(JSON.stringify({ event: 'searchcheck_results', count: await page.locator(SELECTORS.resultItemContainer).count() }));
  if ((await result.count()) > 0) {
    await result.click({ timeout: 10_000 }).catch((err: unknown) => console.log(JSON.stringify({ event: 'searchcheck_click_error', message: String(err) })));
    await page.waitForTimeout(5_000);
  }

  const containers = await page.locator(SELECTORS.reviewContainer).count();
  const tabCount = await page
    .locator('button[role="tab"]')
    .filter({ hasText: /đánh giá|review/i })
    .count();
  const reviewCountText = await page
    .evaluate(() => {
      const el = document.querySelector('div[role="main"]');
      return el?.textContent?.slice(0, 200) ?? '';
    })
    .catch(() => '');
  console.log(JSON.stringify({
    event: 'searchcheck_result',
    containers,
    tabCount,
    header: reviewCountText.replace(/\s+/g, ' ').slice(0, 160),
  }));

  await context.close();
  await browser.close();
  await pool.end();
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'searchcheck_fatal', message: String(error) }));
  process.exitCode = 1;
});
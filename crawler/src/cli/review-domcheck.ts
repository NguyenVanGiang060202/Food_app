// Temporary debug CLI: open a single place URL and dump what Google Maps
// actually renders for the review button / review panel so we can fix the
// selectors used by extractReviewsFromDetail.
// Usage:
//   docker compose --profile production run --rm \
//     --entrypoint "node crawler/dist/cli/review-domcheck.js" crawler "URL"

import { Pool } from 'pg';
import { chromium, type Page } from 'playwright';
import { SELECTORS } from '../providers/google-maps/selectors';

async function dumpMatches(page: Page, label: string, selector: string, max = 3): Promise<void> {
  const loc = page.locator(selector);
  const count = await loc.count();
  console.log(JSON.stringify({ event: 'dom_check', label, selector, count }));
  for (let i = 0; i < Math.min(count, max); i += 1) {
    const info = await loc
      .nth(i)
      .evaluate((el) => {
        const node = el as HTMLElement;
        return {
          tag: node.tagName,
          ariaLabel: node.getAttribute('aria-label'),
          jsaction: node.getAttribute('jsaction'),
          dataReviewId: node.getAttribute('data-review-id'),
          className: node.className?.toString().slice(0, 120),
          text: node.textContent?.trim().slice(0, 80),
          visible: !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length),
        };
      })
      .catch((err: unknown) => ({ error: String(err) }));
    console.log(JSON.stringify({ event: 'dom_match', label, index: i, info }));
  }
}

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

  console.log(JSON.stringify({ event: 'domcheck_start', name, url }));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'vi-VN', viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForSelector(SELECTORS.detailPanel, { timeout: 60_000 }).catch(() => {});

  await page.waitForTimeout(3_000);
  console.log(JSON.stringify({ event: 'dom_page_loaded', url: page.url() }));

  await dumpMatches(page, 'detailPanel', SELECTORS.detailPanel);
  await dumpMatches(page, 'detailReviewsButton', SELECTORS.detailReviewsButton);
  await dumpMatches(page, 'reviewContainer', SELECTORS.reviewContainer);

  // Try to click whichever review-ish button exists.
  const clicked = await (async () => {
    const btn = page.locator(SELECTORS.detailReviewsButton).first();
    if ((await btn.count()) > 0) {
      await btn.click({ timeout: 5_000 }).catch((err: unknown) => console.log(JSON.stringify({ event: 'click_error', message: String(err) })));
      return true;
    }
    return false;
  })();

  if (clicked) {
    await page.waitForTimeout(3_000);
    await dumpMatches(page, 'after_click_detailReviewsButton', SELECTORS.detailReviewsButton);
    await dumpMatches(page, 'after_click_reviewContainer', SELECTORS.reviewContainer);

    // Dump the raw HTML of the review area so we can see the current class names.
    const snippet = await page
      .evaluate(() => {
        const candidates = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-review-id], div[class*="review"], div[class*="jfti"], [role="feed"]',
          ),
        );
        const target =
          candidates.find((el) => el.getAttribute('data-review-id')) ||
          candidates.find((el) => el.textContent?.includes('đánh giá')) ||
          candidates[0];
        if (!target) return '';
        const clone = target.cloneNode(true) as HTMLElement;
        return clone.outerHTML.slice(0, 3_000);
      })
      .catch((err: unknown) => `eval error: ${String(err)}`);
    console.log(JSON.stringify({ event: 'dom_review_snippet', snippet }));
  }

  await context.close();
  await browser.close();
  await pool.end();
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'domcheck_fatal', message: String(error) }));
  process.exitCode = 1;
});
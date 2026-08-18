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
    const { rows } = await pool.query<{ source_url: string; name: string; review_count: number }>(
      `SELECT rs.source_url, r.name, r.review_count
       FROM restaurant_source rs JOIN restaurant r ON r.id = rs.restaurant_id
       WHERE rs.source_url IS NOT NULL
       ORDER BY r.review_count DESC NULLS LAST, random()
       LIMIT 1`,
    );
    url = rows[0]?.source_url;
    name = rows[0]?.name;
    console.log(JSON.stringify({ event: 'domcheck_picked', name, reviewCount: rows[0]?.review_count }));
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

  // Dump every element that looks like a reviews entry point so we can see
  // what the current Google Maps DOM actually uses (jsaction / aria-label).
  const candidates = await page.evaluate(() => {
    const els = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button[jsaction*="pane.rating"], [aria-label*="đánh giá"], [aria-label*="review" i], span[aria-label*="review" i], span[aria-label*="đánh giá"]',
      ),
    );
    return els.slice(0, 20).map((el) => ({
      tag: el.tagName,
      ariaLabel: el.getAttribute('aria-label'),
      jsaction: el.getAttribute('jsaction'),
      role: el.getAttribute('role'),
      text: el.textContent?.trim().slice(0, 60),
    }));
  });
  console.log(JSON.stringify({ event: 'dom_review_candidates', candidates }));

  // Dump ALL tabs (the reviews list may now open via a "Đánh giá" tab).
  const tabs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll<HTMLElement>('button[role="tab"], [role="tab"]')).map((el) => ({
      tag: el.tagName,
      ariaLabel: el.getAttribute('aria-label'),
      jsaction: el.getAttribute('jsaction'),
      text: el.textContent?.trim().slice(0, 40),
      selected: el.getAttribute('aria-selected'),
    }));
  });
  console.log(JSON.stringify({ event: 'dom_all_tabs', tabs }));

  // Dump every element whose text/aria-label contains "đánh giá" or a "đánh
  // giá" review count, plus every button with jsaction mentioning rating.
  const reviewTextEls = await page.evaluate(() => {
    const all = Array.from(
      document.querySelectorAll<HTMLElement>('button, span, div, a, [role="tab"]'),
    );
    const hits = all.filter(
      (el) =>
        (el.textContent?.match(/\d[\d.,]*\s*đánh giá/i) || el.textContent?.match(/đánh giá/i)) &&
        el.children.length <= 6,
    );
    return hits.slice(0, 25).map((el) => ({
      tag: el.tagName,
      ariaLabel: el.getAttribute('aria-label'),
      jsaction: el.getAttribute('jsaction'),
      role: el.getAttribute('role'),
      cls: el.className?.toString().slice(0, 60),
      text: el.textContent?.trim().slice(0, 60),
    }));
  });
  console.log(JSON.stringify({ event: 'dom_review_text_hits', hits: reviewTextEls }));

  const ratingJsactionEls = await page.evaluate(() => {
    return Array.from(document.querySelectorAll<HTMLElement>('[jsaction*="rating"]'))
      .slice(0, 15)
      .map((el) => ({
        tag: el.tagName,
        ariaLabel: el.getAttribute('aria-label'),
        jsaction: el.getAttribute('jsaction'),
        cls: el.className?.toString().slice(0, 60),
        text: el.textContent?.trim().slice(0, 60),
      }));
  });
  console.log(JSON.stringify({ event: 'dom_rating_jsaction', hits: ratingJsactionEls }));

  // Dump raw HTML around the rating/reviews section of the detail panel so we
  // can see exactly what Google Maps renders right now.
  const ratingSnippet = await page
    .evaluate(() => {
      const panel = document.querySelector<HTMLElement>('div[role="main"]');
      if (!panel) return '';
      return panel.innerHTML.slice(0, 6_000);
    })
    .catch((err: unknown) => `eval error: ${String(err)}`);
  console.log(JSON.stringify({ event: 'dom_rating_snippet', snippet: ratingSnippet }));

  // Prefer the real "more reviews" button (jsaction pane.rating.moreReviews),
  // fall back to the review-count button, never the "write a review" button.
  const btn = page.locator('button[jsaction*="pane.rating.moreReviews"]').first();
  const btnCount = await btn.count();
  if (btnCount > 0) {
    await btn.click({ timeout: 5_000 }).catch((err: unknown) => console.log(JSON.stringify({ event: 'click_error', message: String(err) })));
  } else {
    const reviewCountBtn = page
      .locator('button[aria-label*="đánh giá"], button[aria-label*="review" i]')
      .filter({ hasNotText: 'Viết' })
      .first();
    if ((await reviewCountBtn.count()) > 0) {
      await reviewCountBtn.click({ timeout: 5_000 }).catch((err: unknown) => console.log(JSON.stringify({ event: 'click_error', message: String(err) })));
    } else {
      console.log(JSON.stringify({ event: 'dom_click_skipped' }));
    }
  }
  const clicked = btnCount > 0;

  if (clicked) {
    await page.waitForTimeout(3_000);
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
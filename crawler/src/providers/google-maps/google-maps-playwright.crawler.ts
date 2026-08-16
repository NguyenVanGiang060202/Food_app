import type { Page, Locator, BrowserContext } from 'playwright';
import { PlaywrightBrowser } from '../../browser/playwright-browser';
import { SELECTORS } from './selectors';
import {
  isLikelyRestaurantName,
  rejectsNonFoodPlace,
  normalizeImages,
  parseRating,
  parseReviewCount,
  parseReviewDate,
  inferLanguageCode,
  parseCoordinatesFromUrl,
  type ParsedPlace,
  type ParsedReview,
} from './google-maps.parser';

export interface GoogleMapsCrawlTarget {
  query: string;
  location?: string;
}

export interface GoogleMapsCrawlerOptions {
  maxResults?: number;
  maxScrollAttempts?: number;
  navigationTimeout?: number;
  actionTimeout?: number;
  headless?: boolean;
  extractDetails?: boolean;
  extractReviews?: boolean;
  maxReviewsPerPlace?: number;
  /**
   * Keep a single Chromium alive across crawlPlaceByUrl calls instead of
   * launching/tearing down a browser per place. Review-refresh opens thousands
   * of place URLs; a fresh browser per place exhausts RAM on small VPSes after
   * a few hours. Paired with browserRestartEvery to shed leaked memory.
   */
  reuseBrowser?: boolean;
  /** Restart the reused browser after this many crawlPlaceByUrl calls. */
  browserRestartEvery?: number;
}

interface RawListItem {
  name: string | undefined;
  ratingText: string | undefined;
  reviewText: string | undefined;
  address: string | undefined;
  category: string | undefined;
  url: string | undefined;
  images: Array<{ url: string; altText?: string }>;
}

const DEFAULT_MAX_RESULTS = 50;
const DEFAULT_MAX_SCROLL_ATTEMPTS = 20;

export class GoogleMapsPlaywrightCrawler {
  private readonly browser: PlaywrightBrowser;
  private readonly maxResults: number;
  private readonly maxScrollAttempts: number;
  private readonly extractDetails: boolean;
  private readonly extractReviews: boolean;
  private readonly maxReviewsPerPlace: number;
  private readonly reuseBrowser: boolean;
  private readonly browserRestartEvery: number;
  private crawlPlaceCalls = 0;
  private inFlight = 0;

  constructor(options: GoogleMapsCrawlerOptions = {}) {
    this.browser = new PlaywrightBrowser({
      headless: options.headless,
      navigationTimeout: options.navigationTimeout,
      actionTimeout: options.actionTimeout,
    });
    this.maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
    this.maxScrollAttempts = options.maxScrollAttempts ?? DEFAULT_MAX_SCROLL_ATTEMPTS;
    this.extractDetails = options.extractDetails ?? true;
    this.extractReviews = options.extractReviews ?? true;
    this.maxReviewsPerPlace = Math.min(Math.max(options.maxReviewsPerPlace ?? 5, 0), 20);
    this.reuseBrowser = options.reuseBrowser ?? false;
    this.browserRestartEvery = Math.max(options.browserRestartEvery ?? 150, 10);
  }

  async crawl(target: GoogleMapsCrawlTarget): Promise<ParsedPlace[]> {
    await this.browser.start();
    let page: Page | undefined;

    try {
      page = await this.browser.createPage();
      const seenUrls = new Set<string>();
      const results: ParsedPlace[] = [];

      console.error(
        JSON.stringify({
          event: 'crawler_phase',
          phase: 'navigate',
          query: target.query,
          location: target.location,
        }),
      );
      await this.navigateToSearch(page, target);
      await this.waitForResults(page);
      console.error(
        JSON.stringify({ event: 'crawler_phase', phase: 'extract', query: target.query }),
      );

      for (
        let attempt = 0;
        attempt < this.maxScrollAttempts && results.length < this.maxResults;
        attempt++
      ) {
        const rawItems = await this.extractRawListItems(page, seenUrls);
        for (const item of rawItems) {
          if (results.length >= this.maxResults) break;
          const place = this.toParsedPlace(item);
          if (
            place &&
            isLikelyRestaurantName(place.name) &&
            !rejectsNonFoodPlace(place.name, place.category)
          ) {
            if (this.extractDetails) {
              await this.enrichWithDetails(page, place, item.url);
            }
            results.push(place);
            console.error(
              JSON.stringify({
                event: 'crawler_place',
                index: results.length,
                maxResults: this.maxResults,
                name: place.name,
              }),
            );
          }
        }
        if (rawItems.length === 0) break;
        if (results.length >= this.maxResults) break;
        await this.scrollResults(page);
        await page.waitForTimeout(2000);
      }

      return results;
    } finally {
      // createPage() can throw (browser launch/context/page errors). Keep cleanup
      // outside that operation so no Playwright resource is left alive on failure.
      if (page) {
        await page.close().catch((error) => {
          console.error(
            JSON.stringify({
              event: 'crawler_cleanup_error',
              resource: 'page',
              message: error instanceof Error ? error.message : String(error),
            }),
          );
        });
      }
      await this.browser.close().catch((error) => {
        console.error(
          JSON.stringify({
            event: 'crawler_cleanup_error',
            resource: 'browser',
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      });
    }
  }

  // Opens a place page directly (bypasses search/discovery) and captures its
  // up-to-date detail panel data plus reviews. Used by the review-refresh CLI
  // to backfill reviews for places that discovery already found.
  async crawlPlaceByUrl(
    url: string,
    expectedName: string | undefined,
  ): Promise<ParsedPlace | undefined> {
    if (!this.reuseBrowser) {
      // Legacy per-place browser lifecycle: one fresh browser per call.
      await this.browser.start();
      const result = await this.crawlPlaceByUrlOnce(url, expectedName);
      await this.browser.close().catch((error) => {
        console.error(
          JSON.stringify({
            event: 'crawler_cleanup_error',
            resource: 'browser',
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      });
      return result;
    }

    // Reuse one browser across the whole review-refresh run. A reused Chromium
    // still leaks memory over thousands of navigations, so restart it every
    // browserRestartEvery calls (and whenever the browser died) to shed it.
    // Restart only when no other worker is mid-crawl, or we'd kill a page that
    // a concurrent worker is using.
    this.crawlPlaceCalls += 1;
    this.inFlight += 1;
    try {
      if (!this.browser.isConnected()) {
        await this.browser.start();
      }
      return await this.crawlPlaceByUrlOnce(url, expectedName);
    } finally {
      this.inFlight -= 1;
      if (
        this.inFlight === 0 &&
        (this.crawlPlaceCalls >= this.browserRestartEvery || !this.browser.isConnected())
      ) {
        await this.browser.close().catch((error) => {
          console.error(
            JSON.stringify({
              event: 'crawler_cleanup_error',
              resource: 'browser',
              message: error instanceof Error ? error.message : String(error),
            }),
          );
        });
        this.crawlPlaceCalls = 0;
      }
    }
  }

  private async crawlPlaceByUrlOnce(
    url: string,
    expectedName: string | undefined,
  ): Promise<ParsedPlace | undefined> {
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    try {
      context = await this.browser.createContext();
      page = await this.browser.createPage(context);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForTimeout(3000);
      await this.dismissCookieConsent(page);
      await page.waitForTimeout(2000);

      try {
        await page.waitForSelector('div[role="main"] h1', { timeout: 20_000 });
      } catch {
        console.error(
          JSON.stringify({
            event: 'place_panel_missing',
            url,
            message: 'Place detail panel did not appear within timeout.',
          }),
        );
        return undefined;
      }
      await page.waitForTimeout(1500);

      const details = await this.extractDetailPanelData(page);
      if (this.isMismatchedPanel(expectedName, details.name)) {
        console.error(
          JSON.stringify({
            event: 'place_panel_mismatch',
            url,
            expectedName,
            panelName: details.name,
          }),
        );
        return undefined;
      }

      const placeName = details.name ?? expectedName ?? 'place';
      const reviews =
        this.extractReviews && this.maxReviewsPerPlace > 0
          ? await this.extractReviewsFromDetail(page, placeName)
          : [];

      return {
        name: placeName,
        rating: undefined,
        reviewCount: details.reviewCount,
        address: details.address,
        category: undefined,
        url,
        phone: details.phone,
        website: details.website,
        priceLevel: details.priceLevel,
        openingHours: [],
        coordinates: parseCoordinatesFromUrl(url),
        images: normalizeImages(details.images),
        reviews,
      };
    } finally {
      if (page) {
        await page.close().catch((error) => {
          console.error(
            JSON.stringify({
              event: 'crawler_cleanup_error',
              resource: 'page',
              message: error instanceof Error ? error.message : String(error),
            }),
          );
        });
      }
      if (context) {
        await context.close().catch((error) => {
          console.error(
            JSON.stringify({
              event: 'crawler_cleanup_error',
              resource: 'context',
              message: error instanceof Error ? error.message : String(error),
            }),
          );
        });
      }
    }
  }

  private async enrichWithDetails(
    page: Page,
    place: ParsedPlace,
    url: string | undefined,
  ): Promise<void> {
    if (!url) return;
    try {
      const link = page.locator(`a[href="${url.replace(/"/g, '\\"')}"]`);
      if ((await link.count()) === 0) return;

      await link
        .first()
        .click({ force: true, timeout: 8000 })
        .catch(() => undefined);
      await page.waitForTimeout(2000);

      const details = await this.extractDetailPanelData(page);
      if (this.isMismatchedPanel(place.name, details.name)) {
        // The detail panel did not switch to the requested place. Consuming
        // its data would leak the previous place's review count, phone, etc.
        // across many records (duplicated review_count in production data).
        await this.closeDetailPanel(page);
        return;
      }
      if (details.reviewCount !== undefined) place.reviewCount = details.reviewCount;
      if (details.phone !== undefined) place.phone = details.phone;
      if (details.website !== undefined) place.website = details.website;
      if (details.priceLevel !== undefined) place.priceLevel = details.priceLevel;
      if (details.address && !place.address) place.address = details.address;
      if (details.images.length) place.images = normalizeImages(details.images);

      if (this.extractReviews && this.maxReviewsPerPlace > 0) {
        place.reviews = await this.extractReviewsFromDetail(page, place.name ?? 'place');
      }

      await this.closeDetailPanel(page);
      await page.waitForTimeout(500);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'detail_extraction_error',
          name: place.name,
          message: error instanceof Error ? error.message : 'Failed to extract details',
        }),
      );
    }
  }

  private isMismatchedPanel(
    expectedName: string | undefined,
    panelName: string | undefined,
  ): boolean {
    // A missing panel heading is not a mismatch we can detect — bail out and
    // let the caller decide about using the data. When the heading exists it
    // must look like the place we clicked, otherwise the panel is stale.
    if (!expectedName || !panelName) return false;
    const toKey = (value: string) =>
      value
        .toLocaleLowerCase('vi-VN')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const expectedKey = toKey(expectedName);
    const panelKey = toKey(panelName);
    return !expectedKey.includes(panelKey) && !panelKey.includes(expectedKey);
  }

  private async extractReviewsFromDetail(page: Page, placeName: string): Promise<ParsedReview[]> {
    try {
      const reviewButton = page.locator(SELECTORS.detailReviewsButton).first();
      if (
        (await reviewButton.count()) === 0 ||
        !(await reviewButton.isVisible({ timeout: 2_000 }))
      ) {
        return [];
      }
      await reviewButton.click();
      await page.waitForTimeout(1_500);

      const reviewPanel = page.locator(SELECTORS.reviewContainer).first();
      if ((await reviewPanel.count()) === 0) return [];

      const reviews = await this.collectReviewsWithScroll(page);
      return reviews
        .map((review) => ({
          externalReviewId: `${placeName}:${review.externalReviewId}`,
          rating: parseRating(review.ratingText),
          content: review.content || undefined,
          reviewedAt: parseReviewDate(review.date),
          languageCode: inferLanguageCode(review.content),
        }))
        .filter((review) => review.content || review.rating !== undefined);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'review_extraction_error',
          name: placeName,
          message: error instanceof Error ? error.message : 'Failed to extract reviews',
        }),
      );
      return [];
    } finally {
      await this.closeReviewPanel(page);
    }
  }

  // Google Maps lazy-renders reviews as the panel scrolls. Keep scrolling until
  // we collected maxReviewsPerPlace distinct reviews or the feed stopped
  // growing, so a refresh run captures far more than the first screenful.
  private async collectReviewsWithScroll(page: Page): Promise<
    Array<{
      externalReviewId: string;
      ratingText: string;
      content: string | undefined;
      date: string | undefined;
    }>
  > {
    const collected = new Map<string, { externalReviewId: string; ratingText: string; content: string | undefined; date: string | undefined }>();
    const maxScrolls = this.maxReviewsPerPlace * 3 + 4;
    let previousSize = -1;
    let stagnantScrolls = 0;
    for (let attempt = 0; attempt < maxScrolls; attempt += 1) {
      const reviews = await page.evaluate(
        ({ selector, limit }) => {
          const containers = Array.from(document.querySelectorAll<HTMLElement>(selector));
          return containers.slice(0, limit).map((container, index) => {
            const id = container.getAttribute('data-review-id');
            const content = container
              .querySelector<HTMLElement>('.wiI7pd, [data-expandable-section]')
              ?.textContent?.trim();
            const ratingElement = container.querySelector<HTMLElement>(
              '[aria-label*="star"], [aria-label*="sao"], [role="img"]',
            );
            const ratingText = ratingElement?.getAttribute('aria-label') ?? '';
            const dateText = (() => {
              const preferred = container.querySelector<HTMLElement>('span.rsqaWe');
              if (preferred?.textContent?.trim()) return preferred.textContent.trim();
              const dated = container.querySelector<HTMLElement>('span[class*="date"]');
              if (dated?.textContent?.trim()) return dated.textContent.trim();
              const du9 = container.querySelector<HTMLElement>('.DU9Pgb');
              if (du9) {
                const clone = du9.cloneNode(true) as HTMLElement;
                clone
                  .querySelectorAll('.google-symbols, .kvMYJc, [role="img"]')
                  .forEach((node) => node.remove());
                return clone.textContent?.trim() || undefined;
              }
              return undefined;
            })();
            const date = dateText;
            const author =
              container.querySelector<HTMLElement>('.d4r55, .TSUbDb')?.textContent?.trim() ??
              '';
            const stableId =
              id || `${author}|${ratingText}|${content ?? ''}|${date ?? ''}|${index}`;
            return { externalReviewId: stableId, ratingText, content, date };
          });
        },
        { selector: SELECTORS.reviewContainer, limit: this.maxReviewsPerPlace },
      );

      let added = 0;
      for (const review of reviews) {
        if (!collected.has(review.externalReviewId)) {
          collected.set(review.externalReviewId, review);
          added += 1;
          if (collected.size >= this.maxReviewsPerPlace) break;
        }
      }
      if (collected.size >= this.maxReviewsPerPlace) break;

      const grew = reviews.length > previousSize || added > 0;
      previousSize = reviews.length;
      if (grew) {
        stagnantScrolls = 0;
      } else {
        stagnantScrolls += 1;
        if (stagnantScrolls >= 2) break;
      }

      await this.scrollReviewFeed(page);
      await page.waitForTimeout(900);
    }
    return Array.from(collected.values()).slice(0, this.maxReviewsPerPlace);
  }

  private async scrollReviewFeed(page: Page): Promise<void> {
    try {
      await page.evaluate(() => {
        const main = document.querySelector('div[role="main"]');
        const scrollables = main
          ? Array.from(main.querySelectorAll<HTMLElement>('[style*="overflow"]'))
          : [];
        const candidates = [
          main,
          ...scrollables,
          document.querySelector('[style*="overflow"]'),
        ].filter((element): element is HTMLElement => Boolean(element));
        const layer = candidates.find(
          (element) =>
            element.scrollHeight > element.clientHeight + 100 &&
            (element === main || element.parentElement !== null),
        );
        if (layer) {
          layer.scrollTop = layer.scrollHeight;
          return;
        }
        window.scrollBy(0, 600);
      });
    } catch {
      // Best-effort; extraction still works with what is already rendered.
    }
  }

  private async closeReviewPanel(page: Page): Promise<void> {
    try {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    } catch {
      // Detail close handler will restore the list state.
    }
  }

  private async extractDetailPanelData(page: Page): Promise<{
    name: string | undefined;
    reviewCount: number | undefined;
    phone: string | undefined;
    website: string | undefined;
    address: string | undefined;
    priceLevel: number | undefined;
    images: Array<{ url: string; altText?: string }>;
  }> {
    try {
      return await page.evaluate(
        (selectors: Record<string, string>) => {
          const result: {
            name: string | undefined;
            reviewCount: number | undefined;
            phone: string | undefined;
            website: string | undefined;
            address: string | undefined;
            priceLevel: number | undefined;
            images: Array<{ url: string; altText?: string }>;
          } = {
            name: undefined,
            reviewCount: undefined,
            phone: undefined,
            website: undefined,
            address: undefined,
            priceLevel: undefined,
            images: [],
          };

          // Scope every lookup to the open detail panel. document.querySelector
          // returns the first match anywhere on the page, which on Google Maps
          // can be the still-rendered results list — reading that reuses one
          // list item's review count for many places.
          const panel = document.querySelector('div[role="main"]') ?? document;

          const heading = panel.querySelector('h1');
          if (heading) result.name = heading.textContent?.trim() || undefined;

          const MAX_REVIEW_COUNT = 1_000_000;
          const parseCount = (raw: string | null | undefined): number | undefined => {
            if (!raw) return undefined;
            const cleaned = raw.trim();
            if (!cleaned) return undefined;
            const toCount = (group: string): number | undefined => {
              const digits = group.replace(/[^0-9]/g, '');
              if (!digits) return undefined;
              const val = Number(digits);
              if (!Number.isFinite(val) || val < 0 || val > MAX_REVIEW_COUNT) return undefined;
              return val;
            };
            const parenthesized = cleaned.match(/[([]\s*(\d[\d.,]*)\s*[)\]]/);
            if (parenthesized) return toCount(parenthesized[1]);
            const keywordMatch = cleaned.match(/(\d[\d.,]*)\s*(?:reviews?|đánh giá|review|avis)/i);
            if (keywordMatch) return toCount(keywordMatch[1]);
            const groups = cleaned.match(/\d[\d.,]*/g);
            if (!groups || groups.length === 0) return undefined;
            const last = groups[groups.length - 1];
            if (
              groups.length === 1 &&
              /^\d[.,]\d$/.test(last) &&
              Number(last.replace(',', '.')) <= 5
            )
              return undefined;
            return toCount(last);
          };

          const reviewBtn =
            panel.querySelector<HTMLElement>(selectors.detailReviewCount) ??
            panel.querySelector<HTMLElement>('button[aria-label*="review" i]');
          if (reviewBtn) {
            const text =
              reviewBtn.textContent?.trim() || reviewBtn.getAttribute('aria-label') || '';
            result.reviewCount = parseCount(text);
          }
          if (result.reviewCount === undefined) {
            const reviewSpan = panel.querySelector<HTMLElement>(selectors.detailReviewCountAlt);
            if (reviewSpan) {
              const text =
                reviewSpan.textContent?.trim() || reviewSpan.getAttribute('aria-label') || '';
              result.reviewCount = parseCount(text);
            }
          }

          const phoneBtn = panel.querySelector<HTMLElement>(selectors.detailPhone);
          if (phoneBtn) {
            const telHref =
              phoneBtn.tagName === 'A' ? (phoneBtn as HTMLAnchorElement).href : undefined;
            const telFromHref = telHref?.match(/tel:([+\d\s()-]+)/i)?.[1];
            const cleaned = (phoneBtn.textContent ?? '')
              .replace(/[^\d+\s]/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            result.phone = telFromHref?.trim() || cleaned || undefined;
          }

          const websiteLink = Array.from(
            panel.querySelectorAll<HTMLAnchorElement>(selectors.detailWebsite),
          ).find((link) => /^https?:\/\//i.test(link.href) && !link.href.includes('google.com'));
          if (websiteLink?.href) result.website = websiteLink.href;

          const addressBtn = panel.querySelector<HTMLElement>(selectors.detailAddress);
          if (addressBtn) {
            const addrDiv = addressBtn.querySelector('div.fontBodyMedium');
            result.address =
              addrDiv?.textContent?.trim() || addressBtn.textContent?.trim() || undefined;
          }

          // Price level: Google renders a '$' run next to the category in the
          // place-info section. Scope the scan to the panel only so review
          // text or ads cannot pollute it.
          const dollarRuns = Array.from(panel.querySelectorAll<HTMLElement>('span'))
            .map((el) => el.textContent?.replace(/\u00a0/g, ' ').trim() ?? '')
            .filter((text) => /^\${1,4}$/.test(text))
            .map((text) => text.length);
          result.priceLevel = dollarRuns.length ? Math.max(...dollarRuns) : undefined;

          result.images = Array.from(panel.querySelectorAll<HTMLImageElement>('img[src^="http"]'))
            .map((image) => ({
              url: image.currentSrc || image.src,
              altText: image.alt || undefined,
            }))
            .slice(0, 20);

          return result;
        },
        SELECTORS as unknown as Record<string, string>,
      );
    } catch {
      return {
        name: undefined,
        reviewCount: undefined,
        phone: undefined,
        website: undefined,
        address: undefined,
        priceLevel: undefined,
        images: [],
      };
    }
  }

  private async closeDetailPanel(page: Page): Promise<void> {
    try {
      const closeBtn = page.locator(SELECTORS.detailClose);
      if (await closeBtn.isVisible({ timeout: 2000 })) {
        await closeBtn.click();
        return;
      }
    } catch {
      // try pressing Escape
    }
    try {
      await page.keyboard.press('Escape');
    } catch {
      // ignore
    }
  }

  private async navigateToSearch(page: Page, target: GoogleMapsCrawlTarget): Promise<void> {
    const searchQuery = target.location ? `${target.query} ${target.location}` : target.query;
    const encoded = encodeURIComponent(searchQuery);
    await page.goto(`https://www.google.com/maps/search/${encoded}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForTimeout(3000);
    await this.dismissCookieConsent(page);
    await page.waitForTimeout(2000);
  }

  private async dismissCookieConsent(page: Page): Promise<void> {
    try {
      const acceptButton = page.locator(
        'button:has-text("Accept all"), button:has-text("Tôi đồng ý"), button:has-text("Accept"), button:has-text("Đồng ý"), div[aria-label*="cookie"] button, form[action*="consent"] button',
      );
      if (await acceptButton.isVisible({ timeout: 3000 })) {
        await acceptButton.click();
        await page.waitForTimeout(1000);
      }
    } catch {
      // No cookie consent banner found
    }
  }

  private async waitForResults(page: Page): Promise<void> {
    try {
      await page.waitForSelector(SELECTORS.resultList, { timeout: 20_000 });
      await page.waitForTimeout(3000);
    } catch {
      console.error(
        JSON.stringify({
          event: 'crawler_warn',
          message:
            'Google Maps result list did not appear within timeout. Proceeding with current state.',
        }),
      );
    }
  }

  private async extractRawListItems(page: Page, seenUrls: Set<string>): Promise<RawListItem[]> {
    try {
      const rawData = await page.evaluate(() => {
        const containers = document.querySelectorAll<HTMLElement>('div[role="article"]');
        const results: Array<{
          name: string | undefined;
          ratingText: string | undefined;
          reviewText: string | undefined;
          address: string | undefined;
          category: string | undefined;
          url: string | undefined;
          images: Array<{ url: string; altText?: string }>;
        }> = [];
        const seenHrefs = new Set<string>();

        for (const container of containers) {
          try {
            const link = container.querySelector<HTMLAnchorElement>('a.hfpxzc');
            const url = link?.href || undefined;
            if (!url || seenHrefs.has(url)) continue;
            seenHrefs.add(url);

            const nameEl = container.querySelector('.qBF1Pd.fontHeadlineSmall');
            const name = nameEl?.textContent?.trim() || undefined;
            if (!name) continue;

            const ratingEl = container.querySelector<HTMLElement>('.MW4etd');
            const ratingText = ratingEl?.textContent?.trim() || undefined;
            const reviewText = Array.from(
              container.querySelectorAll<HTMLElement>(
                '.UY7F9, [aria-label*="reviews" i], [aria-label*="đánh giá" i], [aria-label*="review" i]',
              ),
            )
              .map(
                (element) =>
                  element.getAttribute('aria-label') || element.textContent?.trim() || '',
              )
              .find((text) => /\d/.test(text));
            const images = Array.from(
              container.querySelectorAll<HTMLImageElement>('img[src^="http"]'),
            ).map((image) => ({
              url: image.currentSrc || image.src,
              altText: image.alt || undefined,
            }));

            const categoryButton = container.querySelector<HTMLElement>(
              'button[jsaction*="category" i], [aria-label*="category" i], [aria-label*="loại hình" i]',
            );
            const infoW4 = container.querySelectorAll<HTMLElement>('.W4Efsd .W4Efsd');
            let address: string | undefined;
            let category: string | undefined = categoryButton?.textContent?.trim() || undefined;
            for (const w4 of infoW4) {
              const directChildSpans = w4.querySelectorAll(':scope > span');
              if (directChildSpans.length >= 2) {
                const firstText = directChildSpans[0]?.textContent?.trim();
                if (
                  firstText &&
                  !firstText.includes('·') &&
                  !/^(Open|Closed)/i.test(firstText) &&
                  firstText.length < 50
                ) {
                  category = firstText;
                }
                const lastDirectSpan = directChildSpans[directChildSpans.length - 1];
                const addrSpan = lastDirectSpan?.querySelector<HTMLElement>('span:last-child');
                const addrText = addrSpan?.textContent?.trim();
                if (addrText && addrText.length > 2 && !/^(Open|Closed)/i.test(addrText)) {
                  address = addrText;
                  break;
                }
              }
            }

            results.push({ name, ratingText, reviewText, address, category, url, images });
          } catch {
            // skip
          }
        }
        return results;
      });

      const newItems: RawListItem[] = [];
      for (const item of rawData) {
        if (item.name === 'Google' || !item.url) continue;
        if (!isLikelyRestaurantName(item.name)) continue;
        if (rejectsNonFoodPlace(item.name, item.category)) continue;
        if (seenUrls.has(item.url)) continue;
        seenUrls.add(item.url);
        newItems.push(item);
      }
      return newItems;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'crawler_extraction_error',
          message: error instanceof Error ? error.message : 'Failed to extract results',
        }),
      );
      return [];
    }
  }

  private toParsedPlace(item: RawListItem): ParsedPlace | undefined {
    if (!item.name) return undefined;
    return {
      name: item.name,
      rating: parseRating(item.ratingText),
      reviewCount: parseReviewCount(item.reviewText),
      address: item.address,
      category: item.category,
      url: item.url,
      phone: undefined,
      website: undefined,
      priceLevel: undefined,
      openingHours: [],
      coordinates: parseCoordinatesFromUrl(item.url),
      images: normalizeImages(item.images),
      reviews: [],
    };
  }

  private async scrollResults(page: Page): Promise<void> {
    try {
      await page.evaluate(() => {
        const panel = document.querySelector('div[role="feed"]');
        if (panel) {
          panel.scrollTop = panel.scrollHeight;
          return;
        }
        const scrollable = document.querySelector(
          '[style*="overflow"][style*="auto"], [style*="overflow"][style*="scroll"]',
        );
        if (scrollable) {
          scrollable.scrollTop = scrollable.scrollHeight;
          return;
        }
        window.scrollBy(0, 500);
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'crawler_scroll_error',
          message: error instanceof Error ? error.message : 'Failed to scroll results',
        }),
      );
    }
  }
}

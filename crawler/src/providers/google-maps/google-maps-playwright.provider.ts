import type { DataProviderAdapter } from '../provider.interface';
import type { DiscoveryInput, SourceRestaurantRecord } from '../../types/source-record';
import {
  GoogleMapsPlaywrightCrawler,
  type GoogleMapsCrawlerOptions,
} from './google-maps-playwright.crawler';
import {
  parseRating,
  parseReviewCount,
  normalizeCategorySlug,
  extractPlaceIdFromUrl,
  rejectsNonFoodPlace,
} from './google-maps.parser';
import { createHash } from 'node:crypto';

const HCMC = 'Ho Chi Minh City';

export interface GoogleMapsPlaywrightProviderOptions {
  maxResults?: number;
  maxScrollAttempts?: number;
  navigationTimeout?: number;
  actionTimeout?: number;
  headless?: boolean;
  maxReviewsPerPlace?: number;
  crawlerFactory?: (
    options: GoogleMapsCrawlerOptions,
  ) => Pick<GoogleMapsPlaywrightCrawler, 'crawl'>;
}

export class GoogleMapsPlaywrightProvider implements DataProviderAdapter {
  readonly providerCode = 'google_maps_playwright';
  private readonly crawlerOptions: GoogleMapsCrawlerOptions;
  private readonly crawlerFactory: (
    options: GoogleMapsCrawlerOptions,
  ) => Pick<GoogleMapsPlaywrightCrawler, 'crawl'>;

  constructor(options: GoogleMapsPlaywrightProviderOptions = {}) {
    this.crawlerOptions = {
      maxResults: options.maxResults,
      maxScrollAttempts: options.maxScrollAttempts,
      navigationTimeout: options.navigationTimeout,
      actionTimeout: options.actionTimeout,
      headless: options.headless,
      maxReviewsPerPlace: options.maxReviewsPerPlace,
    };
    this.crawlerFactory =
      options.crawlerFactory ??
      ((crawlerOptions) => new GoogleMapsPlaywrightCrawler(crawlerOptions));
  }

  async validateConfiguration(): Promise<void> {
    // Playwright is a local dependency, no API keys needed
  }

  async *discover(input: DiscoveryInput): AsyncIterable<SourceRestaurantRecord> {
    const query = buildQuery(input);
    const crawler = this.crawlerFactory({
      ...this.crawlerOptions,
      maxResults: input.limit,
    });
    const places = await crawler.crawl(query);

    for (const place of places) {
      if (!place.name) continue;
      if (rejectsNonFoodPlace(place.name, place.category)) continue;

      const externalId = place.url
        ? (extractPlaceIdFromUrl(place.url) ?? place.url)
        : buildStableExternalId(place.name, place.address, place.coordinates);

      const rating = parseRating(place.rating?.toString());
      const reviewCount =
        place.reviewCount === undefined
          ? undefined
          : parseReviewCount(place.reviewCount.toString());

      const record: SourceRestaurantRecord = {
        providerCode: this.providerCode,
        externalId,
        sourceUrl: place.url,
        collectedAt: new Date().toISOString(),
        name: place.name,
        address: place.address,
        city: input.city?.trim() || inferCity(input.location) || HCMC,
        district: input.district?.trim() || inferDistrict(input.location),
        countryCode: 'VN',
        categories: place.category
          ? [normalizeCategorySlug(place.category)].filter((value): value is string =>
              Boolean(value),
            )
          : undefined,
        rating,
        reviewCount,
        coordinates: place.coordinates,
        phone: place.phone,
        websiteUrl: place.website,
        priceLevel: place.priceLevel,
        openingHours: place.openingHours.length ? place.openingHours : undefined,
        images: (place.images ?? []).map((image, index) => ({
          ...image,
          sortOrder: index,
          isCover: index === 0,
        })),
        reviews: place.reviews.map((review) => ({
          externalReviewId: review.externalReviewId,
          rating: review.rating,
          content: review.content,
          reviewedAt: review.reviewedAt,
          languageCode: review.languageCode,
        })),
        sourceMetadata: {
          crawler: 'playwright',
          query: query.query,
          location: query.location ?? null,
          extracted: {
            rating: place.rating !== undefined,
            reviewCount: place.reviewCount !== undefined,
            address: place.address !== undefined,
            phone: place.phone !== undefined,
            website: place.website !== undefined,
            priceLevel: place.priceLevel !== undefined,
            openingHours: place.openingHours.length,
            images: place.images?.length ?? 0,
            reviews: place.reviews.length,
            reviewedAt: place.reviews.some((review) => review.reviewedAt !== undefined),
          },
        },
      };

      yield record;
    }
  }
}

function buildQuery(input: DiscoveryInput): { query: string; location?: string } {
  if (input.query?.trim()) {
    return {
      query: input.query.trim(),
      location:
        input.location?.trim() || [input.district, input.city].filter(Boolean).join(', ') || HCMC,
    };
  }
  const category = input.category ? mapCategoryToQuery(input.category) : 'quán ăn';
  const district = input.district?.trim();
  const location = [district, input.city].filter(Boolean).join(', ') || HCMC;
  return { query: category, location };
}

function buildStableExternalId(
  name: string,
  address: string | undefined,
  coordinates: { latitude: number; longitude: number } | undefined,
): string {
  const identity = [name, address, coordinates?.latitude, coordinates?.longitude]
    .filter((value): value is string | number => value !== undefined && value !== '')
    .join('|')
    .trim()
    .toLocaleLowerCase('vi-VN');
  return `gmaps_${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`;
}

const NAMED_DISTRICTS: Record<string, string> = {
  'bình thạnh': 'Bình Thạnh',
  'phú nhuận': 'Phú Nhuận',
  'tân bình': 'Tân Bình',
  'tân phú': 'Tân Phú',
  'gò vấp': 'Gò Vấp',
  'bình tân': 'Bình Tân',
  'thủ đức': 'Thủ Đức',
  'nhà bè': 'Nhà Bè',
  'bình chánh': 'Bình Chánh',
  'hóc môn': 'Hóc Môn',
  'củ chi': 'Củ Chi',
  'cần giờ': 'Cần Giờ',
};

function inferDistrict(location: string | undefined): string | undefined {
  if (!location) return undefined;
  const quậnMatch = location.toLowerCase().match(/\bquận\s*(\d{1,2})\b/);
  if (quậnMatch) return `Quận ${Number(quậnMatch[1])}`;
  const lower = location.toLowerCase();
  for (const [key, canonical] of Object.entries(NAMED_DISTRICTS)) {
    if (new RegExp(`\\b${key}\\b`).test(lower)) return canonical;
  }
  return undefined;
}

function inferCity(location: string | undefined): string | undefined {
  if (!location) return undefined;
  const parts = location
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.at(-1);
}

function mapCategoryToQuery(category: string): string {
  const map: Record<string, string> = {
    vietnamese: 'quán Việt Nam',
    'coffee-shop': 'quán cà phê',
    vegetarian: 'quán chay',
    noodle: 'quán bún phở',
    dessert: 'quán tráng miệng',
  };
  return map[category] ?? category;
}

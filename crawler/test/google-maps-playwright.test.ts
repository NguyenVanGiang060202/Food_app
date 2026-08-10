import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLikelyRestaurantName,
  rejectsNonFoodPlace,
  normalizeImages,
  parseRating,
  parseReviewCount,
  extractPlaceIdFromUrl,
  parseReviewDate,
  inferLanguageCode,
  parseCoordinatesFromUrl,
  normalizeCategorySlug,
} from '../src/providers/google-maps/google-maps.parser';
import { GoogleMapsPlaywrightProvider } from '../src/providers/google-maps/google-maps-playwright.provider';

test('parseRating handles decimal point', () => {
  assert.equal(parseRating('4.5'), 4.5);
});

test('parseRating handles comma decimal separator', () => {
  assert.equal(parseRating('4,5'), 4.5);
});

test('parseRating rejects out-of-range', () => {
  assert.equal(parseRating('6.0'), undefined);
});

test('parseRating rejects negative', () => {
  assert.equal(parseRating('-1.0'), undefined);
});

test('parseRating returns undefined for null/undefined', () => {
  assert.equal(parseRating(null), undefined);
  assert.equal(parseRating(undefined), undefined);
});

test('parseReviewCount strips commas and parentheses', () => {
  assert.equal(parseReviewCount('1,283'), 1283);
});

test('parseReviewCount handles parenthesized', () => {
  assert.equal(parseReviewCount('(1,283)'), 1283);
});

test('parseReviewCount handles plain number', () => {
  assert.equal(parseReviewCount('42'), 42);
});

test('parseReviewCount returns undefined for empty', () => {
  assert.equal(parseReviewCount(''), undefined);
});

test('parseReviewCount returns undefined for non-numeric', () => {
  assert.equal(parseReviewCount('not a number'), undefined);
});

test('parseReviewCount reads localized review labels and does not concatenate rating', () => {
  assert.equal(parseReviewCount('4.8 (1,283 reviews)'), 1283);
  assert.equal(parseReviewCount('1.283 đánh giá'), 1283);
});

test('parseReviewCount does not concatenate rating digits with Vietnamese count format', () => {
  assert.equal(parseReviewCount('4,8 3.528 đánh giá'), 3528);
  assert.equal(parseReviewCount('4.8 3,528'), 3528);
  assert.equal(parseReviewCount('4.8 3,528 đánh giá'), 3528);
});

test('parseReviewCount picks the count from a "rating + count" pair', () => {
  assert.equal(parseReviewCount('4.8 (3,528)'), 3528);
  assert.equal(parseReviewCount('4,8 (3.528)'), 3528);
});

test('parseReviewCount returns undefined for a bare rating with no count', () => {
  assert.equal(parseReviewCount('4.8'), undefined);
  assert.equal(parseReviewCount('4,8'), undefined);
  assert.equal(parseReviewCount('5.0'), undefined);
});

test('place name filter excludes city and district cards', () => {
  assert.equal(isLikelyRestaurantName('Thành phố Hồ Chí Minh'), false);
  assert.equal(isLikelyRestaurantName('Quận 1'), false);
  assert.equal(isLikelyRestaurantName('Bún Bò Huế 31'), true);
});

test('rejectsNonFoodPlace rejects medical/karaoke/market/farm names', () => {
  assert.equal(rejectsNonFoodPlace('Bệnh viện Đa khoa Nhà Bè', 'Bệnh viện'), true);
  assert.equal(rejectsNonFoodPlace('Nha Khoa Thẩm Mỹ Cẩm Tú (Q8)', undefined), true);
  assert.equal(rejectsNonFoodPlace('Trung tâm Y tế khu vực Phú Lâm', undefined), true);
  assert.equal(rejectsNonFoodPlace('Karaoke Dragon Palace KTV', 'Karaoke'), true);
  assert.equal(rejectsNonFoodPlace('Chợ Hải Sản 79', undefined), true);
  assert.equal(rejectsNonFoodPlace('5ku Farm', undefined), true);
  assert.equal(rejectsNonFoodPlace('Trung tâm hội nghị - tiệc cưới Areca Garden', undefined), true);
});

test('rejectsNonFoodPlace rejects spa/massage only via the category label', () => {
  assert.equal(rejectsNonFoodPlace('Massage An Viên', 'Massage'), true);
  assert.equal(rejectsNonFoodPlace('Spa & Beauty', 'Spa'), true);
});

test('rejectsNonFoodPlace keeps coffee shops that mention spa in the name', () => {
  assert.equal(
    rejectsNonFoodPlace(
      'CÀ PHÊ ĐẸP Coffee shop & Spa ( Massage & Hair wash ) - マッサージ - 마사지 - 按摩',
      'Coffee shop',
    ),
    false,
  );
  assert.equal(rejectsNonFoodPlace('Le Blanc. Coffee & Spaces', 'Cà phê'), false);
  assert.equal(rejectsNonFoodPlace('The 10th Space', undefined), false);
});

test('rejectsNonFoodPlace keeps food names even when they mention non-food words', () => {
  assert.equal(rejectsNonFoodPlace('PHỞ BÒ NGA - GẦN BỆNH VIỆN TÂN PHÚ', 'Nhà hàng'), false);
  assert.equal(rejectsNonFoodPlace('Bún Bò Huế Cô Xuân chợ Đông Ba', 'Nhà hàng'), false);
  assert.equal(rejectsNonFoodPlace('Cà phê Farmhouse', 'Cà phê'), false);
});

test('rejectsNonFoodPlace rejects junk, mall, an address-only and district names', () => {
  assert.equal(rejectsNonFoodPlace('đã đóng cửa', undefined), true);
  assert.equal(rejectsNonFoodPlace('Không tên', undefined), true);
  assert.equal(rejectsNonFoodPlace('HỦ TIẾU MÌ KHÔNG TÊN', undefined), true);
  assert.equal(
    rejectsNonFoodPlace('889 Phạm Thế Hiển, Phường 4, Quận 8, Thành phố Hồ Chí Minh', undefined),
    true,
  );
  assert.equal(rejectsNonFoodPlace('Go! Dĩ An', undefined), true);
  assert.equal(rejectsNonFoodPlace('Nhà Bè', undefined), true);
});

test('parseCoordinatesFromUrl extracts map coordinates', () => {
  assert.deepEqual(
    parseCoordinatesFromUrl(
      'https://www.google.com/maps/place/Test/@10.7769,106.7009,15z/data=!3m1!1e3',
    ),
    { latitude: 10.7769, longitude: 106.7009 },
  );
});

test('parseCoordinatesFromUrl extracts coordinates from Google Maps place data URLs', () => {
  assert.deepEqual(
    parseCoordinatesFromUrl(
      'https://www.google.com/maps/place/Test/data=!4m7!3m6!1splace-id!8m2!3d10.7870716!4d106.6964204!16s%2Fg%2Fexample',
    ),
    { latitude: 10.7870716, longitude: 106.6964204 },
  );
});

test('parseCoordinatesFromUrl rejects invalid coordinates', () => {
  assert.equal(parseCoordinatesFromUrl('https://www.google.com/maps/@95,106,15z'), undefined);
  assert.equal(parseCoordinatesFromUrl(undefined), undefined);
});

test('normalizeCategorySlug maps crawler labels to canonical category slugs', () => {
  assert.equal(normalizeCategorySlug('Coffee Shop'), 'coffee-shop');
  assert.equal(normalizeCategorySlug('Quán chay'), 'vegetarian');
});

test('normalizeCategorySlug maps Vietnamese drink labels to beverage', () => {
  assert.equal(normalizeCategorySlug('Sinh tố, nước ép'), 'beverage');
  assert.equal(normalizeCategorySlug('Trà sữa'), 'beverage');
});

test('normalizeCategorySlug maps bánh mì to snack, not noodle', () => {
  assert.equal(normalizeCategorySlug('Bánh mì'), 'snack');
});

test('normalizeCategorySlug maps phở and bún to noodle/bun', () => {
  assert.equal(normalizeCategorySlug('Phở 24'), 'noodle');
  assert.equal(normalizeCategorySlug('Bún bò Huế'), 'bun');
});

test('normalizeCategorySlug maps unknown labels to undefined', () => {
  assert.equal(normalizeCategorySlug('Quán Karaoke'), undefined);
  assert.equal(normalizeCategorySlug(''), undefined);
  assert.equal(normalizeCategorySlug(undefined), undefined);
});

test('normalizeCategorySlug maps dessert labels', () => {
  assert.equal(normalizeCategorySlug('Tráng miệng'), 'dessert');
  assert.equal(normalizeCategorySlug('Trái cây tô'), 'dessert');
});

test('extractPlaceIdFromUrl extracts long base64-like id', () => {
  const url =
    'https://www.google.com/maps/place/Qu%C3%A1n+Test/@10.77,106.70,15z/data=!4m8!3m7!1s0x3175292929:0xabc123def456!8m2!3d10.77!4d106.70';
  const id = extractPlaceIdFromUrl(url);
  assert.ok(id, 'should extract an id');
  assert.equal(id!.length >= 20, true);
});

test('extractPlaceIdFromUrl returns undefined for no match', () => {
  assert.equal(extractPlaceIdFromUrl('https://example.com'), undefined);
});

test('extractPlaceIdFromUrl returns undefined for null/undefined', () => {
  assert.equal(extractPlaceIdFromUrl(null), undefined);
  assert.equal(extractPlaceIdFromUrl(undefined), undefined);
});

test('parseReviewDate converts a human-readable date to ISO', () => {
  assert.equal(parseReviewDate('January 2, 2026'), '2026-01-02T00:00:00.000Z');
});

test('parseReviewDate converts relative dates to ISO', () => {
  const parsed = parseReviewDate('2 weeks ago');
  assert.ok(parsed, 'expected relative date to parse');
  const diffMs = Date.now() - Date.parse(parsed);
  assert.ok(
    diffMs > 12 * 86_400_000 && diffMs < 16 * 86_400_000,
    `expected ~2 weeks ago, got ${diffMs}ms`,
  );
  const vietnamese = parseReviewDate('4 tháng trước');
  assert.ok(vietnamese);
  const diffMonths = Date.now() - Date.parse(vietnamese);
  assert.ok(
    diffMonths > 110 * 86_400_000 && diffMonths < 130 * 86_400_000,
    `expected ~4 months ago, got ${diffMonths}ms`,
  );
});

test('parseReviewDate ignores invalid dates', () => {
  assert.equal(parseReviewDate('not a date'), undefined);
  assert.equal(parseReviewDate(null), undefined);
  assert.equal(parseReviewDate(''), undefined);
});

test('inferLanguageCode detects Vietnamese and English review text', () => {
  assert.equal(inferLanguageCode('Món ăn rất ngon và đậm đà'), 'vi');
  assert.equal(inferLanguageCode('Great food'), 'en');
  assert.equal(inferLanguageCode(''), undefined);
});

test('Google Maps provider forwards the discovery limit to the crawler', async () => {
  let crawlerOptions: { maxResults?: number } | undefined;
  const provider = new GoogleMapsPlaywrightProvider({
    crawlerFactory: (options) => {
      crawlerOptions = options;
      return {
        async crawl() {
          return [
            {
              name: 'Test place',
              rating: undefined,
              reviewCount: undefined,
              address: undefined,
              category: undefined,
              url: 'https://www.google.com/maps/place/Test+place',
              phone: undefined,
              website: undefined,
              priceLevel: undefined,
              openingHours: [],
              coordinates: undefined,
              reviews: [],
            },
          ];
        },
      };
    },
  });

  const records = [];
  for await (const record of provider.discover({
    query: 'coffee shop',
    location: 'District 1',
    limit: 3,
  })) {
    records.push(record);
  }

  assert.equal(crawlerOptions?.maxResults, 3);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.name, 'Test place');
});

test('normalizeImages collapses same Google CDN photo with different size suffixes', () => {
  const images = normalizeImages([
    { url: 'https://lh3.googleusercontent.com/abc=w86-h114-k-no', altText: 'front' },
    { url: 'https://lh3.googleusercontent.com/abc=w80-h106-k-no' },
    { url: 'https://lh3.googleusercontent.com/def=w150-h100-k-no', altText: 'interior' },
  ]);
  assert.equal(images.length, 2);
  assert.equal(images[0]?.url, 'https://lh3.googleusercontent.com/abc');
  assert.equal(images[0]?.altText, 'front');
  assert.equal(images[1]?.url, 'https://lh3.googleusercontent.com/def');
});

test('normalizeImages keeps non-Google URLs unchanged', () => {
  const images = normalizeImages([{ url: 'https://example.com/photo.jpg' }]);
  assert.deepEqual(images, [{ url: 'https://example.com/photo.jpg', altText: undefined }]);
});

test('normalizeImages drops janky URLs that would overflow the unique index', () => {
  const mapTile = `https://maps.googleapis.com/maps/vt?pb=!1m18!1m12!1m3!1d${'3'.repeat(3000)}`;
  const streetView =
    'https://streetviewpixels-pa.googleapis.com/v1/thumbnail?panoid=abc&cb_client=search&share=1&output=tile&w=600&h=400';
  const images = normalizeImages([
    { url: mapTile },
    { url: streetView },
    { url: 'https://lh3.googleusercontent.com/real-photo=w600-h400-k-no', altText: 'interior' },
  ]);
  assert.deepEqual(images, [
    { url: 'https://lh3.googleusercontent.com/real-photo', altText: 'interior' },
  ]);
});

test('Google Maps provider generates a deterministic external id when a result has no URL', async () => {
  const provider = new GoogleMapsPlaywrightProvider({
    crawlerFactory: () => ({
      async crawl() {
        return [
          {
            name: 'Stable place',
            rating: undefined,
            reviewCount: undefined,
            address: '1 Test Street',
            category: undefined,
            url: undefined,
            phone: undefined,
            website: undefined,
            priceLevel: undefined,
            openingHours: [],
            coordinates: undefined,
            reviews: [],
          },
        ];
      },
    }),
  });

  const records = [];
  for await (const record of provider.discover({
    query: 'coffee',
    city: 'Ho Chi Minh City',
    limit: 1,
  })) {
    records.push(record);
  }

  assert.equal(records[0]?.externalId, 'gmaps_b224bafe89d6892aebbffa15f1b1e2c5');
});

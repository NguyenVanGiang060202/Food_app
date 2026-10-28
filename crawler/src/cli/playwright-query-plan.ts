export interface PlaywrightQueryPlanOptions {
  city: string;
  district?: string;
  districts?: string[];
  limitPerQuery: number;
  queries?: string[];
}

export interface PlaywrightQueryTarget {
  query: string;
  location: string;
  limit: number;
}

/**
 * Concrete dishes used by the default discovery run.
 *
 * A restaurant returned by Google Maps for a broad category is not proof that
 * it sells any particular dish. Keep broad/category discovery opt-in via
 * CRAWL_QUERIES; the default dataset-building pass must create coverage for
 * dish -> restaurant queries so menu OCR can verify the actual offering.
 */
export const DEFAULT_PLAYWRIGHT_QUERIES = [
  'bún bò Huế',
  'bún riêu',
  'bún thịt nướng',
  'bún đậu mắm tôm',
  'phở bò',
  'phở gà',
  'hủ tiếu Nam Vang',
  'mì Quảng',
  'bánh canh cua',
  'bánh mì thịt',
  'bánh mì thịt nướng',
  'mì xào hải sản',
  'bánh xèo',
  'cơm tấm sườn',
  'cơm gà',
  'cơm niêu',
  'lẩu bò',
  'lẩu Thái',
  'gà nướng',
  'vịt quay',
  'ốc',
  'hải sản nướng',
  'pizza hải sản',
  'sushi cá hồi',
  'mì cay',
  'cháo lòng',
  'chè',
  'cà phê trứng',
];

/** Broad discovery remains available for explicitly requested maintenance runs. */
export const BROAD_PLAYWRIGHT_QUERIES = [
  'quán ăn', 'nhà hàng', 'quán cà phê', 'món Việt', 'quán chay', 'lẩu',
  'nướng BBQ', 'hải sản', 'món Huế', 'món Nhật', 'món Hàn', 'pizza',
  'tráng miệng',
];

export function buildPlaywrightQueryPlan(
  options: PlaywrightQueryPlanOptions,
): PlaywrightQueryTarget[] {
  const city = options.city.trim();
  const districts = options.districts?.length
    ? options.districts.map((d) => d.trim()).filter(Boolean)
    : options.district
      ? [options.district.trim()]
      : [];
  const queries = (options.queries?.length ? options.queries : DEFAULT_PLAYWRIGHT_QUERIES)
    .map((query) => query.trim())
    .filter(Boolean);
  const limit = Math.min(Math.max(Math.floor(options.limitPerQuery), 1), 50);

  if (!city) throw new Error('city is required for a Playwright query plan.');
  if (!queries.length) throw new Error('At least one non-empty query is required.');

  const locations = districts.length > 0 ? districts.map((d) => `${d}, ${city}`) : [city];

  const unique = new Map<string, PlaywrightQueryTarget>();
  for (const location of locations) {
    for (const query of queries) {
      const key = `${query.toLocaleLowerCase('vi-VN')}::${location.toLocaleLowerCase('vi-VN')}`;
      if (!unique.has(key)) unique.set(key, { query, location, limit });
    }
  }
  return [...unique.values()];
}

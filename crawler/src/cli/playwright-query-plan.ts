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

export const DEFAULT_PLAYWRIGHT_QUERIES = [
    'quán ăn',
    'nhà hàng',
    'quán cà phê',
    'món Việt',
    'bún phở',
    'cơm',
    'hủ tiếu mì',
    'bánh mì',
    'quán chay',
    'lẩu',
    'nướng BBQ',
    'hải sản',
    'món Huế',
    'món Nhật',
    'món Hàn',
    'pizza',
    'tráng miệng',
];

export function buildPlaywrightQueryPlan(options: PlaywrightQueryPlanOptions): PlaywrightQueryTarget[] {
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

    const locations = districts.length > 0
        ? districts.map((d) => `${d}, ${city}`)
        : [city];

    const unique = new Map<string, PlaywrightQueryTarget>();
    for (const location of locations) {
        for (const query of queries) {
            const key = `${query.toLocaleLowerCase('vi-VN')}::${location.toLocaleLowerCase('vi-VN')}`;
            if (!unique.has(key)) unique.set(key, { query, location, limit });
        }
    }
    return [...unique.values()];
}
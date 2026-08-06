export type RestaurantQueryOptions = {
  limit?: number;
  category?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  openNow?: boolean;
  sort?: 'relevance' | 'distance' | 'rating' | 'newest';
  tastes?: string[];
};

export type SearchQueryOptions = {
  category?: string;
  openNow?: boolean;
  sort?: 'relevance' | 'distance' | 'rating' | 'newest';
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
};

export function buildRestaurantQuery(options: RestaurantQueryOptions = {}): string {
  const params = new URLSearchParams({ limit: String(options.limit ?? 50) });
  if (options.category) params.set('category', options.category);
  if (options.latitude !== undefined && options.longitude !== undefined) {
    params.set('latitude', String(options.latitude));
    params.set('longitude', String(options.longitude));
  }
  if (
    options.radiusMeters !== undefined &&
    options.latitude !== undefined &&
    options.longitude !== undefined
  ) {
    params.set('radiusMeters', String(options.radiusMeters));
  }
  if (options.openNow !== undefined) params.set('openNow', String(options.openNow));
  if (options.sort) params.set('sort', options.sort);
  for (const taste of options.tastes ?? []) params.append('tastes', taste);
  return params.toString();
}

export function buildSearchQuery(query: string, options: SearchQueryOptions = {}): string {
  const params = new URLSearchParams({ query: query.trim(), limit: '50' });
  if (options.category) params.set('category', options.category);
  if (options.openNow !== undefined) params.set('openNow', String(options.openNow));
  if (options.sort) params.set('sort', options.sort);
  if (options.latitude !== undefined && options.longitude !== undefined) {
    params.set('latitude', String(options.latitude));
    params.set('longitude', String(options.longitude));
    if (options.radiusMeters !== undefined)
      params.set('radiusMeters', String(options.radiusMeters));
  }
  return params.toString();
}

export function buildDishQuery(
  limit = 20,
  query?: string,
  options: { category?: string; openNow?: boolean } = {},
): string {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query?.trim()) params.set('query', query.trim());
  if (options.category) params.set('category', options.category);
  if (options.openNow) params.set('openNow', 'true');
  return params.toString();
}

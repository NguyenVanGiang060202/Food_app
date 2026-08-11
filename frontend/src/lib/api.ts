import type { Dish, Restaurant } from './food-data.ts';
import { clearStoredAuth, setStoredUser } from '../hooks/auth-storage.ts';
import {
  buildDishQuery,
  buildRestaurantQuery,
  buildSearchQuery,
  type RestaurantQueryOptions,
  type SearchQueryOptions,
} from './api-params.ts';
import { createApiRequest } from './api-request.ts';
export { buildDishQuery, buildRestaurantQuery, buildSearchQuery } from './api-params.ts';

const API_BASE = (import.meta.env?.VITE_API_BASE_URL ?? '/api/v1').replace(/\/$/, '');
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, createApiRequest(init));
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? 'Không thể kết nối với máy chủ.');
  }
  return response.json() as Promise<T>;
}
export async function signIn(payload: { email: string; password: string }) {
  const result = await request<{
    token: string;
    user: { id: string; email: string; displayName?: string | null };
  }>('/auth/signin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  // The token is returned for API compatibility, but authentication is kept in
  // the HttpOnly session cookie set by the backend.
  void result.token;
  setStoredUser(result.user);
  return result.user;
}
export async function getCurrentUser() {
  const result = await request<{
    user: { id: string; email: string; displayName?: string | null };
  }>('/auth/me');
  setStoredUser(result.user);
  return result.user;
}
export async function signOut() {
  await request<{ loggedOut: boolean }>('/auth/logout', { method: 'POST' });
  clearStoredAuth();
}
export function signUp(payload: {
  email: string;
  password: string;
  confirmPassword: string;
  displayName?: string;
}) {
  return request<{ user: { email: string }; emailVerificationRequired: boolean }>('/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
export async function requestPasswordReset(email: string) {
  return request<{ sent: boolean; resetToken?: string }>('/auth/request-password-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}
export async function resetPassword(payload: {
  token: string;
  password: string;
  confirmPassword: string;
}) {
  return request<{ reset: boolean }>('/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
export async function verifyEmail(token: string) {
  return request<{ verified: boolean }>(`/auth/verify-email?token=${encodeURIComponent(token)}`);
}
export async function getGoogleAuthUrl() {
  return request<{ url: string }>('/auth/google');
}
export type SavedPage = {
  data: Restaurant[];
  meta: { nextCursor: string | null; limit: number; totalCount: number; totalPages: number };
};
export async function listSavedRestaurantsPage(
  options: { limit?: number; cursor?: string } = {},
): Promise<SavedPage> {
  const requestedLimit = Math.min(Math.max(Math.trunc(options.limit ?? 12), 1), 50);
  const params = new URLSearchParams({ limit: String(requestedLimit) });
  if (options.cursor) params.set('cursor', options.cursor);
  const result = await request<{ data: BackendRestaurantSummary[]; meta: SavedPage['meta'] }>(
    `/saved?${params.toString()}`,
  );
  const meta = result.meta;
  const limit = Math.min(Math.max(Math.trunc(meta.limit || requestedLimit), 1), 50);
  return { data: result.data.slice(0, limit).map(toRestaurant), meta: { ...meta, limit } };
}

export type BackendRestaurantSummary = {
  id: string;
  name: string;
  location: { formattedAddress: string; latitude: number | null; longitude: number | null };
  categories: Array<{ slug: string; name: string }>;
  rating: number | null;
  reviewCount: number | null;
  coverImageUrl: string | null;
  sourceUrl: string | null;
  distanceMeters?: number | null;
};
export type BackendRestaurantDetail = BackendRestaurantSummary & {
  description: string | null;
  phone: string | null;
  websiteUrl: string | null;
  openingHours: Array<{
    dayOfWeek: number;
    opensAt: string | null;
    closesAt: string | null;
    isClosed: boolean;
  }>;
  dishes: Array<{
    id: string;
    name: string;
    description: string | null;
    priceAmount: number | null;
    currencyCode: string | null;
    isPopular: boolean;
  }>;
  images: Array<{
    id: string;
    url: string;
    altText: string | null;
    isCover: boolean;
    sortOrder: number;
  }>;
  reviews: Array<{ id: string; rating: number | null; content: string | null }>;
};
export type BackendCategory = {
  slug: string;
  name: string;
  description: string | null;
  parentSlug: string | null;
  restaurantCount: number;
};
export type BackendDish = {
  id: string;
  name: string;
  description: string | null;
  priceAmount: number | null;
  currencyCode: string | null;
  isPopular: boolean;
  restaurantId: string;
  restaurantName: string;
  imageUrl: string | null;
  category: string | null;
};
export type RecommendationFilters = {
  taste?: string[];
  openNow?: boolean;
  radiusMeters?: number;
  minRating?: number;
  priceLevel?: number;
  sort?: 'relevance' | 'distance' | 'rating' | 'newest';
  area?: string;
  dishTypes?: string[];
};
export type RecommendationItem = {
  restaurant: BackendRestaurantSummary;
  explanation?: string | null;
};
export type RecommendationPage = {
  items: RecommendationItem[];
  nextCursor: string | null;
};
export type InterpretedSearch = {
  query: string;
  aiSummary?: string | null;
  filters: {
    category?: string;
    district?: string;
    attributes: string[];
    tastes?: string[];
    priceLevel?: number;
    minRating?: number;
    openNow?: boolean;
    distanceKm?: number;
  };
};
export type PreferenceMemory = { id: string; text: string };
export type AiPreferences = {
  favoriteFoodSlugs: string[];
  favoriteCuisineSlugs: string[];
  tastePreferences: string[];
  dietaryPreferences: string[];
  searchRadius?: '2' | '5' | '10' | 'any';
  budget?: 'under-100' | '100-200' | '200-500' | 'any';
  diningStyles: string[];
  restaurantFeatures: string[];
  recommendationStyle?: 'popular' | 'hidden-gems' | 'new' | 'local';
  recommendationPriority?: 'distance' | 'quality' | 'rating' | 'price' | 'atmosphere';
  suggestionCount?: 'few' | 'balanced' | 'many';
  memories: PreferenceMemory[];
};
export type UserPreferences = {
  favoriteCategorySlugs: string[];
  dietaryPreferences: string[];
  preferredPriceLevels: number[];
  aiPreferences?: Partial<AiPreferences>;
};

export function toRestaurant(item: BackendRestaurantSummary): Restaurant {
  const categoryNames = item.categories
    .map((category) => category.name || category.slug)
    .filter(Boolean);
  return {
    id: item.id,
    name: item.name,
    area: item.location.formattedAddress,
    cuisine: categoryNames.length ? categoryNames : ['Quán ăn'],
    rating: item.rating,
    reviews: item.reviewCount,
    distanceKm: item.distanceMeters == null ? null : Math.round(item.distanceMeters / 100) / 10,
    price: null,
    open: null,
    hours: null,
    image: item.coverImageUrl,
    sourceUrl: item.sourceUrl,
    description: null,
    dishIds: [],
    latitude: item.location.latitude,
    longitude: item.location.longitude,
  };
}

export function toDish(
  item: BackendRestaurantDetail['dishes'][number],
  restaurant?: BackendRestaurantSummary,
): Dish {
  return {
    id: item.id,
    name: item.name,
    vi: item.description ?? undefined,
    cuisine: restaurant?.categories?.[0]?.name ?? 'Món ăn',
    category: 'Món',
    price: item.priceAmount ?? 0,
    rating: 0,
    attrs: [],
    image: restaurant?.coverImageUrl || '/no-photo.svg',
    restaurantId: restaurant?.id,
    restaurantName: restaurant?.name,
  };
}

export function detailToRestaurant(item: BackendRestaurantDetail): Restaurant {
  return {
    ...toRestaurant(item),
    description: item.description,
    image: item.images.find((image) => image.isCover)?.url ?? item.coverImageUrl,
    hours: item.openingHours.length
      ? item.openingHours
          .map((hour) =>
            hour.isClosed ? 'Đóng cửa' : `${hour.opensAt ?? '?'}–${hour.closesAt ?? '?'}`,
          )
          .join(', ')
      : null,
    dishIds: item.dishes.map((dish) => dish.id),
  };
}

export type RestaurantListOptions = RestaurantQueryOptions;

export async function listRestaurants(options: RestaurantListOptions = {}): Promise<Restaurant[]> {
  const result = await request<{ data: BackendRestaurantSummary[] }>(
    `/restaurants?${buildRestaurantQuery(options)}`,
  );
  return result.data.map(toRestaurant);
}

export async function listTrendingRestaurants(
  options: {
    limit?: number;
    district?: string;
    sort?: 'rating' | 'newest';
  } = {},
): Promise<Restaurant[]> {
  const { limit = 30, district, sort = 'rating' } = options;
  const params = new URLSearchParams({
    limit: String(limit),
    sort: sort === 'rating' ? 'rating' : 'newest',
    ...(district ? { district } : {}),
  });
  const result = await request<{ data: BackendRestaurantSummary[] }>(
    `/restaurants?${params.toString()}`,
  );
  return result.data.map(toRestaurant);
}

export async function listCategories(): Promise<BackendCategory[]> {
  const result = await request<{ data: BackendCategory[] }>('/categories');
  return result.data;
}

export async function listDishes(
  limit = 20,
  query?: string,
  options: { category?: string; openNow?: boolean } = {},
): Promise<BackendDish[]> {
  const result = await request<{ data: BackendDish[] }>(
    `/dishes?${buildDishQuery(limit, query, options)}`,
  );
  return result.data;
}

export async function getDish(dishId: string): Promise<BackendDish | null> {
  const result = await request<{ data: BackendDish | null }>(
    `/dishes/${encodeURIComponent(dishId)}`,
  );
  return result.data;
}

export type SearchOptions = SearchQueryOptions;

export async function searchRestaurants(
  query: string,
  options: SearchOptions = {},
): Promise<Restaurant[]> {
  const result = await request<{ data: BackendRestaurantSummary[] }>(
    `/search?${buildSearchQuery(query, options)}`,
  );
  return result.data.map(toRestaurant);
}

export async function getRecommendations(
  payload: {
    query: string;
    limit?: number;
    location?: { latitude: number; longitude: number };
    filters?: RecommendationFilters;
    cursor?: string;
  },
  signal?: AbortSignal,
): Promise<RecommendationPage> {
  const result = await request<{
    data: RecommendationItem[];
    meta?: { nextCursor: string | null };
  }>('/recommendations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  return { items: result.data, nextCursor: result.meta?.nextCursor ?? null };
}

export async function getForYouRecommendations(): Promise<RecommendationItem[]> {
  const result = await request<{ data: RecommendationItem[] }>('/recommendations/for-you');
  return result.data;
}

export async function interpretSearch(
  query: string,
  signal?: AbortSignal,
): Promise<InterpretedSearch> {
  const result = await request<{ data: InterpretedSearch }>('/search/interpret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: query.trim() }),
    signal,
  });
  return result.data;
}

export async function getRestaurant(restaurantId: string): Promise<BackendRestaurantDetail> {
  const result = await request<{ data: BackendRestaurantDetail }>(
    `/restaurants/${encodeURIComponent(restaurantId)}`,
  );
  return result.data;
}

export async function getSimilarRestaurants(
  restaurantId: string,
  limit = 12,
): Promise<Restaurant[]> {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 20);
  const result = await request<{ data: BackendRestaurantSummary[] }>(
    `/restaurants/${encodeURIComponent(restaurantId)}/similar?limit=${boundedLimit}`,
  );
  return result.data.map(toRestaurant);
}

export async function isRestaurantSaved(restaurantId: string): Promise<boolean> {
  const result = await request<{ saved: boolean }>(`/saved/${encodeURIComponent(restaurantId)}`);
  return result.saved;
}

const savedStatusCache = new Map<string, boolean>();
const savedStatusRequests = new Map<string, Promise<boolean>>();

export function getCachedSavedStatus(userId: string, restaurantId: string): boolean | undefined {
  return savedStatusCache.get(`${userId}:${restaurantId}`);
}

export function loadSavedStatus(userId: string, restaurantId: string): Promise<boolean> {
  const key = `${userId}:${restaurantId}`;
  const cached = savedStatusCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const existing = savedStatusRequests.get(key);
  if (existing) return existing;
  const request = isRestaurantSaved(restaurantId)
    .then((value) => {
      savedStatusCache.set(key, value);
      return value;
    })
    .finally(() => savedStatusRequests.delete(key));
  savedStatusRequests.set(key, request);
  return request;
}

export function setCachedSavedStatus(userId: string, restaurantId: string, saved: boolean): void {
  savedStatusCache.set(`${userId}:${restaurantId}`, saved);
}

export async function saveRestaurant(restaurantId: string): Promise<void> {
  await request<{ saved: boolean }>(`/saved/${encodeURIComponent(restaurantId)}`, {
    method: 'POST',
  });
}

export async function removeSavedRestaurant(restaurantId: string): Promise<void> {
  await request<{ saved: boolean }>(`/saved/${encodeURIComponent(restaurantId)}`, {
    method: 'DELETE',
  });
}

export async function getPreferences(): Promise<UserPreferences> {
  const result = await request<{ data: UserPreferences }>('/users/me/preferences');
  return result.data;
}

export async function updatePreferences(preferences: UserPreferences): Promise<UserPreferences> {
  const result = await request<{ data: UserPreferences }>('/users/me/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preferences),
  });
  return result.data;
}

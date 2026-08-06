import type { RestaurantSort } from './restaurants.dto';

export interface RestaurantCategory {
  slug: string;
  name: string;
}
export interface OpeningHour {
  dayOfWeek: number;
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
  spansNextDay: boolean;
}
export interface Dish {
  id: string;
  name: string;
  description: string | null;
  priceAmount: number | null;
  currencyCode: string | null;
  isPopular: boolean;
}
export interface RestaurantImage {
  id: string;
  url: string;
  altText: string | null;
  isCover: boolean;
  sortOrder: number;
}
export interface RestaurantReview {
  id: string;
  rating: number | null;
  content: string | null;
  reviewedAt: string | null;
  languageCode: string | null;
}
export interface RestaurantSummary {
  id: string;
  name: string;
  location: { formattedAddress: string; latitude: number | null; longitude: number | null };
  categories: RestaurantCategory[];
  rating: number | null;
  reviewCount: number | null;
  priceLevel: number | null;
  coverImageUrl: string | null;
  sourceUrl?: string | null;
  distanceMeters?: number | null;
}
export interface RestaurantDetail extends RestaurantSummary {
  description: string | null;
  phone: string | null;
  websiteUrl: string | null;
  openingHours: OpeningHour[];
  dishes: Dish[];
  images: RestaurantImage[];
  reviews: RestaurantReview[];
}
export interface RestaurantFilters {
  query?: string;
  category?: string;
  city?: string;
  district?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  minRating?: number;
  priceLevel?: number;
  openNow?: boolean;
  sort?: RestaurantSort;
  limit: number;
  cursor?: string;
  dishTypes?: string[];
  tastes?: string[];
}
export interface RestaurantPage {
  data: RestaurantSummary[];
  meta: { nextCursor: string | null; limit: number };
}

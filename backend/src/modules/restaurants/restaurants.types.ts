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
  matchedDishes?: string[];
  dishCandidate?: boolean;
  dishEvidenceStatus?: 'verified_menu' | 'candidate_signal';
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
  /** Canonical dish names resolved against available menu rows. */
  dishQueries?: string[];
  /** Only return trusted exact menu matches with a verified VND dish price within this budget. */
  maxDishPriceVnd?: number;
  maxDishPriceExclusive?: boolean;
  /** Exact dietary variants must not fall back to venue-name/OCR candidates. */
  verifiedMenuOnly?: boolean;
  /** A full catalog menu label must match the dish name itself, not another dish's description. */
  exactDishNameOnly?: boolean;
  /** Alternative exact dishes for broad contextual intent (for example rain). */
  dishQueriesAny?: string[];
  /** Explicit preparation/style constraint such as "món khô". */
  dishStyle?: 'dry' | 'brothy';
  /** Require the explicit food/cuisine term instead of semantic-profile matches. */
  strictFoodQuery?: string;
  /** Explicitly rejected foods/tastes; never relax these during fallback or pagination. */
  excludedFoodTerms?: string[];
  /** Ingredients that must occur together in one trusted dish or venue name. */
  ingredientTerms?: string[];
  /** Semantic text kept on the recommendation cursor so a later page re-embeds the same query. */
  semanticQuery?: string;
  /** Query vector + active embedding model, attached internally for pgvector ranking. */
  embedding?: { vector: number[]; model: string } | null;
  /** Authenticated user context used only for bounded recommendation signals. */
  personalizationUserId?: string;
}
export interface RestaurantPage {
  data: RestaurantSummary[];
  meta: { nextCursor: string | null; limit: number };
}

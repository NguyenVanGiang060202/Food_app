export interface Coordinates { latitude: number; longitude: number; }
export interface SourceOpeningHour { dayOfWeek: number; opensAt: string | null; closesAt: string | null; isClosed: boolean; spansNextDay?: boolean; }
export interface SourceDish { name: string; description?: string; priceAmount?: number; currencyCode?: string; isPopular?: boolean; }
export interface SourceImage { url: string; altText?: string; isCover?: boolean; sortOrder?: number; }
export interface SourceReview {
  externalReviewId: string;
  rating?: number;
  content?: string;
  reviewedAt?: string;
  languageCode?: string;
}
export interface SourceRestaurantRecord {
  providerCode: string; externalId: string; sourceUrl?: string; collectedAt: string; name: string; address?: string;
  district?: string; city?: string; countryCode?: string; coordinates?: Coordinates; phone?: string; websiteUrl?: string;
  openingHours?: SourceOpeningHour[]; categories?: string[]; priceLevel?: number; rating?: number; reviewCount?: number;
  images?: SourceImage[]; dishes?: SourceDish[]; reviews?: SourceReview[];
  sourceMetadata: Record<string, unknown>;
}
export interface DiscoveryInput {
  city?: string;
  district?: string;
  category?: string;
  query?: string;
  location?: string;
  limit: number;
}
export interface SourceRecordReference { externalId: string; }

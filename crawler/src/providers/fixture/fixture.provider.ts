import type { DataProviderAdapter } from '../provider.interface';
import type { DiscoveryInput, SourceRestaurantRecord } from '../../types/source-record';

const records: SourceRestaurantRecord[] = [
  { providerCode: 'fixture', externalId: 'fixture-bep-nha-minh', sourceUrl: 'https://example.test/fixture/bep-nha-minh', collectedAt: new Date().toISOString(), name: 'Bếp Nhà Mình', address: '12 Nguyen Hue', district: 'District 1', city: 'Ho Chi Minh City', countryCode: 'VN', coordinates: { latitude: 10.7756, longitude: 106.7042 }, categories: ['vietnamese', 'noodle'], priceLevel: 2, rating: 4.6, reviewCount: 128, dishes: [{ name: 'Phở bò tái', priceAmount: 65000, currencyCode: 'VND', isPopular: true }], images: [{ url: 'https://images.unsplash.com/photo-1582878826629-29b7ad1cdc43?w=1200', isCover: true }], sourceMetadata: { fixture: true } },
  { providerCode: 'fixture', externalId: 'fixture-lang-coffee', sourceUrl: 'https://example.test/fixture/lang-coffee', collectedAt: new Date().toISOString(), name: 'Lặng Coffee', address: '28 Le Loi', district: 'District 1', city: 'Ho Chi Minh City', countryCode: 'VN', coordinates: { latitude: 10.7731, longitude: 106.7009 }, categories: ['coffee-shop'], priceLevel: 2, rating: 4.8, reviewCount: 86, sourceMetadata: { fixture: true } },
  { providerCode: 'fixture', externalId: 'fixture-moc-chay', sourceUrl: 'https://example.test/fixture/moc-chay', collectedAt: new Date().toISOString(), name: 'Mộc Chay', address: '45 Vo Van Tan', district: 'District 3', city: 'Ho Chi Minh City', countryCode: 'VN', coordinates: { latitude: 10.7769, longitude: 106.6878 }, categories: ['vegetarian'], priceLevel: 3, rating: 4.5, reviewCount: 64, sourceMetadata: { fixture: true } },
];

export class FixtureProvider implements DataProviderAdapter {
  readonly providerCode = 'fixture';
  async validateConfiguration(): Promise<void> { }
  async *discover(input: DiscoveryInput): AsyncIterable<SourceRestaurantRecord> { let emitted = 0; for (const record of records) { if (input.city && record.city?.toLowerCase() !== input.city.toLowerCase()) continue; if (input.district && record.district?.toLowerCase() !== input.district.toLowerCase()) continue; if (input.category && !record.categories?.includes(input.category)) continue; if (emitted++ >= input.limit) break; yield { ...record, collectedAt: new Date().toISOString() }; } }
}
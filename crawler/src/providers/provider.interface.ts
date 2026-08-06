import type {
  DiscoveryInput,
  SourceRestaurantRecord,
  SourceRecordReference,
} from '../types/source-record';
export interface DataProviderAdapter {
  readonly providerCode: string;
  validateConfiguration(): Promise<void>;
  discover(input: DiscoveryInput): AsyncIterable<SourceRestaurantRecord>;
  fetchDetails?(input: SourceRecordReference): Promise<SourceRestaurantRecord>;
}

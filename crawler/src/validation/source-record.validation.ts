import type { SourceRestaurantRecord } from '../types/source-record';
export function validateSourceRecord(record: SourceRestaurantRecord): void {
  if (!record.providerCode.trim()) throw new Error('providerCode is required.');
  if (!record.externalId.trim()) throw new Error('externalId is required.');
  if (!record.name.trim()) throw new Error('name is required.');
  if (!record.collectedAt || Number.isNaN(Date.parse(record.collectedAt))) throw new Error('collectedAt must be a valid ISO timestamp.');
  if (record.coordinates && (record.coordinates.latitude < -90 || record.coordinates.latitude > 90 || record.coordinates.longitude < -180 || record.coordinates.longitude > 180)) throw new Error('coordinates are outside valid geographic ranges.');
  if (record.rating !== undefined && (record.rating < 0 || record.rating > 5)) throw new Error('rating must be between 0 and 5.');
  if (record.reviewCount !== undefined && (!Number.isInteger(record.reviewCount) || record.reviewCount < 0)) throw new Error('reviewCount must be a non-negative integer.');
  if (record.priceLevel !== undefined && (!Number.isInteger(record.priceLevel) || record.priceLevel < 1 || record.priceLevel > 4)) throw new Error('priceLevel must be between 1 and 4.');
  for (const image of record.images ?? []) { if (!/^https?:\/\//i.test(image.url)) throw new Error('image URLs must use http or https.'); }
}

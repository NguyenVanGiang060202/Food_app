import type { SourceRestaurantRecord } from '../types/source-record';
export interface NormalizedRestaurantRecord extends SourceRestaurantRecord { normalizedName: string; formattedAddress: string; }
export function normalizeSourceRecord(record: SourceRestaurantRecord): NormalizedRestaurantRecord {
  const clean = (value?: string) => value?.normalize('NFKC').trim().replace(/\s+/g, ' ');
  const name = clean(record.name) ?? '';
  return { ...record, name, normalizedName: name.toLocaleLowerCase('vi-VN').normalize('NFD').replace(/[\u0300-\u036f]/g, ''), address: clean(record.address), formattedAddress: [clean(record.address), clean(record.district), clean(record.city)].filter(Boolean).join(', ') || name, categories: [...new Set((record.categories ?? []).map(value => value.trim().toLowerCase()).filter(Boolean))] };
}

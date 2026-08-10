export const CENTRAL_DISTRICTS = [
  'Quận 1',
  'Quận 3',
  'Quận 4',
  'Quận 5',
  'Quận 10',
  'Quận 11',
  'Bình Thạnh',
  'Phú Nhuận',
  'Tân Bình',
  'Gò Vấp',
] as const;

export type CentralDistrict = (typeof CENTRAL_DISTRICTS)[number];

export function getRandomCentralDistrict(): CentralDistrict {
  return CENTRAL_DISTRICTS[Math.floor(Math.random() * CENTRAL_DISTRICTS.length)];
}

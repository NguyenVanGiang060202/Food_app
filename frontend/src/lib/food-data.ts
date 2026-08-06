export type FoodAttr = string;
export type Dish = {
  id: string;
  name: string;
  vi?: string;
  cuisine: string;
  category: string;
  price: number;
  rating: number;
  attrs: FoodAttr[];
  image: string;
  restaurantId?: string;
  restaurantName?: string;
};
export type Restaurant = {
  id: string;
  name: string;
  area: string;
  cuisine: string[];
  rating: number | null;
  reviews: number | null;
  distanceKm: number | null;
  price: number | null;
  open: boolean | null;
  hours: string | null;
  image: string | null;
  sourceUrl: string | null;
  description: string | null;
  dishIds: string[];
  latitude?: number | null;
  longitude?: number | null;
};

export const formatVnd = (n: number) => `${n.toLocaleString('vi-VN')}₫`;

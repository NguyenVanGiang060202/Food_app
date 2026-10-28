// First-party website image alt text is useful only when it looks like an
// actual menu item. Product pages also reuse alt text for SEO headings,
// restaurant names, branch captions, and promotions. Those labels must not
// become exact dish evidence.

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isPlausibleWebsiteMenuLabel(value: string, restaurantName = '', source?: 'product-card'): boolean {
  const label = value.trim();
  if (label.length < 2 || label.length > 120) return false;
  if (/\$\{[^}]+\}|\{\{[^}]+\}\}/u.test(label)) return false;

  const normalized = normalize(label);
  const normalizedRestaurant = normalize(restaurantName);
  if (!normalized) return false;
  if (/^(?:[a-z0-9-]+\.)+(?:vn|com|net|org)$/i.test(label)) return false;
  if (/\.(?:jpe?g|png|webp|gif|svg)$/i.test(label)) return false;
  if (/^(?:tiktok|facebook|instagram|social|tripadvisor|youtube|google|google analytics|facebook pixel|hotline|zalo|payment|google dich|tieng viet|english|viet nam|vegan|vegetarian|organic|mild|gluten free)$/.test(normalized)) return false;
  // WordPress image filenames sometimes appear in alt attributes instead of
  // customer-facing dish labels (including Unicode filenames without .jpg).
  if (!/\s/.test(label) && /(?:[-_][^-_\s]+){2,}/u.test(label)) return false;
  if (/^[a-z]?\d{8,}[_-][a-z0-9_-]+$/i.test(label)) return false;

  // Menu section headings are not purchasable dishes.
  if (/^(?:mon chay|mon an|mon chinh|trang mieng|thuc uong|do uong|cac mon an)$/.test(normalized)) return false;

  // A restaurant's own name is not a menu item, even when it contains the
  // target dish phrase (for example "Gà Nướng A Dậu").
  if (normalizedRestaurant && normalized === normalizedRestaurant) return false;

  // Generic/brand labels that are commonly emitted by catalog templates.
  if (/^(?:com tam (?:cali|khac)|mat tien)(?: |$)/i.test(normalized)) return false;
  if (/^menu (?:de nhat ga nuong)$/i.test(normalized)) return false;

  // SEO headings, announcements, delivery copy and location/branch captions
  // commonly appear as image alt text beside real products.
  if (
    /(?:top \d+|quan |website|menu(?:[-_ ]|$)|review|dia chi|chi nhanh|phuong|q \d+|p \d+|ho chi minh|binh thanh|go vap|tan binh|binh tan|thu duc|phu nhuan|nguyen \w+ \d|\d{2,4} (?:duong|street|road)|khai truong|mua \d+ duoc \d+|thong bao|giao ngay|ngai gi mua nang|noi mang den|day dinh duong|khong nghi le|uu dai|khuyen mai|dat ngay|thanh toan|delivery|ship hang)/i.test(
      normalized,
    )
  ) {
    return false;
  }

  // A long sentence is almost always marketing/SEO copy rather than a dish
  // label. Keep concrete combo/set names, which can still be valid offerings.
  if (normalized.split(' ').length > (source === 'product-card' ? 14 : 9)) return false;

  return true;
}

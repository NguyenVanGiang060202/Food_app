import { Pool } from 'pg';
import { isPlausibleWebsiteMenuLabel } from '../enrichment/website-menu-label';

type RestaurantRow = { id: string; name: string; website_url: string; website_peer_count: number };
type ImageCandidate = { url: string; alt: string; source: 'jsonld-menuitem' | 'jsonld-product' | 'product-card' | 'image-alt'; pageUrl: string };
type PageExtraction = { links: string[]; images: ImageCandidate[]; siteNames: string[] };

const DISHES = [
  'phở bò',
  'phở gà',
  'bún bò Huế',
  'bún riêu',
  'bún thịt nướng',
  'cơm tấm',
  'cơm gà',
  'hủ tiếu Nam Vang',
  'mì Quảng',
  'lẩu bò',
  'gà nướng',
  'bánh canh cua',
  'bánh mì thịt',
  'bánh mì thịt nướng',
  'mì xào hải sản',
  'bánh xèo',
  'món chay',
  'chè',
];
const BLOCKED_HOSTS = /(?:facebook|instagram|foody|grab\.com|food\.be|zalo\.me|m\.me)/i;
const PAGE_LIMIT = 8;
const FETCH_TIMEOUT_MS = 20_000;

export function parseArgs(argv: string[]): { dishes: string[]; exactDishes: string[]; restaurantIds: string[]; pageUrls: string[]; limit: number; offset: number; allSites: boolean; dryRun: boolean; uncoveredOnly: boolean; autoStructuredOnly: boolean; reviewAll: boolean } {
  const dishes: string[] = [];
  const exactDishes: string[] = [];
  const restaurantIds: string[] = [];
  const pageUrls: string[] = [];
  let limit = 50;
  let offset = 0;
  let allSites = false;
  let dryRun = false;
  let uncoveredOnly = false;
  let autoStructuredOnly = false;
  let reviewAll = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--dish' && argv[index + 1]) dishes.push(argv[++index]);
    else if (argv[index] === '--exact-dish' && argv[index + 1]) exactDishes.push(argv[++index]);
    else if (argv[index] === '--restaurant-id' && argv[index + 1]) restaurantIds.push(argv[++index]);
    else if (argv[index] === '--page-url' && argv[index + 1]) pageUrls.push(argv[++index]);
    else if (argv[index] === '--limit' && argv[index + 1]) limit = Math.max(1, Math.min(500, Number(argv[++index])));
    else if (argv[index] === '--offset' && argv[index + 1]) offset = Math.max(0, Number(argv[++index]) || 0);
    else if (argv[index] === '--all-sites') allSites = true;
    else if (argv[index] === '--dry-run') dryRun = true;
    else if (argv[index] === '--uncovered-only') uncoveredOnly = true;
    else if (argv[index] === '--auto-structured-only') autoStructuredOnly = true;
    else if (argv[index] === '--review-all') reviewAll = true;
  }
  return { dishes: dishes.length ? dishes : DISHES, exactDishes, restaurantIds, pageUrls, limit, offset, allSites, dryRun, uncoveredOnly, autoStructuredOnly, reviewAll };
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // NFD leaves Vietnamese đ/Đ intact because they are separate letters,
    // not combining marks. Map both cases before lowercasing so "Đặc" and
    // "đặc" have the same database identity.
    .replace(/[đĐ]/g, 'd')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCharCode(Number(digits)))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function dishNameFromWebsiteLabel(label: string): string {
  // Price is source metadata, not part of a dish identity. Keep the original
  // label in evidence while using a stable, readable name for recommendation.
  // Pazzi publishes MenuItem JSON-LD names with a site-title suffix; that
  // suffix identifies the source, not food served on the menu.
  return label.trim()
    .replace(/\s*\|\s*Pazzi\.vn\s*$/iu, '')
    .replace(/\s*-\s*Phở Nhon\s*$/iu, '')
    .replace(/\s*\((?:theo thời giá|[\d.,]+\s*(?:đ|₫|vnd)(?:\s*\/\s*(?:kg|phần|suất))?)\)\s*$/iu, '')
    .trim();
}

function absoluteUrl(raw: string, base: string): string | null {
  if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return null;
  try {
    return new URL(decodeHtml(raw), base).toString();
  } catch {
    return null;
  }
}

function jsonLdTypes(value: Record<string, unknown>): string[] {
  const raw = value['@type'];
  if (typeof raw === 'string') return [raw.toLowerCase()];
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === 'string').map((item) => item.toLowerCase());
  return [];
}

function jsonLdImageUrls(value: unknown, pageUrl: string): string[] {
  const values = Array.isArray(value) ? value : [value];
  const urls: string[] = [];
  for (const item of values) {
    const raw = typeof item === 'string'
      ? item
      : item && typeof item === 'object'
        ? ((item as Record<string, unknown>).url ?? (item as Record<string, unknown>).contentUrl)
        : null;
    if (typeof raw !== 'string') continue;
    const url = absoluteUrl(raw, pageUrl);
    if (url) urls.push(url);
  }
  return urls;
}

function walkJsonLd(value: unknown, pageUrl: string, images: Map<string, ImageCandidate>, siteNames: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) walkJsonLd(item, pageUrl, images, siteNames);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const object = value as Record<string, unknown>;
  const types = jsonLdTypes(object);
  const name = typeof object.name === 'string' ? decodeHtml(object.name) : '';
  if (name && types.some((type) => ['organization', 'restaurant', 'localbusiness', 'foodestablishment', 'website'].includes(type))) {
    siteNames.add(name);
  }
  const isMenuItem = types.includes('menuitem');
  const isMenuProduct = isMenuItem || types.includes('product');
  if (isMenuProduct && name) {
    for (const url of jsonLdImageUrls(object.image, pageUrl)) {
      images.set(url, { url, alt: name, source: isMenuItem ? 'jsonld-menuitem' : 'jsonld-product', pageUrl });
    }
  }
  for (const child of Object.values(object)) walkJsonLd(child, pageUrl, images, siteNames);
}

function extractJsonLd(html: string, pageUrl: string): { images: ImageCandidate[]; siteNames: string[] } {
  const images = new Map<string, ImageCandidate>();
  const siteNames = new Set<string>();
  const scriptPattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    try {
      walkJsonLd(JSON.parse(match[1].trim()), pageUrl, images, siteNames);
    } catch {
      // Some CMSs emit multiple JSON objects or invalid trailing commas. The
      // regular image/alt parser remains the safe fallback for those pages.
    }
  }
  return { images: [...images.values()], siteNames: [...siteNames] };
}

export function extractPage(html: string, pageUrl: string): PageExtraction {
  const links = new Set<string>();
  const images = new Map<string, ImageCandidate>();
  const siteNames = new Set<string>();
  const jsonLd = extractJsonLd(html, pageUrl);
  for (const image of jsonLd.images) images.set(image.url, image);
  for (const name of jsonLd.siteNames) siteNames.add(name);
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  if (title) siteNames.add(decodeHtml(title));
  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(linkPattern)) {
    const href = absoluteUrl(match[1], pageUrl);
    const text = decodeHtml(match[2]);
    if (!href || new URL(href).origin !== new URL(pageUrl).origin) continue;
    if (/menu|thuc|thực|mon|món|food|product|collection|order|dat mon|đặt món/i.test(`${href} ${text}`)) {
      links.add(href.split('#')[0]);
    }
  }
  // Some first-party catalogs leave image alt empty while displaying the
  // purchasable product name beside that image. Pair them only inside the
  // same bounded product card; the usual menu-page and exact-review gates
  // still decide whether this becomes trusted evidence.
  const productCardPattern = /<figure\b[^>]*class=["'][^"']*\bmark_img\b[^"']*["'][^>]*>((?:(?!<figure\b|<\/figure>)[\s\S]){0,1800})<\/figure>((?:(?!<figure\b)[\s\S]){0,1800}?)<span\b[^>]*class=["'][^"']*\btitle_red\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi;
  for (const match of html.matchAll(productCardPattern)) {
    const imgAttrs = /<img\b([^>]+)>/i.exec(match[1])?.[1] ?? '';
    const rawUrl = /(?:src|data-src)=["']([^"']+)["']/i.exec(imgAttrs)?.[1] ?? '';
    const url = absoluteUrl(rawUrl, pageUrl);
    const label = decodeHtml(match[3]);
    if (!url || label.length < 3 || label.length > 120) continue;
    if (/logo|banner|slider|favicon|icon|noimage|placeholder/i.test(url)) continue;
    if (!images.has(url)) images.set(url, { url, alt: label, source: 'product-card', pageUrl });
  }
  // WooCommerce grids often use a descriptive or stale image alt. The
  // purchasable product title is authoritative when its link matches the
  // image link inside the same bounded card. Never pair adjacent cards.
  const wooCardStart = /<div\b[^>]*class=["'][^"']*\bproduct-small\s+col\b[^"']*["'][^>]*>/gi;
  const wooStarts = [...html.matchAll(wooCardStart)];
  for (let index = 0; index < wooStarts.length; index += 1) {
    const start = wooStarts[index].index;
    const end = wooStarts[index + 1]?.index ?? Math.min(html.length, start + 10000);
    const card = html.slice(start, Math.min(end, start + 10000));
    const photo = /<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*<img\b([^>]+)>/i.exec(card);
    const title = /<p\b[^>]*class=["'][^"']*\bproduct-title\b[^"']*["'][^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/p>/i.exec(card);
    if (!photo || !title) continue;
    const photoHref = absoluteUrl(photo[1], pageUrl);
    const titleHref = absoluteUrl(title[1], pageUrl);
    if (!photoHref || photoHref !== titleHref) continue;
    // Lazy-loaded WooCommerce cards commonly use a data: SVG placeholder in
    // src. The real product photo is data-src; never persist that placeholder.
    const rawUrl = /\bdata-src=["']([^"']+)["']/i.exec(photo[2])?.[1]
      ?? /\bsrc=["']([^"']+)["']/i.exec(photo[2])?.[1] ?? '';
    const url = absoluteUrl(rawUrl, pageUrl);
    const label = decodeHtml(title[2]);
    if (!url || label.length < 3 || label.length > 120) continue;
    if (/logo|banner|slider|favicon|icon|noimage|placeholder/i.test(url)) continue;
    images.set(url, { url, alt: label, source: 'product-card', pageUrl });
  }
  // The7/WooCommerce catalogs keep each purchasable item in one wf-cell.
  // Match the photo and visible product title by their identical product URL;
  // an empty photo alt or a data: placeholder is not menu evidence by itself.
  const the7CardStart = /<div\b[^>]*class=["'][^"']*\bwf-cell\s+iso-item\b[^"']*["'][^>]*>/gi;
  const the7Starts = [...html.matchAll(the7CardStart)];
  for (let index = 0; index < the7Starts.length; index += 1) {
    const start = the7Starts[index].index;
    const end = the7Starts[index + 1]?.index ?? html.length;
    const card = html.slice(start, Math.min(end, start + 8000));
    if (!/\bproduct\b/iu.test(card) || !/\bprice\b/iu.test(card)) continue;
    const photo = /<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*<img\b([^>]+)>/i.exec(card);
    const title = /<h4\b[^>]*class=["'][^"']*\bentry-title\b[^"']*["'][^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h4>/i.exec(card);
    if (!photo || !title) continue;
    const photoHref = absoluteUrl(photo[1], pageUrl);
    const titleHref = absoluteUrl(title[1], pageUrl);
    if (!photoHref || photoHref !== titleHref) continue;
    const rawUrl = /\bdata-src=["']([^"']+)["']/i.exec(photo[2])?.[1]
      ?? /\bsrc=["']([^"']+)["']/i.exec(photo[2])?.[1] ?? '';
    const url = absoluteUrl(rawUrl, pageUrl);
    const label = decodeHtml(title[2]);
    if (!url || label.length < 3 || label.length > 120) continue;
    if (/logo|banner|slider|favicon|icon|noimage|placeholder/i.test(url)) continue;
    images.set(url, { url, alt: label, source: 'product-card', pageUrl });
  }
  // This menu layout places an empty-alt dish photo and its visible name in
  // the same sanpham__item link. Keep the match inside that one card so an
  // unrelated heading or the next dish cannot supply its label.
  const sanphamCardPattern = /<a\b[^>]*class=["'][^"']*\bsanpham__item\b[^"']*["'][^>]*>((?:(?!<\/a>)[\s\S]){0,3500})<\/a>/gi;
  for (const match of html.matchAll(sanphamCardPattern)) {
    const card = match[1];
    const rawUrl = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i.exec(card)?.[1] ?? '';
    const rawLabel = /<h3\b[^>]*>([\s\S]*?)<\/h3>/i.exec(card)?.[1] ?? '';
    const url = absoluteUrl(rawUrl, pageUrl);
    const label = decodeHtml(rawLabel);
    if (!url || label.length < 3 || label.length > 120) continue;
    if (/logo|banner|slider|favicon|icon|noimage|placeholder/i.test(url)) continue;
    images.set(url, { url, alt: label, source: 'product-card', pageUrl });
  }
  // Amano-style Flatsome menus put an empty-alt food photo, a visible dish
  // title and its price in one item-menu-slide column. Stop at the next
  // column; page-wide title/image pairing would mislabel neighboring dishes.
  const menuSlideStart = /<div\b[^>]*class=["'][^"']*\bcolg_menu\s+item-menu-slide\b[^"']*["'][^>]*>/gi;
  const menuSlides = [...html.matchAll(menuSlideStart)];
  for (let index = 0; index < menuSlides.length; index += 1) {
    const start = menuSlides[index].index;
    const end = menuSlides[index + 1]?.index ?? html.length;
    const card = html.slice(start, Math.min(end, start + 5500));
    const rawUrl = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i.exec(card)?.[1] ?? '';
    // Some published cards omit </p> and end the title with <br>; capture
    // only the immediate text node so description/next-card text cannot leak.
    const rawLabel = /<div\b[^>]*class=["'][^"']*\bdish_title\b[^"']*["'][^>]*>\s*<p\b[^>]*>([^<]{3,120})/i.exec(card)?.[1] ?? '';
    const hasPrice = /<div\b[^>]*class=["'][^"']*\bcurrency\b[^"']*["'][^>]*>\s*<p\b[^>]*>\s*\d{2,4}/i.test(card);
    const url = absoluteUrl(rawUrl, pageUrl);
    const label = decodeHtml(rawLabel);
    if (!hasPrice || !url || label.length < 3 || label.length > 120) continue;
    if (/logo|banner|slider|favicon|icon|noimage|placeholder/i.test(url)) continue;
    images.set(url, { url, alt: label, source: 'product-card', pageUrl });
  }
  // Blogger storefronts can render each menu item as an image + visible
  // <p class="name"> in one link card. Never pair across cards: a nearby
  // heading or the next product would create false dish evidence.
  const bloggerCardPattern = /<a\b[^>]*href=["'][^"']+["'][^>]*>\s*<div\b[^>]*>((?:(?!<\/div>)[\s\S]){0,2500})<\/div>\s*<\/a>/gi;
  for (const match of html.matchAll(bloggerCardPattern)) {
    const card = match[1];
    if (!/<p\b[^>]*class=["'][^"']*\bimg\b[^"']*["'][^>]*>/i.test(card)) continue;
    const rawUrl = /<img\b[^>]*(?:src|data-src)=["']([^"']+)["'][^>]*>/i.exec(card)?.[1] ?? '';
    const rawLabel = /<p\b[^>]*class=["'][^"']*\bname\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(card)?.[1] ?? '';
    const url = absoluteUrl(rawUrl, pageUrl);
    const label = decodeHtml(rawLabel.split(/<br\s*\/?\s*>/i)[0] ?? '');
    if (!url || label.length < 3 || label.length > 120) continue;
    if (/logo|banner|slider|favicon|icon|noimage|placeholder/i.test(url)) continue;
    if (!images.has(url)) images.set(url, { url, alt: label, source: 'product-card', pageUrl });
  }
  // Some first-party menu grids use a photo with empty alt and show the
  // purchasable dish name and price in the same Flatsome row. Bound each
  // pairing by the next row so a heading or neighboring dish cannot label it.
  const menuRowStart = /<div\b[^>]*class=["'][^"']*\brow\b[^"']*\balign-middle\b[^"']*\balign-center\b[^"']*["'][^>]*>/gi;
  const menuRows = [...html.matchAll(menuRowStart)];
  for (let index = 0; index < menuRows.length; index += 1) {
    const start = menuRows[index].index;
    const end = menuRows[index + 1]?.index ?? html.length;
    const card = html.slice(start, Math.min(end, start + 5000));
    if (!/(?:₫|&#8363;|&#x20ab;)/iu.test(card)) continue;
    const rawUrl = /<img\b[^>]*(?:src|data-src)=["']([^"']+)["'][^>]*>/i.exec(card)?.[1] ?? '';
    const rawLabel = /<p\b[^>]*>\s*<strong\b[^>]*>([^<]{3,120})<\/strong>/i.exec(card)?.[1] ?? '';
    const url = absoluteUrl(rawUrl, pageUrl);
    const label = decodeHtml(rawLabel);
    if (!url || label.length < 3 || label.length > 120) continue;
    if (/logo|banner|slider|favicon|icon|noimage|placeholder/i.test(url)) continue;
    images.set(url, { url, alt: label, source: 'product-card', pageUrl });
  }
  // Webflow menu sliders can keep a dish photo, its visible name and price
  // inside one ratio-card while leaving the image alt empty. Read each
  // balanced card independently so a photo cannot borrow the next card's
  // label or price. The caller still requires a first-party menu page and
  // exact reviewed labels before import.
  const webflowCardStart = /<div\b[^>]*class=["'][^"']*\bratio-card\b[^"']*["'][^>]*>/gi;
  for (const match of html.matchAll(webflowCardStart)) {
    const start = match.index;
    const tags = /<\/?div\b[^>]*>/gi;
    tags.lastIndex = start;
    let depth = 0;
    let end = -1;
    let tag: RegExpExecArray | null;
    while ((tag = tags.exec(html)) && tags.lastIndex - start <= 8000) {
      depth += /^<\/div/i.test(tag[0]) ? -1 : 1;
      if (depth === 0) { end = tags.lastIndex; break; }
    }
    if (end < 0) continue;
    const card = html.slice(start, end);
    if (!/\bparalax-card-inner\b/i.test(card) || !/\bbest-seller-slider-text-wrapper\b/i.test(card)) continue;
    const rawUrl = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i.exec(card)?.[1] ?? '';
    const rawLabel = /<div\b[^>]*class=["'][^"']*\bparalax-header\b[^"']*["'][^>]*>([^<]{3,120})<\/div>/i.exec(card)?.[1] ?? '';
    const rawPrice = /<div\b[^>]*class=["'][^"']*\boverline\b[^"']*["'][^>]*>([^<]{3,90})<\/div>/i.exec(card)?.[1] ?? '';
    if (!/\b\d{1,3}(?:[.,]\d{3})+\s*(?:vnd|₫|đ)(?:\s|$|\/)/iu.test(decodeHtml(rawPrice))) continue;
    const url = absoluteUrl(rawUrl, pageUrl);
    const label = decodeHtml(rawLabel);
    if (!url || label.length < 3 || label.length > 120) continue;
    if (/logo|banner|slider|favicon|icon|noimage|placeholder/i.test(url)) continue;
    images.set(url, { url, alt: label, source: 'product-card', pageUrl });
  }
  const imagePattern = /<img\b([^>]+)>/gi;
  for (const match of html.matchAll(imagePattern)) {
    const attrs = match[1];
    // Loveitop menu grids use a tiny data: placeholder in src and keep the
    // actual dish photo in data-isrc. Prefer the real lazy URL when present.
    const source = /\bdata-isrc=["']([^"']+)["']/i.exec(attrs)?.[1]
      ?? /\bdata-src=["']([^"']+)["']/i.exec(attrs)?.[1]
      ?? /\bdata-original=["']([^"']+)["']/i.exec(attrs)?.[1]
      ?? /\bsrc=["']([^"']+)["']/i.exec(attrs)?.[1]
      ?? /srcset=["']([^"']+)["']/i.exec(attrs)?.[1]?.split(',')[0]?.trim().split(/\s+/)[0];
    const alt = decodeHtml(
      /alt=["']([^"']*)["']/i.exec(attrs)?.[1]
        ?? /(?:data-product-name|data-name|data-title|title)=["']([^"']*)["']/i.exec(attrs)?.[1]
        ?? '',
    );
    const url = absoluteUrl(source ?? '', pageUrl);
    if (!url || !alt || alt.length < 3 || alt.length > 180) continue;
    if (/logo|banner|slider|facebook|instagram|favicon|icon|noimage|placeholder/i.test(`${alt} ${url}`)) continue;
    if (!images.has(url)) images.set(url, { url, alt, source: 'image-alt', pageUrl });
  }
  return { links: [...links], images: [...images.values()], siteNames: [...siteNames] };
}

export function addSiteCandidate(candidates: Map<string, ImageCandidate>, image: ImageCandidate): void {
  // The same photo can occur on a category page and its product detail page.
  // Keep both page provenances so an explicit --page-url review does not lose
  // the approved menu-page label to a later SEO-heavy product detail page.
  const key = `${image.pageUrl}\u0000${image.url}`;
  const existing = candidates.get(key);
  if (!existing || (existing.source === 'image-alt' && image.source !== 'image-alt')) {
    candidates.set(key, image);
  }
}

function meaningfulTokens(value: string): Set<string> {
  const ignored = new Set(['nha', 'hang', 'quan', 'restaurant', 'food', 'official', 'website', 'the', 'and', 'co', 'chi', 'nhanh', 'branch', 'viet', 'nam', 'saigon', 'ho', 'minh', 'bun', 'pho', 'com', 'banh', 'canh', 'bo', 'ga', 'heo', 'mi', 'lau', 'hai', 'san', 'nieu', 'tam', 'nuong', 'xao', 'cha', 'cua', 'tom', 'chay', 'ngon', 'sushi', 'pizza', 'cafe', 'coffee']);
  return new Set(normalize(value).split(' ').filter((token) => token.length >= 3 && !ignored.has(token)));
}

export function websiteIdentityMatchesRestaurant(siteNames: string[], restaurantName: string, _peerCount: number): boolean {
  // Even a URL used by one DB restaurant may point at another business. A
  // source URL alone is not proof of brand identity.
  const normalizedRestaurant = normalize(restaurantName);
  if (siteNames.some((name) => {
    const normalizedSite = normalize(name);
    // Short distinctive brand names can be shorter than the general
    // substring gate (for example "Pizza 4P's"). Match a title's leading
    // brand segment exactly; branch assignment still needs manual proof.
    const titleBrand = normalize(name.split(/[|–—]/u, 1)[0]);
    if (titleBrand.length >= 8 &&
      (normalizedRestaurant === titleBrand || normalizedRestaurant.startsWith(`${titleBrand} `))) return true;
    return (normalizedSite.length >= 12 && normalizedRestaurant.includes(normalizedSite))
      || (normalizedRestaurant.length >= 12 && normalizedSite.includes(normalizedRestaurant));
  })) return true;
  const restaurantTokens = meaningfulTokens(restaurantName);
  const siteTokens = meaningfulTokens(siteNames.join(' '));
  if (!siteTokens.size) return false;
  for (const token of restaurantTokens) if (siteTokens.has(token)) return true;
  return false;
}

export function isTrustedBulkMenuCandidate(image: ImageCandidate): boolean {
  if (image.source === 'jsonld-menuitem') return true;
  try {
    const segments = new URL(image.pageUrl).pathname.split('/').map((segment) => normalize(decodeURIComponent(segment)));
    return segments.some((segment) => /^(?:menu|thuc don|mon an|san pham|product|productall|products|order|dat mon|collection|collections|category|categories)(?: |$)/.test(segment));
  } catch {
    return false;
  }
}

export function isExplicitlyReviewedCategoryPage(
  image: ImageCandidate,
  selectedPageUrls: Set<string>,
  scopedRestaurant: boolean,
  reviewAll: boolean,
  exactDishes: string[],
): boolean {
  if (!scopedRestaurant || !selectedPageUrls.has(image.pageUrl.replace(/\/$/, ''))) return false;
  if (!reviewAll && !exactDishes.length) return false;
  try {
    return new URL(image.pageUrl).pathname.replace(/\/$/, '') !== '';
  } catch {
    return false;
  }
}

export function matchesTargetDish(label: string, targetTerms: string[]): boolean {
  const normalized = ` ${normalize(label)} `;
  return targetTerms.some((term) => normalized.includes(` ${normalize(term)} `));
}

export function matchesExactDishLabel(label: string, approvedLabels: string[]): boolean {
  const normalized = normalize(label);
  return approvedLabels.some((approved) => normalized === normalize(approved));
}

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (compatible; FoodDiscoveryMenuIndexer/1.0)',
      },
    });
    if (!response.ok) return null;
    // A Maps website link can redirect to an unrelated directory or ad site.
    // Only an HTTP(S) scheme upgrade or www redirect is safe to treat as the
    // same first-party source.
    const requestedHost = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    const finalHost = new URL(response.url).hostname.replace(/^www\./i, '').toLowerCase();
    if (requestedHost !== finalHost || BLOCKED_HOSTS.test(finalHost)) return null;
    const type = response.headers.get('content-type') ?? '';
    if (!type.includes('html')) return null;
    return { html: await response.text(), finalUrl: response.url };
  } catch {
    return null;
  }
}

export function validateOptions(options: ReturnType<typeof parseArgs>): void {
  if (options.autoStructuredOnly && !options.allSites) {
    throw new Error('--auto-structured-only requires --all-sites.');
  }
  if (options.autoStructuredOnly && !options.dryRun) {
    throw new Error('Structured MenuItem labels still require source review; --auto-structured-only is preview-only.');
  }
  if (options.allSites && !options.dryRun && !options.restaurantIds.length) {
    throw new Error('Bulk import requires --restaurant-id after reviewing --dry-run candidates.');
  }
  if (options.reviewAll && (!options.dryRun || !options.restaurantIds.length || options.autoStructuredOnly)) {
    throw new Error('--review-all requires --dry-run and --restaurant-id; it cannot be combined with --auto-structured-only.');
  }
  if (options.pageUrls.length && !options.restaurantIds.length) {
    throw new Error('--page-url requires --restaurant-id.');
  }
  if (options.exactDishes.length && !options.restaurantIds.length) {
    throw new Error('--exact-dish requires --restaurant-id.');
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  validateOptions(options);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const values: unknown[] = [];
  let where = `r.status = 'active' AND r.website_url IS NOT NULL AND r.website_url <> ''
    AND r.website_url !~* '(facebook|instagram|foody|grab\\.com|food\\.be|zalo\\.me|m\\.me)'`;
  if (options.uncoveredOnly) {
    where += ` AND NOT EXISTS (
      SELECT 1 FROM dish covered_dish
      JOIN dish_evidence covered_evidence ON covered_evidence.dish_id=covered_dish.id AND covered_evidence.evidence_type='menu_image'
      JOIN menu_image_extraction covered_extraction ON covered_extraction.restaurant_image_id=covered_evidence.restaurant_image_id
      WHERE covered_dish.restaurant_id=r.id AND covered_dish.status='available'
        AND covered_dish.source IN ('website:menu:v1','menu_image:curated')
        AND covered_extraction.status='completed'
        AND covered_extraction.model IN ('website:menu:v1','website:menu-image-curated:v1','google_maps:menu-curated:v1')
    )`;
  }
  if (options.restaurantIds.length) {
    values.push(options.restaurantIds);
    where += ` AND r.id = ANY($${values.length}::uuid[])`;
  } else if (!options.allSites) {
    const targetClauses = targetTermsForSql(options.dishes).map((dish) => {
      values.push(dish);
      return `lower(unaccent(r.name)) LIKE '%' || lower(unaccent($${values.length})) || '%'`;
    });
    where += ` AND (${targetClauses.join(' OR ')})`;
  }
  values.push(options.limit);
  const limitParameter = values.length;
  values.push(options.offset);
  const bulkSiteSql = `WITH selected_sites AS (
    SELECT r.website_url, count(*)::int AS peer_count
    FROM restaurant r WHERE ${where}
    GROUP BY r.website_url
    ORDER BY count(*) DESC, r.website_url
    LIMIT $${limitParameter} OFFSET $${values.length}
  )
  SELECT r.id, r.name, r.website_url, sites.peer_count AS website_peer_count
  FROM restaurant r JOIN selected_sites sites ON sites.website_url = r.website_url
  WHERE ${where}
  ORDER BY sites.peer_count DESC, r.website_url, r.id`;
  const restaurantSql = `SELECT r.id, r.name, r.website_url,
    (SELECT count(*)::int FROM restaurant peer
     WHERE peer.status = 'active' AND peer.website_url = r.website_url) AS website_peer_count
    FROM restaurant r WHERE ${where}
    ORDER BY r.updated_at DESC, r.id LIMIT $${limitParameter} OFFSET $${values.length}`;
  const restaurants = await pool.query<RestaurantRow>(
    options.allSites && !options.restaurantIds.length ? bulkSiteSql : restaurantSql,
    values,
  );
  let pages = 0;
  let images = 0;
  let matched = 0;
  let eligible = 0;
  let reviewCandidates = 0;
  let dishesApplied = 0;
  const targetTerms = options.dishes;
  const selectedPageUrls = new Set(options.pageUrls.map((url) => url.replace(/\/$/, '')));
  const siteCache = new Map<string, { candidates: Map<string, ImageCandidate>; siteNames: Set<string>; pages: number }>();

  for (const restaurant of restaurants.rows) {
    let homepage: URL;
    try {
      homepage = new URL(restaurant.website_url);
    } catch {
      continue;
    }
    if (BLOCKED_HOSTS.test(homepage.hostname)) continue;
    const siteKey = homepage.toString();
    let cachedSite = siteCache.get(siteKey);
    const cacheHit = !!cachedSite;
    if (!cachedSite) {
      // A reviewed page can be deeper than the eight links discovered from a
      // homepage. Fetch it directly, but never let a caller turn this into a
      // cross-site URL fetch or attach another brand's menu to this restaurant.
      const reviewedPages = options.pageUrls.filter((pageUrl) => {
        try {
          const candidate = new URL(pageUrl);
          return ['http:', 'https:'].includes(candidate.protocol)
            && candidate.hostname.replace(/^www\./i, '').toLowerCase()
              === homepage.hostname.replace(/^www\./i, '').toLowerCase();
        } catch {
          return false;
        }
      });
      const queue = [siteKey, ...reviewedPages];
      const seenPages = new Set<string>();
      const candidates = new Map<string, ImageCandidate>();
      const siteNames = new Set<string>();
      while (queue.length && seenPages.size < PAGE_LIMIT) {
        const batch: string[] = [];
        while (queue.length && seenPages.size < PAGE_LIMIT) {
          const pageUrl = queue.shift()!;
          if (seenPages.has(pageUrl)) continue;
          seenPages.add(pageUrl);
          batch.push(pageUrl);
        }
        const htmlPages = await Promise.all(batch.map((pageUrl) => fetchHtml(pageUrl)));
        for (let index = 0; index < batch.length; index += 1) {
          const pageUrl = batch[index];
          const fetched = htmlPages[index];
          if (!fetched) continue;
          pages += 1;
          const extracted = extractPage(fetched.html, fetched.finalUrl);
          for (const image of extracted.images) {
            addSiteCandidate(candidates, image);
          }
          // Product-page titles often contain dish words. Use only homepage
          // identity signals so an unrelated shared URL cannot appear to match.
          if (pageUrl === siteKey) for (const name of extracted.siteNames) siteNames.add(name);
          for (const link of extracted.links) if (!seenPages.has(link) && queue.length < PAGE_LIMIT * 2) queue.push(link);
        }
      }
      cachedSite = { candidates, siteNames, pages: seenPages.size };
      siteCache.set(siteKey, cachedSite);
    }
    const { candidates, siteNames } = cachedSite;
    let restaurantDishesApplied = 0;
    const seenDishNames = new Set<string>();
    const seenReviewNames = new Set<string>();
    if (!websiteIdentityMatchesRestaurant([...siteNames], restaurant.name, options.allSites ? Math.max(2, restaurant.website_peer_count) : restaurant.website_peer_count)) {
      console.error(JSON.stringify({
        event: 'website_identity_mismatch',
        restaurant: restaurant.name,
        website: restaurant.website_url,
        peerCount: restaurant.website_peer_count,
        siteNames: [...siteNames].slice(0, 8),
      }));
      continue;
    }
    for (const image of candidates.values()) {
      if (selectedPageUrls.size && !selectedPageUrls.has(image.pageUrl.replace(/\/$/, ''))) continue;
      if (options.allSites && !isTrustedBulkMenuCandidate(image)
        && !isExplicitlyReviewedCategoryPage(image, selectedPageUrls, options.restaurantIds.length > 0, options.reviewAll, options.exactDishes)) continue;
      if (options.autoStructuredOnly && image.source !== 'jsonld-menuitem') {
        const reviewName = normalize(image.alt);
        if (matchesTargetDish(image.alt, targetTerms)
          && isPlausibleWebsiteMenuLabel(image.alt, restaurant.name, image.source === 'product-card' ? 'product-card' : undefined)
          && !seenReviewNames.has(reviewName)) {
          seenReviewNames.add(reviewName);
          reviewCandidates += 1;
          console.log(JSON.stringify({ event: 'website_menu_review_candidate', restaurant: restaurant.name, restaurantId: restaurant.id, dish: image.alt.trim(), source: image.source, pageUrl: image.pageUrl, imageUrl: image.url }));
        }
        continue;
      }
      if (!options.autoStructuredOnly && !options.reviewAll &&
        (options.exactDishes.length
          ? !matchesExactDishLabel(image.alt, options.exactDishes)
          : !matchesTargetDish(image.alt, targetTerms))) continue;
      matched += 1;
      // The target dish only selects candidate restaurants. The exact dish
      // fact must come from the first-party menu label itself; storing the
      // broad target here (for example, every row as "lẩu bò") collapses
      // distinct dishes and makes recommendation explanations inaccurate.
      const dishDisplay = dishNameFromWebsiteLabel(image.alt);
      if (!isPlausibleWebsiteMenuLabel(dishDisplay, restaurant.name, image.source === 'product-card' ? 'product-card' : undefined)) continue;
      const normalizedDish = normalize(dishDisplay);
      if (seenDishNames.has(normalizedDish)) continue;
      seenDishNames.add(normalizedDish);
      eligible += 1;
      if (options.dryRun) {
        console.log(JSON.stringify({ event: 'website_menu_candidate', restaurant: restaurant.name, restaurantId: restaurant.id, dish: dishDisplay, source: image.source, pageUrl: image.pageUrl, imageUrl: image.url }));
        continue;
      }
      const imageRow = await pool.query<{ id: string }>(
        `INSERT INTO restaurant_image (restaurant_id, url, alt_text, sort_order, is_cover, status, cache_status)
         VALUES ($1, $2, $3, 900, false, 'active', 'pending')
         ON CONFLICT (restaurant_id, COALESCE(restaurant_source_id, '00000000-0000-0000-0000-000000000000'::uuid), url)
         DO UPDATE SET alt_text = EXCLUDED.alt_text, status = 'active'
         RETURNING id`,
        [restaurant.id, image.url, `Website menu item: ${image.alt}`],
      );
      const imageId = imageRow.rows[0]?.id;
      if (!imageId) continue;
      images += 1;
      const rawText = `First-party menu page: ${image.pageUrl}\n${image.alt} - website menu catalog`;
      const extraction = await pool.query<{ id: string }>(
        `INSERT INTO menu_image_extraction (restaurant_image_id, status, model, confidence, raw_ocr_text, extracted_at, updated_at)
         VALUES ($1, 'completed', 'website:menu:v1', 0.95, $2, now(), now())
         ON CONFLICT (restaurant_image_id) DO UPDATE SET status='completed', model='website:menu:v1', confidence=0.95, raw_ocr_text=$2, error_message=NULL, extracted_at=now(), updated_at=now()
         WHERE menu_image_extraction.model NOT IN ('website:menu-image-curated:v1', 'google_maps:menu-curated:v1')
         RETURNING id`,
        [imageId, rawText],
      );
      if (!extraction.rows.length) continue;
      const existing = await pool.query<{ id: string }>(
        `SELECT id FROM dish WHERE restaurant_id=$1 AND normalized_name=$2 ORDER BY id LIMIT 1`,
        [restaurant.id, normalizedDish],
      );
      let dishId = existing.rows[0]?.id;
      if (dishId) {
        await pool.query(
          `UPDATE dish SET status='available', source=CASE WHEN source='menu_image:curated' THEN source ELSE 'website:menu:v1' END, confidence=GREATEST(COALESCE(confidence,0),0.95) WHERE id=$1`,
          [dishId],
        );
      } else {
        const inserted = await pool.query<{ id: string }>(
          `INSERT INTO dish (restaurant_id, name, normalized_name, status, source, confidence)
           VALUES ($1, $2, $3, 'available', 'website:menu:v1', 0.95) RETURNING id`,
          [restaurant.id, dishDisplay, normalizedDish],
        );
        dishId = inserted.rows[0]?.id;
      }
      if (!dishId) continue;
      await pool.query(
        `INSERT INTO dish_evidence (dish_id, restaurant_image_id, evidence_type, raw_name, confidence)
         VALUES ($1, $2, 'menu_image', $3, 0.95)
         ON CONFLICT (dish_id, restaurant_image_id, evidence_type) DO UPDATE SET raw_name=EXCLUDED.raw_name, confidence=EXCLUDED.confidence, verified_at=now()`,
        [dishId, imageId, image.alt],
      );
      dishesApplied += 1;
      restaurantDishesApplied += 1;
    }
    if (restaurantDishesApplied > 0) {
      // Website catalog evidence changes the restaurant's exact food profile
      // just like a clean OCR menu. Invalidate the cached profile so the next
      // recommendation/profile enrichment run cannot keep stale text.
      await pool.query(
        `UPDATE restaurant SET semantic_profile = NULL, updated_at = now() WHERE id = $1`,
        [restaurant.id],
      );
    }
    console.error(JSON.stringify({ event: 'website_menu_restaurant', restaurant: restaurant.name, pages: cachedSite.pages, candidates: candidates.size, cacheHit }));
  }
  console.log(JSON.stringify({ event: 'website_menu_complete', restaurants: restaurants.rowCount, uniqueSites: siteCache.size, pages, matched, eligible, reviewCandidates, images, dishesApplied, dryRun: options.dryRun, allSites: options.allSites, uncoveredOnly: options.uncoveredOnly, autoStructuredOnly: options.autoStructuredOnly, reviewAll: options.reviewAll, pageUrls: options.pageUrls, offset: options.offset, dishes: options.dishes, exactDishes: options.exactDishes }, null, 2));
  await pool.end();
}

function targetTermsForSql(dishes: string[]): string[] {
  return dishes.filter((dish) => dish.trim().length >= 2);
}

// Keep the page parser importable by unit tests without starting a database
// ingestion run as a module side effect.
if (process.argv.some((argument) => /ingest-website-menu(?:\.ts|\.js)?$/.test(argument))) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

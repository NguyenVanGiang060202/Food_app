import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlausibleWebsiteMenuLabel } from '../src/enrichment/website-menu-label';
import { addSiteCandidate, dishNameFromWebsiteLabel, extractPage, isExplicitlyReviewedCategoryPage, isTrustedBulkMenuCandidate, matchesExactDishLabel, matchesTargetDish, parseArgs, validateOptions, websiteIdentityMatchesRestaurant } from '../src/cli/ingest-website-menu';

test('review-all is an explicit scoped preview mode', () => {
  const options = parseArgs(['--all-sites', '--dry-run', '--restaurant-id', 'reviewed-id', '--page-url', 'https://example.test/menu', '--review-all']);
  assert.equal(options.reviewAll, true);
  assert.equal(options.dryRun, true);
  assert.deepEqual(options.restaurantIds, ['reviewed-id']);
  assert.deepEqual(options.pageUrls, ['https://example.test/menu']);
  assert.doesNotThrow(() => validateOptions(options));
  assert.throws(() => validateOptions(parseArgs(['--all-sites', '--review-all', '--restaurant-id', 'reviewed-id'])));
  assert.throws(() => validateOptions(parseArgs(['--all-sites', '--dry-run', '--review-all'])));
  assert.throws(() => validateOptions(parseArgs(['--all-sites', '--dry-run', '--review-all', '--restaurant-id', 'reviewed-id', '--auto-structured-only'])));
  assert.throws(() => validateOptions(parseArgs(['--all-sites', '--dry-run', '--page-url', 'https://example.test/menu'])));
  assert.throws(() => validateOptions(parseArgs(['--all-sites', '--exact-dish', 'Phở Gà'])));
});

test('approved dish labels match exactly, not by substring', () => {
  assert.equal(matchesExactDishLabel('PHỞ GÀ', ['Phở Gà']), true);
  assert.equal(matchesExactDishLabel('Phở Gà Đặc Biệt', ['Phở Gà']), false);
  assert.equal(matchesExactDishLabel('Mì Xào Hải Sản', ['Mì Xào Hải Sản']), true);
});

test('pairs an empty-alt photo with a priced dish only inside its own menu row', () => {
  const html = `<div class="row align-middle align-center"><img src="/com-suon.jpg" alt=""><p><strong>Cơm tấm sườn</strong></p><p><strong>180.000 ₫</strong></p></div>
    <div class="row align-middle align-center"><img src="/other.jpg" alt=""><p><strong>Trang trí sự kiện</strong></p></div>`;
  const result = extractPage(html, 'https://example.test/menu-quan/');
  assert.deepEqual(result.images.map(({ alt, source }) => ({ alt, source })), [
    { alt: 'Cơm tấm sườn', source: 'product-card' },
  ]);
});

test('reads a lazy menu photo instead of its data placeholder', () => {
  const page = extractPage('<img src="data:image/png;base64,AAAA" data-isrc="/dish.jpg" alt="Lẩu Kimchi 1 Người">', 'https://example.test/thuc-don/');
  assert.deepEqual(page.images.map(({ url, alt }) => ({ url, alt })), [
    { url: 'https://example.test/dish.jpg', alt: 'Lẩu Kimchi 1 Người' },
  ]);
});

test('accepts a concrete first-party menu item', () => {
  assert.equal(isPlausibleWebsiteMenuLabel('Bún Riêu Giò Heo', 'Bún Riêu GỐC - Nguyễn Cảnh Chân'), true);
});

test('rejects the restaurant name copied into an image alt', () => {
  assert.equal(isPlausibleWebsiteMenuLabel('Gà Nướng A Dậu', 'Gà Nướng A Dậu'), false);
  assert.equal(isPlausibleWebsiteMenuLabel('Cơm Tấm Nguyễn Văn Cừ', 'Cơm tấm Nguyễn Văn Cừ'), false);
});

test('rejects SEO and promotional labels', () => {
  for (const label of ['Vegan', 'Vegetarian', 'Organic', 'Mild', 'Gluten free', 'TikTok', 'Google Dịch', 'Tiếng Việt', 'English', 'social', 'Việt Nam', 'TAMI CHAY 14.04-01-01.jpg']) {
    assert.equal(isPlausibleWebsiteMenuLabel(label, 'Tami Coffee & Chay'), false, label);
  }
  assert.equal(
    isPlausibleWebsiteMenuLabel(
      'CƠM TẤM CALI – NƠI MANG ĐẾN NHỮNG BỮA ĂN NGON, ĐẦY DINH DƯỠNG',
      'Cơm tấm Cali - Nguyễn Chí Thanh',
    ),
    false,
  );
  assert.equal(isPlausibleWebsiteMenuLabel('MUA 1 ĐƯỢC 2 NGAY CÙNG CƠM TẤM CALI', 'Cơm tấm Cali'), false);
  assert.equal(isPlausibleWebsiteMenuLabel('Top 5 Quán Phở Bò Ngon Bình Thạnh', 'Phở Vũ Gia'), false);
  assert.equal(isPlausibleWebsiteMenuLabel('menu-de-nhat-ga-nuong', 'Đệ Nhất Gà Nướng'), false);
  assert.equal(isPlausibleWebsiteMenuLabel('com-tam-khac', 'Cơm tấm Cali'), false);
  assert.equal(isPlausibleWebsiteMenuLabel('Mặt tiền Cơm Tấm Cám', 'Cơm Tấm Cám'), false);
  assert.equal(isPlausibleWebsiteMenuLabel('MÓN CHAY', 'Cơm Tấm Cali'), false);
});

test('keeps concrete combo offerings', () => {
  assert.equal(isPlausibleWebsiteMenuLabel('Combo Gà Nướng + Lẩu Gà', 'Đệ Nhất Gà Nướng'), true);
});

test('rejects a shared website whose brand does not match the restaurant', () => {
  assert.equal(
    websiteIdentityMatchesRestaurant(['Nhà hàng chay Mộc Nhiên', 'Mộc Nhiên'], 'Lẩu bò Đức Hiến', 6),
    false,
  );
});

test('rejects a mismatched first-party website even for a single restaurant URL', () => {
  assert.equal(websiteIdentityMatchesRestaurant(['Bún Bò O Thiện'], 'Bún Bò Huế Cô Sam', 1), false);
  assert.equal(websiteIdentityMatchesRestaurant(['Bún Bò O Thiện'], 'Bún Bò O Thiện', 1), true);
  assert.equal(websiteIdentityMatchesRestaurant(['Cơm Niêu Việt Nam'], 'Cơm Niêu Thiên Lý', 6), false);
  assert.equal(websiteIdentityMatchesRestaurant(['Nhà Hàng Cơm Niêu Việt Nam'], 'Nhà Hàng Cơm Niêu Việt Nam', 6), true);
  assert.equal(websiteIdentityMatchesRestaurant(['TRANG CHỦ BÒ NÉ 3 NGON'], 'Bò né 3 Ngon', 1), true);
});

test('rejects image filenames and social badges as menu dishes', () => {
  for (const label of ['Bánh-mì-nem-thịt-nướng-Bà-Huynh', 'z5715436118032_71d7f1276cf023fe5e983df24abfe9d4', 'TripAdvisor', 'youtube', 'hotline', '${name}', 'Thanh toán Bò Né 3 Ngon', 'BANHCUONTAYSON.VN', 'Payment', 'google_analytics', 'facebook_pixel']) {
    assert.equal(isPlausibleWebsiteMenuLabel(label, 'Bánh Mì Bà Huynh'), false, label);
  }
});

test('matches a short exact brand in a site title without accepting a different branch brand', () => {
  assert.equal(websiteIdentityMatchesRestaurant(["Pizza 4P's | Delivering Wow, Sharing Happiness"], "Pizza 4P's", 1), true);
  assert.equal(websiteIdentityMatchesRestaurant(["Pizza 4P's | Delivering Wow, Sharing Happiness"], "Pizza 4P's Bến Thành", 1), true);
  assert.equal(websiteIdentityMatchesRestaurant(["Pizza 4P's | Delivering Wow, Sharing Happiness"], 'Pizza 4 Pizza Bến Thành', 1), false);
});

test('accepts a shared chain website for a matching branch', () => {
  assert.equal(
    websiteIdentityMatchesRestaurant(['Gà Nướng & Lẩu Gà Đệ Nhất'], 'Gà Nướng Đệ Nhất - 251G Hậu Giang', 3),
    true,
  );
});

test('extracts JSON-LD product names as menu candidates', () => {
  const html = `
    <title>Quán Phở Bò</title>
    <script type="application/ld+json">
      {"@type":"Product","name":"Phở tái nạm","image":"/images/pho-tai-nam.jpg"}
    </script>`;
  const page = extractPage(html, 'https://example.test/menu');
  assert.equal(page.images.some((image) => image.alt === 'Phở tái nạm'), true);
  assert.equal(page.images.some((image) => image.url === 'https://example.test/images/pho-tai-nam.jpg'), true);
  assert.equal(page.images.some((image) => image.source === 'jsonld-product' && isTrustedBulkMenuCandidate(image)), true);
});

test('bulk import does not treat homepage food photos as menu items', () => {
  const page = extractPage('<title>Phở Vũ Gia</title><img src="/photo.jpg" alt="Phở bò tái">', 'https://example.test/');
  assert.equal(page.images.length, 1);
  assert.equal(isTrustedBulkMenuCandidate(page.images[0]), false);
});

test('bulk import accepts menu-page labels but rejects off-menu product schema', () => {
  const menu = extractPage('<img src="/pho.jpg" alt="Phở bò tái">', 'https://example.test/thuc-don');
  assert.equal(isTrustedBulkMenuCandidate(menu.images[0]), true);
  const article = extractPage('<script type="application/ld+json">{"@type":"Product","name":"Phở bò tái","image":"/pho.jpg"}</script>', 'https://example.test/tin-tuc');
  assert.equal(isTrustedBulkMenuCandidate(article.images[0]), false);
  const blog = extractPage('<img src="/banh-mi.jpg" alt="Bánh mì thịt nướng">', 'https://example.test/https-food-culture-ban-mi.html');
  assert.equal(isTrustedBulkMenuCandidate(blog.images[0]), false);
});

test('a non-menu category page requires an explicit restaurant, page and exact review', () => {
  const page = extractPage('<img src="/mi.jpg" alt="Mì xào nấm">', 'https://example.test/mi-hu-tieu');
  const image = page.images[0];
  const selected = new Set(['https://example.test/mi-hu-tieu']);
  assert.equal(isTrustedBulkMenuCandidate(image), false);
  assert.equal(isExplicitlyReviewedCategoryPage(image, selected, true, true, []), true);
  assert.equal(isExplicitlyReviewedCategoryPage(image, selected, true, false, ['Mì xào nấm']), true);
  assert.equal(isExplicitlyReviewedCategoryPage(image, selected, true, false, []), false);
  assert.equal(isExplicitlyReviewedCategoryPage(image, selected, false, true, []), false);
  assert.equal(isExplicitlyReviewedCategoryPage(image, new Set(['https://other.test/mi-hu-tieu']), true, true, []), false);
  const homepage = extractPage('<img src="/mi.jpg" alt="Mì xào nấm">', 'https://example.test/').images[0];
  assert.equal(isExplicitlyReviewedCategoryPage(homepage, new Set(['https://example.test']), true, true, []), false);
});

test('structured menu item takes precedence over a generic image alt', () => {
  const page = extractPage('<script type="application/ld+json">{"@type":"MenuItem","name":"Bún bò Huế","image":"/item.jpg"}</script><img src="/item.jpg" alt="Ảnh món ăn">', 'https://example.test/');
  assert.equal(page.images.length, 1);
  assert.equal(page.images[0].alt, 'Bún bò Huế');
  assert.equal(isTrustedBulkMenuCandidate(page.images[0]), true);
});

test('pairs a catalog product card title with its photo when alt is empty', () => {
  const html = '<figure class="mark_img"><a href="/san-pham/bun-dau"><img src="/bun-dau.jpg" alt=""></a></figure><div class="meta_product"><span class="title_red">Bún đậu Homemade đặc biệt</span></div>';
  const page = extractPage(html, 'https://example.test/menu/');
  assert.equal(page.images.length, 1);
  assert.deepEqual(page.images[0], { url: 'https://example.test/bun-dau.jpg', alt: 'Bún đậu Homemade đặc biệt', source: 'product-card', pageUrl: 'https://example.test/menu/' });
  assert.equal(isTrustedBulkMenuCandidate(page.images[0]), true);
});

test('does not pair a card photo with the title in a different card', () => {
  const html = '<figure class="mark_img"><img src="/unlabeled.jpg" alt=""></figure><figure class="mark_img"><img src="/named.jpg" alt=""></figure><span class="title_red">Bún đậu Homemade</span>';
  const page = extractPage(html, 'https://example.test/menu/');
  assert.deepEqual(page.images.map((candidate) => candidate.url), ['https://example.test/named.jpg']);
});

test('pairs a Blogger menu card photo with its visible item name', () => {
  const html = '<a href="/p/bm-thit-nuong.html"><div><p class="img image-wrapper"><img src="/bread.jpg" /></p><p class="gia">39,000&#8363;</p><p class="name">BÁNH MÌ THỊT NƯỚNG<br /><span class="hideT">.</span></p></div></a>';
  const page = extractPage(html, 'https://example.test/p/thuc-don.html');
  assert.deepEqual(page.images, [{ url: 'https://example.test/bread.jpg', alt: 'BÁNH MÌ THỊT NƯỚNG', source: 'product-card', pageUrl: 'https://example.test/p/thuc-don.html' }]);
  assert.equal(isTrustedBulkMenuCandidate(page.images[0]), true);
});

test('does not pair a Blogger card photo with a following card name', () => {
  const html = '<a href="/one"><div><p class="img"><img src="/one.jpg"></p></div></a><a href="/two"><div><p class="img"><img src="/two.jpg"></p><p class="name">Bánh mì thịt nướng</p></div></a>';
  const page = extractPage(html, 'https://example.test/p/thuc-don.html');
  assert.deepEqual(page.images.map((candidate) => candidate.url), ['https://example.test/two.jpg']);
});

test('pairs each empty-alt sanpham menu photo only with its own visible name', () => {
  const html = '<a class="sanpham__item" href="/dish-one.html"><div><img src="/one.jpg" alt=""></div><h3>Vịt tiềm tôm pha lê</h3></a><a class="sanpham__item" href="/dish-two.html"><div><img src="/two.jpg" alt=""></div></a><h3>Unrelated title</h3>';
  const page = extractPage(html, 'https://example.test/menu.html');
  assert.deepEqual(page.images, [
    { url: 'https://example.test/one.jpg', alt: 'Vịt tiềm tôm pha lê', source: 'product-card', pageUrl: 'https://example.test/menu.html' },
  ]);
  assert.equal(isTrustedBulkMenuCandidate(page.images[0]), true);
});

test('priced Flatsome menu slides pair only their own photo and dish title', () => {
  const html = '<div class="col colg_menu item-menu-slide"><div class="box-image"><img src="/mushroom.jpg" alt=""></div><div class="text dish_title"><p>Truffled Mushroom (s)<br /></p></div><div class="text currency"><p>240</p></div></div><div class="col colg_menu item-menu-slide"><img src="/unpriced.jpg" alt=""><div class="text dish_title"><p>Not on menu</p></div></div><div class="col colg_menu item-menu-slide"><img src="/pizza.jpg" alt=""><div class="text currency"><p>250</p></div></div>';
  const page = extractPage(html, 'https://example.test/en-menu/');
  assert.deepEqual(page.images, [
    { url: 'https://example.test/mushroom.jpg', alt: 'Truffled Mushroom (s)', source: 'product-card', pageUrl: 'https://example.test/en-menu/' },
  ]);
});

test('Webflow priced menu cards pair each photo with its own visible dish', () => {
  const html = '<div class="ratio-card"><div class="paralax-image-wrapper"><img src="/no-price.jpg" alt=""></div><div class="paralax-card-inner"><div class="best-seller-slider-text-wrapper"><div class="paralax-header">Unpriced decoration</div></div></div></div>'
    + '<div class="ratio-card"><div class="paralax-image-wrapper"><img src="/hu-tieu.jpg" alt=""></div><div class="paralax-card-inner"><div class="best-seller-slider-text-wrapper"><div class="paralax-header">Hủ Tiếu Xào Bê Vàng</div><div class="overline">250.000vnd</div></div></div></div>'
    + '<div class="ratio-card"><div class="paralax-image-wrapper"><img src="/mi-xao.jpg" alt=""></div><div class="paralax-card-inner"><div class="best-seller-slider-text-wrapper"><div class="paralax-header">Mì Xào Xì Dầu Hồng Kông</div><div class="overline">220.000vnd</div></div></div></div>';
  const page = extractPage(html, 'https://example.test/menu.html');
  assert.deepEqual(page.images, [
    { url: 'https://example.test/hu-tieu.jpg', alt: 'Hủ Tiếu Xào Bê Vàng', source: 'product-card', pageUrl: 'https://example.test/menu.html' },
    { url: 'https://example.test/mi-xao.jpg', alt: 'Mì Xào Xì Dầu Hồng Kông', source: 'product-card', pageUrl: 'https://example.test/menu.html' },
  ]);
});

test('the same image retains separate first-party menu and product-page provenance', () => {
  const candidates = new Map();
  const menu = { url: 'https://example.test/item.jpg', alt: 'Phở gà', source: 'image-alt' as const, pageUrl: 'https://example.test/menu' };
  const product = { ...menu, alt: 'Phở gà ngon ở Sài Gòn - Order Now', pageUrl: 'https://example.test/product/pho-ga' };
  addSiteCandidate(candidates, menu);
  addSiteCandidate(candidates, product);
  assert.equal(candidates.size, 2);
  assert.deepEqual([...candidates.values()], [menu, product]);
});

test('WooCommerce grid uses the linked product title instead of a stale image alt', () => {
  const html = '<div class="product-small col has-hover"><div class="box-image"><a href="/san-pham/pho-bo/" aria-label="Phở Bò 1 Món"><img src="/pho.jpg" alt="Phở bò tái mềm"></a></div><p class="name product-title woocommerce-loop-product__title"><a href="/san-pham/pho-bo/">Phở Bò 1 Món</a></p></div><div class="product-small col has-hover"><div class="box-image"><a href="/san-pham/com-ga/"><img src="/com.jpg" alt="Old alt"></a></div><p class="name product-title"><a href="/san-pham/com-ga/">Cơm Gà Luộc</a></p></div>';
  const page = extractPage(html, 'https://example.test/menu');
  assert.deepEqual(page.images, [
    { url: 'https://example.test/pho.jpg', alt: 'Phở Bò 1 Món', source: 'product-card', pageUrl: 'https://example.test/menu' },
    { url: 'https://example.test/com.jpg', alt: 'Cơm Gà Luộc', source: 'product-card', pageUrl: 'https://example.test/menu' },
  ]);
});

test('WooCommerce lazy product image uses data-src rather than its SVG placeholder', () => {
  const html = '<div class="product-small col has-hover"><a href="/banh-mi-dac-biet/"><img src="data:image/svg+xml;base64,AAAA" data-src="/banh-mi-dac-biet.jpg" alt="bánh mì ngon Sài Gòn"></a><p class="name product-title woocommerce-loop-product__title"><a href="/banh-mi-dac-biet/">Bánh Mì Đặc Biệt (Size lớn)</a></p></div>';
  assert.deepEqual(extractPage(html, 'https://example.test/banh-mi-ba-huynh/').images, [
    { url: 'https://example.test/banh-mi-dac-biet.jpg', alt: 'Bánh Mì Đặc Biệt (Size lớn)', source: 'product-card', pageUrl: 'https://example.test/banh-mi-ba-huynh/' },
  ]);
});

test('HTML-escaped query separators are decoded in first-party product image URLs', () => {
  const html = '<img src="https://i0.wp.com/example.test/cake.jpg?resize=300%2C300&amp;ssl=1" alt="Bánh kem mousse trà xanh">';
  assert.deepEqual(extractPage(html, 'https://example.test/menu').images, [
    { url: 'https://i0.wp.com/example.test/cake.jpg?resize=300%2C300&ssl=1', alt: 'Bánh kem mousse trà xanh', source: 'image-alt', pageUrl: 'https://example.test/menu' },
  ]);
});

test('reviewed product titles may carry size labels without admitting long image-alt SEO copy', () => {
  const label = 'Bánh Mì Bà Huynh Đặc Biệt (Size lớn – Extra Meat)';
  assert.equal(isPlausibleWebsiteMenuLabel(label, 'Bánh Mì Bà Huynh (Madam Win)'), false);
  assert.equal(isPlausibleWebsiteMenuLabel(label, 'Bánh Mì Bà Huynh (Madam Win)', 'product-card'), true);
});

test('WooCommerce grid does not pair an image with a title linking to another product', () => {
  const html = '<div class="product-small col"><a href="/one"><img src="/one.jpg" alt=""></a><p class="product-title"><a href="/two">Phở Bò</a></p></div>';
  assert.deepEqual(extractPage(html, 'https://example.test/menu').images, []);
});

test('The7 catalog pairs a lazy photo and priced title within one product cell', () => {
  const html = '<div class="wf-cell iso-item visible"><article class="product"><a href="/mua/cha-ca-1"><img src="data:image/svg+xml;charset=utf-8,placeholder" data-src="/cha-ca.jpg" alt=""></a><h4 class="entry-title"><a href="/mua/cha-ca-1">Chả cá Đế Vương 1</a></h4><span class="price">160.000 &#8363;</span></article></div><div class="wf-cell iso-item visible"><article class="product"><a href="/mua/other"><img data-src="/other.jpg" alt=""></a><h4 class="entry-title"><a href="/mua/not-other">Không phải món</a></h4><span class="price">100.000 &#8363;</span></article></div>';
  assert.deepEqual(extractPage(html, 'https://example.test/product-category/mon-an-nha-hang').images, [
    { url: 'https://example.test/cha-ca.jpg', alt: 'Chả cá Đế Vương 1', source: 'product-card', pageUrl: 'https://example.test/product-category/mon-an-nha-hang' },
  ]);
});

test('a first-party menu price suffix is not part of the dish name', () => {
  assert.equal(dishNameFromWebsiteLabel('GỎI BÒ WASABI (159,000Đ)'), 'GỎI BÒ WASABI');
  assert.equal(dishNameFromWebsiteLabel('CÁ BÒ DA NƯỚNG MUỐI ỚT (289,000Đ/KG)'), 'CÁ BÒ DA NƯỚNG MUỐI ỚT');
  assert.equal(dishNameFromWebsiteLabel('CUA RANG ME (THEO THỜI GIÁ)'), 'CUA RANG ME');
  assert.equal(dishNameFromWebsiteLabel('Bún bò (đặc biệt)'), 'Bún bò (đặc biệt)');
  assert.equal(dishNameFromWebsiteLabel('Pizza Margherita Chay Cà Chua Quế Tây | Pazzi.vn'), 'Pizza Margherita Chay Cà Chua Quế Tây');
  assert.equal(dishNameFromWebsiteLabel('Phở Gà Trống Thiến Thập Cẩm - Phở Nhon'), 'Phở Gà Trống Thiến Thập Cẩm');
});

test('target dishes match whole normalized words, not English fragments', () => {
  assert.equal(matchesTargetDish('Chè thốt nốt', ['chè']), true);
  assert.equal(matchesTargetDish('Kem Cheese', ['chè']), false);
  assert.equal(matchesTargetDish('Bánh mì thịt nướng', ['bánh mì thịt']), true);
  assert.equal(matchesTargetDish('Minh Anh', ['mì']), false);
});

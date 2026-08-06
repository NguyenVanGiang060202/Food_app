export const SELECTORS = {
  searchBox: 'input[name="q"]',
  searchBoxAlt: 'input#searchboxinput',
  searchBoxAny: 'input[aria-label*="Search"], input[aria-label*="Tìm"], input[role="combobox"]',
  searchButton: 'button#searchbox-searchbutton',
  searchButtonAny: 'button[aria-label*="Search"], button[aria-label*="Tìm"]',
  resultList: 'div[role="feed"]',
  resultItemContainer: 'a[href*="/maps/place/"]',

  nameListItem: '.fontHeadlineSmall',
  nameListItemFallback: '.qBF1Pd, .fontBodyMedium > div:first-child',
  nameInDetail: 'h1',

  ratingListItem: '.fontBodyMedium > span[aria-hidden="true"]',
  ratingFallback: 'span[aria-hidden="true"]',

  reviewCountItem:
    '.UY7F9, span[aria-label*="review" i], span[aria-label*="đánh giá" i], button[aria-label*="review" i], button[aria-label*="đánh giá" i]',
  reviewCountFallback: '[aria-label*="review" i], [aria-label*="đánh giá" i], [data-review-count]',
  reviewCountButton:
    'button[aria-label*="review" i], button[aria-label*="đánh giá" i], span[aria-label*="review" i], span[aria-label*="đánh giá" i]',
  reviewCountInDetail:
    'button[aria-label*="review" i], button[aria-label*="đánh giá" i], [role*="review" i], [data-review-count]',

  addressLine: '.fontBodyMedium',
  addressFallback: 'div[aria-label*="address"]',

  categoryTag: 'button[jsaction*="category"]',

  scrollPanel: 'div[role="feed"]',
  noResults: 'div[aria-label*="No results"]',

  detailPanel: 'div[role="main"]',
  detailReviewCount: 'button[aria-label*="đánh giá"]',
  detailReviewCountAlt: 'span[aria-label*="đánh giá"]',
  detailAddress: 'button[data-item-id*="address"]',
  detailPhone:
    'button[data-item-id*="phone"], a[href^="tel:"], [aria-label*="phone" i], [aria-label*="điện thoại" i]',
  detailWebsite: 'a[data-item-id*="authority"], a[data-item-id*="website"], a[href^="http"]',
  detailImages: 'img[src^="http"]',
  detailClose: 'button[aria-label="Close"], button[aria-label="Đóng"]',
  detailReviewsButton: [
    'button[jsaction*="pane.rating.moreReviews"]',
    'button[aria-label*="reviews"]',
    'button[aria-label*="Review"]',
    'button[aria-label*="đánh giá"]',
  ].join(', '),
  reviewContainer: 'div[data-review-id], div.jftiEf',
} as const;

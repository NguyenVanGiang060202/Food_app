# Food Discovery Platform - Data Display & Price Policy

## 1. Purpose

This document defines how data from the crawler/pipeline may be displayed in the
frontend. It exists so every AI agent and developer applies the same rules when
showing restaurant or dish information, and so we do not silently re-introduce
filtering or fields that were deliberately removed.

It is the frontend-facing counterpart of the Data Quality Policy in `README.md`
(sections on NULL handling and source attribution). When in doubt, the README
policy wins; this document resolves how to translate it into UI behavior.

---

## 2. Core Principle

> A NULL value means "we did not observe this data", NOT "this does not exist".

The crawler only records what it directly observed on the source page. We never
guess, infer, or fabricate a value to make the UI look complete.

Therefore the UI must:

- **Hide** a field when the underlying value is NULL.
- **Show** a field only when the value is a real, observed value.
- **Never** display placeholders such as "Chưa rõ giá", "Giờ mở cửa chưa rõ",
  "Không có", or a stock/invented value in place of missing data.
- **Never** derive a value from something unrelated (e.g. deriving price from a
  photo, or review_count from review text).

---

## 3. Field-by-Field Display Rules

| Field                       | Rule                                                                                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                      | Always show.                                                                                                                                                                           |
| `image` / `coverImageUrl`   | Show the observed image. If NULL, show the neutral `no-photo.svg` placeholder (this is a layout placeholder for an absent media, allowed). Do NOT substitute an unrelated/stock photo. |
| `rating`                    | Show only when `rating != null && rating > 0`. Otherwise omit.                                                                                                                         |
| `reviewCount`               | Show only when `reviewCount != null && reviewCount > 0`. Never estimate it from review text.                                                                                           |
| `formattedAddress` / `area` | Show when present.                                                                                                                                                                     |
| `openingHours`              | Show only when actually observed. Omit (do not render "Giờ mở cửa chưa rõ") when NULL.                                                                                                 |
| `phone`, `websiteUrl`       | Show only when present.                                                                                                                                                                |
| `priceLevel` / price        | See Section 4. Currently NOT shown at all.                                                                                                                                             |
| `sourceUrl`                 | Always expose a link to the source page so the user can verify.                                                                                                                        |
| `latitude` / `longitude`    | Show map pin only when both present.                                                                                                                                                   |

### Notes

- `dish.priceAmount` may be a real observed value when the source exposes a dish
  price. If it is NULL/0, do not render "Chưa rõ giá"; omit the price.
- Do not create fake restaurant entries or fake dish entries to fill layout.

---

## 4. Price Filter — DELIBERATELY REMOVED

### 4.1 Decision

The price filter was **removed from the frontend** (Search, Map, Ask, and
Profile preference "Mức giá quen thuộc"). This is a deliberate, documented
decision — do not re-add it without revisiting this section.

### 4.2 Why

1. The crawler does not observe the `$`/`$$` price symbol from Google Maps, so
   `price_level` is NULL for ~900 of 903 restaurants (only 3 have values, all in
   the 2–3 range). A filter backed by ~0 data is misleading.
2. Importing price from third-party websites was rejected: there is no
   consistent Vietnamese source, and it violates the Data Quality Policy, which
   requires every displayed value to carry source attribution and confidence.
3. Showing "Chưa rõ giá" / a price dropdown with no real data violates the
   core principle in Section 2.

### 4.3 Current state

- Frontend sends **no** `priceLevel` parameter anymore
  (`frontend/src/lib/api.ts`: `RestaurantListOptions`, `SearchOptions`,
  `listDishes`, `RecommendationFilters` no longer include it).
- `frontend/src/lib/taste-filters.ts`: `priceOptions` export was deleted.
- `frontend/src/App.tsx`: no price URL param, no price `<select>` in Search,
  no "Mức giá quen thuộc" block in Profile.
- `frontend/src/pages/MapPage.tsx` and `frontend/src/pages/AskPage.tsx`: no
  price quick filter / chip / slider.
- `frontend/src/components/site/cards.tsx`: restaurant price renders only when
  `r.price != null`; no "Chưa rõ giá" placeholder.
- **Backend is intentionally unchanged**: `restaurants.price_level` column,
  the `priceLevel` query parameter, and `preferredPriceLevels` in user
  preferences still exist. They are harmless and may be re-used later. The
  frontend simply stops exposing them.

### 4.4 When price may be shown again

Only when at least one of these is true:

- The crawler successfully captures Google Maps `$`/`$$` price symbols for a
  meaningful share of restaurants (then show the symbol as observed), OR
- An enrichment pipeline provides `price_level` with explicit `confidence` and
  `provenance` (source URL), following the Data Quality Policy.

Until then, keep price hidden. Update this document when that happens.

---

## 5. Consistency Checklist (for AI agents)

Before finishing a frontend task, verify:

- [ ] No `priceLevel` / `maxPrice` / `priceOptions` references remain in
      `frontend/src`.
- [ ] No NULL field renders a fake placeholder ("Chưa rõ giá", "Giờ mở cửa
      chưa rõ", stock images, invented ratings/review counts).
- [ ] `no-photo.svg` is used only for missing media, not for missing data.
- [ ] Every restaurant card/detail links back to `sourceUrl`.
- [ ] `npm run check` (typecheck) passes in `frontend/`.

---

## 6. Open items (not yet fixed)

These were flagged during the same review but are outside the price removal and
should be addressed in a follow-up to fully match this policy:

- `frontend/src/pages/MapPage.tsx` / detail views: verify no other NULL field
  renders a textual placeholder.
- `frontend/src/components/site/cards.tsx` `RestaurantCard` renders
  `r.hours ?? "Giờ mở cửa chưa rõ"` — this placeholder violates Section 2 and
  should be changed to render nothing when hours are NULL.
- `frontend/src/lib/api.ts` `toDish`/`detailToRestaurant` fall back to
  `no-photo.svg` (allowed) but review all image fallbacks for stock substitutes.

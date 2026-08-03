# Food Discovery App — Design Strategy

> Product direction: help people decide what to eat and discover places worth visiting. This is a discovery product, not a delivery checkout product.

## 1. Product understanding

The core job is not “find the cheapest delivery”. It is **reduce decision fatigue around eating**:

1. Start from an intention: a craving, mood, occasion, location, or budget.
2. Turn vague intent into a small number of understandable taste and context filters.
3. Show a confident shortlist with enough evidence to choose: photo, rating, distance, price, popular dishes, and map position.
4. Keep exploration available for users who do not have a specific query.

The product should feel like a local food guide with a recommendation layer: visual, calm, contextual, and useful even when the user is only browsing.

## 2. Personas

### The Decider (primary)

Has 5–10 minutes and says “ăn gì bây giờ?”. Needs a fast shortlist, not a database. Usually chooses by taste + distance + budget.

### The Explorer

Wants inspiration for a weekend, date, or new neighborhood. Enjoys collections, trending places, hidden gems, and visual browsing.

### The Verifier

Already has a likely restaurant and wants confidence before visiting. Cares about photos, current opening status, rating quality, address, dishes, and map context.

## 3. User journeys

### Journey A — I know my taste

`Discover → Search intent → Taste chips → Dish type → Budget / distance → Results → List + map → Restaurant detail → Save`

Example state: `Mặn · Bún · Cay · Dưới 100k · Trong 5km`.

### Journey B — Explore

`Discover → Context rail → Collection / theme → Visual restaurant list → Map preview → Detail → Save or refine`

Useful contexts: `Gần bạn`, `Đang được yêu thích`, `Mới mở`, `Ăn khuya`, `Quán bình dân`, `Cho ngày mưa`.

### Journey C — Verify

`Search / saved place → Detail → Photos + popular dishes + hours + map → Decide to visit`

## 4. Information architecture

### Primary navigation

1. **Discover** — personalized and contextual inspiration.
2. **Search** — intentional query and structured filters.
3. **Map** — spatial browsing and nearby places.
4. **Saved** — personal shortlist and collections.
5. **Profile** — taste preferences, location, and history.

The current MVP can expose Discover and AI Search first, while preserving route boundaries for Map, Saved, and Profile.

### Content hierarchy

`Intent / context → filters → recommendation rationale → restaurant evidence → map → details`.

Do not make price promotions, delivery time, or checkout the dominant hierarchy.

## 5. Main screens

### Discover home

- Location context and a friendly “what are you in the mood for?” prompt.
- Large search input with quick intent chips.
- Horizontal exploration rails, each with one clear reason to open it.
- A restrained “near you” restaurant grid or map preview.

### Search / recommendation

- Query field remains the primary action.
- Taste filters are grouped by meaning, not by backend field names.
- Use progressive disclosure: show the common filters first; put advanced controls behind “Thêm bộ lọc”.
- Results explain why each place appeared.

### Map

- List/map split on desktop; bottom sheet list over map on mobile.
- Selecting a card highlights its marker and vice versa.
- Preserve active chips while moving around the map.

### Restaurant detail

- Hero photo, name, category, rating, price, and distance.
- Popular dishes and price examples.
- Verified location, opening hours, phone/website, and map.
- Save is a primary discovery action; no delivery checkout CTA.

### Saved / profile (next phase)

- Saved restaurants and user-created collections.
- Taste onboarding: spicy tolerance, favorite dish families, budget, and usual radius.

## 6. UX patterns extracted from reference products

| Reference | Useful pattern | Adaptation for this product |
| --- | --- | --- |
| Google Maps Explore | Contextual nearby discovery + map/list relationship | “Gần bạn”, distance chips, map as evidence rather than decoration |
| Yelp | Review/rating evidence and structured business cards | Show rating, review count, price and category at scan speed |
| Foursquare | Place taxonomy and neighborhood exploration | Use dish families, areas, and editorial collections |
| Beli | Personal taste and save-oriented behavior | Make saving and collections part of the loop |
| Spotify / Netflix | Personalized rails and “why this is for you” | Explain recommendations and vary rails by context |
| Pinterest / TikTok Explore | Visual, low-commitment browsing | Photos and collections before dense metadata |
| Airbnb / Tripadvisor | Browse by theme and occasion | “Hẹn hò”, “ăn khuya”, “mới mở”, “hidden gems” collections |
| Atlas Obscura | Curiosity and local stories | Add short editorial descriptions, not promotional banners |

These are principles and interaction models, not visual templates to copy.

## 7. Wireframe suggestions

### Desktop Discover

```text
┌────────────────────────────────────────────────────────────┐
│ logo       Discover   Search   Map   Saved        profile   │
├────────────────────────────────────────────────────────────┤
│ Gần bạn · TP.HCM                 Hôm nay ăn gì?            │
│ [ nói món / khẩu vị / ngân sách...                 ] [→]   │
│ [Mặn] [Bún] [Cay] [Dưới 100k] [Thêm bộ lọc]               │
│                                                            │
│ Khám phá theo tâm trạng       Xem tất cả                   │
│ [Gần bạn] [Trending] [Ăn khuya] [Hidden gems]              │
│                                                            │
│ Quán hợp với bạn                         [list] [map]      │
│ [restaurant card] [restaurant card]       ┌────────────┐   │
│ [restaurant card] [restaurant card]       │ map        │   │
└───────────────────────────────────────────┴────────────┴───┘
```

### Mobile

Use a sticky top search, horizontal chips, one-column cards, and a floating `Xem bản đồ` action. The map opens as a full-screen surface with a draggable result sheet.

## 8. Design system direction

- **Tone:** warm editorial guide, not transactional marketplace.
- **Surfaces:** warm off-white canvas, white cards, subtle borders, soft elevation.
- **Accent:** orange for action and active taste states; use green only for open/verified status.
- **Shape:** 10–16px card radii, pill chips only for filters/statuses.
- **Motion:** short 160–220ms transitions; avoid decorative motion that slows scanning.
- **Content density:** one primary decision per section, generous whitespace, short metadata rows.

### Suggested tokens

```text
canvas  #FCFAF7    surface  #FFFFFF    ink  #27211E
muted   #837C76    line     #EAE3DC    accent #F06C37
accent-soft #FFF1E8       success #4D9B67
```

Typography: `DM Sans` for UI and metadata, `Playfair Display` sparingly for editorial headings. Keep body copy at 13–16px and minimum touch targets at 44px on mobile.

## 9. Competitor/product analysis

- **Maps / Yelp:** excellent evidence and locality; risk is dense utility UI. Borrow scan-friendly metadata, not business listing overload.
- **Foursquare / Tripadvisor:** strong place and theme exploration; borrow taxonomy and collections.
- **Beli:** strong personal memory loop; prioritize Save and taste learning after the first successful recommendation.
- **Spotify / Netflix:** strong recommendation rails; borrow “because you like…” explanations and varied contexts, not endless scrolling.
- **Pinterest / TikTok:** strong visual inspiration; borrow image-led entry points while retaining restaurant evidence and map context.

## 10. Recommendation model UX

Every recommendation should answer at least one of:

- “Matches your taste because…”
- “Nearby and within your budget.”
- “Popular for this dish.”
- “A different option because you saved …”

The UI should expose the active inputs as removable chips. If there are no results, suggest relaxing one constraint at a time instead of showing a dead end.

## 11. Feature prioritization

### Now (MVP)

- Discover home with intent search.
- Taste, dish type, budget, area, open-now filters.
- Recommendation results with rationale.
- Restaurant cards and map context.
- Detail page with dishes, hours, and verified location.

### Next

- Dedicated Map tab with synchronized list and markers.
- Saved places and collections.
- Explore rails backed by trending/new/open-late queries.
- Location permission and radius selector.

### Later

- Taste onboarding and learned preferences.
- Weather/occasion-aware collections.
- Social follows and collaborative lists.
- Personal recommendation feedback (`Hợp gu`, `Không phải gu`).

## 12. Empty, loading, and error states

- Empty search: show examples and quick chips, not a blank form.
- No results: show “thử bỏ bớt 1 bộ lọc” with one-tap relaxation.
- Loading: skeleton cards and preserve the query/chips.
- Error: explain what failed and keep the user’s inputs intact.
- Missing image: use a calm branded fallback, never a broken-image icon.

## 13. Mobile-first recommendations

- Bottom navigation for Discover, Search, Map, Saved, Profile.
- Search and active filters remain reachable with one hand.
- Use horizontal rails with snap scrolling; do not squeeze five cards into a row.
- Cards expose only the first scan layer; details open on tap.
- Map is a mode switch, not a permanently competing panel on small screens.

## 14. Research sources

Product references: [Google Maps](https://maps.google.com/), [Yelp](https://www.yelp.com/), [Foursquare](https://foursquare.com/), [Beli](https://www.beliapp.com/), [Spotify](https://www.spotify.com/), [Pinterest](https://www.pinterest.com/), [Airbnb](https://www.airbnb.com/), [Tripadvisor](https://www.tripadvisor.com/), [Atlas Obscura](https://www.atlasobscura.com/).

Additional UX reading used for pattern triangulation: [Google Material search](https://m3.material.io/components/search/overview), [Material chips](https://m3.material.io/components/chips/overview), [Nielsen Norman Group — filtering](https://www.nngroup.com/articles/filtering/), and [Baymard — filters](https://baymard.com/labs/checkout-usability/benchmark/filters).

## Product decision

The home screen should not be “a chatbot with food results”. It should be a **Discover surface with a conversational search entry point**. Chat is the language input; taste chips, visual rails, cards, and map are the product experience around it.
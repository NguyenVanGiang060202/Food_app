# Fast, evidence-backed menu coverage

Coverage is limited by verified menu data, not by the number of search phrases. A restaurant name, food photo, or raw vision/OCR guess must not be promoted into an exact menu claim. The fast path is to review a **first-party menu source once**, then reuse its verified items across matching branches.

## Source-first priority queue

Measure newly covered **restaurants** as well as dishes. On 2026-10-27 the local database had 4,246 active restaurants, 130 with trusted menus before the OM Nướng import, and 1,056 uncovered restaurants carrying a non-social website URL. These URLs are leads, not verified first-party sites: several are attached to unrelated restaurants. Start with an official menu page that names its brand and branch addresses, then match each local restaurant's address and phone. Review the menu once and apply an explicit selection only to branches the source actually names. Record excluded branches and reasons.

Menu layouts can omit photo `alt` text while showing a dish name and price beside each photo. The website importer now reads priced Webflow `ratio-card` items within their own card boundary. Use `-RestaurantId`, `-PageUrl` and `-ReviewAll` to preview a source, then `-Apply` with exact reviewed names. It records the source page URL with each item. Never apply an entire preview automatically. The Bê Vàng menu page is an example: 25 candidates were found, 15 visible prepared dishes were explicitly approved for its matching Quận 5 branch. The remaining cards and market-price or unreviewed items were excluded.

For shared image menus, choose a page that explicitly states branch availability. The OM Nướng hotpot page names only the Hoàng Văn Thụ and Sư Vạn Hạnh branches; the SHA-pinned menu image was reviewed once and the named hotpot set was curated for exactly those two restaurants. The Gò Vấp local address did not match the official address, so it was excluded. `scripts/run-reviewed-official-image-menu.ps1` reads UTF-8 manifests to preserve Vietnamese dish names.

For the next source, rank by: (1) official menu page and direct branch proof, (2) number of uncovered matching branches, (3) number of concrete prepared dishes, (4) current source availability. Track candidates reviewed, branches matched, branches rejected, newly trusted restaurants, newly trusted dishes, and representative API queries. This source-first workflow avoids spending review time on Google Maps photos that are not menus.

## Local batch workflow

From the repository root, preview candidates without database writes:

```powershell
./scripts/run-bulk-website-menu.ps1 -Limit 25 -Offset 0
```

Continue with `-Offset 25`, `-Offset 50`, and so on. `-Limit` and `-Offset` count **distinct websites**, not restaurant branches. A run lists candidate dish, restaurant ID, source page, and image URL. Review the *source website and menu page*, not every restaurant image. The importer fetches each shared URL once per batch and loads up to eight pages per URL in bounded parallel waves.
Discovery defaults to websites with at least one restaurant that has no trusted menu dishes; use `-IncludeCovered` to find additional items for already covered restaurants. Keep the same filter settings across pages.

Apply only reviewed candidates, scoped to explicit restaurant IDs and dish names:

```powershell
./scripts/run-bulk-website-menu.ps1 -Apply -RestaurantId '<reviewed restaurant UUID>' -Dish 'Mì Xào Hải Sản'
```

Repeat `-RestaurantId` for verified branches and `-Dish` for the menu items approved from that source. In preview, `-Dish` is a keyword filter; with `-Apply`, it matches approved menu labels exactly after accent/case normalization, so approving “Phở Gà” cannot silently import “Phở Gà Đặc Biệt”. Run the same command again safely; existing dish names and evidence are reused. `-Apply` without restaurant IDs is refused.

To review every plausible label on one restaurant's first-party menu, rather than only the default dish keywords, use a scoped preview. `-PageUrl` confines both preview and apply to the page you inspected, so other site pages (for example event-decoration products) cannot be imported accidentally:

```powershell
./scripts/run-bulk-website-menu.ps1 -RestaurantId '<restaurant UUID>' -PageUrl 'https://example.com/menu' -ReviewAll
./scripts/run-bulk-website-menu.ps1 -Apply -RestaurantId '<restaurant UUID>' -PageUrl 'https://example.com/menu' -Dish @('Reviewed dish A', 'Reviewed dish B')
```

`-ReviewAll` is preview-only and requires a restaurant ID. Review the complete label list against the actual menu page and omit drinks, add-ons, decorations, raw inventory, SEO text, and unrelated branches before applying. Do not treat `-ReviewAll` output itself as approval.

The crawler also pairs a product card's visible name with its actual photo when the image `alt` is empty (common on WooCommerce-style menus). A nonstandard category path such as `/danh-muc-sp/bun-dau-mam-tom/` is eligible only when it is supplied as an exact `-PageUrl` with a restaurant-scoped review and exact approved dish names. Homepages and cross-host links do not gain that exception.

When a WooCommerce product-card photo has a stale `alt`, the crawler uses the visible product title only if the title link and photo link identify the **same** product in that card. The same photo may appear on a category page and a detail page; both page origins remain available so an explicit `-PageUrl` review cannot silently inherit a different page's label.

For a first-party PDF menu, save the original PDF, hash it, render every approved page, and visually review the page images. The Góc Huế example is `crawler/data/gochue-official-pdf-menu-2026-10-22.json` with `scripts/run-reviewed-official-pdf-menu.ps1` (dry-run by default; `-Apply` after review). It checks the PDF SHA-256 and rendered pages before importing only the listed dishes for the listed branches. This is an example of a reviewed manifest, not a generic auto-import of arbitrary PDFs. Keep the original PDF and page images until the provenance is audited.

For a broad, read-only candidate inventory, run `scripts/run-first-party-menu-discovery.ps1` with an explicit `-DeadlineIso` and a fresh `-LogDir`. Its `first-party-sites.csv` ranks websites for source review; `first-party-candidates.ndjson` is **not** an import approval list. Review the source's brand, branch addresses, menu category, and actual purchasable dishes before applying.

The bulk gate requires a matching first-party brand, a genuine menu/product URL or structured `MenuItem`, a concrete dish label, and an exact normalized phrase match. It rejects homepage food photos, generic menu headings, placeholder images, SEO/promotional labels, and partial-word matches such as `chè` inside `cheese`. OCR remains an untrusted candidate source until the image is confirmed to be an actual menu.

Check the *current redirect target* of every candidate website. A domain that now redirects to an unrelated site must be quarantined, even if the old restaurant URL remains in Google Maps data. Do not automatically replace it with a guessed new domain.

After applying a batch, rebuild changed restaurants' food profiles and refresh embeddings as needed; verify representative queries through `/api/v1/recommendations`. Local database changes do **not** deploy or sync automatically to production. For production, repeat ingestion against the intended database through its controlled deployment workflow, after reviewing its credentials and scope.

This improves exact-dish coverage with fewer source reviews. It cannot guarantee an answer for every possible question: geographic coverage, opening hours, budget, ingredient constraints, and recipe/pantry questions need their own verified data or a clearly labeled fallback; the system should say when evidence is insufficient rather than inventing a matching restaurant.

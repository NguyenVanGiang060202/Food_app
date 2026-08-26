# Menu Image OCR Plan

## Problem Statement

Crawler hiện tại thu thập **26,141 ảnh** từ 3,145 quán ăn, nhưng:
- **26,140 ảnh** là thumbnail từ search results list (sort_order 1-9) và detail panel (sort_order 0)
- **Chỉ 1 ảnh** có alt_text "Google Maps menu tab" — và ảnh đó là bowl of food, không phải menu
- **0 dishes** được extract từ OCR
- Tab "Menu/Thực đơn" gần như **không tồn tại** trên大多数 Google Maps place pages Việt Nam

## Review & Analysis

### Tại sao re-crawl không khả thi?

| Nguồn | Reality | Verdict |
|--------|---------|---------|
| Google Maps Menu Tab | Chỉ **1/3,145 quán** (0.004%) có tab này | ❌ Dead end |
| Review Photos | Code hiện tại không extract; cần thêm DOM scraping | ⚠️ Khó, tốn time |
| Website Crawling | 1,148 quán có website, nhưng đa số là Facebook/Zalo | ❌ Không crawl được |

**Kết luận:** Không cần re-crawl hay thêm nguồn mới. Hãy dùng **vision model trên tất cả 26K ảnh hiện có**.

### Tại sao OCR tất cả 26K ảnh là cách tốt nhất?

1. **Vision model tự phân biệt** `isMenu: true/false` — không cần tìm menu trước
2. **Ảnh general gallery** đôi khi chứa menu (menu trên bàn, menu trên tường, photo of menu)
3. **Chi phí thấp** — Cloudflare Workers AI free tier (~$0)
4. **Đơn giản** — không cần modify crawler, không cần re-crawl
5. **Coverage cao** — kiểm tra TẤT CẢ ảnh, không bỏ sót

## Solution: OCR All 26K Images

### Flow

```
Step 1: Query tất cả restaurant_image chưa OCR
        (loại bỏ 41 ảnh đã xử lý)

Step 2: Với mỗi ảnh:
        └─ Vision model: isMenu? + OCR
            ├─ isMenu=true, confidence >= 0.65 → Extract dishes
            └─ isMenu=false → Skip

Step 3: Persist
        ├─ Dishes → dish table (source = 'menu_image:vision:v1')
        ├─ Evidence → dish_evidence (evidence_type = 'menu_image')
        └─ Restaurant profile invalidation → re-embed
```

### Vision Model

Sử dụng **Cloudflare Workers AI** `@cf/meta/llama-3.2-11b-vision-instruct`:
- **Cost:** Free tier (không tốn tiền)
- **Prompt:** Đã có sẵn trong `enrich-menu-images.ts`
- **Output:** `{isMenu, confidence, ocrText, dishes[{name, priceAmount, rawPrice}]}`

### Code Changes

**Đã implement xong.** Thay đổi trong `crawler/src/cli/enrich-menu-images.ts`:

1. **Bỏ menu_tab priority filter** — không còn ORDER BY ưu tiên ảnh có alt_text "menu"
2. **Thêm `--batch-size` option** — xử lý N ảnh mỗi lần chạy ( útil cho VPS)
3. **Thêm progress logging** — log mỗi 100 ảnh để monitor trên VPS

### Implementation

```bash
# Chạy batch nhỏ (test)
npm run enrich:menu-images --workspace crawler -- --batch-size 100

# Chạy tất cả ảnh chưa xử lý (~26K)
npm run enrich:menu-images --workspace crawler

# Re-process tất cả (bao gồm 41 ảnh đã xử lý)
npm run enrich:menu-images --workspace crawler -- --refresh

# Dry run (chỉ xem kết quả, không ghi DB)
npm run enrich:menu-images --workspace crawler -- --dry-run --batch-size 50
```

### Expected Results

| Metric | Conservative | Optimistic |
| Tổng ảnh | 26,141 | 26,141 |
| Ảnh là menu (isMenu=true) | ~500-1,000 (2-4%) | ~1,000-2,000 (4-8%) |
| Dishes extract thành công | ~500-1,000 | ~1,000-2,000 |
| Quán có ít nhất 1 dish mới | ~300-500 (10-16%) | ~500-1,000 (16-32%) |

**Lưu ý:** Ngay cả khi chỉ 2% ảnh là menu, đó vẫn là **500+ dishes mới** — cải thiện đáng kể so với 0 hiện tại.

### Estimated Time

| Step | Time |
|------|------|
| Modify CLI (bỏ filter) | ~15 phút |
| Chạy OCR 26K ảnh | ~2-4 hours (tùy API rate limit) |
| Verify kết quả | ~30 phút |
| **Tổng** | **~3-5 hours** |

## Implementation Order

1. [x] Modify `enrich-menu-images.ts` — bỏ menu_tab priority filter + thêm `--batch-size`
2. [ ] Chạy batch nhỏ (100 ảnh) để test trên VPS
3. [ ] Chạy full 26K ảnh trên VPS
4. [ ] Verify dishes extracted
5. [ ] Update `enrichment_log`
6. [ ] Re-embed restaurants có dish mới
7. [ ] Update roadmap

## Success Criteria

- Ít nhất **2% ảnh** (500+) được classify là `isMenu=true`
- Ít nhất **500 dishes** mới được extract từ OCR
- Dishes có `source = 'menu_image:vision:v1'` có confidence >= 0.65
- Không có fabricated dishes (all từ real menu images)
- Quán có dish mới có thể search và recommend

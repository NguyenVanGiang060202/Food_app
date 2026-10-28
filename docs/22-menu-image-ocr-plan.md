# Menu Image OCR Plan

## Recommendation data gate

### Exact dish là mục tiêu dữ liệu

OCR không nhằm gom mọi món vào vài nhóm như `phở`, `bún`, `cơm`, `mì` hay
`món chay`. Những nhóm này chỉ là category. Output quan trọng là tên món cụ
thể trên menu và giá nếu đọc được, ví dụ `bún bò Huế`, `cơm tấm sườn bì chả`,
`bánh canh cua`, `lẩu bò nhúng giấm`.

Vì dataset cũ được crawl theo quán/category, cần crawl bổ sung theo danh sách
exact dish trước khi OCR. OCR không được suy ra món từ tên quán, category hay
ảnh món đã nấu; các nguồn đó chỉ dùng để xếp hàng ưu tiên.

### Data-quality guard (đã triển khai)

Ảnh món ăn đã chế biến (`food_photo`) không phải là ảnh menu. Vision có thể
nhận diện tên món trong ảnh để audit, nhưng pipeline không được tạo `dish` hoặc
`dish_evidence` từ dự đoán đó. Runtime cũng loại các evidence cũ có
`raw_ocr_text` bắt đầu bằng `food_photo:` để dữ liệu lịch sử không làm sai
recommendation.

Migration `033_quarantine_food_photo_evidence.sql` còn đánh dấu các dish chỉ
được hỗ trợ bởi loại evidence này là `unavailable` (giữ nguyên row để audit,
không xóa dữ liệu). Khi cần xác nhận lại, chỉ chạy OCR cho ảnh menu thật của
quán đó.

### Quality gate chống nhiễm template

Không ghi nhận extraction là menu evidence đáng tin nếu raw OCR:

- bắt đầu bằng `food_photo:`;
- lặp các dòng món template (`bún bò Huế`, `cơm tấm`, `bánh mì`) quá 3 lần;
- chứa từ 2 món trong bộ template lỗi cùng lúc; hoặc
- tạo ra chuỗi menu bất thường quá dài/lặp.

Các fact cũ vi phạm gate được giữ raw text để audit nhưng chuyển
`dish.status = unavailable`. Cần OCR lại ảnh menu gốc bằng Ollama trước khi
khôi phục món.

OCR được kích hoạt theo nhu cầu recommendation, không mặc định vì một quán có
category phù hợp không đồng nghĩa quán có mọi món trong category đó.

- Query nhóm rộng (`quán chay`, `món nướng`, `cà phê`): chỉ OCR khi category/
  attribute coverage không đủ hoặc benchmark cho thấy candidate quality thấp.
- Query món cụ thể (`bún bò Huế`, `cơm tấm sườn`): cần menu-image evidence để
  xác nhận quán có món; nếu thiếu, recommendation phải báo thiếu dữ liệu và
  yêu cầu operator OCR các quán mục tiêu.
- Query theo ngữ cảnh (`trời mưa`, `trời lạnh`): suy ra món nóng/ấm. Nếu UI
  đang bật filter “gần đây” và có GPS thì gửi bán kính (mặc định 5 km ở UI),
  còn backend không tự ép bán kính; người dùng có thể tắt filter để tìm toàn
  bộ như bình thường. Đây là discovery theo thuộc tính món, không được dùng
  tên quán để bịa món cụ thể.
- Sau khi OCR thành công: rebuild food profile và refresh embedding cho các quán
  có dish mới trước khi đánh giá lại kết quả.

Khi audit phát hiện query cụ thể không đủ evidence, đây là lúc cần báo người vận
hành chạy OCR; không được dùng tên quán hoặc category làm bằng chứng thay thế.

### Trust boundary của OCR Ollama

Ollama `minicpm-v` được dùng để đọc menu và lưu raw extraction để audit, nhưng
không mặc định là nguồn sự thật cho exact-dish recommendation. Model hiện vẫn
có thể lặp biến thể của một dòng hoặc sinh món không có trên ảnh. Vì vậy hard
retrieval chỉ tin các extraction có provenance mạnh:

- `website:menu:v1` — catalog/menu từ website first-party;
- `google_maps:menu-curated:v1` — operator đã đối chiếu ảnh menu Google Maps.

Với batch review theo một món, hãy chạy curation kèm `--replace-target`. Khi
đó chỉ các dòng thuộc món đang review mới được đưa vào active exact evidence;
các dòng khác trên cùng ảnh vẫn giữ trong raw OCR/candidate để không mất
coverage, nhưng không được dùng để khẳng định món đang hỏi.

Extraction `minicpm-v` chỉ trở thành recommendation evidence sau khi operator
review ảnh và curate/verify. Raw OCR không bị xóa; extraction lỗi được đánh dấu
`not_menu`, dish chỉ có evidence đó chuyển `unavailable` để không làm sai kết quả.

Pipeline cũng chặn ở bước persist: dù model trả nhầm các dòng món trong ảnh
`food_photo`/`other`, các dòng đó không được ghi thành `dish_evidence`. Migration
`047_quarantine_non_menu_extraction_evidence.sql` dọn các evidence cũ cùng loại
về `unavailable` nếu không có menu evidence tin cậy thay thế.

## Problem Statement

Crawler hiện tại thu thập **26,141 ảnh** từ 3,145 quán ăn, nhưng:

- **26,140 ảnh** là thumbnail từ search results list (sort_order 1-9) và detail panel (sort_order 0)
- **Chỉ 1 ảnh** có alt_text "Google Maps menu tab" — và ảnh đó là bowl of food, không phải menu
- **0 dishes** được extract từ OCR
- Tab "Menu/Thực đơn" gần như **không tồn tại** trên大多数 Google Maps place pages Việt Nam

## Review & Analysis

### Tại sao không OCR toàn bộ catalog?

| Nguồn                | Reality                                             | Verdict             |
| -------------------- | --------------------------------------------------- | ------------------- |
| Google Maps Menu Tab | Chỉ **1/3,145 quán** (0.004%) có tab này            | ❌ Dead end         |
| Review Photos        | Code hiện tại không extract; cần thêm DOM scraping  | ⚠️ Khó, tốn time    |
| Website Crawling     | 1,148 quán có website, nhưng đa số là Facebook/Zalo | ❌ Không crawl được |

**Kết luận:** Không OCR mù toàn bộ 26K ảnh. Hãy crawl theo exact dish trước,
lọc quán active và ảnh mới/cache được, sau đó OCR có mục tiêu. Nếu ảnh vẫn chỉ
là food photo hoặc CDN đã hết hạn thì ghi nhận là thiếu evidence và dừng retry;
operator chỉ cần bổ sung ảnh menu thật cho các quán/món đang thiếu.

### Vì sao targeted OCR phù hợp hơn?

1. **Đúng mục tiêu recommendation** — chỉ xử lý món đang thiếu coverage.
2. **Tiết kiệm Ollama/CPU** — không đốt thời gian vào hàng chục nghìn food photo.
3. **Có provenance** — exact dish → restaurant → ảnh cache → OCR evidence.
4. **Không retry CDN vô hạn** — URL cũ lỗi được ghi trạng thái failed để crawl URL mới.
5. **Giữ precision-first** — thiếu menu evidence thì trả rỗng có chủ đích.

### Operator workflow đã triển khai

- Audit coverage: `npm run audit:menu-coverage --workspace crawler` ghi
  `crawler/artifacts/menu-coverage-audit.json`, gồm số quán/evidence tin cậy và
  danh sách quán ưu tiên bổ sung menu.
- Menu website first-party: `npm run ingest:website-menu --workspace crawler`
  chỉ đọc catalog có tên món trong `alt`, bỏ qua Facebook/Foody/Grab/Zalo và
  ghi provenance `website:menu:v1`.
- Menu local thật: dùng
  `npm run ingest:local-menu --workspace crawler -- --restaurant-id <UUID> --file <path>`.
  Ảnh được hash, copy vào storage local và gắn `cache_status=cached`; sau đó
  chạy `enrich:menu-images` với Ollama concurrency 1 để OCR đúng ảnh đó.
- Template OCR bị nghi nhiễm (ví dụ cùng lúc `bún bò Huế`, `cơm tấm`, `bánh mì`
  trên quán không liên quan) bị chuyển `not_menu`; dish chỉ có evidence đó bị
  chuyển `unavailable`. Evidence website hoặc menu OCR sạch vẫn được giữ.

## Solution: Exact-dish crawl → cache → targeted OCR

### Flow

```
Step 1: Chọn exact dish đang thiếu coverage
        (ví dụ `phở bò`, `bún thịt nướng`, `lẩu bò`)

Step 2: Crawl quán active theo dish → cache ảnh xuống storage
        (không phụ thuộc CDN URL lâu dài)

Step 3: Với mỗi ảnh đã cache:
        └─ Vision model: isMenu? + OCR
            ├─ isMenu=true, confidence >= 0.65 → Extract dishes
            └─ isMenu=false → Skip

Step 4: Persist
        ├─ Dishes → lưu raw để audit; chỉ dùng exact recommend sau verify
        ├─ Evidence → dish_evidence (evidence_type = 'menu_image')
        └─ Restaurant profile invalidation → re-embed
```

### Vision Model

Runtime hiện tại sử dụng **Ollama local** `minicpm-v` (OpenAI-compatible
vision endpoint `http://localhost:11434/v1`):

- **Cost:** không phát sinh API call cloud; đổi lại tốn CPU/RAM local
- **API:** OpenAI-compatible `/chat/completions`
- **Concurrency:** giữ ở mức 1–2 để tránh nghẽn VRAM/RAM và giữ OCR ổn định
- **Prompt:** Đã có sẵn trong `enrich-menu-images.ts`
- **Output:** `{isMenu, confidence, ocrText, dishes[{name, priceAmount, rawPrice}]}`

### Code Changes

**Đã implement xong.** Thay đổi trong `crawler/src/cli/enrich-menu-images.ts`:

1. **Bỏ menu_tab priority filter** — không còn ORDER BY ưu tiên ảnh có alt_text "menu"
2. **Thêm `--batch-size` option** — xử lý N ảnh mỗi lần chạy ( útil cho VPS)
3. **Thêm progress logging** — log mỗi 100 ảnh để monitor trên VPS
4. **Giới hạn concurrency/delay** — phù hợp Ollama local, tránh chạy song song quá nhiều ảnh
5. **2-step classify → extract** — phân loại ảnh trước, extract dishes sau

### Implementation

```bash
# Chạy batch nhỏ (test)
docker compose run --rm --entrypoint node crawler crawler/dist/cli/enrich-menu-images.js --batch-size 100

# Chạy batch 500 (default)
docker compose run --rm --entrypoint node crawler crawler/dist/cli/enrich-menu-images.js --batch-size 500

# Chạy target theo restaurant IDs đã được audit
node crawler/dist/cli/enrich-menu-images.js --batch-size 50 --concurrency 1 \
  --restaurant-id <active-restaurant-id>

# Dry run (chỉ xem kết quả, không ghi DB)
docker compose run --rm --entrypoint node crawler crawler/dist/cli/enrich-menu-images.js --dry-run --batch-size 50
```

### Direct website menu source

Trước khi chạy OCR, chạy `npm run ingest:website-menu --workspace crawler` cho
các quán có website chính thức. Pipeline chỉ nhận website first-party, bỏ qua
Facebook/Foody/Grab/Zalo dùng chung; tên món trong catalog được lưu với
provenance `website:menu:v1`, ảnh vẫn được cache để frontend không phụ thuộc
CDN. Đây là evidence trực tiếp và không cần vision OCR lại.

### Expected Results

Không đặt KPI giả định cho toàn bộ 26K ảnh. Với mỗi exact dish, success là:

- crawl được quán active và cache được ảnh;
- có menu image thật, OCR không phải `food_photo`/template;
- dish evidence được ghi nhận và query exact trả đúng quán;
- nếu không đạt, query trả 0 và operator biết cần bổ sung ảnh menu.

### Estimated Time

| Step                   | Time                            |
| ---------------------- | ------------------------------- |
| Modify CLI (bỏ filter) | ~15 phút                        |
| Crawl/cache/OCR target  | tùy số quán và số ảnh menu thật |
| Verify kết quả         | ~30 phút                        |
| **Tổng**               | **~3-5 hours**                  |

## Implementation Order

1. [x] Modify `enrich-menu-images.ts` — batch, cache local và quality gate
2. [x] Crawl bounded theo exact dish trước khi OCR
3. [x] Cache ảnh theo hash, ghi trạng thái failed cho CDN hết hạn
4. [x] OCR target bằng Ollama với concurrency thấp
5. [x] Verify exact query không fallback sang quán không có evidence
6. [x] Giới hạn exact retrieval vào website/curated menu evidence
7. [ ] Khi có menu image thật: rebuild profile và re-embed quán có dish mới
8. [ ] Mở rộng query/district theo bounded batch nếu coverage còn thiếu

## Success Criteria

- Dishes có `source = 'menu_image:vision:v1'` chỉ được dùng khi evidence
  vượt quality gate và confidence đủ cao.
- Không có fabricated dishes: food photo, template OCR và tên quán không phải
  bằng chứng menu.
- Query exact thiếu evidence trả rỗng có chủ đích, không fallback sang quán sai.
- Khi operator bổ sung menu image thật, dish mới có thể search/recommend sau
  bước rebuild profile/embedding.

## Latest runtime safeguards

- OCR luôn đọc file cache local trước. Nếu Ollama timeout hoặc trả lỗi trên
  bytes cache hợp lệ, extraction được ghi `failed` trực tiếp; pipeline không
  quay lại CDN URL cũ và không tạo lỗi giả kiểu `fetch failed`.
- Khi chạy crawler trực tiếp trên Windows, `AI_BASE_URL` dùng chung với Docker
  vẫn có thể là `http://host.docker.internal:11434/v1`; CLI tự đổi hostname này
  thành `localhost` để gọi Ollama native. Khi chạy crawler trong container,
  hostname Docker được giữ nguyên.
- Ảnh lớn được downscale tạm thời trước khi gửi Vision (mặc định cạnh dài
  tối đa 1600px, chỉnh bằng `AI_MAX_IMAGE_DIMENSION`); file gốc vẫn giữ nguyên
  trong storage để frontend và audit dùng lại.
- `--menu-only` ưu tiên `local-menu` và `website menu`, đồng thời bỏ qua marker
  `Google Maps menu tab` cũ vì marker này từng gắn nhầm vào ảnh món ăn.
- `--targeted --dish "phở bò" ...` cho phép quét có mục tiêu các quán liên
  quan đến món, kể cả ảnh chưa có nhãn menu. Mặc định chỉ lấy tối đa 3 ảnh/quán
  (`--per-restaurant`) để tìm menu thật; ảnh food photo vẫn bị loại và không
  tạo dish evidence.
- `--retry-failed` chỉ retry các ảnh đang có extraction `failed`; nó không kéo
  theo toàn bộ ảnh pending chưa chạy. Khi Ollama quá tải, retry nên chạy với
  `--concurrency 1` để tránh timeout dây chuyền.
- Ảnh có nhãn `menu` nhưng Ollama xác nhận không đủ rõ vẫn được giữ ở audit
  (`not_menu` hoặc không tạo dish), không được promote tự động thành exact
  recommendation evidence. Chỉ ảnh đã đối chiếu với đúng quán và món/giá rõ
  ràng mới được curate.
- Review thủ công dùng `review:menu-images` để tạo contact sheet. Lệnh này
  mặc định chỉ xuất ảnh đã qua gate menu (`website:menu:v1` hoặc
  `google_maps:menu-curated:v1`), không xuất ảnh bìa/ảnh món chung. Nếu cần
  xem candidate chưa xác minh để tìm nguồn bổ sung, phải bật rõ
  `--candidate-batch`; candidate không được chọn để tạo evidence trực tiếp.
  Khi batch không có ảnh hợp lệ, manifest ghi `no_verified_menu_images` thay
  vì hiển thị lưới ảnh gây nhiễu. Sau khi chọn UUID vào
  `selected-menu-image-ids.txt`, OCR chính xác tập đã chọn bằng:
  `npm run enrich:menu-images --workspace crawler -- --selection-file crawler/artifacts/menu-review/selected-menu-image-ids.txt --concurrency 1`.
- Review sheet có thể mở qua localhost để ảnh cache hiển thị ổn định:
  `python -m http.server 8765 --directory crawler/artifacts`, sau đó mở
  `http://localhost:8765/priority-menu-review/index.html`. Chỉ promote ảnh menu
  thật sau khi đối chiếu quán bằng link Google Maps. Lệnh promote explicit:
  `npm run curate:menu-image --workspace crawler -- --restaurant-id <id> --image-id <image-id> --entry "Bún riêu|43000"`.
  Có thể truyền nhiều `--entry`; giá trống được phép. Lệnh này mới gắn
  provenance `google_maps:menu-curated:v1`, nên OCR Ollama thô không tự động
  lọt vào exact recommendation.
- Audit coverage dùng cùng precision gate với recommendation runtime: chỉ đếm
  `dish.status = available`, extraction đáng tin, và raw OCR thực sự chứa tên
  món. Template OCR dài/lặp không được tính là coverage.
- Sau khi website menu hoặc OCR thêm món, `restaurant.semantic_profile` bị
  invalidated. Embedding nên refresh theo `--restaurant-id` của quán bị thay
  đổi; không cần refresh toàn bộ catalog.

### Result of the latest bounded run

Đã cache thêm 12 ảnh mới từ 48 quán ưu tiên đang thiếu coverage, sau đó OCR
targeted 90 ảnh bằng Ollama. Kết quả: 0 menu mới, 5 timeout ở lần chạy song
song; retry tuần tự 10 bản ghi failed hoàn tất không lỗi và không tạo dish giả.
Các ảnh còn lại đều bị giữ ở trạng thái `not_menu` vì là food photo/gallery.

Một crawl bổ sung theo `gà nướng` tại Quận 5, Quận 7 và Quận 11 lấy thêm 15
kết quả Google Maps; 9 ảnh mới được cache và OCR targeted, cũng không có menu
thật. Các crawl run đã hoàn tất được skip để tránh import trùng dữ liệu.

Coverage runtime sau batch:

- `phở bò`: 1 quán / 6 evidence menu;
- `lẩu bò`: 1 quán / 14 evidence menu;
- `gà nướng`: 1 quán / 2 evidence menu;
- `phở gà`, `bún riêu`, `bún thịt nướng`: chưa có evidence menu đủ tin cậy.

Vì vậy pipeline tự động đã thử đúng phạm vi an toàn nhưng chưa thể tạo thêm
coverage cho ba món còn thiếu. Bước tiếp theo có giá trị cao là ingest ảnh menu
thật của các quán mục tiêu bằng `ingest:local-menu`; không nên OCR tiếp toàn bộ
ảnh món ăn Google Maps.

### Latest exact-menu pass — 2026-09-24

- Đã chạy lại Ollama `minicpm-v:latest` trên 2 ảnh menu operator đã chọn trong
  `priority-menu-review`. Một ảnh OCR được 5 dòng nhưng có hallucination; các
  dòng không đọc rõ đã bị loại khỏi trusted evidence.
- Sau khi đối chiếu trực tiếp ảnh menu, chỉ promote các dòng nhìn rõ của quán
  Bún Riêu Cô Hương Béo: `Tô ngon miệng` (45.000), `Tô đầy đủ` (61.000),
  `Tô đặc biệt` (68.000). Không dùng các dòng Ollama đoán nhầm như `Bún bò Huế`
  hay `Bún da`.
- Website first-party ingestion chạy lại sau khi sửa exact-name mapping: 21
  evidence từ 17 quán. Repair script đã được làm idempotent, tự gộp duplicate
  evidence thay vì lỗi unique constraint.
- Coverage trusted sau pass:
  - `bún riêu`: 2 quán / 10 evidence;
  - `bún thịt nướng`: 3 quán / 5 evidence;
  - `lẩu bò`: 1 quán / 12 evidence;
  - `phở bò`: 0 quán / 0 evidence;
  - `bún bò Huế`: 0 quán / 0 evidence.
- Đã rebuild `restaurant_food_profile` và refresh embedding cho các quán bị
  thay đổi. Exact query thiếu evidence vẫn trả `MENU_EVIDENCE_MISSING` có chủ
  đích, không fallback sang tên quán/category.

### Exact-menu pass 2 — 2026-09-24

- Targeted OCR thêm 95 ảnh cache của 50 quán liên quan `phở bò` và `bún bò Huế`.
  Ollama xác nhận 2 ảnh là menu và tạo 9 dòng OCR thô.
- Chỉ có `Bún bò Huế — 45.000đ` ở Bún bò Huế Hương Xưa được đối chiếu rõ bằng
  mắt và promote thành `google_maps:menu-curated:v1`.
- Bún Bò Huế Hồng Hà không được promote: menu ghi `bún bò Nam`, không đủ cơ sở
  để đổi thành `bún bò Huế`.
- Coverage trusted hiện tại: `phở bò` 0 quán/0 evidence; `bún bò Huế` 1 quán/1
  evidence; `bún riêu` 2 quán/10 evidence; `bún thịt nướng` 3 quán/5 evidence;
  `lẩu bò` 1 quán/12 evidence.
- Đã rebuild profile và refresh embedding cho Hương Xưa. Query `tìm bún bò Huế`
  hiện trả đúng Hương Xưa, giá 45.000đ và Google Maps URL; các món OCR không rõ
  vẫn không được đưa vào recommendation.

### Exact-menu pass 3 — 2026-09-24

- Cache thêm 62 ảnh menu ứng viên cho ba quán ưu tiên; OCR Ollama xử lý 62 ảnh
  với concurrency 1, xác nhận 6 ảnh là menu và không có lỗi request.
- Bún Bò Huế Hồng Hà bị loại vì menu ghi `bún bò Nam`, không phải `bún bò Huế`.
- Phở Bò Thanh Đa có bảng `PHỞ` với các biến thể tái/thập cẩm, nhưng không ghi
  rõ `phở bò`; không promote để tránh suy diễn từ tên quán hoặc tiêu đề mục.
- Bếp Minh Ngọc có ảnh menu tiếng Anh rõ ràng. Đã curate 6 món: `BEEF BRISKET
  PHO`, `BEEF BRISKET & TENDON PHO`, `RARE BEEF PHO`, `RARE BEEF & BRISKET
  PHO`, `RARE BEEF, BRISKET & TENDON PHO`, `DRY BEEF PHO`, giá 50.000–55.000đ.
  Các món được nối vào canonical `phở bò`.
- Coverage trusted hiện tại: `phở bò` 1 quán/6 evidence; `bún bò Huế` 1/1;
  `bún riêu` 2/10; `bún thịt nướng` 3/5; `lẩu bò` 1/12.
- Đã rebuild profile và refresh embedding cho Bếp Minh Ngọc. Query `tìm phở bò`
  hiện trả đúng quán này với Google Maps URL và matched dish `Phở bò`.

### Latest recommendation data pass — 2026-09-25

- Website first-party ingestion đã chạy cho 17 quán mục tiêu, ghi 21 catalog
  items với provenance `website:menu:v1`. Đây là nguồn trusted trực tiếp, không
  cần OCR lại ảnh catalog.
- Coverage trusted hiện tại: `phở bò` 1 quán, `phở gà` 1 quán, `bún bò Huế`
  1 quán, `bún riêu` 2 quán, `bún thịt nướng` 3 quán và `lẩu bò` 1 quán.
- Đã sửa lỗi normalize chữ `Đ/đ` không nhất quán giữa website ingest, curation,
  OCR và backend intent. Migration `048_normalize_and_merge_dish_duplicates.sql`
  đã gộp 12 row trùng và giữ lại evidence, attribute và review links.
- Đã rebuild food profile và refresh embedding cho các quán bị ảnh hưởng.
- Đã chạy Ollama trên 17 ảnh cache còn pending ở hai quán lẩu bò; không có menu
  đủ rõ nên không tạo dish/evidence mới. Ảnh mờ không được promote thành món.
- Runtime đã xác nhận: exact dish trả đúng quán có menu; `phở bò tái` trả
  `MENU_EVIDENCE_MISSING`; câu hỏi trời mưa chỉ trả món có trusted evidence;
  filter gần đây chỉ áp dụng khi client bật và gửi bán kính.

### Recommendation runtime hardening — 2026-09-29

- Exact-dish SQL đã được tối ưu bằng CTE materialized và cast rõ kiểu `text`,
  loại lỗi parameter type từng gây 503.
- Weather candidate chỉ dùng extraction `completed` và loại marker
  `food_photo:`; extraction `not_menu` chỉ còn phục vụ audit, không tạo
  candidate recommend.
- Tên slug món từ website được format ở API để UI hiển thị tên dễ đọc; dữ liệu
  raw và provenance vẫn giữ nguyên để audit.
- Không cần OCR đại trà thêm ở bước này. Chỉ OCR/curate khi audit chỉ ra món
  cụ thể thiếu evidence và có ảnh menu thật đã đối chiếu quán.

### Targeted OCR pilot

Ở pilot trước đó, 1 ảnh menu thật chứa các tên tiếng Anh như
`BEEF BRISKET PHO`; OCR lưu được 6 món cụ thể. Migration bilingual đã map các
biến thể beef/chicken pho về canonical `phở bò`/`phở gà`, và API exact-dish hiện
đã trả đúng quán có menu evidence. Đây là coverage có thể dùng cho recommend;
không mở rộng batch lớn nếu đầu vào vẫn chỉ là food photo.

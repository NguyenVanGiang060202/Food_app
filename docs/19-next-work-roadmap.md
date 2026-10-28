# Next Work Roadmap — Portfolio Deployment

## 1. Mục tiêu đã chốt

Project này được tối ưu cho:

- Một sản phẩm portfolio có thể demo bằng domain thật.
- Một người vận hành, hoặc nhóm rất nhỏ, có thể quản lý được.
- Quy mô sử dụng ban đầu dưới khoảng 500 người, không yêu cầu SLA enterprise.
- Chi phí hạ tầng và chi phí AI thấp, ưu tiên free tier/chi phí cố định nhỏ.
- Có đủ chiều sâu kỹ thuật để trình bày: React, TypeScript, REST API,
  PostgreSQL/PostGIS/pgvector, crawler, Docker, CI và recommendation flow.

Không dùng “production enterprise” làm tiêu chuẩn hoàn thành. Các hạng mục như
MFA, Kubernetes, multi-region, distributed rate limiting, observability platform
và backup tự động nhiều lớp chỉ làm khi sản phẩm có người dùng thật và có nhu cầu.

## 2. Định nghĩa hoàn thành

Project được xem là **hoàn thành cho portfolio** khi:

1. Có một domain HTTPS truy cập được từ Internet.
2. Visitor có thể khám phá, tìm kiếm, xem chi tiết, xem bản đồ và nhận gợi ý.
3. User có thể đăng ký/đăng nhập, lưu nhà hàng và chỉnh preference.
4. Dữ liệu demo đủ tốt, có nguồn tham chiếu và không hiển thị dữ liệu bịa.
5. Crawler có thể chạy bounded để cập nhật dữ liệu theo cách có kiểm soát.
6. CI pass typecheck, unit test, build và browser smoke test.
7. Một người khác có thể chạy local theo README và hiểu kiến trúc qua docs.
8. Không để lộ secret, database không mở public, và có cách khôi phục thủ công
   tối thiểu trước khi cập nhật schema.

Mốc này phù hợp với website showcase và dưới 500 người dùng không đồng thời.
Không cam kết tải cao, zero-downtime hoặc dữ liệu real-time.

## 3. Trạng thái hiện tại

### Food Intelligence — Phase 1 foundation đã implement

- Migration `029_food_intelligence_foundation.sql` đã được đưa vào migration runner.
- `canonical_dish` + `canonical_dish_alias` và `dish.canonical_dish_id` đã có; existing dishes
  được backfill theo exact normalized identity, giữ nguyên restaurant-specific dish row.
- `review_opinion` được tách khỏi menu facts để lưu subjective review signals có confidence,
  extraction method/model version và provenance tới review/dish.
- `restaurant_food_profile` có version/status/evidence coverage và endpoint rebuild/get.
- Profile tự chuyển `stale` khi dish/review/review-opinion thay đổi; profile build lấy dữ liệu
  từ persisted evidence thay vì raw OCR.
- Backend có test cho profile derivation; local database đã migrate và xác nhận 1,223 canonical
  dishes, 5,711/5,711 dishes có canonical identity.

Food Intelligence Phase 2 đã có review opinion extraction + aggregate signals theo
dish/restaurant. Phase 3 hiện đã nối deterministic semantic document vào
`restaurant_food_profile`, và crawler embedding ưu tiên document này khi profile ready.
Recommendation endpoint hiện dùng semantic embedding cùng structured/context signals;
phần tiếp theo là evaluation/tuning thay vì thêm một pipeline AI mới.

### Audit mới nhất — exact dish và weather nearby

- Exact dish là hard constraint: sau khi parser được chốt, các query
  `lẩu bò`, `gà nướng`, `phở bò`, `bún thịt nướng` đều trả rỗng khi chưa có
  menu evidence tin cậy, không fallback sang quán chỉ có tên/category phù hợp.
- Weather intent (`trời đang mưa`) chỉ suy ra món nóng/ấm. Filter “gần đây”
  được bật/tắt ở frontend; backend chỉ áp bán kính khi client gửi
  `radiusMeters` hoặc câu hỏi nói rõ gần đây. Khi tắt filter, vẫn có thể dùng
  GPS để boost khoảng cách nhưng không giới hạn candidate set.
- Đã chạy bounded crawl 6 exact queries ở Quận 1, cache nhóm ảnh mới và OCR
  46 ảnh bằng Ollama. Kết quả mới chủ yếu là `food_photo`, template OCR hoặc
  CDN cũ lỗi; chưa có trusted menu evidence mới. Vì vậy chưa cần re-embed và
  không nên OCR toàn bộ catalog tiếp.
- Bước dữ liệu tiếp theo chỉ đáng làm khi có ảnh menu thật từ quán; khi đó
  chạy cache → OCR target → rebuild profile → refresh embedding.
- Đã thêm operator workflow để tiếp tục mà không OCR mù: audit coverage, ingest
  catalog website first-party, và `ingest:local-menu` để nhập ảnh menu thật theo
  `restaurant_id`. OCR template nhiễm late-batch đã được quarantine và đồng bộ
  dish status; API exact dish rỗng trả `MENU_EVIDENCE_MISSING` để frontend nói rõ
  thiếu menu evidence thay vì fallback sang quán sai.
- Đã bổ sung nhánh `ingest:website-menu`: với website chính thức có catalog
  sản phẩm, hệ thống đọc tên món đã công bố trong `alt` sản phẩm, lưu URL ảnh,
  cache local và ghi evidence `website:menu:v1`; nguồn này không cần OCR lại.
  Chạy thử thành công với Lẩu Bò Cư Xá: 14 ảnh catalog, query `lẩu bò` trả
  đúng quán; `gà nướng` cũng chỉ trả khi menu catalog có món gà nướng.
- **Cập nhật 2026-09-25:** trusted-menu gate đã được áp dụng đồng nhất cho
  recommendation, `/dishes`, chi tiết nhà hàng và tín hiệu quán tương tự. Dish
  chỉ được hiển thị/recommend khi có extraction hoàn tất từ
  `website:menu:v1` hoặc `google_maps:menu-curated:v1`; dish legacy từ tên quán,
  category hoặc review vẫn giữ để audit nhưng không còn là món bán thật trên UI.
- Weather summary không còn lặp danh sách món do local model tự đoán. Với câu
  hỏi trời mưa, UI/API hiển thị hướng “món nóng, ấm bụng”; món cụ thể chỉ xuất
  hiện khi menu evidence thực sự tồn tại. Nếu nearby + bán kính hiện tại không
  có món verified, API trả `MENU_EVIDENCE_MISSING` với lý do rõ ràng.
- **Cập nhật 2026-09-27 — Recommendation V3:** weather alternatives now use a
  materialized verified-menu match set instead of repeating correlated OCR
  subqueries for every alternative in `WHERE`, `SELECT`, and `ORDER BY`. The
  optional nearby radius is applied before menu evidence evaluation. When the
  user enables the radius, ordering is verified menu match → evidence confidence
  → nearest distance → bounded quality; without the radius, distance remains
  only a small ranking boost. Added lookup indexes in migration `049` and
  structured slow-query/error logging in the restaurant repository/service.

### Recommendation runtime hardening — 2026-09-29

- Đã sửa lỗi PostgreSQL `42P18 could not determine data type of parameter` ở
  exact-dish CTE bằng cách cast rõ query chuẩn hóa thành `text`; endpoint không
  còn 503 ở các query `cơm tấm`, `bánh canh cua`, `gà nướng`.
- Exact-dish retrieval materialize verified menu/candidate set một lần; quán có
  menu thật đứng trước `candidate_signal`, nhưng candidate vẫn được giữ để
  người dùng tự kiểm tra khi coverage món chưa đủ.
- Weather candidate không còn đọc extraction `not_menu` hoặc OCR marker
  `food_photo:`. Ảnh món/ảnh cửa hàng bị phân loại sai không thể tự biến thành
  quán món nóng gần đây.
- API format tên món dạng slug từ website, ví dụ `com-tam-suon-cot-let` thành
  `Cơm tấm sườn cốt lết`, nhưng không thay đổi identity/evidence trong database.
- Exact-dish requests that are already a bare concrete dish phrase now bypass
  the local Ollama intent round trip; natural-language wrappers and extra
  filters still use AI when they need interpretation. Weather filler words
  such as `nên` are removed before SQL matching, so they cannot hide verified
  weather-menu rows.
- Verification: backend typecheck pass, **128/128 backend tests pass**, crawler
  **95/95**, frontend **28/28**; Docker backend healthy. Live smoke confirms
  weather without radius returns verified menu first, explicit 5 km radius
  returns nearest verified menu first, and exact dishes keep candidate signals
  below verified evidence. `phở bò tái` correctly returns
  `MENU_EVIDENCE_MISSING` because the current trusted menu corpus only proves
  broader variants such as `phở tái`/`phở bò nạm`, not the requested identity.
- Semantic runtime now selects the embedding model with the largest catalog
  coverage before using freshness as a tie-breaker. The database currently has
  4,130 vectors for `@cf/baai/bge-m3@doc:v3` versus only 12 for the newer
  partial `bge-m3@doc:v3`; this prevents semantic ranking from silently
  scoring almost the entire catalog as `NULL`.

### Đã hoàn thành

- Backend, crawler và frontend typecheck pass.
- Backend tests: 128/128 pass.
- Crawler tests: 95/95 pass.
- Frontend unit tests: 28/28 pass.
- Backend, crawler và frontend production build pass.
- Playwright smoke flow đã có cho recommendation, empty/reset, lỗi backend,
  discovery, map, auth và save flow.
- REST API có health/readiness, validation, request ID, structured errors,
  CORS allowlist, security headers, request-size limit và in-process rate limit.
- Authentication dùng HttpOnly session cookie; bearer fallback chỉ giữ cho
  backward compatibility.
- User role `user`/`admin`, admin guard và script promote-admin đã có.
- PostgreSQL image sạch đã được xác minh với 5 extension, bảng lõi,
  role constraint và unique image index.
- Docker Compose có PostgreSQL, Redis, backend và production frontend profile.
- Frontend production image có SPA fallback, reverse proxy `/api/` và healthz.
- CI chạy check, test, build, Playwright, build frontend image, `nginx -t` và
  schema assertion cho database image.

## 4. P0 — bắt buộc để đưa lên domain

### P0.0 TODO khi crawl xong — tối ưu lại “quán tương tự”

- Hiện tại `listSimilar` (backend `restaurants.repository.ts`) đã được tinh chỉnh để
  fallback bằng `name_similarity` + district/price khi DB thiếu dish/category.
- **Giải pháp data (đã làm một phần):** crawler Google Maps không đọc được
  category/dish từ list page, và dish/embedding sẽ không bao giờ tự đầy nếu chỉ
  chạy thêm crawl. Đã thêm bước **enrichment** one-shot
  (`npm run enrich:once --workspace crawler`) gán `restaurant_category`
  (classifier theo tên) + `dish` (lexicon theo tên/review), đều ghi `source` +
  `confidence`, không ghi đè fact thật, có `enrichment_log`. Sau khi migrate
  `022` + chạy enrichment, cần verify:
  - Overlap dish/category có phát huy không (không còn rơi vào fallback rating).
  - Điều chỉnh lại trọng số `category_overlap`/`dish_overlap` nếu bị lấn át bởi
    `name_similarity` (×30).
  - Rà lại toàn bộ 3 anchor quán hiện có để đối chiếu kết quả.
- **Đã làm:** bước sinh `restaurant_embedding` (`npm run embed:once --workspace
crawler`, docs/05 Stage 7) từ search-document deterministic (tên/category/dish/
  khu vực/phân khúc giá), provider OpenAI-compatible (env
  `EMBEDDING_BASE_URL/API_KEY/MODEL`), idempotent + `--refresh`, có
  `enrichment_log`. **Đã làm:** migration `027_embedding_vector_index.sql` cài
  HNSW index (`vector_cosine_ops`) — idempotent, được re-apply mỗi lần
  `npm run db:migrate`, tự khoá cột `embedding` theo kích thước vector thực khi
  đã có dữ liệu, nên không cần chốt dimension trước.
- **✅ HOÀN TẤT:** chọn model/dimension thật và bật provider khi deploy. Production
  dùng **Cloudflare Workers AI `@cf/baai/bge-m3` (1024-dim)** cho cả embed offline
  lẫn query embed. Đã re-embed toàn bộ ~2511 quán, build HNSW index, và verify
  semantic ranking trên domain thật (`/api/v1/recommendations`). Đã fix 2 lỗi phát
  hiện khi chạy production:
  - `activeModel()` dùng `MIN(id)` trên cột `uuid` → `function min(uuid) does not
exist`, bị catch im lặng → semantic path tắt. Fix: `MIN(id::text)`.
  - `list()` ORDER BY tham chiếu alias (`COALESCE(relevance_score, 0)`) → PostgreSQL
    cấm alias trong biểu thức ORDER BY → 503. Fix: inline expression
    (`COALESCE(relevanceExpr, 0) + 0.4 * COALESCE(semanticExpr, 0)`).
  - Fallback cuối khi có embedding giờ bỏ tastes suy diễn (chỉ giữ tastes người
    dùng chọn tường minh) để câu "bún bò huế cay đậm đà" không trả rỗng vì
    AND taste filter không khớp.

### P0.2 “Hỏi bếp” chuyển từ tìm kiếm theo luật sang hiểu ý định (đã làm, cần key khi deploy)

- Đã thêm runtime LLM intent parsing (`backend/src/modules/ai/`): câu tự nhiên →
  JSON intent (`categories` từ category taxonomy thật trong DB, `dishes`,
  `tastes`, `district`, `priceLevel`, `minRating`, `openNow`, `distanceKm`,
  `summary`), provider OpenAI-compatible (`AI_BASE_URL` default Gemini
  OpenAI-compatible endpoint, `AI_API_KEY`, `AI_MODEL`). Truy vấn vẫn chạy qua
  `RestaurantsRepository.list` nên không bao giờ "bịa" quán. Provider lỗi /
  chưa cấu hình → fallback deterministic `interpretQuery` như cũ. Frontend
  hiển thị thêm chip giá/khoảng cách/đang mở + dòng "Bếp nghe hiểu: …".
- **✅ HOÀN TẤT khi deploy VPS:** khai báo `AI_API_KEY` (+`AI_BASE_URL`, `AI_MODEL`
  nếu không dùng Gemini) trong `.env` của backend. Production dùng Groq
  (`https://api.groq.com/openai/v1`, `llama-3.3-70b-versatile`), đã test qua
  domain thật với câu "quán chay nhẹ nhàng gần quận 1 trong 5 km".

### P0.1 Chốt dữ liệu và trải nghiệm demo

- Chọn một phạm vi dữ liệu nhỏ, ví dụ một thành phố và một số nhóm món ăn.
- Dùng [frontend release checklist](20-frontend-release-checklist.md) để kiểm tra
  local trước khi mua domain hoặc VPS.
- Chạy fixture hoặc bounded approved-source crawl để có dữ liệu ổn định.
- Kiểm tra thủ công các route: `/`, `/discover`, `/search`, `/map`,
  `/restaurants/:id`, `/dishes/:id`, `/auth`, `/saved`, `/profile`.
- Sửa các lỗi làm hỏng demo: ảnh, empty state, loading, mobile layout,
  link nguồn và dữ liệu thiếu.
- Không mở rộng thêm Telegram, mobile app, provider mới hoặc AI workflow mới
  trước khi hoàn tất mốc này.

**Kết quả:** người xem portfolio có thể mở domain và đi hết visitor flow trong
vài phút mà không gặp màn hình trống hoặc dữ liệu giả.

### P0.1.1 Benchmark Recommendation V2 trên dữ liệu thật

- **Đã làm:** benchmark offline trên database hiện tại với **2,511 restaurant active** và **2,511 stored embeddings** (`@cf/baai/bge-m3@doc:v3`, 1024-dim).
- Bộ đánh giá gồm 8 truy vấn món/nhóm món (`phở bò`, `bún bò huế`, `pizza`, `quán chay`, `hải sản`, `lẩu`, `cà phê`, `món nướng`); qrels được sinh từ dish/name/semantic-profile evidence hiện có trong DB. Đây là **silver-label benchmark**, chưa thay thế human judgments.
- Đã grid-search `semantic_weight` và `quality_weight` trên artifact hiện tại sau khi bổ sung bounded canonical-attribute evidence. Điểm tốt nhất trong run là **semantic=1.2, quality=0.16**, với **Recall@10=0.9125, NDCG@10=0.607490**.
- **Đã áp dụng:** `RestaurantsRepository` đọc weights từ env (`RECOMMENDATION_SEMANTIC_WEIGHT`, `RECOMMENDATION_QUALITY_WEIGHT`, `RECOMMENDATION_DISTANCE_WEIGHT`). Chưa đổi default production từ `1.0 / 0.12 / 0.12` vì qrels vẫn là silver labels.
- Run hiện tại dùng **query embeddings thật** từ provider cấu hình (`@cf/baai/bge-m3`), không dùng centroid proxy.

### P0.2 Chuẩn hóa cấu hình production nhỏ

- Tạo file env production theo nền tảng deploy; không commit secret.
- Đặt `NODE_ENV=production`, `APP_ORIGIN` bằng domain frontend và allowlist CORS
  chỉ chứa domain đó.
- Dùng `AUTH_SECRET`, `ADMIN_API_KEY`, PostgreSQL password đủ mạnh và riêng biệt.
- Tắt `AUTH_EXPOSE_VERIFICATION_LINK` và `AUTH_EXPOSE_RESET_LINK`.
- Nếu chưa cấu hình SMTP/OAuth, ẩn hoặc ghi rõ các flow đó thay vì để nút hỏng.
- Dùng HTTPS ở reverse proxy/hosting; frontend gọi API qua cùng-origin `/api/v1`
  để tránh CORS không cần thiết.

**Kết quả:** deploy không dùng secret mặc định/local fallback và không expose
PostgreSQL/Redis/backend trực tiếp ra Internet.

### P0.3 Deploy một máy chủ đơn giản

#### VPS đã chọn — [REDACTED PROVIDER / PLAN] — ĐÃ MUA

- Nhà cung cấp: [REDACTED]
- Cấu hình: [REDACTED]
- Mạng: [REDACTED]
- Kèm: [REDACTED]
- Kế hoạch: **chạy thử 1–2 tháng** trước khi cam kết lâu dài; trả theo tháng, có thể hủy.
- **Thông tin server (lưu riêng ngoài repository):**
  - Hostname: `[REDACTED]`
  - IP chính: `[REDACTED]`
  - Account: `[REDACTED]`
  - OS khuyến nghị khi cài: Ubuntu 22.04 LTS.
  - Mật khẩu root: **KHÔNG ghi vào commit** — giữ riêng trong password manager.
- Lưu ý tài nguyên: 2 GB RAM là mức tối thiểu — PostgreSQL (~512MB–1GB) + Redis (~100–200MB) +
  backend (~200–500MB) + frontend Nginx (~50MB) + OS (~200–500MB). Theo dõi `free -h` sau khi deploy;
  nếu hết RAM có thể thêm swap hoặc nâng lên plan tương đương.
- Hạng mục deploy chi tiết: xem mục triển khai VPS nội bộ bên dưới.

- Dùng một VPS nhỏ hoặc nền tảng Docker có persistent volume.
- Chạy frontend production, backend, PostgreSQL và Redis bằng Compose hoặc
  dịch vụ managed tương đương.
- Đặt reverse proxy/HTTPS ở máy chủ hoặc dùng proxy của nền tảng.
- Bind PostgreSQL, Redis và backend vào private network/loopback.
- Cấu hình restart policy, healthcheck và volume cho PostgreSQL.
- Chạy migration một lần trước khi mở traffic.
- Chạy smoke test domain: frontend, `/healthz`, `/api/v1/health`, search,
  detail và login.

**Kết quả:** domain hoạt động ổn định ở quy mô nhỏ; khi server restart, app và
database tự khởi động lại.

### P0.4 Tài liệu portfolio

- README có screenshot/GIF, tính năng, architecture diagram và live demo link.
- Ghi rõ data source, giới hạn crawler, công nghệ và trade-off.
- Có hướng dẫn local setup ngắn gọn, demo account hoặc seed data an toàn.
- Có một phần “What I would build next” trỏ tới P1/P2, không mô tả tính năng
  chưa tồn tại như đã hoàn thành.

**Kết quả:** repository có thể được reviewer clone, chạy và đánh giá trong
10–15 phút.

## 5. P1 — nên làm nếu còn thời gian/ngân sách

### P1.1 Vận hành tối thiểu

- Tạo backup PostgreSQL thủ công trước mỗi migration lớn.
- Viết một lệnh restore vào database tạm và chạy thử ít nhất một lần.
- Bật log rotation hoặc giới hạn disk log.
- Có healthcheck và hướng dẫn xem logs/restart services.
- Thêm một uptime check đơn giản từ nền tảng hosting hoặc dịch vụ miễn phí.

Không cần Prometheus, Grafana, tracing, alert routing hay dashboard metrics
riêng cho mốc dưới 500 người.

### P1.2 Crawler an toàn và thực dụng

- Chạy crawler thủ công hoặc cron bounded với tần suất thấp.
- Giới hạn số query/result, timeout và retry.
- Không chạy live crawl trong CI.
- Kiểm tra terms, robots/access policy và chỉ dùng nguồn được phép.
- Ghi lại lần crawl cuối và trạng thái lỗi để operator biết dữ liệu có cũ không.

Không cần BullMQ hoặc worker cluster khi chưa có workload liên tục.

### P1.3 Chất lượng giao diện

- Thêm accessibility smoke cho keyboard, landmark, contrast và alt text.
- Kiểm tra responsive trên mobile thật hoặc Chromium mobile.
- Thêm custom 404, error boundary và thông báo lỗi thân thiện.
- Tối ưu ảnh và bundle nếu hosting có giới hạn bandwidth.

## 6. P2 — chỉ làm khi sản phẩm có traction

- MFA và phân quyền admin nâng cao.
- Distributed rate limiting và nhiều instance backend.
- Queue/worker supervision liên tục, metrics và alerting đầy đủ.
- Upgrade migration matrix và backup/restore rehearsal định kỳ.
- Staging environment, immutable image registry và rollback tự động.
- AI explanation có schema, evaluation Recall@K/NDCG@K và cost tracking.
- Provider thứ hai, curation workflow và freshness dashboard.
- User export/delete, retention policy và privacy workflow đầy đủ.
- Kubernetes, autoscaling, multi-region hoặc zero-downtime deployment.

Đây là phần mở rộng, **không phải điều kiện để hoàn thành portfolio MVP**.

## 7. Checklist release domain

- [ ] Dữ liệu demo đã được kiểm tra và có nguồn tham chiếu.
- [x] `npm run check` pass.
- [x] Backend/crawler/frontend tests pass.
- [x] Tất cả workspace build pass.
- [x] Production frontend image build và `nginx -t` pass.
- [x] Production secrets đã thay toàn bộ giá trị local/default.
- [x] `APP_ORIGIN` trỏ đúng domain HTTPS (`https://hoibep.site`).
- [ ] PostgreSQL/Redis/backend không có public ingress.
- [x] Migration đã chạy thành công trên database production (bao gồm `027` HNSW index).
- [x] Backup thủ công đã tạo.
- [x] Domain HTTPS, frontend, API health và semantic recommendations hoạt động.
- [x] README có live link và hướng dẫn chạy.

## 8. Ngân sách và nguyên tắc làm việc

Với mục tiêu này, nên ưu tiên hoàn thành P0 trước khi tiêu thêm cho P1/P2.
Không gọi model/API để xây các tính năng ngoài checklist. Gom các thay đổi liên
quan thành một task, chạy test một lần cuối, và chỉ mở rộng scope khi có lỗi
blocking hoặc giá trị portfolio rõ ràng.

## 9. Nguyên tắc tài liệu

- Source code và trạng thái test là căn cứ cho tính năng đã hoàn thành.
- Roadmap này là kế hoạch cho portfolio deployment, không phải enterprise plan.
- Khi một milestone hoàn tất, cập nhật roadmap và domain document liên quan.
- Giữ terminal command ASCII-only trong PowerShell và không đưa secret thật vào
  repository, issue hoặc log chia sẻ.

## 10. Tài liệu liên quan

### Recommendation scenario benchmark — 2026-10-04

- Đã thêm `scripts/benchmark-recommendation-scenarios.cjs` và
  `scripts/recommendation-scenarios.json` cho bốn scenario: pizza, món khô,
  món nước và weather + nearby. Qrels được dựng từ category và trusted
  completed menu evidence trong PostgreSQL; nearby qrels áp dụng cùng bán kính
  5 km, không tự chấm theo tên quán.
- Run thực tế 3 lượt/scenario trên Docker: 0/12 HTTP 503; p95 overall
  khoảng **5.95 s** trong run có cold-start, weather/nearby p95 **4.40 s** sau
  khi bỏ embedding round-trip khỏi weather alternatives. Pizza, món khô và món
  nước đạt Recall@10 = **1.0**; weather/nearby đạt Recall@10 = **0.2** và
  menu verified rate@10 = **0.2** với 13 trusted-menu qrels trong bán kính.
- `món nước` nay là một `dishStyle` riêng, chỉ nhận quán có trusted menu
  evidence cho món nước/broth. Weather alternatives cũng không gọi embedding:
  menu evidence và khoảng cách là tín hiệu authoritative, giảm phụ thuộc
  Ollama/provider.
- Weather/nearby coverage thấp là data-quality gate. Chỉ mở targeted menu
  evidence cho các quán/món nằm trong bán kính và có nhu cầu rõ; không mở rộng
  crawl/OCR diện rộng để bù Recall.

- [Menu Image OCR Plan](22-menu-image-ocr-plan.md) — Kế hoạch re-crawl để lấy menu
  images từ Google Maps + review photos, rồi OCR extract dishes.

### Recommendation V2 benchmark — silver-label regression (2026-09-06)

- Benchmark: `scripts/benchmark-recommendation-v2.cjs`; output artifact:
  `benchmark-recommendation-v2-output.txt`.
- Stored embeddings: **2,511** rows, model `@cf/baai/bge-m3@doc:v3`.
- Dataset: 8 silver-label queries, `K=10`; metrics: macro Recall@10 và NDCG@10.
- Pre-change baseline: `semanticWeight=1.0`, `qualityWeight=0.12` → **Recall 0.775**,
  **NDCG 0.520453**.
- Post-change best: `semanticWeight=1.2`, `qualityWeight=0.16` → **Recall 0.9125**,
  **NDCG 0.607490**.
- Main failure queries were **`quán chay`** and **`món nướng`**. Audit showed this was
  not primarily a candidate-coverage problem: there are **177** restaurants with the
  `vegetarian` category, **254** restaurants with menu dishes matching `nướng`, and
  **656** restaurants with persisted `grilled` attribute evidence. The missing signal
  was that Recommendation V2's ranking used name similarity + semantic score + quality,
  but did not give a small direct boost when a query term exactly matched a canonical
  food attribute. Added a **bounded 0.25 attribute-evidence boost** for query terms;
  this is taxonomy-generic and does not special-case any cuisine/category.
- Re-ran the same benchmark after the change. The best observed configuration is now
  **semantic=1.2, quality=0.16**, with **Recall@10=0.9125** and **NDCG@10=0.607490**;
  the previous baseline `1.0/0.12` is **0.9125 / 0.606718**. This is a material gain
  versus the previous `0.775 / 0.520453`, while higher semantic weights still degrade
  macro NDCG. Keep `1.2 / 0.16` as the new evaluation candidate, not yet a final
  production truth.
- Important evaluation caveat: the current qrels are still generated from DB evidence,
  not independently judged by humans. In particular `quán chay` has 67 qrels versus
  177 explicit vegetarian-category restaurants, so the benchmark should remain a
  directional regression suite until a small human-judged set is added.

### Recommendation quality loop — interaction signals (2026-09-10)

- **Đã làm:** migration `032_recommendation_interactions.sql` lưu interaction
  authenticated theo restaurant (`open`, `save`, `dismiss`) và hash truy vấn, không
  lưu raw query.
- **Đã làm:** `POST /api/v1/recommendations/interactions` nhận event có validation;
  frontend tự ghi nhận mở chi tiết và cất quán, lỗi tracking không làm hỏng UX.
- **Đã làm:** Recommendation V2 nhận user context trong request hiện tại và cộng
  bounded recency-decayed boost tối đa `+0.08`/`-0.08`; cursor không chứa user ID.
  Cold start và anonymous recommendation vẫn dùng ranking cũ.
- **Chưa chốt production weights:** cần thu thập đủ event rồi đánh giá save/open
  rate và NDCG trước khi tăng boost hoặc dùng dismiss rộng hơn.

### Hỏi bếp — grounding món và địa điểm (2026-09-11)

Audit thực tế cho thấy roadmap cũ đã mô tả đúng kiến trúc retrieval-first nhưng
còn thiếu một invariant quan trọng: taxonomy hợp lệ không đồng nghĩa với intent
hợp lệ. LLM có thể trả một tên món hoặc quận có thật nhưng không xuất hiện trong
câu hỏi; nếu dùng ngay làm hard filter, recommendation sẽ sai món hoặc sai khu
vực.

Đã triển khai:

- `AiIntentService` chỉ canonicalize món khi tên món (sau normalize) có bằng
  chứng lexical trong câu hỏi gốc. Menu match toàn hệ thống một mình không đủ.
- Địa điểm parse deterministic từ câu hỏi được ưu tiên. Địa điểm do LLM trả chỉ
  được dùng khi có mặt trong câu hỏi; nếu không thì bỏ qua thay vì âm thầm lọc
  sang quận khác.
- Thêm regression tests cho món AI không được hỏi, quận AI không xuất hiện và
  quận xuất hiện đúng trong câu hỏi.

Roadmap tiếp theo để chốt chất lượng:

1. P0 — giữ các grounding invariant trên mọi thay đổi intent/retrieval; không
   cho fallback bỏ `dishQueries`, `district` hoặc filter người dùng chọn rõ.
2. P0 — bổ sung bộ human-judged queries tối thiểu 30 câu, mỗi câu có expected
   dish/location và đánh giá Recall@5, location compliance@5, dish precision@5.
3. P1 — hiển thị “Bếp hiểu” từ các filter đã được ground, không hiển thị claim
   do AI suy đoán và bị loại.
4. P1 — log aggregate lý do loại intent (ungrounded dish/district, provider
   fallback) để tuning prompt và data mà không lưu raw query.

Definition of done cho lỗi hiện tại: với mọi query có tên món hoặc địa điểm rõ,
100% top-k candidate phải thỏa hard constraint tương ứng; với intent AI không có
evidence từ câu hỏi, hệ thống không được tạo hard constraint mới.

### OCR/source gate — khi nào cần chạy OCR menu

#### Quy tắc exact dish (bắt buộc)

Recommendation không được coi `phở`, `bún`, `cơm`, `mì` hoặc `món chay` là
tên món cuối cùng. Đây chỉ là nhóm/taxonomy để lọc thô. Tên món dùng để
recommend phải giữ ở mức cụ thể, ví dụ `bún bò Huế`, `cơm tấm sườn`, `bánh canh
cua`, `lẩu bò`.

Discovery mặc định phải crawl theo **món cụ thể → quán**. Crawl theo `quán ăn`,
`cơm`, `bún phở` hoặc category chỉ dùng cho maintenance/backfill và không tự
tạo dish evidence. Một dish chỉ được dùng làm hard recommendation evidence
khi có menu OCR hoặc nguồn menu trực tiếp đã xác thực, ví dụ catalog sản phẩm
chính thức của quán. Category/name/review chỉ là tín hiệu phụ để ưu tiên quán
cần OCR.

Sau mỗi batch exact-dish: cache ảnh trước khi OCR, OCR menu bằng Ollama, audit
coverage theo từng món cụ thể, rồi chỉ mở rộng món có coverage thấp hoặc có nhu
cầu thực tế.

Dataset hiện tại được thu thập chủ yếu theo **quán/category**, chưa phải theo
**món → quán**. Vì vậy category, tên quán, review hoặc embedding không đủ để
khẳng định quán có bán một món cụ thể.

Chỉ yêu cầu chạy OCR menu khi có đủ cả hai điều kiện:

- Query có món cụ thể, ví dụ `bún bò Huế`, `cơm tấm sườn`, `pizza hải sản`;
- Candidate phù hợp bị thiếu `dish_evidence.evidence_type = 'menu_image'`, hoặc
  số quán có menu evidence cho món đó quá thấp để đạt mục tiêu Recall@K.

Không cần OCR ngay cho query nhóm rộng như `quán chay`, `món nướng`, `cà phê`
nếu category/attribute evidence đã đủ. Với query cụ thể nhưng chưa có evidence,
Bếp phải báo “chưa đủ dữ liệu menu để xác nhận món này” và ghi rõ danh sách quán
cần bổ sung OCR; không được biến tên quán/category thành bằng chứng món.

Quy trình vận hành:

1. Chạy audit query món và xác định restaurant/dish coverage thiếu.
2. Ưu tiên ingest catalog/menu trực tiếp từ website chính thức; chỉ OCR các
   quán/ảnh menu thiếu evidence, ưu tiên query có nhu cầu hoặc traffic cao.
3. Rebuild `restaurant_food_profile` và refresh embedding sau khi OCR.
4. Chạy lại benchmark dish precision/Recall@K trước khi mở rộng phạm vi OCR.

Đây là một data-quality gate của recommendation, không phải lỗi ranking. Khi
audit hoặc benchmark phát hiện query cụ thể không đủ menu evidence, mình sẽ báo
bạn trước khi cần chạy lệnh OCR.

### Dish-first ranking — đã triển khai (2026-09-11)

- Query món cụ thể dùng `dish_evidence` để tạo candidate trước; quán không có
  menu/source evidence phù hợp không được lọt vào hard result set.
- Trong nhóm candidate hợp lệ, confidence và số evidence menu được ưu tiên.
- `restaurant_food_profile` chỉ đóng vai trò bounded tie-break dựa trên profile
  `ready` và evidence coverage; profile không thể tạo ra món mà quán chưa có.
- Sau khi bổ sung OCR, cần rebuild profile và refresh embedding để profile mới
  phản ánh món vừa phát hiện.

### Weather intent evaluation — mưa/lạnh (2026-09-11)

Đã kiểm tra query mẫu: `Hiện tại trời đang mưa, tôi muốn tìm món gì đó phù hợp
với thời tiết này`.

- Parser chuyển đúng thành comfort intent `nóng` và semantic query `món nóng ấm
bụng`.
- Các từ thời tiết, filler và câu hỏi meta không còn bị đưa nguyên cụm vào
  keyword search.
- Vì đây là query nhóm rộng, không cần OCR từng món trước. Chất lượng phụ thuộc
  vào coverage của food attributes/profile và semantic embeddings.
- Chưa thể chấm top-k restaurant live khi database local chưa chạy; cần chạy
  API trên database thật rồi audit 10 kết quả đầu theo: có món nóng/ấm, category
  phù hợp, khoảng cách nếu có location, và không có quán chỉ match do chữ `mưa`.

Tiêu chí đạt: ít nhất 8/10 kết quả phù hợp ngữ cảnh món nóng/ấm; không có
candidate được chọn chỉ vì chứa từ thời tiết; nếu muốn đề xuất món cụ thể trong
card thì món đó phải có menu evidence, nếu không chỉ được mô tả là nhóm món.

### Weather retrieval + performance pass (2026-10-06)

Đã triển khai tiếp:

- Shortlist weather được giữ ở mức món cụ thể có tính ấm/nóng: `bún bò Huế`,
  `phở bò`, `phở gà`, `bún riêu`, `lẩu bò`, `bánh canh cua`, `bún cá`, `hủ
  tiếu`, `cháo`; loại `cơm tấm` khỏi shortlist mặc định vì làm nhiễu intent
  “trời mưa/ấm bụng”.
- Nhánh `weather_candidates` dùng chung CTE `nearby_restaurants` khi user bật
  bán kính, nên không còn quét toàn bộ catalog trước khi lọc địa điểm.
- Prompt weather thuần đã được parser deterministic xử lý, không gọi AI round
  trip; AI chỉ giữ lại cho câu có điều kiện mơ hồ hoặc giá/rating/khu vực/mở cửa.
- Thêm regression test cho nearby candidate CTE và weather-only AI bypass.

Benchmark local 2026-10-06, 5 request/scenario, K=10:

| Scenario | p95 | Recall@10 | Verified menu@10 | HTTP 503 |
|---|---:|---:|---:|---:|
| pizza | 115 ms | 1.00 | n/a | 0 |
| món khô | 16 ms | 1.00 | 1.00 | 0 |
| món nước | 10 ms | 1.00 | 1.00 | 0 |
| mưa + gần tôi | 114 ms | 0.90 | 0.90 | 0 |

Kết luận: retrieval và latency đã đạt mức có thể tiếp tục test/deploy local. Phần
còn thiếu là coverage menu cho các món cụ thể; chỉ chạy OCR có mục tiêu cho món
hoặc quán mà audit cho thấy thiếu evidence, không chạy lại OCR toàn bộ ảnh.

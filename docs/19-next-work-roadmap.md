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

### Đã hoàn thành

- Backend, crawler và frontend typecheck pass.
- Backend tests: 46/46 pass.
- Crawler tests: 38/38 pass.
- Frontend unit tests: 22/22 pass.
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

- [Menu Image OCR Plan](22-menu-image-ocr-plan.md) — Kế hoạch re-crawl để lấy menu
  images từ Google Maps + review photos, rồi OCR extract dishes.

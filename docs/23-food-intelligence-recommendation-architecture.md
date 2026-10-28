# Food Intelligence & Recommendation Architecture

## 1. Mục tiêu

Xây dựng lớp **Food Intelligence** biến dữ liệu thô của nhà hàng thành knowledge base có bằng chứng, sau đó dùng knowledge base này cho search, discovery và Recommendation V2.

Nguyên tắc cốt lõi:

> Restaurant profile là một đối tượng được suy ra từ evidence. Semantic profile, embedding và explanation chỉ được tạo sau khi evidence đã được chuẩn hóa.

Hệ thống không được "bịa" thuộc tính món ăn hoặc nhà hàng khi không có evidence đủ mạnh.

### Trạng thái triển khai hiện tại

- Exact dish là hard constraint: chỉ nhận `dish.status = available` với
  `dish_evidence.evidence_type = menu_image` và extraction đã `completed`.
- Raw OCR bị đánh dấu `food_photo:` hoặc có dấu hiệu template/repetition sẽ bị
  quarantine, không được dùng làm menu truth. Đây là lớp bảo vệ bắt buộc vì OCR
  lỗi có thể chèn cùng một nhóm món vào nhiều quán không liên quan.
- Weather intent như “trời mưa” chỉ trả các món cụ thể trong shortlist có menu
  evidence đáng tin và áp bán kính mặc định 5 km khi có GPS. Nếu evidence không
  đủ, hệ thống phải thiếu kết quả hoặc yêu cầu OCR mục tiêu, không fallback về
  tên quán/category.

### Runtime grounding invariant

Evidence từ catalog chỉ xác nhận rằng một món/quận tồn tại; nó không xác nhận
người dùng đang yêu cầu món/quận đó. Vì vậy runtime phải thỏa cả hai điều kiện:

1. Intent phải được ground vào câu hỏi gốc (lexical evidence sau normalize), và
2. Giá trị phải được resolve vào taxonomy/menu/location canonical.

LLM không được tự thêm món hoặc địa điểm thành hard filter chỉ vì giá trị đó hợp
lệ trong database. Khi thiếu evidence từ câu hỏi, giá trị chỉ có thể bị loại
hoặc dùng ở mức ranking mềm; không được làm giảm candidate set.

### Menu coverage gate

Dữ liệu được crawl theo restaurant/category không chứng minh restaurant có một
món cụ thể. Dish recommendation chỉ được xem là đã đủ dữ liệu khi dish row có
evidence menu image với confidence đạt ngưỡng; name/category/review/embedding
chỉ là tín hiệu discovery, không thay thế menu evidence.

Nếu query là món cụ thể và coverage menu evidence không đạt ngưỡng vận hành,
pipeline phải trả trạng thái thiếu dữ liệu để operator chạy OCR có mục tiêu. OCR
không cần chạy toàn bộ catalog cho query nhóm rộng khi category hoặc attribute
evidence đã đủ. Sau OCR cần rebuild food profile và re-embed các restaurant bị
thay đổi.

### Weather/nearby recommendation

Với câu như “trời đang mưa, tìm món phù hợp”, intent được chuẩn hóa thành món
nóng/ấm bụng. Frontend có thể tự bật filter “gần đây” (mặc định 5 km khi đã
có GPS), nhưng đây là filter có thể tắt; backend chỉ áp bán kính khi client
gửi `radiusMeters` hoặc người dùng nói rõ “gần đây”. Nếu client chỉ gửi GPS
mà không gửi bán kính, backend tìm như bình thường và chỉ dùng khoảng cách
như một boost có giới hạn. Với weather intent, inferred taste không bị nới
lỏng khi trang semantic thiếu kết quả; nếu không làm vậy hệ thống dễ rơi về
các quán được đánh giá cao nhưng không có evidence món nóng.

Nếu kết quả cụ thể cần tên món và quán chưa có menu evidence đáng tin cậy, cần
báo operator chạy OCR menu image của đúng quán đó; không lấy category, tên quán,
review hoặc ảnh món ăn làm bằng chứng thay thế.

## 2. Evidence-based Restaurant Food Profile

Mỗi nhà hàng có một Food Profile tổng hợp từ nhiều nguồn:

- Menu OCR: tên món, giá, mô tả và category có thể quan sát được.
- Review: opinion, sentiment, món được nhắc đến, đặc điểm được người dùng mô tả.
- Metadata hiện có: loại hình, vị trí, giá và các thuộc tính có nguồn rõ ràng.
- Dish evidence: liên kết từ một fact/profile về evidence gốc.

Profile cần giữ được:

- fact/value đã chuẩn hóa;
- source và source record;
- confidence;
- extraction method/model version;
- thời điểm phát hiện;
- provenance để truy ngược evidence.

## 3. OCR: từ ảnh đến facts, không chỉ text

Pipeline OCR/Vision trong `22-menu-image-ocr-plan.md` là lớp thu thập evidence.

Flow mở rộng:

```text
restaurant_image
  -> classify isMenu
  -> OCR/extract raw text
  -> parse dish candidates
  -> normalize dish/category/price
  -> persist dish facts + evidence
  -> invalidate derived restaurant profile
```

Raw OCR phải được giữ để audit. Normalized facts là dữ liệu dùng cho intelligence layer. Không dùng trực tiếp text OCR chưa chuẩn hóa làm recommendation truth.

## 4. Review Intelligence: Opinion khác Fact

Review có giá trị lớn nhưng bản chất là subjective evidence.

Ví dụ:

- "phở ngon" -> positive opinion về dish candidate `phở`;
- "nước dùng đậm đà" -> flavor characteristic opinion;
- "phục vụ chậm" -> service opinion;
- "có bán bún bò" -> chỉ trở thành availability fact khi confidence/provenance policy cho phép.

Do đó cần tách:

- **facts**: menu/metadata hoặc assertion đã được xác thực theo policy;
- **opinions**: review-derived sentiment/claims;
- **derived signals**: aggregate score được tính từ nhiều evidence.

Review extraction nên lưu entity mention, aspect, sentiment, confidence và evidence reference thay vì ghi đè profile bằng một review đơn lẻ.

## 5. Dish Intelligence

Dish là entity trung tâm để nối menu, review và recommendation.

### Canonical dish

Một canonical dish có thể chứa:

- canonical name;
- aliases;
- cuisine/category;
- ingredient/flavor/style tags khi có evidence;
- embedding hoặc semantic representation;
- confidence/provenance cho derived attributes.

### Restaurant dish offering

Quan hệ nhà hàng - món cần độc lập với canonical dish:

```text
Restaurant -> offers -> RestaurantDish -> canonical Dish
```

`RestaurantDish` giữ các dữ liệu phụ thuộc vào quán như:

- tên hiển thị trên menu;
- giá;
- description;
- availability/evidence status;
- source image/review evidence.

Nhờ vậy cùng một món có thể xuất hiện ở nhiều quán với cách gọi và evidence khác nhau.

## 6. Knowledge Graph trên PostgreSQL

Không cần graph database riêng ở giai đoạn hiện tại. PostgreSQL có thể biểu diễn graph bằng bảng entity/relation rõ ràng, kết hợp PostGIS và pgvector.

Các node chính:

- Restaurant
- Dish
- RestaurantDish
- Ingredient
- Cuisine
- Category
- Attribute/Flavor
- Evidence
- Review

Các relation ví dụ:

```text
Restaurant --OFFERS--> RestaurantDish --CANONICAL_IS--> Dish
Dish --HAS_INGREDIENT--> Ingredient
Dish --BELONGS_TO--> Category
Dish --HAS_ATTRIBUTE--> Attribute
Review --MENTIONS--> Dish
Evidence --SUPPORTS--> RestaurantDish/Fact/Attribute
```

Relation phải có metadata tối thiểu: source, confidence, created_at và provenance/evidence reference khi applicable.

## 7. Derived Restaurant Profile

Restaurant Food Profile là materialized/derived view từ graph và evidence, ví dụ:

- signature dishes;
- cuisine/category distribution;
- price distribution;
- flavor/style signals;
- frequently praised dishes;
- evidence coverage/confidence;
- semantic summary.

Nên có version/invalidation strategy:

1. Evidence mới được persist.
2. Mark restaurant profile stale.
3. Recompute deterministic profile facts.
4. Generate semantic summary/embedding từ profile facts.
5. Publish profile version atomically.

Embedding không phải source of truth; embedding là derived index có thể rebuild.

## 8. Recommendation V2

Recommendation nên chuyển từ similarity đơn giản sang multi-signal ranking.

### Candidate generation

Tạo candidate từ nhiều nguồn:

- geographic proximity;
- dish overlap;
- cuisine/category similarity;
- semantic similarity;
- popularity/quality signals;
- user history/preferences.

Đối với query món cụ thể, thứ tự bắt buộc là **dish-first**: tìm restaurant dish
đã có menu/source evidence, loại candidate không chứng minh được món, rồi mới
dùng restaurant profile để xếp hạng các quán còn lại. Profile không được tạo ra
candidate món mới.

### Ranking

Điểm cuối là tổ hợp có trọng số và policy rõ ràng:

```text
score =
  w_dish * dish_match
+ w_semantic * semantic_similarity
+ w_context * context_match
+ w_personal * personalization
+ w_quality * quality_signal
+ w_distance * distance_score
- penalties
```

Weights nên versioned/configurable để evaluation và A/B tuning sau này.

Trong Recommendation V2 hiện tại, menu evidence có confidence/số lần xuất hiện
được cộng một bounded boost cho dish candidate; `restaurant_food_profile` chỉ
được dùng như bounded tie-break dựa trên trạng thái `ready` và evidence coverage.
Nhờ vậy quán có đúng món từ menu được ưu tiên, sau đó rating/review/location và
profile mới quyết định quán nào tốt hơn.

Mọi surface hiển thị món cho người dùng (`/dishes`, chi tiết nhà hàng và món
trong profile) cũng phải dùng cùng trusted-menu gate. Dish được suy ra từ tên
quán, category hoặc review có thể tồn tại để audit/enrichment nhưng không được
hiển thị như món đang bán và không được dùng làm recommendation truth.

## 9. Context-aware Recommendation

Context không chỉ là location. Recommendation request có thể mang:

- current location;
- time/day;
- meal context;
- party size;
- budget;
- intent: quick meal, discovery, specific dish, family/group;
- optional dietary constraints.

Context chỉ thay đổi ranking khi có evidence phù hợp; không suy đoán quá mức từ dữ liệu thiếu.

## 10. Personalization

Personalization dùng explicit và implicit signals.

### Explicit

- saved restaurants;
- favorite dishes/cuisines;
- budget preferences;
- dietary preferences;
- declared dislikes.

### Implicit

- viewed/clicked restaurants;
- searches;
- saves;
- recommendation interactions.

Cold start phải graceful: fallback về context + evidence-based popularity/similarity thay vì yêu cầu profile cá nhân hoàn chỉnh.

## 11. Explainable Recommendations

Mỗi recommendation nên trả về explanation được tạo từ ranking evidence, ví dụ:

- "Có nhiều món tương tự những món bạn đã lưu".
- "Phù hợp với món bạn đang tìm".
- "Gần vị trí hiện tại và có nhiều evidence về ...".

Explanation phải trace được về signals thực tế. Không dùng LLM tạo lý do độc lập với ranking data.

API nên trả về structured explanation codes/data trước; UI/LLM wording chỉ là presentation layer.

## 12. Data Quality & Confidence

Mọi pipeline extraction cần có:

- normalization status;
- confidence;
- source;
- model/prompt version khi AI-generated;
- deduplication policy;
- reprocessing capability.

Conflict resolution ưu tiên evidence quality/recency theo policy. Evidence yếu không được silently overwrite evidence mạnh.

## 13. Suggested Implementation Phases

### Phase 1 — Foundation

- Hoàn tất menu image OCR.
- Chuẩn hóa `dish` và `dish_evidence`.
- Thêm provenance/confidence fields còn thiếu.
- Xây dựng canonical dish/alias normalization.

### Phase 2 — Review Intelligence

- Extract dish/aspect mentions từ reviews.
- Persist opinion signals tách khỏi facts.
- Aggregate praise/complaint signals theo dish/restaurant.

### Phase 3 — Food Profile

- Xây dựng deterministic profile builder.
- Profile invalidation + versioning.
- Semantic embedding chỉ chạy sau profile build.

### Phase 4 — Recommendation V2

- Multi-source candidate generation.
- Multi-signal ranking.
- Context-aware filters/signals.
- Structured explanations.

### Phase 5 — Personalization & Evaluation

- Explicit preference model.
- Event collection tối thiểu.
- Offline evaluation metrics.
- Weight tuning và experiment framework nếu traffic đủ.

## 14. Success Criteria

Food Intelligence được xem là đạt yêu cầu khi:

1. Mỗi important profile claim có provenance hoặc được đánh dấu derived rõ ràng.
2. Menu OCR và review opinions không bị trộn thành cùng một loại truth.
3. Dish entities được canonicalize nhưng vẫn giữ raw restaurant-specific representation.
4. Profile và embedding có thể rebuild từ persisted evidence.
5. Recommendation V2 có thể giải thích bằng ranking signals thực tế.
6. Thiếu personalization vẫn có recommendation hữu ích.
7. PostgreSQL/PostGIS/pgvector tiếp tục là nền tảng phù hợp cho quy mô portfolio/early product.

## 15. Architectural Boundary

Architecture này mở rộng các tài liệu hiện có, đặc biệt:

- `08-ai-recommendation-system.md`
- `18-food-discovery-design-strategy.md`
- `22-menu-image-ocr-plan.md`
- `19-next-work-roadmap.md`

`22-menu-image-ocr-plan.md` vẫn là execution plan cho image ingestion/OCR. Tài liệu này định nghĩa lớp intelligence phía trên OCR và là hướng kiến trúc cho Recommendation V2.

## 16. Exact dish variants and trusted profile inputs

Exact dish retrieval may match a verified concrete menu variant whose normalized
name starts with the requested dish family, for example `phở gà tô đặc biệt`
for a query `phở gà`. This is a bounded prefix match, not fuzzy similarity, and
still requires completed menu evidence.

Restaurant food profiles and embeddings must use only trusted menu evidence:
`website:menu:v1` or `google_maps:menu-curated:v1`. Raw vision/OCR rows remain
auditable but must not influence exact retrieval, profile text, or semantic
ranking until they are explicitly verified.

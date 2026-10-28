# Roadmap mở rộng độ đa dạng món ăn

## Hiện trạng sau audit 2026-09-30

- 4.151 quán đang active.
- 544 dish rows đang available, thuộc 2.577 tên món/canonical identity trong toàn bộ dữ liệu.
- 422 quán có dish row; chỉ 35 quán có menu evidence tin cậy.
- Category hiện có 9 nhóm lớn: Vietnamese, Noodle, Bún, Coffee Shop, Cơm, Ăn vặt,
  Vegetarian, Dessert và Đồ uống.
- Nhóm có độ phủ tốt nhất là cơm tấm, hủ tiếu mì, lẩu bò, cơm chay và bún bò Huế.
- Nhóm thiếu evidence đáng kể: phở bò/gà, bún riêu, bún thịt nướng, bánh xèo,
  món chay, chè và các món miền vùng.

## Nguyên tắc

1. Món cụ thể chỉ được dùng làm fact recommend khi có evidence menu tin cậy.
2. Quán có tên/category phù hợp nhưng chưa có menu vẫn giữ trong candidate set,
   nhưng phải gắn nhãn chưa xác minh, không nâng thành món đã bán.
3. Ưu tiên first-party website/menu tab Google Maps trước OCR ảnh món.
4. Mỗi batch phải đo cả số món mới, số quán mới và số món bị reject/quarantine.

## Các phase tiếp theo

### P0 — Tăng coverage món chính

- Ưu tiên 16 nhóm: phở bò, phở gà, bún bò Huế, bún riêu, bún thịt nướng,
  cơm tấm, cơm gà, hủ tiếu Nam Vang, mì Quảng, lẩu bò, gà nướng,
  bánh canh cua, bánh mì thịt, bánh xèo, món chay, chè.
- Với quán có website và menu candidate: chạy ingest website, identity check,
  cache ảnh, ghi `website:menu:v1`.
- Với quán có Google Maps Menu tab nhưng chưa có evidence: refresh menu tab,
  cache ảnh, chỉ OCR ảnh đã cache và gắn nhãn menu rõ.

### P1 — Mở rộng ngoài nhóm chính

- Bánh cuốn, bánh căn, bún chả, bún cá, bò kho, vịt quay, ốc, hải sản,
  món Nhật/Hàn/Thái, món chay theo món cụ thể, chè theo từng loại.
- Mỗi nhóm cần tối thiểu 5–10 quán có evidence thật trước khi đưa vào exact-dish
  ranking mặc định.

### P2 — Chất lượng và cân bằng

- Gộp alias vào canonical dish nhưng giữ tên món gốc và giá riêng của quán.
- Giới hạn combo/promotional item không làm phình diversity giả.
- Phát hiện category imbalance: không để cơm tấm/lẩu bò chiếm phần lớn kết quả.
- Đánh giá recommendation bằng coverage@k, diversity@k, verified-rate@k và
  khoảng cách địa lý khi bật nearby.

## Definition of done

- Mỗi nhóm P0 có ít nhất 5 quán verified và 10 món cụ thể verified.
- Không có món exact-dish nào được trả như verified nếu thiếu menu evidence.
- Candidate chưa xác minh vẫn có thể hiển thị khi người dùng cho phép, nhưng không
  được trộn lẫn với verified result.
- Sau mỗi batch có report audit và profile/embedding sync cho các quán thay đổi.

## Targeted OCR pass — 2026-10-07

- Đã audit riêng `bún cá`, `bánh canh cua`, `cháo` và `hủ tiếu`.
- Đã sửa bộ lọc candidate để không dùng `unaccent()` làm điều kiện chính;
  trước đây `cháo` bị nhập với `chảo`, làm batch OCR kéo nhầm quán bánh mì chảo.
- Đã tạo batch menu cache có provenance cho 4 món và chạy Ollama trên 31 ảnh:
  24 ảnh được xác nhận là menu, 73 dòng OCR, 0 lỗi.
- OCR candidate chưa được coi là trusted evidence. Kết quả kiểm tra cho thấy:
  `bún cá` và `hủ tiếu` bị nhiễu/đọc nhầm nhiều; chỉ có một dòng rõ cho `bánh
  canh cua` và một nhóm `cháo vịt` có thể đưa vào vòng operator review.
- Curation hiện hỗ trợ `bun-ca`, `banh-canh-cua`, `chao`, `hu-tieu`, đọc trực tiếp
  raw OCR từ manifest nhưng chỉ cho phép `--apply` với file ID do operator chọn.
  Manifest chỉ dùng dry-run, tránh tự promote hallucination.
- Trang review đã hiển thị OCR preview dưới ảnh để chọn nhanh món + giá. Coverage
  trusted chưa tăng sau batch này; đó là trạng thái đúng cho đến khi ảnh/dòng món
  được đối chiếu bằng mắt hoặc thay bằng menu first-party.

### Next action

1. Mở các batch `crawler/artifacts/dish-batches/{bun-ca,banh-canh-cua,chao,hu-tieu}/index.html`.
2. Chỉ chọn ảnh có tên món cụ thể và giá đọc rõ; bỏ các ảnh OCR nhầm menu khác,
   combo không xác định món hoặc dòng có ký tự lỗi.
3. Chạy curation bằng `selected-menu-image-ids-<dish>.txt`, sau đó audit lại
   coverage và rebuild profile/embedding cho các quán được promote.

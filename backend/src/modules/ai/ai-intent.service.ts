// Runtime intent understanding for "Hỏi bếp" (docs/08 section 7.1).
//
// `AiIntentService` translates free-form Vietnamese into a grounded, validated
// `AiIntent` using an LLM behind the OpenAI-compatible interface. The LLM only
// chooses filters from the real category taxonomy (loaded from the database);
// retrieval is always executed by `RestaurantsRepository.list` against
// canonical restaurant rows. Any provider failure, timeout, or malformed
// response degrades gracefully to `null`, so callers fall back to the
// deterministic `interpretQuery` rules.

import { Injectable, Optional } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AiIntent, CanonicalDishIntent, normalizeAiIntent, RawAiIntent } from './ai.types';
import { OpenAICompatibleAiClient } from './openai-compatible-ai.client';

const CATEGORY_CACHE_TTL_MS = 60_000;

@Injectable()
export class AiIntentService {
  private readonly client: OpenAICompatibleAiClient | null;
  private categoryCache: { expiresAt: number; slugs: Set<string> } | null = null;

  constructor(
    private readonly database: DatabaseService,
    @Optional() client?: OpenAICompatibleAiClient,
  ) {
    const apiKey = process.env.AI_API_KEY;
    this.client =
      client ??
      (apiKey
        ? new OpenAICompatibleAiClient({
            baseUrl:
              process.env.AI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai',
            apiKey,
            model: process.env.AI_MODEL ?? 'gemini-3.5-flash',
            // Keep a bad provider from holding a recommendation request for a
            // full minute. Deterministic parsing and SQL remain the fallback.
            timeoutMs: Math.min(Math.max(Number(process.env.AI_TIMEOUT_MS ?? 15_000), 1_000), 15_000),
          })
        : null);
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  async interpret(query: string): Promise<AiIntent | null> {
    if (!this.client) return null;
    try {
      const allowedSlugs = await this.validCategorySlugs();
      const system = buildIntentSystemPrompt(allowedSlugs);
      const raw = (await this.client.chatJson(system, `Câu hỏi: ${query.trim()}`)) as RawAiIntent;
      const intent = normalizeAiIntent(raw, allowedSlugs);
      // A model may return a plausible dish that was never mentioned by the
      // user. Only canonicalize dishes that are lexically grounded in the
      // original query; a global menu match alone is not evidence of intent.
      intent.canonicalDishes = await this.canonicalizeDishes(intent.dishes, query);
      return intent;
    } catch {
      return null;
    }
  }

  async validCategorySlugs(): Promise<Set<string>> {
    const now = Date.now();
    if (this.categoryCache && this.categoryCache.expiresAt > now) {
      return this.categoryCache.slugs;
    }
    const result = await this.database.query<{ slug: string }>(
      `SELECT slug FROM category WHERE is_active = true`,
    );
    const slugs = new Set(result.rows.map((row) => row.slug));
    this.categoryCache = { expiresAt: now + CATEGORY_CACHE_TTL_MS, slugs };
    return slugs;
  }

  private async canonicalizeDishes(
    dishes: string[],
    query: string,
  ): Promise<CanonicalDishIntent[]> {
    const normalizedQuery = normalizeDishText(query);
    const canonical: CanonicalDishIntent[] = [];
    for (const dish of dishes.slice(0, 4)) {
      const normalized = normalizeDishText(dish);
      if (!normalized) continue;
      if (!isDishGroundedInQuery(normalizedQuery, normalized)) continue;
      const result = await this.database.query<{
        name: string;
        normalized_name: string;
      }>(
        `SELECT COALESCE(cd.canonical_name, d.name) AS name,
                COALESCE(cd.normalized_name, d.normalized_name) AS normalized_name
           FROM dish d
           LEFT JOIN canonical_dish cd ON cd.id = d.canonical_dish_id
          WHERE d.status = 'available'
            AND EXISTS (
              SELECT 1
                FROM dish_evidence de
                JOIN menu_image_extraction mie ON mie.restaurant_image_id = de.restaurant_image_id
               WHERE de.dish_id = d.id
                 AND de.evidence_type = 'menu_image'
                 AND mie.status = 'completed'
                 AND mie.model IN ('website:menu:v1', 'website:menu-image-curated:v1', 'google_maps:menu-curated:v1')
                 AND COALESCE(mie.raw_ocr_text, '') NOT ILIKE 'food_photo:%'
            )
            AND (
              COALESCE(cd.normalized_name, d.normalized_name) = $1
              OR EXISTS (
                SELECT 1 FROM canonical_dish_alias cda
                 WHERE cda.canonical_dish_id = cd.id
                   AND cda.normalized_alias = $1
              )
            )
          ORDER BY (COALESCE(cd.normalized_name, d.normalized_name) = $1) DESC, name
          LIMIT 1`,
        [normalized],
      );
      const row = result.rows[0];
      if (!row || typeof row.name !== 'string' || typeof row.normalized_name !== 'string') continue;
      canonical.push({
        dish: row.name,
        confidence: 1,
        evidence: 'menu_evidence',
      });
    }
    return canonical.filter(
      (entry, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.dish.toLocaleLowerCase('vi-VN') === entry.dish.toLocaleLowerCase('vi-VN'),
        ) === index,
    );
  }
}

// A shorter dish family must not swallow a concrete modifier from the user:
// "phở bò tái" is not safe to canonicalize as "phở bò" unless the menu has
// evidence for the requested variant. Filler, taste, weather and location
// words are allowed around the dish phrase; food modifiers such as "tái" are
// deliberately not on this list.
function isDishGroundedInQuery(normalizedQuery: string, normalizedDish: string): boolean {
  if (!normalizedQuery.includes(normalizedDish)) return false;
  const residual = normalizedQuery
    .replace(normalizedDish, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const allowed = new Set([
    'an',
    'cho',
    'co',
    'cua',
    'dang',
    'day',
    'de',
    'di',
    'do',
    'gan',
    'gi',
    'gio',
    'goi',
    'hay',
    'hien',
    'hop',
    'khu',
    'mon',
    'muon',
    'nay',
    'nhe',
    'o',
    'phu',
    'quan',
    'tim',
    'toi',
    'troi',
    'va',
    'voi',
    'xem',
    'y',
    'thoi',
    'tiet',
    'mua',
    'lanh',
    'nong',
    'mat',
    'cay',
    'ngot',
    'man',
    'beo',
    're',
    'ngon',
    'phu',
    'hop',
  ]);
  return residual.every((token, index) => {
    if (/^\d+$/.test(token) || allowed.has(token)) return true;
    // "tại Quận 10" is location context; standalone "tái" is a dish
    // modifier and must remain a distinct intent.
    return (
      token === 'tai' &&
      (residual[index + 1] === 'quan' ||
        residual.slice(index, index + 3).join(' ') === 'tai o quan')
    );
  });
}

function normalizeDishText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildIntentSystemPrompt(allowedSlugs: ReadonlySet<string>): string {
  const slugs = [...allowedSlugs].sort().join('", "');
  return [
    'Bạn là "Bếp", trợ lý gợi ý quán ăn. Nhiệm vụ: đọc câu hỏi tiếng Việt của người dùng và chuyển nó thành MỘT object JSON thuần túy. Không markdown, không giải thích, chỉ trả JSON duy nhất.',
    'Schema JSON:',
    '{',
    '  "categories": ["slug"],',
    '  "dishes": ["tên món"],',
    '  "tastes": ["từ khẩu vị/đặc tính"],',
    '  "district": "Quận 1",',
    '  "priceLevel": 2,',
    '  "minRating": 4.0,',
    '  "openNow": true,',
    '  "distanceKm": 5,',
    '  "summary": "một câu tiếng Việt tóm tắt ngắn bếp hiểu người dùng muốn gì",',
    '  "semanticQuery": "cụm từ 2-10 từ mô tả thuần món ăn để tìm kiếm ngữ nghĩa"',
    '}',
    'Rang buộc:',
    '1. categories PHẢI lấy từ danh sách slug hợp lệ sau (chọn 0-2 mục):',
    `["${slugs}"]`,
    '2. dishes là tên món người dùng nhắc tới (ví dụ "phở bò", "bún riêu"), viết nguyên văn, không bịa.',
    '3. tastes là tính từ ngắn về cảm/khẩu vị/cách ăn (ví dụ nóng, cay, ngọt, mặn, nhẹ, nướng, chân mát).',
    '4. district dạng "Quận N" (1-12) HOẶC tên quận như "Bình Thạnh", "Gò Vấp", "Phú Nhuận", "Tân Bình", "Tân Phú", "Thủ Đức", "Bình Tân", "Hóc Môn", "Nhà Bè". Viết đúng tên (có dấu), không thêm chữ "Quận" vào tên quận. Nếu không có để null.',
    '5. priceLevel: 1 (bình dân) đến 4 (cao cấp), mặc định null nếu không xác định được.',
    '6. minRating: số thực từ 3.0 đến 5.0, nếu không có để null.',
    '7. openNow: true chỉ khi người dùng nói rõ đang mở/giờ này/mở cửa, còn lại null.',
    '8. distanceKm: 1-60. Nếu nói "gần tôi"/"gần đây" để 5, kết hợp vị trí để 3, còn lại null.',
    '9. summary: 1 câu tiếng Việt (ngắn gọn, tối đa ~20 từ) diễn giải bạn hiểu người dùng cần gì.',
    '10. semanticQuery: cụm 2-10 từ tiếng Việt mô tả CHỈ món ăn/khẩu vị/nguyên liệu/cách chế biến/cảm giác khi ăn (ví dụ "bún bò huế cay đậm đà", "món nướng thanh đạm", "hải sản tươi"). KHÔNG đưa địa điểm, quận, giá, thời gian, từ khen ngợi ("ngon", "sạch"). Dùng để nhúng vector tìm quán.',
    '11. Trường không có thông tin để null (với mảng để []). Không suy diễn thông tin không có trong câu hỏi.',
  ].join('\n');
}

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
import {
  AiIntent,
  normalizeAiIntent,
  RawAiIntent,
} from './ai.types';
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
              process.env.AI_BASE_URL ??
              'https://generativelanguage.googleapis.com/v1beta/openai',
            apiKey,
            model: process.env.AI_MODEL ?? 'gemini-3.5-flash',
            timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 15_000),
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
      const raw = (await this.client.chatJson(
        system,
        `Câu hỏi: ${query.trim()}`,
      )) as RawAiIntent;
      return normalizeAiIntent(raw, allowedSlugs);
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
    '  "summary": "một câu tiếng Việt tóm tắt ngắn bếp hiểu người dùng muốn gì"',
    '}',
    'Rang buộc:',
    '1. categories PHẢI lấy từ danh sách slug hợp lệ sau (chọn 0-2 mục):',
    `["${slugs}"]`,
    '2. dishes là tên món người dùng nhắc tới (ví dụ "phở bò", "bún riêu"), viết nguyên văn, không bịa.',
    '3. tastes là tính từ ngắn về cảm/khẩu vị/cách ăn (ví dụ nóng, cay, ngọt, mặn, nhẹ, nướng, chân mát).',
    '4. district dạng "Quận N" (1-12), nếu không có để null.',
    '5. priceLevel: 1 (bình dân) đến 4 (cao cấp), mặc định null nếu không xác định được.',
    '6. minRating: số thực từ 3.0 đến 5.0, nếu không có để null.',
    '7. openNow: true chỉ khi người dùng nói rõ đang mở/giờ này/mở cửa, còn lại null.',
    '8. distanceKm: 1-60. Nếu nói "gần tôi"/"gần đây" để 5, kết hợp vị trí để 3, còn lại null.',
    '9. summary: 1 câu tiếng Việt (ngắn gọn, tối đa ~20 từ) diễn giải bạn hiểu người dùng cần gì.',
    '10. Trường không có thông tin để null (với mảng để []). Không suy diễn thông tin không có trong câu hỏi.',
  ].join('\n');
}
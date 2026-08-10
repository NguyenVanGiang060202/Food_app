// Minimal OpenAI-compatible chat-completions client used for runtime intent
// understanding. Speaks the same `/chat/completions` JSON protocol as Gemini
// (`https://generativelanguage.googleapis.com/v1beta/openai`), OpenAI,
// OpenRouter, and SiliconFlow. The LLM returns a single JSON object; the client
// only parses and surfaces it, never trusting or logging raw secrets.

export interface AiChatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export class OpenAICompatibleAiClient {
  private readonly config: AiChatConfig;

  constructor(config: AiChatConfig) {
    this.config = config;
  }

  async chatJson(system: string, user: string): Promise<unknown> {
    const { baseUrl, apiKey, model, timeoutMs } = this.config;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`AI provider ${response.status}: ${body.slice(0, 300)}`);
      }
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('AI provider returned an empty response.');
      }
      return JSON.parse(content) as unknown;
    } finally {
      clearTimeout(timer);
    }
  }
}

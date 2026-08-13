// Embedding provider contract and an OpenAI-compatible HTTP client.
//
// docs/02 requires AI integrations behind an internal provider interface. The
// client speaks the OpenAI `/embeddings` protocol, which is also implemented by
// Gemini, SiliconFlow, OpenRouter, and local servers. Configuration comes from
// the environment:
//
//   EMBEDDING_BASE_URL     e.g. https://api.openai.com/v1
//   EMBEDDING_API_KEY      provider key (not required for --dry-run)
//   EMBEDDING_MODEL        e.g. text-embedding-3-small
//   EMBEDDING_DIMENSIONS   expected vector size (validated when set)
//
// The returned vector length is validated against the expected dimensions so a
// model/dimension mismatch is caught before rows are written.

export interface EmbeddingProvider {
  generateEmbedding(input: string): Promise<number[]>;
}

export interface EmbeddingProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions?: number;
  timeoutMs?: number;
}

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  private readonly config: EmbeddingProviderConfig;

  constructor(config: EmbeddingProviderConfig) {
    this.config = config;
  }

  async generateEmbedding(input: string): Promise<number[]> {
    const { baseUrl, apiKey, model, dimensions, timeoutMs = 60_000 } = this.config;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input,
          ...(dimensions !== undefined ? { dimensions } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`embedding provider ${response.status}: ${body.slice(0, 500)}`);
      }

      const payload = (await response.json()) as {
        data?: Array<{ embedding?: number[] }>;
      };
      const vector = payload.data?.[0]?.embedding;
      if (!Array.isArray(vector)) {
        throw new Error('embedding provider response is missing embedding data.');
      }
      if (dimensions !== undefined && vector.length !== dimensions) {
        throw new Error(
          `embedding dimension mismatch: expected ${dimensions}, got ${vector.length}.`,
        );
      }
      return vector;
    } finally {
      clearTimeout(timer);
    }
  }
}

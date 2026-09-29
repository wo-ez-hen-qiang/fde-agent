/**
 * Embedding client over any OpenAI-compatible /embeddings endpoint
 * (GLM embedding-3 by default). Kept dependency-free on purpose.
 */
export interface EmbeddingClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class EmbeddingClient {
  constructor(private readonly opts: EmbeddingClientOptions) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({ model: this.opts.model, input: texts }),
    });
    if (!res.ok) {
      throw new Error(`Embedding request failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };
    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }

  async embedOne(text: string): Promise<number[]> {
    const [vec] = await this.embed([text]);
    if (!vec) throw new Error("Embedding response was empty");
    return vec;
  }
}

/** Build the default client from env (GLM by default). */
export function embeddingClientFromEnv(env: NodeJS.ProcessEnv = process.env): EmbeddingClient {
  const provider = env.FDE_EMBEDDING_PROVIDER ?? "glm";
  const prefix = provider.toUpperCase();
  const apiKey = env[`${prefix}_API_KEY`];
  const baseUrl =
    env[`${prefix}_BASE_URL`] ??
    (provider === "glm" ? "https://open.bigmodel.cn/api/paas/v4" : undefined);
  if (!apiKey || !baseUrl) {
    throw new Error(
      `Embedding provider "${provider}" not configured (need ${prefix}_API_KEY/BASE_URL)`,
    );
  }
  return new EmbeddingClient({
    baseUrl,
    apiKey,
    model: env.FDE_EMBEDDING_MODEL ?? "embedding-3",
  });
}

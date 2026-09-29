/**
 * Text embeddings. Default is local bge-small-zh-v1.5.
 * GLM embedding-3 stays available when FDE_EMBEDDING_PROVIDER=glm.
 */
import { embedBgeDocuments, embedBgeQuery, isBgeModelId, type BgeModelId } from "./bge.js";

export interface TextEmbedder {
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
  embedOne(text: string): Promise<number[]>;
  /** Retrieval query. BGE adds the Chinese query prefix; API models do not. */
  embedQuery(text: string): Promise<number[]>;
}

export interface EmbeddingClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class EmbeddingClient implements TextEmbedder {
  readonly model: string;

  constructor(private readonly opts: EmbeddingClientOptions) {
    this.model = opts.model;
  }

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

  async embedQuery(text: string): Promise<number[]> {
    return this.embedOne(text);
  }
}

class LocalBgeEmbedder implements TextEmbedder {
  constructor(readonly model: BgeModelId) {}

  embed(texts: string[]): Promise<number[][]> {
    return embedBgeDocuments(this.model, texts);
  }

  async embedOne(text: string): Promise<number[]> {
    const [vec] = await this.embed([text]);
    if (!vec) throw new Error("Embedding response was empty");
    return vec;
  }

  embedQuery(text: string): Promise<number[]> {
    return embedBgeQuery(this.model, text);
  }
}

/** Build the embedder from env. Default is local bge-small-zh-v1.5. */
export function embeddingClientFromEnv(env: NodeJS.ProcessEnv = process.env): TextEmbedder {
  const provider = env.FDE_EMBEDDING_PROVIDER ?? "local";
  const model = env.FDE_EMBEDDING_MODEL ?? "bge-small-zh-v1.5";
  if (provider === "local" || provider === "bge") {
    if (!isBgeModelId(model)) {
      throw new Error(
        `Unknown local embedding model "${model}". Use bge-small-zh-v1.5, bge-base-zh-v1.5, or bge-large-zh-v1.5.`,
      );
    }
    return new LocalBgeEmbedder(model);
  }
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
    model,
  });
}

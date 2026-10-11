/**
 * Embedding client. OpenAI-compatible `/embeddings` endpoint, selected by
 * the FDE_EMBEDDING_* env trio so the provider stays a config concern.
 */

export interface EmbeddingClient {
  /** Model name recorded on the knowledge base (a KB never mixes models). */
  readonly model: string;
  /** Expected vector dimensions; every returned vector must match it. */
  readonly dims: number;
  /** Max characters per chunk this model accepts; undefined = unbounded. */
  readonly maxInputChars?: number;
  /** Embed a batch of texts; returns one vector per input, in order. */
  embed(texts: string[]): Promise<number[][]>;
}

interface ProviderEmbeddingEnv {
  apiKey: string;
  baseUrl: string;
  defaultBaseUrl: string;
}

const PROVIDER_ENV: Record<string, ProviderEmbeddingEnv> = {
  glm: {
    apiKey: "GLM_API_KEY",
    baseUrl: "GLM_BASE_URL",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
  },
  deepseek: {
    apiKey: "DEEPSEEK_API_KEY",
    baseUrl: "DEEPSEEK_BASE_URL",
    defaultBaseUrl: "https://api.deepseek.com",
  },
  openai: {
    apiKey: "OPENAI_API_KEY",
    baseUrl: "OPENAI_BASE_URL",
    defaultBaseUrl: "https://api.openai.com/v1",
  },
  claude: {
    apiKey: "ANTHROPIC_API_KEY",
    baseUrl: "ANTHROPIC_BASE_URL",
    defaultBaseUrl: "https://api.anthropic.com",
  },
};

const DEFAULT_DIMS = 2048;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;

interface EmbeddingResponse {
  data?: Array<{ embedding?: number[] | string }>;
}

/** HTTP failure carrying the status code so callers can decide on retrying. */
class EmbeddingHttpError extends Error {
  readonly status: number;
  constructor(status: number, statusText: string, detail: string) {
    super(`embedding 调用失败（${status} ${statusText}）：${detail.slice(0, 300)}`);
    this.status = status;
  }
}

/** Retry only on transient failures: network errors, timeouts, 429 and 5xx. */
function isRetryable(error: unknown): boolean {
  if (error instanceof EmbeddingHttpError) return error.status === 429 || error.status >= 500;
  // fetch 的网络错误是 TypeError；AbortSignal.timeout 抛 TimeoutError/AbortError。
  return (
    error instanceof TypeError ||
    (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** HTTP embedding client talking to an OpenAI-compatible endpoint. */
export class HttpEmbeddingClient implements EmbeddingClient {
  readonly model: string;
  readonly dims: number;
  readonly maxInputChars?: number;

  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(opts: {
    apiKey: string;
    baseUrl: string;
    model: string;
    dims: number;
    maxInputChars?: number;
    timeoutMs?: number;
    maxRetries?: number;
  }) {
    this.apiKey = opts.apiKey;
    this.endpoint = `${opts.baseUrl.replace(/\/+$/, "")}/embeddings`;
    this.model = opts.model;
    this.dims = opts.dims;
    this.maxInputChars = opts.maxInputChars;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (attempt > 0) await sleep(500 * 3 ** (attempt - 1)); // 500ms → 1500ms
      try {
        return await this.embedOnce(texts);
      } catch (error) {
        lastError = error;
        if (!isRetryable(error)) throw error;
      }
    }
    throw lastError;
  }

  private async embedOnce(texts: string[]): Promise<number[][]> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    // 本地/免鉴权端点不发送空的 Authorization 头。
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const res = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: this.model, input: texts }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new EmbeddingHttpError(res.status, res.statusText, detail);
    }

    const json = (await res.json()) as EmbeddingResponse;
    const rows = json.data ?? [];
    if (rows.length !== texts.length) {
      throw new Error(`embedding 返回数量不匹配：期望 ${texts.length}，实际 ${rows.length}`);
    }

    return rows.map((row, i) => {
      const raw = row.embedding;
      const vec = typeof raw === "string" ? (JSON.parse(raw) as number[]) : raw;
      if (!Array.isArray(vec) || vec.length === 0) {
        throw new Error(`第 ${i + 1} 条文本未返回有效的 embedding 向量`);
      }
      if (this.dims > 0 && vec.length !== this.dims) {
        throw new Error(
          `embedding 维度不匹配：配置 ${this.dims} 维（FDE_EMBEDDING_DIMS），模型返回 ${vec.length} 维。` +
            `请核对 FDE_EMBEDDING_MODEL 与 FDE_EMBEDDING_DIMS 是否与所选模型一致。`,
        );
      }
      return vec;
    });
  }
}

/** An embedding client that fails loudly on first use (missing credentials). */
export class UnconfiguredEmbeddingClient implements EmbeddingClient {
  readonly model: string;
  readonly dims: number;
  private readonly reason: string;

  constructor(reason: string, model: string, dims: number) {
    this.reason = reason;
    this.model = model;
    this.dims = dims;
  }

  async embed(): Promise<number[][]> {
    throw new Error(
      `embedding 未配置：${this.reason}。请在 .env 中配置 FDE_EMBEDDING_PROVIDER 对应厂商的 API Key（DeepSeek 不提供 embedding 接口，需另配 GLM / OpenAI 等）。`,
    );
  }
}

/**
 * Build an embedding client from env. Never throws at construction time so
 * the app can boot with an incomplete .env and surface the error on use.
 */
export function embeddingClientFromEnv(env: NodeJS.ProcessEnv = process.env): EmbeddingClient {
  const provider = (env.FDE_EMBEDDING_PROVIDER?.trim() || "glm").toLowerCase();
  const model = env.FDE_EMBEDDING_MODEL?.trim() || "embedding-3";
  const rawDims = Number(env.FDE_EMBEDDING_DIMS?.trim() || String(DEFAULT_DIMS));
  const dims = Number.isFinite(rawDims) && rawDims > 0 ? rawDims : DEFAULT_DIMS;

  // FDE_EMBEDDING_BASE_URL 是全局覆盖：让 embedding 端点与 LLM 网关的 *_BASE_URL 解耦
  // （两者共用同一个变量时，把 embedding 指向本地端点会连带劫持聊天流量）。
  const overrideBaseUrl = env.FDE_EMBEDDING_BASE_URL?.trim();

  const meta = PROVIDER_ENV[provider];
  if (!meta) {
    return new UnconfiguredEmbeddingClient(
      `未知的 FDE_EMBEDDING_PROVIDER "${provider}"`,
      model,
      dims,
    );
  }

  const apiKey = env[meta.apiKey]?.trim() ?? "";
  const baseUrl = overrideBaseUrl || env[meta.baseUrl]?.trim() || meta.defaultBaseUrl;
  if (!apiKey) {
    return new UnconfiguredEmbeddingClient(
      `缺少 ${meta.apiKey}（provider=${provider}）`,
      model,
      dims,
    );
  }

  const rawMaxChars = Number(env.FDE_EMBEDDING_MAX_INPUT_CHARS?.trim() || "");
  const rawTimeout = Number(env.FDE_EMBEDDING_TIMEOUT_MS?.trim() || "");

  return new HttpEmbeddingClient({
    apiKey,
    baseUrl,
    model,
    dims,
    maxInputChars: Number.isFinite(rawMaxChars) && rawMaxChars > 0 ? rawMaxChars : undefined,
    timeoutMs: Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : undefined,
  });
}

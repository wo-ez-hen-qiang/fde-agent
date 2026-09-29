/**
 * Local BGE Chinese embeddings (transformers.js / ONNX).
 *
 * Current default: bge-small-zh-v1.5 (512 dims).
 * bge-base-zh-v1.5 and bge-large-zh-v1.5 are registered for a later eval:
 * switch FDE_EMBEDDING_MODEL and re-embed the knowledge base. Do not mix
 * dimensions inside one knowledge base.
 */

import path from "node:path";

/** Query prefix recommended by BAAI for retrieval. Documents are embedded as-is. */
export const BGE_QUERY_PREFIX = "为这个句子生成表示以用于检索相关文章：";

export interface BgeModelSpec {
  /** Hugging Face repo that ships ONNX weights for transformers.js. */
  repo: string;
  dimensions: number;
  /** Current default vs later technical evaluation. */
  role: "current" | "eval";
}

export const BGE_MODELS = {
  "bge-small-zh-v1.5": {
    repo: "Xenova/bge-small-zh-v1.5",
    dimensions: 512,
    role: "current",
  },
  "bge-base-zh-v1.5": {
    repo: "Xenova/bge-base-zh-v1.5",
    dimensions: 768,
    role: "eval",
  },
  "bge-large-zh-v1.5": {
    repo: "Xenova/bge-large-zh-v1.5",
    dimensions: 1024,
    role: "eval",
  },
} as const satisfies Record<string, BgeModelSpec>;

export type BgeModelId = keyof typeof BGE_MODELS;

export function isBgeModelId(model: string): model is BgeModelId {
  return model in BGE_MODELS;
}

type FeatureExtractor = (
  texts: string[],
  options: { pooling: "cls"; normalize: boolean },
) => Promise<{ tolist: () => number[][] }>;

let loaded: { repo: string; extract: FeatureExtractor } | null = null;

async function extractorFor(repo: string): Promise<FeatureExtractor> {
  if (loaded?.repo === repo) return loaded.extract;
  const { pipeline, env } = await import("@huggingface/transformers");
  const cacheDir = process.env.FDE_MODEL_CACHE ?? path.join(process.cwd(), ".data", "models");
  env.cacheDir = cacheDir;
  // huggingface.co 在这台机器上会超时。HF_ENDPOINT 可改回官方或别的镜像。
  const hub = process.env.HF_ENDPOINT ?? "https://hf-mirror.com";
  env.remoteHost = hub.endsWith("/") ? hub : `${hub}/`;
  const pipe = await pipeline("feature-extraction", repo, { dtype: "q8" });
  const extract = pipe as unknown as FeatureExtractor;
  loaded = { repo, extract };
  return extract;
}

/** Embed document passages (no query prefix) so image-path tokens stay literal. */
export async function embedBgeDocuments(model: BgeModelId, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const spec = BGE_MODELS[model];
  const extract = await extractorFor(spec.repo);
  const tensor = await extract(texts, { pooling: "cls", normalize: true });
  const vectors = tensor.tolist();
  for (const vec of vectors) {
    if (vec.length !== spec.dimensions) {
      throw new Error(`bge ${model} returned ${vec.length} dims, expected ${spec.dimensions}`);
    }
  }
  return vectors;
}

export async function embedBgeQuery(model: BgeModelId, query: string): Promise<number[]> {
  const [vec] = await embedBgeDocuments(model, [BGE_QUERY_PREFIX + query]);
  if (!vec) throw new Error("BGE query embedding was empty");
  return vec;
}

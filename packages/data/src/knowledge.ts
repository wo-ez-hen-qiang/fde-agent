import { randomUUID } from "node:crypto";
import type { KnowledgeBase, KnowledgeDocument, KnowledgeSearchHit } from "@fde/shared";
import { getDb, toVectorLiteral } from "./db.js";
import type { EmbeddingClient } from "./embedding.js";
import { splitText } from "./split.js";
import type { MarkdownSplitOptions } from "./markdown-split.js";
import { splitMarkdown } from "./markdown-split.js";

/** Knowledge base CRUD + vector retrieval. */

interface KbRow {
  id: string;
  name: string;
  description: string | null;
  embedding_model: string;
  embedding_dims: number | string | null;
  created_at: number | string;
  updated_at: number | string;
  document_count?: number | string;
}

interface DocumentRow {
  id: string;
  knowledge_base_id: string;
  title: string;
  source: string;
  mime_type: string | null;
  external_id: string | null;
  content_hash: string | null;
  metadata: Record<string, unknown> | null;
  chunk_count: number | string;
  created_at: number | string;
  updated_at: number | string | null;
}

interface HitRow {
  id: string;
  knowledge_base_id: string;
  document_id: string;
  content: string;
  ordinal: number | string;
  document_title: string;
  score: number | string;
}

function toKb(row: KbRow): KnowledgeBase {
  const dims =
    row.embedding_dims === null || row.embedding_dims === undefined
      ? undefined
      : Number(row.embedding_dims);
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    embeddingModel: row.embedding_model,
    embeddingDims: dims && dims > 0 ? dims : undefined,
    documentCount: Number(row.document_count ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function toDocument(row: DocumentRow): KnowledgeDocument {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledge_base_id,
    title: row.title,
    source: row.source as KnowledgeDocument["source"],
    mimeType: row.mime_type ?? undefined,
    externalId: row.external_id ?? undefined,
    contentHash: row.content_hash ?? undefined,
    metadata: row.metadata ?? undefined,
    chunkCount: Number(row.chunk_count ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: row.updated_at === null ? undefined : Number(row.updated_at),
  };
}

/**
 * 元数据的规范化比较：JSONB 不保留键顺序（读回来会被 Postgres 重排），
 * 直接 JSON.stringify 比较会把「没变」误判成「变了」，导致每次导入都 refreshed。
 */
function canonicalMetadata(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)));
}

const EMBED_BATCH = 16;
/** chunk 批量写入行数：100 行 × 6 参数 = 600 参数，远低于 PG 上限。 */
const CHUNK_INSERT_BATCH = 100;

export interface AddDocumentOptions {
  source?: KnowledgeDocument["source"];
  mimeType?: string;
  /** 幂等键：来源系统的稳定标识（如 "adp:132555"）。 */
  externalId?: string;
  /** 正文 hash；与库中一致时跳过重灌。 */
  contentHash?: string;
  metadata?: Record<string, unknown>;
  /** 切分策略；默认 "plain" 保持既有行为。 */
  splitter?: "plain" | "markdown";
  chunk?: MarkdownSplitOptions;
}

export interface UpsertOptions extends AddDocumentOptions {
  externalId: string;
  /** 忽略 hash 比对，强制重灌（换切分参数/换 embedding 后使用）。 */
  force?: boolean;
}

export interface UpsertOutcome {
  status: "created" | "updated" | "refreshed" | "skipped";
  document: KnowledgeDocument;
  chunks: number;
}

interface ChunkRow {
  content: string;
  ordinal: number;
  vector: number[];
}

export class KnowledgeStore {
  private readonly embeddings: EmbeddingClient;

  constructor(embeddings: EmbeddingClient) {
    this.embeddings = embeddings;
  }

  /** The embedding model this store writes with (recorded per KB). */
  get embeddingModel(): string {
    return this.embeddings.model;
  }

  /** 当前 embedding 配置（kb create / kb doctor 用来展示与比对）。 */
  get embeddingDims(): number {
    return this.embeddings.dims;
  }

  get maxInputChars(): number | undefined {
    return this.embeddings.maxInputChars;
  }

  async listKnowledgeBases(): Promise<KnowledgeBase[]> {
    const db = await getDb();
    const res = await db.query<KbRow>(
      `SELECT k.*, COUNT(d.id) AS document_count
       FROM knowledge_bases k
       LEFT JOIN knowledge_documents d ON d.knowledge_base_id = k.id
       GROUP BY k.id
       ORDER BY k.updated_at DESC`,
    );
    return res.rows.map(toKb);
  }

  async getKnowledgeBase(id: string): Promise<KnowledgeBase | null> {
    const db = await getDb();
    const res = await db.query<KbRow>(`SELECT * FROM knowledge_bases WHERE id = $1`, [id]);
    const row = res.rows[0];
    return row ? toKb(row) : null;
  }

  async getKnowledgeBaseByName(name: string): Promise<KnowledgeBase | null> {
    const db = await getDb();
    const res = await db.query<KbRow>(`SELECT * FROM knowledge_bases WHERE name = $1`, [name]);
    const row = res.rows[0];
    return row ? toKb(row) : null;
  }

  /**
   * 按名字建库。同名已存在时只更新描述、**不改 embedding 模型与维度**
   * （已有向量的库换模型会让检索静默失效）。
   */
  async createKnowledgeBase(name: string, description?: string): Promise<KnowledgeBase> {
    const db = await getDb();
    const now = Date.now();

    const existing = await this.getKnowledgeBaseByName(name);
    if (existing) {
      await db.query(`UPDATE knowledge_bases SET description = $2, updated_at = $3 WHERE id = $1`, [
        existing.id,
        description ?? existing.description ?? null,
        now,
      ]);
      return { ...existing, description: description ?? existing.description, updatedAt: now };
    }

    const id = randomUUID();
    await db.query(
      `INSERT INTO knowledge_bases (id, name, description, embedding_model, embedding_dims, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, name, description ?? null, this.embeddings.model, this.embeddings.dims, now, now],
    );

    const created = await this.getKnowledgeBase(id);
    if (!created) throw new Error("知识库创建失败");
    return created;
  }

  async listDocuments(knowledgeBaseId: string): Promise<KnowledgeDocument[]> {
    const db = await getDb();
    const res = await db.query<DocumentRow>(
      `SELECT * FROM knowledge_documents WHERE knowledge_base_id = $1 ORDER BY created_at DESC`,
      [knowledgeBaseId],
    );
    return res.rows.map(toDocument);
  }

  async findDocumentByExternalId(
    knowledgeBaseId: string,
    externalId: string,
  ): Promise<KnowledgeDocument | null> {
    const db = await getDb();
    const res = await db.query<DocumentRow>(
      `SELECT * FROM knowledge_documents WHERE knowledge_base_id = $1 AND external_id = $2`,
      [knowledgeBaseId, externalId],
    );
    const row = res.rows[0];
    return row ? toDocument(row) : null;
  }

  /** --prune 用：一次取回该库的 externalId → { id, contentHash }（可按前缀/来源过滤）。 */
  async listDocumentKeys(
    knowledgeBaseId: string,
    options: { prefix?: string; source?: string } = {},
  ): Promise<Map<string, { id: string; contentHash: string | null }>> {
    const db = await getDb();
    const params: unknown[] = [knowledgeBaseId];
    let sql = `SELECT external_id, id, content_hash FROM knowledge_documents
               WHERE knowledge_base_id = $1 AND external_id IS NOT NULL`;
    if (options.prefix) {
      params.push(`${options.prefix}%`);
      sql += ` AND external_id LIKE $${params.length}`;
    }
    if (options.source) {
      params.push(options.source);
      sql += ` AND source = $${params.length}`;
    }
    const res = await db.query<{ external_id: string; id: string; content_hash: string | null }>(
      sql,
      params,
    );
    const map = new Map<string, { id: string; contentHash: string | null }>();
    for (const row of res.rows) {
      map.set(row.external_id, { id: row.id, contentHash: row.content_hash });
    }
    return map;
  }

  /** 按 metadata.section 聚合（kb info 用）。 */
  async statsBySection(
    knowledgeBaseId: string,
  ): Promise<Array<{ section: string; documents: number; chunks: number }>> {
    const db = await getDb();
    const res = await db.query<{
      section: string | null;
      documents: number | string;
      chunks: number | string;
    }>(
      `SELECT COALESCE(d.metadata->>'section', '（未分类）') AS section,
              COUNT(DISTINCT d.id) AS documents,
              COUNT(c.id) AS chunks
       FROM knowledge_documents d
       LEFT JOIN knowledge_chunks c ON c.document_id = d.id
       WHERE d.knowledge_base_id = $1
       GROUP BY 1
       ORDER BY documents DESC`,
      [knowledgeBaseId],
    );
    return res.rows.map((row) => ({
      section: row.section ?? "（未分类）",
      documents: Number(row.documents),
      chunks: Number(row.chunks),
    }));
  }

  /** Ingest a document: split -> embed -> store chunks. */
  async addDocument(
    knowledgeBaseId: string,
    title: string,
    text: string,
    options: AddDocumentOptions = {},
  ): Promise<KnowledgeDocument> {
    const outcome = await this.ingest(knowledgeBaseId, title, text, options, { mode: "insert" });
    return outcome.document;
  }

  /**
   * 幂等写入：externalId 命中时按 contentHash 决定跳过 / 只刷新元数据 / 整篇替换。
   * 未命中则新建。
   */
  async upsertDocument(
    knowledgeBaseId: string,
    title: string,
    text: string,
    options: UpsertOptions,
  ): Promise<UpsertOutcome> {
    const outcome = await this.ingest(knowledgeBaseId, title, text, options, {
      mode: "upsert",
      force: options.force === true,
    });
    return outcome;
  }

  async deleteDocument(knowledgeBaseId: string, documentId: string): Promise<boolean> {
    const db = await getDb();
    const res = await db.query(
      `DELETE FROM knowledge_documents WHERE id = $1 AND knowledge_base_id = $2`,
      [documentId, knowledgeBaseId],
    );
    const removed = (res.affectedRows ?? 0) > 0;
    if (removed) {
      await db.query(`UPDATE knowledge_bases SET updated_at = $2 WHERE id = $1`, [
        knowledgeBaseId,
        Date.now(),
      ]);
    }
    return removed;
  }

  /** Cosine-similarity Top-K search. `score` is 1 - cosine distance. */
  async search(knowledgeBaseId: string, query: string, topK = 5): Promise<KnowledgeSearchHit[]> {
    console.log(
      `[PRESALES-DEMO] step 10c: KnowledgeStore.search kb=${knowledgeBaseId} topK=${topK} queryLen=${query.length}`,
    );
    const db = await getDb();
    const trimmed = query.trim();
    if (!trimmed) return [];

    // 检索前先守一致性：模型/维度不匹配时 pgvector 会报维度错，或更糟——静默返回垃圾排名。
    const kb = await this.getKnowledgeBase(knowledgeBaseId);
    if (!kb) throw new Error(`知识库不存在：${knowledgeBaseId}`);
    this.assertEmbeddingMatches(kb);

    const [queryVector] = await this.embeddings.embed([trimmed]);
    if (!queryVector) return [];

    const res = await db.query<HitRow>(
      `SELECT c.id, c.knowledge_base_id, c.document_id, c.content, c.ordinal,
              d.title AS document_title,
              1 - (c.embedding <=> $1::vector) AS score
       FROM knowledge_chunks c
       JOIN knowledge_documents d ON d.id = c.document_id
       WHERE c.knowledge_base_id = $2 AND c.embedding IS NOT NULL
       ORDER BY c.embedding <=> $1::vector ASC
       LIMIT $3`,
      [toVectorLiteral(queryVector), knowledgeBaseId, topK],
    );

    const hits = res.rows.map((row) => ({
      chunk: {
        id: row.id,
        knowledgeBaseId: row.knowledge_base_id,
        documentId: row.document_id,
        content: row.content,
        ordinal: Number(row.ordinal),
      },
      documentTitle: row.document_title,
      score: Number(row.score),
    }));
    console.log(`[PRESALES-DEMO] step 10d: KnowledgeStore.search done hits=${hits.length}`);
    return hits;
  }

  async deleteKnowledgeBase(id: string): Promise<void> {
    const db = await getDb();
    // Documents and chunks cascade.
    await db.query(`DELETE FROM knowledge_bases WHERE id = $1`, [id]);
  }

  /** 库与当前 embedding 配置必须一致（模型名 + 维度），否则检索/写入都会出问题。 */
  private assertEmbeddingMatches(kb: KnowledgeBase): void {
    if (kb.embeddingModel !== this.embeddings.model) {
      throw new Error(
        `知识库 "${kb.name}" 使用 embedding 模型 ${kb.embeddingModel}，与当前配置的 ${this.embeddings.model} 不一致（一个知识库不混用模型）`,
      );
    }
    if (kb.embeddingDims && kb.embeddingDims !== this.embeddings.dims) {
      throw new Error(
        `知识库 "${kb.name}" 使用 ${kb.embeddingDims} 维向量，当前配置是 ${this.embeddings.dims} 维（FDE_EMBEDDING_DIMS）：同一模型的不同维度不能混用`,
      );
    }
  }

  /** 切块：markdown 模式按标题层级切，plain 模式保持既有行为。 */
  private split(title: string, text: string, options: AddDocumentOptions): string[] {
    if (options.splitter === "markdown") {
      const breadcrumb = options.metadata?.breadcrumb;
      return splitMarkdown(text, options.chunk, {
        title,
        breadcrumb: typeof breadcrumb === "string" ? breadcrumb : undefined,
      }).map((chunk) => chunk.content);
    }
    return splitText(text);
  }

  private async ingest(
    knowledgeBaseId: string,
    title: string,
    text: string,
    options: AddDocumentOptions,
    mode: { mode: "insert" | "upsert"; force?: boolean },
  ): Promise<UpsertOutcome> {
    const db = await getDb();
    const chunks = this.split(title, text, options);
    if (chunks.length === 0) throw new Error("文档内容为空，无法入库");

    const kb = await this.getKnowledgeBase(knowledgeBaseId);
    if (!kb) throw new Error(`知识库不存在：${knowledgeBaseId}`);
    this.assertEmbeddingMatches(kb);

    const externalId = options.externalId;
    const existing =
      mode.mode === "upsert" && externalId
        ? await this.findDocumentByExternalId(knowledgeBaseId, externalId)
        : null;

    if (existing) {
      const sameContent =
        !mode.force && Boolean(options.contentHash) && existing.contentHash === options.contentHash;
      if (sameContent) {
        const sameMetadata =
          canonicalMetadata(existing.metadata) === canonicalMetadata(options.metadata);
        if (sameMetadata && existing.title === title) {
          return { status: "skipped", document: existing, chunks: existing.chunkCount };
        }
        const now = Date.now();
        await db.query(
          `UPDATE knowledge_documents SET title = $3, metadata = $4, updated_at = $5 WHERE id = $1 AND knowledge_base_id = $2`,
          [existing.id, knowledgeBaseId, title, JSON.stringify(options.metadata ?? {}), now],
        );
        return {
          status: "refreshed",
          document: { ...existing, title, metadata: options.metadata, updatedAt: now },
          chunks: existing.chunkCount,
        };
      }
    }

    // 向量先算完（网络调用不进事务）：失败的文档不会留下半截数据。
    const vectors: number[][] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      vectors.push(...(await this.embeddings.embed(batch)));
    }

    const now = Date.now();
    const documentId = existing?.id ?? randomUUID();
    const source = options.source ?? "manual";
    const rows: ChunkRow[] = chunks.map((content, i) => ({
      content,
      ordinal: i,
      vector: vectors[i] ?? [],
    }));

    await db.transaction(async (tx) => {
      // 替换语义：先删旧文档（chunk 级联），保证块数不翻倍。
      if (existing) {
        await tx.query(`DELETE FROM knowledge_documents WHERE id = $1`, [existing.id]);
      }
      await tx.query(
        `INSERT INTO knowledge_documents
           (id, knowledge_base_id, title, source, mime_type, external_id, content_hash, metadata, chunk_count, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          documentId,
          knowledgeBaseId,
          title,
          source,
          options.mimeType ?? null,
          externalId ?? null,
          options.contentHash ?? null,
          options.metadata ? JSON.stringify(options.metadata) : null,
          rows.length,
          existing?.createdAt ?? now,
          now,
        ],
      );
      for (let i = 0; i < rows.length; i += CHUNK_INSERT_BATCH) {
        const batch = rows.slice(i, i + CHUNK_INSERT_BATCH);
        const placeholders = batch
          .map((_, j) => {
            const base = j * 6;
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::vector)`;
          })
          .join(", ");
        const params: unknown[] = [];
        for (const row of batch) {
          params.push(
            randomUUID(),
            knowledgeBaseId,
            documentId,
            row.content,
            row.ordinal,
            toVectorLiteral(row.vector),
          );
        }
        await tx.query(
          `INSERT INTO knowledge_chunks (id, knowledge_base_id, document_id, content, ordinal, embedding)
           VALUES ${placeholders}`,
          params,
        );
      }
      await tx.query(`UPDATE knowledge_bases SET updated_at = $2 WHERE id = $1`, [
        knowledgeBaseId,
        now,
      ]);
    });

    return {
      status: existing ? "updated" : "created",
      document: {
        id: documentId,
        knowledgeBaseId,
        title,
        source,
        mimeType: options.mimeType,
        externalId,
        contentHash: options.contentHash,
        metadata: options.metadata,
        chunkCount: rows.length,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      },
      chunks: rows.length,
    };
  }
}

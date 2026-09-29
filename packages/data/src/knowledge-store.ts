import { randomUUID } from "node:crypto";
import type { KnowledgeBase, KnowledgeDocument, KnowledgeSearchHit } from "@fde/shared";
import { getDb } from "./db.js";
import type { TextEmbedder } from "./embeddings.js";
import { splitText } from "./splitter.js";

/** Knowledge base persistence + vector retrieval (pgvector on PGlite). */
export class KnowledgeStore {
  constructor(private readonly embedder: TextEmbedder) {}

  async createKnowledgeBase(name: string, description?: string): Promise<KnowledgeBase> {
    const db = await getDb();
    const id = randomUUID();
    const now = Date.now();
    const embeddingModel = process.env.FDE_EMBEDDING_MODEL ?? "bge-small-zh-v1.5";
    await db.query(
      `INSERT INTO knowledge_bases (id, name, description, embedding_model, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, name, description ?? null, embeddingModel, now, now],
    );
    return {
      id,
      name,
      description,
      embeddingModel,
      documentCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  async listKnowledgeBases(): Promise<KnowledgeBase[]> {
    const db = await getDb();
    const res = await db.query<{
      id: string;
      name: string;
      description: string | null;
      embedding_model: string;
      created_at: number;
      updated_at: number;
      doc_count: number;
    }>(
      `SELECT kb.*, COUNT(d.id)::int AS doc_count
       FROM knowledge_bases kb
       LEFT JOIN knowledge_documents d ON d.knowledge_base_id = kb.id
       GROUP BY kb.id ORDER BY kb.created_at DESC`,
    );
    return res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? undefined,
      embeddingModel: r.embedding_model,
      documentCount: r.doc_count,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    }));
  }

  /** Ingest a text document: split -> embed -> store chunks. */
  async addDocument(
    knowledgeBaseId: string,
    title: string,
    text: string,
    source: KnowledgeDocument["source"] = "manual",
  ): Promise<KnowledgeDocument> {
    const db = await getDb();
    const docId = randomUUID();
    const now = Date.now();
    const chunks = splitText(text);
    const vectors = await this.embedder.embed(chunks);

    await db.query(
      `INSERT INTO knowledge_documents (id, knowledge_base_id, title, source, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [docId, knowledgeBaseId, title, source, now],
    );
    for (let i = 0; i < chunks.length; i++) {
      const embedding = vectors[i];
      if (!embedding) throw new Error(`Missing embedding for chunk ${i}`);
      await db.query(
        `INSERT INTO knowledge_chunks (id, knowledge_base_id, document_id, content, ordinal, embedding)
         VALUES ($1, $2, $3, $4, $5, $6::vector)`,
        [randomUUID(), knowledgeBaseId, docId, chunks[i]!, i, toVectorLiteral(embedding)],
      );
    }
    await db.query(`UPDATE knowledge_bases SET updated_at = $1 WHERE id = $2`, [
      now,
      knowledgeBaseId,
    ]);
    return {
      id: docId,
      knowledgeBaseId,
      title,
      source,
      chunkCount: chunks.length,
      createdAt: now,
    };
  }

  /** Cosine-similarity search inside one knowledge base. */
  async search(knowledgeBaseId: string, query: string, topK = 5): Promise<KnowledgeSearchHit[]> {
    const db = await getDb();
    const vec = await this.embedder.embedQuery(query);
    const res = await db.query<{
      id: string;
      document_id: string;
      content: string;
      ordinal: number;
      title: string;
      score: number;
    }>(
      `SELECT c.id, c.document_id, c.content, c.ordinal, d.title,
              1 - (c.embedding <=> $1::vector) AS score
       FROM knowledge_chunks c
       JOIN knowledge_documents d ON d.id = c.document_id
       WHERE c.knowledge_base_id = $2
       ORDER BY c.embedding <=> $1::vector
       LIMIT $3`,
      [toVectorLiteral(vec), knowledgeBaseId, topK],
    );
    return res.rows.map((r) => ({
      chunk: {
        id: r.id,
        knowledgeBaseId,
        documentId: r.document_id,
        content: r.content,
        ordinal: r.ordinal,
      },
      documentTitle: r.title,
      score: r.score,
    }));
  }

  async deleteKnowledgeBase(id: string): Promise<void> {
    const db = await getDb();
    await db.query(`DELETE FROM knowledge_bases WHERE id = $1`, [id]);
  }
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

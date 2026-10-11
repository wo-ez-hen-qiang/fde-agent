/** Knowledge base domain models. */

export interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  /** Embedding model used at creation; a KB must not mix embedding models. */
  embeddingModel: string;
  /** Vector dimensions recorded at creation; empty for KBs created before this field existed. */
  embeddingDims?: number;
  documentCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeDocument {
  id: string;
  knowledgeBaseId: string;
  title: string;
  /** Source type: manual paste, file upload, ticket sync, bulk import. */
  source: "manual" | "upload" | "ticket" | "api" | "import";
  mimeType?: string;
  /** Identity at the source system (e.g. "adp:132555"); makes re-import idempotent. */
  externalId?: string;
  /** Hash of the source content; a re-import with the same hash is skipped. */
  contentHash?: string;
  /** Source-system metadata: section / breadcrumb / sourceUrl / relPath … */
  metadata?: Record<string, unknown>;
  chunkCount: number;
  createdAt: number;
  updatedAt?: number;
}

export interface KnowledgeChunk {
  id: string;
  knowledgeBaseId: string;
  documentId: string;
  content: string;
  /** Ordinal position inside the source document. */
  ordinal: number;
  embedding?: number[];
}

export interface KnowledgeSearchHit {
  chunk: KnowledgeChunk;
  documentTitle: string;
  score: number;
}

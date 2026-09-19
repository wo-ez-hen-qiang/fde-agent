/** Knowledge base domain models. */

export interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  /** Embedding model used at creation; a KB must not mix embedding models. */
  embeddingModel: string;
  documentCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeDocument {
  id: string;
  knowledgeBaseId: string;
  title: string;
  /** Source type: manual paste, file upload, ticket sync. */
  source: "manual" | "upload" | "ticket" | "api";
  mimeType?: string;
  chunkCount: number;
  createdAt: number;
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

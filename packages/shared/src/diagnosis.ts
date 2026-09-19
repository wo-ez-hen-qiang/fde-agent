/** Ticket diagnosis domain models. */

/** A support ticket to be diagnosed. */
export interface Ticket {
  id: string;
  title: string;
  description: string;
  /** Free-form labels, e.g. ["payment", "order"]. */
  tags?: string[];
  /** Raw context: logs, screenshots (as text), traces. */
  context?: string;
  reportedAt?: number;
}

/** Structured diagnosis output rendered as a card in the chat UI. */
export interface DiagnosisResult {
  ticketId?: string;
  summary: string;
  /** 问题定位 */
  location: string;
  /** 根因分析 */
  rootCause: string;
  /** 解决方案 */
  solution: string;
  /** 预防措施 */
  prevention: string;
  /** Confidence 0..1 */
  confidence: number;
  /** Knowledge chunks cited by the diagnosis. */
  references: DiagnosisReference[];
  createdAt: number;
}

export interface DiagnosisReference {
  knowledgeBaseId: string;
  documentId: string;
  documentTitle: string;
  chunkId: string;
  excerpt: string;
  score: number;
}

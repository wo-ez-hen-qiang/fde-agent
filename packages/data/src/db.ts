import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

/**
 * Embedded Postgres (PGlite) singleton.
 *
 * One data directory holds everything: chat history, knowledge bases,
 * documents and vector chunks. No external service is required.
 */

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  channel TEXT NOT NULL,
  knowledge_base_id TEXT,
  model TEXT,
  backend TEXT NOT NULL DEFAULT 'api',
  provider_session_id TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT,
  knowledge_base_id TEXT,
  usage JSONB,
  diagnosis JSONB,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS chat_messages_session_idx
  ON chat_messages (session_id, created_at);

ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS backend TEXT NOT NULL DEFAULT 'api';
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS provider_session_id TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS diagnosis JSONB;
-- 场景化：会话记录用哪个场景；消息记录产出场景与其结构化结果
-- （diagnosis 列保留给旧数据，新消息写 scenario_result）
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS scenario TEXT NOT NULL DEFAULT 'chat';
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS scenario TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS scenario_result JSONB;

CREATE TABLE IF NOT EXISTS knowledge_bases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  embedding_model TEXT NOT NULL,
  embedding_dims INTEGER,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  knowledge_base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  mime_type TEXT,
  external_id TEXT,
  content_hash TEXT,
  metadata JSONB,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  knowledge_base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  embedding vector
);

CREATE INDEX IF NOT EXISTS knowledge_chunks_kb_idx
  ON knowledge_chunks (knowledge_base_id);

-- 升级路径：老数据目录由下列语句补列（与上方 CREATE TABLE 保持等价）
ALTER TABLE knowledge_bases ADD COLUMN IF NOT EXISTS embedding_dims INTEGER;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS updated_at BIGINT;

-- 幂等键：external_id 非空才参与唯一性，手工粘贴的文档（NULL）永不冲突
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_documents_kb_external_idx
  ON knowledge_documents (knowledge_base_id, external_id) WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS knowledge_chunks_document_idx
  ON knowledge_chunks (document_id);
`;

/**
 * Resolve the data dir relative to the monorepo root, not the cwd of the app.
 * 导出给 CLI 使用：导入锁与数据目录必须落在同一处。
 */
export function resolveDataDir(): string {
  const configured = process.env.FDE_DATA_DIR?.trim() || ".data/pglite";
  if (path.isAbsolute(configured)) return configured;

  let cursor = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(path.join(cursor, "pnpm-workspace.yaml"))) {
      return path.join(cursor, configured);
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return path.join(process.cwd(), configured);
}

/**
 * 实例挂在 globalThis 而不是模块变量：Next.js 会**按路由分别打包** server 代码，
 * 同一个 `@fde/data` 在不同路由里是不同模块副本；模块级单例挡不住这件事，
 * 于是两个路由各开一个 PGlite 指向同一数据目录 → WASM 直接 Aborted（实测踩到）。
 * 挂 globalThis 保证整个进程只有一个实例（HMR 也顺带免疫）。
 */
const globalForDb = globalThis as unknown as { __fdePGlite?: Promise<PGlite> };

/**
 * 关闭共享实例并清空缓存。
 * CLI 命令结束时必须调用：PGlite 的 worker 会让事件循环不结束，进程不退出就一直占着
 * 数据目录（单写者），下一条命令会被卡住。
 */
export async function closeDb(): Promise<void> {
  const pending = globalForDb.__fdePGlite;
  if (!pending) return;
  globalForDb.__fdePGlite = undefined;
  try {
    const db = await pending;
    await db.close();
  } catch {
    /* 初始化失败或已关闭 */
  }
}

/** Get (and lazily initialize) the shared PGlite instance. */
export function getDb(): Promise<PGlite> {
  if (globalForDb.__fdePGlite) return globalForDb.__fdePGlite;

  globalForDb.__fdePGlite = (async () => {
    const dataDir = resolveDataDir();
    mkdirSync(dataDir, { recursive: true });
    const db = new PGlite({ dataDir, extensions: { vector } });
    await db.waitReady;
    await db.exec(SCHEMA);
    return db;
  })().catch((err) => {
    // Do not cache a failed init - let the next caller retry.
    globalForDb.__fdePGlite = undefined;
    throw err;
  });

  return globalForDb.__fdePGlite;
}

/** Wrap a vector as pgvector text literal: `[0.1,0.2,...]`. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

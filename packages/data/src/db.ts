import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Embedded Postgres (PGlite, WASM) - zero external services at home.
 * One database file dir holds chat history + knowledge base + vectors.
 * Swap for real Postgres later by re-implementing this module's interface.
 */
let instance: PGlite | null = null;

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'web',
  knowledge_base_id TEXT,
  model TEXT,
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
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS knowledge_bases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  embedding_model TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  knowledge_base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  mime_type TEXT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  knowledge_base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  embedding VECTOR
);
CREATE INDEX IF NOT EXISTS idx_chunks_kb ON knowledge_chunks(knowledge_base_id);

-- IM bot conversation (e.g. feishu p2p chat / group+user) -> current chat session
CREATE TABLE IF NOT EXISTS bot_conversations (
  conversation_key TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
`;

export async function getDb(dataDir?: string): Promise<PGlite> {
  if (instance) return instance;
  const dir = dataDir ?? process.env.FDE_DATA_DIR ?? path.join(process.cwd(), ".data", "pglite");
  // PGlite's mkdir is not recursive - create the data dir ourselves
  mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir, { extensions: { vector } });
  await db.waitReady;
  await db.exec("CREATE EXTENSION IF NOT EXISTS vector;");
  await db.exec(MIGRATIONS);
  instance = db;
  return db;
}

/** Test helper / shutdown. */
export async function closeDb(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
  }
}

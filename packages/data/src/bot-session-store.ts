import type { BotPlatform } from "@fde/shared";
import { getDb } from "./db.js";

/**
 * Maps an IM bot conversation key (see bot-core `botConversationKey`) to the chat
 * session currently used for it, so follow-up messages keep their context.
 */
export class BotSessionStore {
  async getSessionId(conversationKey: string): Promise<string | null> {
    const db = await getDb();
    const res = await db.query<{ session_id: string }>(
      `SELECT session_id FROM bot_conversations WHERE conversation_key = $1`,
      [conversationKey],
    );
    return res.rows[0]?.session_id ?? null;
  }

  /** Point a conversation at a (new) session; used on first message and on "/new". */
  async bind(conversationKey: string, platform: BotPlatform, sessionId: string): Promise<void> {
    const db = await getDb();
    const now = Date.now();
    await db.query(
      `INSERT INTO bot_conversations (conversation_key, platform, session_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (conversation_key) DO UPDATE SET session_id = EXCLUDED.session_id, updated_at = EXCLUDED.updated_at`,
      [conversationKey, platform, sessionId, now],
    );
  }
}

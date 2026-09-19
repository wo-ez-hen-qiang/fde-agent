/** Bot platform abstraction domain models. */

export type BotPlatform = "feishu" | "wecom";

/** Normalized inbound event produced by every bot adapter. */
export interface UnifiedBotEvent {
  platform: BotPlatform;
  /** Platform-specific event id for dedup. */
  eventId: string;
  /** chat/group id on the platform. */
  chatId: string;
  /** sender id on the platform. */
  userId: string;
  /** display name if resolvable. */
  userName?: string;
  /** plain-text content extracted from the platform payload. */
  text: string;
  /** p2p or group; group messages usually require @mention to trigger. */
  chatType: "p2p" | "group";
  /** whether the bot was @mentioned (group chats). */
  mentioned: boolean;
  /** raw platform payload, kept for debugging. */
  raw: unknown;
  receivedAt: number;
}

/** Normalized outbound message. */
export interface UnifiedBotMessage {
  chatId: string;
  /** markdown text; adapters downgrade to plain text when unsupported. */
  text: string;
  /** reply to a specific platform message id. */
  replyTo?: string;
}

/** Result of handing an event to the agent. */
export interface BotHandleResult {
  ok: boolean;
  replyText: string;
  sessionId?: string;
  error?: string;
}

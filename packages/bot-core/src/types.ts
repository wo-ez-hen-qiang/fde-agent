import type { BotPlatform, UnifiedBotEvent, UnifiedBotMessage } from "@fde/shared";

/** Framework-agnostic webhook request (adapted from Next.js/Express/CLI mock). */
export interface BotWebhookRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  /** Parsed JSON body when content-type is json; for WeCom this is the raw XML string. */
  body: unknown;
  /** Raw body string when available (needed for signature checks). */
  rawBody?: string;
  /** Query params (WeCom puts signature in the query string). */
  query?: Record<string, string | undefined>;
}

export type BotWebhookResult =
  | { kind: "challenge"; response: unknown; contentType?: string }
  | { kind: "event"; event: UnifiedBotEvent }
  | { kind: "ignored"; reason: string };

/**
 * The bot-layer abstraction. One adapter per platform; adding DingTalk etc.
 * means implementing this interface - nothing above changes.
 */
export interface BotAdapter {
  readonly platform: BotPlatform;
  /** Verify + normalize an inbound webhook. Never throws for bad input. */
  handleWebhook(req: BotWebhookRequest): Promise<BotWebhookResult>;
  /** Send a message back to the platform. */
  sendMessage(msg: UnifiedBotMessage): Promise<void>;
}

/** What the bot layer does with a normalized event (wired to the agent runtime). */
export type BotEventHandler = (
  event: UnifiedBotEvent,
) => Promise<{ replyText: string; sessionId?: string }>;

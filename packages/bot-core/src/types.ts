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
  | { kind: "ignored"; reason: string }
  /** Authenticity check failed (bad token / signature / undecryptable). Routes answer 4xx. */
  | { kind: "rejected"; reason: string; status: number };

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

/**
 * Schedules the async "run agent + reply" work after the webhook has been acked.
 * Web routes pass Next.js `after()`; the default is fire-and-forget.
 */
export type BotTaskScheduler = (task: () => Promise<void>) => void;

/** Read a header case-insensitively (Node/fetch headers are lower-cased, mocks may not be). */
export function headerValue(
  headers: BotWebhookRequest["headers"],
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

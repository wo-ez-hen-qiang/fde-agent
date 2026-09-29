import type { BotPlatform, UnifiedBotEvent } from "@fde/shared";
import { EventDeduper } from "./dedupe.js";
import type {
  BotAdapter,
  BotEventHandler,
  BotTaskScheduler,
  BotWebhookRequest,
  BotWebhookResult,
} from "./types.js";

export interface BotDispatcherOptions {
  deduper?: EventDeduper;
  /** Default scheduler for the async reply work (per-call override via dispatch()). */
  schedule?: BotTaskScheduler;
}

export interface DispatchOptions {
  schedule?: BotTaskScheduler;
}

const fireAndForget: BotTaskScheduler = (task) => {
  void task();
};

/** Fallback reply when the agent pipeline throws; never leaks internal error details. */
export const BOT_FAILURE_REPLY = "抱歉，处理这条消息时出错了，请稍后重试。";

/**
 * Stable conversation key used to map a platform chat to an agent session:
 * - p2p: one session per chat (= per user)
 * - group: one session per (group, sender), so people in the same group don't share context
 */
export function botConversationKey(event: UnifiedBotEvent): string {
  return event.chatType === "group"
    ? `${event.platform}:group:${event.chatId}:${event.userId}`
    : `${event.platform}:p2p:${event.chatId}`;
}

/**
 * Routes platform webhooks to adapters, dedups events, invokes the agent
 * handler, and sends the reply back through the same adapter.
 */
export class BotDispatcher {
  private adapters = new Map<BotPlatform, BotAdapter>();
  private readonly deduper: EventDeduper;
  private readonly schedule: BotTaskScheduler;
  private handler: BotEventHandler | null = null;

  constructor(opts: BotDispatcherOptions = {}) {
    this.deduper = opts.deduper ?? new EventDeduper();
    this.schedule = opts.schedule ?? fireAndForget;
  }

  register(adapter: BotAdapter): this {
    this.adapters.set(adapter.platform, adapter);
    return this;
  }

  has(platform: BotPlatform): boolean {
    return this.adapters.has(platform);
  }

  onEvent(handler: BotEventHandler): this {
    this.handler = handler;
    return this;
  }

  /** Entry point for web framework routes. Safe: never throws. */
  async dispatch(
    platform: BotPlatform,
    req: BotWebhookRequest,
    opts: DispatchOptions = {},
  ): Promise<BotWebhookResult> {
    const adapter = this.adapters.get(platform);
    if (!adapter) return { kind: "ignored", reason: `no adapter for ${platform}` };

    let result: BotWebhookResult;
    try {
      result = await adapter.handleWebhook(req);
    } catch (err) {
      console.error(
        `[bot-core] ${platform} webhook handling failed:`,
        err instanceof Error ? err.message : err,
      );
      return { kind: "ignored", reason: "adapter error" };
    }
    if (result.kind !== "event") return result;

    const { event } = result;
    // group chats: only respond when mentioned
    if (event.chatType === "group" && !event.mentioned) {
      return { kind: "ignored", reason: "group message without mention" };
    }
    // dedup by platform event id (platforms retry webhooks)
    if (!this.deduper.firstSeen(`${event.platform}:${event.eventId}`)) {
      return { kind: "ignored", reason: "duplicate event" };
    }

    const handler = this.handler;
    if (!handler) return { kind: "ignored", reason: "no handler wired" };

    // reply asynchronously - platforms need a fast 200 response
    (opts.schedule ?? this.schedule)(() => this.process(adapter, handler, event));
    return result;
  }

  private async process(
    adapter: BotAdapter,
    handler: BotEventHandler,
    event: UnifiedBotEvent,
  ): Promise<void> {
    let replyText: string;
    try {
      ({ replyText } = await handler(event));
    } catch (err) {
      console.error(
        `[bot-core] ${event.platform} agent handler failed:`,
        err instanceof Error ? err.message : err,
      );
      replyText = BOT_FAILURE_REPLY;
    }
    try {
      await adapter.sendMessage({
        chatId: event.chatId,
        text: replyText,
        replyTo: event.messageId,
      });
    } catch (err) {
      console.error(
        `[bot-core] ${event.platform} send reply failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

import type { BotPlatform } from "@fde/shared";
import type { BotAdapter, BotEventHandler, BotWebhookRequest, BotWebhookResult } from "./types.js";

/**
 * Routes platform webhooks to adapters, dedups events, invokes the agent
 * handler, and sends the reply back through the same adapter.
 */
export class BotDispatcher {
  private adapters = new Map<BotPlatform, BotAdapter>();
  private seenEvents = new Set<string>();
  private handler: BotEventHandler | null = null;

  register(adapter: BotAdapter): this {
    this.adapters.set(adapter.platform, adapter);
    return this;
  }

  onEvent(handler: BotEventHandler): this {
    this.handler = handler;
    return this;
  }

  /** Entry point for web framework routes. Safe: never throws. */
  async dispatch(platform: BotPlatform, req: BotWebhookRequest): Promise<BotWebhookResult> {
    const adapter = this.adapters.get(platform);
    if (!adapter) return { kind: "ignored", reason: `no adapter for ${platform}` };

    const result = await adapter.handleWebhook(req);
    if (result.kind !== "event") return result;

    const { event } = result;
    // group chats: only respond when mentioned
    if (event.chatType === "group" && !event.mentioned) {
      return { kind: "ignored", reason: "group message without mention" };
    }
    // dedup by platform event id (platforms retry webhooks)
    const dedupKey = `${event.platform}:${event.eventId}`;
    if (this.seenEvents.has(dedupKey)) {
      return { kind: "ignored", reason: "duplicate event" };
    }
    this.seenEvents.add(dedupKey);
    if (this.seenEvents.size > 10_000) this.seenEvents.clear();

    if (!this.handler) return { kind: "ignored", reason: "no handler wired" };

    // reply asynchronously - platforms need a fast 200 response
    void (async () => {
      try {
        const { replyText } = await this.handler!(event);
        await adapter.sendMessage({ chatId: event.chatId, text: replyText });
      } catch (err) {
        console.error(
          `[bot-core] handle ${platform} event failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    })();

    return result;
  }
}

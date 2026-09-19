import type { UnifiedBotEvent, UnifiedBotMessage } from "@fde/shared";
import type { BotAdapter, BotWebhookRequest, BotWebhookResult } from "./types.js";

export interface FeishuAdapterOptions {
  appId: string;
  appSecret: string;
  verificationToken?: string;
  /** Base URL for open API; use https://open.larksuite.com for international. */
  apiBase?: string;
}

/**
 * Feishu (Lark) bot adapter.
 * - URL verification handshake (url_verification)
 * - Event callback v2: im.message.receive_v1 -> UnifiedBotEvent
 * - Reply via open API with cached tenant_access_token
 */
export class FeishuAdapter implements BotAdapter {
  readonly platform = "feishu" as const;
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(private readonly opts: FeishuAdapterOptions) {}

  async handleWebhook(req: BotWebhookRequest): Promise<BotWebhookResult> {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") return { kind: "ignored", reason: "empty body" };

    // 1) URL verification handshake
    if (body.type === "url_verification") {
      if (this.opts.verificationToken && body.token !== this.opts.verificationToken) {
        return { kind: "ignored", reason: "verification token mismatch" };
      }
      return { kind: "challenge", response: { challenge: body.challenge } };
    }

    // 2) Event callback v2
    const header = body.header as
      | { event_id?: string; event_type?: string; token?: string }
      | undefined;
    if (!header?.event_type) return { kind: "ignored", reason: "not an event callback" };
    if (this.opts.verificationToken && header.token !== this.opts.verificationToken) {
      return { kind: "ignored", reason: "event token mismatch" };
    }
    if (header.event_type !== "im.message.receive_v1") {
      return { kind: "ignored", reason: `unsupported event ${header.event_type}` };
    }

    const event = body.event as {
      sender?: { sender_id?: { open_id?: string }; sender_type?: string };
      message?: {
        message_id?: string;
        chat_id?: string;
        chat_type?: string;
        message_type?: string;
        content?: string;
        mentions?: Array<{ key?: string; name?: string }>;
      };
    };
    const msg = event?.message;
    if (!msg?.message_id || !msg.chat_id) return { kind: "ignored", reason: "no message" };
    if (event.sender?.sender_type === "bot") return { kind: "ignored", reason: "from bot" };
    if (msg.message_type !== "text") return { kind: "ignored", reason: `unsupported message_type ${msg.message_type}` };

    let text = "";
    try {
      text = String(JSON.parse(msg.content ?? "{}").text ?? "").trim();
    } catch {
      return { kind: "ignored", reason: "unparseable content" };
    }
    if (!text) return { kind: "ignored", reason: "empty text" };

    const mentioned = (msg.mentions?.length ?? 0) > 0;
    // strip the @_user_1 placeholders from text
    for (const m of msg.mentions ?? []) {
      if (m.key) text = text.replace(m.key, "").trim();
    }

    const unified: UnifiedBotEvent = {
      platform: "feishu",
      eventId: header.event_id ?? msg.message_id,
      chatId: msg.chat_id,
      userId: event.sender?.sender_id?.open_id ?? "unknown",
      text,
      chatType: msg.chat_type === "group" ? "group" : "p2p",
      mentioned,
      raw: body,
      receivedAt: Date.now(),
    };
    return { kind: "event", event: unified };
  }

  async sendMessage(msg: UnifiedBotMessage): Promise<void> {
    const token = await this.tenantAccessToken();
    const base = this.opts.apiBase ?? "https://open.feishu.cn";
    const res = await fetch(`${base}/open-apis/im/v1/messages?receive_id_type=chat_id`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        receive_id: msg.chatId,
        msg_type: "text",
        content: JSON.stringify({ text: msg.text }),
      }),
    });
    if (!res.ok) {
      throw new Error(`[bot-core] feishu send failed: ${res.status} ${await res.text()}`);
    }
  }

  private async tenantAccessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 60_000) {
      return this.tokenCache.token;
    }
    const base = this.opts.apiBase ?? "https://open.feishu.cn";
    const res = await fetch(`${base}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: this.opts.appId, app_secret: this.opts.appSecret }),
    });
    const json = (await res.json()) as { code: number; tenant_access_token?: string; expire?: number; msg?: string };
    if (json.code !== 0 || !json.tenant_access_token) {
      throw new Error(`[bot-core] feishu token failed: ${json.msg ?? res.status}`);
    }
    this.tokenCache = {
      token: json.tenant_access_token,
      expiresAt: Date.now() + (json.expire ?? 7200) * 1000,
    };
    return json.tenant_access_token;
  }
}

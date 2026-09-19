import type { UnifiedBotEvent, UnifiedBotMessage } from "@fde/shared";
import type { BotAdapter, BotWebhookRequest, BotWebhookResult } from "./types.js";
import { WeComCrypto, xmlField } from "./wecom-crypto.js";

export interface WeComAppAdapterOptions {
  corpId: string;
  agentId: string;
  secret: string;
  callbackToken: string;
  callbackAesKey: string;
  apiBase?: string;
}

/**
 * WeCom (Enterprise WeChat) app callback adapter - receive + reply.
 * - GET  url verification: decrypt echostr
 * - POST encrypted message XML -> UnifiedBotEvent
 * - Reply via application message API with cached access_token
 */
export class WeComAppAdapter implements BotAdapter {
  readonly platform = "wecom" as const;
  private readonly crypto: WeComCrypto;
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(private readonly opts: WeComAppAdapterOptions) {
    this.crypto = new WeComCrypto(opts.callbackToken, opts.callbackAesKey, opts.corpId);
  }

  async handleWebhook(req: BotWebhookRequest): Promise<BotWebhookResult> {
    const q = req.query ?? {};
    const msgSignature = q.msg_signature ?? "";
    const timestamp = q.timestamp ?? "";
    const nonce = q.nonce ?? "";

    // 1) URL verification (GET): decrypt echostr and return it plain
    if (req.method === "GET") {
      const echostr = q.echostr;
      if (!echostr) return { kind: "ignored", reason: "GET without echostr" };
      if (!this.crypto.verifySignature(timestamp, nonce, echostr, msgSignature)) {
        return { kind: "ignored", reason: "signature mismatch" };
      }
      const plain = this.crypto.decrypt(echostr);
      return { kind: "challenge", response: plain, contentType: "text/plain" };
    }

    // 2) Message push (POST): body is XML with encrypted <Encrypt>
    const xml = typeof req.body === "string" ? req.body : (req.rawBody ?? "");
    if (!xml) return { kind: "ignored", reason: "empty body" };
    const encryptMsg = xmlField(xml, "Encrypt");
    if (!encryptMsg) return { kind: "ignored", reason: "no Encrypt field" };
    if (!this.crypto.verifySignature(timestamp, nonce, encryptMsg, msgSignature)) {
      return { kind: "ignored", reason: "signature mismatch" };
    }

    const inner = this.crypto.decrypt(encryptMsg);
    const msgType = xmlField(inner, "MsgType");
    if (msgType !== "text") return { kind: "ignored", reason: `unsupported MsgType ${msgType}` };

    const content = xmlField(inner, "Content")?.trim();
    const fromUser = xmlField(inner, "FromUserName") ?? "unknown";
    const msgId = xmlField(inner, "MsgId") ?? `${fromUser}:${Date.now()}`;
    if (!content) return { kind: "ignored", reason: "empty content" };

    const event: UnifiedBotEvent = {
      platform: "wecom",
      eventId: msgId,
      // app messages are 1:1; chatId = the user we reply to
      chatId: fromUser,
      userId: fromUser,
      text: content,
      chatType: "p2p",
      mentioned: true,
      raw: inner,
      receivedAt: Date.now(),
    };
    return { kind: "event", event };
  }

  async sendMessage(msg: UnifiedBotMessage): Promise<void> {
    const token = await this.accessToken();
    const base = this.opts.apiBase ?? "https://qyapi.weixin.qq.com";
    const res = await fetch(`${base}/cgi-bin/message/send?access_token=${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        touser: msg.chatId,
        msgtype: "text",
        agentid: this.opts.agentId,
        text: { content: msg.text },
      }),
    });
    const json = (await res.json()) as { errcode: number; errmsg: string };
    if (json.errcode !== 0) {
      throw new Error(`[bot-core] wecom send failed: ${json.errcode} ${json.errmsg}`);
    }
  }

  private async accessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 60_000) {
      return this.tokenCache.token;
    }
    const base = this.opts.apiBase ?? "https://qyapi.weixin.qq.com";
    const res = await fetch(
      `${base}/cgi-bin/gettoken?corpid=${this.opts.corpId}&corpsecret=${this.opts.secret}`,
    );
    const json = (await res.json()) as {
      errcode: number;
      access_token?: string;
      expires_in?: number;
      errmsg?: string;
    };
    if (json.errcode !== 0 || !json.access_token) {
      throw new Error(`[bot-core] wecom token failed: ${json.errmsg ?? res.status}`);
    }
    this.tokenCache = {
      token: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 7200) * 1000,
    };
    return json.access_token;
  }
}

/**
 * WeCom group-bot webhook pusher - send-only, zero config on our side.
 * Used for pushing diagnosis results/notifications into a group.
 */
export class WeComWebhookPusher {
  constructor(private readonly webhookKey: string) {}

  async sendText(text: string, mentionedList?: string[]): Promise<void> {
    await this.post({
      msgtype: "text",
      text: { content: text, mentioned_list: mentionedList },
    });
  }

  async sendMarkdown(markdown: string): Promise<void> {
    await this.post({ msgtype: "markdown", markdown: { content: markdown } });
  }

  private async post(payload: unknown): Promise<void> {
    const res = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${this.webhookKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const json = (await res.json()) as { errcode: number; errmsg: string };
    if (json.errcode !== 0) {
      throw new Error(`[bot-core] wecom webhook push failed: ${json.errcode} ${json.errmsg}`);
    }
  }
}

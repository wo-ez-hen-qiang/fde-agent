import type { UnifiedBotEvent, UnifiedBotMessage } from "@fde/shared";
import { FeishuCrypto } from "./feishu-crypto.js";
import { headerValue } from "./types.js";
import type { BotAdapter, BotWebhookRequest, BotWebhookResult } from "./types.js";

export const FEISHU_DEFAULT_BASE_URL = "https://open.feishu.cn";

export interface FeishuAdapterOptions {
  appId: string;
  appSecret: string;
  /** Event subscription "Verification Token"; checked against payload token when set. */
  verificationToken?: string;
  /** Event subscription "Encrypt Key"; enables AES decryption + X-Lark-Signature check. */
  encryptKey?: string;
  /** Open API base URL; https://open.larksuite.com for Lark international. */
  apiBase?: string;
  /** Bot open_id; resolved lazily via /open-apis/bot/v3/info when omitted. */
  botOpenId?: string;
  /** Injectable fetch (tests / proxies). */
  fetch?: typeof fetch;
  /** Per-request HTTP timeout, default 10s. */
  timeoutMs?: number;
}

export type FeishuConfigResult =
  { ok: true; options: FeishuAdapterOptions } | { ok: false; missing: string[] };

/**
 * Build adapter options from env vars. Requires app credentials plus at least one
 * authenticity mechanism (verification token or encrypt key) - otherwise anyone could
 * post fake events to the callback and make the bot spend model quota.
 */
export function feishuConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): FeishuConfigResult {
  const missing: string[] = [];
  if (!env.FEISHU_APP_ID) missing.push("FEISHU_APP_ID");
  if (!env.FEISHU_APP_SECRET) missing.push("FEISHU_APP_SECRET");
  if (!env.FEISHU_VERIFICATION_TOKEN && !env.FEISHU_ENCRYPT_KEY) {
    missing.push("FEISHU_VERIFICATION_TOKEN or FEISHU_ENCRYPT_KEY");
  }
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    options: {
      appId: env.FEISHU_APP_ID!,
      appSecret: env.FEISHU_APP_SECRET!,
      verificationToken: env.FEISHU_VERIFICATION_TOKEN || undefined,
      encryptKey: env.FEISHU_ENCRYPT_KEY || undefined,
      apiBase: env.FEISHU_BASE_URL || undefined,
    },
  };
}

/** Feishu text message hard limit is ~150KB; keep replies well below it. */
const MAX_REPLY_CHARS = 20_000;
/** Token refresh margin: Feishu issues a new token when <30min remain; refresh 5min early. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** Open API codes meaning "tenant_access_token invalid/expired" -> refresh and retry once. */
const TOKEN_INVALID_CODES = new Set([99991661, 99991663, 99991664, 99991668]);

interface FeishuMention {
  key?: string;
  name?: string;
  id?: { open_id?: string; union_id?: string; user_id?: string };
}

interface FeishuMessageEvent {
  sender?: { sender_id?: { open_id?: string; user_id?: string }; sender_type?: string };
  message?: {
    message_id?: string;
    root_id?: string;
    chat_id?: string;
    chat_type?: string;
    message_type?: string;
    content?: string;
    mentions?: FeishuMention[];
  };
}

interface FeishuPayload {
  type?: string;
  token?: string;
  challenge?: string;
  encrypt?: string;
  schema?: string;
  header?: { event_id?: string; event_type?: string; token?: string; app_id?: string };
  event?: FeishuMessageEvent;
}

interface OpenApiResponse {
  code?: number;
  msg?: string;
}

/**
 * Feishu (Lark) bot adapter.
 * - Encrypted events (AES-256-CBC) + X-Lark-Signature check when an encrypt key is set
 * - Verification token check, URL verification handshake (url_verification)
 * - Event callback v2: im.message.receive_v1 (text) -> UnifiedBotEvent, @mentions stripped
 * - Reply in-thread via IM open API with a cached tenant_access_token
 */
export class FeishuAdapter implements BotAdapter {
  readonly platform = "feishu" as const;
  private readonly crypto: FeishuCrypto | null;
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;
  private tokenCache: { token: string; expiresAt: number } | null = null;
  private tokenInflight: Promise<string> | null = null;
  private botOpenId: string | undefined;
  /** Next time a failed bot-info lookup may be retried (epoch ms). */
  private botInfoRetryAt = 0;

  constructor(private readonly opts: FeishuAdapterOptions) {
    this.crypto = opts.encryptKey ? new FeishuCrypto(opts.encryptKey) : null;
    this.apiBase = (opts.apiBase ?? FEISHU_DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? ((...args) => fetch(...args));
    this.botOpenId = opts.botOpenId;
  }

  async handleWebhook(req: BotWebhookRequest): Promise<BotWebhookResult> {
    const rawBody =
      req.rawBody ?? (typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? null));
    let outer: FeishuPayload | undefined;
    try {
      outer = (
        req.body && typeof req.body === "object" ? req.body : JSON.parse(rawBody)
      ) as FeishuPayload;
    } catch {
      return { kind: "rejected", reason: "invalid json body", status: 400 };
    }
    if (!outer || typeof outer !== "object") {
      return { kind: "rejected", reason: "empty body", status: 400 };
    }

    // 1) Decrypt + signature (only when an encrypt key is configured)
    let payload: FeishuPayload = outer;
    let signatureChecked = false;
    if (this.crypto) {
      if (typeof outer.encrypt !== "string") {
        return { kind: "rejected", reason: "expected encrypted payload", status: 400 };
      }
      const signature = headerValue(req.headers, "x-lark-signature");
      if (signature) {
        const timestamp = headerValue(req.headers, "x-lark-request-timestamp") ?? "";
        const nonce = headerValue(req.headers, "x-lark-request-nonce") ?? "";
        if (
          !req.rawBody ||
          !this.crypto.verifySignature(timestamp, nonce, req.rawBody, signature)
        ) {
          return { kind: "rejected", reason: "signature mismatch", status: 401 };
        }
        signatureChecked = true;
      }
      try {
        payload = JSON.parse(this.crypto.decrypt(outer.encrypt)) as FeishuPayload;
      } catch {
        return { kind: "rejected", reason: "decrypt failed", status: 400 };
      }
    } else if (typeof outer.encrypt === "string") {
      return {
        kind: "rejected",
        reason: "encrypted payload but FEISHU_ENCRYPT_KEY is not configured",
        status: 400,
      };
    }

    // 2) Verification token (v1 / url_verification: top-level token; v2: header.token)
    const token = payload.header?.token ?? payload.token;
    if (this.opts.verificationToken && token !== this.opts.verificationToken) {
      return { kind: "rejected", reason: "verification token mismatch", status: 401 };
    }

    // 3) URL verification handshake (Feishu sends it without signature headers)
    if (payload.type === "url_verification") {
      return { kind: "challenge", response: { challenge: payload.challenge } };
    }

    // Real events must be signed when an encrypt key is configured
    if (this.crypto && !signatureChecked) {
      return { kind: "rejected", reason: "missing signature headers", status: 401 };
    }

    // 4) Event callback v2
    const header = payload.header;
    if (!header?.event_type) return { kind: "ignored", reason: "not an event callback" };
    if (header.event_type !== "im.message.receive_v1") {
      return { kind: "ignored", reason: `unsupported event ${header.event_type}` };
    }
    return this.parseMessageEvent(header.event_id, payload.event, payload);
  }

  private async parseMessageEvent(
    eventId: string | undefined,
    event: FeishuMessageEvent | undefined,
    raw: unknown,
  ): Promise<BotWebhookResult> {
    const msg = event?.message;
    if (!msg?.message_id || !msg.chat_id) return { kind: "ignored", reason: "no message" };
    if (event?.sender?.sender_type && event.sender.sender_type !== "user") {
      return { kind: "ignored", reason: `from ${event.sender.sender_type}` };
    }
    if (msg.message_type !== "text") {
      return { kind: "ignored", reason: `unsupported message_type ${msg.message_type}` };
    }

    let text: string;
    try {
      const parsed = JSON.parse(msg.content ?? "{}") as { text?: unknown };
      text = typeof parsed.text === "string" ? parsed.text : "";
    } catch {
      return { kind: "ignored", reason: "unparseable content" };
    }

    const chatType = msg.chat_type === "p2p" ? "p2p" : "group";
    const mentions = msg.mentions ?? [];
    let mentioned = chatType === "p2p";
    if (mentions.length) {
      const botId = chatType === "group" ? await this.resolveBotOpenId() : this.botOpenId;
      for (const m of mentions) {
        if (!m.key) continue;
        const isBot = botId ? m.id?.open_id === botId : true;
        if (isBot) mentioned = true;
        // drop the bot's own @; keep other people as readable "@name"
        text = text.split(m.key).join(isBot ? "" : `@${m.name ?? ""}`);
      }
    }
    text = text.replace(/\s+/g, " ").trim();
    if (!text) return { kind: "ignored", reason: "empty text" };

    const unified: UnifiedBotEvent = {
      platform: "feishu",
      eventId: eventId ?? msg.message_id,
      chatId: msg.chat_id,
      userId: event?.sender?.sender_id?.open_id ?? "unknown",
      messageId: msg.message_id,
      text,
      chatType,
      mentioned,
      raw,
      receivedAt: Date.now(),
    };
    return { kind: "event", event: unified };
  }

  async sendMessage(msg: UnifiedBotMessage): Promise<void> {
    const text =
      msg.text.length > MAX_REPLY_CHARS
        ? `${msg.text.slice(0, MAX_REPLY_CHARS)}\n…（内容过长已截断）`
        : msg.text;
    const content = JSON.stringify({ text });
    const [url, body] = msg.replyTo
      ? [
          `/open-apis/im/v1/messages/${encodeURIComponent(msg.replyTo)}/reply`,
          { msg_type: "text", content },
        ]
      : [
          "/open-apis/im/v1/messages?receive_id_type=chat_id",
          { receive_id: msg.chatId, msg_type: "text", content },
        ];

    let res = await this.callOpenApi(url, body);
    if (res.code !== undefined && TOKEN_INVALID_CODES.has(res.code)) {
      this.tokenCache = null;
      res = await this.callOpenApi(url, body);
    }
    if (res.code !== 0) {
      throw new Error(`[bot-core] feishu send failed: code=${res.code} msg=${res.msg ?? ""}`);
    }
  }

  private async callOpenApi(path: string, body: unknown): Promise<OpenApiResponse> {
    const token = await this.tenantAccessToken();
    const res = await this.fetchImpl(`${this.apiBase}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
    });
    const json = (await res.json().catch(() => ({}))) as OpenApiResponse;
    return { code: json.code ?? -res.status, msg: json.msg ?? res.statusText };
  }

  /** tenant_access_token, cached until shortly before expiry; concurrent callers share one fetch. */
  async tenantAccessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return this.tokenCache.token;
    }
    this.tokenInflight ??= this.fetchTenantAccessToken().finally(() => {
      this.tokenInflight = null;
    });
    return this.tokenInflight;
  }

  private async fetchTenantAccessToken(): Promise<string> {
    const res = await this.fetchImpl(
      `${this.apiBase}/open-apis/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ app_id: this.opts.appId, app_secret: this.opts.appSecret }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      code?: number;
      tenant_access_token?: string;
      expire?: number;
      msg?: string;
    };
    if (json.code !== 0 || !json.tenant_access_token) {
      throw new Error(
        `[bot-core] feishu token failed: code=${json.code} msg=${json.msg ?? res.status}`,
      );
    }
    this.tokenCache = {
      token: json.tenant_access_token,
      expiresAt: Date.now() + (json.expire ?? 7200) * 1000,
    };
    return json.tenant_access_token;
  }

  /** Bot open_id, used to tell "@bot" apart from "@someone else" in groups. Best effort. */
  private async resolveBotOpenId(): Promise<string | undefined> {
    if (this.botOpenId || Date.now() < this.botInfoRetryAt) return this.botOpenId;
    this.botInfoRetryAt = Date.now() + 10 * 60 * 1000;
    try {
      const token = await this.tenantAccessToken();
      const res = await this.fetchImpl(`${this.apiBase}/open-apis/bot/v3/info`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
      });
      const json = (await res.json()) as { code?: number; bot?: { open_id?: string } };
      if (json.code === 0 && json.bot?.open_id) this.botOpenId = json.bot.open_id;
    } catch (err) {
      console.warn(
        "[bot-core] feishu bot info lookup failed; treating any @mention as @bot:",
        err instanceof Error ? err.message : err,
      );
    }
    return this.botOpenId;
  }
}

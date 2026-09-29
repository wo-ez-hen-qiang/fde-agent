import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FeishuAdapter, feishuConfigFromEnv } from "./feishu.js";
import { FeishuCrypto } from "./feishu-crypto.js";
import type { BotWebhookRequest } from "./types.js";

const VT = "verify-token";
const EK = "encrypt-key";
const BOT = "ou_bot";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** fetch mock: records calls and answers by URL substring. */
function mockFetch(routes: Record<string, (call: Call) => unknown>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const key = Object.keys(routes).find((k) => call.url.includes(k));
    if (!key) return new Response("not found", { status: 404 });
    return Response.json(routes[key]!(call));
  }) as typeof fetch;
  return { impl, calls };
}

const defaultRoutes = () => ({
  "/auth/v3/tenant_access_token/internal": () => ({
    code: 0,
    tenant_access_token: "t-123",
    expire: 7200,
  }),
  "/bot/v3/info": () => ({ code: 0, bot: { open_id: BOT } }),
  "/reply": () => ({ code: 0, data: {} }),
  "/open-apis/im/v1/messages?": () => ({ code: 0, data: {} }),
});

function messageEvent(opts: {
  text: string;
  chatType?: "p2p" | "group";
  mentions?: Array<{ key: string; name: string; open_id: string }>;
  eventId?: string;
  senderType?: string;
  messageType?: string;
  token?: string;
}) {
  return {
    schema: "2.0",
    header: {
      event_id: opts.eventId ?? "ev-1",
      event_type: "im.message.receive_v1",
      token: opts.token ?? VT,
      app_id: "cli_x",
    },
    event: {
      sender: { sender_id: { open_id: "ou_user" }, sender_type: opts.senderType ?? "user" },
      message: {
        message_id: "om_1",
        chat_id: "oc_chat",
        chat_type: opts.chatType ?? "p2p",
        message_type: opts.messageType ?? "text",
        content: JSON.stringify({ text: opts.text }),
        mentions: opts.mentions?.map((m) => ({
          key: m.key,
          name: m.name,
          id: { open_id: m.open_id },
        })),
      },
    },
  };
}

function plainReq(body: unknown): BotWebhookRequest {
  const rawBody = JSON.stringify(body);
  return { method: "POST", headers: {}, body, rawBody };
}

/** Encrypt + sign a payload the way Feishu does when an Encrypt Key is configured. */
function encryptedReq(payload: unknown, opts: { sign?: boolean; key?: string } = {}) {
  const crypto = new FeishuCrypto(opts.key ?? EK);
  const body = { encrypt: crypto.encrypt(JSON.stringify(payload)) };
  const rawBody = JSON.stringify(body);
  const headers: Record<string, string> = {};
  if (opts.sign !== false) {
    headers["x-lark-request-timestamp"] = "1700000000";
    headers["x-lark-request-nonce"] = "n0nce";
    headers["x-lark-signature"] = crypto.sign("1700000000", "n0nce", rawBody);
  }
  return { method: "POST", headers, body, rawBody } satisfies BotWebhookRequest;
}

describe("feishuConfigFromEnv", () => {
  it("reports missing vars", () => {
    const r = feishuConfigFromEnv({});
    assert.equal(r.ok, false);
    assert.deepEqual(!r.ok && r.missing, [
      "FEISHU_APP_ID",
      "FEISHU_APP_SECRET",
      "FEISHU_VERIFICATION_TOKEN or FEISHU_ENCRYPT_KEY",
    ]);
  });

  it("builds options, treating empty strings as unset", () => {
    const r = feishuConfigFromEnv({
      FEISHU_APP_ID: "cli_x",
      FEISHU_APP_SECRET: "s",
      FEISHU_VERIFICATION_TOKEN: VT,
      FEISHU_ENCRYPT_KEY: "",
      FEISHU_BASE_URL: "https://open.larksuite.com",
    });
    assert.ok(r.ok);
    assert.equal(r.options.encryptKey, undefined);
    assert.equal(r.options.apiBase, "https://open.larksuite.com");
  });
});

describe("FeishuAdapter.handleWebhook - plain mode", () => {
  const adapter = () =>
    new FeishuAdapter({ appId: "a", appSecret: "s", verificationToken: VT, botOpenId: BOT });

  it("answers the url_verification challenge", async () => {
    const r = await adapter().handleWebhook(
      plainReq({ type: "url_verification", token: VT, challenge: "abc" }),
    );
    assert.deepEqual(r, { kind: "challenge", response: { challenge: "abc" } });
  });

  it("rejects a challenge with the wrong token", async () => {
    const r = await adapter().handleWebhook(
      plainReq({ type: "url_verification", token: "nope", challenge: "abc" }),
    );
    assert.equal(r.kind, "rejected");
    assert.equal(r.kind === "rejected" && r.status, 401);
  });

  it("rejects events with the wrong token", async () => {
    const r = await adapter().handleWebhook(plainReq(messageEvent({ text: "hi", token: "bad" })));
    assert.equal(r.kind, "rejected");
  });

  it("rejects encrypted bodies when no encrypt key is configured", async () => {
    const r = await adapter().handleWebhook(plainReq({ encrypt: "xxx" }));
    assert.equal(r.kind, "rejected");
  });

  it("parses a p2p text message", async () => {
    const r = await adapter().handleWebhook(plainReq(messageEvent({ text: "  支付失败  " })));
    assert.equal(r.kind, "event");
    if (r.kind !== "event") return;
    assert.equal(r.event.text, "支付失败");
    assert.equal(r.event.chatType, "p2p");
    assert.equal(r.event.mentioned, true);
    assert.equal(r.event.eventId, "ev-1");
    assert.equal(r.event.messageId, "om_1");
    assert.equal(r.event.chatId, "oc_chat");
    assert.equal(r.event.userId, "ou_user");
  });

  it("strips the bot @mention in groups and keeps other people readable", async () => {
    const r = await adapter().handleWebhook(
      plainReq(
        messageEvent({
          chatType: "group",
          text: "@_user_1 帮忙看下 @_user_2 的工单",
          mentions: [
            { key: "@_user_1", name: "fde-bot", open_id: BOT },
            { key: "@_user_2", name: "张三", open_id: "ou_zs" },
          ],
        }),
      ),
    );
    assert.equal(r.kind, "event");
    if (r.kind !== "event") return;
    assert.equal(r.event.text, "帮忙看下 @张三 的工单");
    assert.equal(r.event.chatType, "group");
    assert.equal(r.event.mentioned, true);
  });

  it("marks group messages that @ someone else as not mentioned", async () => {
    const r = await adapter().handleWebhook(
      plainReq(
        messageEvent({
          chatType: "group",
          text: "@_user_1 你好",
          mentions: [{ key: "@_user_1", name: "张三", open_id: "ou_zs" }],
        }),
      ),
    );
    assert.equal(r.kind === "event" && r.event.mentioned, false);
  });

  it("resolves the bot open_id via bot/v3/info when not configured", async () => {
    const { impl, calls } = mockFetch(defaultRoutes());
    const a = new FeishuAdapter({ appId: "a", appSecret: "s", verificationToken: VT, fetch: impl });
    const r = await a.handleWebhook(
      plainReq(
        messageEvent({
          chatType: "group",
          text: "@_user_1 查一下",
          mentions: [{ key: "@_user_1", name: "bot", open_id: BOT }],
        }),
      ),
    );
    assert.equal(r.kind === "event" && r.event.mentioned, true);
    assert.equal(r.kind === "event" && r.event.text, "查一下");
    assert.ok(calls.some((c) => c.url.endsWith("/open-apis/bot/v3/info")));
  });

  it("ignores non-text, bot-sent, empty and unrelated events", async () => {
    const a = adapter();
    const cases = [
      messageEvent({ text: "x", messageType: "image" }),
      messageEvent({ text: "x", senderType: "app" }),
      messageEvent({
        chatType: "group",
        text: "@_user_1",
        mentions: [{ key: "@_user_1", name: "bot", open_id: BOT }],
      }),
      { ...messageEvent({ text: "x" }), header: { event_type: "im.chat.updated_v1", token: VT } },
    ];
    for (const body of cases) {
      const r = await a.handleWebhook(plainReq(body));
      assert.equal(r.kind, "ignored", JSON.stringify(body));
    }
  });
});

describe("FeishuAdapter.handleWebhook - encrypted mode", () => {
  const adapter = () =>
    new FeishuAdapter({
      appId: "a",
      appSecret: "s",
      verificationToken: VT,
      encryptKey: EK,
      botOpenId: BOT,
    });

  it("decrypts the url_verification challenge (sent unsigned)", async () => {
    const req = encryptedReq(
      { type: "url_verification", token: VT, challenge: "c1" },
      { sign: false },
    );
    assert.deepEqual(await adapter().handleWebhook(req), {
      kind: "challenge",
      response: { challenge: "c1" },
    });
  });

  it("decrypts and verifies a signed message event", async () => {
    const r = await adapter().handleWebhook(encryptedReq(messageEvent({ text: "hello" })));
    assert.equal(r.kind === "event" && r.event.text, "hello");
  });

  it("rejects a tampered body (signature mismatch)", async () => {
    const req = encryptedReq(messageEvent({ text: "hello" }));
    req.headers["x-lark-signature"] = "0".repeat(64);
    const r = await adapter().handleWebhook(req);
    assert.equal(r.kind === "rejected" && r.reason, "signature mismatch");
  });

  it("rejects unsigned message events", async () => {
    const r = await adapter().handleWebhook(
      encryptedReq(messageEvent({ text: "hello" }), { sign: false }),
    );
    assert.equal(r.kind === "rejected" && r.reason, "missing signature headers");
  });

  it("rejects payloads encrypted with another key", async () => {
    const r = await adapter().handleWebhook(
      encryptedReq(
        { type: "url_verification", token: VT, challenge: "c" },
        { sign: false, key: "other" },
      ),
    );
    assert.equal(r.kind, "rejected");
  });

  it("rejects plaintext bodies", async () => {
    const r = await adapter().handleWebhook(plainReq(messageEvent({ text: "hello" })));
    assert.equal(r.kind === "rejected" && r.reason, "expected encrypted payload");
  });
});

describe("FeishuAdapter.sendMessage", () => {
  it("replies in-thread with a cached tenant_access_token", async () => {
    const { impl, calls } = mockFetch(defaultRoutes());
    const a = new FeishuAdapter({ appId: "cli_x", appSecret: "sec", fetch: impl });
    await a.sendMessage({ chatId: "oc_chat", text: "答复 1", replyTo: "om_1" });
    await a.sendMessage({ chatId: "oc_chat", text: "答复 2", replyTo: "om_2" });

    const tokenCalls = calls.filter((c) => c.url.includes("tenant_access_token"));
    assert.equal(tokenCalls.length, 1, "token fetched once and cached");
    assert.deepEqual(tokenCalls[0]!.body, { app_id: "cli_x", app_secret: "sec" });

    const replies = calls.filter((c) => c.url.includes("/reply"));
    assert.equal(replies.length, 2);
    assert.equal(replies[0]!.url, "https://open.feishu.cn/open-apis/im/v1/messages/om_1/reply");
    assert.equal(replies[0]!.method, "POST");
    assert.equal(replies[0]!.headers.authorization, "Bearer t-123");
    assert.deepEqual(replies[0]!.body, {
      msg_type: "text",
      content: JSON.stringify({ text: "答复 1" }),
    });
  });

  it("sends to the chat when there is no message to reply to, honoring apiBase", async () => {
    const { impl, calls } = mockFetch(defaultRoutes());
    const a = new FeishuAdapter({
      appId: "a",
      appSecret: "s",
      apiBase: "https://open.larksuite.com/",
      fetch: impl,
    });
    await a.sendMessage({ chatId: "oc_chat", text: "hi" });
    const send = calls.find((c) => c.url.includes("/im/v1/messages?"))!;
    assert.equal(
      send.url,
      "https://open.larksuite.com/open-apis/im/v1/messages?receive_id_type=chat_id",
    );
    assert.deepEqual(send.body, {
      receive_id: "oc_chat",
      msg_type: "text",
      content: JSON.stringify({ text: "hi" }),
    });
  });

  it("shares one token request between concurrent sends", async () => {
    const { impl, calls } = mockFetch(defaultRoutes());
    const a = new FeishuAdapter({ appId: "a", appSecret: "s", fetch: impl });
    await Promise.all([1, 2, 3].map((i) => a.sendMessage({ chatId: "c", text: `m${i}` })));
    assert.equal(calls.filter((c) => c.url.includes("tenant_access_token")).length, 1);
  });

  it("refreshes the token once when the API reports it invalid", async () => {
    let tokenN = 0;
    let sendN = 0;
    const { impl, calls } = mockFetch({
      tenant_access_token: () => ({ code: 0, tenant_access_token: `t-${++tokenN}`, expire: 7200 }),
      "/reply": () =>
        ++sendN === 1 ? { code: 99991663, msg: "invalid token" } : { code: 0, data: {} },
    });
    const a = new FeishuAdapter({ appId: "a", appSecret: "s", fetch: impl });
    await a.sendMessage({ chatId: "c", text: "x", replyTo: "om_1" });
    const replies = calls.filter((c) => c.url.includes("/reply"));
    assert.equal(replies.length, 2);
    assert.equal(replies[1]!.headers.authorization, "Bearer t-2");
  });

  it("throws on API errors and token failures", async () => {
    const bad = mockFetch({
      tenant_access_token: () => ({ code: 0, tenant_access_token: "t", expire: 7200 }),
      "/reply": () => ({ code: 230002, msg: "bot not in chat" }),
    });
    await assert.rejects(
      new FeishuAdapter({ appId: "a", appSecret: "s", fetch: bad.impl }).sendMessage({
        chatId: "c",
        text: "x",
        replyTo: "om",
      }),
      /230002/,
    );
    const noToken = mockFetch({
      tenant_access_token: () => ({ code: 10003, msg: "invalid app_secret" }),
    });
    await assert.rejects(
      new FeishuAdapter({ appId: "a", appSecret: "s", fetch: noToken.impl }).sendMessage({
        chatId: "c",
        text: "x",
      }),
      /token failed/,
    );
  });

  it("truncates overly long replies", async () => {
    const { impl, calls } = mockFetch(defaultRoutes());
    const a = new FeishuAdapter({ appId: "a", appSecret: "s", fetch: impl });
    await a.sendMessage({ chatId: "c", text: "长".repeat(30_000) });
    const body = calls.find((c) => c.url.includes("/im/v1/messages?"))!.body as { content: string };
    const text = (JSON.parse(body.content) as { text: string }).text;
    assert.ok(text.length < 20_100 && text.endsWith("（内容过长已截断）"));
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UnifiedBotEvent, UnifiedBotMessage } from "@fde/shared";
import { EventDeduper } from "./dedupe.js";
import { BOT_FAILURE_REPLY, BotDispatcher, botConversationKey } from "./dispatcher.js";
import type { BotAdapter, BotWebhookResult } from "./types.js";

function event(over: Partial<UnifiedBotEvent> = {}): UnifiedBotEvent {
  return {
    platform: "feishu",
    eventId: "ev-1",
    chatId: "oc_1",
    userId: "ou_1",
    messageId: "om_1",
    text: "hello",
    chatType: "p2p",
    mentioned: true,
    raw: {},
    receivedAt: 0,
    ...over,
  };
}

class FakeAdapter implements BotAdapter {
  readonly platform = "feishu" as const;
  sent: UnifiedBotMessage[] = [];
  constructor(private next: () => BotWebhookResult) {}
  async handleWebhook(): Promise<BotWebhookResult> {
    return this.next();
  }
  async sendMessage(msg: UnifiedBotMessage): Promise<void> {
    this.sent.push(msg);
  }
}

/** Scheduler that collects tasks so tests can await them. */
function collector() {
  const tasks: Promise<void>[] = [];
  return {
    schedule: (task: () => Promise<void>) => {
      tasks.push(task());
    },
    drain: () => Promise.all(tasks),
    tasks,
  };
}

const req = { method: "POST", headers: {}, body: {} };

describe("EventDeduper", () => {
  it("dedupes within TTL and forgets after it", () => {
    let now = 0;
    const d = new EventDeduper(1000, 100, () => now);
    assert.equal(d.firstSeen("a"), true);
    assert.equal(d.firstSeen("a"), false);
    now = 999;
    assert.equal(d.firstSeen("a"), false);
    now = 2000;
    assert.equal(d.firstSeen("a"), true);
  });

  it("caps its size by evicting the oldest ids", () => {
    const d = new EventDeduper(60_000, 3);
    for (const k of ["a", "b", "c", "d"]) d.firstSeen(k);
    assert.equal(d.size, 3);
    assert.equal(d.firstSeen("a"), true, "oldest evicted");
    assert.equal(d.firstSeen("d"), false);
  });
});

describe("BotDispatcher", () => {
  it("acks immediately, then runs the handler and replies in-thread", async () => {
    const adapter = new FakeAdapter(() => ({ kind: "event", event: event() }));
    const c = collector();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const d = new BotDispatcher({ schedule: c.schedule }).register(adapter).onEvent(async (e) => {
      await gate;
      return { replyText: `echo ${e.text}` };
    });

    const r = await d.dispatch("feishu", req);
    assert.equal(r.kind, "event");
    assert.equal(adapter.sent.length, 0, "reply is not awaited by dispatch()");
    release();
    await c.drain();
    assert.deepEqual(adapter.sent, [{ chatId: "oc_1", text: "echo hello", replyTo: "om_1" }]);
  });

  it("drops retried events with the same event id", async () => {
    const adapter = new FakeAdapter(() => ({ kind: "event", event: event() }));
    const c = collector();
    let calls = 0;
    const d = new BotDispatcher({ schedule: c.schedule }).register(adapter).onEvent(async () => {
      calls++;
      return { replyText: "ok" };
    });
    await d.dispatch("feishu", req);
    const dup = await d.dispatch("feishu", req);
    await c.drain();
    assert.deepEqual(dup, { kind: "ignored", reason: "duplicate event" });
    assert.equal(calls, 1);
    assert.equal(adapter.sent.length, 1);
  });

  it("ignores group messages without @mention", async () => {
    const adapter = new FakeAdapter(() => ({
      kind: "event",
      event: event({ chatType: "group", mentioned: false }),
    }));
    const d = new BotDispatcher().register(adapter).onEvent(async () => ({ replyText: "x" }));
    const r = await d.dispatch("feishu", req);
    assert.equal(r.kind, "ignored");
  });

  it("passes challenge / rejected results through untouched", async () => {
    const results: BotWebhookResult[] = [
      { kind: "challenge", response: { challenge: "c" } },
      { kind: "rejected", reason: "signature mismatch", status: 401 },
    ];
    for (const expected of results) {
      const d = new BotDispatcher().register(new FakeAdapter(() => expected));
      assert.deepEqual(await d.dispatch("feishu", req), expected);
    }
  });

  it("replies with a generic message when the handler throws", async () => {
    const adapter = new FakeAdapter(() => ({ kind: "event", event: event() }));
    const c = collector();
    const d = new BotDispatcher({ schedule: c.schedule }).register(adapter).onEvent(async () => {
      throw new Error("model down: secret-ish detail");
    });
    await d.dispatch("feishu", req);
    await c.drain();
    assert.equal(adapter.sent[0]?.text, BOT_FAILURE_REPLY);
  });

  it("uses the per-call scheduler override and survives send failures", async () => {
    const adapter = new FakeAdapter(() => ({ kind: "event", event: event() }));
    adapter.sendMessage = async () => {
      throw new Error("network");
    };
    const c = collector();
    const d = new BotDispatcher().register(adapter).onEvent(async () => ({ replyText: "x" }));
    await d.dispatch("feishu", req, { schedule: c.schedule });
    assert.equal(c.tasks.length, 1);
    await c.drain(); // must not reject
  });

  it("reports unknown platforms", async () => {
    const r = await new BotDispatcher().dispatch("wecom", req);
    assert.equal(r.kind, "ignored");
  });
});

describe("botConversationKey", () => {
  it("keys p2p by chat and groups by chat + sender", () => {
    assert.equal(botConversationKey(event()), "feishu:p2p:oc_1");
    assert.equal(
      botConversationKey(event({ chatType: "group", chatId: "oc_g", userId: "ou_9" })),
      "feishu:group:oc_g:ou_9",
    );
  });
});

import { BotSessionStore, ChatStore, KnowledgeStore, embeddingClientFromEnv } from "@fde/data";
import {
  BotDispatcher,
  FeishuAdapter,
  WeComAppAdapter,
  botConversationKey,
  feishuConfigFromEnv,
} from "@fde/bot-core";
import { buildChatAgent, streamChat, McpManager } from "@fde/agent-runtime";
import type { UnifiedBotEvent } from "@fde/shared";

/**
 * Server-side singletons. Next.js dev mode re-evaluates modules on HMR,
 * so stash them on globalThis to survive reloads.
 */
const g = globalThis as unknown as {
  __fdeChatStore?: ChatStore;
  __fdeKnowledgeStore?: KnowledgeStore;
  __fdeBotSessions?: BotSessionStore;
  __fdeMcp?: McpManager;
  __fdeBots?: BotDispatcher;
};

export function chatStore(): ChatStore {
  return (g.__fdeChatStore ??= new ChatStore());
}

export function knowledgeStore(): KnowledgeStore {
  return (g.__fdeKnowledgeStore ??= new KnowledgeStore(embeddingClientFromEnv()));
}

export function botSessionStore(): BotSessionStore {
  return (g.__fdeBotSessions ??= new BotSessionStore());
}

export function mcpManager(): McpManager {
  return (g.__fdeMcp ??= McpManager.fromEnv());
}

/** Messages that reset the bot conversation to a fresh session. */
const RESET_COMMANDS = new Set(["/new", "/reset", "新对话", "重新开始"]);

/** Per-conversation promise chain: turns of one conversation run in order. */
const conversationLocks = new Map<string, Promise<unknown>>();
function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = conversationLocks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  conversationLocks.set(key, next);
  void next
    .catch(() => undefined)
    .finally(() => {
      if (conversationLocks.get(key) === next) conversationLocks.delete(key);
    });
  return next;
}

/**
 * bot -> agent: one chat turn per IM message. The IM conversation (p2p chat, or
 * group + sender) is bound to a persistent chat session so follow-ups keep context.
 */
async function handleBotEvent(event: UnifiedBotEvent) {
  const key = botConversationKey(event);
  return serialized(key, async () => {
    const store = chatStore();
    const bindings = botSessionStore();
    const model = process.env.FDE_BOT_MODEL || undefined;
    const knowledgeBaseId = process.env.FDE_BOT_KNOWLEDGE_BASE_ID || undefined;
    const newSession = async () => {
      const session = await store.createSession({
        channel: event.platform,
        model,
        knowledgeBaseId,
      });
      await bindings.bind(key, event.platform, session.id);
      return session.id;
    };

    if (RESET_COMMANDS.has(event.text.trim().toLowerCase())) {
      const sessionId = await newSession();
      return { replyText: "已开启新对话，请描述你遇到的问题。", sessionId };
    }

    let sessionId = await bindings.getSessionId(key);
    if (sessionId && !(await store.getSession(sessionId))) sessionId = null;
    sessionId ??= await newSession();

    const history = (await store.listMessages(sessionId))
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    await store.appendMessage({ sessionId, role: "user", content: event.text });
    await store.maybeAutoTitle(sessionId, event.text);

    const agent = await buildChatAgent({
      modelAlias: model,
      knowledgeBaseId,
      mcpManager: mcpManager(),
    });
    let replyText = "";
    for await (const ev of streamChat({ agent, input: event.text, history })) {
      if (ev.type === "delta") replyText += ev.text;
      if (ev.type === "error") {
        console.error(`[web] ${event.platform} bot agent run failed:`, ev.message);
        replyText = `出错了：${ev.message}`;
      }
    }
    replyText ||= "（没有生成回复）";
    await store.appendMessage({
      sessionId,
      role: "assistant",
      content: replyText,
      model,
      knowledgeBaseId,
    });
    return { replyText, sessionId };
  });
}

/** Bot dispatcher wired from env; bots stay disabled until configured. */
export function botDispatcher(): BotDispatcher {
  if (g.__fdeBots) return g.__fdeBots;

  const dispatcher = new BotDispatcher();

  const feishu = feishuConfigFromEnv(process.env);
  if (feishu.ok) {
    dispatcher.register(new FeishuAdapter(feishu.options));
  } else if (process.env.FEISHU_APP_ID) {
    console.warn(`[web] feishu bot disabled, missing env: ${feishu.missing.join(", ")}`);
  }
  if (process.env.WECOM_CORP_ID && process.env.WECOM_SECRET && process.env.WECOM_CALLBACK_AES_KEY) {
    dispatcher.register(
      new WeComAppAdapter({
        corpId: process.env.WECOM_CORP_ID,
        agentId: process.env.WECOM_AGENT_ID ?? "",
        secret: process.env.WECOM_SECRET,
        callbackToken: process.env.WECOM_CALLBACK_TOKEN ?? "",
        callbackAesKey: process.env.WECOM_CALLBACK_AES_KEY,
      }),
    );
  }

  dispatcher.onEvent(handleBotEvent);

  return (g.__fdeBots = dispatcher);
}

import { ChatStore, KnowledgeStore, embeddingClientFromEnv } from "@fde/data";
import { BotDispatcher, FeishuAdapter, WeComAppAdapter } from "@fde/bot-core";
import { buildChatAgent, streamChat, McpManager } from "@fde/agent-runtime";
import type { UnifiedBotEvent } from "@fde/shared";

/**
 * Server-side singletons. Next.js dev mode re-evaluates modules on HMR,
 * so stash them on globalThis to survive reloads.
 */
const g = globalThis as unknown as {
  __fdeChatStore?: ChatStore;
  __fdeKnowledgeStore?: KnowledgeStore;
  __fdeMcp?: McpManager;
  __fdeBots?: BotDispatcher;
};

export function chatStore(): ChatStore {
  return (g.__fdeChatStore ??= new ChatStore());
}

export function knowledgeStore(): KnowledgeStore {
  return (g.__fdeKnowledgeStore ??= new KnowledgeStore(embeddingClientFromEnv()));
}

export function mcpManager(): McpManager {
  return (g.__fdeMcp ??= McpManager.fromEnv());
}

/** Bot dispatcher wired from env; bots stay disabled until configured. */
export function botDispatcher(): BotDispatcher {
  if (g.__fdeBots) return g.__fdeBots;

  const dispatcher = new BotDispatcher();

  if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET) {
    dispatcher.register(
      new FeishuAdapter({
        appId: process.env.FEISHU_APP_ID,
        appSecret: process.env.FEISHU_APP_SECRET,
        verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
      }),
    );
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

  // bot -> agent: run a chat turn, accumulate the stream, reply with text
  dispatcher.onEvent(async (event: UnifiedBotEvent) => {
    const session = await chatStore().createSession({
      title: event.text.slice(0, 24),
      channel: event.platform,
    });
    const agent = await buildChatAgent({ mcpManager: mcpManager() });
    let replyText = "";
    for await (const ev of streamChat({ agent, input: event.text })) {
      if (ev.type === "delta") replyText += ev.text;
      if (ev.type === "error") replyText = `出错了：${ev.message}`;
    }
    await chatStore().appendMessage({ sessionId: session.id, role: "user", content: event.text });
    await chatStore().appendMessage({ sessionId: session.id, role: "assistant", content: replyText });
    return { replyText: replyText || "（没有生成回复）", sessionId: session.id };
  });

  return (g.__fdeBots = dispatcher);
}

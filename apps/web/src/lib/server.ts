import { ChatStore, KnowledgeStore, closeDb, embeddingClientFromEnv } from "@fde/data";
import { BotDispatcher, FeishuAdapter, WeComAppAdapter } from "@fde/bot-core";
import { isAgentBackendId, McpManager, resolveAgentBackend } from "@fde/agent-runtime";
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
  __fdeShutdownHook?: boolean;
};

/**
 * 优雅关闭：PGlite 的数据在内存里，进程被强杀会丢掉未落盘的部分，导致数据目录
 * 再也打不开（本仓库已实测两次）。SIGTERM / SIGINT 时先 flush 再退出。
 *
 * ⚠️ SIGKILL 无法捕获——停服务请用 Ctrl+C 或 `kill <pid>`，**不要** `kill -9`。
 */
function registerShutdownHook(): void {
  if (g.__fdeShutdownHook) return;
  g.__fdeShutdownHook = true;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void closeDb().finally(() => process.exit(0));
    });
  }
}
registerShutdownHook();

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
    const configuredBackend = process.env.FDE_BOT_BACKEND?.trim();
    const backendId = isAgentBackendId(configuredBackend) ? configuredBackend : "api";
    const backend = resolveAgentBackend(backendId);
    const status = await backend.inspect();
    if (!status.available) {
      console.warn(`[bot-core] backend ${backendId} unavailable: ${status.detail}`);
      return { replyText: `机器人后端暂不可用：${status.detail}` };
    }
    const knowledgeBaseId = process.env.FDE_BOT_KNOWLEDGE_BASE_ID?.trim() || undefined;
    const session = await chatStore().createSession({
      title: event.text.slice(0, 24),
      channel: event.platform,
      backend: backendId,
      knowledgeBaseId,
    });
    await chatStore().appendMessage({ sessionId: session.id, role: "user", content: event.text });
    let replyText = "";
    let diagnosis;
    if (/^诊断[：:\s]/.test(event.text) && knowledgeBaseId) {
      diagnosis = await backend.diagnose({
        sessionId: session.id,
        input: event.text.replace(/^诊断[：:\s]*/, ""),
        knowledgeBaseId,
      });
      replyText = [
        `诊断结论：${diagnosis.summary}`,
        `问题定位：${diagnosis.location}`,
        `根因分析：${diagnosis.rootCause}`,
        `解决方案：${diagnosis.solution}`,
        `预防措施：${diagnosis.prevention}`,
      ].join("\n\n");
    } else {
      for await (const ev of backend.streamChat({
        sessionId: session.id,
        input: event.text,
        knowledgeBaseId,
      })) {
        if (ev.type === "backend_session") {
          await chatStore().setProviderSession(session.id, ev.sessionId);
        } else if (ev.type === "delta") replyText += ev.text;
        else if (ev.type === "error") replyText = `出错了：${ev.message}`;
      }
    }
    await chatStore().appendMessage({
      sessionId: session.id,
      role: "assistant",
      content: replyText,
      knowledgeBaseId,
      diagnosis,
    });
    return { replyText: replyText || "（没有生成回复）", sessionId: session.id };
  });

  return (g.__fdeBots = dispatcher);
}

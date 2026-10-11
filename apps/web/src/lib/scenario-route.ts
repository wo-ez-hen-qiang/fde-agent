/**
 * 结构化场景的统一请求处理：/api/scenario 与（兼容用的）/api/diagnose 共用。
 */
import {
  extractCustomerNameFromIntakeMarkdown,
  type AgentBackendId,
  type AgentLogEvent,
  type PreSalesPhase,
  type ScenarioResult,
  type StructuredScenarioId,
} from "@fde/shared";
import {
  defaultAgentBackendId,
  getScenario,
  resolveAgentBackend,
  runWithAgentLogs,
} from "@fde/agent-runtime";
import { chatStore } from "@/lib/server";

export interface ScenarioRouteInput {
  scenario: StructuredScenarioId;
  /** 工单内容（diagnosis）或受理表/画布材料（presales）。 */
  input: string;
  sessionId?: string;
  knowledgeBaseId?: string;
  model?: string;
  backend?: AgentBackendId;
  /** @deprecated 售前请用 presalesPhase。 */
  forceReport?: boolean;
  /** 售前：canvas | report。 */
  presalesPhase?: PreSalesPhase;
  signal?: AbortSignal;
}

export type ScenarioRouteResult =
  | {
      ok: true;
      scenario: StructuredScenarioId;
      result: ScenarioResult;
      sessionId: string;
      markdown: string;
      logs: AgentLogEvent[];
    }
  | { ok: false; status: number; error: string; logs?: AgentLogEvent[] };

export async function runScenarioRoute(input: ScenarioRouteInput): Promise<ScenarioRouteResult> {
  console.log(
    `[PRESALES-DEMO] step 2: runScenarioRoute enter scenario=${input.scenario} phase=${input.presalesPhase ?? ""} sessionId=${input.sessionId ?? "(new)"} kb=${input.knowledgeBaseId ?? ""} model=${input.model ?? "(default)"}`,
  );
  const definition = getScenario(input.scenario);
  if (!input.input?.trim()) {
    return { ok: false, status: 400, error: "input is required" };
  }
  if (definition.requiresKnowledgeBase && !input.knowledgeBaseId) {
    return {
      ok: false,
      status: 400,
      error: `knowledgeBaseId is required for ${input.scenario}`,
    };
  }

  const { result: outcome, logs } = await runWithAgentLogs(async () => {
    try {
      const store = chatStore();
      let session = input.sessionId ? await store.getSession(input.sessionId) : null;
      if (input.sessionId && !session) {
        return { ok: false as const, status: 404, error: "session not found" };
      }
      if (session && input.backend && input.backend !== session.backend) {
        return { ok: false as const, status: 409, error: "已有会话不能切换运行后端" };
      }

      const backendId = session?.backend ?? input.backend ?? defaultAgentBackendId();
      const backend = resolveAgentBackend(backendId);
      const status = await backend.inspect();
      console.log(
        `[PRESALES-DEMO] step 3: backend.inspect id=${backendId} available=${status.available} detail=${status.detail}`,
      );
      if (!status.available) return { ok: false as const, status: 503, error: status.detail };

      const customerName =
        input.scenario === "presales"
          ? extractCustomerNameFromIntakeMarkdown(input.input)
          : undefined;
      const preferredTitle = customerName ? `售前 · ${customerName}` : undefined;

      if (!session) {
        console.log(
          `[PRESALES-DEMO] step 4: ChatStore.createSession channel=web scenario=${input.scenario} title=${preferredTitle ?? "(auto)"}`,
        );
        session = await store.createSession({
          channel: "web",
          knowledgeBaseId: input.knowledgeBaseId,
          model: input.model,
          backend: backendId,
          scenario: input.scenario,
          title: preferredTitle,
        });
        console.log(`[PRESALES-DEMO] step 4b: session created id=${session.id}`);
      }
      const sessionId = session.id;
      console.log(`[PRESALES-DEMO] step 5: ChatStore.listMessages sessionId=${sessionId}`);
      const messages = await store.listMessages(sessionId);
      const history = messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({
          role: message.role as "user" | "assistant",
          content: message.content,
        }));
      console.log(`[PRESALES-DEMO] step 5b: history turns=${history.length}`);

      console.log(
        `[PRESALES-DEMO] step 6: ChatStore.appendMessage role=user contentLen=${input.input.length}`,
      );
      await store.appendMessage({ sessionId, role: "user", content: input.input });
      await store.maybeAutoTitle(sessionId, preferredTitle ?? input.input);

      const presalesPhase: PreSalesPhase | undefined =
        input.scenario === "presales"
          ? input.presalesPhase === "canvas" || input.presalesPhase === "report"
            ? input.presalesPhase
            : input.forceReport
              ? "report"
              : "canvas"
          : undefined;

      console.log(
        `[PRESALES-DEMO] step 7: backend.runScenario begin phase=${presalesPhase ?? ""} historyTurns=${history.length}`,
      );
      const result = await backend.runScenario(input.scenario, {
        sessionId,
        providerSessionId: session.providerSessionId,
        input: input.input,
        history,
        model: input.model,
        knowledgeBaseId: input.knowledgeBaseId,
        forceReport: input.forceReport === true || presalesPhase === "report",
        ...(presalesPhase ? { presalesPhase } : {}),
        signal: input.signal,
      });
      console.log(
        `[PRESALES-DEMO] step 12: runScenario returned stage=${"stage" in result ? String((result as { stage?: string }).stage ?? "") : ""} keys=${Object.keys(result).join(",")}`,
      );

      const markdown = definition.renderMarkdown?.(result) ?? "";
      console.log(
        `[PRESALES-DEMO] step 13: ChatStore.appendMessage role=assistant markdownLen=${markdown.length}`,
      );
      await store.appendMessage({
        sessionId,
        role: "assistant",
        content: markdown,
        model: input.model,
        knowledgeBaseId: input.knowledgeBaseId,
        scenario: input.scenario,
        scenarioResult: result,
      });

      return {
        ok: true as const,
        scenario: input.scenario,
        result,
        sessionId,
        markdown,
      };
    } catch (error) {
      console.error(`[scenario:${input.scenario}] 运行失败`, error);
      return {
        ok: false as const,
        status: 500,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  if (outcome.ok) return { ...outcome, logs };
  return { ...outcome, logs };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SCENARIO_UI,
  serializePresalesIntake,
  type AgentBackendId,
  type AgentBackendStatus,
  type AgentLogEvent,
  type ChatMessage,
  type ChatMode,
  type ChatSession,
  type KnowledgeBase,
  type ModelDescriptor,
  type PreSalesCanvas,
  type PreSalesIntake,
  type PreSalesPhase,
  type PreSalesResult,
  type PresalesTestCase,
} from "@fde/shared";
import {
  deleteSession,
  fetchBackends,
  fetchKnowledgeBases,
  fetchModels,
  fetchSessionDetail,
  fetchSessions,
  scenarioRequest,
  streamChatRequest,
} from "@/lib/api";
import { Sidebar } from "./sidebar";
import { MessageList, type StreamingState } from "./message-list";
import { Composer } from "./composer";
import { PreSalesIntakeForm } from "./presales-intake-form";
import { appendConfirmedCanvas } from "./presales-card";
import { AgentLogDock } from "./agent-log-dock";

export function ChatApp() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentId, setCurrentId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [models, setModels] = useState<ModelDescriptor[]>([]);
  const [model, setModel] = useState<string | undefined>();
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [kbId, setKbId] = useState<string | undefined>();
  const [quickText, setQuickText] = useState<string | undefined>();
  const [backends, setBackends] = useState<AgentBackendStatus[]>([]);
  const [backend, setBackend] = useState<AgentBackendId>("api");
  const [mode, setMode] = useState<ChatMode>("chat");
  const [agentLogs, setAgentLogs] = useState<AgentLogEvent[]>([]);
  const [intakePreset, setIntakePreset] = useState<{
    intake: PreSalesIntake;
    nonce: number;
    caseId: string;
  } | null>(null);
  const [testSubmitted, setTestSubmitted] = useState<{ caseId: string; nonce: number } | null>(
    null,
  );

  const abortRef = useRef<AbortController | null>(null);
  const lastSentRef = useRef<string>("");
  const lastModeRef = useRef<ChatMode>("chat");
  const lastPhaseRef = useRef<PreSalesPhase | undefined>(undefined);

  useEffect(() => {
    void fetchSessions().then(setSessions);
    void fetchModels().then(({ models, defaultModel }) => {
      setModels(models);
      const firstEnabled = models.find((m) => m.enabled);
      setModel(firstEnabled?.alias ?? defaultModel);
    });
    void fetchKnowledgeBases().then(setKbs);
    void fetchBackends().then(({ backends, defaultBackend }) => {
      setBackends(backends);
      const preferred = backends.find((item) => item.id === defaultBackend && item.available);
      const fallback = backends.find((item) => item.available);
      setBackend(preferred?.id ?? fallback?.id ?? defaultBackend);
    });
  }, []);

  const refreshSessions = useCallback(async () => {
    setSessions(await fetchSessions());
  }, []);

  const selectSession = useCallback(async (id: string) => {
    abortRef.current?.abort();
    setStreaming(null);
    setAgentLogs([]);
    setCurrentId(id);
    const detail = await fetchSessionDetail(id);
    setMessages(detail.messages);
    if (detail.session.model) setModel(detail.session.model);
    if (detail.session.knowledgeBaseId) setKbId(detail.session.knowledgeBaseId);
    setBackend(detail.session.backend);
    if (detail.session.scenario) setMode(detail.session.scenario);
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setCurrentId(undefined);
    setMessages([]);
    setStreaming(null);
    setAgentLogs([]);
  }, []);

  const removeSession = useCallback(
    async (id: string) => {
      await deleteSession(id);
      if (id === currentId) newChat();
      await refreshSessions();
    },
    [currentId, newChat, refreshSessions],
  );

  const busy = streaming !== null && !streaming.error;

  const send = useCallback(
    async (text: string, options?: { forceReport?: boolean; presalesPhase?: PreSalesPhase }) => {
      lastSentRef.current = text;
      lastModeRef.current = mode;
      lastPhaseRef.current = options?.presalesPhase;
      const controller = new AbortController();
      abortRef.current = controller;

      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          sessionId: currentId ?? "",
          role: "user",
          content: text,
          createdAt: Date.now(),
        },
      ]);

      const phase =
        options?.presalesPhase ??
        (options?.forceReport ? "report" : mode === "presales" ? "canvas" : undefined);
      const pendingText =
        mode === "presales"
          ? phase === "report"
            ? "正在生成整体方案"
            : "正在生成方案画布"
          : SCENARIO_UI[mode].pendingText;

      setStreaming({ text: "", tools: [], statusText: pendingText });
      setAgentLogs([]);

      let streamedText = "";

      try {
        if (mode !== "chat") {
          if (!kbId) throw new Error(SCENARIO_UI[mode].knowledgeRequiredHint || "请先选择知识库");
          const { result, sessionId, markdown, logs } = await scenarioRequest(
            {
              scenario: mode,
              input: text,
              sessionId: currentId,
              model: backend === "api" ? model : undefined,
              knowledgeBaseId: kbId,
              backend,
              forceReport: options?.forceReport === true || phase === "report",
              ...(mode === "presales" && phase ? { presalesPhase: phase } : {}),
            },
            controller.signal,
          );
          setAgentLogs(logs);
          setCurrentId(sessionId);
          setMessages((previous) => [
            ...previous,
            {
              id: `local-${mode}-${Date.now()}`,
              sessionId,
              role: "assistant",
              content: markdown,
              scenario: mode,
              scenarioResult: result,
              model: backend === "api" ? model : undefined,
              knowledgeBaseId: kbId,
              createdAt: Date.now(),
            },
          ]);
          return;
        }
        await streamChatRequest(
          {
            sessionId: currentId,
            message: text,
            model: backend === "api" ? model : undefined,
            knowledgeBaseId: kbId,
            backend,
          },
          {
            signal: controller.signal,
            onSessionId: (id) => setCurrentId(id),
            onEvent: (event) => {
              if (event.type === "delta") streamedText += event.text;
              if (event.type === "log") {
                setAgentLogs((prev) => [
                  ...prev,
                  {
                    ts: Date.now(),
                    tag: event.tag,
                    level: event.level,
                    message: event.message,
                  },
                ]);
                return;
              }
              setStreaming((prev) => {
                if (!prev) return prev;
                switch (event.type) {
                  case "delta":
                    return { ...prev, text: prev.text + event.text };
                  case "tool_call":
                    return prev.tools.includes(event.name)
                      ? prev
                      : { ...prev, tools: [...prev.tools, event.name] };
                  case "error":
                    return { ...prev, error: event.message };
                  default:
                    return prev;
                }
              });
            },
          },
        );
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setStreaming((prev) =>
            prev ? { ...prev, error: err instanceof Error ? err.message : String(err) } : prev,
          );
        }
      } finally {
        if (mode === "chat" && streamedText) {
          setMessages((msgs) => [
            ...msgs,
            {
              id: `local-a-${Date.now()}`,
              sessionId: currentId ?? "",
              role: "assistant",
              content: streamedText,
              model: backend === "api" ? model : undefined,
              createdAt: Date.now(),
            },
          ]);
        }
        setStreaming((prev) => (prev?.error ? prev : null));
        abortRef.current = null;
        void refreshSessions();
      }
    },
    [backend, currentId, mode, model, kbId, refreshSessions],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const retry = useCallback(() => {
    if (lastSentRef.current) {
      setMode(lastModeRef.current);
      void send(lastSentRef.current, {
        presalesPhase: lastPhaseRef.current,
        forceReport: lastPhaseRef.current === "report",
      });
    }
  }, [send]);

  const submitIntake = useCallback(
    (intake: PreSalesIntake) => {
      if (intakePreset) {
        setTestSubmitted({ caseId: intakePreset.caseId, nonce: Date.now() });
      }
      void send(serializePresalesIntake(intake), { presalesPhase: "canvas" });
    },
    [intakePreset, send],
  );

  const confirmCanvas = useCallback(
    (canvas: PreSalesCanvas, intakeMarkdown: string) => {
      void send(appendConfirmedCanvas(intakeMarkdown, canvas), { presalesPhase: "report" });
    },
    [send],
  );

  const regenerateCanvas = useCallback(
    (intakeMarkdown: string) => {
      void send(intakeMarkdown, { presalesPhase: "canvas" });
    },
    [send],
  );

  const changeMode = useCallback(
    (next: ChatMode) => {
      if (next === mode) return;
      const touchesPresales = next === "presales" || mode === "presales";
      if (touchesPresales && messages.length > 0) {
        const confirmed = window.confirm("切换模式会新建对话，当前对话仍会保留。是否继续？");
        if (!confirmed) return;
        newChat();
      }
      setMode(next);
    },
    [mode, messages.length, newChat],
  );

  const changeBackend = useCallback(
    (next: AgentBackendId) => {
      if (next === backend) return;
      if (messages.length > 0) {
        const confirmed = window.confirm("切换运行方式会新建对话，当前对话仍会保留。是否继续？");
        if (!confirmed) return;
        newChat();
      }
      setBackend(next);
    },
    [backend, messages.length, newChat],
  );

  const latestPresales = [...messages]
    .reverse()
    .find((message) => message.scenarioResult?.scenario === "presales")?.scenarioResult as
    PreSalesResult | undefined;
  const showIntakeForm =
    mode === "presales" && (!latestPresales || latestPresales.stage === "report");
  const awaitingCanvasConfirm = latestPresales?.stage === "canvas";

  return (
    <div className="flex h-full">
      <Sidebar
        sessions={sessions}
        currentId={currentId}
        onNewChat={newChat}
        onSelect={(id) => void selectSession(id)}
        onDelete={(id) => void removeSession(id)}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <MessageList
          messages={messages}
          streaming={streaming}
          busy={busy}
          onQuickStart={(prompt) => {
            if (prompt === "__presales__") {
              changeMode("presales");
              return;
            }
            if (prompt.startsWith("诊断")) {
              changeMode("diagnosis");
              setQuickText(prompt);
              return;
            }
            setQuickText(prompt);
          }}
          onRetry={retry}
          onConfirmCanvas={confirmCanvas}
          onRegenerateCanvas={regenerateCanvas}
          showPresalesTests={mode === "presales"}
          testSubmitted={testSubmitted}
          onApplyTestCase={(testCase: PresalesTestCase) =>
            setIntakePreset({
              intake: testCase.intake,
              nonce: Date.now(),
              caseId: testCase.id,
            })
          }
        />
        <Composer
          backends={backends}
          backend={backend}
          onBackendChange={changeBackend}
          mode={mode}
          onModeChange={changeMode}
          models={models}
          model={model}
          onModelChange={setModel}
          knowledgeBases={kbs}
          knowledgeBaseId={kbId}
          onKbChange={setKbId}
          streaming={busy}
          onSend={(text) => void send(text)}
          onStop={stop}
          initialText={quickText}
          presalesPanel={
            showIntakeForm ? (
              <PreSalesIntakeForm
                disabled={busy}
                knowledgeReady={Boolean(kbId)}
                knowledgeHint={SCENARIO_UI.presales.knowledgeRequiredHint}
                onSubmit={submitIntake}
                preset={intakePreset?.intake}
                presetNonce={intakePreset?.nonce}
              />
            ) : mode === "presales" && awaitingCanvasConfirm ? (
              <p className="rounded-xl border border-border bg-sidebar px-3 py-2 text-xs text-secondary">
                请在上方方案画布中确认或重新生成；确认后将生成整体方案。
              </p>
            ) : undefined
          }
        />
        <AgentLogDock logs={agentLogs} onClear={() => setAgentLogs([])} />
      </main>
    </div>
  );
}

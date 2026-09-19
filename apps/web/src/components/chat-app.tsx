"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, ChatSession, KnowledgeBase, ModelDescriptor } from "@fde/shared";
import {
  deleteSession,
  fetchKnowledgeBases,
  fetchModels,
  fetchSessionDetail,
  fetchSessions,
  streamChatRequest,
} from "@/lib/api";
import { Sidebar } from "./sidebar";
import { MessageList, type StreamingState } from "./message-list";
import { Composer } from "./composer";

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

  const abortRef = useRef<AbortController | null>(null);
  const lastSentRef = useRef<string>("");

  useEffect(() => {
    void fetchSessions().then(setSessions);
    void fetchModels().then(({ models, defaultModel }) => {
      setModels(models);
      const firstEnabled = models.find((m) => m.enabled);
      setModel(firstEnabled?.alias ?? defaultModel);
    });
    void fetchKnowledgeBases().then(setKbs);
  }, []);

  const refreshSessions = useCallback(async () => {
    setSessions(await fetchSessions());
  }, []);

  const selectSession = useCallback(async (id: string) => {
    abortRef.current?.abort();
    setStreaming(null);
    setCurrentId(id);
    const detail = await fetchSessionDetail(id);
    setMessages(detail.messages);
    if (detail.session.model) setModel(detail.session.model);
    if (detail.session.knowledgeBaseId) setKbId(detail.session.knowledgeBaseId);
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setCurrentId(undefined);
    setMessages([]);
    setStreaming(null);
  }, []);

  const removeSession = useCallback(
    async (id: string) => {
      await deleteSession(id);
      if (id === currentId) newChat();
      await refreshSessions();
    },
    [currentId, newChat, refreshSessions],
  );

  const send = useCallback(
    async (text: string) => {
      lastSentRef.current = text;
      const controller = new AbortController();
      abortRef.current = controller;

      // optimistic user message
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
      setStreaming({ text: "", tools: [] });

      try {
        await streamChatRequest(
          { sessionId: currentId, message: text, model, knowledgeBaseId: kbId },
          {
            signal: controller.signal,
            onSessionId: (id) => setCurrentId(id),
            onEvent: (event) => {
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
        // fold the streamed text into the message list
        setStreaming((prev) => {
          if (prev?.text) {
            setMessages((msgs) => [
              ...msgs,
              {
                id: `local-a-${Date.now()}`,
                sessionId: currentId ?? "",
                role: "assistant",
                content: prev.text,
                model,
                createdAt: Date.now(),
              },
            ]);
          }
          return null;
        });
        abortRef.current = null;
        void refreshSessions();
      }
    },
    [currentId, model, kbId, refreshSessions],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const retry = useCallback(() => {
    if (lastSentRef.current) void send(lastSentRef.current);
  }, [send]);

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
          onQuickStart={(prompt) => setQuickText(prompt)}
          onRetry={retry}
        />
        <Composer
          models={models}
          model={model}
          onModelChange={setModel}
          knowledgeBases={kbs}
          knowledgeBaseId={kbId}
          onKbChange={setKbId}
          streaming={streaming !== null && !streaming.error}
          onSend={(text) => void send(text)}
          onStop={stop}
          initialText={quickText}
        />
      </main>
    </div>
  );
}

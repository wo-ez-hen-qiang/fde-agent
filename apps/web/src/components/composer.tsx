"use client";

import { useEffect, useRef, useState } from "react";
import type { KnowledgeBase, ModelDescriptor } from "@fde/shared";

interface ComposerProps {
  models: ModelDescriptor[];
  model?: string;
  onModelChange: (alias: string) => void;
  knowledgeBases: KnowledgeBase[];
  knowledgeBaseId?: string;
  onKbChange: (id: string | undefined) => void;
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  initialText?: string;
}

export function Composer({
  models,
  model,
  onModelChange,
  knowledgeBases,
  knowledgeBaseId,
  onKbChange,
  streaming,
  onSend,
  onStop,
  initialText,
}: ComposerProps) {
  const [text, setText] = useState(initialText ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialText !== undefined) {
      setText(initialText);
      textareaRef.current?.focus();
    }
  }, [initialText]);

  const enabledModels = models.filter((m) => m.enabled);
  const canSend = text.trim().length > 0 && !streaming;

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
  };

  return (
    <div className="border-t border-border px-6 py-3">
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 flex items-center gap-3 text-xs text-secondary">
          <label className="flex items-center gap-1">
            知识库
            <select
              value={knowledgeBaseId ?? ""}
              onChange={(e) => onKbChange(e.target.value || undefined)}
              className="rounded border border-border bg-transparent px-1 py-0.5"
            >
              <option value="">不使用</option>
              {knowledgeBases.map((kb) => (
                <option key={kb.id} value={kb.id}>
                  {kb.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            模型
            <select
              value={model ?? ""}
              onChange={(e) => onModelChange(e.target.value)}
              disabled={enabledModels.length === 0}
              className="rounded border border-border bg-transparent px-1 py-0.5 disabled:opacity-50"
              title={
                enabledModels.length === 0 ? "没有可用模型：请在 .env 配置 API Key" : undefined
              }
            >
              {enabledModels.length === 0 && <option value="">未配置（见 .env.example）</option>}
              {enabledModels.map((m) => (
                <option key={m.alias} value={m.alias}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface p-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            rows={Math.min(6, Math.max(1, text.split("\n").length))}
            className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
          />
          {streaming ? (
            <button onClick={onStop} className="rounded-xl border border-border px-4 py-2 text-sm">
              停止
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!canSend}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
            >
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

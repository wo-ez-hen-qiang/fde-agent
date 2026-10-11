"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  SCENARIO_ORDER,
  SCENARIO_UI,
  type AgentBackendId,
  type AgentBackendStatus,
  type ChatMode,
  type KnowledgeBase,
  type ModelDescriptor,
} from "@fde/shared";

interface ComposerProps {
  backends: AgentBackendStatus[];
  backend: AgentBackendId;
  onBackendChange: (backend: AgentBackendId) => void;
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
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
  /** 售前模式：替换自由文本框（受理表）。 */
  presalesPanel?: ReactNode;
}

export function Composer({
  backends,
  backend,
  onBackendChange,
  mode,
  onModeChange,
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
  presalesPanel,
}: ComposerProps) {
  const [text, setText] = useState(initialText ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialText !== undefined) {
      setText(initialText);
      textareaRef.current?.focus();
    }
  }, [initialText]);

  const activeBackend = backends.find((item) => item.id === backend);
  const enabledModels = models.filter((item) => item.enabled);
  const backendReady = activeBackend?.available ?? false;
  const ui = SCENARIO_UI[mode];
  const needsKnowledgeBase = ui.requiresKnowledgeBase && !knowledgeBaseId;
  const canSend = text.trim().length > 0 && !streaming && backendReady && !needsKnowledgeBase;
  const statusClass = activeBackend?.available
    ? "bg-success"
    : activeBackend?.installed
      ? "bg-warning"
      : "bg-secondary";
  const usePresalesPanel = mode === "presales" && presalesPanel;

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
  };

  return (
    <div className="border-t border-border px-4 py-3 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 flex gap-1 rounded-lg bg-sidebar p-1" aria-label="对话模式">
          {SCENARIO_ORDER.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onModeChange(item)}
              disabled={streaming}
              className={
                "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors " +
                (mode === item ? "bg-surface text-ink shadow-sm" : "text-secondary hover:bg-hover")
              }
            >
              {SCENARIO_UI[item].label}
            </button>
          ))}
        </div>

        <div className="mb-2 rounded-xl border border-border bg-surface px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs">
            <label className="flex min-h-10 items-center gap-2">
              <span className="font-medium text-ink">运行方式</span>
              <span className={"h-2 w-2 rounded-full " + statusClass} aria-hidden="true" />
              <select
                aria-label="运行方式"
                value={backend}
                onChange={(event) => onBackendChange(event.target.value as AgentBackendId)}
                disabled={streaming || backends.length === 0}
                className="min-h-10 rounded-lg border border-border bg-surface px-2 text-ink outline-none focus:border-primary"
              >
                {backends.length === 0 && <option value="api">检测中…</option>}
                {backends.map((item) => (
                  <option key={item.id} value={item.id} disabled={!item.available}>
                    {item.label}
                    {item.available ? "" : item.installed ? "（未配置）" : "（未安装）"}
                  </option>
                ))}
              </select>
            </label>

            <span className="hidden text-secondary sm:inline" aria-hidden="true">
              →
            </span>

            <label className="flex min-h-10 items-center gap-2">
              <span className="font-medium text-ink">模型</span>
              {backend === "api" ? (
                <select
                  aria-label="模型"
                  value={model ?? ""}
                  onChange={(event) => onModelChange(event.target.value)}
                  disabled={streaming || enabledModels.length === 0}
                  className="min-h-10 rounded-lg border border-border bg-surface px-2 text-ink outline-none focus:border-primary disabled:opacity-50"
                >
                  {enabledModels.length === 0 && <option value="">未配置 API 模型</option>}
                  {enabledModels.map((item) => (
                    <option key={item.alias} value={item.alias}>
                      {item.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="flex min-h-10 items-center rounded-lg border border-border px-2 text-secondary">
                  {activeBackend?.modelLabel || "使用 CLI 当前配置"}
                </span>
              )}
            </label>

            <span className="hidden text-secondary sm:inline" aria-hidden="true">
              →
            </span>

            <label className="flex min-h-10 items-center gap-2">
              <span className="font-medium text-ink">知识库</span>
              <select
                aria-label="知识库"
                value={knowledgeBaseId ?? ""}
                onChange={(event) => onKbChange(event.target.value || undefined)}
                disabled={streaming}
                className="min-h-10 rounded-lg border border-border bg-surface px-2 text-ink outline-none focus:border-primary"
              >
                <option value="">{ui.knowledgeEmptyOption}</option>
                {knowledgeBases.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {activeBackend && !activeBackend.available && (
            <p className="mt-1 text-xs text-warning">{activeBackend.detail}</p>
          )}
          {needsKnowledgeBase && ui.knowledgeRequiredHint && (
            <p className="mt-1 text-xs text-warning">{ui.knowledgeRequiredHint}</p>
          )}
        </div>

        {usePresalesPanel ? (
          <div className="space-y-2">
            {presalesPanel}
            {streaming && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onStop}
                  className="min-h-10 rounded-xl border border-border px-4 py-2 text-sm"
                >
                  停止
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface p-2 focus-within:border-primary">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder={ui.placeholder}
              rows={Math.min(6, Math.max(1, text.split("\n").length))}
              className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
            />
            {streaming ? (
              <button
                type="button"
                onClick={onStop}
                className="min-h-10 rounded-xl border border-border px-4 py-2 text-sm"
              >
                停止
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!canSend}
                className="min-h-10 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
              >
                {ui.submitLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

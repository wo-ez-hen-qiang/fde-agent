"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@fde/shared";

export interface StreamingState {
  text: string;
  tools: string[];
  error?: string;
}

interface MessageListProps {
  messages: ChatMessage[];
  streaming: StreamingState | null;
  onQuickStart: (prompt: string) => void;
  onRetry: () => void;
}

export function MessageList({ messages, streaming, onQuickStart, onRetry }: MessageListProps) {
  const isEmpty = messages.length === 0 && !streaming;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
      {isEmpty && (
        <div className="mx-auto mt-24 max-w-md text-center">
          <div className="mb-2 text-2xl font-semibold">我是 fde-agent</div>
          <p className="mb-6 text-sm text-secondary">基于知识库检索的智能工单诊断助手</p>
          <button
            onClick={() => onQuickStart("诊断工单：")}
            className="rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-hover"
          >
            诊断一个工单
          </button>
        </div>
      )}

      <div className="mx-auto max-w-3xl space-y-4">
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[75%] whitespace-pre-wrap rounded-2xl bg-bubble-user px-4 py-2.5 text-sm">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={m.id} className="rounded-2xl px-4 py-2.5 text-sm">
              <div className="markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
              </div>
            </div>
          ),
        )}

        {streaming && (
          <div className="rounded-2xl px-4 py-2.5 text-sm">
            {streaming.tools.map((t, i) => (
              <div
                key={i}
                className="mb-1 inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-secondary"
              >
                ▸ 调用工具: {t}
              </div>
            ))}
            {streaming.text ? (
              <div className="markdown-body stream-caret">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streaming.text}</ReactMarkdown>
              </div>
            ) : (
              !streaming.error && <span className="stream-caret text-secondary">思考中</span>
            )}
            {streaming.error && (
              <div className="mt-2 flex items-center gap-3 rounded-lg border border-danger px-3 py-2 text-sm text-danger">
                <span>出错了：{streaming.error}</span>
                <button onClick={onRetry} className="underline">
                  重试
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

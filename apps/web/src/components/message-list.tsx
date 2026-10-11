"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ChatMessage,
  DiagnosisResult,
  PreSalesCanvas,
  PreSalesResult,
  PresalesTestCase,
} from "@fde/shared";
import { PreSalesCard } from "./presales-card";
import { PresalesTestSet } from "./presales-test-set";
import { ReferenceList } from "./reference-list";

export interface StreamingState {
  text: string;
  tools: string[];
  error?: string;
  statusText?: string;
}

interface MessageListProps {
  messages: ChatMessage[];
  streaming: StreamingState | null;
  onQuickStart: (prompt: string) => void;
  onRetry: () => void;
  onConfirmCanvas?: (canvas: PreSalesCanvas, intakeMarkdown: string) => void;
  onRegenerateCanvas?: (intakeMarkdown: string) => void;
  busy?: boolean;
  showPresalesTests?: boolean;
  testSubmitted?: { caseId: string; nonce: number } | null;
  onApplyTestCase?: (testCase: PresalesTestCase) => void;
}

export function MessageList({
  messages,
  streaming,
  onQuickStart,
  onRetry,
  onConfirmCanvas,
  onRegenerateCanvas,
  busy,
  showPresalesTests,
  testSubmitted,
  onApplyTestCase,
}: MessageListProps) {
  const isEmpty = messages.length === 0 && !streaming;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
      {isEmpty && !showPresalesTests && (
        <div className="mx-auto mt-24 max-w-md text-center">
          <div className="mb-2 text-2xl font-semibold">我是 fde-agent</div>
          <p className="mb-6 text-sm text-secondary">基于知识库检索的智能工单诊断助手</p>
          <div className="flex justify-center gap-2">
            <button
              onClick={() => onQuickStart("诊断工单：")}
              className="rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-hover"
            >
              诊断一个工单
            </button>
            <button
              onClick={() => onQuickStart("__presales__")}
              className="rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-hover"
            >
              生成一份售前方案
            </button>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-3xl space-y-4">
        {showPresalesTests && onApplyTestCase && (
          <PresalesTestSet
            defaultOpen={isEmpty}
            submitted={testSubmitted}
            onApply={onApplyTestCase}
          />
        )}
        {messages.map((m, index) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[75%] whitespace-pre-wrap rounded-2xl bg-bubble-user px-4 py-2.5 text-sm">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={m.id} className="rounded-2xl px-4 py-2.5 text-sm">
              {m.scenarioResult?.scenario === "diagnosis" ? (
                <DiagnosisCard diagnosis={m.scenarioResult} />
              ) : m.scenarioResult?.scenario === "presales" ? (
                <PreSalesCard
                  result={m.scenarioResult as PreSalesResult}
                  content={m.content}
                  intakeMarkdown={findPriorUserContent(messages, index)}
                  disabled={busy}
                  onConfirmCanvas={onConfirmCanvas}
                  onRegenerateCanvas={onRegenerateCanvas}
                  anchorPrefix={`presales-${m.id}`}
                />
              ) : (
                <div className="markdown-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                </div>
              )}
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
              !streaming.error && (
                <span className="stream-caret text-secondary">
                  {streaming.statusText ?? "思考中"}
                </span>
              )
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

function findPriorUserContent(messages: ChatMessage[], assistantIndex: number): string {
  for (let i = assistantIndex - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") return messages[i].content;
  }
  return "";
}

function DiagnosisCard({ diagnosis }: { diagnosis: DiagnosisResult }) {
  const sections = [
    ["问题定位", diagnosis.location],
    ["根因分析", diagnosis.rootCause],
    ["解决方案", diagnosis.solution],
    ["预防措施", diagnosis.prevention],
  ] as const;

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-sidebar">
      <header className="border-b border-border bg-surface px-4 py-3">
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="text-xs font-medium tracking-wide text-primary">工单诊断</span>
          <span className="text-xs text-secondary">
            置信度 {Math.round(diagnosis.confidence * 100)}%
          </span>
        </div>
        <h3 className="font-semibold text-ink">{diagnosis.summary}</h3>
      </header>
      <div className="grid gap-px bg-border sm:grid-cols-2">
        {sections.map(([label, value]) => (
          <section key={label} className="bg-surface px-4 py-3">
            <h4 className="mb-1 text-xs font-medium text-secondary">{label}</h4>
            <div className="markdown-body text-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
            </div>
          </section>
        ))}
      </div>
      <footer className="border-t border-border px-4 py-2 text-xs text-secondary">
        {diagnosis.references.length > 0 ? (
          <>
            {`引用 ${diagnosis.references.length} 条知识库证据`}
            <ReferenceList references={diagnosis.references} />
          </>
        ) : (
          "知识库没有找到相关依据"
        )}
      </footer>
    </article>
  );
}

"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  PRESALES_CANVAS_FIELDS,
  PRESALES_FIELD_LABELS,
  PRESALES_SECTIONS,
  canvasFromResult,
  type PreSalesCanvas,
  type PreSalesQuestion,
  type PreSalesResult,
} from "@fde/shared";
import { downloadText, presalesFileName } from "@/lib/download";
import { ReferenceList } from "./reference-list";

const inputClass =
  "w-full min-h-10 rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-ink outline-none focus:border-primary disabled:opacity-50";

interface PreSalesCardProps {
  result: PreSalesResult;
  content: string;
  /** 画布阶段：对应的受理表 Markdown（上一轮用户消息）。 */
  intakeMarkdown?: string;
  disabled?: boolean;
  onConfirmCanvas?: (canvas: PreSalesCanvas, intakeMarkdown: string) => void;
  onRegenerateCanvas?: (intakeMarkdown: string) => void;
  /** @deprecated 历史 clarify */
  onAnswerQuestions?: (template: string) => void;
  onForceReport?: () => void;
  anchorPrefix: string;
}

export function PreSalesCard({
  result,
  content,
  intakeMarkdown,
  disabled,
  onConfirmCanvas,
  onRegenerateCanvas,
  onAnswerQuestions,
  onForceReport,
  anchorPrefix,
}: PreSalesCardProps) {
  if (result.stage === "clarify") {
    return (
      <ClarifyCard
        result={result}
        onAnswerQuestions={onAnswerQuestions}
        onForceReport={onForceReport}
      />
    );
  }
  if (result.stage === "canvas") {
    return (
      <CanvasCard
        result={result}
        intakeMarkdown={intakeMarkdown ?? ""}
        disabled={disabled}
        onConfirmCanvas={onConfirmCanvas}
        onRegenerateCanvas={onRegenerateCanvas}
      />
    );
  }
  return <ReportCard result={result} content={content} anchorPrefix={anchorPrefix} />;
}

export function buildAnswerTemplate(questions: PreSalesQuestion[]): string {
  return (
    questions.map((question, index) => `${index + 1}. ${question.question}\n   答：`).join("\n") +
    "\n"
  );
}

function CanvasCard({
  result,
  intakeMarkdown,
  disabled,
  onConfirmCanvas,
  onRegenerateCanvas,
}: {
  result: PreSalesResult;
  intakeMarkdown: string;
  disabled?: boolean;
  onConfirmCanvas?: (canvas: PreSalesCanvas, intakeMarkdown: string) => void;
  onRegenerateCanvas?: (intakeMarkdown: string) => void;
}) {
  const [canvas, setCanvas] = useState<PreSalesCanvas>(() => canvasFromResult(result));

  useEffect(() => {
    setCanvas(canvasFromResult(result));
  }, [result]);

  return (
    <div className="border-l-2 border-primary pl-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
            ② 方案画布 · 请确认
          </span>
          <span className="text-xs text-secondary">
            置信度 {Math.round(result.confidence * 100)}% · 引用 {result.references.length} 条
          </span>
        </div>
      </div>
      <p className="mb-3 text-sm text-ink">{result.summary}</p>

      <div className="space-y-3 rounded-xl border border-border bg-surface p-3">
        {PRESALES_CANVAS_FIELDS.map(([key, label]) => (
          <label key={key} className="block">
            <span className="mb-1 block text-xs font-medium text-ink">{label}</span>
            <textarea
              value={canvas[key]}
              disabled={disabled}
              rows={2}
              onChange={(event) => setCanvas({ ...canvas, [key]: event.target.value })}
              className={inputClass}
            />
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || !intakeMarkdown}
          onClick={() => onConfirmCanvas?.(canvas, intakeMarkdown)}
          className="min-h-9 rounded-lg bg-primary px-3 text-xs font-medium text-white disabled:opacity-40"
        >
          确认并生成整体方案
        </button>
        <button
          type="button"
          disabled={disabled || !intakeMarkdown}
          onClick={() => onRegenerateCanvas?.(intakeMarkdown)}
          className="min-h-9 rounded-lg border border-border px-3 text-xs text-secondary hover:bg-hover disabled:opacity-40"
        >
          重新生成画布
        </button>
      </div>

      <ReferenceList references={result.references} />
    </div>
  );
}

function ClarifyCard({
  result,
  onAnswerQuestions,
  onForceReport,
}: {
  result: PreSalesResult;
  onAnswerQuestions?: (template: string) => void;
  onForceReport?: () => void;
}) {
  return (
    <div className="border-l-2 border-primary pl-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
          售前方案 · 需要补充信息（历史）
        </span>
      </div>
      <p className="mb-3 text-sm">{result.summary}</p>
      <ol className="space-y-2">
        {(result.questions ?? []).map((question) => (
          <li key={question.id} className="text-sm">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 rounded bg-sidebar px-1.5 py-0.5 text-xs text-secondary">
                {PRESALES_FIELD_LABELS[question.field] ?? question.field}
              </span>
              <div>
                <p className="text-ink">{question.question}</p>
                <p className="text-xs text-secondary">{question.why}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>
      {(onAnswerQuestions || onForceReport) && (
        <div className="mt-3 flex gap-2">
          {onAnswerQuestions && (
            <button
              type="button"
              onClick={() => onAnswerQuestions(buildAnswerTemplate(result.questions))}
              className="min-h-9 rounded-lg bg-primary px-3 text-xs font-medium text-white"
            >
              回答这些问题
            </button>
          )}
          {onForceReport && (
            <button
              type="button"
              onClick={() => onForceReport()}
              className="min-h-9 rounded-lg border border-border px-3 text-xs text-secondary hover:bg-hover"
            >
              信息够了，直接出方案
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ReportCard({
  result,
  content,
  anchorPrefix,
}: {
  result: PreSalesResult;
  content: string;
  anchorPrefix: string;
}) {
  const scrollTo = (key: string) => {
    document.getElementById(`${anchorPrefix}-${key}`)?.scrollIntoView({ block: "start" });
  };

  return (
    <div className="border-l-2 border-success pl-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-success/10 px-1.5 py-0.5 text-xs font-medium text-success">
            ③ 售前方案报告
          </span>
          <span className="text-xs text-secondary">
            置信度 {Math.round(result.confidence * 100)}% · 引用 {result.references.length} 条
          </span>
        </div>
        <button
          type="button"
          onClick={() => downloadText(presalesFileName(result.summary, result.createdAt), content)}
          className="min-h-8 rounded-lg border border-border px-2.5 text-xs text-secondary hover:bg-hover"
        >
          下载 .md
        </button>
      </div>

      <h3 className="mb-1 text-base font-semibold text-ink">基于腾讯云 ADP 平台的销售方案报告</h3>
      <p className="mb-3 text-xs text-secondary">{result.summary}</p>

      <nav className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {PRESALES_SECTIONS.map(([key, title]) => (
          <button
            key={key}
            type="button"
            onClick={() => scrollTo(key)}
            className="text-secondary underline-offset-2 hover:text-ink hover:underline"
          >
            {title}
          </button>
        ))}
      </nav>

      {PRESALES_SECTIONS.map(([key, title]) => (
        <details key={key} id={`${anchorPrefix}-${key}`} className="mb-2" open>
          <summary className="cursor-pointer text-sm font-medium text-ink">{title}</summary>
          <div className="markdown-body mt-1 text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{result[key] || "（无）"}</ReactMarkdown>
          </div>
        </details>
      ))}

      <ReferenceList references={result.references} />
    </div>
  );
}

/** 把确认后的画布拼进受理表 Markdown，供 report phase 使用。 */
export function appendConfirmedCanvas(intakeMarkdown: string, canvas: PreSalesCanvas): string {
  const rows = PRESALES_CANVAS_FIELDS.map(
    ([key, label]) =>
      `| ${label} | ${(canvas[key] || "待客户确认").replace(/\|/g, "\\|").replace(/\n/g, "<br>")} |`,
  );
  return [
    intakeMarkdown.trim(),
    "",
    "# 已确认的方案画布（FDE 审定，整案必须以此为准）",
    "",
    "| 方案画布字段 | 内容 |",
    "|---|---|",
    ...rows,
  ].join("\n");
}

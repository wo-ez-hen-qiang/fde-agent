"use client";

import { useEffect, useState } from "react";
import {
  PRESALES_AUDIENCE_OPTIONS,
  PRESALES_EXPECTED_OUTPUT_OPTIONS,
  PRESALES_PROBLEM_OPTIONS,
  PRESALES_TEST_CASES,
  PRESALES_TEST_RECORD_KEY,
  type PresalesTestCase,
  type PresalesTestRecord,
} from "@fde/shared";
import { presalesTestRun } from "@/data/presales-test-runs";

function labelOf(options: ReadonlyArray<{ value: string; label: string }>, value: string): string {
  return options.find((item) => item.value === value)?.label ?? value;
}

function readRecords(): PresalesTestRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PRESALES_TEST_RECORD_KEY);
    const parsed = raw ? (JSON.parse(raw) as PresalesTestRecord[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRecords(records: PresalesTestRecord[]) {
  window.localStorage.setItem(PRESALES_TEST_RECORD_KEY, JSON.stringify(records));
}

interface PresalesTestSetProps {
  defaultOpen: boolean;
  submitted?: { caseId: string; nonce: number } | null;
  onApply: (testCase: PresalesTestCase) => void;
}

export function PresalesTestSet({ defaultOpen, submitted, onApply }: PresalesTestSetProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [records, setRecords] = useState<PresalesTestRecord[]>([]);

  useEffect(() => {
    setRecords(readRecords());
  }, []);

  useEffect(() => {
    if (!submitted) return;
    setRecords((prev) => {
      const next = prev.map((item) =>
        item.caseId === submitted.caseId ? { ...item, submittedAt: Date.now() } : item,
      );
      const exists = next.some((item) => item.caseId === submitted.caseId);
      const stored = exists
        ? next
        : [...next, { caseId: submitted.caseId, submittedAt: Date.now() }];
      writeRecords(stored);
      return stored;
    });
  }, [submitted]);

  const apply = (testCase: PresalesTestCase) => {
    setRecords((prev) => {
      const rest = prev.filter((item) => item.caseId !== testCase.id);
      const current = prev.find((item) => item.caseId === testCase.id);
      const stored = [
        ...rest,
        { caseId: testCase.id, filledAt: Date.now(), submittedAt: current?.submittedAt },
      ];
      writeRecords(stored);
      return stored;
    });
    setActiveId(testCase.id);
    onApply(testCase);
  };

  return (
    <section className="mb-4 rounded-2xl border border-border bg-sidebar">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-ink">{open ? "▾" : "▸"} 售前测试集</span>
        <span className="min-w-0 flex-1 truncate text-xs text-secondary">
          10 个假设客户 · 最近实跑 {presalesTestRun.cases.filter((item) => item.ok).length}/
          {presalesTestRun.cases.length} 通过画布
        </span>
      </button>
      {open && (
        <ul className="space-y-2 border-t border-border px-3 py-3">
          {PRESALES_TEST_CASES.map((testCase, index) => {
            const record = records.find((item) => item.caseId === testCase.id);
            const expanded = activeId === testCase.id;
            const run = presalesTestRun.cases.find((item) => item.id === testCase.id);
            const status = record?.submittedAt ? "已提交" : record?.filledAt ? "已填入" : "未使用";
            return (
              <li
                key={testCase.id}
                className="rounded-xl border border-border bg-surface px-3 py-2"
              >
                <button
                  type="button"
                  className="flex w-full items-start gap-2 text-left"
                  onClick={() => setActiveId(expanded ? null : testCase.id)}
                >
                  <span className="mt-0.5 w-5 shrink-0 text-xs text-secondary">{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">{testCase.title}</span>
                    <span className="block text-xs text-secondary">{testCase.blurb}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-secondary">
                    <span className="block">{status}</span>
                    {run && (
                      <span className={`block ${run.ok ? "text-success" : "text-danger"}`}>
                        {run.ok ? "画布通过" : "画布失败"}
                      </span>
                    )}
                  </span>
                </button>
                {expanded && (
                  <div className="mt-2 space-y-2 border-t border-border pt-2 text-xs text-secondary">
                    <p>
                      {testCase.intake.industry} ·{" "}
                      {testCase.intake.audience
                        .map((value) =>
                          value === "other"
                            ? testCase.intake.audienceOther || "其他"
                            : labelOf(PRESALES_AUDIENCE_OPTIONS, value),
                        )
                        .join("、")}{" "}
                      ·{" "}
                      {testCase.intake.problem
                        .map((value) => labelOf(PRESALES_PROBLEM_OPTIONS, value))
                        .join("、")}{" "}
                      · {labelOf(PRESALES_EXPECTED_OUTPUT_OPTIONS, testCase.intake.expectedOutput)}
                    </p>
                    <p className="text-ink">{testCase.intake.sceneNarrative}</p>
                    {run && (
                      <p className={run.ok ? "text-success" : "text-danger"}>
                        {run.ok
                          ? `画布已生成${run.adpMode ? ` · ${run.adpMode}` : ""}`
                          : (run.error ?? "生成失败")}
                      </p>
                    )}
                    <p>假设画像，用于试跑售前，不是真实客户。</p>
                    <button
                      type="button"
                      className="min-h-8 rounded-lg bg-primary px-3 text-xs font-medium text-white"
                      onClick={() => apply(testCase)}
                    >
                      填入受理表
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

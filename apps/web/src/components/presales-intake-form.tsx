"use client";

import { useEffect, useMemo, useState } from "react";
import {
  PRESALES_AUDIENCE_OPTIONS,
  PRESALES_EXPECTED_OUTPUT_OPTIONS,
  PRESALES_PROBLEM_OPTIONS,
  validatePresalesIntake,
  type PreSalesAudienceValue,
  type PreSalesExpectedOutputValue,
  type PreSalesIntake,
  type PreSalesProblemValue,
} from "@fde/shared";

const EMPTY: PreSalesIntake = {
  customerName: "",
  industry: "",
  audience: [],
  audienceOther: "",
  problem: [],
  problemOther: "",
  expectedOutput: "qa",
  expectedOutputOther: "",
  sceneNarrative: "",
};

const inputClass =
  "w-full min-h-9 rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-sm text-ink outline-none focus:border-primary disabled:opacity-50";

const chipBase =
  "inline-flex min-h-7 items-center rounded-md border px-2 text-xs transition-colors disabled:opacity-50";
const chipIdle = "border-border text-secondary hover:bg-hover";
const chipOn = "border-primary bg-primary/10 font-medium text-primary";

interface PreSalesIntakeFormProps {
  disabled?: boolean;
  knowledgeReady: boolean;
  knowledgeHint?: string;
  onSubmit: (intake: PreSalesIntake) => void;
  /** 测试集填入；nonce 变化时覆盖当前表单。 */
  preset?: PreSalesIntake | null;
  presetNonce?: number;
}

export function PreSalesIntakeForm({
  disabled,
  knowledgeReady,
  knowledgeHint,
  onSubmit,
  preset,
  presetNonce = 0,
}: PreSalesIntakeFormProps) {
  const [intake, setIntake] = useState<PreSalesIntake>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof PreSalesIntake, string>>>({});
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!preset || presetNonce === 0) return;
    setIntake(preset);
    setErrors({});
    setExpanded(true);
  }, [preset, presetNonce]);

  const summary = useMemo(() => {
    const parts = [
      intake.customerName.trim() || null,
      intake.industry.trim() || null,
      PRESALES_EXPECTED_OUTPUT_OPTIONS.find((item) => item.value === intake.expectedOutput)
        ?.label ?? null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : "未填写";
  }, [intake.customerName, intake.industry, intake.expectedOutput]);

  const toggleMulti = <T extends string>(
    key: "audience" | "problem",
    value: T,
    checked: boolean,
  ) => {
    setIntake((prev) => {
      const list = prev[key] as T[];
      const next = checked ? [...list, value] : list.filter((item) => item !== value);
      return { ...prev, [key]: next };
    });
  };

  const submit = () => {
    const nextErrors = validatePresalesIntake(intake);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setExpanded(true);
      return;
    }
    if (!knowledgeReady || disabled) return;
    onSubmit(intake);
    setExpanded(false);
  };

  return (
    <div className="rounded-2xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="text-sm font-semibold text-ink">① 客户基本情况</span>
        <span className="min-w-0 flex-1 truncate text-xs text-secondary">{summary}</span>
        {!expanded ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setExpanded(true)}
            className="min-h-8 shrink-0 rounded-lg bg-primary px-3 text-xs font-medium text-white disabled:opacity-40"
          >
            填写并生成画布
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="min-h-8 shrink-0 rounded-lg border border-border px-3 text-xs text-secondary hover:bg-hover"
          >
            收起
          </button>
        )}
      </div>

      {expanded && (
        <div className="max-h-[min(52vh,28rem)] space-y-3 overflow-y-auto border-t border-border px-3 py-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-3">
              <InlineField label="客户名称" error={errors.customerName}>
                <input
                  value={intake.customerName}
                  onChange={(event) => setIntake({ ...intake, customerName: event.target.value })}
                  disabled={disabled}
                  className={inputClass}
                  placeholder="如：某银行零售部"
                />
              </InlineField>
              <InlineField label="行业 / 部门" error={errors.industry}>
                <input
                  value={intake.industry}
                  onChange={(event) => setIntake({ ...intake, industry: event.target.value })}
                  disabled={disabled}
                  className={inputClass}
                  placeholder="如：金融 / 零售银行"
                />
              </InlineField>
              <Field label="场景一句话" error={errors.sceneNarrative}>
                <textarea
                  value={intake.sceneNarrative}
                  onChange={(event) => setIntake({ ...intake, sceneNarrative: event.target.value })}
                  disabled={disabled}
                  rows={2}
                  className={inputClass}
                  placeholder="如：柜面查制度靠翻 PDF，口径不一"
                />
              </Field>
            </div>

            <div className="space-y-3">
              <Field label="目标用户" error={errors.audience ?? errors.audienceOther}>
                <div className="flex flex-wrap gap-1.5">
                  {PRESALES_AUDIENCE_OPTIONS.map((option) => {
                    const on = intake.audience.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        disabled={disabled}
                        aria-pressed={on}
                        onClick={() =>
                          toggleMulti("audience", option.value as PreSalesAudienceValue, !on)
                        }
                        className={`${chipBase} ${on ? chipOn : chipIdle}`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                {intake.audience.includes("other") && (
                  <input
                    value={intake.audienceOther ?? ""}
                    onChange={(event) =>
                      setIntake({ ...intake, audienceOther: event.target.value })
                    }
                    disabled={disabled}
                    className={`${inputClass} mt-1.5`}
                    placeholder="其他用户说明"
                  />
                )}
              </Field>

              <Field label="当前业务问题" error={errors.problem ?? errors.problemOther}>
                <div className="flex flex-wrap gap-1.5">
                  {PRESALES_PROBLEM_OPTIONS.map((option) => {
                    const on = intake.problem.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        disabled={disabled}
                        aria-pressed={on}
                        onClick={() =>
                          toggleMulti("problem", option.value as PreSalesProblemValue, !on)
                        }
                        className={`${chipBase} ${on ? chipOn : chipIdle}`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                {intake.problem.includes("other") && (
                  <input
                    value={intake.problemOther ?? ""}
                    onChange={(event) => setIntake({ ...intake, problemOther: event.target.value })}
                    disabled={disabled}
                    className={`${inputClass} mt-1.5`}
                    placeholder="其他问题说明"
                  />
                )}
              </Field>

              <Field label="期望输出" error={errors.expectedOutput ?? errors.expectedOutputOther}>
                <div className="flex flex-wrap gap-1.5">
                  {PRESALES_EXPECTED_OUTPUT_OPTIONS.map((option) => {
                    const on = intake.expectedOutput === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        disabled={disabled}
                        aria-pressed={on}
                        onClick={() =>
                          setIntake({
                            ...intake,
                            expectedOutput: option.value as PreSalesExpectedOutputValue,
                          })
                        }
                        className={`${chipBase} ${on ? chipOn : chipIdle}`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                {intake.expectedOutput === "other" && (
                  <input
                    value={intake.expectedOutputOther ?? ""}
                    onChange={(event) =>
                      setIntake({ ...intake, expectedOutputOther: event.target.value })
                    }
                    disabled={disabled}
                    className={`${inputClass} mt-1.5`}
                    placeholder="其他期望输出"
                  />
                )}
              </Field>
            </div>
          </div>

          {!knowledgeReady && knowledgeHint && (
            <p className="text-xs text-warning">{knowledgeHint}</p>
          )}

          <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-surface pt-2">
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="min-h-9 rounded-lg border border-border px-3 text-xs text-secondary hover:bg-hover"
            >
              收起
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={disabled || !knowledgeReady}
              className="min-h-9 rounded-lg bg-primary px-4 text-xs font-medium text-white disabled:opacity-40"
            >
              生成方案画布
            </button>
          </div>
        </div>
      )}

      {!expanded && !knowledgeReady && knowledgeHint && (
        <p className="border-t border-border px-3 py-1.5 text-xs text-warning">{knowledgeHint}</p>
      )}
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-ink">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </div>
  );
}

function InlineField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid grid-cols-[5.5rem_1fr] items-center gap-2">
      <span className="text-xs font-medium text-ink">{label}</span>
      <span className="min-w-0">
        {children}
        {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
      </span>
    </label>
  );
}

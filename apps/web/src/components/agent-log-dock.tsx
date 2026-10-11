"use client";

import { useState } from "react";
import type { AgentLogEvent } from "@fde/shared";

const MAX_DOCK = 100;

interface AgentLogDockProps {
  logs: AgentLogEvent[];
  onClear?: () => void;
}

export function AgentLogDock({ logs, onClear }: AgentLogDockProps) {
  const [open, setOpen] = useState(false);
  const visible = logs.slice(-MAX_DOCK);
  const latest = visible[visible.length - 1];

  if (visible.length === 0) return null;

  return (
    <div className="border-t border-border bg-sidebar text-xs text-secondary">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="shrink-0 font-medium text-ink">{open ? "▾" : "▸"} 运行日志</span>
        <span className="min-w-0 flex-1 truncate font-mono">
          {latest ? `[${latest.tag}] ${latest.message}` : ""}
        </span>
        <span className="shrink-0 tabular-nums">{visible.length}</span>
      </button>
      {open ? (
        <div className="max-h-40 overflow-y-auto border-t border-border px-3 py-2 font-mono">
          <div className="mb-1 flex justify-end">
            {onClear ? (
              <button
                type="button"
                className="text-[11px] text-secondary hover:text-ink"
                onClick={onClear}
              >
                清空
              </button>
            ) : null}
          </div>
          <ul className="space-y-0.5">
            {visible.map((entry, index) => (
              <li
                key={`${entry.ts}-${index}`}
                className={
                  entry.level === "error"
                    ? "text-danger"
                    : entry.level === "warn"
                      ? "text-warning"
                      : "text-secondary"
                }
              >
                <span className="text-ink">[{entry.tag}]</span> {entry.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

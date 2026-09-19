"use client";

import type { ChatSession } from "@fde/shared";

interface SidebarProps {
  sessions: ChatSession[];
  currentId?: string;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function Sidebar({ sessions, currentId, onNewChat, onSelect, onDelete }: SidebarProps) {
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex items-center gap-2 px-4 py-4">
        <span className="text-lg font-semibold text-primary">fde-agent</span>
      </div>

      <button
        onClick={onNewChat}
        className="mx-3 mb-3 rounded-lg bg-primary px-3 py-2 text-left text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        + 新建对话
      </button>

      <div className="px-4 pb-1 text-xs text-secondary">历史对话</div>
      <div className="flex-1 overflow-y-auto px-2">
        {sessions.length === 0 && (
          <div className="px-2 py-6 text-center text-xs text-secondary">暂无历史对话</div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`group mb-0.5 flex cursor-pointer items-center justify-between rounded-lg px-2 py-2 text-sm hover:bg-hover ${
              s.id === currentId ? "bg-hover" : ""
            }`}
          >
            <span className="truncate">{s.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`删除会话「${s.title}」？`)) onDelete(s.id);
              }}
              className="ml-1 hidden shrink-0 text-xs opacity-60 group-hover:block hover:opacity-100"
              title="删除会话"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="border-t border-border px-4 py-3 text-xs text-secondary">
        知识库 · 设置（后续里程碑）
      </div>
    </aside>
  );
}

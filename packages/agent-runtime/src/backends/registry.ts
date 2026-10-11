import type { AgentBackend, AgentBackendId, AgentBackendStatus } from "@fde/shared";
import { ApiAgentBackend } from "./api.js";
import { ClaudeCliBackend } from "./claude.js";
import { CodexCliBackend } from "./codex.js";
import { CursorCliBackend } from "./cursor.js";

const backends: Record<AgentBackendId, AgentBackend> = {
  api: new ApiAgentBackend(),
  "claude-cli": new ClaudeCliBackend(),
  "codex-cli": new CodexCliBackend(),
  "cursor-cli": new CursorCliBackend(),
};

const BACKEND_IDS = Object.keys(backends) as AgentBackendId[];

export function isAgentBackendId(value: string | undefined): value is AgentBackendId {
  return Boolean(value && BACKEND_IDS.includes(value as AgentBackendId));
}

export function defaultAgentBackendId(): AgentBackendId {
  const configured = process.env.FDE_DEFAULT_BACKEND?.trim();
  return isAgentBackendId(configured) ? configured : "api";
}

export function resolveAgentBackend(id?: string): AgentBackend {
  const selected = id ?? defaultAgentBackendId();
  if (!isAgentBackendId(selected)) throw new Error(`未知后端：${selected}`);
  return backends[selected];
}

export async function inspectAgentBackends(): Promise<AgentBackendStatus[]> {
  return Promise.all(Object.values(backends).map((backend) => backend.inspect()));
}

export async function closeAgentBackends(): Promise<void> {
  await Promise.all(Object.values(backends).map((backend) => backend.close()));
}

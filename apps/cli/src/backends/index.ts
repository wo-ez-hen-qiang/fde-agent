import type { AgentBackend } from "./types.js";
import { ApiBackend } from "./api-backend.js";
import { cliBackends } from "./cli-backend.js";

export * from "./types.js";

export function allBackends(): AgentBackend[] {
  return [new ApiBackend(), ...cliBackends()];
}

export function resolveBackend(id: string): AgentBackend | undefined {
  return allBackends().find((b) => b.id === id);
}

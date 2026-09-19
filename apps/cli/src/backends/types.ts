import type { CliAuthMode } from "@fde/shared";

export interface BackendChatRequest {
  message: string;
  /** Model alias, only meaningful for the api backend. */
  model?: string;
  knowledgeBaseId?: string;
}

/**
 * CLI backend abstraction - the piece that lets fde switch between
 * coding CLIs (claude/codex/cursor, on subscription quota or API key)
 * and direct vendor APIs.
 */
export interface AgentBackend {
  readonly id: string;
  readonly label: string;
  readonly kind: "cli" | "api";
  /** Whether this backend is usable right now (binary present / key configured). */
  isAvailable(): Promise<boolean>;
  chat(req: BackendChatRequest, auth: CliAuthMode): AsyncIterable<string>;
}

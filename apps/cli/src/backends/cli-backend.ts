import { spawn, type ChildProcess } from "node:child_process";
import type { CliAuthMode } from "@fde/shared";
import type { AgentBackend, BackendChatRequest } from "./types.js";

interface CliSpec {
  id: string;
  label: string;
  /** env var holding the binary path/name */
  binEnv: string;
  defaultBin: string;
  /** env var injected in apikey mode */
  apiKeyEnv: string;
  /** build argv for a one-shot prompt */
  args: (prompt: string) => string[];
}

const CLI_SPECS: CliSpec[] = [
  {
    id: "claude-cli",
    label: "Claude Code CLI",
    binEnv: "FDE_CLI_CLAUDE_BIN",
    defaultBin: "claude",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    args: (prompt) => ["-p", prompt],
  },
  {
    id: "codex-cli",
    label: "Codex CLI",
    binEnv: "FDE_CLI_CODEX_BIN",
    defaultBin: "codex",
    apiKeyEnv: "OPENAI_API_KEY",
    args: (prompt) => ["exec", prompt],
  },
  {
    id: "cursor-cli",
    label: "Cursor CLI",
    binEnv: "FDE_CLI_CURSOR_BIN",
    defaultBin: "cursor-agent",
    apiKeyEnv: "CURSOR_API_KEY",
    args: (prompt) => ["-p", prompt],
  },
];

/**
 * Wraps an installed coding CLI as a backend.
 * - auth="subscription": run as-is, the CLI uses its logged-in subscription quota.
 * - auth="apikey": inject the vendor API key into the subprocess env.
 */
export class CliBackend implements AgentBackend {
  readonly kind = "cli" as const;

  constructor(private readonly spec: CliSpec) {}

  get id(): string {
    return this.spec.id;
  }
  get label(): string {
    return this.spec.label;
  }

  private get bin(): string {
    return process.env[this.spec.binEnv] ?? this.spec.defaultBin;
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(this.bin, ["--version"], { stdio: "ignore" });
      child.on("error", () => resolve(false));
      child.on("exit", () => resolve(true));
    });
  }

  async *chat(req: BackendChatRequest, auth: CliAuthMode): AsyncIterable<string> {
    const env = { ...process.env };
    if (auth === "apikey") {
      const key = process.env[this.spec.apiKeyEnv];
      if (!key) {
        yield `[错误] apikey 模式需要设置 ${this.spec.apiKeyEnv}`;
        return;
      }
      env[this.spec.apiKeyEnv] = key;
    }

    const child: ChildProcess = spawn(this.bin, this.spec.args(req.message), {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const queue: string[] = [];
    // object wrapper: TS control-flow narrowing can't see closure assignments
    const status = { done: false, failed: null as Error | null };

    child.stdout?.on("data", (chunk: Buffer) => queue.push(chunk.toString("utf8")));
    child.stderr?.on("data", (chunk: Buffer) => {
      // CLIs print progress to stderr; surface only on failure
      if (process.env.FDE_DEBUG) queue.push(`[stderr] ${chunk.toString("utf8")}`);
    });
    child.on("error", (err) => {
      status.failed = err;
      status.done = true;
    });
    child.on("exit", () => {
      status.done = true;
    });

    while (!status.done || queue.length > 0) {
      const chunk = queue.shift();
      if (chunk !== undefined) {
        yield chunk;
      } else {
        await new Promise((r) => setTimeout(r, 30));
      }
    }
    if (status.failed) yield `[错误] 无法启动 ${this.bin}: ${status.failed.message}`;
  }
}

export function cliBackends(): CliBackend[] {
  return CLI_SPECS.map((spec) => new CliBackend(spec));
}

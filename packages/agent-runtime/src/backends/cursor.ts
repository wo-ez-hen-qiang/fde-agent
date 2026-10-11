import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import type {
  AgentBackend,
  AgentBackendStatus,
  AgentRunRequest,
  ChatStreamEvent,
  DiagnosisResult,
  ScenarioResult,
  StructuredScenarioId,
} from "@fde/shared";
import { preparePrompt } from "./prompts.js";
import { getScenario, structuredScenario } from "../scenarios/index.js";
import { backendTimeoutMs, runCommand } from "./process.js";
import { agentLog } from "../log.js";

interface CursorCapture {
  error?: string;
}

interface CursorMessage {
  type?: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  timestamp_ms?: number;
  model_call_id?: string;
  message?: {
    content?: Array<{ type?: string; text?: string }>;
  };
  result?: string;
  duration_ms?: number;
  is_error?: boolean;
}

function cursorBinary(): string {
  return process.env.FDE_CURSOR_BIN?.trim() || process.env.FDE_CLI_CURSOR_BIN?.trim() || "agent";
}

function assistantDeltaText(message: CursorMessage): string {
  const parts = message.message?.content ?? [];
  return parts.map((part) => (part.type === "text" || part.text ? (part.text ?? "") : "")).join("");
}

/** Streaming delta: has timestamp_ms, no model_call_id (skip duplicate flushes). */
function isStreamingDelta(message: CursorMessage): boolean {
  return message.timestamp_ms !== undefined && message.model_call_id === undefined;
}

export class CursorCliBackend implements AgentBackend {
  readonly id = "cursor-cli" as const;

  private get binary(): string {
    return cursorBinary();
  }

  async inspect(): Promise<AgentBackendStatus> {
    const version = await runCommand(this.binary, ["--version"]);
    if (!version.ok) {
      return {
        id: this.id,
        label: "Cursor CLI",
        installed: false,
        configured: false,
        available: false,
        detail:
          "未安装 Cursor Agent CLI（官方：curl https://cursor.com/install -fsS | bash；二进制名 agent）",
      };
    }

    const statusJson = await runCommand(this.binary, ["status", "--format", "json"]);
    const statusText = statusJson.ok ? statusJson : await runCommand(this.binary, ["status"]);
    const hasApiKey = Boolean(process.env.CURSOR_API_KEY?.trim());
    const statusOutput = `${statusText.stdout}\n${statusText.stderr}`.trim();
    // `agent status` often exits 0 even when logged out; parse the body.
    const explicitlyLoggedOut = /not logged in/i.test(statusOutput);
    let configured = hasApiKey || (statusText.ok && !explicitlyLoggedOut && Boolean(statusOutput));
    let modelLabel: string | undefined;
    let detail = statusOutput;

    if (statusJson.ok && statusJson.stdout) {
      try {
        const parsed = JSON.parse(statusJson.stdout) as {
          loggedIn?: boolean;
          isAuthenticated?: boolean;
          status?: string;
          email?: string;
          authMethod?: string;
          message?: string;
        };
        const authFlag =
          typeof parsed.isAuthenticated === "boolean"
            ? parsed.isAuthenticated
            : typeof parsed.loggedIn === "boolean"
              ? parsed.loggedIn
              : parsed.status === "authenticated";
        configured = authFlag || hasApiKey;
        modelLabel = parsed.authMethod ?? (parsed.email ? `登录：${parsed.email}` : undefined);
        detail = configured
          ? parsed.email
            ? `已登录（${parsed.email}）`
            : hasApiKey
              ? "已配置 CURSOR_API_KEY"
              : "已配置"
          : parsed.message?.trim() || "已安装，尚未登录（agent login）或配置 CURSOR_API_KEY";
      } catch {
        // fall through to text heuristics below
      }
    }

    if (!statusJson.ok || detail === statusOutput) {
      if (hasApiKey) {
        configured = true;
        detail = "已配置 CURSOR_API_KEY";
      } else if (explicitlyLoggedOut || !configured) {
        configured = false;
        detail = "已安装，尚未登录（agent login）或配置 CURSOR_API_KEY";
      } else {
        detail = statusOutput || "已配置";
      }
    }

    return {
      id: this.id,
      label: "Cursor CLI",
      installed: true,
      configured,
      available: configured,
      version: version.stdout,
      modelLabel,
      detail,
    };
  }

  async *streamChat(request: AgentRunRequest): AsyncIterable<ChatStreamEvent> {
    agentLog("backend:cursor-cli", "streamChat 开始");
    const prepared = await preparePrompt(request, "chat");
    const systemPrompt = getScenario("chat").systemPrompt;
    yield* this.run(request, prepared.prompt, systemPrompt, {});
  }

  async runScenario(
    scenario: StructuredScenarioId,
    request: AgentRunRequest,
  ): Promise<ScenarioResult> {
    const definition = structuredScenario(scenario);
    if (!request.knowledgeBaseId) throw new Error(`${definition.label}需要 knowledgeBaseId`);
    agentLog(
      `scenario:${scenario}:start`,
      `backend=cursor-cli` + (request.presalesPhase ? ` phase=${request.presalesPhase}` : ""),
    );
    const prepared = await preparePrompt(request, scenario);
    const capture: CursorCapture = {};
    let text = "";
    for await (const event of this.run(
      request,
      prepared.prompt,
      definition.systemPrompt,
      capture,
    )) {
      if (event.type === "delta") text += event.text;
    }
    if (capture.error) throw new Error(capture.error);
    const result = definition.parse(text, prepared.references);
    agentLog(
      `scenario:${scenario}:done`,
      scenario === "presales" && "stage" in result ? `stage=${result.stage}` : "ok",
    );
    return result;
  }

  async diagnose(request: AgentRunRequest): Promise<DiagnosisResult> {
    return (await this.runScenario("diagnosis", request)) as DiagnosisResult;
  }

  async close(): Promise<void> {}

  private async *run(
    request: AgentRunRequest,
    prompt: string,
    systemPrompt: string,
    capture: CursorCapture,
  ): AsyncIterable<ChatStreamEvent> {
    // Cursor CLI has no --system-prompt; fold instructions into the user prompt.
    const fullPrompt = systemPrompt ? `系统指令：\n${systemPrompt}\n\n---\n\n${prompt}` : prompt;

    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--mode",
      "ask",
      "--trust",
      "--workspace",
      tmpdir(),
    ];
    if (request.providerSessionId) args.push("--resume", request.providerSessionId);
    args.push(fullPrompt);

    const child = spawn(this.binary, args, {
      cwd: tmpdir(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let emittedText = false;
    let emittedSession = false;
    const startedAt = Date.now();
    let timedOut = false;
    const stop = () => child.kill("SIGTERM");
    request.signal?.addEventListener("abort", stop, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, backendTimeoutMs());
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-4000);
    });
    const exit = new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", resolve);
    });

    try {
      const lines = createInterface({ input: child.stdout });
      for await (const line of lines) {
        let message: CursorMessage;
        try {
          message = JSON.parse(line) as CursorMessage;
        } catch {
          continue;
        }

        if (!emittedSession && message.session_id) {
          emittedSession = true;
          yield {
            type: "backend_session",
            sessionId: message.session_id,
            model: message.model,
          };
        }

        if (message.type === "assistant" && isStreamingDelta(message)) {
          const text = assistantDeltaText(message);
          if (text) {
            emittedText = true;
            yield { type: "delta", text };
          }
        } else if (message.type === "result") {
          if (message.is_error || message.subtype === "error") {
            capture.error = message.result || "Cursor CLI 返回错误";
            yield { type: "error", message: capture.error };
          } else {
            if (!emittedText && message.result) yield { type: "delta", text: message.result };
            yield {
              type: "usage",
              usage: {
                latencyMs: message.duration_ms ?? Date.now() - startedAt,
              },
            };
          }
        }
      }

      const code = await exit;
      if (code !== 0 && !capture.error) {
        capture.error = request.signal?.aborted
          ? "请求已停止"
          : timedOut
            ? `Cursor CLI 被超时终止（${Math.round(backendTimeoutMs() / 1000)}s），stderr 尾部如下：${stderr.trim() || "（空）"}`
            : stderr.trim() || "Cursor CLI 异常退出";
        yield { type: "error", message: capture.error };
      } else if (!capture.error) {
        yield { type: "done", messageId: "" };
      }
    } catch (error) {
      capture.error = request.signal?.aborted
        ? "请求已停止"
        : error instanceof Error
          ? error.message
          : String(error);
      yield { type: "error", message: capture.error };
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", stop);
      if (child.exitCode === null) child.kill("SIGTERM");
    }
  }
}

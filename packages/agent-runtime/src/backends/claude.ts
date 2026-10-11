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

interface ClaudeCapture {
  structured?: unknown;
  error?: string;
}

interface ClaudeMessage {
  type?: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  event?: {
    type?: string;
    delta?: { type?: string; text?: string };
  };
  result?: string;
  structured_output?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number };
  errors?: string[];
  is_error?: boolean;
}

export class ClaudeCliBackend implements AgentBackend {
  readonly id = "claude-cli" as const;

  private get binary(): string {
    return process.env.FDE_CLAUDE_BIN?.trim() || "claude";
  }

  async inspect(): Promise<AgentBackendStatus> {
    const version = await runCommand(this.binary, ["--version"]);
    if (!version.ok) {
      return {
        id: this.id,
        label: "Claude CLI",
        installed: false,
        configured: false,
        available: false,
        detail: "未安装 Claude CLI",
      };
    }
    const auth = await runCommand(this.binary, ["auth", "status"]);
    let modelLabel: string | undefined;
    try {
      const status = JSON.parse(auth.stdout || "{}") as { apiProvider?: string };
      modelLabel = status.apiProvider;
    } catch {
      modelLabel = undefined;
    }
    return {
      id: this.id,
      label: "Claude CLI",
      installed: true,
      configured: auth.ok,
      available: auth.ok,
      version: version.stdout,
      modelLabel,
      detail: auth.ok ? "已登录或已配置网关" : "已安装，尚未登录或配置上游模型",
    };
  }

  async *streamChat(request: AgentRunRequest): AsyncIterable<ChatStreamEvent> {
    agentLog("backend:claude-cli", "streamChat 开始");
    const prepared = await preparePrompt(request, "chat");
    yield* this.run(request, prepared.prompt, getScenario("chat").systemPrompt, undefined, {});
  }

  async runScenario(
    scenario: StructuredScenarioId,
    request: AgentRunRequest,
  ): Promise<ScenarioResult> {
    const definition = structuredScenario(scenario);
    if (!request.knowledgeBaseId) throw new Error(`${definition.label}需要 knowledgeBaseId`);
    agentLog(
      `scenario:${scenario}:start`,
      `backend=claude-cli` + (request.presalesPhase ? ` phase=${request.presalesPhase}` : ""),
    );
    const prepared = await preparePrompt(request, scenario);
    const capture: ClaudeCapture = {};
    let text = "";
    for await (const event of this.run(
      request,
      prepared.prompt,
      definition.systemPrompt,
      definition.jsonSchema,
      capture,
    )) {
      if (event.type === "delta") text += event.text;
    }
    if (capture.error) throw new Error(capture.error);
    const result = definition.parse(capture.structured ?? text, prepared.references);
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
    outputSchema: Record<string, unknown> | undefined,
    capture: ClaudeCapture,
  ): AsyncIterable<ChatStreamEvent> {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--disable-slash-commands",
      "--strict-mcp-config",
      "--tools",
      "",
      "--permission-mode",
      "dontAsk",
      "--permission-prompts",
      "none",
      "--setting-sources",
      "user",
      "--system-prompt",
      systemPrompt,
    ];
    if (request.providerSessionId) args.push("--resume", request.providerSessionId);
    if (outputSchema) args.push("--json-schema", JSON.stringify(outputSchema));
    args.push(prompt);

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
        let message: ClaudeMessage;
        try {
          message = JSON.parse(line) as ClaudeMessage;
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

        if (message.type === "stream_event") {
          const event = message.event;
          if (event?.type === "content_block_delta" && event.delta?.type === "text_delta") {
            const text = event.delta.text ?? "";
            if (text) {
              emittedText = true;
              yield { type: "delta", text };
            }
          }
        } else if (message.type === "result") {
          if (message.subtype === "success" && !message.is_error) {
            capture.structured = message.structured_output;
            if (!emittedText && message.result) yield { type: "delta", text: message.result };
            yield {
              type: "usage",
              usage: {
                inputTokens: message.usage?.input_tokens,
                outputTokens: message.usage?.output_tokens,
                latencyMs: Date.now() - startedAt,
              },
            };
          } else {
            capture.error = message.errors?.join("；") || message.result || message.subtype;
            yield { type: "error", message: capture.error || "Claude CLI 返回错误" };
          }
        }
      }

      const code = await exit;
      if (code !== 0 && !capture.error) {
        capture.error = request.signal?.aborted
          ? "请求已停止"
          : timedOut
            ? `Claude CLI 被超时终止（${Math.round(backendTimeoutMs() / 1000)}s），stderr 尾部如下：${stderr.trim() || "（空）"}`
            : stderr.trim() || "Claude CLI 异常退出";
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

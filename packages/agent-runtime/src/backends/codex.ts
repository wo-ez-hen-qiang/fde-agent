import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import type {
  AgentBackend,
  AgentBackendStatus,
  AgentRunRequest,
  ChatStreamEvent,
  ChatUsage,
  DiagnosisResult,
  ScenarioResult,
  StructuredScenarioId,
} from "@fde/shared";
import { preparePrompt } from "./prompts.js";
import { getScenario, structuredScenario } from "../scenarios/index.js";
import { backendTimeoutMs, runCommand } from "./process.js";
import { agentLog } from "../log.js";

type JsonRecord = Record<string, unknown>;

interface RpcNotification {
  method: string;
  params?: JsonRecord;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

class CodexRpcConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly notifications: RpcNotification[] = [];
  private readonly waiters: Array<{
    resolve: (notification: RpcNotification) => void;
    reject: (reason: Error) => void;
  }> = [];
  private nextId = 1;
  private stderr = "";
  private closed = false;

  constructor(binary: string) {
    this.child = spawn(binary, ["app-server", "--stdio"], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString("utf8")).slice(-4000);
    });
    this.child.on("error", (error) => this.fail(error));
    this.child.on("exit", (code) => {
      if (!this.closed) {
        const detail = this.stderr.trim();
        this.fail(
          new Error(
            `Codex app-server 已退出（${code ?? "unknown"}）${detail ? `：${detail}` : ""}`,
          ),
        );
      }
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: { name: "fde-agent", title: "fde-agent", version: "0.1.0" },
      capabilities: null,
    });
    this.notify("initialized");
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Codex app-server 已关闭"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
  }

  nextNotification(): Promise<RpcNotification> {
    const queued = this.notifications.shift();
    if (queued) return Promise.resolve(queued);
    if (this.closed) return Promise.reject(new Error("Codex app-server 已关闭"));
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.child.kill("SIGTERM");
    this.fail(new Error("Codex app-server 已关闭"));
  }

  private write(value: unknown): void {
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  private handleLine(line: string): void {
    let message: JsonRecord;
    try {
      message = JSON.parse(line) as JsonRecord;
    } catch {
      return;
    }

    const id = typeof message.id === "number" ? message.id : undefined;
    const method = typeof message.method === "string" ? message.method : undefined;
    if (id !== undefined && method) {
      this.denyServerRequest(id, method);
      return;
    }
    if (id !== undefined) {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (message.error) {
        const error = message.error as { message?: string };
        pending.reject(new Error(error.message ?? "Codex JSON-RPC 请求失败"));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (!method) return;
    const notification = { method, params: message.params as JsonRecord | undefined };
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(notification);
    else this.notifications.push(notification);
  }

  private denyServerRequest(id: number, method: string): void {
    if (method === "item/commandExecution/requestApproval") {
      this.write({ jsonrpc: "2.0", id, result: { decision: "decline" } });
    } else if (method === "item/fileChange/requestApproval") {
      this.write({ jsonrpc: "2.0", id, result: { decision: "decline" } });
    } else {
      this.write({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "fde-agent does not allow interactive tools" },
      });
    }
  }

  private fail(error: Error): void {
    if (!this.closed) this.closed = true;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }
}

interface CodexCapture {
  error?: string;
}

export class CodexCliBackend implements AgentBackend {
  readonly id = "codex-cli" as const;

  private get binary(): string {
    return process.env.FDE_CODEX_BIN?.trim() || "codex";
  }

  async inspect(): Promise<AgentBackendStatus> {
    const version = await runCommand(this.binary, ["--version"]);
    if (!version.ok) {
      return {
        id: this.id,
        label: "Codex CLI",
        installed: false,
        configured: false,
        available: false,
        detail: "未安装 Codex CLI",
      };
    }
    const login = await runCommand(this.binary, ["login", "status"]);
    const configured = login.ok || Boolean(process.env.OPENAI_API_KEY);
    return {
      id: this.id,
      label: "Codex CLI",
      installed: true,
      configured,
      available: configured,
      version: version.stdout.replace(/^WARNING:.*\n?/gm, "").trim(),
      modelLabel: "使用 Codex 当前配置",
      detail: configured ? login.stdout || "已配置 API 凭据" : "已安装，尚未登录或配置上游模型",
    };
  }

  async *streamChat(request: AgentRunRequest): AsyncIterable<ChatStreamEvent> {
    agentLog("backend:codex-cli", "streamChat 开始");
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
      `backend=codex-cli` + (request.presalesPhase ? ` phase=${request.presalesPhase}` : ""),
    );
    const prepared = await preparePrompt(request, scenario);
    const capture: CodexCapture = {};
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
    developerInstructions: string,
    outputSchema: Record<string, unknown> | undefined,
    capture: CodexCapture,
  ): AsyncIterable<ChatStreamEvent> {
    const rpc = new CodexRpcConnection(this.binary);
    const startedAt = Date.now();
    const deadline = Date.now() + backendTimeoutMs();
    let threadId = request.providerSessionId;
    let turnId: string | undefined;
    let usage: ChatUsage | undefined;
    let rejectAbort: ((error: Error) => void) | undefined;
    const onAbort = () => rejectAbort?.(new Error("请求已停止"));
    const abortPromise = new Promise<never>((_, reject) => {
      rejectAbort = reject;
      if (request.signal?.aborted) onAbort();
      else request.signal?.addEventListener("abort", onAbort, { once: true });
    });
    let timeoutHandle: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error("Codex CLI 响应超时")), backendTimeoutMs());
    });

    try {
      await rpc.initialize();
      if (threadId) {
        try {
          await rpc.request("thread/resume", {
            threadId,
            cwd: tmpdir(),
            approvalPolicy: "never",
            approvalsReviewer: "user",
            sandbox: "read-only",
            developerInstructions,
            excludeTurns: true,
          });
        } catch {
          threadId = undefined;
        }
      }
      if (!threadId) {
        const started = await rpc.request<{ thread: { id: string }; model?: string }>(
          "thread/start",
          {
            cwd: tmpdir(),
            approvalPolicy: "never",
            approvalsReviewer: "user",
            sandbox: "read-only",
            developerInstructions,
            ephemeral: false,
            serviceName: "fde-agent",
          },
        );
        threadId = started.thread.id;
        yield { type: "backend_session", sessionId: threadId, model: started.model };
      } else {
        yield { type: "backend_session", sessionId: threadId };
      }

      const turn = await rpc.request<{ turn: { id: string } }>("turn/start", {
        threadId,
        input: [{ type: "text", text: prompt, text_elements: [] }],
        approvalPolicy: "never",
        approvalsReviewer: "user",
        ...(outputSchema ? { outputSchema } : {}),
      });
      turnId = turn.turn.id;

      for (;;) {
        if (request.signal?.aborted) {
          await rpc.request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
          throw new Error("请求已停止");
        }
        if (Date.now() > deadline) {
          await rpc.request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
          throw new Error("Codex CLI 响应超时");
        }

        const notification = await Promise.race([
          rpc.nextNotification(),
          abortPromise,
          timeoutPromise,
        ]);
        const params = notification.params ?? {};
        if (notification.method === "item/agentMessage/delta") {
          if (
            params.threadId === threadId &&
            params.turnId === turnId &&
            typeof params.delta === "string"
          ) {
            yield { type: "delta", text: params.delta };
          }
        } else if (notification.method === "thread/tokenUsage/updated") {
          const tokenUsage = params.tokenUsage as
            { last?: { inputTokens?: number; outputTokens?: number } } | undefined;
          usage = {
            inputTokens: tokenUsage?.last?.inputTokens,
            outputTokens: tokenUsage?.last?.outputTokens,
            latencyMs: Date.now() - startedAt,
          };
        } else if (notification.method === "error") {
          const error = params.error as { message?: string } | undefined;
          capture.error = error?.message ?? "Codex CLI 返回错误";
        } else if (notification.method === "turn/completed") {
          const completed = params.turn as
            { id?: string; status?: string; error?: { message?: string } | null } | undefined;
          if (completed?.id !== turnId) continue;
          if (completed.status !== "completed") {
            capture.error =
              completed.error?.message ?? `Codex turn ${completed.status ?? "failed"}`;
          }
          break;
        }
      }

      if (capture.error) yield { type: "error", message: capture.error };
      else {
        yield { type: "usage", usage: usage ?? { latencyMs: Date.now() - startedAt } };
        yield { type: "done", messageId: "" };
      }
    } catch (error) {
      if (threadId && turnId && (request.signal?.aborted || Date.now() > deadline)) {
        await rpc.request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
      }
      capture.error = error instanceof Error ? error.message : String(error);
      yield { type: "error", message: capture.error };
    } finally {
      clearTimeout(timeoutHandle!);
      request.signal?.removeEventListener("abort", onAbort);
      rpc.close();
    }
  }
}

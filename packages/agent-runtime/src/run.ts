import { run } from "@openai/agents";
import type { Agent } from "@openai/agents";
import type { ChatStreamEvent, DiagnosisReference } from "@fde/shared";
import type { DiagnosisOutput } from "./agents.js";

/**
 * Agent is invariant in its output-type parameter (the instructions callback
 * receives Agent<TContext, TOutput>), so chat/diagnosis agents are not
 * assignable to Agent<unknown, "text">. Accept any output shape instead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAgent = Agent<any, any>;

export interface RunChatOptions {
  agent: AnyAgent;
  input: string;
  /** Prior conversation turns, oldest first, as plain text context. */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

function buildInput(opts: RunChatOptions): string {
  if (!opts.history?.length) return opts.input;
  const lines = opts.history
    .slice(-20)
    .map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.content}`);
  return `以下是历史对话：\n${lines.join("\n")}\n\n用户: ${opts.input}`;
}

/**
 * Stream a chat run as normalized ChatStreamEvent items.
 * Consumed by the web SSE route, the CLI renderer, and bot adapters alike.
 */
export async function* streamChat(opts: RunChatOptions): AsyncGenerator<ChatStreamEvent> {
  const startedAt = Date.now();
  try {
    const result = await run(opts.agent, buildInput(opts), { stream: true });

    for await (const event of result) {
      if (event.type === "raw_model_stream_event") {
        const data = event.data as { type?: string; delta?: string };
        if (data.type === "output_text_delta" && typeof data.delta === "string") {
          yield { type: "delta", text: data.delta };
        }
      } else if (event.type === "run_item_stream_event") {
        const item = event.item as {
          type?: string;
          name?: string;
          rawItem?: { name?: string; arguments?: unknown };
          output?: unknown;
        };
        if (item.type === "tool_call_item") {
          yield {
            type: "tool_call",
            name: item.rawItem?.name ?? item.name ?? "tool",
            arguments: JSON.stringify(item.rawItem?.arguments ?? {}),
          };
        } else if (item.type === "tool_call_output_item") {
          yield {
            type: "tool_result",
            name: item.rawItem?.name ?? "tool",
            result: truncate(JSON.stringify(item.output ?? ""), 2000),
          };
        }
      }
    }

    await result.completed;
    const usage = result.state.usage;
    yield {
      type: "usage",
      usage: {
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        latencyMs: Date.now() - startedAt,
      },
    };
    yield { type: "done", messageId: "" };
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

export interface RunDiagnosisOptions extends RunChatOptions {
  knowledgeBaseId: string;
}

/** Non-streaming structured diagnosis; returns output + citations. */
export async function runDiagnosis(
  opts: RunDiagnosisOptions,
): Promise<{ output: DiagnosisOutput; references: DiagnosisReference[] }> {
  const result = await run(opts.agent, buildInput(opts));
  const output = result.finalOutput as DiagnosisOutput | undefined;
  if (!output) {
    throw new Error("Diagnosis agent produced no structured output");
  }
  const references: DiagnosisReference[] = [];
  for (const item of result.newItems) {
    if (
      item.type === "tool_call_output_item" &&
      Array.isArray((item as { output?: unknown }).output)
    ) {
      for (const hit of (item as { output: Array<Record<string, unknown>> }).output) {
        if (typeof hit.chunkId === "string") {
          references.push({
            knowledgeBaseId: opts.knowledgeBaseId,
            documentId: String(hit.documentId ?? ""),
            documentTitle: String(hit.document ?? ""),
            chunkId: hit.chunkId,
            excerpt: String(hit.excerpt ?? "").slice(0, 300),
            score: Number(hit.score ?? 0),
          });
        }
      }
    }
  }
  return { output, references };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

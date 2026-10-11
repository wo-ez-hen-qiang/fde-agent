#!/usr/bin/env node
import "./env.js"; // 必须最先：config.ts 与 embedding 都在模块加载时读环境变量
import { Command } from "commander";
import { createInterface } from "node:readline";
import { loadConfig, saveConfig, configPath } from "./config.js";
import { registerKbCommands } from "./commands/kb.js";
import { listModels } from "@fde/model-gateway";
import { inspectAgentBackends, isAgentBackendId, resolveAgentBackend } from "@fde/agent-runtime";
import { closeDb } from "@fde/data";
import type { AgentHistoryItem } from "@fde/shared";

const program = new Command();

program
  .name("fde")
  .description("fde-agent-cli：知识库工单诊断 agent 的命令行入口")
  .version("0.1.0");

program
  .command("chat")
  .description("对话（默认一次性；加 -i 进入交互模式）")
  .argument("[message]", "要问的内容")
  .option("-i, --interactive", "交互式多轮对话")
  .option("-m, --model <alias>", "模型别名（api 后端）")
  .option("-b, --backend <id>", "后端：api | claude-cli | codex-cli | cursor-cli")
  .action(
    async (
      message: string | undefined,
      opts: { interactive?: boolean; model?: string; backend?: string },
    ) => {
      const config = loadConfig();
      const backendId = opts.backend ?? config.backend;
      if (!isAgentBackendId(backendId)) {
        console.error(`[cli] 未知后端：${backendId}，用 fde backend list 查看`);
        process.exit(1);
      }
      const backend = resolveAgentBackend(backendId);
      const status = await backend.inspect();
      if (!status.available) {
        console.error(`[cli] 后端 ${backend.id} 不可用：${status.detail}`);
        process.exit(1);
      }

      let providerSessionId: string | undefined;
      const history: AgentHistoryItem[] = [];
      const ask = async (text: string) => {
        let reply = "";
        for await (const event of backend.streamChat({
          input: text,
          model: opts.model ?? config.model,
          knowledgeBaseId: config.knowledgeBaseId,
          providerSessionId,
          history,
        })) {
          if (event.type === "backend_session") providerSessionId = event.sessionId;
          else if (event.type === "delta") {
            reply += event.text;
            process.stdout.write(event.text);
          } else if (event.type === "error") {
            process.stderr.write(`\n[错误] ${event.message}\n`);
          }
        }
        history.push({ role: "user", content: text }, { role: "assistant", content: reply });
        process.stdout.write("\n");
      };

      if (opts.interactive || !message) {
        console.log(`fde chat（后端：${status.label}，Ctrl+C 退出）`);
        const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
        rl.prompt();
        for await (const line of rl) {
          const text = line.trim();
          if (text) await ask(text);
          rl.prompt();
        }
        return;
      }
      await ask(message);
    },
  );

program
  .command("diagnose")
  .description("结构化诊断一个工单（需要知识库）")
  .argument("<ticket>", "工单描述")
  .option("-k, --kb <id>", "知识库 ID")
  .option("-m, --model <alias>", "模型别名")
  .option("-b, --backend <id>", "后端：api | claude-cli | codex-cli | cursor-cli")
  .action(async (ticket: string, opts: { kb?: string; model?: string; backend?: string }) => {
    const config = loadConfig();
    const kb = opts.kb ?? config.knowledgeBaseId;
    if (!kb) {
      console.error("[cli] 诊断需要知识库：-k <id> 或在配置里设 knowledgeBaseId");
      process.exit(1);
    }
    const backendId = opts.backend ?? config.backend;
    if (!isAgentBackendId(backendId)) throw new Error(`未知后端：${backendId}`);
    const backend = resolveAgentBackend(backendId);
    const status = await backend.inspect();
    if (!status.available) throw new Error(status.detail);
    const result = await backend.diagnose({
      input: ticket,
      model: opts.model ?? config.model,
      knowledgeBaseId: kb,
    });
    console.log(`\n诊断结论：${result.summary}\n`);
    console.log(`问题定位：${result.location}\n`);
    console.log(`根因分析：${result.rootCause}\n`);
    console.log(`解决方案：${result.solution}\n`);
    console.log(`预防措施：${result.prevention}\n`);
    console.log(`置信度：${(result.confidence * 100).toFixed(0)}%`);
    if (result.references.length > 0) {
      console.log(`\n引用（${result.references.length}）：`);
      for (const ref of result.references) {
        console.log(
          `  - [${ref.documentTitle}] ${ref.excerpt.slice(0, 80)}… (${ref.score.toFixed(2)})`,
        );
      }
    }
  });

const backendCmd = program.command("backend").description("后端管理（CLI 抽象层）");

backendCmd
  .command("list")
  .description("列出所有后端及可用性")
  .action(async () => {
    const config = loadConfig();
    for (const status of await inspectAgentBackends()) {
      const mark = status.id === config.backend ? "*" : " ";
      const state = status.available ? "可用" : status.installed ? "未配置" : "未安装";
      console.log(
        `${mark} ${status.id.padEnd(12)} ${state.padEnd(6)} ${status.label}  ${status.detail}`,
      );
    }
  });

backendCmd
  .command("use")
  .description("切换默认后端")
  .argument("<id>", "后端 id")
  .action((id: string) => {
    if (!isAgentBackendId(id)) {
      console.error(`[cli] 未知后端：${id}`);
      process.exit(1);
    }
    saveConfig({ backend: id });
    console.log(`已切换到 ${id}（${configPath()}）`);
  });

backendCmd
  .command("doctor")
  .description("检查 API、Claude CLI、Codex CLI 和 Cursor CLI 配置")
  .argument("[id]", "可选后端 id")
  .action(async (id?: string) => {
    if (id && !isAgentBackendId(id)) throw new Error(`未知后端：${id}`);
    const statuses = await inspectAgentBackends();
    for (const status of statuses.filter((item) => !id || item.id === id)) {
      console.log(`${status.available ? "✅" : "❌"} ${status.label}: ${status.detail}`);
      if (status.version) console.log(`   版本：${status.version}`);
      if (status.modelLabel) console.log(`   模型：${status.modelLabel}`);
    }
  });

program
  .command("models")
  .description("列出模型流量（别名 / 是否已配置）")
  .action(() => {
    for (const m of listModels()) {
      console.log(
        `${m.enabled ? "●" : "○"} ${m.alias.padEnd(28)} ${m.label}${m.enabled ? "" : "（缺 API Key）"}`,
      );
    }
  });

registerKbCommands(program);

// 命令跑完必须关掉 PGlite：否则它的 worker 让进程不退出，数据目录被一直占用（单写者）。
program
  .parseAsync(process.argv)
  .then(async () => {
    await closeDb();
  })
  .catch(async (err) => {
    console.error(`[cli] ${err instanceof Error ? err.message : String(err)}`);
    await closeDb();
    process.exit(1);
  });

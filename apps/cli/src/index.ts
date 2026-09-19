#!/usr/bin/env node
import { Command } from "commander";
import { createInterface } from "node:readline";
import { loadConfig, saveConfig, configPath } from "./config.js";
import { allBackends, resolveBackend } from "./backends/index.js";
import { listModels } from "@fde/model-gateway";

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
  .action(async (message: string | undefined, opts: { interactive?: boolean; model?: string; backend?: string }) => {
    const config = loadConfig();
    const backend = resolveBackend(opts.backend ?? config.backend);
    if (!backend) {
      console.error(`[cli] 未知后端：${opts.backend ?? config.backend}，用 fde backend list 查看`);
      process.exit(1);
    }
    if (!(await backend.isAvailable())) {
      console.error(`[cli] 后端 ${backend.id} 不可用（CLI 未安装或 API Key 未配置）`);
      process.exit(1);
    }

    const ask = async (text: string) => {
      for await (const chunk of backend.chat(
        { message: text, model: opts.model ?? config.model, knowledgeBaseId: config.knowledgeBaseId },
        config.cliAuth,
      )) {
        process.stdout.write(chunk);
      }
      process.stdout.write("\n");
    };

    if (opts.interactive || !message) {
      console.log(`fde chat（后端：${backend.label}，Ctrl+C 退出）`);
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
  });

program
  .command("diagnose")
  .description("结构化诊断一个工单（需要知识库）")
  .argument("<ticket>", "工单描述")
  .option("-k, --kb <id>", "知识库 ID")
  .option("-m, --model <alias>", "模型别名")
  .action(async (ticket: string, opts: { kb?: string; model?: string }) => {
    const config = loadConfig();
    const kb = opts.kb ?? config.knowledgeBaseId;
    if (!kb) {
      console.error("[cli] 诊断需要知识库：-k <id> 或在配置里设 knowledgeBaseId");
      process.exit(1);
    }
    const { buildDiagnosisAgent, runDiagnosis } = await import("@fde/agent-runtime");
    const agent = await buildDiagnosisAgent({ modelAlias: opts.model ?? config.model, knowledgeBaseId: kb });
    const { output, references } = await runDiagnosis({ agent, input: ticket, knowledgeBaseId: kb });
    console.log(`\n诊断结论：${output.summary}\n`);
    console.log(`问题定位：${output.location}\n`);
    console.log(`根因分析：${output.rootCause}\n`);
    console.log(`解决方案：${output.solution}\n`);
    console.log(`预防措施：${output.prevention}\n`);
    console.log(`置信度：${(output.confidence * 100).toFixed(0)}%`);
    if (references.length > 0) {
      console.log(`\n引用（${references.length}）：`);
      for (const ref of references) {
        console.log(`  - [${ref.documentTitle}] ${ref.excerpt.slice(0, 80)}… (${ref.score.toFixed(2)})`);
      }
    }
  });

const backendCmd = program.command("backend").description("后端管理（CLI 抽象层）");

backendCmd
  .command("list")
  .description("列出所有后端及可用性")
  .action(async () => {
    const config = loadConfig();
    for (const b of allBackends()) {
      const ok = await b.isAvailable();
      const mark = b.id === config.backend ? "*" : " ";
      console.log(`${mark} ${b.id.padEnd(12)} ${ok ? "可用" : "不可用"}  ${b.label}`);
    }
  });

backendCmd
  .command("use")
  .description("切换默认后端")
  .argument("<id>", "后端 id")
  .action((id: string) => {
    if (!resolveBackend(id)) {
      console.error(`[cli] 未知后端：${id}`);
      process.exit(1);
    }
    saveConfig({ backend: id });
    console.log(`已切换到 ${id}（${configPath()}）`);
  });

backendCmd
  .command("auth")
  .description("CLI 后端计费模式：subscription（订阅额度）| apikey")
  .argument("<mode>", "subscription | apikey")
  .action((mode: string) => {
    if (mode !== "subscription" && mode !== "apikey") {
      console.error("[cli] mode 只能是 subscription 或 apikey");
      process.exit(1);
    }
    saveConfig({ cliAuth: mode });
    console.log(`CLI 计费模式已设为 ${mode}`);
  });

program
  .command("models")
  .description("列出模型流量（别名 / 是否已配置）")
  .action(() => {
    for (const m of listModels()) {
      console.log(`${m.enabled ? "●" : "○"} ${m.alias.padEnd(28)} ${m.label}${m.enabled ? "" : "（缺 API Key）"}`);
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(`[cli] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

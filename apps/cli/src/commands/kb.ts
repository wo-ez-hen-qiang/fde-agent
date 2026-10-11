/** `fde kb` 子命令：知识库建库/查看/导入/检索/健康检查。 */
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { connect } from "node:net";
import type { Command } from "commander";
import { KnowledgeStore, embeddingClientFromEnv, resolveDataDir } from "@fde/data";
import { configPath, loadConfig, saveConfig } from "../config.js";
import { repoEnvPath, repoRoot } from "../env.js";
import { importCorpus, type ImportEvent, type ImportReport } from "../kb/importer.js";

function createStore(): KnowledgeStore {
  return new KnowledgeStore(embeddingClientFromEnv());
}

function requireKbId(store: KnowledgeStore, explicit?: string): Promise<string> {
  const configured = explicit ?? loadConfig().knowledgeBaseId;
  if (!configured) {
    console.error("[cli] 未指定知识库：加 --kb <id>，或先 fde kb use <id>");
    process.exit(1);
  }
  return store.getKnowledgeBase(configured).then((kb) => {
    if (!kb) {
      console.error(`[cli] 知识库不存在：${configured}（fde kb list 查看）`);
      process.exit(1);
    }
    return configured;
  });
}

/* ------------------------------- 导入锁 ------------------------------- */

interface LockHandle {
  release: () => void;
}

/**
 * PGlite 是单进程嵌入式库：导入期间**不能**有别的进程连同一个数据目录。
 * CLI 之间用 wx 锁互斥，避免手滑并发把数据写坏。
 */
function acquireImportLock(): LockHandle {
  const lockPath = path.join(resolveDataDir(), ".fde-import.lock");
  const write = () => {
    const fd = openSync(lockPath, "wx");
    writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    closeSync(fd);
  };

  try {
    write();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
    let stale = true;
    try {
      const info = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: number };
      if (info.pid && info.pid !== process.pid) {
        process.kill(info.pid, 0); // 不抛异常 = 进程还活着
        stale = false;
      }
    } catch (probeError) {
      // 进程不存在 → 陈旧锁，可覆盖
      stale = (probeError as NodeJS.ErrnoException).code !== "EPERM";
    }
    if (!stale) {
      console.error(
        `[cli] 另一个导入正在进行（锁：${lockPath}）。等它结束，或确认无进程后删除该文件。`,
      );
      process.exit(1);
    }
    unlinkSync(lockPath);
    write();
  }

  return {
    release: () => {
      try {
        unlinkSync(lockPath);
      } catch {
        /* 已被清掉 */
      }
    },
  };
}

/** 检测 3000 端口是否有服务在跑（dev server / 生产 web）。 */
function devServerRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port: 3000 });
    const done = (running: boolean) => {
      socket.destroy();
      resolve(running);
    };
    socket.setTimeout(800);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/* ------------------------------ 输出辅助 ------------------------------ */

const STATUS_ICON: Record<string, string> = {
  created: "＋",
  updated: "↻",
  refreshed: "~",
  skipped: "=",
};

function printReport(report: ImportReport, dryRun: boolean): void {
  console.log("");
  console.log(
    `完成${dryRun ? "（dry-run，未写库）" : ""}：` +
      `created ${report.created} / updated ${report.updated} / refreshed ${report.refreshed} / ` +
      `skipped ${report.skipped} / failed ${report.failed} / pruned ${report.pruned}`,
  );
  console.log(
    `扫描 ${report.scanned} 篇${report.noFrontmatter > 0 ? `（其中 ${report.noFrontmatter} 篇无 frontmatter，按路径兜底）` : ""}` +
      `，写入 ${report.chunks} 块，用时 ${(report.ms / 1000).toFixed(1)}s`,
  );
  if (report.errors.length > 0) {
    console.log(`\n失败清单（${report.errors.length}）：`);
    for (const error of report.errors.slice(0, 20)) {
      console.log(`  - ${error.relPath}：${error.message}`);
    }
    if (report.errors.length > 20)
      console.log(`  … 其余 ${report.errors.length - 20} 条见 --report 输出`);
  }
}

/* --------------------------------- 注册 -------------------------------- */

export function registerKbCommands(program: Command): void {
  const kb = program.command("kb").description("知识库：建库 / 查看 / 导入 / 检索");

  kb.command("list")
    .description("列出所有知识库")
    .action(async () => {
      const store = createStore();
      const config = loadConfig();
      const bases = await store.listKnowledgeBases();
      if (bases.length === 0) {
        console.log("（还没有知识库：fde kb create <名字> --use）");
        return;
      }
      for (const base of bases) {
        const mark = base.id === config.knowledgeBaseId ? "*" : " ";
        const dims = base.embeddingDims ? `${base.embeddingDims} 维` : "维度未知";
        const mismatch =
          base.embeddingModel === store.embeddingModel &&
          (!base.embeddingDims || base.embeddingDims === store.embeddingDims)
            ? ""
            : "  ⚠ 与当前 embedding 不匹配";
        console.log(
          `${mark} ${base.name}  ${base.id}  ${base.documentCount} 篇  ` +
            `${base.embeddingModel}（${dims}）  ${new Date(base.updatedAt).toLocaleString("zh-CN")}${mismatch}`,
        );
      }
      console.log(`\n当前 embedding：${store.embeddingModel}（${store.embeddingDims} 维）`);
    });

  kb.command("create")
    .description("新建知识库（同名已存在时只更新描述，不改 embedding 模型）")
    .argument("<name>", "知识库名称")
    .option("-d, --description <text>", "描述")
    .option("--use", "同时设为默认知识库")
    .action(async (name: string, opts: { description?: string; use?: boolean }) => {
      const store = createStore();
      const existed = await store.getKnowledgeBaseByName(name);
      const base = await store.createKnowledgeBase(name, opts.description);
      console.log(`${existed ? "已存在，已更新描述" : "已创建"}：${base.name}  id=${base.id}`);
      console.log(
        `embedding：${base.embeddingModel}（${base.embeddingDims ?? store.embeddingDims} 维）`,
      );
      if (!existed) {
        const others = (await store.listKnowledgeBases()).filter(
          (item) => item.id !== base.id && item.embeddingModel !== base.embeddingModel,
        );
        const first = others[0];
        if (first) {
          console.log(
            `⚠ 与已有库「${first.name}」（${first.embeddingModel}）不一致：两者不能互相检索、也不能混灌同一个库`,
          );
        }
      }
      if (opts.use) {
        saveConfig({ knowledgeBaseId: base.id });
        console.log(`已设为默认知识库（${configPath()}）`);
      }
    });

  kb.command("use")
    .description("设为默认知识库（诊断/对话默认使用）")
    .argument("<id>", "知识库 id")
    .action(async (id: string) => {
      const store = createStore();
      const base = await store.getKnowledgeBase(id);
      if (!base) {
        console.error(`[cli] 知识库不存在：${id}`);
        process.exit(1);
      }
      saveConfig({ knowledgeBaseId: id });
      console.log(`已设为默认知识库：${base.name}（${id}）`);
    });

  kb.command("info")
    .description("查看知识库统计（文档数、块数、按栏目分布）")
    .argument("[id]", "知识库 id（默认用配置里的）")
    .option("--json", "输出 JSON")
    .action(async (id: string | undefined, opts: { json?: boolean }) => {
      const store = createStore();
      const kbId = await requireKbId(store, id);
      const base = await store.getKnowledgeBase(kbId);
      const documents = await store.listDocuments(kbId);
      const sections = await store.statsBySection(kbId);
      const chunks = documents.reduce((sum, doc) => sum + doc.chunkCount, 0);

      if (opts.json) {
        console.log(
          JSON.stringify(
            { knowledgeBase: base, documents: documents.length, chunks, sections },
            null,
            2,
          ),
        );
        return;
      }
      console.log(`知识库：${base?.name}  ${kbId}`);
      console.log(
        `embedding：${base?.embeddingModel}（${base?.embeddingDims ?? "?"} 维）  当前配置：${store.embeddingModel}（${store.embeddingDims} 维）`,
      );
      console.log(`文档：${documents.length}    分块：${chunks}`);
      if (sections.length > 0) {
        console.log("\n按栏目（metadata.section）：");
        for (const row of sections) {
          console.log(
            `  ${row.section.padEnd(20)} ${String(row.documents).padStart(4)} 篇 / ${row.chunks} 块`,
          );
        }
      }
    });

  kb.command("doctor")
    .description("检查数据目录、embedding 端点与知识库匹配情况")
    .action(async () => {
      const store = createStore();
      const dataDir = resolveDataDir();
      console.log(`数据目录     ${dataDir}${existsSync(dataDir) ? "" : "（尚未创建）"}`);
      if (await devServerRunning()) {
        console.log(
          "⚠ 单写者提醒 检测到 3000 端口有服务在跑：导入前请先停掉它（PGlite 是单进程嵌入式库）",
        );
      } else {
        console.log("✅ 单写者    3000 端口无服务，可以安全导入");
      }
      console.log(
        `${repoEnvPath ? "✅" : "⚠"} .env       ${repoEnvPath ?? "未找到仓库根 .env（只靠 shell 环境变量）"}`,
      );
      console.log(
        `   provider    ${process.env.FDE_EMBEDDING_PROVIDER ?? "glm"} / ${store.embeddingModel}`,
      );
      console.log(
        `   单块上限    ${store.maxInputChars ? `${store.maxInputChars} 字符（FDE_EMBEDDING_MAX_INPUT_CHARS）` : "未设置（切分器用默认值）"}`,
      );

      const startedAt = Date.now();
      try {
        const client = embeddingClientFromEnv();
        const [vector] = await client.embed(["知识库检索自检"]);
        const dims = vector?.length ?? 0;
        const ok = dims === store.embeddingDims;
        console.log(
          `${ok ? "✅" : "❌"} embedding  模型 ${client.model}，声明 ${store.embeddingDims} 维，实测 ${dims} 维，` +
            `探针耗时 ${Date.now() - startedAt}ms`,
        );
      } catch (error) {
        console.log(`❌ embedding  ${error instanceof Error ? error.message : String(error)}`);
      }

      const bases = await store.listKnowledgeBases();
      const matched = bases.filter(
        (base) =>
          base.embeddingModel === store.embeddingModel &&
          (!base.embeddingDims || base.embeddingDims === store.embeddingDims),
      );
      console.log(`知识库      ${bases.length} 个，其中 ${matched.length} 个与当前 embedding 匹配`);
    });

  kb.command("delete")
    .description("删除知识库及其全部文档（不可恢复）")
    .argument("<id>", "知识库 id")
    .option("--yes", "跳过二次确认")
    .action(async (id: string, opts: { yes?: boolean }) => {
      const store = createStore();
      const base = await store.getKnowledgeBase(id);
      if (!base) {
        console.error(`[cli] 知识库不存在：${id}`);
        process.exit(1);
      }
      const documents = await store.listDocuments(id);
      if (!opts.yes) {
        if (!process.stdin.isTTY) {
          console.error("[cli] 非交互环境请显式加 --yes");
          process.exit(1);
        }
        const answer = await new Promise<string>((resolve) => {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          rl.question(
            `确认删除「${base.name}」（${documents.length} 篇文档）？输入 yes 继续：`,
            (text) => {
              rl.close();
              resolve(text.trim());
            },
          );
        });
        if (answer !== "yes") {
          console.log("已取消");
          return;
        }
      }
      await store.deleteKnowledgeBase(id);
      console.log(`已删除：${base.name}（${documents.length} 篇文档）`);
    });

  kb.command("import")
    .description("把本地语料（<dir>/docs/**/*.md）批量导入知识库，可重复执行")
    .argument("<dir>", "语料根目录")
    .option("--kb <id>", "知识库 id（默认用配置里的）")
    .option("--subdir <name>", "语料子目录（默认自动：有 docs/ 扫 docs/，否则扫该目录本身）")
    .option(
      "--exclude <glob>",
      "追加排除规则（可重复）",
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .option("--force", "忽略内容 hash，全部重灌")
    .option("--dry-run", "只扫描与预测，不写库、不算向量")
    .option("--prune", "删除库中本次未扫描到的导入文档")
    .option("--limit <n>", "只处理前 N 篇（小样试灌）", (value: string) => Number(value))
    .option("--chunk-target <n>", "切分目标长度（字符）", (value: string) => Number(value))
    .option("--chunk-max <n>", "切分硬上限（字符）", (value: string) => Number(value))
    .option("--report <path>", "把 JSON 报告写到指定路径")
    .option("--quiet", "只输出汇总，不逐篇打印")
    .action(
      async (
        dir: string,
        opts: {
          kb?: string;
          subdir?: string;
          exclude?: string[];
          force?: boolean;
          dryRun?: boolean;
          prune?: boolean;
          limit?: number;
          chunkTarget?: number;
          chunkMax?: number;
          report?: string;
          quiet?: boolean;
        },
      ) => {
        const store = createStore();
        const kbId = await requireKbId(store, opts.kb);
        const root = path.resolve(dir);
        if (!existsSync(root)) {
          console.error(`[cli] 目录不存在：${root}`);
          process.exit(1);
        }

        const lock = opts.dryRun ? { release: () => {} } : acquireImportLock();
        try {
          const report = await importCorpus(store, {
            knowledgeBaseId: kbId,
            root,
            subdir: opts.subdir,
            excludes: opts.exclude ?? [],
            force: opts.force === true,
            dryRun: opts.dryRun === true,
            prune: opts.prune === true,
            limit: opts.limit,
            chunkTarget: opts.chunkTarget,
            chunkMax: opts.chunkMax,
            onEvent: (event: ImportEvent) => {
              if (opts.quiet) return;
              if (event.type === "scan") {
                console.log(`扫描 ${root} → 命中 ${event.total} 篇（排除 ${event.excluded} 项）`);
              } else if (event.type === "doc") {
                const mark = STATUS_ICON[event.status] ?? "?";
                console.log(
                  `[${String(event.index).padStart(4)}/${event.total}] ${mark} ${event.relPath}` +
                    `${event.chunks > 0 ? `  +${event.chunks} 块` : ""}  ${event.ms}ms${event.fallback ? "  (无 frontmatter)" : ""}`,
                );
              } else {
                console.log(`[错误] ${event.relPath}：${event.message}`);
              }
            },
          });
          printReport(report, opts.dryRun === true);

          if (opts.report) {
            // 相对路径按仓库根解析（CLI 的 cwd 在 apps/cli，直接用会把报告写进 apps/cli/.data）
            const reportPath = path.isAbsolute(opts.report)
              ? opts.report
              : path.join(repoRoot() ?? process.cwd(), opts.report);
            const { mkdirSync, writeFileSync } = await import("node:fs");
            mkdirSync(path.dirname(reportPath), { recursive: true });
            writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
            console.log(`报告已写入：${reportPath}`);
          }
          if (report.failed > 0) process.exitCode = 1;
        } finally {
          lock.release();
        }
      },
    );

  kb.command("search")
    .description("检索自检：直接在知识库里查一段文本，打印命中块")
    .argument("<query>", "查询文本")
    .option("--kb <id>", "知识库 id（默认用配置里的）")
    .option("--top <n>", "返回条数", (value: string) => Number(value), 5)
    .option("--json", "输出 JSON")
    .action(async (query: string, opts: { kb?: string; top?: number; json?: boolean }) => {
      const store = createStore();
      const kbId = await requireKbId(store, opts.kb);
      const hits = await store.search(kbId, query, opts.top ?? 5);
      if (opts.json) {
        console.log(JSON.stringify(hits, null, 2));
        return;
      }
      if (hits.length === 0) {
        console.log("（没有命中：知识库可能是空的）");
        return;
      }
      hits.forEach((hit, index) => {
        console.log(
          `\n${index + 1}. ${hit.score.toFixed(3)}  ${hit.documentTitle}  #${hit.chunk.ordinal}`,
        );
        console.log(`   ${hit.chunk.content.slice(0, 200).replace(/\n/g, "\n   ")}`);
      });
    });
}

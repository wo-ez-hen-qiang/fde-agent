import { test, expect, type Page } from "@playwright/test";

/** 与 chat.spec.ts 同风格：打桩接口，真实点击与断言。 */

const KB_ID = "kb-1";

const emptyCanvas = {
  statusQuo: "",
  businessGoal: "",
  entryPoint: "",
  adpMode: "",
  knowledgeAssets: "",
  processAndTools: "",
  inputOutput: "",
  boundaryAcceptance: "",
};

const canvasResult = {
  scenario: "presales",
  stage: "canvas",
  summary: "航空公司客服投诉处理 · 画布草稿",
  questions: [],
  needUnderstanding: "",
  industryOpportunity: "",
  recommendedSolution: "",
  demoScope: "",
  deliveryRisk: "",
  nextInfoNeeded: "",
  statusQuo: "人工判断多，制度分散",
  businessGoal: "缩短投诉处理时长、统一口径",
  entryPoint: "客服工作台内嵌",
  adpMode: "单工作流模式",
  knowledgeAssets: "FAQ 与话术库待整理",
  processAndTools: "投诉分类 → 话术推荐 → 升级人工",
  inputOutput: "输入工单摘要；输出分类与话术",
  boundaryAcceptance: "敏感问题拒答；不编造承诺",
  confidence: 0.65,
  references: [
    {
      knowledgeBaseId: KB_ID,
      documentId: "doc-1",
      documentTitle: "智能体应用及其四种模式.md",
      chunkId: "chunk-1",
      excerpt: "流程固定适合单工作流模式。",
      score: 0.8,
    },
  ],
  createdAt: Date.now(),
};

const reportResult = {
  scenario: "presales",
  stage: "report",
  summary: "航空公司客服投诉处理",
  questions: [],
  needUnderstanding: "客户是某航空公司客服中心，目标用户为一线坐席与主管。",
  industryOpportunity:
    "知识库未覆盖部分，以下为通用建议：投诉处理类场景的核心指标是解决率与转人工率。",
  recommendedSolution:
    "**(a) 模式选型**：流程固定 → 单工作流模式。\n\n**(b) 方案画布**\n\n| 方案画布字段 | 内容 |\n| --- | --- |\n| 背景与现状 | 人工判断多 |\n| ADP 模式 | 单工作流模式 |",
  demoScope: "第一期只做投诉分类与话术推荐。",
  deliveryRisk:
    "整体风险等级：中。\n\n| 风险点 | 影响 | 优先级 | 修复建议 |\n| --- | --- | --- |\n| 资料质量 | 命中率低 | 高 | 先整理 FAQ |",
  nextInfoNeeded: "1. 现有 FAQ 与话术库格式；2. 工单系统接口文档。",
  ...emptyCanvas,
  statusQuo: "人工判断多，制度分散",
  adpMode: "单工作流模式",
  confidence: 0.7,
  references: [
    {
      knowledgeBaseId: KB_ID,
      documentId: "doc-1",
      documentTitle: "智能体应用及其四种模式.md",
      chunkId: "chunk-1",
      excerpt: "标准模式适用于围绕制度、产品、政策提问的场景。",
      score: 0.83,
    },
  ],
  createdAt: Date.now(),
};

const reportMarkdown = [
  "# 基于腾讯云 ADP 平台的销售方案报告",
  "> 客户场景：航空公司客服投诉处理",
  "",
  "## 一、客户需求理解",
  reportResult.needUnderstanding,
  "",
  "## 三、推荐智能体方案",
  reportResult.recommendedSolution,
  "",
  "## 参考资料",
  "1. **智能体应用及其四种模式.md**（相关度 0.83）",
].join("\n\n");

async function fillIntake(page: Page) {
  await page.getByPlaceholder("如：某银行零售部").fill("南航客服中心");
  await page.getByPlaceholder("如：金融 / 零售银行").fill("航空 / 客服");
  await page.getByRole("button", { name: "客服", exact: true }).click();
  await page.getByRole("button", { name: "人工判断多", exact: true }).click();
  await page.getByRole("button", { name: "问答助手", exact: true }).click();
  await page
    .getByPlaceholder(/柜面查制度|柜面人员查制度/)
    .fill("一线坐席处理投诉时人工判断多，口径不统一，需要助手。");
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/backends", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        defaultBackend: "claude-cli",
        backends: [
          {
            id: "claude-cli",
            label: "Claude CLI",
            installed: true,
            configured: true,
            available: true,
            modelLabel: "DeepSeek Chat",
            detail: "已配置",
          },
        ],
      }),
    });
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ defaultModel: "glm:glm-4.6", models: [] }),
    });
  });
  await page.route("**/api/knowledge", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        knowledgeBases: [
          { id: KB_ID, name: "腾讯云 ADP 文档", embeddingModel: "embedding-3", documentCount: 481 },
        ],
      }),
    });
  });
  await page.route("**/api/sessions**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ sessions: [] }),
    });
  });

  let round = 0;
  await page.route("**/api/scenario", async (route) => {
    round += 1;
    const isCanvas = round === 1;
    const body = JSON.parse(route.request().postData() || "{}") as {
      presalesPhase?: string;
    };
    const canvasPhase = body.presalesPhase === "canvas" || (!body.presalesPhase && isCanvas);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        scenario: "presales",
        sessionId: "session-presales",
        result: canvasPhase && round === 1 ? canvasResult : reportResult,
        markdown:
          canvasPhase && round === 1 ? "# 方案画布草稿\n\n| 方案画布字段 | 内容 |" : reportMarkdown,
      }),
    });
  });
});

test("售前测试集：对话区可查看假设客户并填入受理表", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "售前方案", exact: true }).click();
  await expect(page.getByText("售前测试集")).toBeVisible();
  await expect(page.getByText("滨江城商行信用卡中心")).toBeVisible();
  await expect(page.getByText("浦石证券营业部投顾助理")).toBeVisible();
  await page.getByRole("button", { name: /滨江城商行信用卡中心/ }).click();
  await page.getByRole("button", { name: "填入受理表", exact: true }).click();
  await expect(page.getByPlaceholder("如：某银行零售部")).toHaveValue("滨江城商行信用卡中心");
  await expect(page.getByText("已填入").first()).toBeVisible();
});

test("售前方案：未选知识库时不可提交受理表", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "售前方案", exact: true }).click();

  await expect(page.getByText("① 客户基本情况")).toBeVisible();
  await page.getByRole("button", { name: "填写并生成画布" }).click();
  await expect(page.getByRole("button", { name: "生成方案画布" })).toBeDisabled();
  await expect(page.getByText("售前方案需要先选择知识库。").first()).toBeVisible();

  await page.getByLabel("知识库").selectOption(KB_ID);
  await expect(page.getByRole("button", { name: "生成方案画布" })).toBeEnabled();
});

test("售前方案：受理表 → 画布确认 → 整案 → 下载", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "售前方案", exact: true }).click();
  await page.getByLabel("知识库").selectOption(KB_ID);
  await page.getByRole("button", { name: "填写并生成画布" }).click();

  await fillIntake(page);
  await page.getByRole("button", { name: "生成方案画布" }).click();

  await expect(page.getByText("② 方案画布 · 请确认")).toBeVisible();
  // 画布第 4 项为 ADP 模式
  const modeBox = page.locator("textarea").nth(3);
  await expect(modeBox).toHaveValue("单工作流模式");

  // FDE 修改画布一字
  await modeBox.fill("单工作流模式（已确认）");

  await page.getByRole("button", { name: "确认并生成整体方案" }).click();

  await expect(page.getByText("基于腾讯云 ADP 平台的销售方案报告")).toBeVisible();
  for (const heading of ["一、客户需求理解", "三、推荐智能体方案", "五、交付风险与前置条件"]) {
    await expect(page.getByText(heading, { exact: false }).first()).toBeVisible();
  }
  await expect(page.getByText("参考资料（1 条）").last()).toBeVisible();

  const body = await page.locator("main").innerText();
  expect(body).not.toMatch(/\d+\s*(万元|元|人天|人日|工作日|个月)/);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "下载 .md" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^售前方案-.+\.md$/);
  const stream = await download.createReadStream();
  const text = await new Promise<string>((resolve) => {
    let acc = "";
    stream!.on("data", (chunk) => (acc += chunk));
    stream!.on("end", () => resolve(acc));
  });
  expect(text).toContain("## 三、推荐智能体方案");
  expect(text).toContain("## 参考资料");
});

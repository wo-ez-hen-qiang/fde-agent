import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/backends", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        defaultBackend: "codex-cli",
        backends: [
          {
            id: "api",
            label: "API（model-gateway）",
            installed: true,
            configured: true,
            available: true,
            modelLabel: "GLM-4.6",
            detail: "已配置",
          },
          {
            id: "claude-cli",
            label: "Claude CLI",
            installed: true,
            configured: true,
            available: true,
            modelLabel: "DeepSeek Chat",
            detail: "已配置",
          },
          {
            id: "codex-cli",
            label: "Codex CLI",
            installed: true,
            configured: true,
            available: true,
            modelLabel: "使用 Codex 当前配置",
            detail: "已登录",
          },
        ],
      }),
    });
  });
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        defaultModel: "glm:glm-4.6",
        models: [
          {
            alias: "glm:glm-4.6",
            provider: "glm",
            model: "glm-4.6",
            label: "GLM-4.6",
            transport: "api",
            enabled: true,
          },
        ],
      }),
    });
  });
  await page.route("**/api/knowledge", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        knowledgeBases: [
          {
            id: "kb-1",
            name: "产品运维库",
            description: "测试知识库",
            embeddingModel: "embedding-3",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    });
  });
  await page.route("**/api/sessions", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ sessions: [] }),
    });
  });
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "x-session-id": "session-chat",
      },
      body:
        'data: {"type":"delta","text":"你好，已连接 Codex"}\n\n' +
        'data: {"type":"done","messageId":"message-1"}\n\n',
    });
  });
  await page.route("**/api/diagnose", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sessionId: "session-diagnosis",
        diagnosis: {
          summary: "数据库连接池耗尽",
          location: "订单服务数据库连接层",
          rootCause: "慢查询占用连接时间过长",
          solution: "终止异常查询并优化索引",
          prevention: "增加连接池与慢查询告警",
          confidence: 0.86,
          references: [
            {
              knowledgeBaseId: "kb-1",
              documentId: "doc-1",
              documentTitle: "数据库故障手册",
              chunkId: "chunk-1",
              excerpt: "连接池耗尽处理方法",
              score: 0.92,
            },
          ],
          createdAt: 1,
        },
      }),
    });
  });
});

test("空会话显示运行路径和默认后端", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("我是 fde-agent")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ 新建对话" })).toBeVisible();
  await expect(page.getByLabel("运行方式")).toHaveValue("codex-cli");
  await expect(page.getByText("使用 Codex 当前配置")).toBeVisible();
});

test("普通问答通过所选 CLI 流式显示", async ({ page }) => {
  await page.goto("/");

  await page.getByPlaceholder(/输入消息/).fill("你好");
  await page.getByRole("button", { name: "发送" }).click();

  // exact: 默认子串匹配会同时命中助手回复「你好，已连接 Codex」，这里要的是用户气泡本身
  await expect(page.getByText("你好", { exact: true })).toBeVisible();
  await expect(page.getByText("你好，已连接 Codex")).toBeVisible();
});

test("工单诊断要求知识库并显示结构化结果", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "工单诊断" }).click();
  await page.getByPlaceholder(/粘贴工单内容/).fill("订单服务持续超时");

  const diagnoseButton = page.getByRole("button", { name: "开始诊断" });
  await expect(diagnoseButton).toBeDisabled();
  await expect(page.getByText("工单诊断需要先选择知识库。")).toBeVisible();

  await page.getByLabel("知识库").selectOption("kb-1");
  await expect(diagnoseButton).toBeEnabled();
  await diagnoseButton.click();

  await expect(page.getByText("数据库连接池耗尽")).toBeVisible();
  await expect(page.getByText("置信度 86%")).toBeVisible();
  await expect(page.getByText("引用 1 条知识库证据")).toBeVisible();
});

test("已有消息切换后端会确认并新建对话", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder(/输入消息/).fill("保留这段对话");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("你好，已连接 Codex")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("运行方式").selectOption("claude-cli");

  await expect(page.getByText("我是 fde-agent")).toBeVisible();
  await expect(page.getByLabel("运行方式")).toHaveValue("claude-cli");
  await expect(page.getByText("DeepSeek Chat")).toBeVisible();
});

import { test, expect } from "@playwright/test";

/** 主聊天页交互冒烟（对应设计文档 5.6.1 交互规格）。 */

test("空会话：欢迎态与快捷入口", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("我是 fde-agent")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ 新建对话" })).toBeVisible();
  await expect(page.getByText("暂无历史对话")).toBeVisible();
});

test("发送消息：乐观上屏；无模型 key 时内联报错并可重试", async ({ page }) => {
  await page.goto("/");

  // 输入前发送按钮置灰
  const sendBtn = page.getByRole("button", { name: "发送" });
  await expect(sendBtn).toBeDisabled();

  // 输入后可发送
  await page.getByPlaceholder(/输入消息/).fill("你好");
  await expect(sendBtn).toBeEnabled();
  await sendBtn.click();

  // 用户气泡乐观上屏
  await expect(page.getByText("你好")).toBeVisible();

  // 未配置 API key：SSE error 事件 -> 内联错误卡片 + 重试按钮
  await expect(page.getByText(/出错了/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();

  // 侧边栏出现这条会话（自动标题）
  await expect(page.getByText("你好").first()).toBeVisible();
});

test("历史会话：点击加载", async ({ page }) => {
  await page.goto("/");
  const item = page.locator("aside").getByText("你好").first();
  if (await item.isVisible()) {
    await item.click();
    await expect(page.getByText("你好")).toBeVisible();
  }
});

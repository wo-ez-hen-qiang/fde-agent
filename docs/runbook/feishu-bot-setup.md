# 飞书机器人配置与联调

适用：把 fde-agent 接成飞书（Lark）机器人。设计见 `docs/design/2026-09-29-feishu-bot.md`。

## 1. 飞书开放平台创建应用

1. 打开 [飞书开放平台](https://open.feishu.cn/app)（Lark 国际版：<https://open.larksuite.com/app>）→ 创建**企业自建应用**。
2. **添加应用能力** → 开启「机器人」。
3. **凭证与基础信息** → 记下 `App ID`、`App Secret`。
4. **权限管理** → 开通以下权限（scopes）：

   | 权限 | 标识 | 用途 |
   |---|---|---|
   | 读取用户发给机器人的单聊消息 | `im:message.p2p_msg:readonly` | 接收私聊 |
   | 接收群聊中 @机器人消息事件 | `im:message.group_at_msg:readonly` | 接收群里 @ |
   | 以应用的身份发消息 | `im:message:send_as_bot` | 回复消息 |

   可选：`im:message`（获取与发送单聊、群组消息，覆盖以上收发）。**不需要**「获取群组中所有消息」（`im:message.group_msg`），机器人只响应 @ 它的群消息。

5. **事件与回调 → 加密策略**：记下 `Verification Token`；建议设置 `Encrypt Key`（开启后回调体 AES 加密并带 `X-Lark-Signature` 签名头，服务端会校验）。
6. **事件与回调 → 事件配置**：
   - 订阅方式：「将事件发送至开发者服务器」
   - 请求地址：`https://<你的域名>/api/bots/feishu`（需公网 HTTPS 可达；本地联调可用 cloudflared / ngrok 等内网穿透）
   - 保存时飞书会发 `url_verification` challenge，服务必须**先配好 env 并已启动**才能校验通过
   - 添加事件：**接收消息 v2.0**（`im.message.receive_v1`）
7. **版本管理与发布** → 创建版本并发布（权限变更需重新发布、管理员审核）。
8. 把机器人拉进需要使用的群；私聊直接在飞书里搜索应用名。

## 2. 服务端配置（env）

在部署环境的 env（本地为仓库根 `.env`，不要提交）中填写：

```bash
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_VERIFICATION_TOKEN=xxx
FEISHU_ENCRYPT_KEY=xxx            # 推荐；与 VERIFICATION_TOKEN 至少配一个
# FEISHU_BASE_URL=https://open.larksuite.com   # 仅 Lark 国际版
# FDE_BOT_MODEL=glm:glm-4.6                    # 可选：机器人使用的模型别名
# FDE_BOT_KNOWLEDGE_BASE_ID=<kb id>            # 可选：机器人会话默认知识库
```

改完 env 需重启 web 服务（`pnpm rebuild -- --restart` 或重启 `next start`）。

自检：

```bash
curl -s https://<你的域名>/api/bots/feishu
# {"platform":"feishu","configured":true,"missing":[],"encrypted":true}
```

未配置时 `POST` 返回 `503 {"error":"feishu bot is not configured; missing env: ..."}`，其余功能不受影响。

## 3. 使用

- 私聊：直接发文字，例如「订单支付回调 500，日志里有 timeout」。
- 群聊：`@机器人 <问题>`；不 @ 不响应。每个人在同一个群里有独立上下文。
- 追问会带上历史；发送 `/new`（或 `/reset`、`新对话`、`重新开始`）开启新会话。
- 会话同时出现在 Web 端历史列表中（channel=feishu）。
- 仅支持文本消息；图片/文件/富文本会被忽略。

## 4. 端到端验证清单

1. `GET /api/bots/feishu` 显示 `configured: true`。
2. 飞书后台保存请求地址 → 显示「验证成功」。
3. 私聊机器人发一句话 → 几秒到几十秒内收到回复（取决于模型）。
4. 群里 @机器人 → 以「回复」形式回到该消息下。
5. 服务日志（`[bot-core]` / `[web]` 前缀）无报错。

## 5. 故障排查

| 现象 | 排查 |
|---|---|
| 保存请求地址提示校验失败 | 服务未启动 / env 未生效（`GET` 探针看 `configured`）；Token/Encrypt Key 与后台不一致；日志 `[web] feishu callback rejected: <原因>` |
| 收不到消息事件 | 未订阅 `im.message.receive_v1`；权限未开通或版本未发布；群里没有 @ 机器人 |
| 日志 `feishu token failed` | App ID / Secret 错误，或应用未发布 |
| 日志 `feishu send failed: code=230002` | 机器人不在该群 |
| 日志 `feishu send failed: code=99991672` 等权限错误 | 缺 `im:message:send_as_bot`，开通后重新发布 |
| 回复重复 | 多副本部署时进程内去重失效，需共享去重存储（见设计文档限制） |

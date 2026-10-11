# 多用户登录、个人模型凭据与飞书/企微补齐

> 状态：已取消（2026-10-03） | 日期：2026-10-03 | 作者：伊泽瑞尔 + AI (Composer)

## 目标

1. Web 用户名密码注册/登录；Cookie 会话；每人只见自己的聊天会话。
2. 每人可配置自己的模型 API Key（及可选 Base URL）；调用时优先用个人凭据，缺省回退进程 env。
3. 飞书支持 Encrypt Key 解密；机器人消息按平台身份绑定用户并续写同一会话。

## 非目标

- OAuth / 飞书扫码登录；RBAC；知识库按用户隔离；企微群聊收消息；计费配额。

## 方案

| 点 | 选择 | 理由 |
|---|---|---|
| 登录 | 用户名 + 密码 + httpOnly Cookie | 实现快、无第三方依赖 |
| 密码 | scrypt | Node 内置 |
| 密钥存储 | AES-256-GCM，密钥来自 `FDE_CREDENTIALS_SECRET` | 禁止明文落库 |
| 模型解析 | `ModelGateway(envMerge(process.env, userCreds))` | 已有 EnvLike |
| 机器人身份 | `user_identities(platform, external_id)` | 飞书 open_id / 企微 FromUserName |

## 数据模型

- `users(id, username unique, password_hash, display_name, created_at)`
- `auth_sessions(id, user_id, token_hash, expires_at, created_at)`
- `user_identities(id, user_id, platform, external_id)` UNIQUE(platform, external_id)
- `user_credentials(id, user_id, provider, api_key_encrypted, base_url)` UNIQUE(user_id, provider)
- `chat_sessions.user_id` + `external_thread_key`（机器人续写键）

## 飞书最终形态

FDE 与机器人在同一群：群里 `@机器人` 提问，机器人在群内回文字；未 @ 不回。私聊机器人可直接问。`诊断：` 走诊断，其它走聊天。无流式、无售前表单。同一人同一群连续对话续写同一会话。

## 个人飞书号怎么接（不必先建群）

个人号本身不能当机器人。要在所在**企业/团队**的[飞书开放平台](https://open.feishu.cn)创建「企业自建应用」并打开机器人能力（没有团队管理权限则建不了）。

顺序：建应用 → `.env` 填 `FEISHU_APP_ID/SECRET` 等 → 事件回调填公网 `https://…/api/bots/feishu`（localhost 飞书访问不到）→ 订阅收消息事件并发布 → **先私聊机器人试通** → 再新建群，把人和机器人都拉进去，才能 `@`。

群不是第一步；群只是 `@` 问答的场所。

## 交互规格（登录）

- 未登录访问主界面 → 登录/注册页
- 登录成功 → 聊天；侧栏只列本人会话
- 设置区：填写各 provider API Key（只显示是否已配置，不回显明文）

## 验收

- 注册两用户，A 看不到 B 的会话
- A 配自己的 GLM key 可 chat；无 key 且无 env 时 503 提示
- 飞书加密回调可握手（有 Encrypt Key 时）
- 机器人同一用户连续两句落入同一 session

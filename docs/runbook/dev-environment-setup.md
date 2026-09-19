# 开发环境搭建

日期：2026-09-19 | 适用：本机（Ubuntu）或任何新开发机

## 1. 基础工具链

```bash
# Node 22（用户目录安装，免 sudo）
curl -sLO https://nodejs.org/dist/latest-v22.x/node-v22.23.2-linux-x64.tar.xz
mkdir -p ~/.local/node
tar -xJf node-v22.23.2-linux-x64.tar.xz -C ~/.local/node --strip-components=1

# PATH 写入 ~/.bashrc
echo 'export PATH="$HOME/.local/node/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# pnpm（corepack 自带）
corepack enable && corepack prepare pnpm@10 --activate
```

## 2. 拉代码 + 安装

```bash
git clone git@github.com:<你的用户名>/agent.git   # SSH key 见 ssh-setup-and-keepalive.md
cd agent
pnpm install   # 自动挂 git 门禁（prepare 脚本设置 core.hooksPath）
```

## 3. 配置密钥

```bash
cp .env.example .env
# 至少填一个模型 key（GLM_API_KEY 免费额度即可）+ embedding 用同一 provider
```

## 4. 启动与验证

```bash
pnpm dev:web          # http://localhost:3000
pnpm dev:cli -- models  # CLI 冒烟
pnpm typecheck && pnpm lint   # 门禁同款检查
```

## 5. 常用脚本

| 命令 | 作用 |
|---|---|
| `pnpm rebuild` | 一键重建（install → clean → build），`-- --restart` 顺带重启生产服务 |
| `pnpm dev:web` / `pnpm dev:cli -- <args>` | 开发模式 |
| `pnpm typecheck` / `pnpm lint` | 门禁检查 |

## 6. 相关 runbook

- SSH 免密/保活/本地域名：`ssh-setup-and-keepalive.md`
- Windows 文件共享：`samba-windows-share.md`

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

## 5.1 资源约束：低内存机器不要跑 next build

`next build` 峰值内存约 2GB。当前虚拟机 1.6GB 内存时实测：构建跑 38 分钟、负载 30、swap 耗尽，把 Cursor 转发通道拖死（ECONNRESET）。

`scripts/rebuild.sh` 已内置保护：可用内存 < 2GB 时拒绝构建。可选解法：

```bash
# 方案 A：加 swap（构建会变慢但能完成；需 sudo，一次性）
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile \
  && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab   # 开机自动挂

# 方案 B：扩容虚拟机内存（推荐，VMware 设置里改，需关机）
# 方案 C：在别的机器构建后部署 .next 产物（output: "standalone" 适合做这个）
```

资源不足期间的开发方式：`pnpm dev:web`（按需编译，峰值内存低，首次访问某路由时编译稍慢）。

## 6. 相关 runbook

- SSH 免密/保活/本地域名：`ssh-setup-and-keepalive.md`
- Windows 文件共享：`samba-windows-share.md`

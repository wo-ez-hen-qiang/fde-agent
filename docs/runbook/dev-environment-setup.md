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

# pnpm（版本对齐 package.json 的 packageManager）
# Node 26 起不再自带 corepack，统一用 npm 全局安装；
# Node 22/24 若想走 corepack：corepack enable && corepack prepare pnpm@10 --activate
npm i -g pnpm@10.0.0

# 用户目录安装的 Node，npm 全局 bin 可能不在 PATH，软链到 PATH 内的目录：
ln -sf "$(npm config get prefix)/bin/pnpm" ~/.local/bin/pnpm
```

## 2. 拉代码 + 安装

```bash
git clone git@github.com:<你的用户名>/agent.git   # SSH key 见 ssh-setup-and-keepalive.md
cd agent
pnpm install   # 自动挂 git 门禁（prepare 脚本设置 core.hooksPath）
```

## 3. 配置模型后端

三种运行方式至少准备一种：

### 方式 A：API

```bash
cp .env.example .env
# 至少填一个模型 key；知识库向量检索还需配置 embedding provider
```

### 方式 B：Claude CLI

```bash
npm install -g @anthropic-ai/claude-code
claude --version
claude auth status
```

可使用 Claude 登录，也可按模型厂商文档配置 Anthropic-compatible 网关（例如 DeepSeek/GLM）。fde-agent 不保存 CLI 密钥。

### 方式 C：Codex CLI

```bash
npm install -g @openai/codex
codex --version
codex login status
```

可使用 OpenAI 登录，也可在 Codex 用户配置中声明兼容 Responses API 的 custom provider。

完成后检查：

```bash
pnpm dev:cli backend doctor
```

## 4. 启动与验证

```bash
pnpm dev:web          # http://localhost:3000
pnpm dev:cli backend list  # 后端状态（含 api / claude-cli / codex-cli / cursor-cli）
pnpm dev:cli chat -b codex-cli "你好"  # CLI 冒烟
# Cursor Agent CLI（与 IDE 的 cursor 命令不同）：curl https://cursor.com/install -fsS | bash
# pnpm dev:cli chat -b cursor-cli "你好"
pnpm typecheck && pnpm lint   # 门禁同款检查
```

## 5. 常用脚本

| 命令 | 作用 |
|---|---|
| `pnpm run rebuild` | 一键重建（install → clean → build），`--restart` 顺带重启生产服务 |
| `pnpm dev:web` / `pnpm dev:cli <args>` | 开发模式 |
| `pnpm typecheck` / `pnpm lint` | 门禁检查 |

> ⚠️ **pnpm 两个陷阱**（npm 用户最容易踩，2026-09-29 实测）：
> 1. **必须写 `pnpm run <脚本名>`**：脚本名若与 pnpm 内置命令重名，`pnpm <脚本名>` 会跑内置命令、静默不跑本仓库脚本。已知重名：`doctor`（pnpm 内置配置检查，无问题时零输出 exit 0）、`rebuild`（pnpm 内置「重建 node_modules 依赖」）。`pnpm rebuild` 曾长期被文档当成「一键重建」，实际从未跑过 `scripts/rebuild.sh`。
> 2. **pnpm 不像 npm 那样吞掉 `--`**：`pnpm run x -- --flag` 会把 `--` 当参数一起传给脚本（脚本收到 `$1="--"`），必须写 `pnpm run x --flag`。

## 5.1 资源约束：低内存机器不要跑 next build

`next build` 峰值内存约 2GB。当前虚拟机 1.6GB 内存时实测：构建跑 38 分钟、负载 30、swap 耗尽，把 Cursor 转发通道拖死（ECONNRESET）。

`scripts/rebuild.sh` 已内置保护：可用内存 < 2GB 时拒绝构建。**注意该保护只在 Linux 生效**（用 `free -m` 取可用内存）；macOS 无 `free` 命令，`AVAIL_MB` 取空后会静默跳过判断、直接开构建——macOS 上请在内存充足时手动跑 `pnpm run rebuild`。可选解法：

```bash
# 方案 A：加 swap（构建会变慢但能完成；需 sudo，一次性）
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile \
  && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab   # 开机自动挂

# 方案 B：扩容虚拟机内存（推荐，VMware 设置里改，需关机）
# 方案 C：在别的机器构建后部署 .next 产物（output: "standalone" 适合做这个）
```

资源不足期间的开发方式：`pnpm dev:web`（按需编译，峰值内存低，首次访问某路由时编译稍慢）。

## 6. GitHub CLI（gh）

仓库的 GitHub 操作用 gh 完成（建库、PR、Release、CI 状态）。

```bash
# 安装（用户目录，免 sudo）
TAG=$(curl -s https://api.github.com/repos/cli/cli/releases/latest | python3 -c "import json,sys; print(json.load(sys.stdin)['tag_name'])")
curl -sLO "https://github.com/cli/cli/releases/download/${TAG}/gh_${TAG#v}_linux_amd64.tar.gz"
tar -xzf "gh_${TAG#v}_linux_amd64.tar.gz" && mkdir -p ~/.local/bin
cp "gh_${TAG#v}_linux_amd64/bin/gh" ~/.local/bin/

# 登录（设备码授权，按提示在浏览器完成）
gh auth login --git-protocol ssh --web --hostname github.com
```

常用命令：

| 命令 | 作用 |
|---|---|
| `gh repo create fde-agent --public --source=. --remote=origin --push` | 建库并首次推送 |
| `gh repo view --web` | 浏览器打开仓库 |
| `gh pr create / gh pr checks` | PR 与 CI 状态 |
| `gh release list` | 发布记录 |

CI：`.github/workflows/ci.yml` 在每次 push/PR 时跑 版本三方同步 + typecheck + lint + web 构建（GitHub runner 内存充足，本机跑不了的 `next build` 在 CI 里验证）。

## 6.1 知识库批量导入（ADP 文档等）

```bash
# 1. 导入期间必须独占数据库：先停掉 web / 机器人
#    在跑 dev server 的终端按 Ctrl+C，或者（⚠️ 绝不要 kill -9）：
kill $(lsof -tnP -iTCP:3000 -sTCP:LISTEN)

# 2. 建库（幂等：同名已存在时只更新描述，不改 embedding 模型）
pnpm dev:cli kb create "腾讯云 ADP 文档（GLM-2048）" --use

# 3. 先 dry-run 看预测，再真灌
pnpm dev:cli kb import /Users/ww/WorkBuddy/腾讯ADP --dry-run --limit 20
pnpm dev:cli kb import /Users/ww/WorkBuddy/腾讯ADP --report .data/kb-import/full.json

# 4. 复跑一次：应全部 skipped（证明幂等，且不产生 embedding 费用）
pnpm dev:cli kb import /Users/ww/WorkBuddy/腾讯ADP

# 5. 检索自检（不花 LLM token）
pnpm dev:cli kb search "签名方法 v3 的签名步骤" --top 3

# 6. 导完再起服务
pnpm dev:web
```

- **增量**：按 `external_id`（doc_id）+ 正文 hash 判断——正文没变就跳过（0 次 embedding 调用）、只变元数据就刷新、正文变了才整篇替换。`--force` 强制重灌；`--prune` 删除库中已不存在的导入文档。
- **换模型必须新建库**：embedding 模型或维度变了，老库不能混灌（`fde kb list` 会给不匹配的库打 ⚠）。
- **出问题先跑** `pnpm dev:cli kb doctor`：检查数据目录、单写者占用、embedding 端点连通性、库与当前配置是否匹配。
- ⚠️ **不只是导入**：任何碰知识库的 CLI 命令（`fde diagnose`、带知识库的 `fde chat`）都会打开 PGlite，**不能与 dev server 同时运行**。顺序就是「停 server → 用 CLI → 起 server」，或者反过来。
- ⚠️ **停服务绝不要用 `kill -9`**：PGlite 的数据在内存里，进程被强杀会丢掉未落盘的部分、导致数据目录**再也打不开**（已实测两次）。web 端与服务端都已注册 SIGTERM/SIGINT 优雅关闭钩子，所以 `Ctrl+C` 或普通 `kill <pid>` 是安全的；`kill -9`（SIGKILL）无法捕获，必坏。详见 `docs/design/2026-09-29-adp-doc-import.md` §8。

## 7. 相关 runbook

- SSH 免密/保活/本地域名：`ssh-setup-and-keepalive.md`
- Windows 文件共享：`samba-windows-share.md`

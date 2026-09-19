# SSH 配置记录：公钥免密 + 断线自动重连

日期：2026-09-19
适用场景：Windows 宿主机（Cursor Remote-SSH / 终端）→ 本机（Ubuntu VM）的 SSH 连接老是断开、重连要输密码的问题。

## 1. 公钥免密登录（已配置）

- 服务端（本机）`~/.ssh/authorized_keys` 已含 Windows 端公钥：`ssh-ed25519 cursor-windows-to-fae-ubuntu`
- 权限要求：`~/.ssh` 700、`authorized_keys` 600（已满足）

**新增一台客户端机器时**：

```bash
# 客户端生成 key（Windows PowerShell / 任意终端）
ssh-keygen -t ed25519
# 把公钥内容追加到本机
cat id_ed25519.pub >> ~/.ssh/authorized_keys   # 在本机执行
```

**Windows 端** `C:\Users\<用户>\.ssh\config`（让客户端主动提供 key 并保持连接）：

```
Host fde-home
  HostName 192.168.187.129
  User fae
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
  ServerAliveInterval 15
  ServerAliveCountMax 4
  TCPKeepAlive yes
```

## 2. 断线保活

**客户端侧**（上面的 config 已含）：`ServerAliveInterval 15` 每 15 秒发心跳，NAT/空闲不断线；`ServerAliveCountMax 4` 容忍 4 次丢包才判定断开。

**服务端侧**（需要 sudo，一次性）：

```bash
echo -e "ClientAliveInterval 30\nClientAliveCountMax 6\nTCPKeepAlive yes" | sudo tee /etc/ssh/sshd_config.d/99-keepalive.conf && sudo systemctl reload ssh
```

**Cursor Remote-SSH**（`settings.json`）：

```json
{
  "remote.SSH.useLocalServer": false,
  "remote.SSH.connectTimeout": 60
}
```

## 3. 会话防断（tmux，已配置）

本机 `~/.bashrc` 已加：交互式 SSH 登录自动 attach 到常驻 tmux 会话 `main`（没有则新建）。

```bash
if [[ -z "$TMUX" && -n "$SSH_CONNECTION" && $- == *i* ]]; then
  tmux attach -t main 2>/dev/null || tmux new -s main
fi
```

效果：SSH 断了重连后自动回到原会话，正在跑的任务（构建、服务）不会被杀死。

## 4. GitHub SSH key（已配置）

- 密钥：`~/.ssh/id_ed25519`（ed25519，无密码短语）
- `~/.ssh/config` 已含 github.com 块（IdentityFile + IdentitiesOnly + keepalive）
- 公钥需添加到 GitHub → Settings → SSH and GPG keys
- 验证：`ssh -T git@github.com` 应返回 `Hi <用户名>!`

## 5. 本地域名（fde.local）

用域名代替记不住的 DHCP IP。当前 IP `192.168.187.129`（VMware NAT DHCP，会变，见下方注意事项）。

**Windows 端**（管理员 PowerShell，一次性）：

```powershell
Add-Content "$env:SystemRoot\System32\drivers\etc\hosts" "`n192.168.187.129 fde.local"
```

之后：`ssh` 配置里 HostName 可写 `fde.local`、浏览器访问 `http://fde.local:3000`。

**本机端**（可选，让本机工具也能用域名）：

```bash
echo "127.0.0.1 fde.local" | sudo tee -a /etc/hosts
```

**注意：IP 会变**。VMware NAT 是 DHCP（本机 IP 已经从 .130 变过 .129）。要彻底固定，二选一：
- VMware Virtual Network Editor → vmnet8 → DHCP 设置里给虚拟机 MAC 做静态绑定；
- 或虚拟机内把 ens33 改成静态 IP（netplan 写死）。
IP 变了又没做绑定的话，更新 Windows hosts 里那一行即可。

## 6. 排障速查

| 症状 | 排查 |
|---|---|
| 还是要密码 | 客户端是否指定了 IdentityFile；`ssh -v` 看有没有 offer key；服务端 `authorized_keys` 权限是否 600 |
| 几分钟不用就断 | 客户端 ServerAliveInterval 是否生效（`ssh -G` 查看）；服务端 drop-in 是否 reload |
| 重连后任务没了 | 是否进了 tmux（`tmux ls`）；`.bashrc` 自动 attach 是否生效 |
| Cursor 连不上 | 看 Output → Remote-SSH 日志；先纯终端 `ssh fde-home` 验证通不通 |

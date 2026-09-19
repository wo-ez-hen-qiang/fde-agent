# Samba 共享与 Windows 映射记录

日期：2026-09-15  
目的：把 Ubuntu 上的 `agent` 目录通过 Samba 共享到 Windows，可浏览、可读写。

## 1. 环境

| 项 | 值 |
| --- | --- |
| Ubuntu | 192.168.187.130（VMware NAT，网卡 `ens33`） |
| 系统用户 | `fae` |
| 共享目录 | `/home/fae/agent` |
| 共享名 | `agent` |
| Windows 访问路径 | `\\192.168.187.130\agent` |
| 已映射盘符 | `Z:` |

## 2. Ubuntu 安装 Samba

在 Ubuntu 上执行：

```bash
sudo apt update
sudo apt install -y samba samba-common-bin
```

创建 Samba 用户（与系统用户 `fae` 对应，密码与 Ubuntu 登录密码相同）：

```bash
sudo smbpasswd -a fae
sudo smbpasswd -e fae
```

`smbpasswd -a` 会提示输入两次 Samba 密码。

## 3. 共享配置

在 `/etc/samba/smb.conf` 末尾增加：

```ini
[agent]
   comment = fae agent project share
   path = /home/fae/agent
   browseable = yes
   read only = no
   writable = yes
   valid users = fae
   force user = fae
   force group = fae
   create mask = 0664
   directory mask = 0775
```

目录权限（保证 Samba 能进入家目录并读写 `agent`）：

```bash
sudo chmod 711 /home/fae
sudo chmod 775 /home/fae/agent
```

启动并开机自启：

```bash
sudo systemctl enable --now smbd nmbd
sudo systemctl restart smbd nmbd
```

检查服务和端口：

```bash
systemctl is-active smbd    # 应为 active
ss -lnt | grep -E ':139|:445'
```

期望监听：

```text
0.0.0.0:139
0.0.0.0:445
```

本机 `ufw` 当时为 inactive；若以后打开防火墙：

```bash
sudo ufw allow Samba
```

检查配置是否生效：

```bash
testparm -s
```

其中应能看到 `[agent]` 段，`path = /home/fae/agent`，`read only = No`，`valid users = fae`。

## 4. Windows 映射

资源管理器地址栏输入：

```text
\\192.168.187.130\agent
```

登录凭据：

- 用户名：`fae`
- 密码：Ubuntu / Samba 为 `fae` 设置的密码

命令行映射为 `Z:`（持久化，重启 Windows 后一般仍在）：

```bat
net use Z: \\192.168.187.130\agent /user:fae 你的密码 /persistent:yes
```

断开映射：

```bat
net use Z: /delete
```

查看当前映射：

```bat
net use
```

## 5. 验证记录（2026-09-15）

从宿主机 Windows 实测：

- TCP **445** 端口可达
- `net use Z: \\192.168.187.130\agent` 成功
- `Z:\` 下列出 `task-manager`
- 能新建文件、读取、删除（读写正常）

任务管理项目在共享中的位置：

```text
Z:\task-manager\dist\
```

对应 Ubuntu：

```text
/home/fae/agent/task-manager/dist/
```

## 6. 注意事项

- 当前是 VMware **NAT**，该共享主要给这台 Windows 宿主机用。
- 虚拟机 DHCP 若更换 IP，需要改地址后重新 `net use`。
- 不要开启 SMB1；Windows 用 SMB2/3 即可。
- Samba 密码与系统登录密码分开存储；改了 Ubuntu 密码后，如无法映射，再执行一次 `sudo smbpasswd fae`。

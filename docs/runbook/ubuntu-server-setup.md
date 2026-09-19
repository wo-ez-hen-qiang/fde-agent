# Ubuntu Server 环境搭建记录

日期：2026-09-15  
目的：在性能有限的电脑上，用 VMware 安装无头（无桌面）Ubuntu，并通过 SSH 从 Windows 管理。

## 1. 方案

不装 Ubuntu Desktop，改装 **Ubuntu Server**，避免图形界面占用内存。

| 项 | 实际环境 |
| --- | --- |
| 虚拟化 | VMware（客户机显示为 VMware Virtual Platform） |
| 系统 | Ubuntu 26.04.1 LTS |
| 内核 | Linux 7.0.0-30-generic x86_64 |
| 主机名 | `fae` |
| 用户 | `fae`（uid 1000，在 `sudo` 组） |
| 内存 | 约 1.6 GiB |
| 根分区 | 约 39G，ext4（`/dev/mapper/ubuntu--vg-ubuntu--lv`） |

## 2. 下载镜像

下载 **Server** ISO，不要下带 `desktop` 的桌面版。

- 官方：https://releases.ubuntu.com/26.04.1/ubuntu-26.04.1-live-server-amd64.iso
- 清华镜像：https://mirrors.tuna.tsinghua.edu.cn/ubuntu-releases/26.04.1/ubuntu-26.04.1-live-server-amd64.iso
- 阿里云镜像：https://mirrors.aliyun.com/ubuntu-releases/26.04.1/ubuntu-26.04.1-live-server-amd64.iso

文件名：`ubuntu-26.04.1-live-server-amd64.iso`（约 2.7GB）

SHA256：

```text
cc8a95cde20f6ced61a322420de00f10cc3c90ced545daa46cb9c1a117f1d927
```

VMware 安装不需要写 U 盘，把 ISO 挂到虚拟机光驱即可。

## 3. 创建 VMware 虚拟机

建议配置（按主机性能偏保守）：

| 项目 | 建议 |
| --- | --- |
| 安装来源 | 使用上面的 Server ISO |
| 客户机系统 | Linux → Ubuntu 64-bit |
| 内存 | 1536 MB～2048 MB |
| CPU | 1 个处理器、1 个核心 |
| 硬盘 | 20 GB 起；本机实际根分区约 39G |
| 网络 | NAT（本机 SSH 最方便） |
| 3D 显卡 | 关闭 |
| 声卡 / 打印机 | 可删除，减少占用 |

创建后在虚拟机设置中把 CD/DVD 指向该 ISO，再开机安装。

## 4. Ubuntu Server 安装要点

安装程序中：

1. 语言、键盘按使用习惯选择。
2. 磁盘使用整块**虚拟磁盘**（只影响虚拟机，不会擦 Windows）。
3. **Install OpenSSH server** 建议勾选。若漏勾，装完后按第 6 节补装。
4. Docker 等 Featured snaps 全部跳过，减轻负担。
5. 创建用户：`fae`，并设置登录密码。
6. 安装结束重启。若再次进入安装界面，在 VMware 菜单断开 CD/DVD，再重启。

## 5. 网络

本机网卡为 `ens33`，VMware NAT：

```text
ens33  UP  192.168.187.130/24
```

在虚拟机里查看：

```bash
ip -br a
```

NAT 下该地址一般只能从宿主机 Windows 访问。若要让局域网其他电脑也能连，把网卡改成 Bridged。

## 6. SSH 安装与排障

### 6.1 第一次连通检查

从 Windows 测虚拟机：

- ICMP ping `192.168.187.130` 一度可达（TTL=64，延迟 &lt;1ms），说明 NAT 和 IP 正常。
- TCP **22 端口连接被拒绝**，80/443/2222 也未开放。

结论：虚拟机在，但 **sshd 未监听**（安装时未勾选 OpenSSH，或服务未启动）。

### 6.2 在 VMware 控制台补装 OpenSSH

用虚拟机窗口登录 `fae`，执行：

```bash
sudo apt update
sudo apt install -y openssh-server
sudo systemctl enable --now ssh
ss -lnt | grep 22
```

期望看到：

```text
LISTEN ... 0.0.0.0:22 ...
LISTEN ... [::]:22 ...
```

若启用了 ufw：

```bash
sudo ufw allow OpenSSH
sudo ufw reload
```

本机当前软件包：

- `openssh-server` `1:10.2p1-2ubuntu3.6`
- `openssh-client` `1:10.2p1-2ubuntu3.6`

服务状态：`enabled` + `active`，监听 `0.0.0.0:22` 与 `[::]:22`。

### 6.3 从 Windows 连接

```bash
ssh fae@192.168.187.130
```

验证命令（在 Ubuntu 上）：

```bash
whoami          # fae
hostname        # fae
systemctl is-active ssh   # active
```

2026-09-15 已从宿主机用用户 `fae` SSH 登录成功。

## 7. VMware 工具

无桌面环境安装 CLI 版即可：

```bash
sudo apt update
sudo apt install -y open-vm-tools
```

本机已安装：`open-vm-tools` `2:13.0.10-1ubuntu1`。

## 8. 当前状态摘要

```text
OS:       Ubuntu 26.04.1 LTS
Host:     fae
User:     fae (sudo)
NIC:      ens33 = 192.168.187.130/24
SSH:      openssh-server 已安装，sshd enabled/active，端口 22
VM tools: open-vm-tools 已安装
Disk /:   39G ext4，已用约 5.0G
Memory:   约 1.6Gi 总量
```

## 9. 常用后续命令

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y open-vm-tools
ip -br a
sudo systemctl status ssh
```

从 Windows 再次登录：

```bash
ssh fae@192.168.187.130
```

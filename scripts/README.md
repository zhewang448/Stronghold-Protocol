# scripts 目录说明

带 ★ 的是本地新增的脚本（不属于上游仓库），其余来自原项目，详见 [docs/DEPLOY.md](../docs/DEPLOY.md)。

当前源码脚本配套 `v0.3.1-extended.7`（基础版本 0.3.1，上一正式版为 `v0.3.1-extended.6`）。安装包已带运行依赖，源码运行请先按根目录 [README](../README.md) 准备环境。

## 日常使用（双击即可）

| 脚本 | 作用 |
| --- | --- |
| ★ `start-tunnel.bat` | **开服给朋友玩**。复用普通启动的 Node、依赖、素材检查；当前安装已经运行时复用，不强杀端口占用者。启动服务器及 cloudflared，服务器重启期间保留隧道。Ctrl+C 停止本窗口创建的进程；附加到已有服务时只关闭本窗口的隧道。参数：`--port 3001`、`--no-tunnel`（只开局域网） |
| ★ `stop-server.bat` | **安全停服**。核验当前安装的本机实例凭据，经控制台正常停服；不终止未知端口占用者。交互时确认活动对局，非交互使用 `--confirm-active` 明确结束对局。参数：`--port 3001` |
| `start-windows.bat` | 原项目的一键启动：检查 Node.js → 首次运行装依赖 → 检查/续传素材 → 启动服务器 → 打开浏览器。只有局域网地址，没有公网隧道 |
| `start-windows.ps1` | 同上的 PowerShell 版，找不到 Node.js 时可以用 winget 帮你装。右键「使用 PowerShell 运行」 |
| `start.sh` | 同上的 macOS / Linux 版 |

## ★ 主机控制台

服务器启动时会同时开一个本机控制台，地址在启动日志的 `Console:` 那一行（默认 `http://127.0.0.1:3100`，即游戏端口 + 100）。只监听 127.0.0.1，局域网和公网隧道都访问不到。

可以做的事：回到任一回合的休整期开始、改 LP / 金币 / 商店等级、加免费刷新、发放干员（含自选干员，可选技能 / 模组）和道具、改盟约层数和人数加成、托管、管理效果和机变卡、编辑棋盘、查看敌人日程并指定敌人组合、判定战斗胜负（客户端战斗模式）、结束休整期、暂停（独立模拟）、结束对局、关闭房间；查看本局统计和历史对局记录；在「设置」里改休整期时长、开关联防叠层。修改直接生效、不扣金币；完整列表见 [docs/LOCAL-CHANGELOG.md](../docs/LOCAL-CHANGELOG.md)。

环境变量：`SP_ADMIN_PORT` 改端口，`SP_ADMIN=0` 关闭控制台。代码在 `server/admin.js`、`server/admin.html`、`server/match/rewind.js`。

## 后台常驻（开机自启）

| 脚本 | 作用 |
| --- | --- |
| `install-service-windows.ps1` | 注册计划任务 `StrongholdProtocol`：开机以 SYSTEM 身份在后台运行服务器（不用登录、退出 5 秒后自动重启），并添加防火墙规则。参数：`-Status` / `-Stop` / `-Restart` / `-Uninstall` / `-Port 8080`。需要管理员权限 |
| `run-server.cmd` | 被上面的计划任务调用，循环运行服务器，日志写到 `logs\server.log`（超过 10 MB 轮换）。一般不用手动运行 |

后台常驻只管服务器，不含公网隧道；本项目计划任务收到控制台停服退出码 75 后不再拉起。其他外部守护程序请按部署文档配置，并优先使用对应服务管理器停服。

## 被其他脚本调用的模块

| 脚本 | 作用 |
| --- | --- |
| ★ `start-tunnel.mjs` | 直接 Node 入口，调用共用 `launch.mjs --tunnel`；Windows 双击经 `start-windows.bat` 完成 Node 和依赖准备 |
| ★ `host-runtime.mjs` | 单实例启动租约、服务器有界重试、公网隧道独立生命周期；仅管理自己创建的子进程 |
| ★ `free-port.mjs` | 经过 `logs/server-instance-<端口>.json` 与本机控制台鉴权正常停服；不扫描、强杀进程 |
| ★ `recover-release.mjs` | 关闭启动窗口、服务及外部守护器后的离线恢复；占用双栈端口并验证备份哈希和当前目标状态，恢复程序及版本元数据。参数：`--backup release-XXXXXX --port 3000 --confirm`，恢复点按安装顺序使用 |
| `launch.mjs` | 原项目启动脚本的共用逻辑（准备环境 → 启动服务器 → 打印局域网地址 → 打开浏览器），也可以 `npm run launch` |
| `open-browser.mjs` | 用默认浏览器打开游戏页面（避免以管理员权限启动浏览器） |

## 常用 npm 命令

| 命令 | 作用 |
| --- | --- |
| `npm start` | 只启动服务器（不准备环境、不开隧道） |
| `npm run setup` | 检查环境、续传素材（缺失的素材重新运行即可续传） |
| `npm run doctor` | 诊断 Node 版本、素材、端口占用、局域网地址和防火墙 |

# scripts 目录说明

带 ★ 的是本地新增的脚本（不属于上游仓库），其余来自原项目，详见 [docs/DEPLOY.md](../docs/DEPLOY.md)。

## 日常使用（双击即可）

| 脚本 | 作用 |
| --- | --- |
| ★ `start-tunnel.bat` | **开服给朋友玩**。先释放端口（结束旧的服务器/隧道），再启动服务器 + cloudflared 公网隧道，列出本机 / 局域网 / 公网地址，然后持续输出日志。Ctrl+C 或关窗口即全部停止。参数：`--port 3001`、`--no-tunnel`（只开局域网） |
| ★ `stop-server.bat` | **停止并释放端口**。结束占用 3000 端口的进程和指向它的 cloudflared 隧道。参数：`--port 3001` |
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

后台常驻只管服务器，不含公网隧道；`stop-server.bat` 结束的进程会被计划任务 5 秒后重新拉起，要停请用 `-Stop`。

## 被其他脚本调用的模块

| 脚本 | 作用 |
| --- | --- |
| ★ `start-tunnel.mjs` | `start-tunnel.bat` 的实际逻辑。日志带时间戳：`[server]` 服务器输出，`[tunnel]` 隧道的错误/警告/连接成功，`[status]` 在线连接、玩家、房间、对局数变化（每 5 秒查一次 `/healthz`） |
| ★ `free-port.mjs` | `stop-server.bat` 的实际逻辑，`start-tunnel.mjs` 启动前也会调用。仅 Windows |
| `launch.mjs` | 原项目启动脚本的共用逻辑（准备环境 → 启动服务器 → 打印局域网地址 → 打开浏览器），也可以 `npm run launch` |
| `open-browser.mjs` | 用默认浏览器打开游戏页面（避免以管理员权限启动浏览器） |

## 常用 npm 命令

| 命令 | 作用 |
| --- | --- |
| `npm start` | 只启动服务器（不准备环境、不开隧道） |
| `npm run setup` | 检查环境、续传素材（缺失的素材重新运行即可续传） |
| `npm run doctor` | 诊断 Node 版本、素材、端口占用、局域网地址和防火墙 |

# Windows 服主启动器

`StrongholdProtocolLauncher.exe` 是 Windows x64 的 WPF 单文件启动器，随带 .NET 运行时，
无需另外安装 .NET。游戏服务器仍需 **Node.js 22 或更高版本**和同版项目文件。默认中文，
通过 `SP_LAUNCHER_LANG=en|ja|ko|zh-TW` 可显式选用项目中的对应语言包；缺少文案时回退中文。

## 快速开服

将 EXE 放在当前版本的项目根目录，与 `package.json` 同级，双击打开。
放在其他位置时，使用「选择服务器目录」选择当前源码 / 整合包目录。
启动器所选目录必须包含 `scripts/host-launcher.mjs`，不能只把 EXE 放进未升级的旧安装。
启动器文案已接入四语言包；日、韩、繁中包中的新增启动器文案目前以英文提供，默认中文不受影响。
本分支的启动器源码随 `v0.3.2-extended.1` 保留；该版尚未发布对应 EXE 附件。已发布版本请从对应 Release 下载启动器，并与同版游戏目录配套使用。

1. 双击 EXE，确认窗口中的服务器目录正确。
2. 选择开服方式和游戏端口，查看右侧检查结果。
3. 点击「启动服务器」，等待环境准备完成和服务状态变为在线；具体错误见下方日志。
4. 点击「复制地址」邀请玩家，或点击「打开游戏」进入本机游戏；管理操作从「管理控制台」进入。
5. 要关服时点击「停止服务器」并确认。**关闭启动器窗口会保留后台服务，不等于停服。**

## 功能与边界

- 仅本机：监听 `127.0.0.1`，适合测试。
- 局域网：沿用原启动器的双栈监听；连接仍受防火墙、路由和网络条件限制。
- 公网隧道：需先安装 cloudflared；沿用项目的临时隧道，不保证地址长期不变。
- 端口范围 1024–65435，管理端口按当前启动流程使用游戏端口 + 100。
- 两个端口均检查占用；启动中控制台失败会关闭本次服务，保留其他监听进程。
- 自动检查实际数据、依赖、前端库与素材清单；准备、错误和重试信息见启动日志。
- 已运行的服务须通过当前安装的实例凭据核验后才显示为在线。不会强杀端口占用者。
- 重启 / 停止均调用现有本机控制台，操作前明确提示断线影响；对局按现有恢复机制处理。
- 关闭启动器会保留后台服务，再次打开可重新连接管理。停止服务请用「停止服务器」。

桌面启动会启用本机管理控制台，并使用游戏端口加 100；不采用继承的 `SP_ADMIN=0` 或
`SP_ADMIN_PORT` 覆盖。已有服务的控制台入口则从实际实例记录读取。
若需要自定义管理端口、计划任务或无桌面的 Linux 服务，请使用 [原启动脚本和部署方式](../docs/DEPLOY.md)。

## 数据与日志

服主偏好保存在 `%LOCALAPPDATA%/StrongholdProtocol/launcher.json`。
日志保存在所选项目 `logs/host-launcher-<端口>.log`，每次重新启动前超过 2 MiB 时轮换一份。
控制台 token 不通过桌面状态接口暴露，插件工作台 URL 的 key/token 参数在日志写入前脱敏。
复制诊断前仍应检查日志中是否含有个人目录、网络地址或插件自行打印的信息。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 无法选择服务器目录 | 选择与 EXE 配套的项目根目录；应包含 `package.json`、`server/index.js`、`scripts/launch.mjs` 和 `scripts/host-launcher.mjs`，不能只选 `server/` 子目录 |
| 找不到 Node.js 或版本过旧 | 安装 Node.js 22+，可用窗口中的安装入口；安装后点击「重新检查」，仍未识别时重新打开启动器 |
| 游戏端口或管理端口占用 | 改游戏端口，管理端口随之加 100；启动器不会强杀占用程序 |
| 公网模式无法启动 | 先安装 cloudflared，再重新打开启动器或重新检查；本机能打开不代表公网隧道已就绪 |
| 启动失败 | 查看「启动日志」或打开「日志目录」；修复错误后重试，必要时运行项目的 `npm run doctor` |
| 关窗口后还能进入游戏 | 这是后台保留行为；重新打开同版 EXE，使用「停止服务器」，或使用原 `scripts/stop-server.bat` 指定相同游戏端口 |
| 玩家打不开分享地址 | 确认选的是局域网 / 公网模式，使用适合对方网络的地址，并检查防火墙；仅本机模式不可供其他设备访问 |
| 端口有服务但不显示在线 | 只有当前安装凭据核验通过的服务才可管理；核对所选目录和端口，不要删除凭据或结束未知进程 |

## 构建与验证

在 Windows 上安装 .NET 9 SDK，然后在项目根目录使用 PowerShell 7：

```powershell
./launcher/build.ps1
node --test test/host-launcher.test.js test/host-runtime.test.js test/host-lifecycle-integration.test.js test/package.test.js
```

产物位于 `dist/launcher-win-x64/StrongholdProtocolLauncher.exe`。
需要在项目根目录双击时，将构建产物复制过去；构建脚本本身不执行复制或启动服务：

```powershell
Copy-Item ./dist/launcher-win-x64/StrongholdProtocolLauncher.exe ./StrongholdProtocolLauncher.exe
Get-FileHash ./StrongholdProtocolLauncher.exe -Algorithm SHA256
```

默认不签名，不会修改系统安全策略或防火墙规则。EXE 是启动工具，不内嵌整个游戏、Node.js 或游戏美术。
源文件和构建脚本保留在本目录，生成的 bin/obj、EXE 不入 Git。
打包时应将 EXE 与同版游戏包配套发布；原 `tools/package.mjs` 仍只从 Git 跟踪的允许列表选取源码，
新增桌面助手已列入允许列表，但生成的 EXE 需构建后另附。
`launcher/` 源码、构建脚本及本说明不由当前玩家包允许列表自动纳入；公开发布时须核对 EXE 与
同版 `scripts/host-launcher.mjs`、`server/http/boot.js` 配套，不能将 EXE 视为独立游戏安装包。

自渲染验收（仅生成 WPF 界面截图，在线和地址为明确标注的演示，不启动服务）：

```powershell
./dist/launcher-win-x64/StrongholdProtocolLauncher.exe --render-preview .impeccable/review/launcher
```

视觉继承 [UI-DESIGN](../docs/UI-DESIGN.md) 的近黑绿灰、薄荷色主操作、直角细边和点阵徽记，
使用 Windows 原生窗口缩放、键盘焦点与可滚动工作区，不改变浏览器游戏界面。

本轮构建标识、专项 / 全量测试结果及未验证项见 [验收记录](../docs/HOST-LAUNCHER-VALIDATION.md)。

# Windows 服主启动器

`StrongholdProtocolLauncher.exe` 是 Windows x64 的 WPF 单文件启动器，随带 .NET 运行时，
无需另外安装 .NET。首次安装可自动下载游戏与便携 Node.js；已有安装也可导入管理。默认中文，
通过 `SP_LAUNCHER_LANG=en|ja|ko|zh-TW` 可显式选用项目中的对应语言包；缺少文案时回退中文。

## 快速开服

只需下载并解压 Windows 启动器附件，双击 EXE，在「新建实例」里选择空的安装目录，点击「下载并安装」。
启动器使用 .NET 自行准备正式 Release。源码中的 1.3.0 会在有签名索引时比较完整包与精简包、素材分包的下载量，校验后安装；旧 Release 继续使用完整包。不需要预先下载游戏包。
缺少受支持的 Node.js 时，会从 Node.js 官网下载并校验便携 Node 22 LTS，保存在当前用户目录，不需要系统安装或管理员权限。
首次安装需要能访问 GitHub 和 nodejs.org。下载失败、校验失败或取消时不会注册半成品实例，清理临时目录后可重试。

已有游戏目录使用「导入已有实例」；目录必须包含配套的 scripts/host-launcher.mjs。已有版本不受支持时请另建空目录安装。

1. 新建并安装实例，或导入已有实例。
2. 在顶部实例列表切换服务器；每个实例分别保存目录、游戏端口和开服方式。
3. 选择开服方式后点击「启动服务器」。新实例自动选择未占用且不与已登记实例冲突的游戏 / 管理端口组合。
4. 点击「复制地址」「打开游戏」或「管理控制台」。在另一实例运行或准备时可以切换管理；切换不会停止后台服务。
5. 「停止服务器」「重启服务」只操作当前选择且凭据校验通过的实例。「移出列表」仅取消登记，不删除文件、不停服。
6. **关闭窗口会保留全部后台服务。** 需要停服时分别切到对应实例并停止。

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

实例列表和当前选择保存在 %LOCALAPPDATA%/StrongholdProtocol/instances.json；旧服主偏好迁移自 `%LOCALAPPDATA%/StrongholdProtocol/launcher.json`。
便携 Node.js 保存在 %LOCALAPPDATA%/StrongholdProtocol/runtime/，默认安装位置为同级 servers/。
EXE 嵌入语言包，尚未安装游戏时也能显示所选语言。
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

开发构建需 .NET 9 SDK；使用已构建的 EXE 无需安装 SDK。在项目根目录使用 PowerShell 7：

```powershell
./launcher/build.ps1
dotnet run --project test/launcher-native/Launcher.Native.Tests.csproj
node --test test/host-launcher.test.js test/host-runtime.test.js test/host-lifecycle-integration.test.js test/package.test.js
```

产物位于 `dist/launcher-win-x64/StrongholdProtocolLauncher.exe`。
需要在项目根目录双击时，将构建产物复制过去；构建脚本本身不执行复制或启动服务：

```powershell
Copy-Item ./dist/launcher-win-x64/StrongholdProtocolLauncher.exe ./StrongholdProtocolLauncher.exe
Get-FileHash ./StrongholdProtocolLauncher.exe -Algorithm SHA256
```

默认不签名，不会修改系统安全策略或防火墙规则。EXE 内嵌 .NET 与语言包；游戏及便携 Node.js 在首次安装时按需下载。
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


## 实例发现与删除

安装/导入保存索引；运行服务可通过本机监听端口、Node 入口和健康接口识别，不要求旧服务修改或重启。不会遍历磁盘，不提供文件搜索。停服未登记实例请「导入已有实例」选择包含 package.json、server、scripts 的根目录。

「移出列表」只取消登记；「删除实例」明确确认后将停服目录送入回收站，再取消登记。运行中、身份不可核验、含其他登记实例或启动器所在目录拒绝删除。请先备份；回收站恢复后可重新导入。

## 命名与本版

已发布的启动器版本为 1.2.0；此分支的源码版本为 1.3.0，需随新的 Release 发布后才能通过自更新获取。EXE 固定 StrongholdProtocolLauncher.exe，附件名随版本变化。新目录 server-01、server-02；显示名按游戏/扩展版本生成，旧自动 MODIFIED_FILE 显示名迁移，自定义名称保留，原目录和端口不移动。

### 控制台同时更新 Windows 启动器（2026-10-26）

Windows 控制台升级、回退或同版修复时，若 Release 包含启动器附件，在游戏包准备后核验同一标签的 Ed25519 签名和 SHA-256。启动器成功安装或自更新后在 EXE 旁记录 ZIP 哈希、版本、文件大小和修改时间；记录与当前文件及目标 ZIP 一致时无需重复下载，记录的版本更高时不会降级。记录缺失或文件变化时重新下载验证。非 Windows 不下载，旧 Release 无附件保留原版。

安装目标为游戏根目录 StrongholdProtocolLauncher.exe，以及新版启动器在所选实例 logs/launcher-location.json 自行登记的绝对路径和精确哈希；不扫描任意 EXE。游戏和启动器共用更新备份，失败及手动回滚同时恢复；原先不存在的根目录 EXE 回滚时移除。

EXE 占用或暂不可写时保留已验签载荷和受保护备份，控制台显示等待关闭。独立后台进程重试最多30分钟；服务器下次启动恢复未完成队列。不会强杀启动器或为此停止玩家服务。超时、权限、路径移动及目标被改写等情况不冒充成功，应检查状态、关闭启动器并正常重启服务后重试。

独立位置登记需要新版启动器实际运行一次。旧版1.1.0不含此登记逻辑，已发布 v0.3.3-extended.1 的旧更新器不会凭空获得此能力；首次先升级更新器代码，根目录 EXE 从后续控制台更新开始同步。放在其他位置的旧 EXE 首次需换用支持登记的新版启动器。现有 Release 标签和附件不覆盖，本节功能随 v0.3.3-extended.2 发布。

### 启动器独立自更新（1.2.0，2026-10-26）

顶部「启动器更新」不依赖游戏实例、Node或控制台运行；启动器启动时只自动检查正式Release，不自动下载安装。按启动器附件的独立版本比较，仅提示更高版本。用户点击下载并确认后，以同一游戏Release标签绑定的Ed25519公钥验证SHA256SUMS和签名，再核对ZIP哈希、路径、EXE格式。使用NSec.Cryptography 25.4.0/libsodium实现验签，相关许可随启动器附件提供。

准备完成后从临时目录启动同版辅助进程，辅助进程重新验签并确认就绪，等待原启动器退出后替换原EXE并重新打开；仅重启启动器，不停止任何游戏服务器。目标字节被其他进程改变、验签失败或重启失败时拒绝覆盖或恢复旧EXE，结果和previous.exe保留在本用户StrongholdProtocol/launcher-updates/update-*目录。权限失败不会静默提权。取消下载保持原EXE不变。与控制台更新共用目标EXE.update.lock避免同时替换。

目录关系：控制台更新总能处理游戏根目录启动器；实例外启动器只有在新版实际运行并将自身绝对路径/哈希登记到实例logs/launcher-location.json后才可由该实例控制台同步更新。同目录不是必要条件。独立自更新直接以当前运行EXE为目标，放在其他文件夹也可用，不依赖任何实例位置。

旧版1.1.0不具备自更新和位置登记能力，需首次手动换用包含此功能的新版本；之后使用启动器自更新。现有已发布v0.3.3-extended.1和1.1.0附件不覆盖。本轮功能随 v0.3.3-extended.2 和启动器1.2.0发布；旧版本附件不覆盖。

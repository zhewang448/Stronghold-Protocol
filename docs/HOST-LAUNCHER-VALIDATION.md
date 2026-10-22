# Windows 服主启动器验收记录

日期：2026-10-22。对应当前源码新增的 Windows EXE，**不是已发布版本的验收声明**。
使用与构建见 [启动器说明](../launcher/README.md)，开服步骤见 [部署指南](DEPLOY.md#windows-服主-exe)。

## 制品与范围

| 项目 | 本轮结果 |
| --- | --- |
| 文件 | `StrongholdProtocolLauncher.exe` |
| 平台 | Windows x64，WPF 单文件，自包含 .NET 运行时 9.0.21 |
| 大小 | 62,777,426 字节，约 59.9 MiB |
| SHA-256 | `09b955183cf19733d11992e2bcf7eaada4583a84f31e9c5c27b03213aace3713` |
| 运行前提 | Node.js 22+、同版游戏目录；公网隧道另需 cloudflared |
| 配套源码 | `launcher/`、`scripts/host-launcher.mjs`；控制台失败回退在 `server/http/boot.js` |

哈希仅标识本轮本机构建，重建后应重新计算；它不代表发布签名。未将 EXE、运行时或游戏素材加入 Git。
未建立公网隧道、修改防火墙、提交代码或发布 Release。

## 已完成验证

| 检查 | 结果与边界 |
| --- | --- |
| 单文件发布 | `dotnet publish` 成功，无报告的警告或错误；最终 EXE 与项目根目录副本哈希一致 |
| EXE 进程 | 实际打开，窗口标题正确且进程响应正常 |
| 启动器 / runtime / 生命周期 / 打包首轮 | 36 项通过，0 失败 |
| 审查修复后的启动器 / runtime / 生命周期 | 19 项通过，包含新增的两项管理端口冲突回归；与首轮集合重叠，不相加 |
| 真实服务流程 | 独立临时项目验证启动、当前安装鉴权、本机模式不发布局域网地址、实际管理端口、重启后 PID 变化、正常停服及状态清理 |
| 管理端口失败 | 占用时拒绝创建服务器；启动期间绑定失败时只关闭本次自建游戏服务，以 75 退出，原端口监听者继续运行 |
| 修复后 boot / version / 文档 | 46 项通过；本轮文档更新后的检查另按实际命令执行 |
| 服务冒烟 | 修复后 `node tools/ci.mjs --only smoke` 通过 |
| Golden | 299 个场景一致：49 roster、46 bonds、22 fields、21 matches、10 standins、151 DIY；未修改基准 |
| 多语言 | 80 个启动器 msgid 在四个语言包中无缺项、无占位符错误；日 / 韩 / 繁中新增文案暂以英文提供 |
| Lint / 类型 | 首轮全仓 lint 0 错误、177 警告；typecheck 通过；最终修复涉及的 JS 文件定向 lint 通过 |
| 界面 | 检查默认、在线演示、紧凑窗口和端口占用演示；修复高 DPI 裁边、主按钮对比度与占用状态不一致 |

自渲染截图保存在本机忽略目录 `.impeccable/review/launcher/`。在线、地址与错误状态明确标为演示，
不据此证明实际联网；原生自动化的应用发现超时，未完成整套桌面点击自动化。

## 全量检查未通过项

本轮 `npm run ci` 测试阶段共 9,404 项：9,326 通过、13 失败、3 取消、62 跳过，
后续 smoke / lint / imports / typecheck 因该阶段失败未在同次 CI 中继续。单独执行的结果如上，不能合称全量 CI 通过。

- 失败包括 `docs/HANDOFF.md` 当前版本断言、插件 / Worker 初始化和试运行超时，以及重型模拟性能门槛。
  交接文档和开发笔记的旧版本表述在后续文档更新中纠正；此前 CI 记录保留，不回写为成功。
- `test/match/sim-host.test.js` 与 `test/plugins/script-sandbox-integration.test.js` 串行复测 9 项通过；
  只覆盖这两个文件，不说明其余失败均已解决。
- 导入边界检查报告 `server/sim/nodeData.js` 的 `node:fs`、`node:path`、`node:url` 三项违规。
  本任务未修改这些模拟器导入，不降低检查门槛。

原始日志在本机 `.cache/launcher-*.log`，不随发布包分发。公网连通、隧道稳定性、Windows 安装权限提示与
不同服主机器上的防火墙行为不在本轮验收范围。

## 文档更新复检（2026-10-22）

同步使用、部署、架构、当前契约、实现历史与未发布记录，纠正 HANDOFF / LOCAL-DEV 的旧版本表述；
不修改发布标签，不把 EXE 功能写为已发布附件。

- `node --test test/docs-consistency.test.js test/docs-paths.test.js test/local-docs-version.test.js`：34 项通过，0 失败。
- 本次涉及的 12 份文档共核对 170 个相对文件链接，未发现目标缺失；该检查不声称验证所有网页或页内锚点。
- `git diff --check` 通过；未提交或推送。

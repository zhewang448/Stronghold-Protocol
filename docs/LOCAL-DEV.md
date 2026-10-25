# 扩展分支开发笔记

这份文档记录本仓库在上游 [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) 之上做的改动，以及读代码时摸清的结构和坑，方便之后继续开发。上游自己的架构文档见 [DESIGN.md](https://github.com/sganggs/Stronghold-Protocol/blob/v0.3.1/docs/DESIGN.md)（总体）、[META.md](https://github.com/sganggs/Stronghold-Protocol/blob/v0.3.1/docs/META.md)（对局与经济）、[SIM.md](https://github.com/sganggs/Stronghold-Protocol/blob/v0.3.1/docs/SIM.md)（战斗模拟）。

## 1. 仓库与分支

v0.3.3 整合候选及验证边界见 [整合说明](UPSTREAM-V0.3.3-INTEGRATION.md)。

迁移回归修复（2026-10-25）：保留本地大厅、等待室、开局和发布工具。策略草稿必须返回 grouped/legacy 统一形状；房间换址清空增量基线；`stateDelta` 与 `delta` 均可协商。在线名单成功响应保留分页业务字段，hello 的 `presenceStatus` 在名单发布前传入大厅。回放调速保持连续游戏时间，20 人联防上报不得截为四席。战绩导入保留二十席与有界回合记录。旧的空名片 wire shape 仍为 null，插件房间不存在的名片不向新房间发布。资源和画面偏好不得因更新清洗丢失；部署缩放默认关闭。

验证使用 `test/ui/real.e2e.test.js` 的本地 Hub/等待室选择器和真实放置合法性；不通过替换大厅或开启历史版本入口来满足上游源码断言。美术 Junction 指向原安装，检查只读；修复事务存放在分支目录的同级事务目录，不提交游戏美术。

控制台四项反馈（2026-10-24）：保存成功/失败有颜色反馈，手动展开有内容淡入与箭头旋转；记录刷新期间保留表格并显示「刷新中 / 已更新 / 重试刷新」，仅新增行轻亮；右下提示复用同一条并支持淡入淡出中断。自动轮询不触发展开动画，减少动态效果遵循系统设置。验证见 `test/ui/admin-feedback.e2e.test.js`。

控制台切换动效（2026-10-24）：面板 140ms 轻淡入并上移 4px，顶栏颜色 100ms 过渡；重复点击不重播，快速切换不排队。系统减少动态效果时取消位移并缩短到 70ms，不等待动画完成再显示内容。

记录页闪屏修复（2026-10-24）：返回「对局记录」复用当前页面，刷新保留筛选与旧汇总，数据无变化时不替换列表。战绩与汇总并行加载，避免整页缩短后再次展开。

控制台标签切换（2026-10-24）：点击立即显示目标栏目及加载状态，接口在后台完成；设置页复用已初始化表单，保留未保存草稿，保存或撤销时显式重读。独立设置接口并行加载，同一栏目正在加载时复用请求。源码修改后需重启服务并刷新控制台才生效。回归：`test/ui/admin-navigation.e2e.test.js`。

多域名迁移（2026-10-24）：控制台新增正式网址、最多 12 个旧站及四种展示/跳转模式；
首页两个个人数据入口已从右上角移至开始按钮下方并排显示，小横屏保持可见和足够点击高度。
找回面板已自动汇总全部启用旧站回复，复用一个窗口，无需逐站检查；受弹窗拦截时点击一次查找全部旧站。
旧站「迁移存档并前往新站」已改为一键直传，新站直接确认预览，不再重复打开旧站检查。
首页/大厅「找回数据」、首次提示、旧站授权摘要选择、最近真实进入时间和恢复前本机备份/撤销，
见 [域名搬迁操作说明](DOMAIN-RECOVERY.md)。原配置与恢复码继续兼容；FRP 绑定须另行保留。

个人数据迁移（2026-10-19）：`public/js/ui/personalData.js` 为纯数据校验/编码/回滚模块，
`personalDataPanel.js` 负责公共弹窗与旧站授权窗口。大厅入口紧接统计数据，标题页也可打开。
迁移不需要账号后端或 CORS；新旧域名都要提供本版前端，旧域名不能只做 301/302 跳转。
用户在新站填旧网址，在旧站确认目标 origin 并允许，新站核对摘要后确认恢复并刷新。
恢复码也可复制或存成 `.spdata` 文件，可在不连接旧站时导入。应在停用旧站前提醒用户导出；
已经失效且没有备份的域名，其浏览器隔离存储无法由新站读取。完整字段、安全边界和导入语义见
[当前界面契约](design/client.md#本机个人数据备份与域名迁移2026-10-19)。测试：
`node --test test/ui/personal-data.test.js`；双域名与布局浏览器测试为 `test/ui/personal-data.e2e.test.js`。
本机可在已被 Git 忽略的 `local/personal-data.json` 配置 `migrationSource`（仅完整 HTTP(S) 源站地址）。
前端打开迁移弹窗时从 `/personal-data-config.json` 读取默认旧站地址，缺失/无效则留空；
用户可手动修改，延迟返回的配置不会覆盖已输入内容。配置文件不进版本库或发布包，源码中不写具体实例地址。

| 远程 | 地址 | 用途 |
|---|---|---|
| `origin` | `zhewang448/Stronghold-Protocol` | 本分支扩展与维护 |
| `upstream` | `sganggs/Stronghold-Protocol` | 拉官方更新 |

- 默认分支 `main` 已整合主机工具、联动扩展、皮肤与预加载。`local-tools` 和 `codex/operator-skins` 保留原功能分支历史；`master` 只跟踪上游，不在上面改。
- 合并上游新版本时从 `main` 开功能分支，完成适配与测试后再合并回 `main`。
- 同步上游：`git fetch upstream` → `git merge upstream/master` → `npm install` → `npm run setup`（上游常会加素材）→ `node --test`。
- 素材 `public/assets/`、`.cache/`、`.claude/` 都在 `.gitignore` 里，不进仓库。新机器 clone 后要先 `npm install && npm run setup`。
- 当前版本为 `v0.3.3-extended.1`，基于上游 `v0.3.3`；源码尚未打包发布。已发布的 `v0.3.1-extended.11` 资源下载与在线状态修复仍保留在下方历史记录。扩展保留多人大厅、启动器、签名增量更新与恢复流程。

当前源码已整合上游 `v0.3.3`；`package.json` / APP_VERSION 为基础版本 0.3.3；`server/release-version.js` 单独记录扩展标签。发布附件与公开状态以 Releases 为准。

上游 v0.3.1 合并的兼容处理（2026-10-18，随 v0.3.1-extended.1 发布）：

- 保留 Hub 布局、文字聊天、每回合统计、主机工具、7 名联动与 174 套安装皮肤。皮肤选择与上游外观插件共用一个 store、同步器和服务端校验，支持插件皮肤、他人皮肤显隐及原有随机 / 导入导出。
- 部署缩放继续默认关闭，以既有 `deploymentZoom` 偏好为准；上游 `prepDeployFold` 仅在旧配置没有本库字段时迁移。弹药和秘术师能量按上游合成一个开关，旧布尔偏好自动迁移，作战统计仍默认开启。
- 测试房间通过 Hub 开关创建，保留自定义密钥、加入确认与测试标识；测试房间不写入本库战绩、回放和重启恢复，跨局汇总过滤旧测试记录。普通插件局仍转发 hostId，主机迁移同时供本库工具与测试指令使用。
- 回档保留当前皮肤选择，恢复交互窗口抽取次序，通信序号保持单调递增，取消旧窗口的定时器与延续；玩家状态中的凯瑟琳领取次数随快照恢复。
- 官方数据生成与上游一致，另保留联动自选池；音效清单比上游多 23 个联动攻击 / 命中引用及对应音库。

此前 v0.3.0 合并的兼容处理：

- 保留社区 Hub UI、皮肤、7 名联动、聊天标点、公告、盟约预选、帧率、ZIP 资源管理和状态增量；快捷键随上游扩成七项，加入 W 悬停购买；作战统计按维护者要求默认开启，保留已保存的关闭偏好，仍用浏览器只读统计。
- 两套素材功能统一注册 classic `/sw.js`：上游导入包使用独立缓存，本库预载保留按哈希校验、音频别名和 Range。关闭预载停止下载，清理只删除本库缓存，统一 worker 继续服务上游导入素材。旧 `/resource-sw.js` 只保留升级兼容，不再注册争用 scope。
- 回档补入上游 `itemPool.debt`，取消废弃时间线的浏览器 AI 预演。沿用上游同盟自选库存翻倍、整备区扩展和已展示装备欠账规则；强制发放的库存标记仍保留。
- `server/match/host/extensions.js` 通过既有 IPC 在玩法插件独立进程内调用控制台能力，支持状态、目录、监控墙、代操作、改属性、回档、结果与回放记录；父进程不执行插件代码。皮肤、盟约预选及全局计时 / 回放配置也跨进程同步。
- 上游 Forge 导入的临时校验目录在 Windows 使用 junction，CLI 预载使用 file URL；UI 插件消息校验包含本库 `state.*`。这些适配不改变模拟规则。
- 原版局自动重启恢复保留；玩法插件局尚不保存跨进程恢复快照。普通数据插件可尝试回放；需要额外脚本授权的回放会明确拒绝启动，避免错误地用原版数据播放。完整脚本回放授权流程和插件局重启恢复仍待实现。

各版上游合并、主机扩展与发布验证见 [LOCAL-CHANGELOG.md](LOCAL-CHANGELOG.md)。

## 2. 本地新增了什么

### 2026-10-18 控制台开发者模式

控制台顶栏「开发者模式」开启后显示「模拟页面」，列出全部 6 个开发工具和 30 个中文对局场景。
开关保存在当前浏览器的 `sp.admin.developer-mode`，退出后隐藏入口；不更改主机或对局设置。
工具从当前控制台端口的新标签页打开，复用本机会话鉴权，无需填写游戏端口。同一控制台页面内，普通点击按工具路径复用预览：
重复打开同一场景只聚焦，不重置状态；不同对局场景在同一个 Game Mock 页切换，UI Kit 等其他工具各自独立。
关闭预览后可以重新打开，切换控制台栏目保留复用关系；刷新或关闭控制台后重新建立关系，不接管此前的预览页。
Ctrl / ⌘ 点击、中键及浏览器菜单仍可另开页面。预览无法复用或弹窗被阻止时保留原生链接回退，新页保持 opener 隔离。
本版完整 / 轻量包包含开发页面与录制、性能样例；旧包缺少
`public/dev/` 时显示「当前安装包未包含」。模拟一致性校验仍需从源码生成参考数据。`shared/devtools.js` 共用中文工具、场景目录，
模拟页右侧切换器和事件按钮也使用中文。验证见 `test/ui/admin-devtools.e2e.test.js`。

### 2026-10-16 控制台与组队界面修订

- 控制台顶部读取 /api/overview，显示在线人数、房间、对局、CPU 与内存；公告和重启/关闭位于「服务器」。房间先选概览，再分「操作 / 数据」；玩家行只读，展开后按数值、发放、托管分组，数字输入按 Enter 应用，滚轮不改值。对局记录每页 20 条，可搜索房间、玩家、模式、难度、结果。
- 设置 → 插件管理通过 startAdmin 的 studioUrl 跳转到游戏实际端口。runMain 使用 srv.studio.pageUrl 注入地址；只有本机会话通过 /studio 路由取得跳转，页面没有硬编码 3000 或公开钥匙。社区来源与兼容边界见 [COMMUNITY-PLUGINS.md](COMMUNITY-PLUGINS.md)。
- 组队海报偏好独立保存为 sp.pref.room.card / sp.pref.room.cardSkin；room.card 的 charId、skinId 由生成目录校验，room.state.seats 的 card/cardSkin 同步队友；不改战斗皮肤、技能或模拟。清空恢复自动分配。
- data/seat-art.json 由 node tools/build-data.mjs --seat-art-only 生成并下载图片到忽略目录 public/assets/seat-portrait/；加 --offline 仅据缓存生成目录。固定素材清单下含 432 名干员、1356 张图；未被源收录的未来皮肤不在此数量内。完整包包含所列图片。来源为官方 character/skin 表及 docs/research/seat-art-portraits.json 对应的素材清单。
  新安装的 setup 自动补齐所需海报，也可单独运行 node tools/install-seat-art.mjs 断点续传；只下载目录中声明的 PNG，不更改游戏规则。
- 同盟选择右栏安全居中，溢出从顶部排起；高度 ≤500px 隐藏创建插画。测试在输入前检查四边和 elementFromPoint 中心命中，避免自动滚动掩盖布局问题。

专项测试：test/seat-art.test.js、test/ui/seat-art.e2e.test.js、test/ui/admin-overview.e2e.test.js、既有 admin 系列和 custom-room-code 浏览器测试。测试使用独立端口和 recovery:false 或临时恢复目录。

本地自己的文件（上游没有，合并不会冲突）：

控制台「设置 → 交流管理 → 房间聊天」可配置玩家文字开关、发言间隔和保留条数；主机消息仍从房间聊天管理发送。
「设置 → 维护与扩展 → 桌面安装入口」可控制是否显示「添加到桌面」按钮，默认开启。保存后首页、大厅和横屏提示
同步更新，已连接玩家无需刷新；新页面和重连读取当前配置。该选项保存为 `logs/admin-settings.json` 的
`showPwaInstall` 布尔值，跨重启保留，旧配置缺省开启。关闭只隐藏游戏内入口，不卸载应用，也不屏蔽浏览器自带菜单。
「对局设置 → 局内每回合统计」可单独关闭实时伤害，已结算回合继续保留。上述配置保存于既有
`logs/admin-settings.json`，保存立即生效并跨重启保留。源码更新后需重启服务并刷新控制台：控制台首页模板在启动时读取。

| 文件 | 作用 |
|---|---|
| `scripts/start-tunnel.bat` / `.mjs` | 经共用启动准备建立服务器和 cloudflared；受管服务器重启时保留本启动器创建的隧道。Windows 双击会检查 Node、依赖及素材 |
| `scripts/host-runtime.mjs`、`server/instance.js` | 每端口启动 / 隧道租约、异常重启上限和本安装的回环令牌实例记录；绝不按端口强杀其他进程 |
| `scripts/stop-server.bat` / `free-port.mjs` | 只有令牌与 PID 都确认本安装实例时才请求优雅停止；结束活动对局需明确确认 |
| `server/admin.js` / `admin.html` | 本机主机控制台（HTTP API + 单页界面） |
| `server/service-control.js` | 直接启动模式的脱离窗口重启助手，等旧进程退出后再启动，日志在 `logs/service-restart.log` |
| `server/match/replay.js`、`server/replay-store.js` | 战斗输入与已采纳结果录制、gzip 保存、指纹和记录清理 |
| `server/replay.html`、`server/replay-viewer.js` | 主机回放页：回合时间线、阵容、敌人、播放与结果核对 |
| `test/match/replay.test.js`、`test/replay-store.test.js`、`test/admin-replay.test.js`、`test/ui/admin-replay.e2e.test.js` | 回放确定性、存储、鉴权与真实浏览器验证 |
| `server/match/rewind.js` | 回到任一回合的休整期开始（快照 + 恢复） |
| `server/match/history.js` | 每回合记录 `m.history`（控制台的曲线、每回合详情、干员排行、对局记录） |
| `server/match/enemyPicks.js` | 敌人日程：每回合所有组合、本局抽到的概率、实际出怪、主机指定（`m.adminPicks`） |
| `server/match/hostSettings.js` | 主机设置：休整期时长与可选联防叠层，对所有房间、所有对局生效 |
| `server/match/adminDiy.js` | 控制台「发放自选」：给任一玩家（含 AI）发放任一有 kit 的自选干员 |
| `server/release-*.js`、`scripts/apply-release-update.mjs`、`tools/release-sign.mjs` | 控制台 Release 更新与发布签名（见第 5 节） |
| `test/match/rewind.test.js`、`test/admin.test.js`、`test/release-*.test.js` | 对应的测试 |
| `test/local-docs-version.test.js` | 各文档的「当前版本」与 `RELEASE_TAG` 一致，扩展修订号都带基础版本 |
| `docs/LOCAL-DEV.md`、`LOCAL-CHANGELOG.md`、`HANDOFF.md` | 本分支的文档（上游的 `CHANGELOG.md` 不改，避免合并时冲突） |

改动过的上游文件（合并上游时可能冲突，每处都只有几行）：

| 文件 | 改了什么 |
|---|---|
| `server/sim/rng.js` | 加了 `rng.setState()`，回档用 |
| `server/match/Match.js` | 构造函数里加了 `prepSnapshots`（`Map<回合, 快照>`）、`history`、`adminPicks` |
| `server/match/match/clientCombat.js` | 启动前录实际 BattleSpec，结果最终采纳后录结果摘要；不影响战斗随机流 |
| `public/js/battle/runner.js` | 回放运行中调倍速，保持已播放时间与暂停位置 |
| `public/js/render/app.js` | 回放暂停渲染与暂停时尺寸变化重绘 |
| `server/match/match/prep.js` | `enterPrep()` 开头调用 `capturePrep()`；休整期倒计时改读 `prepSeconds(this, gd.prepTime(r))` |
| `server/match/match/settle.js` | `settle()` 结尾和 `finish()` 里调用 `recordRound()` |
| `server/match/match/phases.js`、`bossRounds.js` | 生成波次的三处（`startRound`、`_planBossWaves`、领袖战开打）把 `this.factions` 换成 `waveSource(this)` |
| `server/match/audit.js` | 休整期倒计时的检查改用 `prepSeconds()` |
| `server/http/boot.js` | `runMain()` 里启动控制台，打印 `Console:` 地址 |
| `tools/build-data.mjs` | 加了 `DIY_COLLAB_ALLOWED`：列在里面的联动 6★ 不受两条联动排除规则限制，进自选池（见第 8 节） |
| `server/sim/content/kits/index.js` | `OPERATOR_KIT_FILES` 末尾加了 7 个联动 kit（`op-ash.js` … `op-makoto.js`） |
| `server/sim/ai.js` | `attack` hook 多带一个 `attackId`（两处 `b.emit('attack', …)`），丰川祥子的音符要用 |
| `server/sim/battle/combat.js` | 加了 `nextAttackId()`：丰川祥子没有目标时的「持续攻击」自己领一个攻击编号 |
| `server/sim/content/traitMods.js` | 加了 `KIT_OWNED_CHARS`（丰川祥子）：她的 LOR-Y 和 REA-Y 句式相同，但只算技能未开启时的范围，由她的 kit 处理；不排除的话引擎会再加一次攻速 |
| `tools/assets/plan.mjs` | 中文语音树：只有联动配音（`voiceLangDict` 没有 `CN_MANDARIN`、有 `LINKAGE`）的干员改用 `voice/` 目录（灰烬、艾拉、玛露西尔、丰川祥子、结城理） |
| `public/js/render/fx/kinds.js` | `FX_KINDS` 加了 `persona`（结城理换人格，只换模型）、`oblvnsNote`（丰川祥子音符命中） |
| `public/js/render/units.js` | `FORMS` 加了 `char_4217_makoto`：结城理各人格的动画 |
| 生成的数据 | `data/backups.json`、`data/assets.json`、`data/i18n/*.json`、`test/golden/diy.json`：合并上游时按第 8 节重新生成，不要手工合 |
| 测试里写死的数量 | `test/backups.test.js`、`diy.test.js`、`assets-diy.test.js`、`full-potential.test.js`、`potential.test.js`、`i18n-data.test.js`、`feedback7-voices.test.js`、`content/feedback5-we2-summon-hand.test.js`、`render/issue25-downback.test.js`：自选池 71 → 78、单位形态 256 → 277、有语音的干员 191 → 198 等，改动处都标了 `local-tools` |

当前 v0.2.6 的自选池为 79 名（上游 72 + 本地 7），单位形态 280 个，有语音的干员 199 名。上表的 71 → 78、256 → 277 等是 v0.2.2 的历史数量。上游自己的文档仍描述排除联动的官方分支，以本节为准。

0.2.0 起上游把 `Match` 的方法拆到了 `server/match/match/*.js`，启动代码从 `server/index.js` 拆到了 `server/http/`。

### 房间交流（文字聊天与战场标点）

2026-10-17 交流面板移植：棋盘阶段将文字聊天放入左下角「交流」，使用参考站当日公开 `emotes.js` / `emotes.css`
的左侧图标栏、表情 / 历史共用区域与单行输入布局，保留数字页码。`matchCommunication.js` 将本库 `chatStore`
接入组件，继续通过 `sendChat` / `room.chat` 发送，权限、屏蔽词、200 字限制和失败草稿均不变。
新玩家消息使用 `EmoteBubble` 文字模式，在对应头像右侧显示约 3 秒；历史同步不补播，主机消息只在记录里显示。
过长气泡最多显示三行，全文保留在记录。关闭消息提示后丢弃当前气泡批次，重开不补播。
等待室、开局说明、盟约轮选和结算继续使用可拖动聊天窗口。设置页、HUD、商店和全局比例不参与本次改动。
来源、外观参数及其他候选 UI 见 [REFERENCE-UI-REVIEW.md](REFERENCE-UI-REVIEW.md)。
验证：`test/ui/match-communication.test.js` 与 `SP_E2E=1` 下的 `test/ui/match-communication.e2e.test.js`；
原聊天与表情浏览器回归继续适用。

2026-10-16 主机聊天恢复：`POST /api/action {room,action:'chatSend',value:text}` 仅走认证本机控制台，
复用 `RoomChat.message` 和房间广播，固定主机身份、`role:system`，前端称「主机消息」。
消息长度校验与普通聊天一致；控制台轮询不重建输入框，失败留草稿、发送中锁按钮，输入法确认不发送。
主机不占玩家的节流或禁言额度，只发送所选房间；全站公告继续独立。

`logs/admin-settings.json` 新增 `blockedWords`，缺省/空数组禁用。设置页每行一词，忽略大小写的
普通字面匹配、长词优先，命中替换为 `***`；最多 100 条、40 码点/条，JSON 总计 4096 字节。
服务端在新玩家及主机消息进入历史前过滤；已有记录、姓名、全站公告不变。配置验证及原子保存后
立即生效，其他设置保存保留当前词表，重启读取。设置页按对局→交流→记录恢复→维护扩展→清理重排，
导航在桌面侧边/手机顶部，各项独立保存，时长预览折叠。
测试入口：`test/chat-settings.test.js`、`test/admin-chat.test.js`、`test/chat.test.js`；
浏览器 `test/ui/admin-chat-settings.e2e.test.js`，并回归 `admin-chat.e2e.test.js` 与 `admin-settings.e2e.test.js`。
验证：`.cache-chat-settings-final.log` 定向 67 项通过；`.cache-chat-settings-browser.log` 四项浏览器
回归通过；补充输入焦点保护、玩家消息过滤及失败保留后，`.cache-chat-settings-browser-final.log`
最终用例通过。类型检查、变更文件 lint、四语言严格检查通过；设置与聊天面板机械设计检查无发现。
独立收尾审查指出并已修复轮询的 textarea 焦点保护，复核为 ship。未修改模拟和 golden。

2026-10-16：局内 `pieceClick` 优先将棋盘上的右键交给标点处理，与空地一致；左键详情、手机长按、
整备区右键与预览/观战查看沿用原行为。`test/ui/pings.e2e.test.js` 在引擎及 DOM 后备视图验证
右键已占据干员格只发一次标点、不弹详情，左键仍能打开详情。

文字聊天入口在等待室和对局中持续显示，默认位置避开侧边效果、准备按钮和计时器。`server/chat.js` 保存每房间最近 50 条消息，身份、时间由服务端生成；`room.chat` 仅正式玩家可发送，观战席只读。每条最多 200 个 Unicode 码点 / 1024 字节，每会话间隔 1 秒，每房间滚动 1 秒最多 10 条；`clientId` 对最近 50 次发送去重。加入与重连收到 `chat.history`；客户端 `chatStore.js` 合并历史和实时消息，保留草稿，离开或更换房间清空，断线不排队发送。Enter 发送时避开中文输入法候选确认，Shift+Enter 换行、Esc 收起；用户文本由 Preact 转义。

聊天按钮和展开后的标题可用鼠标或触摸拖动；聚焦后方向键微调 1 px、Shift+方向键 10 px，展开面板内可恢复默认位置。`public/js/ui/chatPosition.js` 将归一化坐标保存在浏览器 `sp.pref.chatPosition.name.<编码昵称>`，同一浏览器、同一站点按昵称分别记忆；同名重登录或服务端身份过期仍恢复，没有昵称时才退回 playerId。此为本地显示偏好，同名共用，换浏览器 / 设备 / 站点不共享；不写入游戏协议、聊天内容或草稿。窗口变化后保持相对位置，按钮和展开面板限制在屏内；存储不可用或配置损坏时仍可拖动使用。

标点使用 `g.ping {fieldId, area, row, col, kind}` 与 `m.ping`；服务端校验场地可观察权限、棋盘坐标、五种类型及 500 ms 间隔，并附 `playerId` 和服务端的 `name`，客户端不能指定发送者。房间广播后，仅当前观察该战场的客户端显示 2.5 秒，不进入战斗模拟、回档或回放，也不在重连时补发。正式玩家包括淘汰玩家可发送，观战席只接收；切换场地不会重播旧标点音效。客户端保留最多 32 条，阶段或回合变化清空；动画包括落下、上浮与两圈落点扩散，减少动画设置下保留静态落点环。原创 Web Audio 音效沿用音效音量与静音设置，页面隐藏或未解锁音频时不补播。

聊天借鉴 RyantArgnisan/Stronghold-Protocol 的 GPL 实现，署名见 NOTICE；标点参考 ApexPing 的交互思路，没有引入其代码或依赖。两者均为维护者请求的非官方扩展 `[ASSUMED]`，不改战斗规则或 golden。接口详见 META 与 design/network，专项测试见 `test/chat.test.js`、`test/ping.test.js`、`test/ui/chat.test.js` 及对应浏览器测试。

### 社区 Hub UI 移植（2026-10-15）

基于 isomerpoi（雨千代chiyo）的 `ui-redesign-upstream` / `b2bd17a`，按文件移植，未 merge 或 cherry-pick。

直接移入（先确认本地相对 `488db49f` 没有改动）：

- `public/css/components.css`
- `public/css/devices.css`
- `public/css/screens/draft.css`
- `public/css/screens/game-panels.css`
- `public/css/screens/result.css`
- `public/js/federation.js`
- `public/js/render/fx/arrivals.js`
- `public/js/screens/bandDraft.js`
- `public/js/screens/room.js`
- `public/js/screens/settle.js`
- `public/js/screens/sweep.js`
- `public/js/screens/title.js`
- `public/js/ui/accounts.js`
- `public/js/ui/achievements.js`
- `public/js/ui/choiceOverlay.js`
- `public/js/ui/cloudStats.js`
- `public/js/ui/components.js`
- `public/js/ui/fieldHost.js`
- `public/js/ui/friends.js`
- `public/js/ui/hubBackdrop.js`
- `public/js/ui/hud.js`
- `public/js/ui/lobbyMusic.js`
- `public/js/ui/matchFlow.js`
- `public/js/ui/matchIntro.js`
- `public/js/ui/matchPlates.js`
- `public/js/ui/matchPopups.js`
- `public/js/ui/matchmaking.js`
- `public/js/ui/namecards.js`
- `public/js/ui/ownerName.js`
- `public/js/ui/pixbots.js`
- `public/js/ui/protocolScene.js`
- `public/js/ui/screenFit.js`
- `public/js/ui/seatArt.js`
- `public/js/ui/teamPanel.js`
- `public/js/ui/transitions.js`
- `public/js/ui/trophies.js`
- `shared/randomMode.js`

三方合并后检查本地扩展：

- `public/css/screens/game.css`
- `public/css/screens/loadout.css`
- `public/css/screens/lobby.css`
- `public/js/audio.js`
- `public/js/render/app.js`
- `public/js/render/units.js`
- `public/js/screens/game.js`
- `public/js/ui/loadoutModel.js`
- `public/js/screens/loadout.js`
- `public/js/screens/lobby.js`
- `public/js/ui/settings.js`

保留 `ui/skins.js`、`ui/skinPicker.js` 的真实实现与 `room.skins` 同步；皮肤先 `cleanSkins` 校验再合并导入，卡片和列表均提供随机皮肤与恢复默认。新同盟创建页保留自定义密钥；等待室重新接入已有 `room.addBot` / `room.removeBot`。聊天位置记忆、标点、联动干员和回放暂停逻辑不变。

不支持的匹配、公开房间列表、好友、私密房间、无限火力和名片同步入口按真实协议能力隐藏。没有新增虚假 C2S，也没有玩家端开发者控制台。修复来源包的昵称正则和部署特效变量错误；新界面文字保留字号设置，不用局部 `--t` 覆盖屏蔽设置。

四个 `public/i18n/{en,ja,ko,zh-TW}.json` 补充译文，已有译文优先，来源和授权见 NOTICE。`test/e2e/client.mjs` 新增真实 Hub 创建和密钥加入助手；原浏览器用例只调整新页面流程、选择器和异步加载等待，不删行为断言。验证记录见 LOCAL-CHANGELOG；后续范围与约束仍以 UI-HUB-PORT 为准。

### Hub 第二阶段（2026-10-16，v0.2.6-extended.5）

参考站点公开源码按功能拆入，没有整体替换本库网络、聊天或皮肤实现。完整验收与差异见 [UI-HUB-ACCEPTANCE.md](UI-HUB-ACCEPTANCE.md)。

| 分类 | 新增 / 改动文件与适配 |
|---|---|
| 盟约预选 | 新增 `public/js/ui/bondPlan.js`；main、等待室、bandDraft、teamPanel 接入；server/lobby、PlayerState、platform、views、rewind、shared/protocol 保存、广播和校验八个核心盟约 |
| 渲染上限 | 新增 public/js/frameRate.js；settings、gameLogic/settings 和 render/app 接入，不改变 runner 时钟 |
| 表情 | shared/constants、protocol、match/intents 改用 72 个允许 ID；ui/emotes 与 emotes.css 分 12 页，保留官方清单；36 张自制图仅放本机 ignored assets |
| 伤害统计 | 新增 battle/metrics、ui/combatMetrics、combatMetricsLayout；runner 收集只读指标，game 接入非模态面板；不写回 Battle |
| 全站公告 | 新增 server/announcements、shared/announcements、ui/announcement；server/net、lobby、admin 和 main / title / lobby / room / game 接入；替换旧聊天公告，保留清空 / 禁言 / 踢出 |
| 资源管理 | 新增 public/js/resources/、ui/resourcePanel、resource-sw、asset-cdn、shared/cdn、resourcePaths、server/http/resourceManifest、tools/build-resource-manifest.mjs；setup 和 static 接入。ZIP 用浏览器原生实现，不新增依赖 |
| 状态增量 | 新增 shared/stateDelta、server/stateDelta；server/net、lobby、public/js/net 和 shared/protocol 只合传输适配。单独保存实现前快照与增量补丁 |
| 界面细调 | 手合 components、lobby / room / result / game / title / draft / loadout CSS 与对应组件，移除赞助；保留密钥、皮肤工具栏、聊天、标点、默认六键和更新记录 |

资源清单是机器安装库存：npm run setup 自动生成，单独更新用 node tools/build-resource-manifest.mjs。data/resource-manifest.json 被忽略，绝不手改官方 data 表。服务器首次请求时也按本机库存懒生成，新增素材后重启以更新服务端缓存。HTTPS / localhost 使用 SW；普通局域网 HTTP 或不支持 Cache Storage 的浏览器仍用旧 ui/preload.js / preloadSection.js。四个 vendor 库继续普通 HTTP 预热，SW 不缓存执行代码。缓存与 ZIP 限制详见 [ASSETS.md](ASSETS.md)。

## 3. 对局引擎速览

核心在 `server/match/`：`Match.js`（构造函数，以及平台和对局之间的接口契约，改之前先读一遍）和 `PlayerState.js`（每个玩家的经济、棋盘、手牌、羁绊）。0.2.0 起两者的方法分别拆在 `server/match/match/*.js` 和 `server/match/player/*.js`，启动时装到原型上（同名方法定义两次会直接报错）。

### 阶段流转

```
LOBBY → INFO_CHECK → BAND_DRAFT → BATTLE_CHECK
  → startRound(r): ROUND_START → [SP_DRAFT 机变，仅 spRounds] → PREP 休整期
  → endPrep(): COMBAT → [UNITE 联防] → SETTLE → afterSettle() → startRound(r + 1)
       r == bossRound   → FINAL_ASSAULT
       r == hiddenRound → HIDDEN_CORE
  → finish() → RESULT（调用 onEnd，房间回到大厅，随后 dispose）
```

对应方法：`startRound`、`enterSpDraft`、`enterPrep`、`endPrep`、`startCombat`、`startUnite`、`settle`、`afterSettle`、`startFinalAssault`、`finish`。

### 几个必须遵守的机制

- **随机数**：全部来自 `rngSetup / rngShop / rngWaves / rngDraft / rngBots / rngMeta` 六条流（`server/sim/rng.js`，mulberry32，状态只有一个 uint32）。战斗的种子由 `deriveSeed(seed, 回合+座位)` 派生。不要在对局逻辑里用 `Math.random`，否则回档和测试的确定性都会坏掉。
- **计时器**：一律用 `m.later(ms, fn)`（记在 `m._timers` 里，`dispose` / 回档时能统一清掉）。阶段倒计时用 `m.setDeadline(秒, fn)`。
- **错误隔离与推送**：外部入口都包在 `m.guard(fn)` 里，它负责捕获异常并在结束时 `flush()`。改了玩家状态要调 `ps.dirty()`（→ `m.markPrivate`），改了公共状态要调 `m.markPublic()`，然后由 flush 统一下发 `m.private` / `m.public`。
- **全量同步**：`m.onReconnect(playerId)` 会重发完整的 `m.public`、`m.private` 和进行中的战斗；把 `ps._lastPriv = null` 再 `dirty()` 也能强制重发 `m.private`。
- **客户端战斗**：默认战斗在玩家浏览器里模拟（`public/js/battle/runner.js`），服务器只校验结果。`battleId` 带递增的 `_battleSeq`，过期的 `b.progress` / `b.result` 会被静默忽略。浏览器在阶段变成 `PREP` 等非战斗阶段时会丢掉本地战斗（`runner.js` 的 store 订阅），回档正是靠这一点让前端自动回到休整期画面。
- **AI**：`server/match/bot.js`，由 `scheduleBotPrep` 等方法分片调度，用 `ps._botPrepToken` / `m._turnToken` 判断旧任务是否作废。

## 4. 回档（rewind.js）

### 原理

`enterPrep()` 一开头（在 `onPrepStart` 效果之前）调用 `capturePrep(m)`，用一次 `structuredClone` 存下：

- 每个 `PlayerState` 的全部自有字段，减去 `PS_SKIP` 里的那些（引用、身份、连接状态、缓存、配装）
- `MATCH_KEYS` 里的对局级字段（回合、波次、上回合结果、团队 LP 等）
- v0.2.3 新增的 AI 表情计数 `_botEmotesSettledRound`、`_botEmotesMerges`，避免废弃时间线抑制回档后的反应。开局重刷字段在开局后锁定，保留当前重刷结果。
- 共享卡池 `m.pool.entries`
- v0.2.4 的首领超时阈值 `bossOvertimeStartReal` 随快照恢复；共享装备库存按玩家当前持有的道具和配装实时计算，恢复玩家状态后自动恢复，无须单独快照。
- v0.2.5 的随机首领配对 `bossPairs` 与 `bossWaves` 一并恢复，保留队友和左右半场；回到首领配对生成前的休整期时清空废弃时间线的配对。
- 六条 rng 的状态
- `bossPool`、`_uniteBounds` 这类类实例或含 `PlayerState` 引用的对象，按引用保存（它们只会被替换，不会被原地修改）

`rewindToPrep(m, round)`（不传 round 取最新一份）先停掉一切进行中的东西（`runner`、客户端战斗计时器、`_timers`、阶段/轮次计时器），把快照写回原来的对象上，再调一次 `enterPrep()`。因为 rng 状态也恢复了，`onPrepStart` 效果和 AI 的行为会和第一次完全一样。最后所有人收到全量同步。

每个休整期都存一份（一局最多 15 份，每份约 25 KB）。回到第 R 回合时删掉 `> R` 的快照（那条时间线作废），R 自己那份由随后的 `enterPrep()` 重新生成，所以可以反复回到同一个起点。快照在机变之后才拍，回档保留那回合已选的机变卡。

### 故意不回滚的字段

| 字段 | 原因 |
|---|---|
| `uidSeq` | 浏览器里迟到的操作带着旧 uid，只会命中同一个棋子或找不到，不会误操作到别的棋子 |
| `_battleSeq` | 被中止的战斗迟到的上报对不上任何新战场，被忽略 |
| `replay` | 不进入 `MATCH_KEYS`，回到第 R 回合显式删除回放中回合号 ≥ R 的废弃时间线 |
| `_turnToken`、`ps._botPrepToken` | 旧的 AI 任务和选秀计时器自动作废 |
| `connected` / `left` / `autoplay` / `loadout` / `ops` | 连接状态以现在为准，配装和潜能 / 练度（0.2.2 的 `ops`）在开局后就锁定 |

### 以后加新状态时

- 给 `PlayerState` 加普通字段：**自动**进快照，不用改什么。如果是缓存或不该回滚的东西，加进 `PS_SKIP`。
- `PlayerState` 上的**类实例**字段不能直接进快照：`structuredClone` 会丢掉原型，恢复后调用方法就报 `is not a function`。要么开局后不变、加进 `PS_SKIP` 按引用保留（0.2.0 的 `diy`、`standIns` 等），要么像 `diyStock` 那样把里面的数据单独克隆、恢复时写回原实例。
- 给 `Match` 加一个回合内会变的字段：要加进 `MATCH_KEYS`。如果是类实例，像 `bossPool` 那样放进 `refs`。
- 函数类型的自有属性会被跳过（`audit.js` 和测试会在实例上包装方法，这些不是状态）。
- 跑 `node --test test/match/rewind.test.js`。第一个用例「回档后重打 ≡ 直接打完」会抓出漏掉的状态：我验证过，故意不恢复卡池或 rng，它都会失败。

### 限制

- 对局结束后（`m.ended`）不能回档，房间已经回到大厅。
- 同盟模式下卡池是全队共享的，只能整局一起回档。
- 每回合多一次 `structuredClone`，第 12 回合 1 真人 + 3 AI 实测约 2.3 ms。

## 5. 主机控制台（admin.js）

服务器启动时开在 `127.0.0.1:<PORT+100>`（默认 3100），`SP_ADMIN_PORT` 改端口，`SP_ADMIN=0` 关闭。用 `start-tunnel.bat` 启动时，地址会出现在 `[server]` 日志里。

页面顶部三个标签：

- **房间**：每个房间一张卡片，含对局操作、玩家表和「详情」，下面是可折叠的统计面板：本局统计（对局结束后变成「上一局统计」）、敌人日程（剧透，默认折叠）、控制台操作日志。
- **对局记录**：`logs/results/` 里保存的每一局，点开看结算详情。
- **设置**：版本更新、空闲自动更新、重启恢复、联防叠层和休整期时长；资源标签显示负载、流量和 RTT。

### 安全

本机服务控制：控制台顶部「重启服务」「关闭服务」通过受 token / Host 保护的 `/api/service` 发起，必须传 `confirm: true`，和 Release 更新互斥。`boot.js` 接入正常关闭流程，直接重启助手先确认就绪、待旧进程退出后启动新进程；保留地址、游戏端口、控制台端口和环境变量，不依赖 CMD 窗口。Windows 自启循环识别退出码 75 为主动停服；其他 supervisor 默认禁用关闭，详见 [DEPLOY.md](DEPLOY.md)。浏览器重启后取新 token 自动刷新，关闭后停止轮询并保留关闭状态。针对性验证在 `test/admin-service.test.js`、`test/ui/admin-service.e2e.test.js`。

三层，缺一不可：只监听 127.0.0.1（局域网和隧道都到不了）；`/api/*` 必须带 `X-Admin-Token`（每次启动随机生成，嵌在页面里）；`Host` 头必须是控制台自己的 localhost 地址（防止浏览器里打开的其他网站通过 DNS rebinding 调用）。`test/admin.test.js` 覆盖了这三条。对局记录和设置也只走这个端口，游戏端口（会通过隧道公开、没有鉴权）上没有任何入口。

### 实时查看与代操作

房间玩家表的「实时查看 / 代操作」打开 `/live`，通过控制台 API 每 500 ms 拉取所选玩家的 `m.public` / `m.private` 状态，并复用正式游戏界面显示商店、棋盘、盟约、战斗和 HUD。页面默认只读；勾选「开启代操作」后，刷新、购买、升级、冻结、出售、布阵、装备、道具、奖励 / 机变选卡、准备和托管等普通 `g.*` 指令会以该玩家身份经服务端原有校验执行，操作结果推送给玩家页面。

战斗画面使用 `b.start` 的显示副本在控制台本地运行，`authoritative` 永远为 `false`，不会发送 `b.progress` / `b.result`，不会改变玩家的观战偏好，也不会抢占战斗权限。切换玩家会关闭代操作并重新载入私有状态；回合、阶段、状态摘要变化时，过期代操作会被拒绝并要求刷新。AI、已退出或淘汰玩家只能查看，对局结束后停止实时查看。所有代操作写入主机操作日志和回放摘要。实现位于 `server/admin-live.js`、`server/live.html` 和 `server/live-viewer.js`。

### API 路由

| 请求 | 说明 |
|---|---|
| `GET /live?room=&playerId=` | 复用正式游戏界面的本机实时查看页（控制台 Cookie） |
| `GET /api/live?room=&playerId=` | 所选玩家实时公私状态、一次性战斗输入、共享血池与结束信息（控制台 token） |
| `POST /api/live` | 带对局、回合、阶段及状态摘要的普通代操作；拒绝战斗上报、离开及房间管理指令 |
| `GET /` | 控制台页面 |
| `GET /api/service` | 服务操作能力、禁用关闭的原因、当前操作与进程标识 |
| `POST /api/service` | `{ action: 'restart' 或 'shutdown', confirm: true }`；返回 202 后正常关服，和更新、重复操作互斥 |
| `GET /api/rooms` | 所有房间：对局阶段、玩家数据、`history`、`enemyPlan`；房间级的 `log`（操作日志）和 `lastMatch`（没有进行中的对局时，上一局的统计） |
| `GET /api/catalog?room=` | 当前模式可发放的干员、道具、机变卡 |
| `POST /api/action` | `{ room, action, playerId?, value? }` → `{ ok }` 或 `{ error, code? }` |
| `GET /api/results` | 对局记录列表（新的在前，只有摘要） |
| `GET /api/result?id=` | 一条记录全文。`id` 必须是 `logs/results/` 里的文件名（`^[\w-]+\.json$`），防路径穿越 |
| `GET /wall?room=`、`GET /api/wall?room=` | 只读四席完整游戏画面及席位摘要；画面分别读取已鉴权的 `/api/live` |
| `GET /resources`、`GET /api/resources` | 资源页面及最近 10 分钟采样 |
| `GET /api/results-summary` | 跨局汇总，可按 `from` / `to` / `mode` / `difficulty` 筛选 |
| `GET /api/recovery`、`POST /api/recovery` | 恢复开关、问题文件列表；写入需 `confirm:true`，支持 `{enabled}` 或 `{action:"delete",id}` |
| `GET /api/release-notes` | 当前安装版本的玩家更新记录 |
| `GET /api/settings` | 当前的休整期设置 `{ prep }`、设置文件路径，以及各同盟模式每回合的默认秒数 |
| `POST /api/settings` | `{ prep }`：校验、写文件，然后生效 |
| `GET /api/update` | 更新状态：当前 / 最新扩展标签、`versions`（`new/current/old`、附件及不可安装原因）、`hasMore`、网络配置、请求来源、下载字节数、错误和是否支持重启 |
| `POST /api/update` | `open`：每个 updater 生命周期仅首次自动检查，只有首次调用返回新版 `notify`；`check`：刷新正式 Release 列表；`more`：获取下一页（每页 30）；`network`：保存 `{ network: { proxy, mirror } }`；`install`：按已查询的 `tag` 后台下载，旧版需 `allowDowngrade:true`，当前版修复需 `repairAssets:true`，活动对局需 `force:true` |

首次打开行为由服务端消费，刷新和多页并发不会重复检查或提醒；检查请求并发合并。查询正式版本按数值排序，过滤草稿、预发布和无法识别的标签；当前版本没有远程附件时仍显示。当前版本仅在显式 `repairAssets:true` 时允许重新安装，用于修复素材；旧版回退和活动对局分别确认。网络配置保存在 `logs/release-network.json`；运行时使用 undici 的 HTTP/HTTPS `ProxyAgent`，兼容 Node 22.14，不依赖启动时环境变量。先代理 / 直连 GitHub，失败后绕过该代理直接访问镜像（默认复用素材工具的 `https://gh-proxy.com/` 前缀）。整个响应消费含 JSON、校验文本、流下载、SHA-256 与程序清单验证均可回退，更新忙碌或已有待安装包时拒绝修改网络配置。

更新只访问 `zhewang448/Stronghold-Protocol` 的正式 Release；只有 lite 时显示不可安装，不接受源码包。升级优先使用同时带校验清单与 Ed25519 签名的 `*-update.zip`，回退旧版本和同版修复始终使用 assets 完整包。先验证发布签名及 ZIP SHA-256，再检查 `UPDATE.json` 的 `from`、可选 `fromTags` / 目标 `tag`、文件数量与字节数，以及完整程序 `MANIFEST.json` 和必需的目标素材哈希 `art`。未变化的程序逐项与目标哈希比较后复制到暂存区，变化程序及素材来自已验签增量包；缺失或损坏的本地文件、旧式增量清单、下载或校验错误均触发同 Release 完整包回退，完整包仍独立验证签名与哈希。控制台显示预选包、实际包、下载大小和回退原因；不会因增量失败改用未签名校验。

`release-art.js` 将已认证的完整目标素材哈希记入内部暂存清单 `RELEASE-ART.json`，安装前后校验全部目标素材及三份素材清单的引用。下载、暂存解压容量和安装备份空间都在对应写入前预检。变化的程序、素材和素材清单一起备份、替换与回滚；额外本机素材不删除。停服前等安装助手握手成功；新版本在回环隔离子进程校验健康接口、build、HTML、主模块和 WebSocket ping，并关闭插件脚本、PREP 恢复、控制台及数据写入。兼容只读探测协议的候选失败时，在释放安装锁前校验并恢复原程序和版本标记；旧版本先在隔离暂存目录验证，不对用户目录运行旧引导程序。

正式进程对外启动失败与只读探测失败区分处理：正式版本可能已触及主机设置或运行态，只标记 `recovery-required`，保留锁、备份和诊断状态，不自动覆写运行中的程序或数据。独立于游戏服务器的离线工具 `node scripts/recover-release.mjs --backup release-<id> --port <游戏端口> --confirm` 只在端口空闲、备份内容逐文件验证且恢复目标与记录一致时恢复；先后回退，不能把不同时间点的反向补丁当成独立完整快照。

控制台「维护与扩展 → 更新备份与空间」显示占用，默认保留最近 2 个验证通过的更新前恢复点，可设 1–20 个；最新已验证恢复点、进行中的事务以及需要恢复 / 检查的备份不可自动清除。日志和状态在 `logs/release-update-status.json` 与 `logs/release-restart.log`；正式启动在验证完成前不会显示“已安装”。回退保留主机原有设置和记录，不做格式逆迁移。

解压、与本机素材逐文件比较及暂存校验由 `release-stage-worker.js` 工作线程执行，不占用服务主线程；线程退出后才允许安装或清理暂存目录。停服后的安装器仍会重新校验素材，发现期间被修改的文件时拒绝安装。

**发布签名**（`server/release-signing.js`）：镜像（默认 `gh-proxy.com`）是第三方，可以同时换掉 Release 列表、`SHA256SUMS.txt` 和 ZIP，所以只靠 SHA-256 防不住镜像篡改。现在维护者用 Ed25519 私钥给 `SHA256SUMS.txt` 签名，附件 `SHA256SUMS.txt.sig` 是一行 base64。签名内容为 `stronghold-protocol-release\n<标签>\n` 加上校验文件原始字节，绑定标签，防止拿别的版本的签名冒充。公钥列在 `RELEASE_PUBLIC_KEYS`（SPKI DER base64）。

- 有 `.sig` 的版本：列表、校验文件、签名、ZIP 都可以走镜像；签名不符直接报错，不退回未签名的校验方式。
- 没有 `.sig` 的版本（`v0.2.5-extended.2` 及更早）：版本列表和校验值（`SHA256SUMS.txt` 或 API 的 `digest`）都必须直连或经主机自己的代理从 GitHub 取得，ZIP 本身仍可走镜像。列表来自镜像时 `releaseView` 给出不可安装原因。请求经过哪条路由由 `createUpdateRequest` 作为 `consume` 的第二个参数传出，更新器按标签记在 `listedVia`，安装时以 `listing` 传给 `downloadAndStage`。
- 旧版控制台不认识 `.sig`，照旧按 SHA-256 安装新版，不受影响。

`package.json` 是上游游戏版本，扩展标签由 `server/release-version.js` 的 `RELEASE_TAG` 记录，**每次扩展发布必须更新**，并同步 README、HANDOFF §2、本文第 1 节的「当前版本」和 LOCAL-CHANGELOG 最新一节的标题（`test/local-docs-version.test.js` 会检查）。打包后在附件目录运行 `node tools/release-sign.mjs sign <标签> <目录>`，生成 `SHA256SUMS.txt` 与 `SHA256SUMS.txt.sig`，再用 `verify` 复核，两者都上传到 Release。私钥默认在 `~/.stronghold-release/release-ed25519.pem`（`SP_RELEASE_KEY` 可改），不进 Git、不进发布包，需要另外备份。换密钥时，用旧密钥签一个把新公钥加进 `RELEASE_PUBLIC_KEYS` 的版本，下一版再去掉旧公钥。私钥丢失时，用新公钥发一个不带 `.sig` 的版本：已安装的控制台按未签名规则，只在直连 GitHub 时安装它。只有在没有私钥的机器上才用 `keygen` 生成新密钥。安装器另在 `logs/release-version.json` 写入实际安装标签与源码指纹（优先扩展版本文件，无该文件时使用入口文件）；指纹和基础版本均匹配时允许记录较旧标签，正确识别回退。手动替换源码使指纹失效后使用源码声明，兼容旧标记时仍不让较旧标签覆盖声明。打包必须包含 `scripts/apply-release-update.mjs`、运行依赖 undici 和复用的 `tools/assets/sources.mjs`；ZIP 读取器放在 `server/` 与打包器共用。启动时看到安装锁会等复制完成后退出，让 supervisor 再启动一份读取新文件的进程。

对局操作：`rewind`（`value` 为回合数，空则最新）、`endPrep`、`pause`（仅独立模拟）、`endMatch`、`enemyPick`（`{ round, id }`，指定某回合的敌人组合，`id` 为空恢复原定）、`battleWin` / `battleLose`（`{ field, n? }`，仅客户端战斗）、`prepTimer`（同设置页的休整期配置，`null` 恢复跟随控制台）。旧 `timerScale`（0.1–10）兼容为仅设置本房间休整期倍率。

玩家操作：`funds`（增减）、`lp`（设定）、`level`（设定）、`refresh`（+1 免费刷新）、`chess` / `item`（发放）、`diy`（`{ charId, tier: 5|6, elite, skillIndex?, uniEquipId? }`，发放自选，见下）、`diySkill`（同样的值，只改技能和模组）、`bondAdd` / `bondSet` / `bondBonus`（`{ bond, n }`）、`autoplay`（1/0，仅真人）、`effectRemove` / `bountyRemove`（效果 / 悬赏 id）、`card`（机变卡 effectId）、`pieceRemove` / `piecePromote`（棋子 uid）、`pieceEquip`（`{ target, item }`）。房间操作：`closeRoom`；`announce`（`value` 为公告，`room:"*"` 广播全部）、`chatClear`、`chatMute`（`playerId` + 布尔 `value`）、`chatKick`（`playerId`）。

- **会触发游戏效果的**：`bondAdd`（走 `addLayers`，派发 `onLayers`）、`card`（走 `applyCard`，全队卡会作用到所有存活队友）、`pieceEquip`（派发 `onEquip`，能合成时直接合成）。其余都是直接改数据，不扣金币、不触发 `onLevelUp` 之类的效果。
- **判负**：普通战场按 `n` 条计数漏怪生成结果，结算扣 `min(10, n)`；同盟模式下这些漏怪会像真的一样进入联防。联防判胜等于全部击杀，判负等于没人支援（按漏怪者自己的漏怪数扣血）。领袖战判胜把共享血池清零，判负把同盟 LP 清零，两者都会结束所有领袖战场。

### 统计与记录

- **装备超库存确认（`v0.2.4-extended.4` 起）**：`item` 仍支持字符串 ID；库存不足返回 `ITEM_STOCK_CONFIRM`，没有状态变化。页面弹出「是，强制加入 / 否」确认框，Esc 取消；只有点是才重发 `{ id, force: true }`。`pieceEquip` 直接装备也使用相同确认码，保留 `{ target, item }` 并在确认后补 `force: true`；不允许未经确认绕过库存。此入口仅在已鉴权的本机控制台，普通游戏协议不能调用。`acquireItem.forceStock` 给实际超限的装备记 `adminStockCopies`，合成累加授权份数，回档随棋子快照恢复；库存仍按全部普通 1 / 进阶 2 计数，审计只扣除明确授权的份数，普通装备超限仍报错。容量已满仍拒绝，操作日志区分首次拒绝和确认后的发放。

- **每回合记录**：`history.js` 的 `recordRound(m)` 在 `settle()` 结尾写一条 `{ round, enemy, players: [...] }`。`enemy` 是这回合的敌人组合（类型、特殊 / 普通 / 精英的名字、是否控制台指定）。每个玩家有 LP、剩余金币、商店等级、累计花费 / 伤害 / 漏怪 / 击杀，以及本回合的扣血、漏怪、击杀、伤害、是否无伤、每个造成伤害的干员（来自 `lastResults` 的 `unitStats`，召唤物不算）。领袖战回合不经过 `settle()`，在 `_finishFinal()` 完成结果统计后、进入下一回合前立即记录，避免第 14 回合进入隐秘核心时漏记；`finish()` 按回合去重补记。未结算的休整期 / 作战期手动终止不复用上一回合明细。旧记录的缺失逐干员数据不能由总伤害推回。`history` 在 `MATCH_KEYS` 里，回档时自动截断，被放弃的回合不保留。
- **伤害的含义**：模拟器记的是实际从敌人身上扣掉的生命值（减防、减抗、护盾之后，不算溢出，`server/sim/damage.js` 的 `applyHpLoss`）。同一波怪全部击杀时，几个玩家的伤害基本相同，等于这波怪的总血量；差别来自漏怪、悬赏怪、敌人回血或召唤。元素损伤不扣血，不计入。联防里的伤害只进累计数，不分干员。游戏结算页的「造成伤害」是同一个数。
- **累计数据**：直接读 `ps.stats`（`statsOf()`），实时。`gold` 是花掉的金币，`fundsGained` 含利息、悬赏和控制台加的。
- **操作日志**：`handleAction` 每次执行后写进 `room.adminLog`（最多 100 条，失败的也记，`closeRoom` 不记），跨对局保留到房间关闭。
- **对局记录**：`startAdmin` 包装了 `lobby.onMatchEnd`（`onEnd` 闭包按属性名调用它，所以实例上的包装会生效；这样不用改上游的 `lobby.js`），在原函数清掉 `room.match` 之前写 `logs/results/<时间>-<房间>.json`：`{ savedAt, room, mode, difficulty, result, history }`。`result` 是 `buildResult` 的结算数据，阵容、道具、盟约、分队补上了名字，`stats` 合并了 `statsOf()`。写文件失败只记日志，不影响对局。同一份数据精简后存在 `room.adminLastMatch`，房间卡片据此显示「上一局统计」，下一局开始后换回本局。`startAdmin({ resultsDir })` 可以改目录（测试用临时目录）；`SP_ADMIN=0` 时不存记录。
- **每回合干员伤害排行**：前端从 `history[].players[].units` 直接算（`drawUnitRounds`），不另存数据。「占本人」的分母是该玩家这回合所有干员伤害之和，不含联防。
- **实际干员名称**：浏览器结果经过 `fields.js validateClientResult()` 后，干员名字从服务器保存的本场 `BattleSpec` 按玩家与棋子 uid 解析；自选读取该棋子的 `diy`，补位读取 `standIn`，不信任浏览器上报的名字，也不拿其他玩家的选择或自选位占位名称覆盖。回合记录和伤害广播复用这个名字。累计排行按棋子类型与当场名字共同分组，控制台复用空自选位换人后不会把两人的伤害合并；控制台详情和保存的终局阵容也显示实际补位名字。已保存的旧记录没有完整的逐回合选择快照，保留原记录，不猜测替换历史名字。
- **页面**：统计面板在 1.5 秒一次的重绘之外单独维护（`statsPanel`）：重绘后把原节点移回房间卡片，各部分只在自己的数据变化时重画，所以悬停提示、下拉框和展开状态不会被轮询打断。曲线一次画一个指标（不做双 Y 轴），可切换成表格；扩容实验分支的颜色按座位固定，由 `public/js/ui/playerSeries.js` 统一提供二十种玩家色，图形对 `#141816` 和详情底色 `#101311` 的对比度至少 3:1。局内与控制台的曲线、图例、表格和伤害条共用配色；多组局可筛选分组或全部，点击图例突出玩家，再点恢复。

### 发放自选（adminDiy.js）

自选棋子是按「自选位」区分的（每人 4 个：5 阶、6 阶各 2 个），客户端和战斗都按自选位读玩家的选择（`ps.diy`、`m.private.diy`）。所以发放某名自选干员时，先把它放进该等阶的一个自选位，再发这个位的棋子：优先用已经放着它的位，其次空位，再次这名玩家场上、手牌、整备区都没有棋子的位。也就是说，同一时间每个等阶最多 2 名不同的自选干员；有棋子的位不会被换掉（换掉的话那些棋子会跟着变成别人）。一名持有干员只能占一个位（和自选编队规则一致），已经在另一等阶上场时会拒绝。

- 技能和模组：控制台的两个下拉框，不选就用默认（最后一个技能、第一个可用模组，同干员调配）。`uniEquipId: 'none'` 是不装备。原型干员固定用锁定的选择，下拉框不可用。
- 输入名字即显示匹配候选（5/6 阶、普通/精锐），目录尚未返回时显示加载状态，返回后自动补齐。点击候选或上下键加回车只选择，再按回车发放；中文输入法确认不触发发放。使用页面候选列表，避免浏览器原生 `datalist` 异步更新后不弹出的问题。浏览器回归：`SP_E2E=1 node --test test/ui/admin-diy.e2e.test.js`（Windows 设置 `CHROME_PATH` 为可运行的 Chrome/Chromium 路径，见 HANDOFF §3）。
- 其他候选输入（发放干员、道具、装备、机变卡）共用 `candidateInput()` 和候选层，仍从原有 `datalist` 目录读取标签，回车走原有动作处理器，保留直接输入 ID。候选层固定定位，滚动或窗口尺寸改变时关闭，避免被详情区裁切。上述浏览器回归同时覆盖这四类操作的目录和实际请求参数。
- 一个自选位只有一套技能和模组，同一位上的棋子都一样。所以给已在位上的干员换技能（发放时选了别的技能，或点「改技能」走 `diySkill`），这个位上已有的棋子会一起变。召唤物跟技能走的干员（召唤物在手牌里）换技能后没专门处理，可能不一致。
- 新位的库存直接给满，不检查本局禁用盟约（控制台不受限制）。
- AI 座位也可以发，绕过 `setDiy` 的 AI 检查，照它的写法重建 `ps.diy`、`ps._diyRecords`、`ps.gd`。
- 回档：自选位的分配不回滚（`diy` 等在 `PS_SKIP` 里）；快照之后才加的位，库存会被恢复掉，之后那个位从商店抽不到，直到下次发放。
- 「发放干员」框里填了没分配的自选位 id 会提示改用「发放自选」。

### 敌人日程（enemyPicks.js）

开局时 `setupMatchWaves` 定下整局的日程：从 6 个随机类型（飞行、频次、元素、持续、隐匿、折射）里取 3 个，每个占 3 个回合，「特异」占剩下的 6 个，打乱后每回合一个类型；再给每回合按权重抽一个「该类型 × 前半（1–7 回合）/后半」的条目，排除本模式禁用的。每个条目带 1 种普通、1 种精英，所以一个条目就是一种组合（数据里共 67 个）。

- `planView` 列出每回合所在半场的**全部**组合，标出是否本模式禁用、本局有没有这个类型，并按日程算出官方抽到每个组合的概率（类型下没有可用条目时回落到特异，和 `pickRoundEntry` 一致）。
- `rosterOf` 按该回合的出怪模板算出实际出怪（不含悬赏）：第 1–3 回合的模板没有特殊位，地面组合去掉飞行位、飞行组合去掉地面位，领袖回合只出精英护卫。所以组合里的怪不一定都会出现。
- 主机指定存在 `m.adminPicks`（在 `MATCH_KEYS` 里，回档恢复）。生成波次的三处（`startRound`、`_planBossWaves`、领袖战开打）通过 `waveSource(m)` 读日程。当前回合只能在战斗开始前改，改完立即重建波次（玩家的敌人预览跟着变）；之后的回合在那回合开始时生效。指定的组合不消耗 `rngWaves`，其他随机流不变。

### 休整期设置（hostSettings.js）

进程级的一份 `prep`：`default`（按数据 `rounds[r].prepTime`，同盟第 1 回合 65 秒到第 14 回合 195 秒）、`scale`（× 0.1–10）、`fixed`（每回合 5–3600 秒）、`perRound`（指定的回合用指定秒数，其余按数据）、`untimed`（不限时，等所有人就绪或控制台结束）。

- `enterPrep()` 设倒计时时经过 `prepSeconds()`，进行中的对局从下一个休整期开始生效。房间默认 `prepOverride = null`，持续跟随控制台；单独覆盖支持相同五种模式，替换全局配置，不重复相乘。其他阶段计时不变。`audit.js` 使用同一个函数；内部开发参数 `timerScale` 保留，但控制台不再修改它。
- `soloUntimed` 的对局（独立模拟、只有一个真人的同盟房间）仍然不限时。
- `startAdmin` 启动时读 `logs/admin-settings.json`（`settingsFile` 选项可改，测试用临时文件）。保存时先校验、写临时文件再改名，最后才生效；文件损坏时记日志并按默认处理。
- 全局设置不进回档快照；房间的 `prepOverride` 随休整期快照恢复，为 `null` 时使用当前全局设置。正常开服在恢复对局前加载设置，`SP_ADMIN=0` 也加载已保存的主机规则设置，但不创建资源采样器、不运行控制台自动更新。

### 可选联防叠层（hostSettings.js）

控制台「设置 → 联防叠层 → 允许联防叠层」设置新房间的默认值，布尔值 `uniteLayerGains`，默认 `false`。房主可在等待室「同盟设置 → 允许联防叠层」单独控制本房间，修改会取消其他真人的就绪；开局后本局固定。房间保留该选择，房主迁移和下一局也不重置。这是明确选择的自定义规则，与上游默认联防不叠层的玩法不同。

- 控制台同一区域新增「允许房主自行设置联防叠层」：`allowRoomUniteLayerGains`，默认关闭，旧配置文件也不自动授权。开启后房主才能修改；关闭立即锁定所有已有房间入口，服务端拒绝 `UNITE_LAYERS_LOCKED`，但保留房间原先选择和正在进行的对局。
- `GET /api/settings` 返回 `prep`、`uniteLayerGains` 和 `allowRoomUniteLayerGains`；`POST /api/settings` 允许单独提交，省略项保留。全部校验通过并成功写入 `logs/admin-settings.json` 后才生效；权限保存会向所有房间广播 `canSetUniteLayerGains`，无需刷新。
- 创建房间时复制 `getUniteLayerGains()`，开局通过 `opts.uniteLayerGains` 传入（插件子进程同样传递）。每次 `_uniteOpts()` 保存本局值到 `Match.uniteLayerGainsEnabled` 并写入 `flags.layerGainsEnabled`。服务器与浏览器使用同一规则；之后修改控制台默认值只影响新建房间。直接创建 Match 且省略选项的旧调用方仍按每次联防读取主机设置。
- 援助干员从本轮普通战斗已达到的层数开始联防，每场战斗的特性计数和额度重新获得。结算先合入普通战斗增量，再给援助者合入联防增量各一次，复用 999 上限和 `onLayers` 钩子；漏怪方不会收到援助者的层数，合成兜底结果也不发层数。
- 最终攻势和隐秘核心仍禁止叠层。房间选择写入磁盘恢复记录，重启后仍保持；局内回档不修改本局规则，联防战斗和结算使用同一捕获值。
- 页面支持保存、撤销未保存修改、重载与保存失败重试；休整期时长和联防开关独立保存，不会互相覆盖。
- 回归：`node --test test/admin.test.js test/match/unite-layers.test.js test/content/garrisons_battle.test.js test/match/rewind.test.js`；真实控制台操作与桌面 / 手机布局用 `SP_E2E=1 node --test test/ui/admin-settings.e2e.test.js`。

### 本地文件

都在 `logs/` 下（已在 `.gitignore` 里，不会提交）：

| 路径 | 内容 |
|---|---|
| `logs/results/<YYYYMMDD-HHMMSS>-<房间>.json` | 每局一份对局记录，同一秒同一房间重名时加 `-2`、`-3` |
| `logs/replays/<同名结果文件>.json.gz` | 整局战斗输入、阵容、敌人、已采纳结果与操作摘要；保留最近 50 局 |
| `logs/admin-settings.json` | 休整期时长与联防叠层开关 |

### 加一个新操作

在 `admin.js` 的 `PLAYER_ACTIONS` 或 `MATCH_ACTIONS` 表里加一项，签名分别是 `(m, ps, value)` 和 `(m, value)`，返回 `OK` 或 `{ error }`。它会在 `m.guard()` 里执行，所以异常会被隔离并记日志，结束后自动推送视图，也会自动进操作日志（在 `admin.html` 的 `ACTION_NAMES` 里给它一个中文名）。直接改字段后记得 `ps.dirty()`，影响羁绊或棋盘合法性的改动还要 `ps.recompute()`。页面上的按钮或输入框在 `admin.html` 的 `roomCard` / `playerRow` 里加，用 `data-click` 或 `data-act` 属性接到同一个 `act()` 函数。需要「像玩家一样操作」时，改成调用 `ps.levelUp()` 这类方法即可。

### 整局回放与数据清理

维护者确认的本地主机功能，不改变官方玩法。控制台默认开启录制，设置写入 `logs/admin-settings.json`；`SP_REPLAY=0` 强制关闭，`SP_ADMIN=0` 不启动控制台也不录制。关闭录制会立即释放活动对局的回放内存，这些对局以后不再保存回放，重新打开只对后续完整录制的对局有效。

`server/match/replay.js` 在 `_launch` 启动战场前克隆实际 `f.spec`，在 `_fieldDone` 最终确定结果后记录结果、来源和 `resultDigest`；阵容包含装备、技能、模组、潜能、练度与敌人出场计划，完整输入还包含盟约、效果和联防携带状态。录制不消耗随机流、不进入回档快照；回到第 R 回合时丢弃 ≥ R 的记录，再录新时间线。控制台操作仅保存摘要，不重新执行操作。写入失败只记错误日志，原对局照常结束。

终局结果和回放分别保存，结果列表不读取完整回放。回放使用 gzip 原子写入，自动只删除超过最近 50 局的回放，保留对局结果。四人完整测试局录到 58 个战场，gzip 为 52,362 字节（约 51.1 KiB）；实际大小随阵容和操作数量变化。

「对局记录 → 查看 / 回放」按回合展示战场；普通战斗与联防用桩网络调用现有浏览器 runner，支持暂停、继续、重新播放及 1/2/4/8 倍速，结束后比较摘要并显示「与记录一致」或差异。最终攻势与隐秘核心（通常为第 14、15 回合）也可确认后尝试播放，旧回放直接适用；录制未保存实时共享血池和全队生命同步，因此只模拟当前战场，最长播放至记录时长，始终提示无法保证原样重放。控制台合成判定、未完成战斗仍仅查看。旧服务器串流模式没有 BattleSpec，不能播放；旧记录没有回放时给出明确提示。

回放加载器显式接受原版内容清单（`vanilla: true`），仍核对内容指纹和每份数据的字节；玩法插件清单沿用原有校验与脚本授权限制。生产录制的 `BattleSpec.cs` 在原版对局中也有值，不能据此将原版误判为玩法插件。浏览器回归使用八人对局与真实原版指纹，覆盖播放、暂停、重播及版本差异提示。

启动时指纹覆盖模拟器、共享代码、runner、11 个模拟数据表和浏览器数据 shim 的内容，并记录应用、扩展和 Spec 版本。版本不同仍可查看记录；普通战斗、联防、最终攻势和隐秘核心须确认「仍然尝试」，结果明确标注版本差异，不能据此保证原样重放。

`GET /api/replay?id=` 返回解压后的记录和兼容性；`GET /api/storage` 返回数量，`POST /api/storage` 须携带 `confirm: true`，支持单局 `id` 或批量 `categories`（`results`、`replays`、`adminLogs`）。API 沿用 localhost Host 与 `X-Admin-Token` 校验；回放页和依赖静态资源要求访问控制台建立的 HttpOnly、SameSite=Strict cookie，只挂载白名单目录和模拟文件。

「对局记录 → 删除」确认后删除该局结果与关联回放；「设置 → 数据清理」只处理用户选中的对局结果、回放、控制台操作日志。日志清理覆盖房间日志、活动录制与已保存回放中的操作摘要，不改战斗输入或指纹。设置、素材、缓存、更新包和其他运行日志不在清理范围。清理结果同时清除内存中的最近对局；活动对局仍会在结束时生成新记录，之后的操作会产生新日志。删除无法撤销，界面必须先确认，失败保留错误与重试入口。

## 6. 测试

- 全量：当前推荐 `node --test --test-concurrency=4`，约 8 分钟。一次只开一份，否则性能用例会超时。每次发布的测试数量和结果记在 [LOCAL-CHANGELOG.md](LOCAL-CHANGELOG.md) 对应版本的「验证」一条。
- 单个文件：`node --test test/match/rewind.test.js`。
- 对局测试用 `test/match/harness.js` 的 `makeMatch()`：虚拟时钟（`VirtualScheduler`），完全确定。常用 `h.toPrep(r)`、`h.drive(pred)`（自动替真人确认、选策略、就绪）。注意 `h.runToEnd()` **不会**替真人操作，有真人座位时要用 `h.drive(() => h.ended != null)`。
- `node tools/matchrun.mjs --check` 可以跑整局并检查不变量。

### 已知的失败

下表记录旧环境的失败。2026-10-10 改用 Node 24.19 并限制测试并发为 4 后，全量 0 失败。第一次无并发上限的测试在冲突尚未全部标记解决时遇到了打包路径重复，以及性能阈值失败；解决索引冲突并限制并发后，两项在最终全量中均通过。控制台和联动自选的真实浏览器测试也通过；全部 296 个 golden 场景通过，除自选族外与上游的 golden 文件一致。完整日志见 `.cache/merge-v023/`。

| 测试 | 原因 |
|---|---|
| `test/assets.test.js` 的 manifest 检查 | 公开镜像缺约 31 个文件（几首 BGM、部分音效、几个敌人图标），`npm run setup` 重试多次也下不到。和代码无关。2026-10-09 的全量里没有失败 |
| `test/assets-env-proxy.test.js` 的 2 项 | 环境里设了 `HTTP(S)_PROXY` 时，Node 22.14 的 `fetch` 不走代理。干净的 HEAD 上一样失败，和代码无关 |
| `robustness.test.js` 的 boss 战场性能用例（偶尔还有 `realtime.test.js`） | 对 CPU 负载敏感。单独跑约 0.12 ms/tick（门槛 0.5 ms），全量测试里各文件并发跑时可能到 3.8 ms 而失败。它只测战斗模拟，不经过回档代码；合并后、加回档前那次全量是通过的，推测是新增的整局测试加重了并发负载，没有进一步验证 |

## 7. 踩过的坑

- **模板字符串 `DATA_SHIM_JS`**（0.2.0 起在 `server/http/static.js`）内容里有 `import { getSimData } from './sim/simdata.js';` 这一行。按文本定位插入 import 时容易插进字符串里（我就犯过一次，表现为 `startAdmin is not defined`）。真正的 import 区在文件顶部。
- **`structuredClone` 克隆不了函数**：`audit.js` 会把 `PlayerState` 的方法包装后挂到实例上，所以快照要跳过函数属性。
- **端口被占用**：先确认进程用途，预览 / 测试选择空闲端口，不自动关闭已有服务。`scripts/stop-server.bat` 用于明确要停止自己开服进程的情况。
- **合并上游时**先看第 2 节「改动过的上游文件」：冲突只会出在那几处。合并后跑 `node --test test/match/rewind.test.js test/admin.test.js`；如果上游改了生成波次或休整期计时的写法，要把 `waveSource(this)`、`prepSeconds(...)` 接到新位置。
- **setup 下载很慢或大量 err**：旧版 Node 的 `fetch()` 不读取 `HTTP(S)_PROXY`。按下载器提示使用支持环境代理的 Node 版本和 `NODE_USE_ENV_PROXY=1`，或执行 `node tools/setup.mjs --asset-source=mirror` 使用第三方镜像。下载可续传，中断后重跑会跳过已有文件；不要把个人代理凭据写进公共文档。
- **合并上游后**要重新 `npm run setup`，上游会新增素材清单，否则素材测试会多出一批失败。setup 和 `npm install` 会改写 `data/assets.json`、`package-lock.json`，合并时用上游的版本（`git checkout -- data/assets.json package-lock.json`）。

## 8. 联动干员进自选池

上游以版权为由把联动 6★ 排除在自选池外（`tools/build-data.mjs` 的 `DIY_EXCLUDED_TEAMS` 按阵营、`DIY_EXCLUDED_NUMBER_PREFIXES` 按编号前缀）。本分支的决定（2026-10-09）是把联动干员放进来：charId 列在同一文件里的 `DIY_COLLAB_ALLOWED`，再按下面的步骤重新生成。7 名全部加入：0.2.2 的自选池 71 → 78，当前 0.2.3 为 72 → 79。

### 已加入

7 名的 kit 都取自 BBleae 的 fork（`BBleae/Stronghold-Protocol`，提交 `64866e81`，2026-10-08，GPL-3.0，和上游同许可证）。那边按上游 kit 规范写，带每名一个 `test/content/op_<代号>.test.js`，设计说明在它的 `docs/design/fork.md` §F6（每名做了什么、哪些是 [ASSUMED]）。本地 fetch 在 `refs/bbleae/*`。

| 干员 | kit | 盟约 |
|---|---|---|
| 灰烬 `char_456_ash`（RS01） | `op-ash.js` | 协防 |
| 麒麟R夜刀 `char_1029_yato2`（MH02） | `op-yato2.js` | 协防 |
| 焰狐龙梓兰 `char_1048_orchd2`（MH05） | `op-orchd2.js` | 协防 |
| 艾拉 `char_4123_ela`（RS05） | `op-ela.js`，召唤物雷鸣地雷 `token_10033_ela_grzmot`（手牌 4） | 协防 |
| 玛露西尔 `char_4141_marcil`（DD02） | `op-marcil.js` | 协防 |
| 丰川祥子 `char_4182_oblvns`（AM01） | `op-oblvns.js` | 协防 |
| 结城理 `char_4217_makoto`（PS33） | `op-makoto.js` | 拉特兰（隐藏势力） |

那个 fork 基于 0.2.1，搬过来时改了这些：
- `Math.hypot` / `sin` / `cos` 换成 `server/sim/detmath.js` 的版本（0.2.2 起 sim 里禁用，`test/sim/detmath.test.js` 会扫）：灰烬、丰川祥子。
- 玛露西尔用到 fork 独有的 `server/sim/content/fxtiles.js` 的 `keyTiles`（只是 fx 的格子列表），内联进了 `op-marcil.js`。
- 丰川祥子的 LOR-Y：0.2.2 的 `traitMods.js` 会给所有「攻击范围内存在N名及以上敌人时攻击速度+X」自动加攻速，她的 kit 自己也加（只算技能未开启时的范围），会算两次。在 `traitMods.js` 里按 charId 排除了她（`KIT_OWNED_CHARS`）。
- 焰狐龙梓兰换成了 fork 的版本（他们修过 S1/S2/S3 的时序和箭的偏移），替掉了原先取回的上游 feedback5 版本；原来本地加的 fx `dragonArrow` 不再用到，删了。
- 联动干员大多只有联动配音（`LINKAGE`），镜像上没有 `voice_cn/`，中文语音树改用 `voice/` 下的同名文件（`tools/assets/plan.mjs`）。所以这 5 名的中文、日文语音是同一套。
- fork 的 `TOKEN_SKIN_SPINES`（艾拉地雷的皮肤模型）上游没有，没搬：雷鸣地雷没有 Spine，只有头像。

`test/ui/diy-collab.e2e.test.js`（fork 的浏览器测试：选人、商店、部署、战斗里结城理的人格模型）也搬了。通过 `CHROME_PATH` 指定可运行的 Chrome/Chromium 后设置 `SP_E2E=1` 执行该文件；本机当前可用的缓存 Chrome 路径见 HANDOFF §3。

fork 文档里列的未完成项（§F6.4）：Fever 槽、她的粉色技力条和 KiLLKiSS BGM 切换没画，音符的飞行没画；龙之箭没有自己的飞行图形；艾拉地雷没有模型。

### 加一名（或合并上游后）重新生成

1. **游戏数据**：`.cache/gamedata` 要和上游构建 `data/` 时用的 ArknightsGameData 版本一致，否则别的干员的数字也会变。0.2.3 / 0.2.4 / 0.2.5 用的是 `17759cc8cdf37388414145d16262a3a06f3ab25e`（2026-10-08，Client 2.7.81；见上游 `docs/history/0.2.3.md`）；0.2.2 曾用 `a550f5e`（Client 2.7.71）。先备份旧缓存、把指定版本下载到独立缓存，再用上游原版构建脚本生成到临时目录，与上游发布的 `data/` 逐项比较；确认一致才替换缓存并运行本地构建脚本。不要用本地已经放行联动的脚本验证上游数据。
2. `node tools/build-data.mjs --offline`：改写 `data/backups.json`。
3. `node tools/fetch-assets.mjs --add-only`：下载新干员的美术和语音，并改写 `data/assets.json`。网络不稳时可以重跑，会续传。
4. 数据翻译：`node tools/build-i18n.mjs`（en），以及 `--lang ja` / `ko` / `zh-TW`。下载失败就用 curl 把表预先放进 `.cache/gamedata-<lang>/`（`excel/` 下 8 张表，加上 `levels/enemydata/enemy_database.json`），再加 `--offline`。和旧文件做 JSON 比较：差异应该只有新干员、`_h` 和 `meta` 的覆盖率。2026-10-09 的 zh-TW 还顺带补上了怒潮凛冬的译名（源数据比上游构建时更新）。
5. kit 文件加进 `kits/index.js` 的 `OPERATOR_KIT_FILES` 末尾；跑 `npm run golden:update`，应该只有 `test/golden/diy.json` 变。
6. 改测试里写死的数量（第 2 节的表），然后跑 `node --test test/backups.test.js test/diy.test.js test/assets-diy.test.js test/full-potential.test.js test/potential.test.js "test/i18n*.test.js" test/data.test.js test/golden.test.js test/content/op_<代号>.test.js`。

### 合并上游时

`data/backups.json`、`assets.json`、`i18n/*.json`、`test/golden/diy.json` 都是生成的：冲突时先取上游版本，再按上面的 1–5 步重新生成。第 7 节说的「`data/assets.json` 用上游的版本」在这里不适用：直接用上游版本会丢掉联动干员的素材条目，要再跑一次第 3 步。

EN / JA / KO 客户端里没有焰狐龙梓兰和结城理，zh-TW 里还没有麒麟R夜刀，这些在对应界面显示中文。0.2.3 新增的克莱门莎尚未有英文文本；当前英文总覆盖率 96.9%、技能 95.1%、天赋 94%，测试按该实测下限校验，其余分类门槛保持不变。

## 9. 九项主机扩展（2026-10-15，v0.2.6-extended.4）

需求及验收映射见 [NEXT-FEATURES.md](NEXT-FEATURES.md)。不改变官方玩法、生成数据或 golden。

### 聊天、监控与资源

#### 聊天消息预览与爱心标点

2026-10-17：收起聊天时预览新收到的队友/主机消息，跟随可拖动入口并限制在屏内；最多两条、正文各三行，
更多显示数量。最新消息到达后停留 6 秒并淡出，悬停和键盘聚焦暂停，点击展开并清除未读。
淡出不清未读；自己发送、历史同步、展开时收到的消息不重复弹出，清空记录同步清理预览。
用户端设置「显示消息提示气泡」(`chatBubbles`) 默认开启，沿用本机 `sp.pref.settings` 保存；关闭立即清理
预览但保留未读数，重新开启仅提示之后的新消息，旧版本配置默认开启。
气泡以 220 ms 淡入并上移 6 px，消失以 180 ms 淡出并上移 4 px；系统减少动态效果时关闭动画和过渡。
新增标点种类涉及服务端校验，源码更新后须重启服务并刷新玩家页面，避免旧进程拒绝新的 `kind`。
底部第六个标点为粉色爱心，沿用坐标、广播、500 ms 冷却与 2.5 秒显示期限，提示音遵循音效/静音设置。

验证：`node --test test/ui/chat.test.js test/ping.test.js test/ui/audio.test.js`；配置 `SP_E2E=1` 和
`CHROME_PATH` 后运行 `node --test test/ui/chat-preview.e2e.test.js test/ui/chat.e2e.test.js test/ui/pings.e2e.test.js`。
截图在忽略目录 `test/e2e/out/chat-preview-*.png`；设置 `PING_QA_SCREENSHOTS=1` 可输出 `.cache/ping-qa/heart-*.png`。

#### 聊天管理、监控与资源实现

聊天管理复用 `server/chat.js` 与普通离开规则，只允许本机控制台调用；v0.2.6-extended.5 起旧聊天公告改为独立全站公告，正文、级别和绝对起止时间由主机编辑，不进入聊天历史。清空广播带 `clearedThrough` 的空历史；单调消息 ID 不重用，客户端丢弃迟到的废弃消息。禁言绑定房间 playerId，重连不解除；玩家发送返回 `CHAT_MUTED`。轮询复用聊天节点，输入草稿与展开状态不丢失。

`admin-wall.js` 输出全房席位摘要和对局标识，`monitor.html` 每页四席，桌面 2×2、手机单列。每席内嵌 `/live?wall=1` 的完整游戏界面，包含棋盘、商店、盟约、HUD 与非权威战斗副本；固定 1280×720 桌面视口，按容器宽高的较小比例缩放并居中，可全屏或单独观察。切页替换 iframe 时立即计算缩放，加载后再次校准，尺寸监听处理窗口与全屏变化；不依赖外层容器必须改变大小，避免新画面未经缩放而裁切。墙内禁止代操作，不创建玩家 WebSocket 或上报战斗结果。仅已鉴权墙模式允许同源 iframe，普通实时页保持禁止嵌入。摘要每秒轮询、5 秒超时，同一对局 / 玩家不重建画面，切页、结束或关闭移除旧 iframe，退出停止轮询与尺寸监听。局内聊天入口默认避开右侧效果及准备按钮，可拖动并按本机站点和昵称保存；展开面板跟随入口并自动限制在屏内。

2026-10-22 扩容实验分支：同盟新建从创建方式页进入统一难度选择页，确认后才调用 `room.create`；返回时恢复同盟方式页与输入的自定义密钥。独立模拟维持原入口，加入 / 搜寻与难度互不干扰。新建同盟的房间属性默认 `aiPicksLast=true`，房主可像以前一样关闭，开局和轮选机制保持原实现。恢复快照显式保留记录值；旧快照缺少该字段时仍按原默认 false。

`resources.js` 仅由控制台创建，每秒采样，最多 600 条，不落盘；复用 WebSocket 30 秒心跳的 ping/pong 测 RTT，断连清理。CPU 为进程 CPU 时间相对墙钟时间的近似占比，以单核 100% 计；WebSocket 统计按总量与房间，素材 / 音频统计使用现有 HTTP 流量计数。

### 漏怪、经济、盟约与跨局汇总

`match/leak-history.js` 分普通 / 联防来源及召唤 / 未知敌人汇总数量、计扣血数量和漏怪扣血；领袖战保存全队损失，个人扣血留空并说明技能扣血口径。`history.js` 保存实际经济增减及来源、期初 / 期末金币、购买 / 出售 / 刷新次数，以及盟约 id / 名称 / 激活 / 层数 / 档位。收入取实际入账值，支出取实际扣款；手动金币调整也记录。曲线一次一个指标，盟约层数先选盟约，座位颜色固定并提供表格。回档复用 MATCH_KEYS 自动截断；旧字段留空，不推算。

`result-summary.js` 只读结果目录，以 mtime / ctime / size 缓存解析；损坏或关键字段缺失的文件跳过并计数。干员和激活盟约按每局去重，伤害记录累计值和单局最高；时间 / 模式 / 难度筛选不改原记录。千份文件回归见 `test/result-summary.test.js`。

### 重启恢复（用户已确认）

`recovery.js` 复用进入 PREP 时、自动效果触发前的 rewind 快照，每次写 `logs/recovery/room-<房间>.bin.tmp` 后原子改名（文件创建权限 0600）。房间码接受四位大写字母或数字，前缀避免 Windows 设备名称冲突；兼容旧 `<房间>.bin` 命名，同房间优先读取新命名，下次保存迁移并清理旧文件，删除或关闭恢复同时清理两种名称。Node v8 序列化保留 Map / Set / 共享引用；非枚举敌人日程单独保存。恢复文件绑定扩展版本、模拟器、数据和对局规则指纹，不兼容文件隔离保留并在控制台报告，可确认删除；兼容旧命名不代表兼容旧版本指纹。每个文件独立处理，校验结构、身份和 128 MiB 大小限制。

正常启动默认开启，程序化 `startServer` 需传 `recovery` 选项。先加载主机规则再恢复 Room / Match / Session；真人掉线、AI 在线，原 token 可重连，独立模拟保留 24 小时窗口。恢复到最近休整期开始，保留该回合机变、DIY / 调配 / 潜能及托管 / 离开标记；重打本回合，截断作废回放与历史，不重复发放入场收益。停机和废弃回合不计入用时。尚无 PREP 快照的开局不能恢复；等待室、聊天和实时操作日志不恢复。正常关服先标记保留，结局或房间关闭删文件。

默认启用；`logs/recovery-settings.json` 保存开关。关闭时删除旧快照，重新开启时保存活动局最新 PREP；已隔离的问题文件可单独确认删除。不要把恢复文件当作可跨版本导入的存档，它含原重连 token，应按本机身份数据保管。

### 空闲更新与更新记录

`idle-update.js` 默认关闭，`logs/auto-update.json` 持久化开关。开启后首次立即检查，其后间隔至少一小时；只接受已签名可安装的正式新版，复用签名安装器，不自动回退、不强制结束对局。有活动局先等，无活动局向全部房间公告后等 60 秒；新局取消倒计时。失败标签停止自动重试，直到重新开关 / 重启或有新版；外部守护不支持自动重启时报告原因。关闭后忽略未完成检查的迟到结果。`POST /api/update` 新增 `{action:'automatic',enabled}`。

`release-notes.js` 从 LOCAL-CHANGELOG 当前发布节提取玩家条目，排除验证记录；游戏端仅公开只读 `/release-notes.json`，不带管理数据。游戏与控制台共用 `public/js/ui/releaseNotes.js`：首次访问建立版本基线，版本变化弹出，关闭记住版本，支持 Esc 和横屏滚动，非中文界面说明条目为中文。未发布记录不冒充新版，正式发版时再同步 RELEASE_TAG。

### 局内每回合曲线

维护者要求（2026-10-16）：所有玩家与观战者在局内交流图标后打开非模态「每回合统计」，内含曲线与每回合干员伤害排行。
`public/js/ui/roundChart.js` 为游戏与控制台共用 SVG/表格/排行绘制器；指标包括 LP、金币、花费、伤害、
商店等级、回合收支和可叠层盟约。盟约使用官方数据 `noStack` 过滤，旧记录通过数据查询补判；
新记录携带该标记以支持插件盟约。控制台的不可叠层盟约仍展示人数/档位，隐藏层数与加层/设层输入。
曲线与排行都复用筛选控件；实时刷新只重绘内容，选择指标时保留原生下拉框及选项节点。

2026-10-22 扩容实验分支：`public/js/ui/roundChartTip.js` 负责回合详情的悬停预览与点击固定。
预览最多四名玩家，固定后可滚动完整列表，列表滚动不影响标题；浮层采用固定定位，不参与图表容器滚动范围。
统计正文使用稳定滚动条占位，避免详情出现 → 图表变窄 → 鼠标离开 → 详情消失的反馈闪烁。
实时刷新保留所选回合、滚动位置与关闭入口焦点；Esc 先关详情，随后才关统计面板。触屏点按直接固定，
局内 / 结算 / 控制台共享逻辑。回归入口：`SP_E2E=1 node --test test/ui/round-details.e2e.test.js`。
新增盟约等选项变化延后到失焦时同步，避免刷新收起选择栏。局内与控制台共用此行为。

`logs/admin-settings.json` 的 `roundCharts` 默认 `true`（旧配置缺省同样开启），
`GET/POST /api/settings` 读取/保存，独立保存其他设置时保留当前值；保存后立即刷新各活动局公开状态。
`m.public.roundHistory` 仅发送统计字段，新增 `players[].units` 的 `defId/name/dmg/kills` 用于排行，
关闭时为 `[]`；底层历史继续记录，重新开启即可查看。排行支持按回合、玩家筛选，前 10/全部；
仅计算各自战场的干员伤害，沿用控制台口径，联防伤害只计入累计数据，不拆分到干员。
排行扩展验收：`.cache-round-rank-final.log` 定向 68 项通过；`.cache-round-rank-browser.log`
局内与控制台统计两项浏览器回归通过，`.cache-round-rank-browser-final.log` 最终显示统计口径后
复核通过，覆盖回合/玩家筛选、前 10/全部、切换保留、三种视口与开关。四语言各 2316 条完整，
类型检查与变更文件 lint 通过；独立收尾审查为 ship。无模拟或 golden 规则改动。
玩法插件房间由 `host/proxy.js` 携带配置，通过独立进程/worker 的 `syncExtensions` 同步并刷新公开状态。
第一回合结算前显示空态；淘汰后曲线止于淘汰回合；旧记录缺失收支显示「—」；回档后废弃记录消失。
不改变模拟、结算、golden 或官方盟约规则。

专项验证：`node --test test/match/round-history.test.js test/admin.test.js`；浏览器设 `SP_E2E=1` 和
`CHROME_PATH` 后运行 `node --test test/ui/round-history.e2e.test.js test/ui/admin-stats.e2e.test.js`。

2026-10-16 验证：最终定向 65 项全部通过（`.cache-round-charts-final.log`）；共享图表键盘/开关/
响应式浏览器用例最终通过（`.cache-round-charts-keyboard-final.log`），控制台设置回归 3 项通过
（`.cache-round-charts-browser-verified.log`）、原有统计浏览器回归通过。golden 六组 299 场景一致
（`.cache-round-charts-golden.log`）；四语言各 2302 条严格检查 0 缺失/错误，lint 0 错误，类型检查、
setup/smoke 通过。收尾独立审查确认重绘后恢复键盘焦点；既有设计系统保持。
完整 CI 首轮发现轴标题漏翻译，已修复并由最终定向覆盖；该批另有素材代理测试的 Node 版本假设、
大厅席位 `card/cardSkin` 旧断言及超时失败，不能作为全量通过（`.cache-round-charts-ci.log`）。
首轮结果为 8019 项、7947 通过、30 失败、1 取消、41 跳过；还包括插件试运行超时、性能阈值、
Windows 文件锁、既有资源缓存/标题链接断言。观战隐私断言已更新为允许主机启用后公开的已结算
金币，仍禁止当前私有字段，真实 WebSocket 回归 5 项通过（`.cache-round-charts-socket.log`）。
发布预检仅枚举 Git 已跟踪文件，因此未提交的新模块在首轮包测试中被报为缺失；
不改真实 Git 索引，使用预检 `paths` 纳入两份新增模块的结果见 `.cache-round-charts-package.log`。

### 验证入口

- 服务端：`test/admin-chat.test.js`、`resources-wall.test.js`、`match/history-details.test.js`、`result-summary.test.js`、`recovery.test.js`、`idle-update.test.js`、`release-notes.test.js`（除已写目录者外均在 test 根目录）。
- 浏览器：`SP_E2E=1 node --test test/ui/admin-chat.e2e.test.js test/ui/admin-stats.e2e.test.js test/ui/next-features.e2e.test.js`；设 `CHROME_PATH`。监控墙真实 30 分钟验收另设 `SP_WALL_SOAK=1`，日常回归无需等待半小时。
- 最终汇总见 [LOCAL-CHANGELOG.md](LOCAL-CHANGELOG.md) 的 `v0.2.6-extended.5` 节；只在明确授权后提交。

## 参考站工具界面适配（2026-10-17，随 v0.3.0-extended.3 发布）

设置点「修改快捷键」打开独立子弹窗；编辑时 Esc 取消，再按关闭子弹窗，设置继续打开。
资源管理显示分包下载（字节 / 速度）、校验（状态）、导入（文件数），不改变下载与缓存配置。
控制台「服务器 → 全站公告」可选择纯文本（500 字）或 Markdown（20000 字）；长文仅在公告弹窗排版，
横幅提示点击查看详情。支持标题、列表、引用、表格、代码、安全链接；HTML 原样显示、图片显示替代文字。
`/api/action` 的 JSON 上限为 256 KiB，覆盖长文及其 JSON 转义，其他接口保留原上限。
源码来源、私有归档范围与验证入口见 [REFERENCE-UI-REVIEW.md](REFERENCE-UI-REVIEW.md)。

### 公告草稿、模板与正文预览

控制台「服务器 → 全站公告」可命名保存、载入、覆盖保存、另存和删除公告草稿，最多 30 份。草稿保存
在控制台设置文件同目录的 `announcement-drafts.json`（默认 `logs/announcement-drafts.json`），重启后保留，
不进入游戏内容或对局记录清理。仅本机已鉴权控制台可调用 `GET /api/announcement-drafts` 和
`POST /api/announcement-drafts {action:'save',draft}` / `{action:'delete',id}`。写入采用临时文件加重命名，
校验或写入失败保留旧数据。草稿名 1–80 字，正文沿用纯文本 500 字 / Markdown 20000 字上限，可留空待补。

内置「维护通知、版本更新、房间规则说明、临时故障通知」四种 Markdown 模板，包含明确待填内容，使用
模板只填入编辑器。草稿保存正文、格式、级别、开始延迟和持续时长，载入后在点击发布时重新计算绝对时间。
替换未保存内容前确认，离开页面时提示未保存修改；保存失败可保留编辑内容重试。

正文实时预览复用玩家端 `announcementMarkdown.js`，支持标题、列表、表格、代码、引用和安全链接；
原始 HTML 显示为文字，图片不加载，危险 URL 不生成链接。桌面左右编辑 / 预览，窄屏上下排列。
保存、载入、删除、预览和套用模板均不发布，也不撤下当前公告；仍需点击「发布全站公告」。
验证：`test/announcement-drafts.test.js`、`test/ui/announcement-markdown.test.js` 和
`SP_E2E=1 node --test test/ui/announcement-drafts.e2e.test.js`。

### 在线玩家、在线状态与直接邀请

首页右上角「名博士在线」后增加展开符号，可查看当前服务器可见在线玩家、搜索姓名并分页（100 人/页）。
同一区域可切换在线、暂离、忙碌、隐身，选择保存在本浏览器；握手时先应用，避免刷新短暂暴露。隐身不计入
可见人数、不返回名单，也不能发送或接收邀请；关闭隐身选择不会强制公开已有隐身玩家。房间中的真实成员仍
按原有玩法可见，隐身不隐藏对局席位。名单不返回地址、令牌或其他人的房间码。

等待室「邀请玩家」打开名单，可向当前未在房间、非忙碌的可见玩家发送邀请；对方确认加入后复用原有入房校验。
邀请 60 秒失效、发送者每 10 秒最多一次、接收者最多 5 份待处理邀请。房满、开局、离线、离房、隐身或关闭
邀请功能会使邀请失效；不会强制移出对方当前房间。测试房间不提供这条邀请入口。

控制台「设置 → 交流管理 → 在线玩家与邀请」包含六个布尔选项：`directory` 名单、`invitations` 邀请、
`statusSelection` 状态选择、`invisible` 隐身选择、`counts` 可见人数、`hostOnly` 仅房主邀请。前五项默认
开启，最后默认关闭；保存到 `logs/admin-settings.json` 的 `social`，省略项保留，校验和写盘成功后立即广播。
关闭邀请会清空待处理邀请。关闭状态选择仍允许主动恢复在线，且不会改变已有隐身状态。

回归入口：`test/social.test.js`、`test/admin.test.js`、`SP_E2E=1 node --test test/ui/social.e2e.test.js`。

### 重启后保留有效公告（默认开启）

控制台「服务器 → 全站公告」新增「重启后保留有效公告」与「保存保留设置」。无配置时默认开启；
曾明确关闭的配置保持关闭。开启会立即保存当前尚未过期的公告，之后每次发布或撤下都同步保存。
重启时沿用原 ID、正文格式、级别和绝对起止时间，不重新计算时长；已经过期的不恢复，尚未开始的
仍按原时间开始，「直到撤下」继续保留。关闭仅清除下次恢复内容，当前公告继续按原时限显示。

设置与已发布正文保存在 `logs/announcement-state.json`（自定义控制台设置文件时位于同目录），独立于
草稿与 admin-settings.json；不进入发布包或对局结果清理。写入使用临时文件加重命名，失败则不修改
内存公告、开关和已保存文件；撤下保存失败也保留原公告并返回错误，避免重启后意外恢复。
已过期的磁盘内容可保留至下次保存，但恢复时始终按绝对 endAt 过滤。

`GET /api/announcement-persistence` 返回 `{enabled}`；`POST /api/announcement-persistence {enabled:boolean}`
保存设置，复用控制台 token 和 localhost 鉴权。读取损坏文件时拒绝覆盖并提示修复后重试。配置仅在
启用控制台的正常服务启动时加载；单独构造 SiteAnnouncements 的测试调用不自动读写磁盘。

验证：`test/announcement-persistence.test.js` 覆盖默认开启、关闭保留、当前/定时/长期/过期公告、撤下、
写入失败、原 ID 与期限、真实服务器重启、鉴权与清理保护；
`SP_E2E=1 node --test test/ui/announcement-persistence.e2e.test.js` 验证保存、刷新恢复、失败重试和手机布局。

## Windows 服主 EXE 启动器（v0.3.1-extended.9）

`launcher/` 提供继承现有 UI 色板的 WPF Windows x64 启动器；构建和使用见
[启动器说明](../launcher/README.md)。单文件随带 .NET 运行时，游戏仍需要 Node.js 22+ 和同版项目文件。
默认中文；原生界面文案经 `t()` 读取 `public/i18n/`，由 `launcher/i18n-msgids.mjs` 注册校验。

`scripts/host-launcher.mjs` 仅包装 `launch.mjs`、doctor/setup 检查与实例控制，不重写模拟器或服务器：
检查实际素材清单；通过 `runningInstance` 核验当前安装；状态只输出管理地址、能力和公开连接地址，
不输出 token。局域网地址复用网卡分类，只有本次启动的双栈服务才发布该列表，本机模式不列局域网地址。
重启复用控制台 `/api/service`，停服复用 `free-port.mjs`；不强杀未知端口占用者。
桌面启动前同时检查游戏与管理端口；`SP_REQUIRE_ADMIN=1` 仅由桌面启动路径设置。
若控制台因端口竞争等原因启动失败，boot 正常关闭本次自建服务并以 75 退出，
防止留下无法鉴权管理的后台游戏服务；普通脚本未设置该标志时保持原有行为。

关闭窗口保留后台服务，再打开从当前安装凭据恢复管理；窗口内停止 / 重启前显示断线影响。
独立日志保存到 `logs/host-launcher-<port>.log`，写入前移除 ANSI 和工作台 key/token URL 参数；
诊断可能含目录及网络地址，分享前仍须自行核对。每用户仅保存目录、端口、网络方式，不存管理凭据。
生成物不入 Git；`tools/package.mjs` 已允许桌面助手源码，EXE 构建后另附同版游戏包。

验证覆盖：`test/host-launcher.test.js`、现有 host-runtime / host-lifecycle / package 测试；
WPF `--render-preview` 生成默认、在线演示、紧凑和端口占用演示截图，演示不启动服务。
本轮构建哈希、专项结果及全量 CI 未通过项保存在 [启动器验收记录](HOST-LAUNCHER-VALIDATION.md)，
不再只依赖忽略目录中的临时日志；它与后续文档复检结果分开记录。

### 四版本默认开放与启动参数（2026-10-25）

未配置启用列表时开放四个注册玩法版本，默认选中第二期下半。既有大厅选择、房间一致投票和历史版独立宿主直接沿用；本地七名联动仍只属于默认版。`scripts/launch.mjs` 与 `scripts/host-launcher.mjs` 新增 `--versions all|id,id` 和 `--version-default id`，可显式限制单版或选择默认版。参数只影响新启动的进程，图形启动器从服务端继承四版默认。历史版仍展示已有预览与规则推算提示；默认开放不表示完成长时压力或正式发布验收。本次实现后按用户要求不再运行测试。

### 上游与扩展更新说明（2026-10-25）

设置新增「显示上游更新内容」与「显示扩展更新内容」，分别保存在 `sp.pref.settings.upstreamReleaseNotes` 和 `extensionReleaseNotes`，两项默认开启，已保存的 `false` 保留。上游版本来自 `APP_VERSION`，条目读取安装内 `CHANGELOG.md` 的同版本章节；扩展版本继续使用 `RELEASE_TAG` 与 `docs/LOCAL-CHANGELOG.md`。不联网查询、不下载或安装更新。

游戏启动分别读取两份说明；任一启用来源发生版本变化时弹出更新记录，两来源开启且有内容时桌面并排、窄屏纵向显示。关闭后只记录已展示来源的版本，禁用来源不被另一栏的确认覆盖；旧扩展已读标记迁移出独立上游基线。首次安装沿用既有行为，只建立版本基线，不自动弹出。

`/release-notes.json` 与新增 `/upstream-release-notes.json` 均为只读内容。上游静态快照 `public/upstream-release-notes.json` 供尚未正常重启的旧实例与静态部署回退使用；新服务按本地 CHANGELOG 动态读取，后续上游整合应同步快照。设置文案补齐英、日、韩、繁中。按用户先前要求未运行测试或浏览器验收，未重启正在进行对局的实例。

### 局内头像席位底色修复（2026-10-25）

`PlayerAvatar` 已使用二十席统一的 `--seat-color`，合并后的 `.pavatar` 和文字占位仍读取旧 `--seat-hue`，导致底色声明无效。恢复原扩展按 `--seat-color` 混色的渐变、边框和占位文字，并保留深色背景回退。没有修改头像图片、策略图标或对局状态；按用户要求未运行测试。

### 进行中回合缺少真人干员伤害（2026-10-25）

用户在第一期上半、1 真人 + 3 AI 同盟反馈：每回合统计的进行中回合缺少自己干员，结算后正常。源码核对：`InPageSimHost.progress()` 已带有 `battleDamage` 有界计数，协议与 `MatchReports._onProgress` 也接收 `damage`，但合并后的浏览器 runner 组装 `b.progress` 时漏转发该字段；服务端人机走独立采样，因此不受相同遗漏影响。恢复 `if (Array.isArray(p.damage)) msg.damage = p.damage`，沿用既有采样频率、上限、权限与结算逻辑；默认及历史版本共用该 runner。没有修改模拟规则或数据，按用户要求不运行测试；当前页面需在合适时机刷新才能加载新模块。

### 皮肤随机范围、每局自动随机与锁定（2026-10-25）

卡片／列表页共用「随机设置」：全部、已装扮、未装扮三种范围；默认全部，按素材清单中实际可用的皮肤判断。`randomSkins` 在原配置上合并结果，只修改范围内未锁定且有可用模型皮肤的干员，其他版本或暂不可用记录不被整表覆盖清空。皮肤栏可锁定当前外观（含默认），随机与批量恢复默认均跳过；手动修改仍可进行。

每局自动随机默认关闭，使用同一范围和锁定表，在开局阶段数据可用后只抽一次。身份由 `m.public.matchId = roomCode:battlePrefix` 提供，持久化处理标记以防刷新、重连、回档重抽；兼容未重启的旧服务器时使用本地活跃局标记。当前战斗中开启只影响下一局，观战不触发。配置按 charId 跨版本共用，结果复用既有 room.skins 协议。

已补英、日、韩、繁中；实现后遵照用户要求未跑测试、未重启正在运行的实例。

### 分项调配导出与上游格式（2026-10-25）

导出干员调配新增七项勾选：技能、模组、潜能、练度、皮肤、随机设置、皮肤锁定。默认选择上游兼容格式并勾选四项玩法设置；实时更新 JSON 预览，复制和下载使用同一份内容。上游模式保留 `kind: stronghold.loadout`、`v: 2`、`exportedAt`、`count`、`byChar`、可选 `ops` 的原生结构，不加皮肤和扩展元数据，不提升格式版本。只导出技能／模组时省略 ops，以免上游误覆盖潜能和练度。选中内容没有非默认条目时禁止导出，避免上游以“没有有效调配”拒绝空文件。

本库格式继续使用 v2，在独立 `extension: { v: 1, sections, skinRandom?, skinLocks? }` 中描述选中部分；`skins` 保留已有位置。导回本库时只替换勾选字段，未包含的字段、随机开关、皮肤和锁定表不变。明确选中的空节代表恢复该节默认值，不再把“未导出”误认为清空。旧 v1/v2 文件仍走原有导入流程，干员持有与自选编队独立文件维持原样。

兼容依据是本次固定上游 `f07b8965061bbc311ad7aa815879b09264a1e47d`（v0.3.3）的导出、解析和应用代码。上游仍按自身覆盖规则导入；缺少相同干员／选项或更早不支持 v2 的目标不作保证。纯皮肤／随机／锁定文件不能被上游导入，因此只在本库格式开放，界面明确提示。未执行上游运行时导入或任何测试，按用户先前要求不重启实例、不启动测试。

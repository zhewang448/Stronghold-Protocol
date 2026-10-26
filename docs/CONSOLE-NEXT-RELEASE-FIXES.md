# 主机控制台：下个版本修复清单

发布归档：C01–C11已合入main，随v0.3.3-extended.3发布；下文“未发布”“未提交”等是当轮历史状态。当前发布内容和最终验证见[发布记录](RELEASE-V0.3.3-EXTENDED.3.md)。

记录日期：2026-10-26（Asia/Shanghai）。排查基于当前工作区，发布背景为 `v0.3.3-extended.1`。
目标版本：下一个扩展版本，具体版本号待发布时确定。
状态：**C01–C11 已修复，未发布**（2026-10-27）。基础分支 codex/public-room-lobby，基点 d88781613df586569f8061ab6d1b75693f1e7f82；修复分支 codex/console-next-release-fixes。下文保留原始排查，末尾单列实现及实际验收。完整 CI 仍有基础分支已有失败。

## 范围与优先级

汇总本次两轮控制台审查，共 **9 项功能问题、2 处过时文案**。优先级为建议排期，不代表已发布承诺。

| 编号 | 优先级 | 问题 | 状态 |
|---|---|---|---|
| C01 | P2 | 对局游戏版本未显示，部分接口丢失版本字段 | 已修复 |
| C02 | P1 | 历史版本回放误走第二期下半的模拟数据 | 已修复 |
| C03 | P2 | `/resources` 往返延迟采样未接入真实心跳 | 已修复 |
| C04 | P1 | 历史版本实时查看／监控墙未加载对应版本数据 | 已修复 |
| C05 | P1 | 实时查看未同步房间便利规则 | 已修复 |
| C06 | P1 | 代操作白名单遗漏现有游戏指令 | 已修复 |
| C07 | P1 | 发放目录只按房间码缓存，同房间换版本后过期 | 已修复 |
| C08 | P2 | 跨局汇总未展示版本，也未提供版本筛选 | 已修复 |
| C09 | P2 | 历史版本／插件宿主的监控墙在线状态过期 | 已修复 |
| C10 | P3 | 伤害排行说明仍称联防伤害不分干员 | 已修复 |
| C11 | P3 | 回放设置说明仍称领袖战仅展示结果 | 已修复 |

P1：优先修复错误数据、规则与操作能力；P2：修复信息展示和监控；P3：同步说明文字。

## C01：对局游戏版本未显示

- **现象**：控制台房间、记录列表、记录详情及回放信息未完整显示“第一期上半”等游戏期次。程序版本与玩法版本的含义也需要明确区分。
- **已确认原因**：`resultRecord` 已保存 `version`；`matchView`、`roomsView`、`listRecords` 和上一局摘要未完整透传，页面没有对应展示。
- **位置**：[admin.js](../server/admin.js)、[admin.html](../server/admin.html)、[replay-viewer.js](../server/replay-viewer.js)、[版本注册表](../shared/versions.js)。
- **证据**：给 `roomsView` 输入 `version: act1autochess`，返回对象不含 `version`。
- **修复方向**：沿用版本注册表的名称，打通活动对局、上一局、历史记录与回放的版本字段和显示。无版本字段的旧记录沿用仓库既有约定：第二期下半；不要按控制台当前选择猜测。
- **验收**：四版均显示正确期次，另行保留程序版本；同房间切换版本后，上一局与历史记录仍显示各自原版本。

## C02：历史版本回放误用默认模拟数据

- **现象**：非第二期下半的回放可能无法正确播放或得到与录制时不同的结果。
- **已确认原因**：回放页使用 `loadContentSet(..., { allowVanilla: true })`，随后按 `contentIndex.vanilla` 设置 `vanillaCs`。其他官方期次的清单同样是 `vanilla: true`，因此被当作默认版，runner 走默认 `/data/`；构造的 `replayContent` 也未保留官方版本标记。
- **位置**：[replay-viewer.js](../server/replay-viewer.js)、[content.js](../public/js/content.js)、[runner.js](../public/js/battle/runner.js)、[simLoader.js](../public/js/battle/simLoader.js)。
- **证据**：四版清单加载探针确认：三个历史版本的清单和已下载 `config` 均带正确版本，但均命中默认模拟分支；专用 `loadVersionSet` 能保留版本。此证据定位了错误数据路径，不等于已完成四版逐场回放结果比对。
- **修复方向**：区分“官方原版内容”和“第二期下半”；复用版本加载及校验逻辑，向模拟器传递匹配的数据、版本标记与 bounds。
- **验收**：四版真实录制的普通战斗／联防分别按原版本播放并比对摘要；覆盖切换战场、重播及跨版本指纹不兼容提示。领袖战仍明确提示共享血池时间线缺失，尝试播放不得升级为精确回放。

## C03：往返延迟采样未接入心跳

- **现象**：`/resources` 有“往返延迟”列，但持续显示“等待心跳”。
- **已确认原因**：资源采样器提供 `monitor.ping/pong`，网络实际发送 ping 和接收 pong 时未调用。
- **位置**：[resources.js](../server/resources.js)、[net.js](../server/net.js)、[monitor.html](../server/monitor.html)。
- **证据**：真实 WebSocket 握手及协议 ping/pong 成功、连接保持存活、资源 monitor 已挂载，`/api/resources` 仍未返回玩家 `rtt`。直接调用采样器的对照探针返回 `73 ms`。
- **修复方向**：接通既有协议心跳与采样器；无需另开测速连接或额外游戏协议。处理关闭控制台、重连与首个样本等待状态。
- **验收**：真实连接经过心跳后 API 与页面出现非负 RTT；重连不串用旧 socket 样本；关闭控制台正常解除采样，未启用控制台时不增加采样工作。

## C04：历史版本实时查看未加载版本数据

- **现象**：单独观察及监控墙内嵌实时画面没有跟随历史对局的数据版本。
- **已确认原因**：实时页面重建 store 的 `room` 时没有写入 `version`。版本选择器优先读取房间，因此即使 `m.public.version` 和 `room.content.version` 正确，仍把页面认作默认第二期下半。
- **位置**：[live-viewer.js](../server/live-viewer.js)、[admin-live.js](../server/admin-live.js)、[versions.js](../public/js/versions.js)、[content.js](../public/js/content.js)。
- **证据**：真实历史宿主＋Edge 浏览器：`publicVersion = act1autochess`、`roomContentVersion = act1autochess`，但 `roomVersion = null`、`shownVersion = act2autochess`、版本内容状态为 `idle`。独立控制器探针的版本数据请求数为 0。浏览器无脚本异常不能证明版本正确。
- **修复方向**：完整同步实时页需要的房间版本和内容身份，复用正常游戏页的版本加载链路；数据就绪后再模拟／展示对应战场。
- **验收**：四版分别进入单独观察和监控墙，界面数据身份与原对局一致，历史版实际进入对应版本数据加载流程；切换玩家、回合和战场后仍保持正确。

## C05：实时查看遗漏房间便利规则

- **现象**：实际允许的休整期调配、卸装、变形同构体配对等功能，在实时页面可能被隐藏、禁用或按默认规则解释。
- **已确认原因**：`m.public.convenience` 已返回，但实时页构造 `room` 时没有同步 `convenience`；游戏界面的 `effectiveRoomRules` 读取的是房间。
- **位置**：[live-viewer.js](../server/live-viewer.js)、[roomConvenience.js](../shared/roomConvenience.js)、[game.js](../public/js/screens/game.js)。
- **证据**：真实浏览器收到 `prepLoadout / unequip / morphPairing` 已开启的公开数据，实时页房间仍无 `convenience`，`effectiveRoomRules` 返回 `null`；实际房间规则为 `prep / allow / plus`。
- **修复方向**：同步完整、必要的房间规则上下文，遵循现有便利选项和插件规则的优先级；不要仅修改按钮状态。
- **验收**：便利选项开／关、插件规则覆盖时，普通玩家页与实时页对规则的判断一致；仅查看状态和监控墙仍不能修改对局。

## C06：代操作白名单遗漏现有指令

- **现象**：控制台复用了现有游戏界面，但部分合法操作被主机代操作 API 拒绝。
- **已确认遗漏**：`g.unequip`（卸装）、`g.offer`（插件交互选择）、`g.offerRefresh`（插件交互刷新）、`g.uniteSkipVote`（联防跳过投票）。游戏协议和对局处理器均已支持，`LIVE_INTENTS` 未包含。
- **位置**：[admin-live.js](../server/admin-live.js)、[gameActions.js](../public/js/ui/gameActions.js)、[protocol.js](../shared/protocol.js)、[intents.js](../server/match/match/intents.js)。
- **证据**：同一 PREP 玩家、同一已装备物品，在允许卸装的规则下，经 `liveIntent` 返回 `BAD_MSG / 不支持或格式错误的代操作指令`，随后相同指令经对局处理返回 `{ ok: true }`。其余三项已核对协议与白名单差异，尚未逐项完成实际交互复现。
- **修复方向**：按现有代操作范围补齐明确允许的游戏动作及相应状态；保留 matchId、revision、回合、阶段校验和只读限制，不直接放行全部协议。
- **验收**：四项各有真实可操作场景，代操作结果与正常入口一致；旧状态、AI／退出／淘汰席位及监控墙不能越过原有限制。

## C07：发放目录缓存身份不足

- **现象**：同一房间换版本开始新局后，干员／道具／机变／自选候选目录可能保留上一局数据，导致选错 ID 或被服务端拒绝。
- **已确认原因**：`loadCatalog(room)` 只按房间码缓存；房间码不变时直接复用旧 Promise，没有按新对局、玩法版本或内容身份失效。
- **位置**：[admin.html](../server/admin.html) 的 `loadCatalog`、[admin.js](../server/admin.js) 的 `catalogView`。
- **证据**：真实浏览器在同一房间从默认对局切到第一期宿主后，仅发生 1 次目录请求；UI 候选保持 224 项，而新的第一期目录实际为 190 项。执行现有目录函数的独立探针也确认旧条目被保留。
- **修复方向**：目录缓存绑定对局及内容身份；换局／换版本／换插件内容后刷新，异步响应不得覆盖当前目录。同步处理旧自选草稿。
- **验收**：同房间换版本、换插件和重新开局都使用新目录；快速切换房间时不串目录；提交 ID 必须属于当前目录和当前对局。

## C08：跨局汇总缺少版本展示与筛选

- **现象**：不同版本同模式、同难度的统计在页面上显示相同标签，无法辨认，也无法通过页面只看某一版。
- **已确认原因**：后台已按 `mode / difficulty / version` 分组并支持 `version` 参数，但前台请求只接入模式、难度、日期，分组表只显示模式／难度。
- **位置**：[result-summary.js](../server/result-summary.js)、[admin.html](../server/admin.html) 的 `showSummary`。
- **证据**：两个版本各一份记录，后台返回两个不同版本分组；真实浏览器显示两行相同的 `coop / NORMAL`，页面没有版本筛选器。
- **修复方向**：显示游戏版本并接入后台已有的筛选参数；总量与排行榜一起按所选范围更新，保留“全部版本”的明确语义。
- **验收**：四版标签可区分；全部／指定版本的局数、胜率、排行榜及日期筛选一致；无版本旧记录按默认版处理。

## C09：隔离宿主的监控墙在线状态过期

- **现象**：历史版或插件对局的玩家断线后，监控墙可能仍显示在线。
- **已确认原因**：隔离宿主 `roomFor(match)` 首次构造后缓存 `seats`，其中 `connected` 是当时值；`wallView` 读取这个缓存值。主控制台房间列表已有按当前席位投影的修正，监控墙未同步。
- **位置**：[extensions.js](../server/match/host/extensions.js)、[admin-wall.js](../server/admin-wall.js)、[admin.js](../server/admin.js) 的 `roomPresence`。
- **证据**：真实历史宿主首次 wall 查询为在线；断线通知后，对局公开玩家状态已为 `false`，后续 wall 查询仍为 `true`。隔离宿主集成函数探针得到相同结果。
- **修复方向**：在正确层级读取当前连接／成员状态，避免首次席位副本成为永久来源；兼顾退出、重连及成员变更。
- **验收**：默认版、历史版、插件对局的断线／重连／退出状态均与主控制台和对局状态一致；process、worker 两种宿主传输均验证。

## C10：联防干员伤害说明过时

- **现象**：控制台排行说明仍写“只算各自战场”“联防里的伤害计入累计数据，但不分干员”。
- **现行行为**：`recordRound` 已将普通结果与多轮 `uniteResults` 中的干员统计合并，控制台读取同一记录。
- **位置**：[admin.html](../server/admin.html) 的统计面板、[history.js](../server/match/history.js)、[settle.js](../server/match/match/settle.js)。
- **证据**：联防输入包含某干员 123 伤害，记录输出保留该干员及 `dmg: 123`。
- **修复方向与验收**：文字说明与现行纳入范围一致，覆盖多轮联防和旧记录缺失字段；不为迁就旧说明而删减统计。

## C11：领袖战回放说明过时

- **现象**：设置页仍称“领袖战仅展示结果”。
- **现行行为**：回放页已支持在用户确认后，对有合适输入与已采纳结果的最终攻势／隐秘核心进行有时长上限的尝试播放。
- **位置**：[admin.html](../server/admin.html) 的 `replay-help`、[replay-viewer.js](../server/replay-viewer.js)、[replay-store.js](../server/replay-store.js)。
- **修复方向与验收**：统一设置页、回放按钮和提示，明确区分可核对回放、无法保证原样的领袖战尝试、合成／未完成战斗仅查看；不得承诺未记录的共享血池时间线可以还原。

## 已有验证与证据边界

以下为 **2026-10-26 本次审查已执行的结果**，并非下个版本修复后的验收：

1. 第一轮定向测试：`node --test test/resources-wall.test.js test/admin-replay.test.js test/replay-store.test.js test/match/replay.test.js`，13 项通过、0 失败。
2. 第二轮定向测试：`node --test test/admin-live.test.js test/result-summary.test.js test/admin-presence.test.js test/match/plugin-admin.test.js`，13 项通过、0 失败。
3. 独立探针覆盖四版内容清单、真实协议心跳、实时页版本控制器、卸装对照、目录缓存、汇总分组、隔离宿主在线状态、便利规则和联防干员统计。
4. 临时端口＋真实历史宿主＋Edge 无头浏览器确认了 C04、C05、C07、C08、C09；未操作用户正在运行的游戏服务。
5. 既有测试通过没有覆盖上述断点；不等于这些功能已经正确。临时探针结果已在本次对话中输出，本文保留关键观测值；没有把它们伪称为仓库内已提交的自动化回归测试。
6. 本轮未宣称执行完整 CI、全量 golden 或修复后的验收。

补充边界：控制台曲线仍加载默认 `bonds.json` 是潜在耦合点，但已比较三个历史版本的 `noStack` 字段，未发现差异，故未另列为已确认缺陷。四席监控墙有分页，现有 20 席状态与统计分组已有测试，不能仅因单页四席判为功能落后。

## 下个版本实施与验收顺序

- [x] 先完成 C01 的版本／内容身份传递，并修复 C02、C04、C05 的数据与规则同步。
- [x] 修复 C06 代操作遗漏和 C07 缓存失效，补真实交互与同房间换局回归。
- [x] 接通 C03 RTT，并补 C08 汇总版本筛选、C09 当前在线状态同步。
- [x] 同步 C10、C11 文案及必要的实现／发布文档。
- [x] 在四版、默认／插件内容、process／worker、单独观察／监控墙场景中执行相关验收；页面覆盖桌面及横屏手机。
- [x] 运行受影响测试、文档检查、完整 CI 和 golden，记录实际通过／失败／跳过；无玩法变更不更新战斗期望。
- [x] 发布前逐项将“待修复”改为已修复并补实现位置、测试命令与实际结果；未完成项明确保留，不用本次排查的测试结果代替修复验收。

原始排查轮只新增问题记录；本轮按维护者要求实施修复，不发布或覆盖现有版本。


## 2026-10-27 实现与验收（未发布）

| 项目 | 实现及已执行回归 |
|---|---|
| C01 | admin.js 的 matchView/roomsView/catalogView/listRecords/lastMatchView 保留版本；页面按 shared/versions.js 命名，回放区分程序版本。四版 API、目录、记录与浏览器标签验证；旧记录按第二期下半。 |
| C02 | 历史版回放使用 loadVersionSet，保留 version/bounds；仅默认官方版命中默认模拟。四版各用自身隔离数据进程真实录制前两回合，普通/联防/切换后重播摘要一致，跨指纹警告与取消通过。缺少历史内容身份时拒绝错误降级。 |
| C03 | net.js 协议 ping/pong 接入既有 monitor。真实 WebSocket RTT 非负、重连首样本为空、关闭采样解绑；不另建连接。 |
| C04–C05 | 实时 room 同步 version/content/mode/difficulty/convenience，内容校验完成再挂载。四版独立观察/内嵌墙和玩家切换的数据身份正确；便利开关/插件覆盖回归；1440×900、844×390 无横向溢出。 |
| C06 | LIVE_INTENTS 仅补 g.unequip/g.offer/g.offerRefresh/g.uniteSkipVote。真实卸装、窗口选择/刷新及投票通过，保留旧状态、AI/退出/淘汰限制，监控墙关闭代操作。 |
| C07 | 目录按房间+matchId/version/cs 缓存，请求序号防迟到响应；失效清候选/自选草稿，提交附身份并校验当前目录成员。四版浏览器目录、VM 执行真实页面函数的换局/版本/内容与乱序、服务端旧身份/不存在 ID 拒绝。 |
| C08 | 页面显示版本并接入四版/全部版本筛选。浏览器四次指定版本各得一局/一个分组，全部四局/四组；后台原筛选回归保留。 |
| C09 | extensions.js 每次重建席位，admin-wall.js 投影主房间当前连接。三个历史版及插件 process/worker 断线/重连，历史版退出及子进程本地缓存刷新通过。 |
| C10–C11 | 更新联防伤害和领袖战尝试说明。普通10+联防123+7合计140，旧缺失字段不补算；领袖战保持限时非精确尝试。 |

额外修复：回放暂停调用不存在的 view.setPaused 导致异常；改为 runner.setPaused，真实浏览器暂停/继续/重播/领袖战尝试通过。交互测试选择有阵容且至少十秒的真实记录。

### 实际测试与边界

- test/admin-console-fixes.test.js：12 项通过，含四版、真实心跳、四项代操作、目录乱序、规则优先级、联防统计、两种历史宿主。
- node --test test/admin-console-fixes.test.js test/admin-live.test.js test/admin-presence.test.js test/admin-replay.test.js test/resources-wall.test.js test/result-summary.test.js test/replay-store.test.js test/match/plugin-admin.test.js test/match/replay.test.js test/docs-consistency.test.js test/docs-paths.test.js：70通过、0失败、0跳过。
- SP_E2E=1、CHROME_PATH 指向本机 Edge：test/ui/admin-console-versions.e2e.test.js、test/ui/admin-live.e2e.test.js、test/ui/admin-replay.e2e.test.js 分别通过；四版本真实回放/实时/目录/汇总及桌面横屏验证。
- node tools/golden.mjs 全部一致，没有修改期望。setup/smoke/guards/lint/imports/typecheck 均通过，lint 0错误/172警告。
- 完整 node tools/ci.mjs --keep-going 已运行：11110测试，10779通过、16失败、315跳过；不能宣称全绿。完整 CI 在后续测试扩展前启动，最终新增检查单独复验。
- 13项沙箱失败来自最初 node_modules junction 指向另一工作区，被权限子进程拒绝。改为本工作区依赖实副本后，相关7文件107项全部通过；未放宽沙箱权限或改实现。
- 另外3项已在 d887816 pristine 副本复现（39项36通过/3失败）：release-install.js「启动器：」未标注、shared/plugins/ui.js 未识别 match.queue 为 intent、lobby.css 两处120px缩放守卫。本轮未修改这些基础文件。
- 四版回放验证为前两回合真实录制，不宣称所有回合和干员组合穷举。历史/插件 process/worker 宿主与浏览器数据身份分别覆盖；不冒称完整浏览器宿主矩阵。未操作用户正在运行的游戏服务，未发布或改标签。

## 同步 main（2026-10-27）

按维护者要求，先将本分支控制台修复保存为本地提交 f5268706，再合入本机 main 的
251b77bf451f0b88542fefee4737bb0e542fcfb4。四份追加型文档 META、design/client、design/network、history/0.3.3
发生内容冲突，均保留 main 的不限版本/不限难度、界面布局记录及本分支控制台修复约定。
代码自动合并，不删减任一侧实现。main 的匹配能力声明和布局修复与控制台版本/便利选项同步共同验证。

合并后定向测试 137 通过、0失败；六个 Edge 浏览器文件合计12项通过，覆盖四版控制台回放/观察、
匹配、首页往返及局内布局。setup/smoke/guards/lint/imports/typecheck 均通过；本轮不宣称重新执行完整 CI。
合并前后的具体命令、三态行为、回滚哈希及 golden 实际结果保存在原 VERIFICATION.txt 的本次追加部分。
未推送或发布。3001 测试实例已有活动对局，本次未重启该进程；新代码完整生效需在测试结束后重启实例。

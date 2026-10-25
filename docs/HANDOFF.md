# 扩展分支维护交接

最近更新 2026-10-24。接手这个项目先读这份，再按需要读下面列的文档。这里只放现状、怎么跑、常见任务和待办，实现细节在 [LOCAL-DEV.md](LOCAL-DEV.md)，不重复。

## 1. 项目是什么

《明日方舟》「卫戍协议：盟约」的非商业同人复刻，跑在浏览器里：Node.js 服务器管经济、回合和房间，战斗模拟是服务器和浏览器共用的确定性代码。上游是 [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol)（GPL-3.0）。

本仓库是面向自行开服与联机的扩展分支，在上游之上加了：

| 功能 | 主要文件 | 细节 |
|---|---|---|
| 主机控制台：改金币 / LP / 等级、发放干员和道具、盟约、托管、效果和机变卡、棋盘编辑、判胜负、休整期时长、实时查看与代操作等 | `server/admin.js`、`server/admin-live.js`、`server/live.html`、`server/live-viewer.js` | LOCAL-DEV §5 |
| 房间文字聊天、位置拖动记忆与战场标点 | `server/chat.js`、`public/js/ui/chat.js`、`chatPosition.js`、`chatStore.js`、`fieldPings.js`、`server/match/match/intents.js` | LOCAL-DEV §2「房间交流」 |
| 聊天管理：公告、清空、禁言和踢出 | `server/chat.js`、`server/admin.js` | LOCAL-DEV §9 |
| 监控墙与资源面板 | `server/admin-wall.js`、`server/monitor.html`、`server/resources.js` | LOCAL-DEV §9 |
| 漏怪、跨局汇总、经济及盟约层数曲线 | `server/match/leak-history.js`、`server/result-summary.js`、`server/match/history.js` | LOCAL-DEV §9 |
| 自动重启恢复、空闲签名更新与更新记录 | `server/recovery.js`、`server/idle-update.js`、`server/release-notes.js` | LOCAL-DEV §9 |
| 控制台重启 / 关闭服务 | `server/service-control.js`、`server/http/boot.js`、`server/admin.js` | DEPLOY §1.5 |
| 回档：回到任一回合的休整期开始 | `server/match/rewind.js` | LOCAL-DEV §4 |
| 整局回放与数据清理：50 局回放、普通战斗 / 联防播放、最终攻势 / 隐秘核心尝试播放、单局删除和三类批量清理 | `server/match/replay.js`、`server/replay-store.js`、`server/replay-viewer.js`、`server/admin.js` | LOCAL-DEV §5「整局回放与数据清理」 |
| 统计和记录：本局曲线、每回合详情、干员伤害排行、对局记录、敌人日程（含指定）、休整期时长设置 | `server/match/history.js`、`enemyPicks.js`、`hostSettings.js` | LOCAL-DEV §5 |
| 可选联防叠层：默认关闭，下次联防生效，援助干员重新获得额度，结算后保留增量 | `server/match/hostSettings.js`、`match/unitePhase.js`、`match/settle.js` | LOCAL-DEV §5「可选联防叠层」 |
| 控制台发放自选干员（选技能和模组、改技能） | `server/match/adminDiy.js` | LOCAL-DEV §5「发放自选」 |
| 一键开服 + 公网隧道、释放端口 | `scripts/start-tunnel.*`、`stop-server.bat`、`free-port.mjs` | [scripts/README.md](../scripts/README.md) |
| 7 名联动 6★ 进自选池（上游因版权排除） | `tools/build-data.mjs` 的 `DIY_COLLAB_ALLOWED`、`kits/ops/op-*.js` | LOCAL-DEV §8 |

### 文档

| 文档 | 内容 |
|---|---|
| [CLAUDE.md](../CLAUDE.md) | 本分支给 AI 助手的约定（和 AGENTS.md 冲突时以它为准） |
| [AGENTS.md](../AGENTS.md) | 上游的入口：必读文档、硬性规则（确定性、golden、生成的数据不能手改等）、验证方法 |
| [LOCAL-DEV.md](LOCAL-DEV.md) | 本分支改了哪些文件、对局引擎速览、回档和控制台的实现、测试、踩过的坑、联动干员 |
| [LOCAL-CHANGELOG.md](LOCAL-CHANGELOG.md) | 本分支的更新记录（给玩家看的说法） |
| [参考站前端私有归档](https://github.com/zhewang448/stronghold-ui-site-archive) | 跟进参考站 UI 的公开源码快照；复抓、来源区分和差异查看见 [REFERENCE-UI-REVIEW.md](REFERENCE-UI-REVIEW.md#后续跟进与私有归档)，需仓库访问权限 |
| [ARCHITECTURE.md](ARCHITECTURE.md)、[SIM.md](SIM.md)、[META.md](META.md)、[DATA.md](DATA.md) | 上游的代码地图、战斗引擎、对局流程、生成数据 |

## 2. 分支与维护状态

- `origin` 为本仓库，`upstream` 为原项目。默认分支 `main` 已整合主机工具、联动扩展、可选皮肤、随机装备和素材预加载；`local-tools` 与 `codex/operator-skins` 保留原功能分支历史。`master` 只跟踪上游。
- 当前版本为 `v0.3.3-extended.1`；尚未发布新制品。保留本库多人大厅、签名增量更新、恢复流程与启动器；历史版本入口和外部大模型 AI 暂不启用。验证记录见 [LOCAL-CHANGELOG.md](LOCAL-CHANGELOG.md)。
- Windows 服主 EXE 通过同版 `launcher-win-x64.zip` 附件提供；先安装或升级同版游戏目录，再将 EXE 放入根目录。使用和构建见 [启动器说明](../launcher/README.md)，验收边界见 [启动器验收](HOST-LAUNCHER-VALIDATION.md)。
- 九项实现与恢复边界见 LOCAL-DEV §9。聊天位置仅当前浏览器与站点按昵称保存；重启恢复要求同版本及规则指纹，跨版本升级不能续局。完整监控墙尚未重跑 30 分钟持续运行测试。
- 本版整合上游 v0.3.1（`b3deebda`）。自选池为 79 名（上游 72 名 + 7 名联动），保留 174 套可选皮肤、多语言语音与控制台扩展；完整包包含重新提取的 11 个官方场景（版本 4）及官方 FX。来源与验证见 [LOCAL-CHANGELOG.md](LOCAL-CHANGELOG.md)。
- 定期跟进上游更新，先完成扩展兼容与验证，再合并。查看 `git status` 和远端分支确认实际工作状态，不把某台机器的进程、私人地址或临时 ref 写进公共交接文档。
- 对局记录、主机设置和缓存不进入 Git。公开或分享前检查所有分支、历史和提交邮箱，见 [PRIVACY.md](PRIVACY.md)。

## 3. 环境与运行

- 支持 Windows / macOS / Linux，使用 Node.js 22 或 24（LTS）。新 clone 后运行 `npm install`、`npm run setup`、`npm start`。
- 素材安装到 `public/assets/`，官方数据缓存在 `.cache/gamedata`，都不进入 Git。
- Windows 可运行 `scripts/start-tunnel.bat`；默认游戏端口 3000，控制台在 `http://127.0.0.1:3100`，只监听本机并需 token。公网只转发游戏端口。
- Windows x64 图形入口为同版 `StrongholdProtocolLauncher.exe`，源码在 `launcher/`，通过 `scripts/host-launcher.mjs` 复用现有启动流程。关闭窗口保留后台服务；停止 / 重启用窗口内按钮，操作前提示断线影响。游戏端口 1024–65435，管理端口为游戏端口加 100；占用时不强杀未知进程，控制台启动失败时仅关闭本次自建服务。
- 开发预览选择空闲端口，例如游戏 3005、控制台 3105；不停止已有服务，结束任务只关闭本次启动的进程。
- 跨网联机可按网络条件选择虚拟局域网、隧道或 VPS，详见 [DEPLOY.md](DEPLOY.md)。个人隧道地址、代理凭据和网络环境放在忽略的本地配置中。
- 浏览器测试通过 `CHROME_PATH` 指定本机 Chrome / Chromium 可执行文件；公共文档使用通用示例，不写个人账户目录。

## 4. 常见任务

**合并上游新版本**
1. `git fetch upstream`，在工作分支执行 `git merge --no-commit --no-ff upstream/master`；没有用户的明确指令不提交、不推送。
2. 冲突只会出在 LOCAL-DEV §2「改动过的上游文件」那几处。生成的数据（`data/backups.json`、`assets.json`、`i18n/*.json`、`test/golden/diy.json`）先取上游版本，再按 LOCAL-DEV §8 的 1–5 步重新生成，不要手工合。
3. `npm install && npm run setup`，跑 `node --test test/match/rewind.test.js test/admin.test.js`，再跑全量。
4. 上游给 `PlayerState` / `Match` 加了新字段时，检查回档要不要处理（LOCAL-DEV §4「以后加新状态时」）。
5. 测完保留已解决冲突的工作区和合并状态，记录验证结果；仅在用户明确要求后才提交。

**给控制台加操作**：LOCAL-DEV §5「加一个新操作」，接口参考见本文附录。新操作在 `test/admin.test.js` 里至少测一次，改完使用空闲端口预览控制台并验证。

**加一名自选干员 / 联动干员**：LOCAL-DEV §8「加一名（或合并上游后）重新生成」。

**改对局逻辑**：遵守 CLAUDE.md 的几条（`m.rng*`、`m.later`、`ps.dirty()` / `m.markPublic()`、`m.guard()`、`MATCH_KEYS`）和 AGENTS.md 的硬性规则（确定性、golden）。

## 5. 测试

- 改了哪里先跑哪里：`node --test test/<目录>/<文件>.test.js`。
- 全量测试约 7–8 分钟，一次只开一份，推荐 `node --test --test-concurrency=4`。每次发布的测试数量和结果只记在 [LOCAL-CHANGELOG.md](LOCAL-CHANGELOG.md) 对应版本的「验证」一条，这里不重复。
- 官方场景的加载与镜头 / 回退功能验证通过，但本机无头 Chrome 的 3D 帧率检查未通过；独立复测首张地图 10.8 FPS、120 单位 9.9 FPS。保留 >30 / >45 FPS 原阈值，发布说明必须披露；可切换 2D 棋盘。详细日志位于被忽略的 `.cache/release-v025/`。
- 历史失败（2026-10-09；2026-10-10 使用 Node 24.19 和并发上限 4 已全部通过）：

| 测试 | 原因 |
|---|---|
| `test/assets-env-proxy.test.js` 的 2 项 | 本机设了代理，Node 22.14 的 `fetch` 不走代理。干净的 HEAD 上一样失败 |
| `test/sim/robustness.test.js` 的 boss 战场性能用例 | 全量并发时 CPU 负载高，两次全量分别测到 0.59、2.09 ms/tick，门槛 0.5 ms。单独跑能过 |

## 6. 待办和候选（都要先问用户）

**联动干员没做完的**（fork 那边本来就没做，见 LOCAL-DEV §8）
- 丰川祥子的 Fever 槽、粉色技力条、KiLLKiSS BGM 切换，以及音符的飞行轨迹没画。
- 焰狐龙梓兰的龙之箭没有自己的飞行图形。
- 艾拉的雷鸣地雷没有 Spine 模型，只显示头像。
- EN / JA / KO 客户端没有焰狐龙梓兰和结城理，zh-TW 没有麒麟R夜刀，对应界面显示中文。

**已完成的扩展**：每回合阵容回放及 NEXT-FEATURES 九项（聊天管理、监控墙、资源、漏怪、跨局汇总、经济与层数、恢复、空闲更新、更新记录）。实现与验收入口见 LOCAL-DEV §9。

**仍待用户选择**：导出 CSV（每回合与累计数据）。

用户此前不做的范围为商店指定格子和手工存档导出 / 导入；2026-10-15 已明确授权本机自动重启恢复，按最近休整期开始恢复并重打本回合。

## 7. 维护约定

- 用中文回答，结论先行；没验证的说没验证。
- 自动化助手只有在用户明确要求后才提交；提交信息和 PR 不加 AI 署名，作者信息使用维护者确认的身份。
- 不直接推 `master`。force push、`reset --hard`、`clean -f`、`branch -D` 这类破坏性操作先问。
- 查 GitHub 一律用已登录的 `gh`，不要匿名 curl `api.github.com`。
- 文档用简体中文，代码和注释用英文。
- 控制台的数据、记录和设置只走 127.0.0.1 的控制台端口；不要在游戏端口上加入口（它通过隧道对公网开放，没有鉴权）。

## 附：控制台各操作用到的引擎接口

以下是第二期时读代码确认过的接口，第三期的实现见 LOCAL-DEV.md 第 5 节。行号是当时的，改过代码后以函数名为准。A.6 的「重新随机」已换成敌人日程，A.8、A.9 已按其中的要点完成（结算记录在控制台里自己画，没有复用游戏的 ResultScreen）。


### A.1 每回合存档

**已完成（2026-10-04）**：下列内容已实现并通过 `rewind.test.js`、`admin.test.js`。

- 现在是 `m.prepSnapshot`（单个）。改成 `m.prepSnapshots: Map<round, snap>`，`capturePrep` 写入 `m.round` 那一格；`rewindToPrep(m, round)` 取对应那份。
- 回到第 R 回合后，删掉 `> R` 的存档（那条时间线作废）。R 自己那份会被随后的 `enterPrep()` 重新写入。
- 实测成本：第 12 回合、1 真人 + 3 AI，快照 JSON 约 25 KB，一次 `structuredClone` 约 2.3 ms。一局最多 15 份，可以全留。
- `refs` 里的 `bossPool` 按引用保存是安全的：它只在 `startFinalAssault` 里新建，休整期时要么是 null，要么是上一场已经打完的那个。改的时候别破坏这个前提。
- 快照在机变（SP_DRAFT）之后才拍，回到某回合会保留那回合已选的机变卡。用户没要求重选机变，保持现状。
- 控制台：回档按钮改成「回到第 [下拉] 回合休整期」。`matchView` 里 `rewindRound` 改成 `rewindRounds: number[]`。
- 测试：在 rewind.test.js 加一个用例「从第 6 回合回到第 3 回合后重打 ≡ 直打」，同时断言第 4–6 回合的存档已被删掉。

### A.2 盟约

- 层数在 `ps.layers[bondId]`，上限 `BOND_LAYER_CAP = 999`（`shared/constants.js`，用 `layerGainRoom(before, n)` 截断）。
- **增加（走游戏逻辑）**：`ps.addLayers(bondId, n, { reason: 'admin' })`（`PlayerState.js` 约 807 行）。它会 `recompute()` 并派发 `onLayers`，等同正常获得。只能加，不能减。
- **直接设定**：`ps.layers[bondId] = n`（0–999），然后 `ps.recompute()`。不派发任何效果。
- 人数加成：`ps.bondCountBonus[bondId] = n`，然后 `ps.recompute()`（effectsMeta.js 的 `setBondCountBonus` 就是这么写的）。层数只在盟约激活时生效，人数加成可以强行激活。
- 盟约列表：`m.gd.bondIds`，名字 `m.gd.bond(id).name`，激活门槛 `gd.bond(id).thresholds`（如炎 `[3, 6, 9]`）。当前状态读 `ps.bonds[id]`：`{ count, active, tier, layers }`。
- 控制台：每个玩家展开一个盟约表（名字、人数/门槛、层数、加成），三个操作 `bondAdd`、`bondSet`、`bondBonus`。

### A.3 托管切换

- `m.setAutoplay(ps, on)`（`Match.js` 约 1006 行），开启时内部会 `kickBot(ps)` 让 AI 接手当前阶段。只对真人有意义，AI 座位跳过。
- 玩家能看到自己被托管：`m.public.players[].autoplay` 已经存在，客户端会显示。

### A.4 效果和机变卡

- 列表：`ps.effects`，每项 `{ id, key, name, desc, iconKind, counter?, battle?, params?, data? }`；`ps.bounties`（悬赏）。
- 删除：`ps.effects.splice(i, 1); ps.dirty();`，与 `effectsMeta.js` 的 `removeEffect` 一致。
- 补发机变卡：`applyCard(m, ps, card)`（`choices.js`，Match 里通过 `m._applyCard` 调用）。卡片来源 `m.gd.choices.cards.tactic`（43 张）和 `.bounty`（129 张）；战术卡要先 `tacticCard(c)` 转成卡片对象。悬赏卡用 `m.addBounty(ps, card)`。
- 注意 `card.team` 为真的战术卡会同时作用到所有队友（`applyCard` 内部处理）。界面上要提示。

### A.5 棋盘

- `ps.board` 是 `Map<"r,c", piece>`（`tileKey` 在 `server/match/board.js`）。合法区域 `GEO.FIELD = { r0: 9, r1: 12, c0: 2, c1: 10 }`。手牌 `ps.hand`（10 格）、整备区 `ps.temp`（5 格）。棋子 `{ uid, kind: 'chess'|'item'|'token', id, items, poolCopies, ... }`。
- 定位：`ps.find(uid)` → `{ piece, area, idx?, key?, holder? }`。
- 删除干员：参照 `sell()` 的顺序，但不给钱：`_detach(loc)` → `removeTokensOf(uid)` → 装备 `stow` 回手牌 → `returnCopies(piece)` → `checkItemMerges()` → `recompute()`。
- 升为精锐：`ps.promote(piece)`（会从卡池补拷贝）。
- 装道具：`equip()` 带 `_gate()`，非休整期或已就绪会被拒。控制台要无视阶段的话，直接用 `ps._attach(target, item)` + 派发 `onEquip`，参照 `equip()` 里非消耗品的那条分支。
- 显示：表格或 4×9 小网格（行 9–12、列 2–10），每格显示干员名和精锐标记即可，不需要画图。

### A.6 敌人预览

- 每个玩家下一场的敌人：`m.nextEnemiesFor(ps)` → `[{ enemyKey, count, gate, t, fly, elite, boss, source }]`，名字 `m.gd.enemy(key).name`。
- 普通回合的波次在 `startRound` 里用 `buildNormalWave(gd, m.rngWaves, m.factions, r)` 生成，存在 `m.wave`；boss 回合是 `m._planBossWaves()` → `m.bossWaves`。
- **实现时发现**：每回合的敌人条目在开局时就由日程定死了，直接重新调用 `buildNormalWave` 得到的是同一批敌人，也不消耗 `rngWaves`。实际做法是用 `pickRoundEntry` 在同一阵营类型里重抽，见 LOCAL-DEV.md 第 5 节。
- （2026-10-08 起「重新随机」已换成「敌人日程」，见 LOCAL-DEV.md 第 5 节。下面是原来的做法。）「重新随机」：只允许在 ROUND_START / SP_DRAFT / PREP（战斗开始前）。重新调用上面的函数会多消耗一次 `rngWaves`，之后的随机流跟着变。这是预期行为，回档能恢复。改完要 `markPublic()` 并给每人 `dirty()`（预览在 `m.private.nextEnemies` 里）。

### A.7 战斗干预

- 默认客户端战斗：战场在 `m.fields`，每个 `f` 有 `cc: true`、`battleId`、`players`、`mode`、`done`。
- **判本场胜**：`f.result = syntheticResult(f.players)`（`fields.js`，空漏怪 = 完美）→ 给显示该战场的真人发 `{ t: 'b.end', battleId, fieldId, reason: 'forced' }`（`m._humansShowing(f)`，参照 `_endFinal`）→ `m._fieldDone(f)`。全部战场完成后会自动进入结算。
- **判本场负**：同上，但 `perPlayer[pid].leaked` 填若干条 `{ enemyKey, counted: true }`。结算扣血 = `min(lpCapPerRound(10), 计数漏怪数)`，见 `settle()`。
- boss 战（FINAL_ASSAULT / HIDDEN_CORE）：设 `m.bossPool.hp = 0` 后调 `m._checkFinalEnd()`，或设 `m.teamLp = 0` 判负。
- 服务器托管的战场（`f.mode === 'server'`）可能还有 `f.job` 在跑，先 `m._clearFieldTimers(f)`。
- 计时倍率：`m.timerScale`，`m.scaled(ms)` 读它。已经设好的倒计时不会重算，只影响之后的计时。
- 测试：用 harness 的 `clientCombat: true` 跑到 COMBAT，强制判胜，断言进入 SETTLE 且 LP 不变；判负断言 LP 扣了 `min(10, n)`。

### A.8 数据记录与曲线

- 记录点：`settle()` 末尾（结算后 LP 已扣），每回合每个玩家记 `{ round, lp, funds, level, layers }`，存到 `m.history`（数组，在构造函数里初始化）。把 `history` 加进 `rewind.js` 的 `MATCH_KEYS`：回档时历史会自动恢复成那个休整期时的样子，和存档的截断规则一致，不用另写代码。
- 控制台操作日志：`handleAction` 里已经 `log.info`，另外存一份到 `room` 或 `match` 上的数组（最近 100 条），页面上显示。
- **图表**（按 dataviz 规范，已跑过校验）：
  - LP 和金币分成两张图，不要双 Y 轴。
  - 系列颜色固定按座位顺序，不随排名变：`#3987e5`、`#d95926`、`#199e70`、`#c98500`。已对控制台面板底色 `#141816` 跑过 `validate_palette.js --mode dark`：全部通过，最差相邻 CVD ΔE 8.4、常规视觉 ΔE 19.8、对比度都 ≥ 3:1。
  - 线宽 2px，数据点 ≥ 8px；网格线用 `#2c2c2a`、轴用 `#383835`、标签用 `#898781`；文字一律用正文颜色，不用系列色。
  - ≥ 2 个系列时必须有图例，并在线尾直接标玩家名；悬停时竖线对齐到回合，一个提示框列出所有玩家在该回合的值（数值在前、名字在后，名字用 `textContent` 插入）。
  - 提供一个「表格」切换，列出同样的数据，保证不用悬停也能读到。
  - 做完截图检查标签是否重叠。

### A.9 保存对局结算记录

- 结算数据就是 `m.result` 帧：`buildResult(m, outcome)`（`server/match/results.js`），对局结束时存在 `m.lastResultMsg`；lobby 的 `onMatchEnd(room, ctx, summary)` 收到的 `summary` 是去掉 `t` 后的同一份数据，另加 `errors`。
- 保存：在 `onMatchEnd`（或 `Match.finish` 之后）写 `logs/results/<时间>-<房间码>.json`。`logs/` 已在 `.gitignore` 里。建议同时存当时的 `m.public` 一份，客户端的 `normalizeResult(res, pub)` 会用它补齐字段。
- 显示「和游戏里一样的统计页」：游戏端是 `public/js/screens/result.js` 的 `ResultScreen`，从 store 读 `match.result` 和 `match.public`。**还没决定怎么复用**，建议做法如下（未验证）：
  - 控制台服务器（127.0.0.1）挂载一份只读的 `public/`：`server/index.js` 导出了 `createStaticHandler`，可以直接用。
  - 加一个查看页，`store.set({ match: { ...emptyMatch(), result, public: pub } })` 后渲染 `ResultScreen`，需要引入 `/css/theme.css`、`/css/components.css`、`/css/screens/result.css` 和 importmap。
  - 这样记录只在本机可见，不会通过隧道暴露。
  - 不要把记录放到游戏服务器的公开路径下：游戏端口通过隧道对公网开放，而且没有鉴权。
- 控制台加一个「对局记录」列表：时间、房间、模式难度、胜负、回合数，点开看统计页。

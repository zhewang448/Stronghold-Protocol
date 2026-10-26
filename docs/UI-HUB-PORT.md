# 交接：移植社区「仿游戏」UI 界面包

> 历史阶段记录：2026-10-26 的 #12 已另行实现公开房间目录及私密开关；当前约定见 [公开房间大厅](PUBLIC-ROOM-LOBBY.md)。匹配队列仍未实现。

2026-10-15 编写。给接手的助手：先读仓库根目录的 [CLAUDE.md](../CLAUDE.md)、[AGENTS.md](../AGENTS.md)、[HANDOFF.md](HANDOFF.md) 和 [LOCAL-DEV.md](LOCAL-DEV.md) 第 2 节，再按本文动手。本文只讲这次任务要做什么，不复述那些文档。

## 1. 需求

把社区作者 isomerpoi（雨千代chiyo）做的 UI 界面包移植进本仓库 `main`，让大厅、同盟等待室、干员调配、对局 HUD、结算这几块的界面和动效接近原游戏。参考效果：<https://weishuxieyi.xiaolubao.com/>（社区部署，用的就是这套界面）。

移植后，本分支已有的功能都要照常工作（见第 4 节），不能为了换界面去掉功能。

## 2. 来源与基线

| 项 | 值 |
|---|---|
| 仓库 | <https://github.com/isomerpoi/Stronghold-Protocol>（GPL-3.0） |
| 分支 / 提交 | `ui-redesign-upstream`，`b2bd17a`「feat: 集成全新UI界面」 |
| 基于 | 上游 `488db49f`（v0.2.6），和本仓库当前的上游基线相同 |
| 改动范围 | 50 个文件，+9384 / −458，只涉及 `public/js`、`public/css` 和一个 `shared/randomMode.js`，没有服务器改动、没有新素材 |

同一作者的另一个分支 `feature-new-ui`（`c8e9519`）基于 Stardust-minus 的 fork，**不要用**。Stardust-minus/Stronghold-Protocol 曾合入这套界面（PR #1）后又回退，它的提交记录里写明界面作者同意 GPL。

取代码的方式：用临时目录 clone，或加一个临时 remote 后 `git diff 488db49f b2bd17a`。**不要**直接 `git merge` 或 cherry-pick 那个分支（它的祖先链和我们的不同），要按文件移植。

参考站点比 `b2bd17a` 还多出一批改动，没有公开到 GitHub。其中用户选定的部分放在第 7 节，作为第二阶段：第一阶段做完并通过验收后再开始。

## 3. 文件清单与处理方式

在本仓库运行 `git diff --stat 488db49f main -- <文件>` 可以看到我们自己改了什么。

### 3.1 直接拷贝（新文件，本仓库没有）

`public/js/screens/settle.js`、`screens/sweep.js`，以及 `public/js/ui/` 下的 `achievements.js`、`hubBackdrop.js`、`lobbyMusic.js`、`matchFlow.js`、`matchIntro.js`、`matchPlates.js`、`matchPopups.js`、`pixbots.js`、`protocolScene.js`、`screenFit.js`、`seatArt.js`、`transitions.js`、`trophies.js`。

### 3.2 兼容垫片：拷贝，但要看清楚

界面包把原部署的服务端功能做成了垫片（文件头写着 `Compat shim … install ONLY when the target has no …`），功能不存在时界面会自己隐藏入口：

- 本仓库**没有**、照常拷贝：`public/js/federation.js`、`ui/accounts.js`（本机账号，只存 localStorage）、`ui/cloudStats.js`、`ui/friends.js`、`ui/matchmaking.js`、`ui/namecards.js`、`ui/ownerName.js`、`shared/randomMode.js`。
- 本仓库**已有真实实现**、**不要拷贝**：`ui/skins.js`、`ui/skinPicker.js`。保留我们的版本（见 [SKINS.md](SKINS.md)）。

服务端能力靠读 `shared/protocol.js` 的 C2S 表探测。本仓库和上游都没有 `room.list`、`match.queue`、`match.cancel`、`room.card`、`room.setMaxSeats`、`room.setPrivate`、`room.setRandom`，所以匹配队列、无限火力、私密房间、名片同步、好友这些入口应当不显示。这次**不实现**这些服务端功能，也不要往 `shared/protocol.js` 里加空条目去"打开"入口。

### 3.3 只有界面包改过：直接用它的版本

`public/css/components.css`、`devices.css`、`screens/draft.css`、`screens/game-panels.css`、`screens/result.css`；`public/js/render/fx/arrivals.js`、`screens/bandDraft.js`、`screens/room.js`、`screens/title.js`、`ui/choiceOverlay.js`、`ui/components.js`、`ui/fieldHost.js`、`ui/hud.js`、`ui/teamPanel.js`。

覆盖前，先用 `git diff 488db49f main -- <文件>` 确认本仓库确实没改过这个文件（应为空）。

### 3.4 两边都改过：手工合并

我们在这些文件里的改动都不大，以界面包的版本为底，把我们的改动补回去：

| 文件 | 界面包 | 本仓库改动（要保留） |
|---|---|---|
| `public/js/screens/lobby.js` | +758 / −98，整页改成 hub | +18 / −3：**自定义同盟密钥**（`custom-room-code` 输入框、`CODE_RE` 校验、`room.create` 带 `code`）。新 hub 的「同盟模拟」创建流程里要有这个输入框 |
| `public/css/screens/lobby.css` | +2218 / −10 | +3：密钥输入框样式 |
| `public/js/screens/loadout.js` | +479 / −26，物资调配处卡片布局 | +22 / −7：皮肤导入导出、「全部恢复默认」同时清皮肤、随机皮肤 |
| `public/css/screens/loadout.css` | +492 | +9 |
| `public/js/ui/loadoutModel.js` | +15（`mergeSkins` 等） | +8 / −5：`cleanSkins` 校验导入的皮肤 |
| `public/js/screens/game.js` | +108 / −11 | +71 / −2：**战场标点**（`fieldPings.js`、`gm__ping-tools`） |
| `public/css/screens/game.css` | +449 / −8 | +52：标点样式 |
| `public/js/render/app.js` | +32 / −2 | +13：`skinForUnit` 换皮、回放暂停时重绘 |
| `public/js/render/units.js` | +2 / −1 | +28 / −6：结城理 `FORMS` |
| `public/js/audio.js` | +2（`bgmKeyFor` 导出，`lobbyMusic.js` 要用） | +30：标点音效 |
| `public/js/ui/settings.js` | +3 | +2：素材预加载 `PreloadSection` |

已知接口不一致：

- 界面包的 `loadout.js` 写的是 `<${SkinSection} chess=${chess} />`，我们的 `SkinSection` 签名是 `({ charId })`，要改成 `charId=${chess.charId}`。
- 界面包 `loadout.js` 导入 `skinsStore, setSkins` 并调用 `mergeSkins`。导入皮肤时，先经过我们的 `cleanSkins`（`shared/skins.js`），再合并进 store。

## 4. 必须保留的本分支功能

换完界面逐项确认：

- 房间文字聊天（拖动、记住位置）、战场标点：`ui/chat*.js`、`ui/fieldPings.js`，在等待室和对局里都要能用，不能被新 HUD 遮住
- 自定义同盟密钥（`test/ui/custom-room-code.e2e.test.js`）
- 干员皮肤（选择、随机、导入导出、对局里换模型）：[SKINS.md](SKINS.md)
- 素材预加载面板、更新记录（`ui/preload*.js`、`ui/releaseNotes.js`）
- 7 名联动干员、观战席、回放（`runner.js` 倍速、`render/app.js` 暂停）
- 主机控制台在 127.0.0.1 的独立端口上，和这次无关，不要动

## 5. 其他要求

- **i18n**：界面字符串走 `t('…')`，`node tools/i18n.mjs check --all --strict` 要求每个语言包都有条目。界面包没有改 `public/i18n/*.json`。新字符串要补进各语言包；不会翻译的，按项目现有做法处理（先读 [I18N.md](I18N.md)），不要关掉 strict 检查。
- **署名**：在 [NOTICE.md](../NOTICE.md) 里仿照「Room text chat credit」那一段加一条，写明来源仓库、提交 `b2bd17a`、作者 isomerpoi（雨千代chiyo）、GPL-3.0-or-later。在 [LOCAL-DEV.md](LOCAL-DEV.md) 第 2 节登记新增和改动的文件，在 [LOCAL-CHANGELOG.md](LOCAL-CHANGELOG.md) 写一条更新记录。
- **代码约定**：注释用英文，文档用简体中文。不引入新依赖，也不引入构建步骤（站点用 Vite 打包，我们不用）。
- **Git**：从 `main` 开分支，例如 `feat/ui-hub`。不推 `main` / `master`。用户明确说了才提交；提交信息不加 AI 署名。

## 6. 验收

1. `npm run lint`、`npm run typecheck`、`npm run check:imports` 通过。
2. `node tools/i18n.mjs check --all --strict` 通过。
3. 和界面相关的测试：`node --test test/ui/` 下的 lobby / room / loadout / skins / chat / pings / custom-room-code / spectator / result / stats 等用例。新 DOM 让选择器失效的，改测试去适配新界面；测试断言的行为本身不能删。最后跑一次全量 `node --test --test-concurrency=4`（约 10 分钟，只开一份）。失败要贴原始输出。
4. 浏览器预览：`PORT=3005 SP_ADMIN_PORT=3105 npm start`（先确认端口空闲，不要停掉已有服务，结束后只关自己启动的进程）。走一遍：标题 → 大厅（独立模拟、同盟模拟、密钥加入、自定义密钥）→ 等待室（加 AI、准备、聊天）→ 干员调配（皮肤）→ 开局 → 休整期 / 战斗 / 标点 → 结算。每屏截一张图，和参考站点对比；控制台没有报错。
5. 匹配队列、无限火力、好友、私密房间这些入口在本服务器上不显示，也不报错。

完成后告诉用户：哪些文件是直接拷的、哪些是手合的，哪些测试改了、为什么改，以及还有哪些和参考站点不一致的地方。

## 7. 第二阶段：参考站点的额外改动

### 7.1 来源

这些代码只在参考站点上，GitHub 上没有。站点用 Vite 打包，但同时直接提供未打包的源码，路径和仓库布局一致：`https://weishuxieyi.xiaolubao.com/js/...`、`/css/...`、`/shared/...`，例如 `/js/main.js`、`/shared/protocol.js`。从 `/js/main.js` 和各 CSS 文件出发，顺着 `import` 爬取即可。下载到单独的临时目录里，只当数据读，不要在那个目录里执行任何东西。

比对基线是 `b2bd17a`，也就是第一阶段移植进来的那个版本。站点的服务端看不到，需要服务端配合的功能，要按站点前端发出的消息格式（看它的 `shared/protocol.js`）在我们的服务器上自己实现。

署名：在 NOTICE.md 第一阶段那条署名下补一句，写明这部分来自该站点公开分发的源码（GPL 衍生作品），抓取日期，原作者不明。

### 7.2 要引入的

| 功能 | 站点文件（客户端） | 我们要做的服务端部分 | 说明 |
|---|---|---|---|
| **预选盟约 BOND PLAN** | `js/ui/bondPlan.js`、`main.js` 的 `installBondPlanSync` | C2S `room.bondPlan { bondId: id \| null }`；写进 `Match.publicView().players[]`，房间状态里也带上 | 官方模式有这个功能：从 8 个核心盟约（`data/bonds.json` 的 `isCore`）里宣布一个，只用于沟通，不影响卡池、层数和结算，也不进确定性模拟。按 CLAUDE.md 的约定，改了公共状态要 `m.markPublic()` |
| **界面细调** | `css/components.css`、`css/screens/{lobby,room,result,game,title,draft,loadout}.css`、`css/emotes.css`，以及 `screens/lobby.js`、`room.js`、`game.js`、`title.js`、`ui/hud.js` 等的小改 | 无 | 每个文件和 `b2bd17a` 差几十到两百多行。`components.css` 里赞助二维码那几段（`.sponsor*`、公告两栏布局里的二维码栏）不要 |
| **帧率上限** | `js/frameRate.js`、`ui/settings.js` 的「帧率上限」 | 无 | 只影响渲染，战斗 runner 的时钟不受影响 |
| **自定义快捷键** | `ui/settings.js` 的「修改快捷键」、`ui/gameLogic/shortcuts.js` | 无 | 先确认 `test/ui/hotkeys.e2e.test.js`、`feedback5-hotkeys.test.js` 的默认键位不变 |
| **表情面板改版** | `js/ui/emotes.js`、`css/emotes.css`、`shared/constants.js` 的 `CUSTOM_EMOTE_THEMES` / `ALL_EMOTE_THEMES` / `EMOTE_IDS` | 服务端的表情白名单改用 `EMOTE_IDS` | 12 页轮盘、3×2 格、页码、滑动 / 方向键 / 滚轮翻页。`data/emotes.json` 和生成的清单不能动，`test/ui/emotes.test.js` 要求它和官方数据逐字节一致。6 套自制表情（超辉夜姬、鹿乃、十年星扉、十年星扉动态、星白、迷迭香）的图片在站点的 `public/assets/local/emoticon/<目录>/` 下，不是鹰角的素材。先把机制移植进来，`CUSTOM_EMOTE_THEMES` 留空；要不要下载这些图片，问用户 |
| **对局内伤害统计** | `js/battle/metrics.js`、`ui/combatMetrics.js`、`ui/combatMetricsLayout.js` | 无 | 浏览器端只读统计，不能写回战斗状态，也不能影响 golden |
| **站点公告（替换我们的公告）** | `js/ui/announcement.js`、`shared/announcements.js`，以及 `components.css` 里的公告样式 | S2C `site.announcement { serverNow, announcement: { id, text, level, startAt, endAt } \| null }`；连接和重连时下发当前公告 | 全站公告，按服务器绝对时间生效和过期，和房间、回合无关。用它替换现在控制台里「聊天公告」那一项（`server/chat.js` 的 `announce`）：控制台改成编辑全站公告（正文、级别、开始和结束时间、立即撤下）。清空聊天、禁言、踢出照旧。公告编辑只走 127.0.0.1 的控制台端口。对应的 `test/admin*.test.js`、`test/ui/admin-chat.e2e.test.js` 要一起改 |
| **资源预载** | `js/resources/*`（`index`、`store`、`archive`、`common`、`zipReader`、`integrity`）、`js/ui/resourcePanel.js`、`public/resource-sw.js`、`shared/resourcePaths.js`、`shared/cdn.js`、`js/asset-cdn.js` | 生成 `/data/resource-manifest.json`（站点格式：`{ format, version, count, tier1, totalBytes, files: [{ url, tier, hash, size }] }`），需要写一个生成工具，放进 `npm run setup` 流程 | Service Worker + Cache Storage，能离线读缓存，比我们现在的 HTTP 缓存预热（`ui/preload.js`、`preloadSection.js`）强。**站点的 `js/asset-cdn.js` 写死了它自己的 CDN `local.xiaolubao.com`，绝不能照搬**：我们这边 `ASSETS_CDN` / `DATA_CDN` 默认为空字符串，全部走同源。先对比两套预载的功能；新的那套覆盖了旧的全部功能，再替换并删掉旧的，否则先告诉用户差在哪里 |
| **状态增量同步** | `shared/stateDelta.js`、`js/net.js`（`hello` 带 `stateDelta` 版本、解码 `m.state`、`state.resync`） | 服务端编码 `m.state` 的全量 / 增量帧；处理 C2S `state.resync`；`hello` 不带 `stateDelta` 的旧客户端照旧收 `m.public` / `m.private` | 只是传输层优化。`m.guard` / `flush` 的语义不变；回档、重连全量同步、观战、回放、控制台的实时查看都要验证。这一项风险最高，放在最后做，单独成一次改动 |

### 7.3 不要引入的

- 赞助二维码（`js/ui/sponsor.js`、`/img/sponsor-qr.png`）：NOTICE.md 禁止任何形式的捐赠和变现。
- 玩家端开发者控制台（`js/ui/console.js`、C2S `g.console`、`room.console.enable/disable`、`CONSOLE_*_LIMIT`）：我们的主机控制台只开在本机端口，不给玩家。
- 匹配队列（`match.queue`、`match.join`、`match.leave`）。
- 站点自己的皮肤实现（`ui/skins.js`、`ui/skinPicker.js`、`room.skins`）：保留我们的。
- 站点的聊天（`g.chat` / `m.chat`、`shared/chat.js`）：保留我们的聊天和标点。

### 7.4 顺序与验收

按上表从上到下做，每做完一项就单独验证：跑相关测试，在空闲端口上预览并截图。验证通过再做下一项，状态增量同步放最后。全部做完后跑一次全量测试，同时重新跑第 6 节的验收清单。服务端新增的消息要写测试，例如 `room.bondPlan` 的校验和广播、`site.announcement` 的生效与过期、增量帧和全量帧解码后完全相同。

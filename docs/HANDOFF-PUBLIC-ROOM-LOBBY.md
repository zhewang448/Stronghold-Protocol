# 同盟大厅与真人匹配交接

当前状态（2026-10-27）：本功能已合入main，随v0.3.3-extended.3发布。原功能分支及干净临时工作区已清理；以下为历轮历史交接，不代表仍需在旧工作区继续。当前维护入口见[主线交接](HANDOFF.md)。

更新时间：2026-10-27（Asia/Shanghai）。本文件交接 `codex/public-room-lobby` 分支，不替代主线 `docs/HANDOFF.md`。

## 1. 接手结论

公开房间大厅、首页布局整理、本服真人匹配首版已实现并推送。已提交首版严格区分玩法版本与难度，未提交续版已支持不限版本且保持难度一致。

最新需求是：同盟大厅内增加「搜寻队友」、提供忽略玩法版本号的匹配，并精简重复入口和冗杂布局。上一轮只讨论了整合建议；该段为上一轮历史；用户已于续轮授权继续改动，大厅整合与不限版本已在当前工作树实现，详见下方续接状态。

用户已明确选择：支持个人排队和房主为现有同盟补充真人；匹配后进入现有等待室，沿用准备和房主手动开始。用户强调尽量复用已有功能，避免重复造轮子。

## 2. 工作区与提交

| 项目 | 当前记录 |
| --- | --- |
| 工作区 | `C:/Users/34948/.codex/worktrees/public-room-lobby/Stronghold-Protocol` |
| 分支 | `codex/public-room-lobby`，跟踪 `origin/codex/public-room-lobby` |
| 最新功能提交 | `d88781613df586569f8061ab6d1b75693f1e7f82` |
| 原始基线 | `64d90cfee90832572ac7640c5d6f5ecd89f19fc2` |
| 原工作区 | `E:/Stronghold-Protocol`，有其他未提交工作，不修改、不清理 |
| 测试地址 | `http://127.0.0.1:3005`，管理端口 `3105` |
| 实例元数据 | `E:/Stronghold-Protocol-transactions/public-room-lobby-20261026/PREVIEW_INSTANCE.json` |

文档新增前工作树干净，分支与远端没有显示领先或落后。尚未开 PR、未合并主线；本文新增不代表已提交或推送。

实例元数据记录 PID `54012`、提交 `d8878161`；这是保存的启动记录，不保证接手时仍运行。重启前核对实际监听进程、健康状态与房间/对局数，只操作本测试实例。原 `3000` 服务保持原样，有玩家使用时不要停止实例。

已完成提交，按时间顺序：

1. `360697aa`：公开房间大厅，复用现有加入与观战。
2. `b721b652`：整理大厅入口与成就、资讯布局。
3. `eb723f99`：补齐大厅小字，公告与更新按钮居中。
4. `d8878161`：本服真人匹配，复用同盟等待室。

## 3. 已完成功能

### 3.1 大厅与首页

- 首页右下角仅保留独立模拟、同盟模拟、同盟大厅三张卡片。大厅卡片左上方有图标和小字。
- 顶部不重复放大厅入口，右侧不再常驻「缺人同盟」列表。
- 公告、更新内容在成就卡片右侧按列排列，图标和文字整体在按钮中居中。宽度不超过 1100px 或高度不超过 560px 时移到成就下方横排。
- 目录支持手动加入/观战，排除独立模拟、测试、私密、销毁和无真人房间。容量计入 AI 与掉线保留位，兼容扩展席位和玩法插件。
- 新合作房默认公开；创建页和房主设置可切换私密，沿用既有重启恢复。
- Hub 和弹窗共用轮询，在线人数与隐身房主遵循社交策略。

参考来源为 `NeoPecos/Stronghold-Protocol` 的 GPL-3.0-or-later 实现，固定提交 `2cadc6183c133fb22f5853c15db945bbaf4ce700`；没有整体合并来源分支。来源及适配详情见 [PUBLIC-ROOM-LOBBY.md](PUBLIC-ROOM-LOBBY.md)。

### 3.2 真人匹配首版

- 同服务器、相同玩法版本、相同难度、原版固定四席。
- 散人凑齐四人后复用 `Lobby.create` / `Lobby.join`，最早排队者为房主。个人排队不预先建房。
- 主动搜寻的已有房间优先补人；普通公开房不自动接收玩家，不合并两个同盟。
- 进入现有等待室，不自动开局、不自动补 AI、不替换已有 AI。取消只退出队列，已加入成员保留。只有满员才显示集结完成。
- 私密、测试、扩展容量、玩法插件、自定义及非默认便利规则房不参与自动匹配。
- 房主或现有真人断线/离开，或版本、难度、容量、隐私、规则变化、开局、销毁时取消招募。观战者离开不影响招募。
- 散人断线出队，重连需主动重排；服务器不持久化队列，客户端不再每十秒反复入队。

完整说明见 [MATCHMAKING.md](MATCHMAKING.md)。

## 4. 代码入口与复用关系

| 文件 | 接续重点 |
| --- | --- |
| `server/matchmaking.js` | `Matchmaking`；`solo` / `parties`；`eligible`、`same`、`queue`、`cancel`、`pump`、`reconcile`、`leave`、`countFrame` |
| `server/lobby.js` | 创建/加入/开始与生命周期；`Room.toState` 可选 `matching` 字段 |
| `shared/protocol.js` | `match.queue`、`match.cancel`、`match.state`、`match.found`、`match.counts` |
| `server/net.js` | 入队复用 heavy bucket；取消不占重请求桶 |
| `public/js/screens/lobby.js` | `AllianceSelect`、`ProtocolSelect`、`MatchmakingModal`、首页及搜寻状态 |
| `public/js/screens/room.js` | 房主搜寻、兼容性判定、等待室状态 |
| `public/js/store.js` | `matchmaking`、`matchmakingCounts` |
| `public/js/main.js` | 匹配事件、离线清理、错误提示 |
| `public/css/screens/lobby.css` | 大厅、搜寻面板与小屏布局 |
| `public/i18n/` | 四份翻译包，新增文案全部覆盖 |

当前 `same(a, b)` 比较版本和难度，散人按版本/难度分桶。「不限版本」不能只删除一处版本比较：招募房、散人组房、计数和返回状态都需要同步处理。

当前请求：`match.queue { mode: 'coop', difficulty, version?, fillBots?: false, random?: false }`。不要将现有版本缺省解释为已经支持不限版本。新增偏好字段及旧客户端兼容方式尚未定。

`match.found` 返回实际房间、版本、难度和 `full`。`match.counts` 只公开可见散人的版本/难度计数，无昵称、ID、房号，遵循 `social.counts`。

现有重复入口：`AllianceSelect` 的「搜寻队友」打开全屏 `ProtocolSelect`，「模拟邀约」打开目录；创建页另有「快速匹配」。`MatchmakingModal` 实际是同盟大厅的房间目录，目前没有搜寻动作，顶部三个大统计块占位较多。

房间页 `searchable` 与服务端 `eligible` 有重复兼容性判定，修改时保持一致，以服务端为最终裁决。复用已有选择器、房间行、焦点管理、轮询和 store，不另建房间系统。

## 5. 最新需求与讨论方案

### 5.1 用户明确提出

1. 同盟大厅中增加「搜寻队友」。
2. 提供模糊匹配，忽略玩法版本号。
3. 简化当前冗杂 UI。

这里的版本指玩法版本，不是客户端发布号；不代表可以忽略客户端协议兼容性。

### 5.2 上一轮建议，待确认、未实施

将房间浏览与排队放在同盟大厅，同一操作栏显示条件和搜寻状态：

```text
同盟大厅                                      关闭
版本 [不限版本 ▾]  难度 [标准 ▾]  [搜寻队友]
房间列表……
在线人数 · 房间数 · 对局数                      刷新
```

- 模糊匹配文案用「不限版本」；建议默认不限版本，选具体版本则精确匹配，难度仍严格匹配。默认值仍是建议。
- 搜寻时原操作栏显示「搜寻中 · 00:12 / 取消」，继续展示房间列表，不为排队单独切全屏。
- 三个大统计块收成一行小字，保留首页三卡片。
- 同盟模拟的搜寻捷径打开统一大厅，整理「快速匹配」「模拟邀约」等重复命名。正常建房和密钥加入继续沿用。

### 5.3 不限版本的建议语义

- 同一局仍只采用一个实际玩法版本，匹配入房后采用该房版本。
- 已有同盟保持当前版本，房主搜寻不能悄悄切版。
- 精确与不限版本共用队列；不限版本玩家可补入满足所选难度的招募房。
- 散人组房需满足所有精确版本约束；不同精确版本的玩家不能被不限版本玩家错误拼成一队。
- 全部不限版本时，建议采用最早排队者偏好的已启用版本；若不支持难度，再选择兼容版本，回退顺序待明确。
- 继续保留 FIFO、已有房间优先、取消、权限、限流、隐身和容量规则，不另建匹配池。

## 6. 后续实施顺序与验收

1. 在本分支接续，结合用户下一轮意见确认第 5 节的默认值和版本选择；先读现有实现及测试。
2. 明确协议中的任意版本、精确版本、实际房间版本，保留旧请求语义。
3. 扩展现有匹配分配、状态和计数，再整合大厅筛选/搜寻/取消，复用现有组件。
4. 更新语言包、`docs/MATCHMAKING.md`、设计、历史和协议说明，完成验证及事务记录。

至少验收：四个不限版本散人；混合精确与不限；两个不兼容的精确版本；难度隔离；版本不支持所选难度；已有房补人不切版、不拆队。

还需覆盖取消/断线/变更条件/失败分配/手动加入或建房/房主切版/开局/观战者离开，以及隐身计数、私密、限流。维持不自动开局和不自动 AI。

UI 验收需覆盖桌面、844×390 和 640×360 横屏大字；搜寻和取消按钮可见可点，列表继续可用，原手动加入/观战/准备/房主开始和首页资讯布局正常。

## 7. 已记录验证与复现

以下是上一轮功能提交的记录，不是本轮编写文档重新执行的结果：

- 相关单元、集成和 UI 结构测试：226 项通过。
- 匹配与房间目录两套浏览器测试顺序运行通过。
- smoke、guards、lint、imports、typecheck 通过，四语言 i18n 检查通过。
- golden 299 场景匹配，未更新战斗基准；布局检测 `[]`、退出码 0。

不能声称全量 CI 全绿：更早一次全量结果为 11100 项、10787 通过、17 失败、296 跳过。依赖链接及环境问题后续修复并重跑相关检查，但没有重新完成全量 CI；`server/release-install.js` 的既有未包装字符串也曾在基线复现。新修改必须重新验证。

在工作区运行：

```powershell
node --test test/matchmaking.test.js test/lobby.test.js test/lobby-list.test.js test/lobby-versions.test.js test/lobby-plugins.test.js test/lobby-expanded-capacity.test.js test/recovery.test.js test/social.test.js test/ui/lobby-hub.test.js test/docs-consistency.test.js test/docs-paths.test.js
node tools/i18n.mjs check --all --strict
node tools/ci.mjs --only smoke,guards,lint,imports,typecheck --keep-going
npm run golden
$env:SP_E2E='1'
$env:CHROME_PATH='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
node --test --test-concurrency=1 test/ui/matchmaking.e2e.test.js test/ui/room-directory.e2e.test.js
```

浏览器实际点击前等待有限转场结束，视口切换后等待页面恢复；等待室席位类名为 `.rseat`。多页面 UI warmup 在测试夹具提高 burst，默认限流另由真实 WebSocket 测试验证，不因此调整生产限流。

开 PR 前按仓库要求跑 `npm run ci` 与 `npm run golden`。本分支无战斗规则变化，不应更新 golden。

## 8. 事务证据与回滚

复用原目录和四个角色，追加证据，不覆盖旧结论：

| 角色 | 绝对路径 |
| --- | --- |
| 修改后副本 | `E:/Stronghold-Protocol-transactions/public-room-lobby-20261026/MODIFIED_FILE.tar` |
| 重建补丁 | `E:/Stronghold-Protocol-transactions/public-room-lobby-20261026/DIFF_FILE.patch` |
| 验证日志 | `E:/Stronghold-Protocol-transactions/public-room-lobby-20261026/VERIFICATION.txt` |
| 可执行回滚 | `E:/Stronghold-Protocol-transactions/public-room-lobby-20261026/ROLLBACK.sh` |

基线是 `64d90cfe`，另有 `BASELINE.tar` / `BASELINE_COPY`。回滚脚本接受目标副本路径，依赖同目录基线和新增文件清单；只在独立副本验证，不对正在使用的工作区执行。

上一轮 `matchmaking-probe.mjs` 已观察到：BASELINE 四次入队均 `BAD_MSG`、未建房；MODIFIED 四次成功、同一等待室 4 真人/0 AI/未开局；ROLLBACK 恢复四次 `BAD_MSG`、未建房，恢复哈希与基线一致。

Windows 独立副本重放补丁使用 `git -c core.autocrlf=false -c core.eol=lf apply --unsafe-paths`，避免 CRLF 差异。`matching-finalize.py` 有历史快照和结果硬编码，先阅读再适配，不盲目重跑或冒称新验证。

本次交接追加文档探针和回滚重放结果，证明交接产物及现有状态，不代表第 5 节功能已经实现。具体命令、原始输出、退出状态和哈希均以 `VERIFICATION.txt` 为准。

## 9. 接续注意

- 阅读 `AGENTS.md`、`docs/ARCHITECTURE.md`、`docs/DESIGN.md`、`docs/META.md`、`docs/I18N.md` 和 `docs/CI.md`。UI 修改沿用 Impeccable 技能和现有游戏风格。
- JavaScript 两空格，UI 文案使用 `t('…')` 并覆盖全部语言包；便利功能标记 `[ASSUMED]`。
- 不手改 `data/*.json`，不提交游戏素材、字体、本机配置或凭据。素材/字体为本机链接，依赖为本地副本。
- 本次文档未请求提交/推送。若后续获授权推送遇连接重置，可使用 `git -c http.version=HTTP/1.1 push origin codex/public-room-lobby`。

接手第一步：读本文件、`server/matchmaking.js`、`MatchmakingModal` 和相关测试，结合用户下一轮确认实施大厅内搜寻与不限版本匹配。

## 10. 续接实现状态（2026-10-27）

用户已授权继续实现第 5 节。目标工作树、分支及四个事务角色不变，仍未提交/推送这些续版改动。

- `match.queue.anyVersion` true 接受任意可用玩法版本；缺省/false 保留精确版本，`version` 为不限时偏好。
- 精确和不限共用 FIFO 池，主动招募房优先且不切版。新组四人满足全部精确约束；全不限优先最早者偏好，
  不支持难度时按服务器注册顺序回退。没有可用版本支持则拒绝，不放宽难度。
- 同盟大厅内联版本/难度筛选、搜寻计时与取消，搜索期间保留目录；默认不限，难度沿用上次。
- 同盟模拟搜寻直达大厅，创建页也可跳转大厅，移除快速匹配/模拟邀约重复入口。三个统计数字缩成底行。
- `match.counts` 增加非个人能力 `offered` 与隐私控制的不限聚合 `anyVersion`，前端仅将可兼容难度计入各版本显示。
- 原等待室、房主补人、准备/手动开始、无自动 AI/开局及四语言保持。新增混合、不兼容、回退、偏好变化、
  难度隔离、隐身能力和排队手动入房验证；浏览器覆盖 844×390 / 640×360 横屏大字，列表与取消热区。

原始 baseline 不变。新增续版前快照 `PRE_UNIFIED_LOBBY.tar` 与 `PRE_UNIFIED_HASHES.json`，验收原始输出及
退出码追加到原 `VERIFICATION.txt`，最终结果以该账本为准。旧首次失败（目录默认难度与夹具不一致）
保留日志，修复夹具后两套浏览器套件通过；不将历史失败抹成成功。全量 CI 未重新执行，不声称全量通过。

## 11. 不限难度与报错修复（2026-10-27）

用户要求难度不限并修复版本报错，已实现 `match.queue.anyDifficulty`，与 anyVersion 独立；旧请求
仍精确，原房招募仍固定。任意分组满足所有明确条件，实际版本/难度统一，无自动 AI/开局。
新增 MATCH_UNSUPPORTED、match.counts.features，老进程不支持不限时明确提示重启刷新。

报错根因已观察：3005 原 PID 54012 仍运行旧匹配逻辑，无 offered/features，第一期偏好 ABYSS +
anyVersion true 被当精确请求拒绝。零房间下 NORMAL 成功，说明不是无人建房。
核验该实例 rooms/matches/humans/spectators 全为 0 后经原本机 service API 重启，新 PID 63848，
同输入及 anyDifficulty true 均成功；PREVIEW_INSTANCE.json 已更新，不操作 3000。

续版前完整快照 PRE_ANY_DIFFICULTY.tar / PRE_ANY_DIFFICULTY_HASHES.json 保留原字节。
继续复用四份事务角色，追加本轮证据；未提交/推送，完整验证以 VERIFICATION.txt 为准。

## 12. 合并主线（2026-10-27）

用户已授权合并 main。续版功能提交 bfe14ae8，合入主线前基准 06dd81aa；两份追加型设计/历史
文档冲突保留双方内容，主线标题页及局内布局修复保留。合并前确认用户未提交的
docs/CONSOLE-NEXT-RELEASE-FIXES.md 保持原字节且不加入本次提交。最终提交、验证输出、
三态回滚及交付哈希追加至原 VERIFICATION.txt；此前各节未提交/未合并说法为当时历史状态。

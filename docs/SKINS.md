# 干员皮肤与预加载

本分支的可选外观扩展（2026-10-10 加入）。参考
[Paper-Yuan 的融合版本](https://github.com/Paper-Yuan/Stronghold-Protocol/releases/tag/v0.2.1-fusion)
与 [AoyamaT1 的 PR #85](https://github.com/sganggs/Stronghold-Protocol/pull/85)。
借鉴皮肤目录与选择方式；官方角色和皮肤美术的权利仍属于原权利人，项目保持非商业使用。

## 安装

完成正常的游戏数据与默认资源安装后执行：

```powershell
node tools/install-skins.mjs --all
# 直连较慢或失败时，使用现有公开镜像：
node tools/install-skins.mjs --all --asset-source=mirror
# 指定皮肤，PowerShell 下给含 # 的 id 加引号：
node tools/install-skins.mjs 'char_498_inside@kitchen#2'
# 使用已下载资源重新解析，不联网：
node tools/install-skins.mjs --all --offline
```

支持基础下载器的 `--asset-source=direct|mirror` 和 `SP_ASSET_SOURCE`。
完成后重启服务、刷新客户端，使冻结的数据副本和素材清单重新加载。
目录来自 `docs/research/operator-skins.json`（原始映射版本见文件的 source），由
`tools/build-data.mjs` 生成 `data/skins.json`，限定当前棋子和自选干员。当前目录 115 名干员、174 套皮肤。
资源在忽略的 `public/assets/` 中；选择器仅开放素材清单中已有头像和有效正面模型的皮肤。
失败项会报告，成功项保留，重新执行会利用下载缓存补齐。

安装器复用 `Downloader`、`processModels` 和 `resolveTemplate`，下载头像、正面和可用背面的
骨架 / 图集 / 所有纹理页，解析每套皮肤自己的动画、命中事件与边界。
缺失纹理页、无法解析的骨架、图集缺少附件时不安装该模型。
成功条目原子写入 `data/assets.json.chars[charId].skins[skinId]`；全部失败不改清单。
`tools/fetch-assets.mjs` 重建基础资源时也会重建已安装皮肤。
客户端没有下载或改写服务器资源的 WebSocket 接口。

## 选择和同步

在「干员调配」右侧详情，或「自选编队」的干员选择面板中选择皮肤 / 默认。
选择存于 `sp.pref.skins`，普通、精锐、自选棋子按同一 `charId` 共用，支持调配文件导入 / 导出。
旧文件没有 `skins` 字段时保留当前选择。「全部恢复默认」清除未锁定干员的皮肤偏好，锁定干员保持原样。
读取偏好和准备同步时复用协议的角色 / 皮肤 ID 格式校验：非法单项不影响其他干员同步；合法但尚未安装或暂时关闭的插件选择保留。同步准备不会改写浏览器存储。
调配页顶部的「随机装备皮肤」按「随机设置」选择的范围操作：全部干员、已装扮皮肤的干员、未装扮皮肤的干员。默认范围为全部；按当前可用的实际皮肤判断是否已装扮。随机只覆盖范围内且未锁定的干员，未安装或没有可用非默认皮肤的条目不删除原偏好，不抽取默认外观。再次点击可以抽到当前皮肤。

每名干员的皮肤栏新增「锁定皮肤」；锁定跨四个版本共用，保护随机和批量恢复默认，但不阻止玩家手动选择皮肤、单人恢复默认或明确导入。也可锁定默认外观，使该干员始终跳过批量随机。

「每局自动随机皮肤」默认关闭。开启后从下一局开局阶段按同一随机范围抽取一次，跳过锁定干员；当前对局途中开启不立即重抽。实际选择继续通过 room.skins 同步，刷新、重连、回档与每回合开始不触发新抽取。随机范围、自动开关和锁定表保存在 `sp.pref.skinRandom`；每局处理标记保存在 `sp.pref.skinRandom.matches`，保留最近 32 个标记。服务器 `m.public.matchId` 基于同盟与 battlePrefix 提供稳定身份，旧实例通过本地活跃局标记兼容，下一次正常启动后使用新身份。

`room.skins { skins: { [charId]: skinId } }` 使用重请求限流桶，最多 256 项。
结构检查拒绝跨角色 id、路径和非字符串；目录检查丢弃未知皮肤。
服务器在 session / room seat / PlayerState 中保留选择，并在 `m.public.players[].skins` 发布非空偏好。
换肤可在对局中生效；重连和观战使用角色所属玩家的选择，AI 使用默认，补位单位与召唤物保持原模型。
皮肤不进入 battleInput、BattleSpec、UnitInfo 或战斗哈希，不改变数值或金标结果。
未安装皮肤回退默认；模型加载失败走现有 fallback 链；无背面时使用皮肤正面。
现有独立技能特效、语音、召唤物和半身立绘保持原资源。

## 当前显示范围

皮肤用于整备区、作战区的战斗模型及模型加载失败时的头像显示，选择面板显示对应皮肤头像。
商店购买卡片、奖励卡片和干员详情仍使用默认半身立绘；这是当前功能边界，购买后会使用已选皮肤的战斗模型。
皮肤选择卡片与放大预览复用已安装的 `seat-art` 海报，安装器将对应文件解析为素材 URL；文件不存在时回退干员默认立绘。基础素材重建同样保留这一映射，不会把下载计划对象写进运行时素材清单。商店不使用这些皮肤海报，也不会用方形头像代替商店的纵向立绘。
核对 Paper-Yuan 的 `06cd3d0aafee6d9b1a3c542414fb847e16871a4d` 与上游 PR #85 的
`83dbfb84be46699617fd45440d9eae762d3f94f1` 后，两者的商店同样通过 `chessPortraitUrl` 显示默认立绘。

## 手动预加载

「设置」中的「素材预加载」读取已安装素材和可选本地提取清单。
可选择画面素材或包含音频的全部素材，显示进度、失败数，支持取消与再次运行。
仅请求本站静态文件，4 路并发，每项超时 30 秒，以 `force-cache` 下载并流式读取。
预加载不解析骨架、不占用模型缓存；浏览器 HTTP 缓存可能按自身容量策略清退资源。
未安装皮肤不在清单中，也不会通过预加载安装。

## 验证

```powershell
node --test test/skins.test.js test/ui/preload.test.js test/ui/loadout.test.js test/assets.test.js
$env:SP_E2E='1'; $env:CHROME_PATH='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
node --test test/ui/skins.e2e.test.js
node tools/i18n.mjs check --all --strict
npm run ci
npm run golden
```

2026-10-10 的本地验证记录：

- 安装 174/174 套皮肤，343/343 个模型解析成功。
- 核心皮肤、预加载、调配、打包、素材及文档定向检查：144 项通过、0 失败。
- 加入随机装备后，皮肤、调配和文档检查：62 项通过、0 失败；实际浏览器测试 1 项通过，
  覆盖随机按钮、保存与同步、桌面 / 手机横屏、正背面动画、战斗换肤和恢复默认。
- 文档整理后的同组核心定向复查：145 项通过、0 失败（包括新增随机装备测试）。
- 四个语言包严格检查：1193 个词条全部翻译，0 缺失、0 错误；启动、lint、导入边界和类型检查通过。
- 全部 296 个 golden 场景一致，没有重新生成金标。
- Node 24.19.0 全量测试当时为 6053 项、6036 通过、2 失败、15 跳过。打包样本数量已修复且单独检查通过；
  另一项是全量并发下的既有双人 Boss 性能阈值，单独复测通过（最佳 0.1196 ms/tick，阈值 0.5 ms）。
  修复后没有再次重跑整套测试，因此不将本次记录表述为全量 CI 全绿。
## 外观插件皮肤（上游 v0.3.1 规范）

本库安装器生成的皮肤条目与插件 overlay 共用下述选择、同步与渲染流程；已有目录与离线安装仍保留。

An operator's Spine model and its pictures can be replaced by one of its official alternative outfits (时装). This
document is the normative reference for that feature; the art itself is **never** downloaded or written by the server —
it comes from a **cosmetic plugin's overlay** (docs/PLUGINS.md §9), which the server's owner installs in `plugins/` and
each player switches on for themself.

> 上游 #652 被关闭的原因写在这里，因为它是这个设计的出发点：**服务器不提供安装通道**。当时的 `room.skin.install`
> 让任何已连接的客户端都能让服务器去网上下载文件并改写所有客户端共读的 `data/assets.json`，而随包发布的
> `data/skins-installed.json` 又会让更新校验对不上。本实现没有安装报文、不写 `data/` 下的任何文件、不随包发布任何
> 安装状态：皮肤属于插件，插件怎么落地是 `plugins/` 目录（安装、studio、ZIP）本来就有的问题。

## 插件数据：外观 overlay

```
plugins/<id>/plugin.json
  └── assets (or a .json file):  chars[<charId>].illust ……     the operator's own 立绘 (one picture)
                                 chars[<charId>].skins[<skinKey>] = { name, group, avatar, avatarE2,
                                                                      portrait, portraitE2, illust,
                                                                      spine: { front, back? } }
        │
        ├── the server checks the overlay (shared/plugins/visual.js, docs/PLUGINS.md §9) and serves it as a document:
        │   /vs/<vs16>/overlay.json — composed on the INSTALLATION's manifest, never on a copy of it
        │
        └── the browser composes it (public/js/cosmetics.js cosmetics.apply) on the manifest it already loaded
                 │
                 └── data.get('assets') — what every screen reads (public/js/data.js setView)
                          │
                          ├── chars[<charId>].skins[<skinKey>]  →  the picker's rows (public/js/ui/skins.js availableSkins)
                          └── chars[<charId>].skins[<skinKey>].spine  →  the model (public/js/assets.js spineEntry { skin })
```

Three properties are load-bearing:

- **A skin key is the KEY, and it is data.** It carries `@` `#` `+` `.` (`char_002_amiya@winter#1`), so it is **not** an
  `isId` (shared/protocol.js `isSkinId`). A plugin that has no official id for a skin may write the stem form
  (`char_102_texas_epoque_7`) [ASSUMED: docs/PLUGINS.md §9]. Whatever writes a skin and whatever wears it must agree on
  that exact string.
- **The choice is keyed by OPERATOR (charId), not by chess.** `chars[<charId>].skins` is the manifest's own grouping, so
  one entry covers an operator's normal piece, its elite (the merge) and a 自选 slot fielding it. The renderer agrees:
  a unit's skin resolves through `d.spine ?? d.charId ?? u.defId` (server/sim/snapshot.js), i.e. the charId.
  Every owner/scout board, hand, temp and battle input resolves the **effective body** with `PlayerState.fieldRecord`:
  a stand-in uses `backup.charId`, a 自选 slot its pick. Official source:
  `activity_table.activity.AUTOCHESS_SEASON.act2autochess.charShopChessDatas` `backupCharId` (for example
  `chess_char_3_01_a`: `char_103_angel` → `char_603_csnipe`). [ASSUMED] Skin choices follow that body too, so an original
  operator's selected outfit never dresses its stand-in; the official table specifies bodies, not this cosmetic UI.
- **A missing piece falls back; nothing is ever a placeholder.** `spineEntry(m, id, { skin })` draws the operator's own
  model when the skin (or its model) is not in the manifest; `avatarUrl` / `portraitUrl` / `illustUrl` fall back to the
  operator's own pictures. The picker shows the operator's portrait on a skin that ships none.

## Picture-only outfits (0.3.2, B6)

The maintainer's 2026-10-18 **option A** makes a `skins` record with pictures but no Spine wearable.
The picker labels it 「仅更换头像与立绘」. Its owner's avatars and portraits change, including loadout (the list
and the 卡片视图) / DIY, shop / reward cards, detail panels, bond members, thumbnails, settlement / result rows, combat metrics and the DOM fallback field.
Battle Spine keeps the effective operator's default Front / Back. Missing image fields independently use the
operator's existing normal / elite fallbacks; removing the plugin restores defaults without erasing the saved choice.
Model outfits retain their model resolution and picture fallbacks. A replacement directly on `chars[charId]`
without a `skins` entry still does not enable the picker.

Source: the official [skin_table.json](https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/excel/skin_table.json)
`charSkins` associates `skinId`, `charId`, `avatarId`, `portraitId`, `illustId` and `battleSkin` separately.
That table does not prescribe missing-plugin behavior; wearability and the note above are the maintainer's decision.
[ASSUMED] Any of `avatar`, `avatarE2`, `portrait`, `portraitE2`, `illust` counts as a picture; metadata alone does not.
An unfinished Spine map without Front uses both default views.
An E2-only picture is offered in the picker but only replaces elite art during play; the normal image falls back.
The existing portrait → illustration preference is retained; an illustration never substitutes for an in-game avatar.

[ASSUMED] Card images follow the same latest-public-choice rule as the renderer, including clears and the
「显示其他玩家的皮肤」 switch. A local picker reads the browser's choice; an explicit owner reads that seat's public
map, or its unit's skin when the seat is unavailable, never the viewer's map. Unowned catalogue/statistics art stays
unowned. `OperatorImage` subscribes to choices, visibility and the composed manifest, so open cards refresh on changes.
Effective stand-in / DIY bodies are resolved before that lookup, preserving §34.23 and #686.
The strategy draft's name cards (`screens/bandDraft.js` artOf: each doctor's 名片干员 art, as on the room's seat cards)
follow the seat cards' rule below (`seatCardSkin`), reading the match's `m.public.players[].skins` for the others.

## The waiting room's seat cards (0.3.2, the maintainer's decision 4 of 2026-10-21)

The 名片干员 portrait on a room seat card (`public/js/screens/room.js`, `public/js/ui/seatArt.js`) and on the strategy
draft's name cards (`public/js/screens/bandDraft.js`) wears the player's outfit for the operator it shows:

- **one's own card** wears this browser's choice (`skinsStore`) at once, before the server has it;
- **another doctor's card** wears the map that seat published. The lobby carries it as `room.state.seats[].skins`
  (`server/lobby.js Room.toState`; human seats with a non-empty map only, so a room without skins sends what it sent
  before) — the same public map a match publishes as `Match.publicView().players[].skins`, which the draft's name cards
  read. A changed map re-broadcasts `room.state` while the room waits (`Lobby.skins`; a resend of the same map does not);
  during a match the match carries it, and the `room.state` at its end;
- with **「显示其他玩家的皮肤」 off** the others' cards draw the default and one's own keeps its outfit;
- an outfit **this page does not have** (a teammate's appearance plugin this browser lacks, or switched off) draws the
  operator's own art — `chessPortraitUrl(m, chess, { skin })` falls back — never a placeholder; an outfit picture that
  **fails to load** falls back to the operator's default one on both (`seatArtSrc`; the draft's name cards since §35.51).

`ui/seatArt.js seatCardSkin` is that rule, on top of `ownerSkin`. The 名片干员 picker is one's own picker: its tiles wear
this browser's outfits, as 干员调配's roster does. [ASSUMED] The whole map rides in `room.state`, not one skinId per card:
a seat without a pick shows an operator its clients choose by player id (`seatOperator`), which the server does not
compute; the map is bounded like `m.public`'s (`SKIN_LIMITS.entries`, the room's operators).

## The switch model: the owner installs, each player switches on

| Who | What they do | Where it is stored |
|---|---|---|
| The server's owner | Drops the plugin folder into `plugins/` (the studio, a ZIP, or by hand), and switches it on for the **room** if they want a set everyone in that room sees | `plugins/`, a room's `vs` |
| A player | Switches a `scope: ["personal"]` cosmetic plugin on for **themself** — a skin of their own choosing | `sp.pref.cosmetics` (this browser only, never sent) |

A room's **host is not part of it**: an appearance a player wears comes from *their* browser's layers, so a plugin with
`scope: ["personal"]` never appears in the room's 插件 panel and no room setting can force a skin on anyone. Two players
of the same co-op match may therefore see different models for the same piece — see the switch below.

## 设置「显示其他玩家的皮肤」 (default on)

A pure client preference (`settings.otherSkins`, `sp.pref.settings`; **never sent**):

- **on** (the default) — a piece draws the appearance its owner chose, which the match published
  (`Match.publicView().players[].skins`, and `UnitInfo.skin` of every unit) — and a waiting room's seat card the one its
  player published there (`room.state.seats[].skins`, above);
- **off** — every other seat's piece draws the operator's own model and pictures; **this player's own pieces keep their skin**.

The asymmetry is deliberate and is what the setting is for: what you draw is your own choice, what others draw is theirs.
Turning it off hides *their* look from *you* and changes nothing on their screen (public/js/render/app.js `skinOf`). The
renderer decides who is "other" from `UnitInfo.ownerId` and the local `me.playerId`
(public/js/ui/fieldHost.js `setMe`) — never from the seat whose camera happens to be on screen.

[ASSUMED] Switching off retains the received skin ID separately (`sourceSkin`) and derives only the displayed `skin`.
Switching back on restores already loaded units immediately, including a boss partner's read-only prep pieces and
units received while hidden. `room.skins` remains valid in every phase: `Match.setSkins` marks the owner's private
view, which also refreshes existing prep scouts and the boss partner. `fieldHost` forwards public seat choices to
`view.setSkins(players)` on mount and when they change. The current battle's operators use that latest selection
(an omitted `skins` map clears it), even if later spawn metadata carries an older choice. This rebuilds appearance
only: it neither changes the running sim / BattleSpec nor restarts playback. Live refresh timing is a remake UI
choice, not a rule established by the official tables.

## The picker: two display rules

In 干员调配 (`screens/loadout.js Detail`) and in the 自选编队 picker's detail (`screens/diy.js DiyPickerView`), the 皮肤
section sits under the operator's name. 潜能与练度 immediately follows 皮肤 wherever cultivation is offered.
The order is 皮肤 → 潜能与练度 → 特质 → 技能 → 局内数值 → 模组 in 干员调配, and 皮肤 → 潜能与练度 → 技能 →
局内数值 → 模组 in 自选编队: the picker draws the roster's own sections in the roster's order (a prototype pick omits
cultivation, so 皮肤 is followed by its locked 技能 and 模组).
[ASSUMED] This is the existing remake panel order; official tables do not prescribe a skin picker layout.

1. **The section is GLOBAL: every operator shows it, or none does.** The one question `SkinSection` asks is
   `public/js/ui/skins.js hasAnySkinChoices()` — **at least one** operator of the composed manifest has one **wear-able**
   skin (`chars[<charId>].skins[<skinKey>]` with a model or at least one picture). While that is false — no plugin at all,
   a plugin that writes no skins records, or only metadata-only skins — nothing is drawn anywhere, header
   included: an installation without a cosmetic layer looks exactly as it did before this feature.
   While it is true, **every** operator shows the section, including one the plugins wrote no skin for. That operator
   gets the 默认 tile alone, a real picture on it and no empty art box, and the header's note reads `0 套外观`: the count
   is kept at zero on purpose, because the whole point of the global rule is that this box **means something** — "the
   plugin is on, this operator has no 时装". A section hidden per operator said nothing, and left the player unable to
   tell an operator without skins from a plugin that failed to load. This is the **reverse** of the rule this feature
   first shipped with (a per-operator `hasSkinChoices`: 默认 plus a wear-able skin of *that* operator, else no section),
   and it must not be turned back. `hasSkinChoices` remains the single-operator criterion — no production code calls it
   — and is what `hasAnySkinChoices` is counted from, so the two can never disagree about "wear-able".
   The gate counts **wear-able skin records**, including picture-only outfits: a plugin that writes only 立绘 (`chars[<charId>].illust`) and
   no skin turns the section on nowhere, and this picker then shows none of its pictures. That is deliberate — the
   section exists to choose a 时装 and its note counts 套外观, so one replaced 立绘 must not put a `0 套外观` box on every
   operator of the installation. A plugin whose 立绘 has to be seen has to give some operator a wear-able skin (then every
   operator's 默认 tile draws the 立绘 it has, per the rule below), or needs a surface of its own. Should the gate ever be
   meant to count a 立绘 as well, the one line that changes is the body of `hasAnySkinChoices`.
2. **A missing layer falls back to the operator's own art** — a skin with no `portrait` shows the operator's portrait
   (its `illust`, then the portrait), never a slash or a placeholder; the tile is dimmed (`.lo-skin--fallback`) so the
   replacement is legible. The enlarged preview (`.lo-skin-preview`, a `Modal`) shows the skin's 立绘.

The 默认 tile is the operator's **real** appearance, not an empty slot: it draws the operator's own 立绘
(`chars[<charId>].illust` — the picture an appearance plugin may write for an operator it gives no skin at all, and this
tile is the only place that picture is seen), else `chars[<charId>].portrait`, else its avatar. The 立绘 wins over the
portrait on purpose, for the same reason the section is global: what a plugin wrote for the operator has to be visible,
and the 1:2 tile crops to the top exactly as it already does for a skin that ships only an illust. It is never empty
while the record has any of the three; an operator the composed manifest does not hold at all (not even a 默认 tile
exists) gets no section rather than an empty grid.

## New files

| Path | What |
|---|---|
| `public/js/ui/skins.js` | The client store (`sp.pref.skins`, `{ [charId]: skinId }`, at most `SKIN_LIMITS.entries` pairs: `parseStoredSkins` is the one parse of a stored selection — the store's initial state, every edit and what the sync sends — so the wire's own limit is applied where the selection is read), `availableSkins` (the composed manifest's rows, with `playable` and with art already resolved and fallen back; the 默认 row exists for every operator the manifest holds, also one with no `skins`), `hasAnySkinChoices` (the section's global rule), `hasSkinChoices` (the single-operator criterion, kept for tests and future rules), `chosenSkin` (a stored entry that is not one of this operator's wear-able skins counts as 默认), `setSkin` / `clearSkin` |
| `public/js/ui/skinPicker.js` | The 皮肤 section itself: `SkinSection` (nothing while `hasAnySkinChoices` is false — for every operator alike; the 默认 tile alone for an operator without a skin), `SkinPreview` (the enlarged 立绘), the five-tile grid's markup |
| `test/skins.test.js` | The wire shape (`isSkinId` / `isSkinSelection`), the lobby → Match → PlayerState chain, the public view, reconnect, the sim's UnitInfo, the client's fallbacks, and the absence of the install channel |
| `test/lobby-skins.test.js` | `room.skins` over WebSocket: validation, session and seat storage, the seats handed to the Match, bots, the change made mid-match, `room.state.seats[].skins` (broadcast on a change while the room waits, not on a resend) |
| `test/ui/seat-art.test.js`, `test/ui/room-cards.e2e.test.js` | the seat cards' outfits: `seatCardSkin` (own / published / the switch / fallback) and, in the browser, both screens of a co-op room |
| `test/ui/skin-picker.test.js` | The picker's rules against a composed manifest: the rows, `playable`, the art fallbacks, the global `hasAnySkinChoices` and the per-operator `hasSkinChoices`, `chosenSkin`, and that the section's gate is the global one |
| `docs/SKINS.md` | This document |

## Edits to existing files

| File | Where | What |
|---|---|---|
| `shared/protocol.js` | before `isNotOwnedList` | `SKIN_LIMITS` (256 [ASSUMED]), `isSkinId` (**not** `isId`; the same character class as `isSkinKey`), `isCharId`, `isSkinSelection`, `operatorCharIds`, `checkSkinSelection` |
| `shared/protocol.js` | `C2S` | `'room.skins'` — and **no** `'room.skin.install'` |
| `server/net.js` | `HEAVY_TYPES`, `Session` ctor | `'room.skins'`; `session.skins` |
| `server/lobby.js` | after `freezeDiy`, `onMessage`, after `diy()`, `humanSeat`, `seatSettings`, `startMatch`, `Room.toState` | `freezeSkins` (charId + skinId, drop operators the room lacks; a bad map is BAD_MSG and does not clear), `case 'room.skins'`, `seats[].skins` in `room.state` (0.3.2 decision 4, broadcast by `skins()` when a waiting room's map changed), `skins()` — **no phase gate**, unlike the loadout — and the selection riding into the match |
| `server/match/PlayerState.js` | ctor | `this.skins = Object.freeze({})` + `setSkins(seat.skins)` |
| `server/match/player/basics.js` | after `setLoadout` | `skinCharIdOf` / `skinFor` / `setSkins` (bots refused; a bad map refused whole, unknown operators dropped) |
| `server/match/match/platform.js` | after `setLoadout` | `setSkins(playerId, skins)` — any phase, `markPrivate()` (owner, prep scouts, boss partner) and `markPublic()` |
| `server/match/match/views.js` | `publicView().players[]`, `_prepBoardUnits`, the scouted bench | `skins` (omitted when empty), and `skin` on every unit the player owns |
| `server/match/player/round.js` | `battleInput` | the unit's `skin`, from the player's own selection and the piece's operator (a 自选 slot follows its pick) |
| `server/match/player/views.js` | `pieceView` | `skin` on the prep board / hand / temp views |
| `server/sim/units.js`, `server/sim/battle/players.js`, `server/sim/snapshot.js` | `Unit`, `_createAllyFromInput` / `_makeAlly`, `unitInfo` | carried to the client; `skin: u.skin ?? undefined`, so a piece without one adds no key to the wire |
| `public/js/assets.js` | `portraitUrl` / `illustUrl` (new) / `spineEntry` / `hasBackSpine` / `unitPictureUrl` / `skinsOf` / `skinHasModel` | every helper takes `opts.skin` (the skinId) and falls back to the operator's own art |
| `public/js/render/units.js` | `_pictureUrl`, `_modelEntry`, `_wantsBack`, `_loadPicture` | `info.skin` reaches the Spine entry, the diamond and the Front/Back question; the picture's cache key carries the skinId |
| `public/js/render/app.js` | `otherSkins` setting, `ctx.myPlayerId`, `applyInfo`, `refreshSkins`, `setSettings`, `setMe`, `setSkins`, `pieceInfo` | received `sourceSkin` is retained while displayed `skin` follows the switch and latest public selection; a changed appearance drops the view; read-only prep pieces refresh too |
| `public/js/render/app/info.js` | `renderInfo` | `skin` |
| `public/js/ui/loadoutSync.js` | header, `installSkinsSync` | the fourth `installPrefSync` setting (`room.skins { skins }`) |
| `public/js/ui/seatArt.js`, `public/js/screens/room.js`, `public/js/screens/bandDraft.js` | `seatCardSkin`, the seat cards and the 名片干员 picker, the draft's name cards | the 名片干员 portrait wears its player's outfit (0.3.2 decision 4, above) |
| `public/js/main.js` | boot | `installSkinsSync({ net })` |
| `public/js/ui/settings.js` | `CosmeticSection` | the 显示其他玩家的皮肤 switch — with or without a cosmetic plugin |
| `public/js/ui/gameLogic/settings.js` | `DEFAULT_SETTINGS`, `sanitizeSettings` | `otherSkins: true` |
| `public/js/ui/fieldHost.js` | mount, store subscription, `OPTIONAL` | `view.setMe` and `view.setSkins` adopt and follow local identity / public seat choices; unmount removes the subscription |
| `public/css/screens/loadout.css` | end | `.lo-skins` / `.lo-skin*` tiles, `.lo-skin-preview` |
| `public/i18n/*.json` | — | the strings above, in every pack (`node tools/i18n.mjs check --all --strict`) |

## Invariants

- **No `cs`.** An appearance is never part of a room's content set: it changes nothing a battle does, so no battle
  identity moves for it (docs/PLUGINS.md §6).
- **No `server/sim/` rule.** The sim carries `skin` as opaque data (`Unit.skin` → `unitInfo().skin`); no rule reads it
  (`server/sim/units.js` stores it, `battle/players.js` copies it onto the ally, `snapshot.js` publishes it). The same
  seeded battle run with and without a skin returns the same `Battle.result()` (`test/skins.test.js`), and
  `test/golden/*.json` is unchanged. `skin` is listed with the sim fields in `docs/design/engine.md` §5.2 and
  `docs/SIM.md` §2 as display-only.
- **No `data/` write.** Nothing in this feature writes a data file; a plugin's own files are served from
  `plugins/<id>/` under `/p/<id>/<hash>/…` (docs/PLUGINS.md §9).
- **No game art in git.** As ever: skin art belongs to a plugin (or to a locally extracted client), never to this
  repository.
- **A bad map is refused whole.** `isSkinSelection` / `validateC2S` (`room.skins`), the lobby (`freezeSkins` / `skins()`)
  and `PlayerState.setSkins` all require a plain object, a charId key (`isCharId`: official `char_<digits>_<token>` or
  a plugin `char_x_…`, never a chess id) and a skinId value (`isSkinId`). An array, a null-prototype object, one bad
  key or value, or more than 256 entries [ASSUMED] is BAD_MSG and does **not** clear a choice already stored. A charId
  the room's content does not have (`operatorCharIds`: chess records, `backups.units`, `diy.ownedPool`,
  `diy.operators`) is dropped and the rest kept, so the stored map is at most that operator count. An unknown skinId
  of an operator the room does have still draws the default model (`spineEntry`).
- **The client never sends more than the wire accepts.** `SKIN_LIMITS.entries` (256 [ASSUMED]) is applied in
  `public/js/ui/skins.js parseStoredSkins`, the one place a stored selection is read — the store's initial state, every
  edit and the `room.skins` payload the sync prepares. The limit has to be honoured there because an over-long map is not
  trimmed entry by entry on the server: `isSkinSelection` refuses the WHOLE message (BAD_MSG), so nothing would be stored
  and the sync would sit in `error` (public/js/ui/loadoutSync.js `installPrefSync`) instead of saving the rest.
- **A tile never outgrows the panel it sits in.** `.lo-skins` is `repeat(5, minmax(0, 1fr))` (three columns below 900 px,
  where the detail panel is a whole phone width — or a narrow window — and tall enough for the 1:2 box), so a tile is a
  share of the detail panel and its size never moves with how many skins an operator has. The tile draws the appearance's
  1:2 portrait, and on a panel too short for that box it draws the same appearance's 1:1 `avatar` instead —
  `@media (max-width: 1000px) and (max-height: 520px)` at the end of the picker's block in
  `public/css/screens/loadout.css`. That query is a phone in landscape: its detail panel is 193–263 px tall (measured
  740×360 … 932×430) while the 1:2 tile is 264–379 px there, which made 皮肤 the ONE section of that panel a phone could
  not see whole (潜能与练度 / 技能 / 局内数值 / 模组 are 135–163 px in the same panel). Both images of a tile are in the DOM
  (`public/js/ui/skinPicker.js`, `availableSkins().avatar`) and CSS alone decides, so no resize listener and no re-render;
  273/273 of the installed skins ship an `avatar` of their own (measured), and a row whose manifest has none keeps its
  portrait on every screen. A 1:2 box is still what every wider panel draws, with `min-height: max(1.5rem, 130px)` as
  the floor of a narrow one. Portrait is not a case to solve: a portrait phone is covered by 「请将设备横屏」
  (`public/index.html .rotate-hint`, shown by `public/css/theme.css`
  `@media (orientation: portrait) and (max-width: 1024px) { .sp-rotatable .rotate-hint { display: grid } }` for the
  `sp-rotatable` that `public/js/ui/device.js` sets on a coarse pointer whose screen is not landscape).

## Known limitations

- **Bots always wear the default model** (`PlayerState.setSkins` refuses a bot, as `setLoadout` does).
- **The studio does not list skins.** It finds an operator, an enemy or an interface picture by its official name
  (`server/studio/targets.js`), so a skin key is copied from the installation's manifest or written in the stem form.
- **No skin effects and no operator voices** (a separate piece of work; docs/ASSETS.md).
- **A 自选 slot's own record has `charId: null`**, so it wears its **pick's** operator's skin — the slot has no body of
  its own. The picker offers the appearance while picking that operator, and the choice is kept per operator, so
  changing the slot's operator changes the appearance with it.

## 分项备份与上游兼容

调配导出可选择皮肤装扮、随机范围／每局自动随机开关、锁定表，彼此独立，使用「本库格式（含扩展配置）」。导入只修改文件声明包含的部分。上游兼容格式仅携带上游支持的技能、模组、潜能、练度，禁用外观相关勾选；纯外观文件无法让未实现相应功能的上游接收。兼容范围及覆盖规则见 LOCAL-DEV.md 的分项调配导出说明。

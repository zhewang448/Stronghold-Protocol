# v0.3.3 引入决策核对表

固定目标 f07b8965061bbc311ad7aa815879b09264a1e47d。上游文档共有113个0.3.2章节和3个0.3.3热修章节。战斗修复在玩家摘要中合并为一类，下面保留章节索引便于核查；审查与验证章节不是独立功能。

| 章节 | 上游变更 | 本分支处理 | 边界 |
| --- | --- | --- | --- |
| 35.1 | Settlement headings, button art and equipment slots (#745) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.2 | Minimum-Python parsing guard for the local extractor (#744) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.3 | Optional selected-unit bond timers (#746) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.4 | Picture-only outfits (B6) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.5 | Re-entrant buff removal | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.6 | Strategy-draft match information (#484, PR #561) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.7 | AI strategy extension interface (#673, @HankDUMPLINGZhong) | 已引入 | 策略扩展接口已运行，默认仍legacy；ioleta/adaptive等额外策略显式启用 |
| 35.8 | External AI strategy (maintainer request 2026-10-19) | 暂缓启用 | 开发源码保留溯源；运行禁用标记与发布排除生效 |
| 35.9 | External AI advisor and knowledge | 暂缓启用 | 开发源码保留溯源；运行禁用标记与发布排除生效 |
| 35.10 | Wild Mane S2 rear push (#782) | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.11 | Committed example LLM plans | 暂缓启用 | 开发源码保留溯源；运行禁用标记与发布排除生效 |
| 35.12 | Regenerable advisor strategy playbook | 暂缓启用 | 开发源码保留溯源；运行禁用标记与发布排除生效 |
| 35.13 | Advisor economy floors and expiring funds | 暂缓启用 | 开发源码保留溯源；运行禁用标记与发布排除生效 |
| 35.14 | Advisor execution fidelity | 暂缓启用 | 开发源码保留溯源；运行禁用标记与发布排除生效 |
| 35.15 | Advisor input for skilled play | 暂缓启用 | 开发源码保留溯源；运行禁用标记与发布排除生效 |
| 35.16 | Finished battle visuals (PR #821, @Eimyy) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.17 | Simplified-board recovery after load timeouts (PR #664, @2994432392) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.18 | Event UI splits #811–#814, #827, #828 (@isomerpoi) | 合并能力并适配本地布局 | 保留Hub、先选难度建房和现有皮肤/社交/20席结构 |
| 35.19 | Quintus's tide takes the attack's turn (maintainer recordings 2026-10-22) | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.20 | Verified skill attack clips | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.21 | Tulip's S2 candidate remains unimplemented | 不引入未实现候选 | 上游也因身份来源不符未实现郁金香S2 |
| 35.22 | Official versions groundwork (M0) | 已接入，历史版本显式启用 | 默认第二期下半；SP_VERSIONS=all开放预览；本地联动仅默认版 |
| 35.23 | Official versions: the version switch (M1) | 已接入，历史版本显式启用 | 默认第二期下半；SP_VERSIONS=all开放预览；本地联动仅默认版 |
| 35.24 | Strategy grants at the prep start (#851) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.25 | Script probe ceiling in the executor tests (#847) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.26 | One 鸭爵 draw per round (#839) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.27 | Hidden Core pairs drawn anew (#845) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.28 | 新约能天使's 火力电台 by the PRTS notes | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.29 | The other leaders' attack-class skills take the attack's turn | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.30 | Settlement penetration order (PRs #796 and #798, @Siornya) | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.31 | Q / X prefer the selected operator, otherwise use hover (PR #859, @FelixSion28) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.32 | Ordered settlement pipeline and dependent consumers (PR #802, @Siornya) | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.33 | Source-stage operator consumers (PR #844, @Siornya) | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.34 | 碎铳之簧: defence, modifier transfer and erosion (PR #855, @Siornya) | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.35 | Settlement contract and the series' verification (PR #856, @Siornya) | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.36 | Open operator lists follow the room's content (PR #852, @Xinglan233) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.37 | Imported-art index updates serialised across tabs (PR #853, @Xinglan233) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.38 | Skill-mode sounds from plain mode banks (PR #848, @Convey123) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.39 | 蕾缪安 S3's crosshair held until its shell lands (PR #862, @evenifyouforget) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.40 | zipFolder reports the failing tool (#840, PR #841, @zasx77771) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.41 | Any seated player can start or cancel 重刷本局 (#854, #858, PR #860, @zasx77771) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.42 | A t() msgid must be a literal (#849, PR #850, @zasx77771) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.43 | 界面大小 in 异形屏适配 (#837, PR #838 reworked, @zasx77771) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.44 | Merge review of the PR batch (2026-10-23) | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.45 | Second review of the PR batch (2026-10-23) | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.46 | Third review of the PR batch (2026-10-23) | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.47 | Fourth review of the PR batch (2026-10-23) | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.48 | Enemy skill clips by the official ability (§35.19 leftover) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.49 | Literal msgids at the two computed t() sites (#849) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.50 | 自选 operators granted a bond by 变形同构体 (#846) | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.51 | §35.18's UI leftovers | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.52 | The bounty leaders' and normal enemies' attack-class skills take the attack's turn | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.53 | The operators' 「进入休整期时」 traits at the prep start | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.54 | Long clips hold the next attack; “自在”'s 破桎而出 waits for a swing | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.55 | 昆图斯's 断裂生殖 / 物种爆发 take the attack's turn | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.56 | The draft header by text size; 确认本局信息 and the 机变 overlay on phones | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.57 | Attack-turn casts play their clip | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.58 | Browser regression checks after the 0.3.2 merges | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.59 | A resumed match leaves the data-loading screen | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.60 | Full simulation descriptions in narrow desktop windows | 合并能力并适配本地布局 | 保留Hub、先选难度建房和现有皮肤/社交/20席结构 |
| 35.61 | Room-card browser checks wait for the synchronized selection | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.62 | 终极 (ABYSS) with LLM-played seats and bots, cycle 1 | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.63 | 终极 (ABYSS) with LLM-played seats and bots, cycle 2 | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.64 | Boss-round layout rehearsal (bots, #315) | 已引入 | 沿用上游legacy首领布阵排练；Worker线程池与浏览器分担另行显式启用 |
| 35.65 | CI: research-text paths and the golden list on a POSIX pipe | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.66 | The LLM integration stays out of the release | 已引入 | 沿用上游外部LLM发布排除门禁，并在当前候选默认禁用 |
| 35.67 | Golden corpus counts from the tool (PR #581, @Xinglan233) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.68 | Independent full golden CI job (PR #586, @Xinglan233) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.69 | Gates remain visible across field halves (PR #595, @xcdoge) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.70 | Configurable shutdown deadline (PR #775, @kanomahoro1224) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.71 | Chunked connection heartbeats (PR #784, @kanomahoro1224) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.72 | Optional online session cap (PR #760, @kanomahoro1224) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.73 | Last completed battle metrics (PR #820, @zasx77771) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.74 | Four-star Theresa mote display (PR #576, @Convey123) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.75 | Replay every fuzz group by seed (PR #579, @Xinglan233) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.76 | Whole-row loadout and DIY selection (PR #610, @Flotiarenor) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.77 | Scrollable current bond strip (PR #678, @resilenceljp) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.78 | Explicit extraction aliases (PR #708, @DuolaCCCCat) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.79 | Context-preserving WebSocket compression (PR #721, @mxdyzmx) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.80 | Owned vanilla data reuse (PR #722, @mxdyzmx) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.81 | Tick scratch preserves all version corpora (PR #723, @mxdyzmx) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.82 | Simulation interval reaches the first attack clip (PR #729, @Seals-awa) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.83 | Optional bot strategies (PR #742, @Lidong1793) | 已接入，默认不开启 | 保留legacy；线程池、额外策略、采样按配置显式开启 |
| 35.84 | SilverAsh S3 air targeting (PR #749, @Misyra) | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.85 | Opt-in pool and loop sampler (PR #750, @kanomahoro1224) | 已接入，默认不开启 | 保留legacy；线程池、额外策略、采样按配置显式开启 |
| 35.86 | Connect the rehearsal worker pool (PR #756, @kanomahoro1224) | 已接入，默认不开启 | 保留legacy；线程池、额外策略、采样按配置显式开启 |
| 35.87 | Document the connected rehearsal pool (PR #763, @kanomahoro1224) | 已接入，默认不开启 | 保留legacy；线程池、额外策略、采样按配置显式开启 |
| 35.88 | Deployment capacity and independent grace clocks (PR #762, @kanomahoro1224) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.89 | Negotiated public-state deltas (PR #772, @kanomahoro1224) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.90 | Front fallback for missing back skill clips (PR #786, @xcdoge) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.91 | Blemishine S3 range activation (PR #789, @DuolaCCCCat) | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.92 | Combat and optional fullscreen wake lock (PR #790, @RainoutOvO) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.93 | Outside presses respect detail-card origins (PR #792, @3underscoreN) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.94 | Settlement next-button face crop (PR #800, @Flotiarenor) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.95 | Parasite attachment blinks to the blocker tile (PR #803, @YinqiMargatroid) | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.96 | Optional lossless PNG effect textures (PR #806, @Stronghold-Protocol-agent) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.97 | Deterministic CI shard weights (PR #835, @zasx77771) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.98 | Wire eight CI shards and keep local CI full (PR #836, @zasx77771) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.99 | Per-instance fixed room codes without premature removal (PR #863, @1nsaneeee) | 合并能力并适配本地布局 | 保留Hub、先选难度建房和现有皮肤/社交/20席结构 |
| 35.100 | Default-off spectator AI takeover (PR #691, @resilenceljp) | 暂缓默认开放 | 服务端SP_AI_TAKEOVER=1显式允许；默认拒绝启用请求 |
| 35.101 | Last attack interval in a batched event frame (PR #729 follow-up) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.102 | Local CI guard dispatcher (PR #836 follow-up) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.103 | Second PR batch final verification (#775 / #836) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.104 | setup --game accepts an install directory (#572) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.105 | One simulation Worker per plugin content set (#864) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.106 | 信仰搅拌机 S3 is planned on its two-side range (#31) | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.107 | 血珀 loses 10% max HP per second (#720) | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.108 | 心虚设计师 faces its blocker while blocked (#869) | 已引入：战斗与规则修复 | 统一归入战斗修复；详见上游章节及golden迁移表 |
| 35.109 | 历史版本的官方资源并集与本地补提取 | 已接入，历史版本显式启用 | 默认第二期下半；SP_VERSIONS=all开放预览；本地联动仅默认版 |
| 35.110 | 测试版前的三项浏览器回归（#746 / #792 / #678） | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.111 | 版本胶囊与难度胶囊等高（fix53） | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.112 | S.W.E.E.P. 等待所选版本的校验结果（fix53） | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 35.113 | S.W.E.E.P. 内容不再等待入场动画（fix53b） | 已引入 | 保留上游修复/工具/测试和文档，兼容本地扩展 |
| 36.1 | 第一期商店装备核查与空栏显示（round53 shopequip，2026-10-25） | 已引入 | 装备空栏与官方开放等级 |
| 36.2 | 满休整区互换回归（round53 benchswap，2026-10-25） | 已引入 | 满整备区互换；保留上游注明的第一期便利偏差 |
| 36.3 | 跨版本装备贴图与渲染查表缓存（round53 iconcache，2026-10-25） | 已引入 | 按实际图片地址缓存装备图标，跨版本查表更新 |

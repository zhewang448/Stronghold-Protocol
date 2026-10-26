# Hub UI 移植验收（v0.2.6-extended.5）

> 历史阶段记录：2026-10-26 的 #12 已另行实现公开房间目录及私密开关；当前约定见 [公开房间大厅](PUBLIC-ROOM-LOBBY.md)。匹配队列仍未实现。

本次按维护者交接文档在 `codex/ui-hub` 实施，基于本库 `main` 的 `4f991cb9`。没有 merge / cherry-pick UI 来源分支；本次 UI 作为 v0.2.6-extended.5 独立发布，再另行合并上游 v0.3.0；游戏规则、生成的官方数据、确定性模拟与 golden 文件不变。

## 来源与文件分类

第一阶段来源为 isomerpoi（雨千代chiyo）`ui-redesign-upstream` 提交 `b2bd17afa91783e5be05262fb9acd03a2cd4737b`（基于 `488db49f`），按 50 个文件移植。第二阶段来源为参考站点公开分发的 JS / CSS，抓取日期 2026-10-15，原作者不明。致谢见 [NOTICE.md](../NOTICE.md)。具体文件逐项登记在 [LOCAL-DEV.md 第 2 节](LOCAL-DEV.md)。

| 处理 | 范围 |
|---|---|
| 初始直接移入 | 交接 3.1 的新结算、S.W.E.E.P、Hub 背景、音乐、阶段动效、席位图等组件；3.2 的本机账号与能力垫片；3.3 的无本地修改 CSS / HUD / 等待室组件 |
| 手合 | 大厅和自定义密钥、调配和真实皮肤、战场和聊天 / 标点、渲染换皮 / 暂停重绘、联动 FORMS、音频标点、设置预载。后续在直接移入文件中继续接入第二阶段功能及兼容修复 |
| 保留真实实现 | `ui/skins.js`、`ui/skinPicker.js`、聊天、标点、回放倍速、观战、主机控制台、更新记录及六键自定义；没有用兼容垫片替代这些能力 |
| 第二阶段适配 | 预选盟约、CSS 细调、帧率、12 页表情、只读作战统计、定时全站公告、同源资源管理、协商式状态增量。服务端缺失的协议按前端真实格式实现并验证 |

界面以参考 UI 为基础保留本库功能，不加入匹配队列、无限火力、公开房间列表、好友、私密房间、名片同步、玩家开发者控制台、赞助二维码或站点自己的聊天和皮肤服务。入口按本库真实协议能力隐藏。

## 第二阶段实现边界

- 预选只接受八个核心盟约，保存会话 / 席位 / 公共玩家状态；`guard` / `markPublic` 广播，重连恢复，回档保留当前偏好。它不影响卡池、层数、BattleSpec 或结算。
- 帧率不限 / 30 / 60 / 120 只设置渲染 ticker 和预算。保留本库 R / F / D / Q / X / Space 的默认键、绑定、冲突交换、Esc 取消和恢复默认，没有替换为站点额外快捷键集合。
- 官方 36 张表情清单保持逐字节一致。按用户答复下载六套社区图，共 36 张 PNG / GIF、2,603,782 字节，只在本机 ignored `public/assets/local/emoticon/`。运行时同源；新机器需要自行准备这些图，Git 不含图片。
- 作战统计读取本机战斗事件，合并召唤物，统计实际伤害和有效治疗；不写回 Battle。只记录自己浏览器运行过的战斗，刷新后重新累计，不代表服务器完整审计。
- 全站公告只经认证的 127.0.0.1 控制台发布 / 撤下，按服务器绝对时间生效和过期，重启不保留；替换旧房间聊天公告，保留聊天清空、禁言和踢出。
- 资源清单覆盖本机全部已安装画面、皮肤、场景、字体和 GIF；音频可选。安全上下文使用 Cache Storage + 仅资源 SW、哈希匹配、音频 Range 和 ZIP 校验。普通局域网 HTTP 保留旧预热功能；vendor 继续 HTTP 预热，不缓存可执行代码。原生 ZIP32 适配不引入依赖，不支持 ZIP64 / 加密档。详见 [ASSETS.md](ASSETS.md)。
- 增量仅对协商 `stateDelta: 1` 的连接编码 `m.state`，旧客户端照常收到原始公共 / 私有帧。解码视图保持相同；私有状态独立按连接发送，观战不接收。`guard` / `flush`、权威状态、回档和回放格式保持原语义。详见 [design/network.md](design/network.md)。

## 测试适配与证据

原浏览器测试用 `Client.createSimulation()` / `openJoin()` 适配 Hub 多步创建和密钥加入；等待室、调配、结算等旧 DOM 选择器改成实际新结构，补充异步加载和关闭动画等待。未删除原有业务断言。

表情测试把圆点分页断言换为数字页码，保留滑动 / 滚轮 / 方向键 / 冷却 / 过期；缺图用例固定官方主题，避免依赖本机社区素材。mock 气泡在网络空闲后重新触发，避免截图等待吃掉 3 秒展示期。快捷键 / mock / coop 的设置入口用明确的 `settings-btn`，避免点击与设置共用样式的作战统计按钮。

皮肤测试继续验证随机、同步、导入导出、真实前后模型与移动布局；其中取消预热步骤显式模拟不安全 HTTP 上下文，覆盖保留的旧回退。新增资源浏览器测试用两条小清单验证真实 SW、离线哈希 / Range 和 ZIP 往返，避免测试下载整个素材库。控制台公告测试改验全站定时公告、文本转义和重连，不再要求公告进入聊天历史。

新增专项：`test/bond-plan.test.js`、`announcements.test.js`、`state-delta.test.js`、`ui/combat-metrics.test.js`、`ui/resources.test.js` 与 `resources.e2e.test.js`。验证协议合法性、广播、重连、回档、隔离、只读结果、失败下载、取消、ZIP 损坏和缓存版本。

最终测试摘要登记在 [LOCAL-CHANGELOG.md](LOCAL-CHANGELOG.md)。本机原始输出全部保存在 ignored `.cache/ui-hub-port/`，失败日志保留，定向修复后另存新日志，不覆盖原始失败证据。

第二阶段全量的原始摘要如下（唯一一份全量，并发 4）；9 项失败已经修正并定向复核，未重写此摘要为全量零失败：

```text
# tests 6734
# suites 449
# pass 6704
# fail 9
# cancelled 0
# skipped 21
# duration_ms 421700.3367
```

用户随后授权正式发布，发布前重新运行完整测试：6,734 项，6,713 通过、21 跳过、0 失败，耗时 413,385 ms。发布日志为 `.cache/release-ui-hub/release-all.log`；setup / smoke / lint / imports / typecheck 与完整素材打包预检通过。它是新的发布验收，不替换上方历史失败记录。

失败原因：hello 深比较增加 `stateDelta: 1`、两个席位深比较增加 `bondPlan: null`、三个重连顺序预期增加独立全站公告、渲染默认值和保存设置预期增加帧率 / 预载；真正的打包漏项为 `PLAYER_TOOLS` 未列 `tools/build-resource-manifest.mjs`，已补入并验证源码依赖完整。所有受影响文件 582 项经定向复核通过：首轮 581 项通过、1 项打包源码因测试夹具覆盖外部临时索引失败，随后重新建立隔离索引仅跑真实源码检查 1 项通过，再无外部索引跑打包夹具 12 项全部通过。用户真实暂存区不变。这两份原始失败日志均保留。

浏览器主回归 38 项中 36 项通过，快捷键 2 项设置选择器修复后全部通过。最终 298 个 golden 一致；完整局至结算、帧率、离线资源与 ZIP 浏览器检查通过；四语言各 1,741 条、文档含版本检查 34 项、setup / smoke / lint / imports / typecheck 通过。lint 为 159 条警告、0 错误；导入检查三项既有 nodeData.js Node 导入提示仍在，退出成功。

| 日志 | 内容 |
|---|---|
| `all-stage1.log` | 第一阶段全量原始输出（3 项失败，后续已分别修复并验证） |
| `final-all.log` | 第二阶段最终单份全量，Node 24.19，并发 4 |
| `final-regressions-fixed.log` | 全量 9 项修复后的定向 582 项输出；581 通过，打包源码受外部临时索引污染 1 项失败 |
| `final-package-source.log` / `final-package-fixtures.log` | 分离真实源码索引与临时夹具后，打包 13 项全部通过 |
| `final-browser.log` | 第二阶段主浏览器回归原始输出；设置入口误点造成快捷键 2 项失败，修复见独立日志 |
| `final-hotkeys.log` | 设置入口修复后的快捷键完整验证 |
| `final-preview.log` | 最终真实完整局、30 FPS 和作战统计预览，客户端报错检查 |
| `final-checks.log` | setup、启动 smoke、lint、imports、typecheck |
| `final-checks-after-fixes.log` | 全量修复后的 lint / imports / typecheck |
| `final-i18n.log` | 四语言严格检查，各 1,741 条 |
| `final-golden.log` | 最终 298 个 golden 场景比较 |
| `final-docs.log` / `final-docs-fixed.log` | 验收文档创建前路径失败原始输出，文档创建后 32 项全部通过 |
| `final-docs-complete.log` | 设计记录完成后，文档一致性 / 路径 / 版本 34 项全部通过 |
| `final-resources-contrast-stable.log` | 资源可读性修复后，真实缓存 / 离线 / ZIP 与稳定截图检查 |
| `state-delta-unit.log` | 增量及身份 11 项专项 |
| `resources-unit.log` / `resources-browser.log` | 资源单元与浏览器专项 |
| `design-detector.json` | 设计机械检查，无 findings |

第一阶段的 `merge-status.json` / `files.json`、来源 ZIP / 源码、下载哈希和 `shots/` 截图均在该本机目录。状态增量实现前有 `before-state-delta.patch` 与四文件快照；实现后差异在 `state-delta-only.patch`，用于单独审阅，不代表 Git 提交。

独立视觉验收记录在本机 `.impeccable/review/ui-hub/finish-review.md`：首次调配截图素材未完成，按 `recapture` 重截后进行完整十图审查；唯一 `fix` 项是资源管理说明和维护操作过暗，局部改用 `--text-lo` 后两张新图获 `resolved`，对比度约 5.12–5.89:1。最终 `ship` 是对这一修复项的评分，其余视觉范围沿用完整审查，不替代交互测试。只关停本任务创建的 3005 / 3105 预览进程，保留原有服务。

完成后的真实视觉 token、组件、缩放和响应式约束登记在 [UI-DESIGN.md](UI-DESIGN.md)，机器侧补充为 ignored `.impeccable/design.json`。玩法规则索引 `docs/DESIGN.md` 没有被替换为视觉设计文档。

## 与参考站点的已知差异

不提供本库没有服务器支持的云社交和匹配。结算保留本地统计，不发云端轮询；没有站点昵称审核、站点聊天、站点皮肤服务和玩家控制台。JS 按所选功能摘取，未整体覆盖站点整文件；CSS 沿用其视觉并为本库功能、浏览器兼容及手机可读性适配。

社区素材不会自动从作者 CDN 下载；缓存同源，清单来自当前机器安装库存。预载保留 HTTP 回退，是为了局域网地址不具备 SW 所需安全上下文。公告采用单条全站滚动提示与手动弹窗，没有赞助栏或站点自动弹窗集合。快捷键沿用本库完整六键实现，未搬额外站点操作。上述差异为保持本库功能和交接范围的适配，不改变游戏玩法。

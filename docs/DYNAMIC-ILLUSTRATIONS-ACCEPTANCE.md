# 动态立绘与三位新干员：交接增补验收（2026-11-05）

实施工作树：`C:\Users\34948\.codex\worktrees\dynamic-illustrations-new-operators\Stronghold-Protocol`；分支 `codex/dynamic-illustrations-new-operators`；原始基线 `cbeb8d2a8d34ba7f39a31b746b34d8398b2d8a0e`。
复用所有既有修改，未重置主目录、未发布、未合并。下方“此前阶段”保留原记录，本节与 [支持矩阵](DYNAMIC-ILLUSTRATIONS-SUPPORT.md) 是本次结果。

后续新增的客户端局外设置默认值/用户权限已另记 [客户端设置验收](CLIENT-PREFERENCES-ACCEPTANCE.md)，
沿用本工作树和四个事务角色；此处动态素材与既有打包结果保留为对应阶段的历史证据。

## 本次实现与证据边界

- 以实际官方皮肤表的 `dynIllustId` 作差集。47 套本库目录皮肤全部安装，另安装27套精二本体，共74项。
  此前41条404均是旧来源失败；本次从本机官方客户端取到对应资源。目录外27项官方动态外观逐项列在支持矩阵。
- 74项实际解析骨架版本、附件区域、atlas全部页、PMA和完整静态图，全部通过；其中JSON藏在.skel的4项按内容识别。
  原包SHA-256隔离路径，源atlas/原页/显示派生文件进入清单。原生相机范围与额外Spine轨保留。
- 实际浏览器逐项渲染所有暴露动作及47套已登记头像/半身裁切，74项通过，最后Spine引用0。
  调配卡片/列表/详情、自选、等待室及有可靠裁切的头像均复用原共享组件，未验证裁切的精二本体小图仍静态。
- 静态/动态预览共用50%–500%缩放，按钮、指针中心滚轮、双指中心缩放、拖动、键盘与完整适配；
  静态/动态、暂停和动作切换保留取景，换外观重置。放大同步提高动态渲染分辨率，单边上限4096。
  真实UI验证桌面1440×900、小屏640×360，触屏为Edge/CDP双点输入；实体手机未测。
- 客户端“动态立绘”开关默认开启，复用auto/static字段；旧false/static保持关闭，显式新字段优先于旧别名。
  实际关闭、刷新保留、开启、临时预览不改全局偏好通过；减少动画、离屏/后台与释放沿用共享生命周期测试。
- 六套原有动态皮肤全部补齐客户端完整静态图（2048–2552像素），不再把180×360肖像当大图。
  三人普通/精二大图进入正式规划，查看立绘能明确切普通/精二，塔露拉精二动态也可用。
- 异客脸部修复匹配本机附件名，生成独立edges atlas/PNG，修正2176个半透明边缘像素。
  原始纹理/骨架保持字节；旧Web来源及原页也保留。浏览器近景、Idle/Interact/Special/Start及不同缩放已检查。
- 新三人官方特效以既有UnityPy环境实际提取：9技能的开始/命中/地面/飞行效果均在真实浏览器显示。
  补齐kit飞行和tile/buff所需提取闭包，按所有者+flame隔离；落地、到期、撤退、切档与清场释放，缺素材回退。
  冻河S2官方记录无飞行主图形，保留命中特效并去掉程序连线。
- 固定官方08ba2aea音频输入新增51个银行、114条文本记录。CN/JP/RUS、攻击/技能共146个实际文件
  在浏览器AudioContext解码成功，EN/KR的6组选择准确回退中文；不虚构未提供的语种。
- 新增房间“允许重复选择策略”，默认关闭。房主开局前可改，变更清其他人准备并退出匹配，开局锁定。
  手选/随机/超时/AI预设统一规则；2/4/20人分组、子进程传参、旧存档默认、恢复、回放、结果与本机统计贯通。
  两个独立浏览器实际开启、同步、刷新重连并连续选同一策略通过；自定义对局标记并排除官方统计。

## 本次检查

定向实现与玩法检查（不是历史结果）：
```text
1..138
# tests 195
# suites 15
# pass 194
# fail 0
# cancelled 0
# skipped 1
# todo 0
# duration_ms 34334.7538
```

74项真实素材/生命周期/36组Node-浏览器-回放一致性：
```text
1..3
# tests 3
# suites 0
# pass 3
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 138520.3329
```

Golden（本次，303场景，不更新期望）：
```text
golden roster: 49 scenarios match
golden bonds: 46 scenarios match
golden fields: 22 scenarios match
golden matches: 21 scenarios match
golden standins: 10 scenarios match
golden diy: 155 scenarios match
ok · 132941 ms (jobs 4)
```

完整CI首轮：命令 `node tools/ci.mjs --keep-going`，exit 1。
11397 tests、11074 pass、4 fail、319 skipped。失败为新增音频池固定计数1项、
交接副本缺90张PNG导致board提取检查2项，以及性能1项。前三项已修复，原测试13通过/1跳过；
性能未降低阈值，原始基线同机最好0.611 ms/tick也超过原0.5阈值（修改树单独最好0.670）。

修正后完整CI：exit 1。
第二轮11398 tests、11077 pass、2 fail、319 skipped：性能最好0.517 ms/tick与工作台一次fetch超时。
两文件在资源/打包任务结束后单独复跑均通过：工作台8通过/1跳过，robustness35通过，性能最好0.2321 ms/tick。
完整运行本身仍记录exit1，不能用单独复跑替换；所有阈值、种子与测试集合未修改。
```text

▶ typecheck — tsc --noEmit --checkJs -p jsconfig.json

── ci summary ──
  ok    setup         1.1s
  FAIL  test        29m56s  exit 1
  ok    smoke         3.9s
  ok    guards       724ms
  ok    lint         23.8s
  ok    imports      218ms
  ok    typecheck     1.4s
FAILED: test
```

lint/import/typecheck已实际通过，0 lint errors（既有warnings保留）；四语言3193条全部翻译，0缺失/错误。
Impeccable机械检测结果为空数组。未降低已有性能、超时或联机种子要求。

## 安装、清理和包

- 独立物理副本普通离线刷新：exit 0，无丢记录（droppedEntries=0）。
- 删除异客显示派生页后离线补修：exit 0；执行`--offline --prune`：exit 0，删除1163个真实未引用文件，
  全部最终动态引用仍存在。主工作树没有运行prune。
- 从可移植完整源缓存，在空安装首次离线安装74项：exit 0，0失败/警告；没有cache的既有完整安装也能重建缺失派生页。
- 最终完整包2760686999字节、精简包34939826字节、素材包2523084406字节已生成；旧extended.6到当前增量包1.50GB已生成。
  包的来源检查、导入和运行记录保存在followup证据目录；打包不会发布。
  不能把首次“同版本做增量”被正确拒绝的exit1记为成功，随后使用实际旧extended.6基线。
- 打包检查漏依赖已补齐；数字账号误匹配粒子曲线已修正，仅跳过JSON数值，所有字符串、路径和二进制仍检查。
- 大包真实浏览器UI导入完成：43694接受、0拒绝、0失败、1个README跳过；资源网络阻断后异客动态仍ready，0页面错误。
  初次验证因索引未就绪而empty，随后按实际hash索引就绪导入；大包等待复用项目既有分段等待，未更改总时限。
- extended.6安装的隔离副本实际应用增量：7562个受控文件校验通过，0缺失/不一致，启动`/healthz`为200。

## 剩余缺口与未验证

素材均可取得，不存在“404所以官方无素材”的结论。核心Spine与完整静态图已安装验证，但72项包含
独立Unity粒子/holder，当前只记录其数量，尚未把这些独立Unity效果重建到立绘UI；逐项见支持矩阵。
目录外27项未添加成新可选皮肤。实体手机/多种GPU未测；完整CI的两项并发/时序失败保留，单独复跑均通过。
这些限制使本次不能宣称“所有官方外观与完整客户端效果全量移植完成”。

## 地址与四个事务角色

原服务http://127.0.0.1:30299初始HTTP观测没有房间/对局，本次未发送停止或重启；交付前原30299/30399已不可达。
本次独立验证实例游戏http://127.0.0.1:50780、控制台http://127.0.0.1:50781，启动来源与pid见followup/instance.json。

- MODIFIED_FILE: `C:\Users\34948\.codex\worktrees\dynamic-illustrations-new-operators\Stronghold-Protocol\.cache\dynamic-illustrations-new-operators\transaction\MODIFIED_FILE`
- DIFF_FILE: `C:\Users\34948\.codex\worktrees\dynamic-illustrations-new-operators\Stronghold-Protocol\.cache\dynamic-illustrations-new-operators\transaction\DIFF_FILE.patch`
- VERIFICATION: `C:\Users\34948\.codex\worktrees\dynamic-illustrations-new-operators\Stronghold-Protocol\.cache\dynamic-illustrations-new-operators\transaction\VERIFICATION.txt`
- ROLLBACK: `C:\Users\34948\.codex\worktrees\dynamic-illustrations-new-operators\Stronghold-Protocol\.cache\dynamic-illustrations-new-operators\transaction\ROLLBACK.sh`

BASELINE：无共享stage/缩放，三人不可选，重复策略拒绝；MODIFIED：47皮肤+27精二、缩放可用、
三人各3形态且可选、重复策略开启后接受；ROLLBACK：对隔离副本执行自包含脚本，恢复原行为并逐文件核对2833个基线哈希。
最终patch重建、角色回读与撤销后的重应用已实际通过，结果见`followup/transaction-result.json`和VERIFICATION.txt。

---

## 此前阶段验收（原始历史记录）


实现分支：`codex/dynamic-illustrations-new-operators`；基线：`cbeb8d2a8d34ba7f39a31b746b34d8398b2d8a0e`。
实现及来源边界见 [实施说明](DYNAMIC-ILLUSTRATIONS-IMPLEMENTATION.md)。代码保留为可审阅的未提交改动。

## 实施结果

共享动态渲染、大图预览、自动/静态偏好、键盘单选、静态首屏、离屏/后台停止、缓存归还、上下文恢复、取景及图片插件来源校验均已接入。
调配卡片、列表、详情、自选、等待室、头像与实际结果卡使用同一资源身份；没有实际内容的名片兼容入口维持原状。
三位新干员均支持 5/6 阶自选普通/精锐、三技能、双天赋、职业特性；国度支持正式 AMB-X 模组。
普通/精二六张静态大图和六套正反面战斗骨架已验证；三位没有真实动态大立绘记录，继续使用静态大图。
没有移入额外盟约、队友死亡加层和同名施放互斥。

## 实测与回归

- 新干员定向技能/生产路径：36 项通过，含四位玩家共享真实战场的跨所有者护盾、治疗及一次性消费。
- 版本资格及单人、4 人、20 人部署、旋转、撤退、出售、回档、恢复、三人各自商店购买与三合一晋升、模组及库存返还：7 项通过。
- 三技能 × 两阶级 × 普通/精锐：36 组 BattleSpec 的 Node、浏览器、重放摘要一致；四朝向 12 组真实模型及技能动作可播放。
- 实际调配/预览：5 种语言 × 4 字号 × 4 分辨率的 80 组通过，另验证 75% 小字号列表；等待室两浏览器身份同步。
- 真实自选页面逐一选中塔露拉、国度、冻河，展示对应头像、技能与模组控件，截图及选择状态保存在本地证据目录。
- JSON 无 bounds、静态失败回退、快速切换、离屏、DPR、后台、实际 WebGL 丢失/恢复及最终引用为 0 已通过。Pixi 自动恢复在该测试中仅暂缓，以观察真实丢失状态。
- 发布流程：完整包、精简包、素材包已实际生成；增量更新/启动/导入链路通过现有夹具的往返检查。没有发布、合并或修改版本号。
- 四个既有版本的名单边界有回归；已有历史记录与插件字段继续兼容。

完整 CI 已执行；其中 4 项时间敏感检查未在该并发运行中通过（3 项连接超时、1 项完整联机测试达到 600 秒文件时限）。没有修改阈值或减少 20 个种子；其单独复跑结果如下。

```text
# tests 11335
# pass 11001
# fail 4
# skipped 329
# duration_ms 2220734.1294
# tests 28
# pass 28
# fail 0
# skipped 0
# duration_ms 1168.1556
```

连接相关两文件单独复跑：
```text
# tests 98
# pass 98
# fail 0
# skipped 0
# duration_ms 37894.2477
```

完整联机文件单独复跑：
```text
# tests 3
# pass 3
# fail 0
# skipped 0
# duration_ms 567861.4037
```

CI 其余 setup、smoke、guards、lint、imports、typecheck 的退出状态保存在原始日志；lint 为 0 errors，既有 warnings 不作为通过数量。

Golden 最终输出：
```text
golden roster: 49 scenarios match
golden bonds: 46 scenarios match
golden fields: 22 scenarios match
golden matches: 21 scenarios match
golden standins: 10 scenarios match
golden diy: 155 scenarios match
ok · 146712 ms (jobs 4)
```

旧 151 个自选场景的摘要完全保留，追加 `diy-152`、`diy-153`、`diy-154`、`diy-155` 覆盖三位角色的技能、形态及国度模组；其他五个 corpus 保持原结果。

## 同机性能

浏览器：Edg/156.0.4314.58；GPU：ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU (0x000028E0) Direct3D11 vs_5_0 ps_5_0, D3D11)；视口：1920×1080，DPR 1。使用同一夕「染尘烟」真实两页贴图，单视图 128×200 CSS px。

| 可见实例 | 共享绘制 FPS | 各视图 FPS 范围 | CPU 绘制 p50 / p95（ms） | 并发上下文 |
| --- | --- | --- | --- | --- |
| 1 | 26.4 | 26.4–26.4 | 1.7 / 2.9 | 1 |
| 4 | 26.7 | 26.7–26.7 | 4.0 / 5.4 | 1 |
| 12 | 26.2 | 26.2–26.2 | 10.9 / 18.2 | 1 |
| 40 | 26.7 | 7.2–7.6 | 9.0 / 18.5 | 1 |

40 视图时次要缩略图按每 12 个一组分批刷新；预览、本人席位与详情优先。表中共享绘制 FPS 不等于每张缩略图的 FPS。
40 视图中切换选中项的实测：选中图片 26.3 FPS，其余缩略图 7.6–7.6 FPS。
5 次完整挂载/卸载并回收后的 JS heap：13.4 → 13.5 MiB；没有持续增长；最后一个视图关闭后 renderer 回收。
实体手机未测试；小屏为浏览器触屏/视口仿真。

## 动态素材与确切缺口

47 条固定参考来源的本次 atlas 请求状态：{"200":6,"404":41}。实际安装并校验 6 套；失败不会删除旧条目。

| 外观 | 实际动作数 | 完整静态大图 |
| --- | --- | --- |
| char_1012_skadi2@boc#4 | 3 | 使用已验证肖像回退 |
| char_1014_nearl2@epoque#17 | 3 | 使用已验证肖像回退 |
| char_1023_ghost2@boc#6 | 3 | 使用已验证肖像回退 |
| char_2015_dusk@nian#7 | 3 | 有 |
| char_350_surtr@summer#9 | 3 | 使用已验证肖像回退 |
| char_472_pasngr@epoque#17 | 4 | 使用已验证肖像回退 |

其余 41 条逐项 URL/状态保存在 `.cache/dynamic-illustrations-new-operators/dynamic-source-availability.json`。参考登记不是远端可用性承诺。
完整包里既有未被素材导入清单引用的辅助资源由既有规则处理，素材包不会额外伪造来源；动态记录及三位新干员需要的文件均进入当前清单。

## 来源读取与事务

- [PRTS 塔露拉](https://prts.wiki/w/%E5%A1%94%E9%9C%B2%E6%8B%89)：2026-11-04T14:30:23.757Z，HTTP 200，SHA-256 da2c532366674535afe156117af87e17488e5c48b6cb6d2a203718e248dfe1f8。
- [PRTS 国度](https://prts.wiki/w/%E5%9B%BD%E5%BA%A6)：2026-11-04T14:30:23.850Z，HTTP 200，SHA-256 423f7c6fb9d7a166e55e550de1623149db99b3ac2ef1e5f1e1c7e7f828e79ae7。
- [PRTS 冻河](https://prts.wiki/w/%E5%86%BB%E6%B2%B3)：2026-11-04T14:30:23.852Z，HTTP 200，SHA-256 b7c2b06be1c33941d819004b135818a61e7163c7f8c54c9255e5fd6e69c4cd7d。

五张固定官方原表、下载素材及参考源码的原始哈希保存在本地证据目录。
四个事务角色位于 `.cache/dynamic-illustrations-new-operators/transaction/`：`MODIFIED_FILE/`、`DIFF_FILE.patch`、`VERIFICATION.txt`、可执行 `ROLLBACK.sh`。
对隔离副本执行同一行为命令：BASELINE 无共享 stage、三位均不可选；MODIFIED 有 stage、三位可选且各有 3 个培养形态；ROLLBACK 恢复 BASELINE，所有原始字节哈希一致；随后重应用补丁并保留实现。
补丁重建和回退的字节验证、完整命令/输入/stdout/stderr/退出码在 `VERIFICATION.txt`，未执行的场景不计为通过。

## 修改路径

```text
NOTICE.md
data/assets.json
data/backups.json
data/i18n/en.json
data/i18n/ja.json
data/i18n/ko.json
data/i18n/zh-TW.json
data/seat-art.json
docs/ASSETS.md
docs/DATA.md
docs/DYNAMIC-ILLUSTRATIONS-ACCEPTANCE.md
docs/DYNAMIC-ILLUSTRATIONS-IMPLEMENTATION.md
docs/I18N.md
docs/PLUGIN-API.md
docs/SIM.md
docs/SKINS.md
docs/design/client.md
docs/design/match.md
docs/history/0.3.3.md
docs/research/dynamic-illustrations.json
docs/research/new-operators-20261101.json
public/css/dynamic-art.css
public/i18n/en.json
public/i18n/ja.json
public/i18n/ko.json
public/i18n/zh-TW.json
public/js/assetPack.js
public/js/assets.js
public/js/render/fx/kinds.js
public/js/render/fx/projectiles.js
public/js/render/fx/simfx.js
public/js/render/fx/system.js
public/js/resources/common.js
public/js/screens/room.js
public/js/ui/accounts.js
public/js/ui/cardArt.js
public/js/ui/components.js
public/js/ui/dynamicFraming.js
public/js/ui/dynamicIllustration.js
public/js/ui/dynamicStage.js
public/js/ui/gameComponents.js
public/js/ui/gameLogic/settings.js
public/js/ui/preload.js
public/js/ui/radioGroup.js
public/js/ui/resultAvatar.js
public/js/ui/settings.js
public/js/ui/skinPicker.js
schemas/overlay.schema.json
server/http/assetViews.js
server/http/resourceManifest.js
server/plugins/officialUnitBuilder.js
server/sim/content/kits/index.js
server/sim/content/kits/ops/op-dminon.js
server/sim/content/kits/ops/op-oxi.js
server/sim/content/kits/ops/op-tocka.js
shared/plugins/surface.js
shared/plugins/visual.js
test/backups.test.js
test/content/op-oxi-match.test.js
test/content/op_dminon.test.js
test/content/op_oxi.test.js
test/content/op_tocka.test.js
test/data-versions.test.js
test/diy.test.js
test/golden/diy.json
test/i18n-data.test.js
test/match/new-operators.test.js
test/package.test.js
test/plugins/surface.stable.json
test/plugins/surface.test.js
test/render/fxproj.test.js
test/render/new-operators.e2e.test.js
test/seat-art.test.js
test/ui/asset-import.test.js
test/ui/dynamic-illustration.test.js
test/ui/dynamic-lifecycle.e2e.test.js
test/ui/skin-picker.test.js
test/version-assets.test.js
test/versions-keying.test.js
tools/assets/skel.mjs
tools/build-data.mjs
tools/build-i18n.mjs
tools/build-seat-art.mjs
tools/fetch-assets.mjs
tools/golden.mjs
tools/install-dynamic-illustrations.mjs
tools/install-new-operators.mjs
tools/install-skins.mjs
tools/package.mjs
tools/prepare-operator-extension.mjs
```

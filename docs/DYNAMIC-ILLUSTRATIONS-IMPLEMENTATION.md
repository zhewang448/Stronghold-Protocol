# 动态立绘与三位新干员

实现工作树：`codex/dynamic-illustrations-new-operators`。固定参考：Stardust-minus
`d03ae6e7b3ab4f6f816bb21bf0c45d7558210a76`（GPL-3.0-or-later）、Misyra
`146007cc71c2a360514277d97a20384869ad458e`。玩法数据来自官方镜像
`08ba2aea0e8dba88eff0ec0d2c87e24b4db626f8`，仅提取三位角色和必要技能、范围、模组引用。
完整验收日志和截图位于工作树 `.cache/dynamic-illustrations-new-operators/`。

## 2026-11-05 交接增补

下文保留前阶段设计；本次来源与支持范围以 [支持矩阵](DYNAMIC-ILLUSTRATIONS-SUPPORT.md) 和最新验收为准。
「三位无动态大立绘」已被本机客户端中的塔露拉精二资源纠正，不能沿用历史结论。

```powershell
# 使用已有 UnityPy 环境与实际客户端。骨架/原图不进入 Git。
python tools/local-extract/dynamic.py --game "实际客户端目录"
python tools/local-extract/dynamic.py --game "实际客户端目录" --metadata-only
python tools/local-extract/dynamic.py --game "实际客户端目录" --stills-only
node tools/install-dynamic-illustrations.mjs --all
node tools/prepare-operator-audio.mjs
node tools/install-new-operators.mjs
python tools/local-extract/extract.py --game "实际客户端目录" --only fx --fx-set used --fx-add-only
```

官方差集由 `tools/update-dynamic-catalogue.mjs <skin_table.json>` 生成，记录原表 SHA-256；不根据 URL 状态推断官方动态资格。
原生图集按所有页面导出，识别伪装在 `.skel` 中的 JSON，并复用 Spine 3.8 解析器；本机包的源哈希隔离资源路径。
完整静态图来自 `skinpack` / `chararts` 的命名高清纹理，合并独立 alpha；从不拿战斗小人替代立绘。
原生 `_cameraSize` 与 skeleton scale/transform 定义完整取景，`_extraTrackAnimations` 保留在独立轨。
独立 Unity 粒子/holder 的存在单列在支持矩阵，Spine 导出不伪称已经重建这些独立 Unity 特效。

`installationFiles` 包含离线重建所需源 atlas、原纹理和原有已验证副本，最终清单递归引用集合统一供大小、孤儿和打包使用。
`node tools/cache-dynamic-illustrations.mjs <目录>` 从已验证安装导出可搬移的完整源缓存，包含源 atlas、原图、
全部纹理页及静态前后景/头像，随后用 `node tools/install-dynamic-illustrations.mjs --all --offline --source-cache=<目录>`
首次离线安装；既有完整安装缺显示派生图时可直接从清单保留的源页重建，无需所有者的 `.cache`。
`fetch-assets` 只补修缺失动态依赖，保留失败条目的静态回退并报告失败。常规计划包含三人普通/精二大图，
固定音频输入只扩展三人，JP/CN/RUS 使用官方实际语种；EN/KR 回退中文，不伪造配音。
塔露拉飞行身份以「所有者、flame」隔离，落地、自然到期、撤退、特效档位切换和清场均释放；缺官方素材才使用程序效果。

「允许重复选择策略」默认关闭；`allowDuplicateBands` 贯通房间配置、模式子进程、恢复和结果。规则和统计边界见 META 与 design/match。

## 动态显示

`dynamicStage.js` 为嵌入图片共用一个 Pixi renderer，骨架实例独立、画面分页复制到各自的 2D canvas。
`DynamicIllustration` 大图按需创建单独 renderer，关闭释放；切回静态后空闲释放。第一帧成功之前及失败时保留静态图片。
`frames.portrait`、`frames.avatar` 必须是实际核验的骨架空间裁切；没有裁切记录时小图片保持静态，大图仍可完整预览。
JSON 和二进制骨架均通过同一个 Spine 缓存加载，身份包含骨架、atlas、所有纹理页、PMA、图层和外观身份。
没有 bounds 时先播放待机姿势再测量。动态层不接收鼠标或触摸事件。

| 入口 | 实现 |
| --- | --- |
| 干员调配卡片、列表、详情 | 统一通过 `OperatorImage` 使用当前外观及对应官方裁切；缺裁切保持静态 |
| 皮肤 → 查看立绘 | 完整预览、静态/动态、播放/暂停；动作列表从实际加载的骨架取得 |
| 等待室席位 | 使用现有 `card`/`cardSkin` 身份；官方图片的 `zoom/ox/oy` 与动态取景共用；上传图使用原独立来源 |
| 自选编队 | 复用同一个图片组件和皮肤预览；普通、精锐、技能、模组照常选择 |
| 玩家头像、本机账号、结果玩家卡 | 当前名片干员的外观有可验证头像裁切时播放；上传头像优先 |
| 名片背景 | 本库 `namecards.js` 当前没有实际内容入口，保留其现有兼容实现 |

设置「动态立绘」是本机的自动/静态选项；明确保存的关闭值保持关闭，不进入胜负协议。
新增单选组使用当前选择作为唯一 Tab 入口，方向键切换，Home/End 到首尾，跳过禁用项。
减少动态效果时自动嵌入图片保持静态，大图可由用户明确选择动态并播放。

工程默认值（[ASSUMED]，均非官方玩法）：桌面至多 30 FPS、粗指针至多 24 FPS，用户更低的 FPS 上限优先；
DPR 上限 1.5，超 GPU 页尺寸按比例缩小。隐藏页面停止调度，恢复时重置时间；离屏 64px 边界外释放实例。
暂停且无待重绘时不请求空帧，最后一个视图消失后空闲 5 秒释放 renderer。
实测 40 个真实夕立绘的全速更新超出帧预算，因此非优先缩略图按每组至多 12 个分批刷新，
优先预览、本人席位和详情图片；不关闭任何已就绪图片。相应性能记录保留初始结果与调整后的结果。

## 素材安装

```powershell
node tools/install-dynamic-illustrations.mjs 'char_2015_dusk@nian#7'
node tools/install-dynamic-illustrations.mjs --all
node tools/install-dynamic-illustrations.mjs 'char_2015_dusk@nian#7' --offline
node tools/install-new-operators.mjs
node tools/build-resource-manifest.mjs
```

`install-skins.mjs` 安装对应皮肤后也会尝试已登记的可选动态素材。47 套已有外观的参考动态来源记录在
`docs/research/dynamic-illustrations.json`；登记不代表当前远端一定可用。逐个核验骨架、atlas 全部纹理页、PNG、动画、
附件区域及静态回退后才原子写入 `data/assets.json`。失败保留之前成功条目，并写出 `.cache/dynamic-install.json`。
素材来源包括 PRTS 与 yuanyan3060/ArknightsGameResource；战斗骨架来自 fexli/ArknightsResource。
游戏素材仅写入忽略的 `public/assets/`，不进 Git。常规素材更新保留成功安装的动态记录。
资源清单将 `/assets/dynamic/` 分为可选「动态立绘」，由既有下载、导入、导出、分包链路处理。
完整包携带安装好的素材，精简包携带清单、注册表、安装器及依赖；离线缺失时保留静态回退。

夕「染尘烟」已取得两页真实动态贴图和三段实际动画。凛御银灰「雪覆伦城」的参考 atlas URL 在本次读取时返回 404；
此类来源保留静态。三位新干员在本次来源中均没有经核验的动态大立绘，使用普通/精二静态大图和动态战斗小人。

## 三位新干员

| 干员 | charId | 技能/天赋/职业 | 正式模组 | 版本与入口 |
| --- | --- | --- | --- | --- |
| 塔露拉 | `char_4247_oxi` | 三技能、双天赋、本源近卫；灼燃、怒火、足迹、反击、簇火 | 无 | 第二期下半，5/6 阶自选普通/精锐 |
| 国度 | `char_4246_dminon` | 三技能、双天赋、伏击客；范围、标记、撤退爆炸、扩散 | AMB-X「空瓶罐们」，按阶级使用 1/3 级 | 同上 |
| 冻河 | `char_4244_tocka` | 三技能、双天赋、游击手；触发型护盾、技力、治疗、攻速、转移 | 无 | 同上 |

普通和精锐共用三种官方培养形态：`2/1/4/0`、`2/60/7/1`、`2/60/7/3`，分别生成六档潜能差异。
不增加常规商店随机池，不扩展其他三版名单，不重复注册已有干员。
官方阵营按本库现有盟约映射解析，未知阵营回退协防；没有引入参考分支额外指定的奥术、不屈、灵巧、迅捷或独行盟约，
没有队友死亡加层，也没有联防同名塔露拉的施放互斥规则。
来源未确定的触发时序、自动施放及联防独立实例等工程解释在 kit 中标 `[ASSUMED]`。
伤害、元素损伤、治疗使用当前 `battle` 结算 API；成功伤害监听 `damageApplied`，受伤前防护使用 `injury`。

```powershell
node tools/prepare-operator-extension.mjs
node tools/build-data.mjs --operator-extension-only --offline
```

第一条命令只下载固定提交的五张官方表并记录原始 SHA-256；输出是可审阅的研究输入，
第二条只再生成三位角色的 backups 记录。全量构建也调用同一扩展步骤；原有数据与旧版本输入保持原来源。
各语言游戏记录由 `build-i18n.mjs` 再生成；尚无官方译文的内容沿用语言系统的中文回退。

## Golden 与复核

三位新干员的配置在自选 corpus 的旧分组之后追加，保留历史场景的种子、阵容与摘要。
新场景覆盖技能、普通/精锐与正式模组，不能从参考仓库拷贝 golden。
最终通过数量、浏览器截图、性能实测、可复现命令及回退路径以本次执行生成的验收报告为准。

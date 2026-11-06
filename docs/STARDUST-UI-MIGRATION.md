# 指定 UI 迁移实施说明

范围与五批顺序见 [计划](STARDUST-UI-PLAN.md)。验收命令、结果与截图索引见 [验收记录](STARDUST-UI-ACCEPTANCE.md)。

玩家可从 [本库特色图鉴](FORK-FEATURES.md) 查看四选二、名片底图、状态条、商店、小地图和预计叠层的实际截图、入口与默认值。图鉴对应当前 main，并区分尚未发布的源码改动与已发布包；本页继续保留协议、来源和兼容细节。

## 来源

本库代码基线 `0c84318c8`；实施副本开始于其文档后续 `4e7f17c54`。参考提交为 Stardust `7f39464c285fde4e5ee98825ad00936cffdfffa8`，许可 GPL-3.0-or-later。
适配自 `public/js/render/{units,textures,interp}.js`、`public/js/ui/{namecards,stagePreview,diyChoice}.js`、`server/match/{layerForecast,effectsMeta}.js`、自选候补模型及相关样式/测试。已核对的原始文件哈希保存在 [来源清单](STARDUST-UI-SOURCES.json)。
`test/match/layer-forecast.test.js`、过载渲染/模拟专项沿用并适配参考测试；其余兼容、设置和协议沿本库结构实现。来源审计保留逐文件 SHA-256。素材不随源码提交，官方图像及提取结果仍属于鹰角及其授权方。

## 接口与实现

- `settings.officialBattleHud` 默认开启，`settings.shopPortraitFocus` 默认关闭，均通过 `shared/clientPreferences.js` 接入服主默认和编辑锁；个人显式值不被强制值覆盖。
- 商店静态与动态图层使用同一图片边界；动态尺寸观察回调合并到下一帧，避免裁切变化时的 ResizeObserver 循环告警。
- `b.snap.overdrive` 为可选 `[[unitId, 0|1]]`，仅显示真实正在运行的四种持续技能阶段；单位元组、模拟时长、伤害和控制行为不变。提取器的 `ui/ep` 从官方 `arts/ui/[uc]battlecommon.ab` 读取 `slider_ep_*`/`sprite_ep_*`；程序回退使用同一锚点。
- 策略小地图使用当前地图原始地块，范围包含保护点和入口，不生成路线。局部 CSS 限高，原三栏定义不变。
- 等待室 `room.namecard {selection:{mode,id,x,y,zoom}}` 独立于 `room.card`。`mode` 为 `auto/none/manual`；身份为 `camp:/loading:/skin:`。服务端验证目录，广播包含 `resolved`；自动映射由服务端根据预选盟约更新。图层只挂载于等待室姓名牌。
- `m.private.layerForecast` 只在本人存活、在线准备期提供；记录每个盟约的 `n` 和 `sources`，并携带 `random/partial` 限制。预览复用真实派发顺序，独立 RNG 与账本，写入 API 默认无效，插件处理器跳过。输入缓存用 WeakMap，不进入存档。
- 候补身份 `diyBench_5_1/2`、`diyBench_6_1/2`；`g.diyApply {choices,setupRevision}` 允许本人每阶选择 0 至 2 个合法候选，并在服务端副本一次校验与准备两阶库存，成功后整体提交。兼容旧服务时仍用完整名额的 `g.diyChoose`。
- 简报把已确认名单压缩为摘要按钮，编辑在可滚动弹窗内完成；清空某阶、放弃草稿、待应用提示与确认名单分开展示。键盘焦点和准备键被弹窗保护，候选图标不再占本局信息高度。
- `diyPreset/diyChoice/diy` 分别保存完整候选、明确选择（空数组表示不带）、已上场映射。恢复用已上场映射，旧记录不再选择；不修改跨代码恢复身份限制。
- `welcome.uiMigration` 声明 `diyCandidates/diyBatchApply/namecards`。只有候补能力的旧服按完整名额使用 `g.diyChoose`；支持 `diyBatchApply` 时才允许 0/1/2 批量提交，不发送旧服不认识的新指令。

## 有意扩展与保留项

开局每阶最多携带两名是本库默认扩展，允许每阶选择零、一或两名，沿用普通匹配与战绩，不额外标记非官方对局；未改阶继续沿用盟约禁用后的默认名单，明确空选择不回退。旧两名配置、合法名单、重复限制、潜能、模组和皮肤继续适用。生成的游戏数据不需手改。
默认版本的网络形状守卫经其专用 `SP_UPDATE_GUARD=1` 命令重建；差异仅为新的人类席位 `namecard` 自动模式字段。玩法数据、内容哈希公式、版本列表及 `test/golden/` 均未改动。
08 同盟设置分页本次保留现状；优势和未来约束见计划。其他大厅、统计、摇杆、倍速投票及同时选策略不迁移。

## 合并至本地 main（2026-11-05）

实施提交 `cd020e66` 合并到本地 main，合并前 main 为 `e866f001`。保留其控制台登录、动态原皮/皮肤覆盖、外观身份校验、普通干员取景和 50%–300% 缩放能力。历史记录及四语言追加冲突按条目合并，未覆盖已有文案；代码自动合并后检查两套功能同时存在。README 的「仓库索引」集中列出 Stardust 实际采用内容及 GPL 致谢，末尾重复说明已移入索引。合并后的验证独立记录在 [验收记录](STARDUST-UI-ACCEPTANCE.md)，此前分支结果保留为历史证据。

合并核验同时将原 main 的 `CARD_ART_MIN_ZOOM` / `CARD_ART_MAX_ZOOM` 拆为两条等价导出，让仓库现有静态导入检查器识别全部名称；50%–300% 数值及浏览器行为不变。服务重启检查使用干净源码副本，避免读取本机 `logs/` 中的控制台访问配置，不改动用户配置。

main 新目录中的阿米娅/克洛丝条目只安装图片时装，未增加战斗骨架；击倒渲染测试改为检查实际存在的 Front 骨架，并额外确认图片目录条目的战斗模型查询仍为 null。现有战斗模型的倒地动画断言完整保留，素材清单和模拟规则不变。

## 后续适配：部署吸附开关（2026-11-06）

新增设置“部署时按格子吸附”（`settings.deploySnap`），默认开启。参考固定提交 `7f39464` 的设置、拖动跟随和渲染条件；本库依维护者更正保留默认吸附，并沿用本地合法目标判断和指针悬停高度。关闭后是模型预览自由跟随，松开仍落入指针下的合法格子，未实现任意坐标放置。装备、非法目标、取消、方向轮和临时整备区规则继续使用本地拖拽控制器。设置支持立即切换、个人保存、服主默认和编辑锁；源文件 SHA-256 补充到 [清单](STARDUST-UI-SOURCES.json) 的 `deploySnap` 项。许可仍为 GPL-3.0-or-later，致谢沿用 README 仓库索引。

# 指定 UI 迁移实施说明

范围与五批顺序见 [计划](STARDUST-UI-PLAN.md)。验收命令、结果与截图索引见 [验收记录](STARDUST-UI-ACCEPTANCE.md)。

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
- 候补身份 `diyBench_5_1/2`、`diyBench_6_1/2`；`g.diyChoose {tier,charIds,setupRevision}` 只接受本人的完整合法选择。服务端先构建副本和库存，再一次替换真实状态。私有 `diyChoice` 在简报提供候选、禁用信息、默认映射与是否明确选择。
- `diyPreset/diyChoice/diy` 分别保存完整候选、明确选择、已上场映射。恢复用已上场映射，旧记录不再选择；不修改跨代码恢复身份限制。
- `welcome.uiMigration` 声明 `diyCandidates/namecards`。未声明能力时客户端保留候补本地配置，只向旧服发送旧位置，不发送新协议。

## 有意扩展与保留项

四选二是本库默认扩展，沿用普通匹配与战绩，不额外标记非官方对局；它只改变开局可选名单，不改变同一输入的战斗模拟。旧两名配置、合法名单、重复限制、潜能、模组和皮肤继续适用。生成的游戏数据不需手改。
默认版本的网络形状守卫经其专用 `SP_UPDATE_GUARD=1` 命令重建；差异仅为新的人类席位 `namecard` 自动模式字段。玩法数据、内容哈希公式、版本列表及 `test/golden/` 均未改动。
08 同盟设置分页本次保留现状；优势和未来约束见计划。其他大厅、统计、摇杆、倍速投票及同时选策略不迁移。

## 合并至本地 main（2026-11-05）

实施提交 `cd020e66` 合并到本地 main，合并前 main 为 `e866f001`。保留其控制台登录、动态原皮/皮肤覆盖、外观身份校验、普通干员取景和 50%–300% 缩放能力。历史记录及四语言追加冲突按条目合并，未覆盖已有文案；代码自动合并后检查两套功能同时存在。README 的「仓库索引」集中列出 Stardust 实际采用内容及 GPL 致谢，末尾重复说明已移入索引。合并后的验证独立记录在 [验收记录](STARDUST-UI-ACCEPTANCE.md)，此前分支结果保留为历史证据。

合并核验同时将原 main 的 `CARD_ART_MIN_ZOOM` / `CARD_ART_MAX_ZOOM` 拆为两条等价导出，让仓库现有静态导入检查器识别全部名称；50%–300% 数值及浏览器行为不变。服务重启检查使用干净源码副本，避免读取本机 `logs/` 中的控制台访问配置，不改动用户配置。

main 新目录中的阿米娅/克洛丝条目只安装图片时装，未增加战斗骨架；击倒渲染测试改为检查实际存在的 Front 骨架，并额外确认图片目录条目的战斗模型查询仍为 null。现有战斗模型的倒地动画断言完整保留，素材清单和模拟规则不变。

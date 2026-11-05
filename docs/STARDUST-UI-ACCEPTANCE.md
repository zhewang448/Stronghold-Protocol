# 指定 UI 迁移验收记录

对应 [实施说明](STARDUST-UI-MIGRATION.md) 与 [五批计划](STARDUST-UI-PLAN.md)。本文件仅记录实际执行结果，完整命令 stdout/stderr 和退出码保留在本次事务的 `VERIFICATION.txt` 及相邻原始日志。

专项覆盖：四版本候选、完整/未满选择、禁用优先、投票与过期请求、简报后锁定、回档/重启及旧记录；两真人加观战者的底图自动/手动/无、重连和换房；真实四种过载、号角弹药、旧快照；叠层与真实结算、随机/插件排除、上限、缓存及隐私。

## 已完成专项

| 检查 | 实测 |
| --- | --- |
| 八个核心专项文件（候选、预测、过载、底图、设置、文档） | 63 pass，0 fail |
| 商店冻结、候选计数、观战盟约归属、默认网络形状守卫 | 58 pass，0 fail |
| 自选同步、旧服务器能力降级、命名预设库与候补保存 | 60 pass，0 fail |
| 动态立绘及文档一致性 | 37 pass，0 fail |
| 两个新设置 | 默认值、个人显式值、稀疏存储、服主强制/解锁、刷新及个人备份恢复通过 |
| 叠层额外检查 | 塞雷娅复制特质与真实结算一致；异常隐藏、诊断、缓存和 RNG 不变通过 |
| 严格多语言 | en/ja/ko/zh-TW 各 3285/3285，0 missing、0 errors |
| 静态检查 | lint/imports/typecheck 全部通过；保留仓库既有 lint warning 与允许的导入边界注记 |
| 全量 golden | 49 roster＋46 bonds＋22 fields＋21 matches＋10 standins＋155 diy = 303 场景一致，未更新期望 |

## 浏览器

真实 Chrome 在 1440×900、1280×720、844×390、640×360，对四档文字与 75%/100% 界面设置组合执行新增容器边界检查：三类界面 96 组，加 HUD/商店渲染记录共 97 组。中/大/特大沿用原系统限制，界面实际保持 100%，未绕过设置约束。策略三栏宽度前后一致；商店卡片宽高开关前后一致。

截图为真实应用组件/Canvas 渲染；商店和 HUD 使用受控状态以对照同一显示输入，过载另由真实模拟测试验证。官方损伤素材 15 张从本机客户端 `arts/ui/[uc]battlecommon.ab` 提取成功；官方图、未安装/加载中的程序回退均已观察。图像不入 Git。

两位真人客户端加观战客户端验证：自动炎徽记、手动载入图、拖动与 175% 缩放、刷新恢复、手动覆盖后切盟约、恢复自动与取消预选。独立 WebSocket 测试另验证重连、换房及 AI 不设置底图。动态商店图层与静态图片边界差异小于 1 px；修复 ResizeObserver 回调后无应用错误。页面重载取消的远程字体请求单独记录，不作为应用错误。

本机截图位于 `.cache/stardust-ui-migration/screenshots/`，`index.html` 为完整图库，`migration-overview.png` 为八项对照；`layout.json` 与 `extra-browser.json` 保存测量值。

## 事务与完整检查

独立改动副本保留在 `.cache/stardust-ui-migration/transaction/MODIFIED_FILE`；`DIFF_FILE.patch` 可重建逐字节相同结果。`BASELINE.tar` 和自包含 `ROLLBACK.sh` 在另一副本恢复全部原始文件；恢复树 SHA-256 与基线一致。相同候选输入下 BASELINE 为 4 位置/4 候选且无新协议，MODIFIED 为 8 位置/8 候选、新协议及 HUD 默认开启，ROLLBACK 恢复 BASELINE。

首次完整 CI 的快照断言、随机指令生成器与发布索引问题已修复；独立验收副本使用实体依赖目录，避免链接目录在插件沙箱内被拒绝。首次日志及每次修复后的复测日志保留，未删除失败记录。

最终 `npm run ci` 退出 0，七步全通过：setup 1.6 s；test 23m28s；smoke 5.2 s；guards 800 ms；lint 27.5 s；imports 223 ms；typecheck 1.5 s。全量测试 11,443 项，11,122 pass、321 skipped、0 fail、0 cancelled；守卫另外 28 pass。lint 为 0 errors、179 warnings。未启用的仓库可选浏览器套件仍按默认跳过；本次浏览器专项使用前述真实 Chrome 脚本独立执行，不把跳过项目计为通过。

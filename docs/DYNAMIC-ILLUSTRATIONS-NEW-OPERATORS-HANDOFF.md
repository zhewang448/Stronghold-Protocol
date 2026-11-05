# 给下一对话的实施提示

当前状态（2026-11-04）：本提示中的实施请求已执行；继续工作前先读 [验收报告](DYNAMIC-ILLUSTRATIONS-ACCEPTANCE.md) 和 `.cache/dynamic-illustrations-new-operators/checkpoint.json`，复用现有实现、四个事务角色及已验证结果。下文是原始接手请求，不代表当前仍未实施。

请在下面已经准备好的工作树中开始实现，不重复创建同名工作树：

`C:\Users\34948\.codex\worktrees\dynamic-illustrations-new-operators\Stronghold-Protocol`

分支：`codex/dynamic-illustrations-new-operators`。创建基线：`cbeb8d2a8d34ba7f39a31b746b34d8398b2d8a0e`。

先读该工作树的 `AGENTS.md`、`docs/DYNAMIC-ILLUSTRATIONS-NEW-OPERATORS-PLAN.md`，以及ARCHITECTURE、DESIGN、相关SIM/DATA/ASSETS/SKINS/I18N/CI文档。读 `server/sim/AGENTS.md` 后再改模拟代码。当前只是准备好了计划、分支和工作树，业务功能尚未实施。

我要完成两项：

1. 动态立绘采用Stardust共享renderer，并结合Misyra的24/30 FPS、DPR限制、后台暂停、减少动态效果、按需预览和静态回退。界面尽量跟进参考分支：调配卡片/列表/详情、自选、等待室席位、真实玩家头像和可用名片容器，不能只做预览弹窗。先做“查看立绘＋等待室”形成可审阅结果，再补齐其他位置。沿用本库取景、上传立绘和预设；来源固定提交与各入口验收在计划书中。
2. 首批新增塔露拉 `char_4247_oxi`、国度 `char_4246_dminon`、冻河 `char_4244_tocka`，依次完成数据、手写kit、素材、调配/自选和真实对局检查。默认第二期下半的5/6阶自选接入；技能和天赋按官方数据/PRTS核对，不能顺带搬来源自定的盟约或阵亡奖励。望、赤刃明霄陈、凯尔希·思衡托、维什戴尔本库已存在，做回归不重复新增。

本机调查证据位于 `E:\Stronghold-Protocol\.cache\ux-review-20261104\`，计划书含公开固定来源，不依赖该缓存才能继续。塔露拉战斗小人六个文件已有本库解析验证；三名新干员的动态大立绘尚未确认，先正确使用已有静态图与战斗模型。

主目录 `E:\Stronghold-Protocol` 还有独立进行的未提交立绘工作，未复制进本工作树。请保留原目录与暂存状态，不将它们自动合并或恢复；最终整合时精确对比取景相关差异。工作树创建/主目录状态证据在checkpoint指向的JSON中。

工作树依赖已通过 `npm ci` 安装，32项现有文档检查通过；尚未开始功能修改。现在继续M0：复核本工作树当前状态和分支，准备独立数据/素材环境并记录行为基线，然后依计划实施。生成JSON通过构建器生成；游戏美术不进Git；代码使用本库当前结算API并保证确定性；新增控件提供正确键盘焦点和方向键操作；完成相应UI、技能、恢复/回放、性能、golden及CI检查，保存可审阅diff和回退验证证据。不要把“有素材”“语法检查通过”当成已完成真实渲染或玩法验收。

本条授权在该工作树开始实现以上范围。完成后报告结果与验证，不自动合并、发布或重启现有服务。

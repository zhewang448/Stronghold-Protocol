# v0.3.3-extended.10 · 表情弹幕与启动头像修复

日期：2026-11-04（Asia/Shanghai）。基础游戏 0.3.3，Windows 启动器保持 1.3.0。

## 改动

- 合入 [PR #25](https://github.com/zhewang448/Stronghold-Protocol/pull/25)：信号条增加发送及设置两格，支持单选/随机、最近使用、200 ms 连点合并；主机实时开关、原信号按钮显示和每玩家每秒上限保存后立即生效。
- 独立版本及插件对局在创建和运行中同步弹幕允许开关与限速，避免只改变界面；设置面板在 844×390、640×360 横屏内保持完整可见。
- 修复 [Issue #26](https://github.com/zhewang448/Stronghold-Protocol/issues/26)：启动头像不再套无尺寸的 Tooltip 包裹，已验证共享头像按 playerId 跨转场读取，更新、移除和离房继续同步。
- 修正 [Issue #27](https://github.com/zhewang448/Stronghold-Protocol/issues/27)：随机策略名称及说明同步四语言包，抽取、额外 1 生命和 1 资金机制不变。
- Python 3.8 兼容检查固定 Ubuntu 22.04，修复 Ubuntu 26.04 runner 没有该解释器的环境失败。

感谢 DoraCat（[@DuolaCCCCat](https://github.com/DuolaCCCCat)）提交 PR、问题和复现说明。
表情弹幕属于维护者指定的 [ASSUMED] 娱乐扩展，不改变战斗模拟或结算规则。

## 验证与安装

本机相关主机/协议/i18n/集成测试 849 项通过，原有回归 67 项通过；完整联机测试 3/3 通过。
新增控制台持久化、process/worker 同步及手机横屏浏览器回归通过，golden 六组 299 场景匹配。
旧 PR 的 Windows 整局超时记录保留；上述本机复验不等同于旧远端任务通过。
本轮发布提交的最终 CI、安装包清单、升级应用和签名结果随 Release 发布说明与本机验证记录保存。

增量直接支持已发布 v0.3.3-extended.7 与 v0.3.3-extended.9；更早版本先升级受支持基线或使用完整包/启动器。
提供完整包、精简包、三组素材分包、增量包及配套启动器，附 Ed25519 签名和 SHA-256 清单。
升级前结束对局并备份个人数据；跨版本快照不保证兼容。已发布标签和附件不覆盖。

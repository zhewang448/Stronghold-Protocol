# 客户端设置默认值与用户权限验收（2026-11-05）

实施工作树：`C:\Users\34948\.codex\worktrees\dynamic-illustrations-new-operators\Stronghold-Protocol`。分支：`codex/dynamic-illustrations-new-operators`。
原始基线：`cbeb8d2a8d34ba7f39a31b746b34d8398b2d8a0e`。继承既有动态立绘、新干员和重复策略修改。

## 已实现

控制台「设置 → 客户端设置」提供 52 项默认值/强制值与「允许用户更改」，初始全部允许。
已有个人明确值优先于允许状态下的主机默认，只有未保存的字段跟随默认。关闭权限立即使用主机值，原生控件禁用并说明原因；
刷新、强制和修改其他允许项均不覆写个人值，解锁恢复。保存层保持稀疏，明确选择即使恰好等于当前主机默认也会保留。

沿用原设置 key 和别名迁移；语言代码在语言包目录到达前保留，真实延迟目录/刷新测试覆盖初始化顺序。
语言手动选择仍保留请求先后、失败回退与缓存行为。个人插件保留旧数组格式，备份时间更新不会把强制开关写回个人值。
主机配置原子验证并跨重启保存，经健康检查、welcome 与 site.settings 同步给标题页、在线客户端和重连。
玩家个人值不随新策略发送。减少动画、资源缺失、语言包缺失和设备能力约束继续适用。

账号资料、干员技能/模组/持有/自选等玩家配置和本机文件内容不是显示默认值；诊断、清缓存、导入导出是操作。
规则见 [客户端设计](design/client.md#客户端偏好默认值与修改权限2026-11-05)。

## 本次验证结果

- 定向兼容回归：115 项通过，退出 0。
- 真实浏览器组合：18 项通过，退出 0；最后语言修复后核心控制台/刷新场景另跑通过。
  覆盖鼠标、键盘、触屏，640/844/1280/1440 像素屏幕，文字大小与混合输入；页面错误 0。
- 303 个 golden 场景全部匹配，退出 0；本次偏好修改没有更改继承的 golden 文件。
- 四语各 3195 条 UI 字符串，0 缺失、0 错误；文档 32 项通过。lint 0 错误、174 警告，类型与导入检查退出 0。
- 完整 CI 首轮：11411 项，11087 通过、3 失败、321 跳过，退出 1。
  三项是新增包装/依赖令旧源码断言或 VM 夹具失效；已补齐字段绑定断言和模拟依赖，34 项定向复跑全部通过。
- 完整 CI 第二轮：11411 项，11090 通过、0 失败、321 跳过，退出 0。
  保留所有测试和阈值；首轮结果与独立复跑不替代第二轮结果。
- 完整包和精简包规划检查退出 0。已实际生成精简包（34952213 字节），在隔离目录启动，验证新模块逐字节相等、
  默认 52 项全部允许和强制策略健康接口。完整包本次只做规划，既有动态任务的完整包/离线素材证据仍作为历史记录。

浏览器批量邻近旧套件曾出现 Edge 启动兼容层退出、旧大厅选择器、素材前提和网络空闲等待失败。
本次相关控件、设置入口和个人数据套件已修复/回归通过；其他相邻旧套件未全部复跑通过，不宣称全量可选浏览器套件通过。
控制台房间准备时长无效值后的旧断言，在修改前隔离副本同样于原第 47 行失败（CLIENT_POLICY_LEGACY_ADMIN_BASELINE，退出 1）。
实体手机和多种 GPU 未测。

## 命令与退出码

原始记录位于 `C:\Users\34948\.codex\worktrees\dynamic-illustrations-new-operators\Stronghold-Protocol\.cache\dynamic-illustrations-new-operators` 的同名 .json/.stdout.txt/.stderr.txt，含命令数组、cwd、字面 stdout/stderr、时间和退出码。
浏览器环境为 SP_E2E=1，CHROME_PATH=C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe；
测试专用预加载仅补充 Edge 启动与后台运行参数，不改变断言或阈值。输入及实际存储字节见 client-policy/ui/results.json。

| 记录 | 退出码 | 测试数（适用时） |
|---|---:|---:|
| CLIENT_POLICY_TARGETED | 0 | 115 |
| CLIENT_POLICY_BROWSER_FINAL | 0 | 18 |
| CLIENT_POLICY_BROWSER_STABLE | 0 | 1 |
| CLIENT_POLICY_CI_FIXTURES_FIXED | 0 | 34 |
| CLIENT_POLICY_GOLDEN | 0 | — |
| CLIENT_POLICY_DOCS | 0 | 32 |
| CLIENT_POLICY_I18N | 0 | — |
| CLIENT_POLICY_LINT | 0 | — |
| CLIENT_POLICY_IMPORTS | 0 | — |
| CLIENT_POLICY_TYPES | 0 | — |
| CLIENT_POLICY_PACKAGE_FULL | 0 | — |
| CLIENT_POLICY_PACKAGE_LITE | 0 | — |
| CLIENT_POLICY_PACKAGE_LITE_BUILT | 0 | — |
| CLIENT_POLICY_PACKAGE_BOOT | 0 | — |
| CLIENT_POLICY_DEFAULT_UI | 0 | — |
| CLIENT_POLICY_FULL_CI_FINAL | 1 | 11411 |
| CLIENT_POLICY_FULL_CI_VERIFIED | 0 | 11411 |

## 字段支持矩阵

全部字段由共享目录校验、在控制台显示，并进入保存/生效分层；数值范围与枚举见 shared/clientPreferences.js。

| 字段 | 控制台名称 | 初始默认值 | 初始修改权限 |
|---|---|---|---|
| `settings.bgm` | 背景音乐 | `0.6` | 允许 |
| `settings.sfx` | 音效 | `0.8` | 允许 |
| `settings.voice` | 干员语音 | `0.8` | 允许 |
| `settings.voiceLang` | 语音语言 | `"cn"` | 允许 |
| `settings.voiceNative` | 本土语言 | `false` | 允许 |
| `settings.voiceOverrides` | 逐干员语音配置 | `{}` | 允许 |
| `settings.muted` | 静音 | `false` | 允许 |
| `settings.damageNumbers` | 显示伤害数字 | `true` | 允许 |
| `settings.officialDamageNumbers` | 官方伤害数字 | `false` | 允许 |
| `settings.ammoEnergyCount` | 显示弹药与能量数量 | `false` | 允许 |
| `settings.fullscreenWakeLock` | 全屏时保持屏幕常亮 | `false` | 允许 |
| `settings.bondTimers` | 盟约效果剩余时间 | `false` | 允许 |
| `settings.combatMetrics` | 作战统计 | `true` | 允许 |
| `settings.chatBubbles` | 显示消息提示气泡 | `true` | 允许 |
| `settings.deploymentZoom` | 部署时镜头缩放 | `false` | 允许 |
| `settings.showFps` | 显示帧率 | `true` | 允许 |
| `settings.preload` | 预载资源 | `false` | 允许 |
| `settings.preloadOptional` | 预载可选资源 | `false` | 允许 |
| `settings.otherSkins` | 显示其他玩家的皮肤 | `true` | 允许 |
| `settings.upstreamReleaseNotes` | 显示上游更新内容 | `true` | 允许 |
| `settings.extensionReleaseNotes` | 显示扩展更新内容 | `true` | 允许 |
| `settings.fpsLimit` | 帧率上限 | `0` | 允许 |
| `settings.quality` | 画面质量 | `"high"` | 允许 |
| `settings.officialFx` | 官方特效 | `"auto"` | 允许 |
| `settings.dynamicIllustrations` | 动态立绘 | `"auto"` | 允许 |
| `settings.textSize` | 文字大小 | `"sm"` | 允许 |
| `settings.preloadVoiceLang` | 预载语音语言 | `["cn","jp"]` | 允许 |
| `settings.keys` | 快捷键 | `{"buy":"KeyW","refresh":"KeyR","freeze":"KeyF","levelUp":"KeyD","retreat":"KeyQ","sell":"KeyX","ready":"Space"}` | 允许 |
| `language` | 界面语言 | `"zh"` | 允许 |
| `backupReminder.enabled` | 定期提醒导出个人数据 | `true` | 允许 |
| `loadout.view` | 干员调配显示方式 | `"deck"` | 允许 |
| `screenFit.l` | 左侧适配（像素） | `0` | 允许 |
| `screenFit.r` | 右侧适配（像素） | `0` | 允许 |
| `screenFit.t` | 顶部适配（像素） | `0` | 允许 |
| `screenFit.b` | 底部适配（像素） | `0` | 允许 |
| `screenFit.ui` | 界面大小（百分比） | `100` | 允许 |
| `cosmetics.ids` | 个人外观插件 | `[]` | 允许 |
| `uiPlugins.ids` | 个人界面插件 | `[]` | 允许 |
| `skinRandom.scope` | 皮肤随机范围 | `"all"` | 允许 |
| `skinRandom.auto` | 每局自动随机皮肤 | `false` | 允许 |
| `skinRandom.locked` | 皮肤锁定干员 | `{}` | 允许 |
| `lobbyMedia.backdrop` | 使用自定义大厅背景 | `false` | 允许 |
| `lobbyMedia.music` | 使用自定义大厅音乐 | `false` | 允许 |
| `lobbyMedia.dim` | 自定义背景暗度 | `0.35` | 允许 |
| `lobbyMedia.scene` | 大厅场景 | `"official"` | 允许 |
| `hubBackdrop.theme` | 大厅背景主题 | `"night"` | 允许 |
| `hubBackdrop.dim` | 大厅背景暗度（百分比） | `45` | 允许 |
| `hubBackdrop.blur` | 大厅背景模糊 | `0` | 允许 |
| `hubBackdrop.overlay` | 背景战术网格 | `true` | 允许 |
| `hubBackdrop.motion` | 背景动态效果 | `true` | 允许 |
| `hubBackdrop.videoSound` | 播放背景视频声音 | `false` | 允许 |
| `hubBackdrop.videoPaused` | 暂停背景视频 | `false` | 允许 |

## 取景与设置截图

截图目录：`C:\Users\34948\.codex\worktrees\dynamic-illustrations-new-operators\Stronghold-Protocol\.cache\dynamic-illustrations-new-operators\client-policy\ui`。
console-default-1440.png / console-default-390.png：全新主机 52 项全部允许。
console-1440.png / console-390.png：默认值与权限实际编辑。
client-locked-desktop.png / client-locked-touch.png：主机强制值、禁用和说明。
client-restored-desktop.png：解锁后恢复原关闭值。历史缩放截图仍见动态任务验收。

## 事务与回滚

沿用并扩展以下四个角色，末次封存时再次核对所有源文件并回读：

- MODIFIED_FILE：`C:\Users\34948\.codex\worktrees\dynamic-illustrations-new-operators\Stronghold-Protocol\.cache\dynamic-illustrations-new-operators\transaction\MODIFIED_FILE`
- DIFF_FILE：`C:\Users\34948\.codex\worktrees\dynamic-illustrations-new-operators\Stronghold-Protocol\.cache\dynamic-illustrations-new-operators\transaction\DIFF_FILE.patch`
- VERIFICATION：`C:\Users\34948\.codex\worktrees\dynamic-illustrations-new-operators\Stronghold-Protocol\.cache\dynamic-illustrations-new-operators\transaction\VERIFICATION.txt`
- ROLLBACK：`C:\Users\34948\.codex\worktrees\dynamic-illustrations-new-operators\Stronghold-Protocol\.cache\dynamic-illustrations-new-operators\transaction\ROLLBACK.sh`

补充的本次小 diff：`C:\Users\34948\.codex\worktrees\dynamic-illustrations-new-operators\Stronghold-Protocol\.cache\dynamic-illustrations-new-operators\transaction\CLIENT_POLICY.patch`。主 DIFF_FILE 仍从原始基线重建完整实施源码。
相同输入为 savedBgm=0.21、hostDefault=0.8、lockThenUnlock=true：

| 阶段 | 初值 | 锁定时 | 解锁后 | 保存值 |
|---|---:|---:|---:|---:|
| BASELINE | 0.21 | 0.21 | 0.21 | 0.21 |
| MODIFIED | 0.21 | 0.8 | 0.21 | 0.21 |
| ROLLBACK | 0.21 | 0.21 | 0.21 | 0.21 |
| REAPPLIED | 0.21 | 0.8 | 0.21 | 0.21 |

两种回滚均只在隔离副本执行：ROLLBACK.sh TARGET_COPY --client-policy 恢复本次修改前的 2875 个继承文件；
默认单参数模式恢复原始事务的 2833 个源文件，哈希一致。运行依赖（node_modules、public/vendor）为副本单独准备，未改原始源字节。
早期副本缺少忽略的 public/vendor 导致的失败记录保留；补齐运行依赖后的行为验证退出均为 0。

## 审阅地址与包

游戏：http://127.0.0.1:43465；控制台：http://127.0.0.1:43466。实例仅绑定本机，52 项初始全部允许。
旧动态任务实例不因本次重启；本次审阅实例刷新前确认 sockets/rooms/matches 都为 0。
精简包：`E:/Stronghold-Protocol-Releases/client-policy-review-20261105/lite/Stronghold-Protocol-v0.3.3-lite.zip`；SHA-256：`f480ae8effa3adf099a7bf5456779fe409ee0b00ba5cd07cc942cd2614327c78`。未发布、未合并。

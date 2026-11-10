# 可露希尔终端主题

「设置 → 外观 → 终端主题」可选择默认界面或「“全能的”可露希尔」。主题保存在本机，服主可设置首次默认值及修改权限。首次仍使用默认界面，对局主题语音默认关闭。主题作用于本机配色、商店、阶段提示及大厅角色；切回默认立即恢复。主题角色点击可试听，设置里可预览全部九个角色动作。语音跟随现有语音语言：日语使用日语，其他语言使用中文；音量与静音沿用干员语音声道。

## 来源

- [官方2026感谢庆典公告](https://ak.hypergryph.com/news/0787)的「全能开发者主题包」宣传图明确标价 ¥45，包含卫戍协议终端主题「“全能的”可露希尔」及专属语音。售价只是原游戏来源信息，本项目不提供购买功能。
- `closure-studio/ArknightsGamedataPure` 提交 `080bc918e183f81bd4fad06c70786d8b934d9788` 的 `excel/activity_table.json`：`autoChessData.skinDataDict.ac_s_closur`、`skinColorDataDict`、`skinVoiceAnimDict`。主题的深蓝 `#2E38FF`、亮蓝 `#00D2FF`、青色 `#69FDFF` 和危险粉 `#FF4F75` 均来自表内对应字段。
- 核对过的 ArknightsAssets2 国服树 `aa5cb25df844ee2b0680428b13cb65d5d4b515a5` 尚使用10月29日资源清单，只有初始主题的完整目录及可露希尔的预览图标。因此安装器使用公开官方 Android CDN 的固定资源版本 `26-11-06-12-56-09-07186384`，不依赖镜像更新。

| 资源包 | 原包 MD5 |
|---|---|
| `ui/autochess/autochessvariantskin/[uc]ac_s_closur.ab` | `c70c6b965823516ab93ca8c27f806667` |
| `audio/sound_beta_2/voice_cn/ac_s_closur.ab` | `4817f7e6004b8bb760e3cef35c5bde7f` |
| `audio/sound_beta_2/voice/ac_s_closur.ab` | `33b992fe87ece929f4be1289797bed3c` |

## 安装

使用现有 [素材说明](ASSETS.md) 的 UnityPy 提取环境，显式运行：

```powershell
.venv-extract/Scripts/python.exe tools/local-extract/terminal_theme.py
```

Linux/macOS 可使用已装提取依赖的 `python3`。`--plan` 只打印固定包身份，不导入 UnityPy、不访问网络。`--offline --cache <bundle根目录>` 只使用已缓存且 MD5 正确的原包。

输出为忽略目录 `public/assets/terminal-themes/ac_s_closur/`，包含339张导出 Sprite（324个不同名称）、Spine 3.8 骨骼及贴图、九个动作、中文/日语各19段音频、原始两个配置 JSON，以及逐文件大小和 SHA-256 的 `manifest.json`。清单另记录 Sprite 尺寸、按 CSS 上/右/下/左顺序转换的原生边框 `spriteMeta` 和骨骼末关键帧时长 `animationDurations`。本次导出文件合计13,018,424字节。官方素材不进入 Git；源代码安装需单独执行安装器。已有清单可用相同命令重新解包补齐元数据；旧版清单仍可使用固定原包的已核对边框与动作时长。

游戏启动不下载原包，默认主题不请求本主题素材。选择后才读取本机服务器上的清单；清单损坏或缺失时显示说明并保留默认界面。静态角色保留为 WebGL 不可用时的回退。动态播放复用现有共享渲染器，遵守动态立绘设置、减少动画、离屏及后台暂停。原有外观插件的显式 CSS 变量继续优先。

## 浏览器适配范围

本库五个官方版本均可选择此本机外观，包括「规程·序列Ⅰ」和四个「盟约」版本。规程大厅保留随赛季变化的标题与模式选择；本机主题不改变对局规则、版本和房间数据。

商店使用原包普通/五阶/六阶卡框、六张等级图片及刷新/冻结按钮的正常、激活和禁用底图。HUD 使用 `group_hud/root_bg/board` 引用的 `board_main`。回合提示窗口使用 `round_start` 内的 `window_main_frame`，按原生 `m_Border`（左124、下16、右62、上38）进行九宫格缩放，避免标题与关闭按钮随面板一起拉伸。阶段提示按休整、作战、首领分别使用蓝/金/粉窗口。

[ASSUMED] 浏览器动作衔接为一次性动作完成一遍后回到待机，时长取原骨骼：庆祝2秒、高兴2.8333秒、互动5.9333秒、得意2.6667秒、说话5秒。失落 `Sad_Begin` 播完2.5667秒后转为 `Sad_Idle`；待机、初始姿态与低落保持当前姿态或循环。计时覆盖设置预览、大厅点击和已接入的阶段触发。

[ASSUMED] 商店与提示框保留本库布局；阶段提示图片原生没有九宫格边框，浏览器按实测切分9/12/8/18像素保留标题栏，未将其声称为原生边框。原包 Unity 的189个粒子系统和40段 UI AnimationClip 不由浏览器逐帧重放。原始 `skin_config`、`effect_preview_config` 保留在安装目录供后续适配。

[ASSUMED] 对局语音只接入可直接确认的模拟开始、最终攻势、隐秘核心三个阶段；被干员语音占用时跳过，重连不重播。十九段原始语音完整导出，但未实现原游戏所有概率触发器及粒子时间线。数据、伤害、经济、协议和 golden 场景均不改。

## 验证

```bash
node --test test/ui/terminal-theme.test.js test/ui/audio.test.js test/ui/gameLogic.test.js test/client-preferences.test.js test/ui/lobby-hub.test.js
node tools/i18n.mjs check --all --strict
node --test test/docs-consistency.test.js test/docs-paths.test.js
```

迁入 main 前已保存检查点提交 `e82be1c`。原主题草稿的验证记录保留在来源工作树的 `.cache/theme-migration/`；本轮 main 集成的命令、浏览器检查、设置切换和独立副本回滚记录追加到既有迁移事务中。资源预载和分包包含主题清单、骨骼及两个配置 JSON。

2026-11-10 优化前的 main 本地提交为 `d7cb0823`。解包核对、同输入浏览器 BASELINE/MODIFIED/ROLLBACK 结果、补丁、原始快照和可执行回滚保存在本机 `.cache/closure-refinement/`；这些本机验证产物不进入 Git。

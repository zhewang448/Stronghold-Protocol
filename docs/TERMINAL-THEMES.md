# 官方界面主题与可露希尔

设置 → 外观 → 界面主题统一提供内置终端、已安装的官方终端贴图、乌萨斯齐心团、可露希尔，以及导入的 spTheme 1 主题包。首次保持内置界面，对局主题语音默认关闭；选择、动画和语音均遵守服主默认与修改权限。旧 `terminalTheme/terminalVoice` 自动迁移，显式新值优先。

三种官方主题的卡框、顶栏、倒计时和阶段展示使用上游 prefab 体系，保留本库动态立绘、取景、单位状态条、多人速查和统计。大厅角色、设置预览与资金卡使用同一加载/播放实现，动作预览可选择可露希尔九种动作。被动主题语音让位于干员语音，试听可接管同一声道；日语选择使用日语文件，缺失时回退中文。减少动画、动态立绘关闭、离屏与后台会停止持续播放。

## 来源

- [官方2026感谢庆典公告](https://ak.hypergryph.com/news/0787)的「全能开发者主题包」宣传图明确标价 ¥45，包含卫戍协议终端主题「“全能的”可露希尔」及专属语音。售价只是原游戏来源信息，本项目不提供购买功能。
- `closure-studio/ArknightsGamedataPure` 提交 `080bc918e183f81bd4fad06c70786d8b934d9788` 的 `excel/activity_table.json`：`autoChessData.skinDataDict.ac_s_closur`、`skinColorDataDict`、`skinVoiceAnimDict`。主题的深蓝 `#2E38FF`、亮蓝 `#00D2FF`、青色 `#69FDFF` 和危险粉 `#FF4F75` 均来自表内对应字段。
- 核对过的 ArknightsAssets2 国服树 `aa5cb25df844ee2b0680428b13cb65d5d4b515a5` 尚使用10月29日资源清单，只有初始主题的完整目录及可露希尔的预览图标。因此安装器使用公开官方 Android CDN 的固定资源版本 `26-11-06-12-56-09-07186384`，不依赖镜像更新。

| 资源包 | 原包 MD5 |
|---|---|
| `ui/autochess/autochessvariantskin/[uc]ac_s_closur.ab` | `c70c6b965823516ab93ca8c27f806667` |
| `audio/sound_beta_2/voice_cn/ac_s_closur.ab` | `4817f7e6004b8bb760e3cef35c5bde7f` |
| `audio/sound_beta_2/voice/ac_s_closur.ab` | `33b992fe87ece929f4be1289797bed3c` |

## 准备素材

使用已有 UnityPy 提取环境，先获取固定官方资源，再提取新格式：

```powershell
python tools/local-extract/fetch_regulation.py --only theme
.venv-extract/Scripts/python.exe tools/local-extract/extract.py --only theme --themes .cache/official-regulation/26-11-06-12-56-09-07186384 --out public/assets/local --manifest data/local-assets.json
```

`--list` 只列出下载计划；每个原包按该版本 hot-update 清单的 MD5 校验。提取结果位于忽略目录 `public/assets/local/themes/<id>/`，包含 `theme.json`、`layout.json`、`prefabs.json`、图片、Spine、字体及中日语音。游戏启动不会下载官方原包。

旧 `terminal_theme.py` 与旧清单校验工具保留用于既有包诊断和转换；新界面读取上述新格式。完整包和资源分包按新本机清单收录素材，不将原包、提取产物或图像写入 Git。

## 用户配置与回退

主题缺失使用默认呈现，并保留已选身份便于补装；不会改变版本、房间或战斗规则。自定义背景、视频、音乐和外观插件仍沿用既有优先级。主题 ZIP 存在浏览器独立图库，个人数据备份只携带选择，换设备需重新导入主题包；服务器安装的官方素材不需要写入个人备份。

主题格式与作者指南见 [THEMES.md](THEMES.md)，本轮来源、兼容和验证见 [迁移记录](UPSTREAM-DEV-20261115.md)。

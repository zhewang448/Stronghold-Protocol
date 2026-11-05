---
name: 卫戍协议：盟约 · 仿游戏 UI
description: 从已完成的 isomerpoi 界面移植提取的视觉事实；玩法规则仍由 docs/DESIGN.md 管理。
colors:
  bg-0: "#0c0f0e"
  bg-1: "#141816"
  bg-2: "#1e2421"
  bg-3: "#252c29"
  bg-4: "#2d3632"
  bg-glass: "rgba(16, 20, 18, .82)"
  line: "#2f3a35"
  line-2: "#3e4b45"
  line-3: "#58675f"
  mint-500: "#4ed8af"
  mint-400: "#59f4ca"
  mint-600: "#35d8b4"
  mint-glow: "#17f9b7"
  mint-700: "#2a9e7f"
  mint-800: "#145443"
  mint-900: "#0d2c24"
  gold: "#ffc600"
  gold-2: "#f2bd3e"
  amber: "#f6a329"
  orange: "#e85a1a"
  orange-hi: "#ff7a33"
  red: "#e73118"
  red-abyss: "#ff0024"
  red-premium: "#ff5454"
  ice: "#9fd4ff"
  ice-900: "#14283a"
  text-hi: "#f2f2f2"
  text-md: "#c3cbc7"
  text-lo: "#8a948f"
  text-dim: "#5d6863"
  text-on-mint: "#06110d"
typography:
  headline:
    fontFamily: "'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Source Han Sans SC', 'Noto Sans CJK SC', sans-serif"
    fontSize: "calc(.46 * var(--t))"
    fontWeight: 900
    letterSpacing: ".14em"
  title:
    fontSize: "calc(.3 * var(--t))"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: ".1em"
  body:
    fontFamily: "'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Source Han Sans SC', 'Noto Sans CJK SC', sans-serif"
    fontSize: "calc(.18 * var(--t))"
    fontWeight: 400
    lineHeight: 1.5
  button:
    fontSize: "calc(.18 * var(--t))"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: ".06em"
  navigation:
    fontSize: "calc(.17 * var(--t))"
    fontWeight: 500
    letterSpacing: ".04em"
rounded:
  circle: "50%"
spacing:
  gap-small: ".08rem"
  gap-control: ".1rem"
  gap-actions: ".12rem"
  gap-panel: ".16rem"
  panel-body: ".22rem"
  button-inline: ".26rem"
components:
  button-primary:
    backgroundColor: "{colors.mint-500}"
    textColor: "{colors.text-on-mint}"
    typography: "{typography.button}"
    padding: "0 .26rem"
    height: ".5rem"
  button-primary-hover:
    backgroundColor: "{colors.mint-400}"
    textColor: "{colors.text-on-mint}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-lo}"
    typography: "{typography.button}"
    padding: "0 .26rem"
    height: ".5rem"
  tabs-active:
    textColor: "{colors.mint-400}"
    typography: "{typography.navigation}"
    padding: ".1rem .22rem .12rem"
  panel-body:
    padding: "{spacing.panel-body}"
  hub-tile:
    backgroundColor: "rgba(8, 14, 13, .8)"
    textColor: "{colors.text-hi}"
    padding: ".1rem .16rem"
---

# Design System: 卫戍协议：盟约 · 仿游戏 UI

## Overview

**Creative North Star: "isomerpoi 仿游戏视觉"**

这是用户锁定参考 UI 的 code-led 移植记录。视觉权威是 isomerpoi（雨千代chiyo）的 `ui-redesign-upstream` 提交 `b2bd17afa91783e5be05262fb9acd03a2cd4737b`，以及 2026-10-15 抓取的[参考站点](https://weishuxieyi.xiaolubao.com/)公开 JS / CSS；站点第二阶段源码的原作者身份不明，来源与适配边界以 [UI-HUB-PORT.md](UI-HUB-PORT.md)、[UI-HUB-ACCEPTANCE.md](UI-HUB-ACCEPTANCE.md) 和 [NOTICE.md](../NOTICE.md) 为准。

近黑绿灰底、薄荷绿交互、金色物资、橙红危险语义共同构成游戏操作界面。雷达、像素城堡、扫描纹理、点阵图形、括号框和数据读数是来源世界的已有语言。文档记录当前实现，不开启新的风格选择；新增的资源管理、只读作战统计和公告也继承此世界。

本文件特意位于 `docs/UI-DESIGN.md`：既有 [DESIGN.md](DESIGN.md) 是游戏规则与架构契约索引，不能被视觉技能的默认根目录文件覆盖。产品事实来自 [ARCHITECTURE.md](ARCHITECTURE.md) 与 [META.md](META.md)，仓库没有 `PRODUCT.md`，本次不补造。前置 YAML 是提取后的视觉 token；CSS 变更后需重新核对。扩展与选择器证据位于 [design.json](../.impeccable/design.json)。

**Key Characteristics:**

- 近黑绿灰分层，薄荷绿指示可操作状态，金色表达物资与收益。
- 直线面板、括号框与局部发光并存；徽章、雷达和头像保留圆形或切角。
- 横屏游戏舞台优先，文字缩放与布局缩放独立，功能面板保留滚动。
- 使用本库真实皮肤、聊天、标点、观战与回放能力，不以来源垫片替换。

## Colors

### Primary

`mint-500` 用于主按钮、括号角与选择强调；`mint-400` 用于悬停、活动标签和高亮。深薄荷色承接边框与暗底状态，`mint-glow` 形成局部光晕。

### Secondary

`gold` 与 `gold-2` 用于物资、价格、奖励与徽章；`amber`、`orange`、`orange-hi` 和红色系列区分难度、警示与危险操作；`ice` 系列用于冷色状态与信息。难度、棋子等级和商店等级另有实际 CSS token，未把它们重命名为通用品牌色。

### Neutral

`bg-0` 至 `bg-4` 构成由画布到控件的暗色层次；`line` 系列组织边框。`text-hi`、`text-md`、`text-lo` 分别承接主文、正文与辅助文字；`text-dim` 在实现中仍用于弱化和禁用信息，不应据此把新说明文字做成低对比度。

**The Resource Readability Rule.** 资源管理顶部说明、摘要和维护操作采用最终局部覆盖的 `text-lo`。不因全局 `res-link` / `preload-hint` 的较暗默认值而退回此修复；具体选择器见 sidecar。该结论不等同于全界面颜色已逐项通过对比度审计。

## Typography

中文正文使用 `font-cjk` 的 Noto Sans SC 与系统中文回退。数字使用 Bender → Rajdhani → Oxanium，展示型拉丁字体使用 Novecento → Novecento Wide → Oxanium → Rajdhani；`font-mono` 使用 Bender / Oxanium 与等宽回退。日文、韩文和繁体中文由 `:lang()` 替换 CJK 字族。字体是可选资源，加载失败仍能启动；本机 `/fonts/fonts.css` 与外部非阻塞 Google Fonts 的声明见 `public/index.html`。

前置层级对应实际 Hub 标题、共享顶栏、正文、按钮和标签页。数字辅助类启用等宽数字与字距（`.02em`），展示辅助类启用大写与字距（`.12em`）。点阵标题或图形由现有组件绘制，不代表新增字体依赖。

**The Separate Text Root Rule.** 布局由根 `rem` 控制，玩家文字设置只改变 `--t`：小为 `1rem`，中为 `max(1rem, 64px)`，大为 `max(calc(1rem * 1.15), 76px)`，特大为 `max(calc(1rem * 1.3), 88px)`。不能通过改根字号实现文字设置，因为战场定位也读取该根值。结算固定舞台另用 `--settle-text: 1rem`，避免固定位置文字互相挤压。

## Layout

设计坐标为 1920×1080，布局尺寸以设计像素除以 100 写成 rem。根字号使用 `clamp(40px, min(calc(100vw / 19.2), calc(100svh / 10.8)), 240px)`，并保留 `100vh` 回退；细边框继续使用 CSS px。`body` 与屏幕外框不滚动，内部列表、说明和弹窗内容承担滚动。

Hub 的三列网格容纳左侧功能、中央标识与右侧入口，中心横跨首行；自定义背景隐藏中央标识和标题以展示玩家图片。等待室默认四张席位卡，独立模拟改为席位与说明组合。干员调配保留筛选阵容、详情、皮肤及装备抽屉；战场为满幅画布，上层 HUD 与标点按独立图层定位。结算采用居中的 `19.2rem × 10.8rem` 舞台与额外 `--k` 缩放，而不是套用通用内容列宽。

响应式是按界面适配的多组断点，没有统一断点设计 token。共享顶栏在 1000px / 760px 附近改行与压缩次级文字；调配继续使用 1100px / 900px / 520px 高度等局部条件。`devices.css` 为粗指针控制提供至少 44px 的隐形触区，短触屏（高度不超过 600px）增大关键操作；767px 以下对局角落控制换行。具体条件与来源见 sidecar，不能把“44px”理解为每个可见图形都强制放大。

安全区通过 `safe-area-inset-*` 把 HUD 和普通屏幕收进可见区域，战场与背景保持满幅。手动异形屏设置把四边偏移应用到外框并重算根字号，弹窗与 toast 仍使用整个视口。可旋转触屏在竖屏且宽度不超过 1024px 时显示横屏提示；窄桌面窗口不强制显示。证据尺寸为桌面 1440×900、手机横屏 844×390，截图保存在 `.impeccable/review/ui-hub/`，本记录未重新运行浏览器。

## Elevation & Depth

这套界面采用暗色渐变面板、半透明层、扫描线、边线和局部阴影共同构建深度。共享面板实际阴影为 `0 .12rem .3rem rgba(0, 0, 0, .35)`；按钮悬停使用 `0 0 .18rem var(--btn-glow)`，活动标签页用薄荷色下划线与光晕。Hub 个别卡片有背景模糊，不应把它推广成每个面板的必选效果。

图层依次为屏幕 1、阶段横幅 40、连接提示 75、弹窗 80、toast 90、tooltip 95、旋转提示 100；调配覆盖层实际为 55。屏幕入场使用透明度，避免在屏幕根上增加 transform 后改变 fixed 浮层的定位容器。

## Shapes

按钮与面板以矩形、1px 细边和 L 形括号角组成，括号长度由实际 `--bk-l` 控制。六边物资章、八边等级芯片和圆形盟约盘、头像、雷达同属已有形态。没有全局圆角尺度；YAML 的 `circle` 只描述实际圆形，不表示所有控件都圆角，也不把未显式声明圆角的元素伪造为 radius token。

## Components

### 主机控制台登录

登录页使用「协议终端」构图：银灰横向标题栏与深色正文形成主要分区，左侧采用项目既有括号城堡标识，
薄荷色标明访问状态与主操作，少量金色识别条延续游戏配色。桌面侧栏与表单并列，760px 以下侧栏收成状态条。
Latin 标识复用 Novecento Wide，中文使用现有系统回退；表单保留明确的焦点、禁用、处理中和错误反馈。

### Buttons

共享按钮默认高（`.5rem`）、水平留白（`.26rem`）；小、大、特大分别高（`.36rem` / `.64rem` / `.84rem`）。薄荷主按钮使用深色字，填充变体右侧有斜纹与顶端渐变；secondary 保留暗底，ghost 透明，amber / ice / danger 保持其真实变体。悬停出现括号角与光晕，按下下移（1px），键盘聚焦保留括号指示；触屏不遗留 hover 括号。请求进行中在 250ms 后显示底部扫条，禁用和加载状态使用现有组件逻辑。

### Inputs / Fields

共享输入框以暗底、细边、括号与标签组成，聚焦时边框和图标转薄荷色并出现轻光晕；无效状态改红边，禁用状态降低不透明度。密钥输入使用数字字族、加宽字距和大写；保留本库自定义密钥验证，不能只复制外观。

### Navigation

共享标签页采用横向条目、细底线和活动项薄荷下划线。顶栏按空间换行和隐藏次级标签，保留可访问名称；长列表、抽屉与弹窗内部可以滚动。

### Cards / Containers

共享面板使用扫描纹理与暗渐变，标题区底部分隔、内容留白（`.22rem`）。Hub 功能条目使用半透明近黑底与薄荷左边线；等待室席位卡、调配干员卡与结算队友卡按各自实际结构表达头像、阵容与准备状态，不合并成通用网页信息卡。

### Signature Components

六边物资章、八边等级芯片、圆形盟约图标和七段倒计时承担游戏数值表达；真实素材存在时使用本机资源，没有资源则沿用现有 CSS / SVG 回退。结算保留雷达开场 → 个人战报 → 同盟的舞台流程；阶段转场、Hub 背景和干员调配采用来源动效语法。

共享交互时长为 150 / 200 / 250ms，缓动为 `cubic-bezier(.2, .8, .2, 1)` 与 `cubic-bezier(.6, 0, .3, 1)`。调配入场有 150ms 黑幕、分组错峰与 300ms 关闭保留期，不能强制缩成共享悬停时长。`prefers-reduced-motion` 缩短动效，并在各屏幕与设备规则中停止连续动画；Hub 的 `data-motion="off"` 停止背景动画。

## Do's and Don'ts

### Do:

- 个人数据入口紧接大厅统计数据，复用 HubTile，不另设局部缩放算法。弹窗复用 Modal；
  内容内部滚动，恢复码可选取，所有动作保留 44px 触区；640/844/1280/1920 横屏与特大字号复核。

- **Do** 以实际 theme、components 和各屏幕 CSS 为视觉事实，保留 isomerpoi 仿游戏世界与现有来源署名。
- **Do** 将文字缩放、安全区、内部滚动和触区适配与游戏坐标分开处理。
- **Do** 复用真实皮肤、聊天拖动、标点、联动模型、观战、回放及本机控制台能力。
- **Do** 让界面字符串经过 `t('…')`，维护全部语言包；让资源从当前机器库存同源加载。

### Don't:

- **Don't** 覆盖玩法规则索引 `docs/DESIGN.md`，或虚构 `PRODUCT.md` 产品主张。
- **Don't** 为打开来源入口而伪造服务器能力；匹配、云社交、玩家控制台和赞助不在本次适配范围。
- **Don't** 为新增辅助说明沿用资源面板已经修正的低对比度文字。
- **Don't** 将下载或提取的游戏素材写入 Git；普通 HTTP 局域网仍须保留资源预热回退。

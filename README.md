# 卫戍协议：盟约 · Stronghold Protocol: Alliance

《明日方舟》季节性自走棋塔防玩法「卫戍协议：盟约」的**非官方同人复刻**：浏览器即开即玩，单人或 1–4 人联机合作。

本仓库是 [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) 的扩展分支，面向自己开服、和朋友联机的玩家。游戏本体、规则和主要实现都来自上游。本分支在此基础上增加了主机控制台、休整期回档、对局统计、联动自选干员和可选皮肤。当前基于上游 **v0.2.3**。

![version](https://img.shields.io/badge/version-0.2.3-2ea44f)
![license](https://img.shields.io/badge/code%20license-GPL--3.0--or--later-blue)
![node](https://img.shields.io/badge/node-22%20%7C%2024-339933)

English summary: [below](#english).

## 声明

> [!IMPORTANT]
> - 本项目是玩家自制的**非官方同人作品**，与上海鹰角网络科技有限公司（Hypergryph）、Yostar 及其关联方**没有任何关系**，没有得到它们的授权或认可。
> - 《明日方舟》及「卫戍协议」相关的名称、角色、美术、音乐、音效、文本与数据等素材，版权归原权利人所有。这些素材**不适用**本项目的 GPL-3.0 许可证，GPL 只覆盖本项目自己编写的代码。
> - 仅供学习交流与个人非商业使用。**严禁任何形式的盈利**，包括但不限于：售卖本项目或整合包、付费下载或付费分发、收费服务器或收费代开、广告 / 打赏 / 会员等变现方式，以及其他任何商业用途。
> - 仓库源码不包含游戏的美术与音频素材，只有由官方数据表生成的数据和几张游戏截图，这些同样不适用 GPL。素材在本机安装。请勿将素材用于本项目以外的用途或单独再分发。完整条款见 [NOTICE.md](NOTICE.md)。
> - 权利人如认为本项目侵犯其权益，请通过 Issue 联系，我们会**立即删除**相关内容。
> - 本项目按「现状」提供，**不提供任何担保**，使用风险自负。

| 同盟房间 | 策略轮选 | 休整期（商店 / 盟约） |
|---|---|---|
| ![房间](docs/img/room.jpg) | ![策略](docs/img/band-draft.jpg) | ![休整期](docs/img/prep.jpg) |
| **部署方向轮盘** | **作战** | **最终攻势** |
| ![方向](docs/img/facing-wheel.jpg) | ![作战](docs/img/combat.jpg) | ![最终攻势](docs/img/final-assault.jpg) |

## 目录

- [声明](#声明) · [本分支的扩展](#本分支的扩展) · [简介](#简介) · [功能一览](#功能一览)
- [快速开始](#快速开始)：[从源码运行](#从源码运行) · [Windows 开服脚本](#windows-开服脚本) · [可选素材](#可选素材) · [上游整合包](#上游整合包)
- [主机控制台](#主机控制台) · [系统要求](#系统要求) · [端口与配置](#端口与配置)
- [和朋友一起玩](#和朋友一起玩) · [操作](#操作) · [本地数据与隐私](#本地数据与隐私)
- [文档](#文档) · [开发与测试](#开发与测试) · [项目结构](#项目结构) · [跟进上游](#跟进上游)
- [许可证](#许可证) · [致谢与数据来源](#致谢与数据来源) · [贡献](#贡献)

## 本分支的扩展

| 扩展 | 内容 |
|---|---|
| 主机控制台 | 只在开服电脑本机打开的管理页面，可以查看房间与玩家，调整 LP、金币、商店等级、盟约层数、装备、效果与机变卡，还能暂停 / 继续（仅独立模拟）、判定战斗胜负、结束对局。详见[主机控制台](#主机控制台) |
| 休整期回档 | 每回合休整期开始时自动存档，可以回到指定回合，随机数状态和统计一起恢复。存档只保存在当前服务器进程里 |
| 统计与对局记录 | 本局曲线、每回合详情、干员伤害排行（累计和单回合）。对局结束后写入本机记录，可以在控制台回看 |
| 敌人日程 | 查看各回合候选敌人组合、抽取概率和实际出怪，可以指定敌人组合，也能设置休整期时长 |
| 联防叠层（可选） | 本分支的自定义规则，默认关闭。开启后，援助干员在联防中重新获得每场战斗的叠层额度，新增层数在结算后保留，上限仍是 999 |
| 自选与联动干员 | 控制台可以发放自选干员、选技能和模组、改技能。自选池新增 7 名联动干员：灰烬、艾拉、麒麟R夜刀、玛露西尔、丰川祥子、结城理、焰狐龙梓兰，共 79 名（上游 72 名） |
| Windows 开服脚本 | 一键启动游戏和 cloudflared 公网隧道，另有停止服务器的脚本，见 [Windows 开服脚本](#windows-开服脚本) |
| 可选皮肤与预加载 | 皮肤目录覆盖 115 名干员、174 套皮肤，支持单选、一键随机装备、联机同步和观战显示，还能手动预加载素材（可以取消） |

几点补充：

- **皮肤**只改外观，不影响战斗数值和战斗哈希。皮肤素材要另外安装。随机装备只从已安装、可用的非原皮里抽，没有就用原皮。商店、奖励和详情页的半身立绘仍然是默认资源。见 [docs/SKINS.md](docs/SKINS.md)。
- **联防叠层**在控制台「设置 → 联防叠层」里开关，对所有房间生效，从下一次联防开始起作用，重启后保留。最终攻势和隐秘核心不叠层。
- **联动干员**的技能实现参考 [BBleae/Stronghold-Protocol](https://github.com/BBleae/Stronghold-Protocol)，部分专属视觉效果还没做完，见 [docs/LOCAL-DEV.md](docs/LOCAL-DEV.md#8-联动干员进自选池)。
- **皮肤功能**参考 [Paper-Yuan 的融合版本](https://github.com/Paper-Yuan/Stronghold-Protocol/releases/tag/v0.2.1-fusion) 和[上游 PR #85](https://github.com/sganggs/Stronghold-Protocol/pull/85)。

完整的改动和验证记录见 [docs/LOCAL-CHANGELOG.md](docs/LOCAL-CHANGELOG.md)。

## 简介

「卫戍协议：盟约」是自走棋加塔防的玩法。休整期在调度中心招募干员、摆阵、配装备；作战期干员自动部署，迎击从红门涌来的敌人，漏过去的敌人会扣目标生命值。本项目在浏览器里复刻了这个玩法，规则和数值尽量对照官方数据表与 PRTS 核对。

- 有**独立模拟**（单人）和**同盟模拟**（1–4 人**合作**，没有 PvP，空位可以加 AI 队友）两种模式。
- 服务器是一个 Node.js 程序。**战斗在每个玩家的浏览器里模拟**（和官方一样），服务器只负责经济和回合，所以一台低功耗小主机就能开服。
- 仍有少数规则是按推断实现的，发现和官方不一致的地方欢迎在 Issue 里反馈。上游各版本的改动见 [CHANGELOG.md](CHANGELOG.md)。

## 功能一览

- **完整的一局**：确认本局信息 → 策略轮选（40 名策略）→ 14 回合 → 结算称号。险境及以上难度满足条件时，会进入第 15 回合「隐秘核心」。
- **4 种难度**：标准 / 险境 / 绝境 / 终极，独立和同盟各有一套参数，都取自官方数据。
- **休整期**：招募、刷新、冻结、升级调度中心；有整备区和临时整备区；从整备区拖到棋盘上部署，用**方向轮盘**选朝向。同盟模拟里大家共用卡池。
- **晋升精锐**：3 名同名干员自动合成精锐，并获得一次高一阶的免费招募。
- **干员与调配**：112 名可招募干员（另有精锐），各有技能、天赋和特质。开局前可以给每名干员选携带的技能（283 个技能全部手工实现），也可以给精锐选模组。
- **盟约与层数**：23 个盟约（8 个势力核心盟约，其余为附加盟约），层数整局保留，每个盟约最多 999 层。
- **装备与机变**：装备与法术，同名装备可以合成，特定组合会触发盟约效果；已配发的装备锁定在干员身上。部分回合开始前有机变选卡，内容包括装备、资金、干员、层数、悬赏等。
- **自动作战**：
  - 技能按官方「技能策略」自动释放。
  - 按接触半径阻挡，阻挡者倒下时由接触到的干员接替。
  - 有元素损伤与元素爆发。
  - 召唤物由玩家手动摆放。
  - 推开 / 拉拽按力度和重量计算。
  - 被击倒的干员留在原地，显示再部署倒计时。
- **地形与敌人**：阻隔工事、射击台、源石流吹风机、沼泽、排气格栅、涨潮等地形装置；空中与近地悬浮敌人；悬赏敌人。
- **联防**：有人漏怪、又有人完美作战时，完美作战的队友会带着阵容去帮忙拦截漏掉的敌人。
- **最终攻势与隐秘核心**：两人共享一个战场，全队一起削减同一条领袖血条。共 10 个敌方领袖，巨型领袖的受击范围约 5×3 格，采用官方的限伤规则。
- **结算称号**：卫戍之星、不朽盟约、坚若磐石等 6 个称号。
- **断线重连**：
  - 同盟模拟断线后 10 分钟内重新打开页面，就能回到原座位。掉线期间按原阵容自动作战，也可以「暂离」交给 AI 托管。
  - 独立模拟 24 小时内可以回来继续，需要用同一个浏览器。
- **交互细节**：漏怪时顶栏的目标生命值实时减少（结算时确定）；点选、拖放和配发装备都按地上的方格；购买、升级和机变选卡都要点两次确认；只有一名玩家时，除作战外不计时。
- **画面与声音**：真实 Spine 小人、官方 BGM 与音效、表情（6 套，每套 6 个）、作战特效；可选官方 3D 棋盘（贴图要从本机客户端提取）。
- **多语言**：简体中文（默认）、English、日本語、한국어、繁體中文，在标题画面或「设置」里切换。
- **手机与电脑**：支持触摸拖拽、长按查看详情，推荐横屏；「设置」里可以调低画质。

## 快速开始

本仓库**没有发布整合包**，要用本分支的扩展，只能从源码运行。

### 从源码运行

需要 Node.js 22 或 24（LTS）和 Git。

```bash
git clone https://github.com/zhewang448/Stronghold-Protocol.git
cd Stronghold-Protocol
npm install        # 安装依赖（postinstall 会把 pixi / preact / three 复制到 public/vendor）
npm run setup      # 检查环境，并从公开镜像下载约 550 MB 美术 / 音频（可以中断，再次运行会续传）
npm start          # 启动服务器：http://localhost:3000
```

安装 Node.js 的方法：

- Windows：`winget install OpenJS.NodeJS.LTS`，或到 <https://nodejs.org/zh-cn/download> 下载。
- macOS：`brew install node@22`，或到官网下载。
- Linux：用发行版的包管理器，或 nvm、fnm。

其他启动方式：

- 也可以直接运行上游的启动脚本：Windows 用 `scripts\start-windows.bat`，macOS / Linux 用 `scripts/start.sh`。第一次运行会自动安装依赖、下载素材，然后启动服务器并打开浏览器。
- 素材下载优先走 GitHub，失败时自动改用 jsDelivr。国内网络可以试试 `node tools/setup.mjs --asset-source=mirror`，见 [docs/DEPLOY.md](docs/DEPLOY.md)。
- `npm run doctor` 可以随时诊断：Node 版本、素材是否完整、端口占用、局域网地址和防火墙。

**更新**：先停止服务器，然后依次运行 `git pull --ff-only`、`npm install`、`npm run setup`，再启动。如果你改过本地源码，先保存好改动再更新。不要把上游的更新包直接覆盖到本仓库目录里。

### Windows 开服脚本

本分支新增的两个脚本，都可以直接双击运行：

| 脚本 | 作用 |
|---|---|
| `scripts\start-tunnel.bat` | 先结束占用端口的旧服务器和隧道，再启动服务器和 [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) 临时隧道。窗口里会列出本机、局域网和公网（`*.trycloudflare.com`）地址，并持续输出日志。关闭窗口就全部停止。参数：`--port 3001`，或用 `--no-tunnel` 只开局域网 |
| `scripts\stop-server.bat` | 结束占用游戏端口的进程，以及指向这个端口的 cloudflared |

使用前要先装 cloudflared：`winget install Cloudflare.cloudflared`。临时隧道的地址每次启动都会变，国内访问延迟可能偏高。其他脚本（开机自启等）见 [scripts/README.md](scripts/README.md)。

### 可选素材

- **皮肤**：运行 `node tools/install-skins.mjs --all`，然后重启服务器。详见 [docs/SKINS.md](docs/SKINS.md)。
- **本地客户端素材**：有些素材要从本机的《明日方舟》PC 客户端提取，包括：
  - 官方 3D 棋盘
  - 部分官方界面图标
  - 灼热 / 炽焰源石虫
  - 39 个召唤物的模型

  支持 Windows 原生客户端，以及 macOS 上的 CrossOver 或 PlayCover。`npm run setup` 检测到客户端时会询问是否提取，需要 Python 3.8 以上，依赖装在项目内的 `.venv-extract` 里。之后可以用 `node tools/setup.mjs --local` 重新提取，或者用 `--game "<…/StreamingAssets/AB/Windows>"` 指定客户端路径。

  没有客户端时游戏照常运行，这些内容会换成替代样式：2D 棋盘、样式相近的图标、染色的普通源石虫、召唤物头像。表情和「玩法说明」的教程图随上面的素材一起从公开镜像下载，不需要客户端。没有客户端的服务器（例如 Linux VPS）可以从上游**同一版本**的整合包（完整包，精简包里没有）复制 `public/assets/local/` 和 `data/local-assets.json`。详见 [docs/DEPLOY.md](docs/DEPLOY.md) 的「本地客户端素材」。

### 上游整合包

只想玩原版、不需要本分支扩展的话，可以用 [上游 Releases](https://github.com/sganggs/Stronghold-Protocol/releases/latest) 里的完整包或精简包，解压就能运行。整合包运行的是上游版本，**不包含本分支的功能**。

## 主机控制台

服务器启动时，会同时开一个**只监听 `127.0.0.1`** 的管理页面。地址打印在启动日志的 `Console:` 那一行，端口默认是游戏端口加 100（`PORT=3000` 时就是 `http://127.0.0.1:3100`）。访问令牌在每次启动时随机生成，嵌在页面里，局域网和公网隧道都访问不到。

- 能做的事：
  - 查看房间和玩家
  - 回到任一回合的休整期开始
  - 改 LP、金币、商店等级、盟约层数，加免费刷新
  - 发放干员、自选干员和道具，选技能和模组
  - 管理效果和机变卡，编辑棋盘
  - 查看和指定敌人组合
  - 判定战斗胜负（仅限客户端战斗模式）、结束休整期、暂停（仅限独立模拟）、结束对局、关闭房间
  - 查看本局统计和历史对局记录
  - 在「设置」里改休整期时长、开关联防叠层

  修改立即生效，不扣金币。
- `SP_ADMIN_PORT` 可以改端口；`SP_ADMIN=0`（或 `false` / `no` / `off`）可以关闭控制台。
- 在 Docker 容器里，控制台同样只监听容器内的 `127.0.0.1`，所以映射端口也打不开。
- 主机操作会改变对局状态，用之前请和同局的玩家商量好。

实现与维护见 [docs/LOCAL-DEV.md](docs/LOCAL-DEV.md)，各操作调用的引擎接口见 [docs/HANDOFF.md](docs/HANDOFF.md)。

## 系统要求

| 项目 | 要求 |
|---|---|
| 开服的电脑 | Windows / macOS / Linux，Node.js 22 或 24（LTS）。磁盘约 700–850 MB（素材、依赖和本地提取的贴图），装皮肤还要额外空间。内存空闲约 100 MB，每多一局再加几 MB |
| 玩家 | 支持 WebGL 的现代浏览器（Chrome / Edge / Firefox / Safari 最新版），电脑、手机或平板（横屏）都可以 |
| 网络 | 每位玩家第一次进游戏时，要从开服的电脑下载几十 MB 素材，之后走浏览器缓存。对局中的流量很小 |

显卡较弱时，可以在「设置」里调低画质，或者在网址后面加 `?board=2d`（强制 2D 棋盘）或 `?render=fallback`（不用 WebGL 的简化画面）。

## 端口与配置

游戏默认监听 **TCP 3000**。换端口的方法：启动脚本加 `--port 3001`，或者设置环境变量 `PORT`。

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 游戏监听端口 |
| `HOST` | `::` | 监听地址。默认的 `::` 是双栈，同一个端口同时接受 IPv6 和 IPv4。`0.0.0.0` 表示只用 IPv4；`127.0.0.1` 表示只允许本机访问，放在反向代理后面时用 |
| `SP_ADMIN_PORT` | `PORT + 100` | 主机控制台的端口（只监听 `127.0.0.1`） |
| `SP_ADMIN` | 开启 | 设为 `0` / `false` / `no` / `off` 时关闭主机控制台 |
| `SP_COMBAT` | `client` | `client`：每个玩家的浏览器模拟自己的战斗，服务器负载极低。`server`：由服务器模拟并推流 |
| `SP_VERIFY` | `off` | 服务器是否复算客户端上报的战斗结果。`off` 不复算；`sample` 约 1/8 抽查；`all` 全部复算，更耗 CPU |
| `TRUST_PROXY` | `auto` | 是否信任 `X-Forwarded-For` 等转发头。`auto` 只信任来自本机或内网的代理；`1` 总是信任；`0` 从不信任 |
| `SP_ASSET_SOURCE` | `direct` | 素材下载源。`mirror` 表示优先用 GitHub 前缀镜像（`SP_GITHUB_PROXY` 可以换前缀），见 [docs/DEPLOY.md](docs/DEPLOY.md) |
| `DEBUG` | 空 | 设为任意值就输出详细日志 |
| `SP_NO_BROWSER` | 空 | 设为 `1` 时，启动脚本不自动打开浏览器 |
| `SP_BOT_EMOTES` | 空 | 设为 `0` 时，关闭 AI 队友在对局中的表情回应 |

各环境下的设置方式：

- macOS / Linux：`PORT=8080 npm start`
- PowerShell：`$env:PORT=8080; npm start`
- cmd：`set "PORT=8080" && npm start`

健康检查接口：`GET /healthz`。

## 和朋友一起玩

### 局域网

1. 打开页面，输入昵称，选**同盟模拟**，创建房间。房主选难度，可以添加或移除 AI 队友；开始前也可以把其他博士移出房间（对方可以凭密钥重新加入）。
2. 把 4 位字母的**同盟密钥**发给朋友，或者发「复制链接」得到的 `http://<地址>:3000/?room=密钥`。
3. 所有人点「准备就绪」后，房主开始游戏。
4. 同一个 Wi-Fi 或路由器下的朋友，打开启动窗口里列出的地址（形如 `http://192.168.x.x:3000`）就能进来。
   - 打不开多半是防火墙的问题。Windows 第一次启动时，在弹窗里允许「专用网络」；也可以运行 `npm run doctor` 查看具体命令。
   - 访客 Wi-Fi 经常开着「AP 隔离」，也会导致连不上。

刷新页面或断线后，同盟模拟 10 分钟内、独立模拟 24 小时内重新打开，就能回到原座位。服务器把房间和对局都存在内存里，**重启服务器会结束所有对局**，回档存档也会一起清空。

### 不在同一局域网

下面是几种常见做法，按自己的情况选一种就行。提到的工具和服务只是举例，本项目和它们没有任何关系，也不是推荐。安装、费用和使用规则以各自的官方说明为准。部署细节（防火墙、开机自启、反向代理与 HTTPS、Docker）见 **[docs/DEPLOY.md](docs/DEPLOY.md)**。

| 方式 | 怎么做 | 适合 |
|---|---|---|
| **组网工具（虚拟局域网）** | 例如 Tailscale、ZeroTier、EasyTier、蒲公英。开服的人和朋友都装同一个工具，加入同一个网络，朋友用 `http://<虚拟 IP>:3000` 访问 | 固定的几个熟人，不暴露到公网。朋友也要装客户端 |
| **内网穿透 / 隧道** | 只有开服的人运行客户端，朋友直接打开网址。例如 Windows 上用本分支的 `start-tunnel.bat`（cloudflared 临时地址）、自建 frp（需要一台有公网 IP 的服务器）、国内的公共穿透服务 | 不想改路由器、没有公网 IP |
| **云服务器 / VPS** | 在 VPS 上从源码运行，或者用仓库自带的 `Dockerfile`；再用 Caddy / Nginx 加上 HTTPS。面向大陆玩家时要注意回程线路；大陆服务器绑定域名需要 ICP 备案 | 想长期开服，玩家分布在不同地区 |

通用注意事项：

- 游戏是**单个常驻 Node.js 进程加 WebSocket**（路径 `/ws`），只能跑一个实例，而且必须部署在域名根路径。Vercel 这类 Serverless 平台和 GitHub Pages 这类静态托管都用不了。反向代理要转发 WebSocket 升级。
- 游戏没有账号系统，**知道地址的人都能进来**。只把地址发给朋友，不要公开发布，也不要搭公开大厅。
- 公网隧道和端口转发只应该转发游戏端口，不要把主机控制台暴露出去。

## 操作

| 操作 | 方法 |
|---|---|
| 购买 / 升级调度中心 / 机变选卡 | 点一次选中，再点一次确认（`D` 升级） |
| 部署 / 移动干员 | 从整备区拖到棋盘格上，会出现方向轮盘。往上 / 右 / 下 / 左滑动选好朝向后松手；松在中心或点「✕ 点击取消」就取消 |
| 调整朝向 | 把干员拖回它自己的格子，再选方向 |
| 出售 / 撤退 / 销毁装备 | 点击单位所在的格子，用底部的「出售 +1」「撤退」按钮；也可以把棋盘上的干员拖回整备区撤退。整备区里的装备和法术只能「销毁」 |
| 装备 | 把装备拖到干员所在的格子上（每人 2 件，满了会弹出替换窗口，被换下的那件会销毁）；法术拖到地块上并选方向 |
| 查看详情 | 右键或长按单位 / 卡牌 |
| 快捷键 | `R` 刷新 · `F` 冻结 · `D` 升级 · `Q` 撤退 · `X` 出售选中的干员 · `Space` 准备就绪 · `Esc` 取消 / 关闭。除 `Esc` 外都可以在「设置 → 快捷键」里改键（[玩法指南 §11](docs/PLAYING.md#11-快捷键)） |
| 暂停（独立模拟） | 作战中点顶栏的「暂停」或按 `Space`；同盟模拟的作战不能暂停 |
| 表情 | 左下角「交流」，左右滑动（或按方向键）换主题，冷却 1 秒 |
| 观战 | 自己的作战结束后（或在休整期）点左侧队友头像，选「前往查看」；不参战的朋友可以在大厅输入同盟密钥点「观战」（每个同盟最多 2 名观战者） |
| 统计（本机） | 标题画面、大厅、等待室的「统计」，只存在本机浏览器里，可以导出和导入（[玩法指南 §13](docs/PLAYING.md#13-统计本机)） |

完整的规则、数值和小技巧见 **[docs/PLAYING.md](docs/PLAYING.md)**，游戏内左下角也有「玩法说明」。

## 本地数据与隐私

- 服务器端：对局记录存在 `logs/results/`，主机设置存在 `logs/admin-settings.json`。
- 浏览器端：统计、调配偏好和恢复身份都存在玩家自己的浏览器本地。
- `.gitignore` 和 `.dockerignore` 已经排除日志、缓存、本机配置、统计和调配导出、密钥等文件。游戏素材也不会进入 Git。
- 分享对局导出、运行日志或截图之前，先检查里面有没有玩家名字、房间码、地址和 token。

详见 [docs/PRIVACY.md](docs/PRIVACY.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/LOCAL-CHANGELOG.md](docs/LOCAL-CHANGELOG.md) | 本分支的扩展、上游同步与验证记录 |
| [docs/LOCAL-DEV.md](docs/LOCAL-DEV.md) | 本分支的开发笔记：控制台、回档、联动自选的实现、测试与已知问题 |
| [docs/HANDOFF.md](docs/HANDOFF.md) | 维护交接：现状、常见任务、待办、控制台接口 |
| [docs/SKINS.md](docs/SKINS.md) | 皮肤素材安装、随机装备、同步、预加载与显示限制 |
| [docs/PRIVACY.md](docs/PRIVACY.md) | 本地数据与忽略规则 |
| [scripts/README.md](scripts/README.md) | 各启动、开服、开机自启脚本的说明 |
| [CHANGELOG.md](CHANGELOG.md) | 上游的更新记录 |
| [docs/PLAYING.md](docs/PLAYING.md) | 玩法指南：流程、经济、招募与晋升、摆阵、联防、盟约、最终攻势、结算称号 |
| [docs/DEPLOY.md](docs/DEPLOY.md) | 部署指南：防火墙、开机自启、组网 / 隧道、反向代理与 HTTPS、Docker、systemd、排错 |
| [docs/WINDOWS.md](docs/WINDOWS.md) | 上游的 Windows 便携包打包方法 |
| [docs/DESIGN.md](docs/DESIGN.md) | 架构与契约（英文）：按章节号索引；现行规则在 `docs/design/`，历次修订在 `docs/history/` |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 代码地图（英文）：服务器、联机协议、前后端共用的战斗模拟、数据流、常见改动从哪里入手 |
| [docs/SIM.md](docs/SIM.md) · [docs/META.md](docs/META.md) | 战斗模拟引擎和对局 / 经济引擎参考（英文） |
| [docs/DATA.md](docs/DATA.md) · [docs/ASSETS.md](docs/ASSETS.md) | 生成的游戏数据；素材来源与清单（英文） |
| [docs/I18N.md](docs/I18N.md) · [docs/PACKS.md](docs/PACKS.md) | 界面语言与翻译；内容包格式（英文） |
| [docs/BALANCE.md](docs/BALANCE.md) | 难度模型与测量（英文） |
| [docs/research/](docs/research/00-INDEX.md) | 官方规则、数据与界面的调研记录 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 参与贡献：环境、测试、忠实原则、提交约定 |

## 开发与测试

```bash
npm run dev                 # node --watch：改了服务器代码自动重启
node --test                 # 单元 + 集成测试，约 6000 项，全量大约 10 分钟；缺少素材或浏览器的用例会自动跳过
node --test test/match/rewind.test.js                # 只跑某个文件
SP_E2E=1 node --test test/ui/mock.e2e.test.js        # 浏览器端到端测试
SP_REAL_E2E=1 node --test test/ui/real.e2e.test.js   # 还需要已下载的素材
RENDER_E2E=1 node --test 'test/render/*.browser.test.js'   # 渲染测试，部分需要本地提取的棋盘贴图
GOLDEN_FULL=1 node --test test/golden.test.js        # 黄金结果全集（默认只跑快速子集）
node tools/perfbench.mjs --cpu 1,4,6 --profile       # 真实战斗的帧耗时基准
```

- 浏览器测试默认找 macOS 上的 Chrome。在 Windows / Linux 上要用 `CHROME_PATH` 指向 Chrome 或 Edge 的可执行文件，否则这些用例会被跳过。
- 全量测试不要同时开两份，性能用例会超时。
- 游戏数据由 `npm run build-data`（`tools/build-data.mjs`）从官方数据表生成，不要手工修改 `data/*.json`。
- 只重构、不改玩法的提交，不能改变 `test/golden/*.json`。有意改玩法时运行 `npm run golden:update`，检查差异后随改动一起提交（见 [test/golden/README.md](test/golden/README.md)）。
- 对局逻辑的约定（随机数、计时、脏标记、回档字段）见 [docs/LOCAL-DEV.md](docs/LOCAL-DEV.md) 和 [AGENTS.md](AGENTS.md)。
- 性能测试页 `/dev/battle-perf.html` 会在浏览器里跑一场真实战斗，实时显示帧率与逐帧耗时，可以在手机上打开测量。

## 项目结构

| 路径 | 内容 |
|---|---|
| `server/` | 入口 `index.js`。包括 HTTP 静态服务与 WebSocket（`http/`）、大厅、对局引擎（`match/`）、战斗模拟（`sim/`，浏览器与服务器共用），以及主机控制台（`admin.js`、`admin.html`）和回档（`match/rewind.js`） |
| `shared/` | 前后端共用的常量与网络协议 |
| `public/` | 浏览器客户端：原生 ES 模块，用 PixiJS + pixi-spine、three.js（3D 棋盘）、Preact + htm（UI） |
| `data/` | 由官方数据表生成的游戏数据、素材清单 `assets.json` 和皮肤目录 `skins.json` |
| `tools/` | `setup.mjs`、`doctor.mjs`、素材下载 `fetch-assets.mjs`、皮肤安装 `install-skins.mjs`、数据构建、本地提取 `local-extract/` |
| `scripts/` | 启动脚本（Windows / macOS / Linux）、Windows 开服与隧道（`start-tunnel.*`、`stop-server.bat`、`free-port.mjs`）、开机自启，见 [scripts/README.md](scripts/README.md) |
| `docs/` | 文档与调研 |
| `test/` | `node:test` 测试 |

## 跟进上游

本仓库会**定期跟进上游的版本和问题修复**。每次先完成扩展功能的兼容适配和测试，再合并进来，所以不保证和上游实时同步，也没有固定的发布周期。同步进度见 [docs/LOCAL-CHANGELOG.md](docs/LOCAL-CHANGELOG.md)。

遇到问题时，先看它和本分支的扩展有没有关系：

- 与本分支扩展有关的问题，在本仓库提 Issue。
- 与扩展无关、在[上游原版](https://github.com/sganggs/Stronghold-Protocol)也能复现的问题，请优先反馈到上游。

## 许可证

- **代码**：本项目自己编写的代码以 **GPL-3.0-or-later** 发布，全文见 [LICENSE](LICENSE)。另附一条 GPL 第 7 条的附加许可，允许与 pixi-spine 中的 Spine Runtimes 组合分发（见 [NOTICE.md](NOTICE.md)）。
- **游戏素材不在许可范围内**：《明日方舟》相关的美术、音乐、音效、文本与数据等，版权归原权利人所有，不适用 GPL。使用限制见上方的[声明](#声明)和 [NOTICE.md](NOTICE.md)。
- **第三方组件**各自遵循其许可证，包括 npm 依赖、`tools/local-extract/aklz4.py` 的算法（BSD-3-Clause）以及字体等。清单与许可证全文见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 致谢与数据来源

- 上游游戏实现与维护：[sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol)。本分支基于其代码继续开发，保留原许可证与声明。
- 联动干员技能参考：[BBleae/Stronghold-Protocol](https://github.com/BBleae/Stronghold-Protocol)。皮肤参考：[Paper-Yuan/Stronghold-Protocol](https://github.com/Paper-Yuan/Stronghold-Protocol)，以及 [AoyamaT1 的上游 PR #85](https://github.com/sganggs/Stronghold-Protocol/pull/85)。
- 游戏数据：[Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)。
- 素材来源：
  - [yuanyan3060/ArknightsGameResource](https://github.com/yuanyan3060/ArknightsGameResource)
  - [fexli/ArknightsResource](https://github.com/fexli/ArknightsResource)
  - [isHarryh/Ark-Models](https://github.com/isHarryh/Ark-Models)
  - [ArknightsAssets/ArknightsAssets2](https://github.com/ArknightsAssets/ArknightsAssets2)
  - 字体来自 [TimWangZi/The-font-of-Arknights](https://github.com/TimWangZi/The-font-of-Arknights) 和 Google Fonts（Noto Sans SC）

  详见 [docs/ASSETS.md](docs/ASSETS.md)。
- 规则核对参考：[PRTS 明日方舟中文 Wiki](https://prts.wiki/)。
- LZ4AK 解包：`tools/local-extract/aklz4.py` 的算法来自 [isHarryh/Ark-Unpacker](https://github.com/isHarryh/Ark-Unpacker)（BSD-3-Clause，经 MooncellWiki/UnityPy）。解析 Unity 资源用的是 [UnityPy](https://github.com/K0lb3/UnityPy)（MIT）。
- 库：
  - [PixiJS](https://pixijs.com/)（MIT）
  - [pixi-spine](https://github.com/pixijs/spine)（MIT；其中包含的 Spine Runtime 另受 [Spine Runtimes License](https://esotericsoftware.com/spine-runtimes-license) 约束）
  - [three.js](https://threejs.org/)（MIT）
  - [Preact](https://preactjs.com/) + [htm](https://github.com/developit/htm)（MIT）
  - [ws](https://github.com/websockets/ws)（MIT）

感谢以上项目的作者与维护者，也感谢鹰角网络带来这款游戏。

## 贡献

欢迎提 Issue 反馈 bug、与官方规则不一致的地方或改进建议，也欢迎提交 Pull Request。

- 环境准备、测试、忠实原则和提交约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 提交前请运行相关测试，并同步更新相关文档。文档用简体中文，代码与注释用英文。
- 提交的代码将以 GPL-3.0-or-later 发布。
- 不要提交任何游戏素材文件（`public/assets/` 等目录已被 `.gitignore` 排除）。
- 本项目坚持非商业：请不要提交广告、付费、打赏等任何形式的变现功能。

---

## English

An **unofficial, non-commercial fan remake** of Arknights' seasonal auto-chess tower-defense mode *Stronghold Protocol: Alliance*. It runs in the browser: solo, or 1–4 player co-op, with AI teammates to fill empty seats. Combat is simulated in each player's browser, so a low-power PC can host.

This repository extends [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) and is currently based on upstream v0.2.3. It adds:

- a localhost-only host console (`127.0.0.1`, game port + 100);
- rewind to any round's prep phase;
- match statistics and history;
- enemy scheduling;
- an optional rule for layer gains during co-op assistance (off by default);
- seven collaboration operators in the custom pool (79 in total);
- Windows scripts that start the game together with a cloudflared quick tunnel;
- optional skins with random selection and manual asset preloading.

**Run it:**

1. Install Node.js 22 or 24 and Git.
2. `git clone https://github.com/zhewang448/Stronghold-Protocol.git`
3. `npm install`
4. `npm run setup` (downloads about 550 MB of assets from public mirrors)
5. `npm start`, then open `http://localhost:3000`.

Optional skins: `node tools/install-skins.mjs --all` ([docs/SKINS.md](docs/SKINS.md)). This fork publishes no release bundles. The [upstream bundles](https://github.com/sganggs/Stronghold-Protocol/releases/latest) run the unmodified upstream game.

- **Languages:** Chinese (the default), English, 日本語, 한국어 and 繁體中文. Switch on the title screen or in Settings. Game texts come from the official clients. The Japanese, Korean and Traditional Chinese interface strings are machine translations; corrections are welcome ([docs/I18N.md](docs/I18N.md)).
- **Play with friends:** create a co-op room and share the 4-letter key or the `?room=KEY` link. On a LAN, use the address printed at start. Otherwise, use a virtual-LAN tool, a tunnel or a VPS ([docs/DEPLOY.md](docs/DEPLOY.md)). There are no accounts: anyone who has the address can join.
- **Issues:** report problems with this fork's extensions here. Report issues that also reproduce in the unmodified upstream game to [upstream](https://github.com/sganggs/Stronghold-Protocol).
- **Disclaimer:** not affiliated with or endorsed by Hypergryph or Yostar. All Arknights names, art, audio, text and data are © their respective owners and are **not** covered by this project's GPL licence. For study and personal non-commercial use only: no selling, paid distribution, paid servers or monetisation of any kind. Content will be removed at the request of the rights holders. Provided "as is", without warranty.
- **License:** the code is GPL-3.0-or-later ([LICENSE](LICENSE)); game assets are excluded.
- **Contributing:** see [CONTRIBUTING.md](CONTRIBUTING.md) (it ends with an English summary). The code map is [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

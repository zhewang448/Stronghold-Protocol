# 干员皮肤与预加载

本分支的可选外观扩展（2026-10-10 加入）。参考
[Paper-Yuan 的融合版本](https://github.com/Paper-Yuan/Stronghold-Protocol/releases/tag/v0.2.1-fusion)
与 [AoyamaT1 的 PR #85](https://github.com/sganggs/Stronghold-Protocol/pull/85)。
借鉴皮肤目录与选择方式；官方角色和皮肤美术的权利仍属于原权利人，项目保持非商业使用。

## 安装

完成正常的游戏数据与默认资源安装后执行：

```powershell
node tools/install-skins.mjs --all
# 直连较慢或失败时，使用现有公开镜像：
node tools/install-skins.mjs --all --asset-source=mirror
# 指定皮肤，PowerShell 下给含 # 的 id 加引号：
node tools/install-skins.mjs 'char_498_inside@kitchen#2'
# 使用已下载资源重新解析，不联网：
node tools/install-skins.mjs --all --offline
```

支持基础下载器的 `--asset-source=direct|mirror` 和 `SP_ASSET_SOURCE`。
完成后重启服务、刷新客户端，使冻结的数据副本和素材清单重新加载。
目录来自 `docs/research/operator-skins.json`（原始映射版本见文件的 source），由
`tools/build-data.mjs` 生成 `data/skins.json`，限定当前棋子和自选干员。当前目录 115 名干员、174 套皮肤。
资源在忽略的 `public/assets/` 中；选择器仅开放素材清单中已有头像和有效正面模型的皮肤。
失败项会报告，成功项保留，重新执行会利用下载缓存补齐。

安装器复用 `Downloader`、`processModels` 和 `resolveTemplate`，下载头像、正面和可用背面的
骨架 / 图集 / 所有纹理页，解析每套皮肤自己的动画、命中事件与边界。
缺失纹理页、无法解析的骨架、图集缺少附件时不安装该模型。
成功条目原子写入 `data/assets.json.chars[charId].skins[skinId]`；全部失败不改清单。
`tools/fetch-assets.mjs` 重建基础资源时也会重建已安装皮肤。
客户端没有下载或改写服务器资源的 WebSocket 接口。

## 选择和同步

在「干员调配」右侧详情，或「自选编队」的干员选择面板中选择皮肤 / 默认。
选择存于 `sp.pref.skins`，普通、精锐、自选棋子按同一 `charId` 共用，支持调配文件导入 / 导出。
旧文件没有 `skins` 字段时保留当前选择。「全部恢复默认」会一并清除皮肤偏好。
调配页顶部的「随机装备皮肤」为目录中的所有干员（含自选干员）随机选择一套已安装的可用皮肤，
不抽取默认外观；没有可用非默认皮肤的干员使用默认外观。再次点击可以抽到当前皮肤。

`room.skins { skins: { [charId]: skinId } }` 使用重请求限流桶，最多 256 项。
结构检查拒绝跨角色 id、路径和非字符串；目录检查丢弃未知皮肤。
服务器在 session / room seat / PlayerState 中保留选择，并在 `m.public.players[].skins` 发布非空偏好。
换肤可在对局中生效；重连和观战使用角色所属玩家的选择，AI 使用默认，补位单位与召唤物保持原模型。
皮肤不进入 battleInput、BattleSpec、UnitInfo 或战斗哈希，不改变数值或金标结果。
未安装皮肤回退默认；模型加载失败走现有 fallback 链；无背面时使用皮肤正面。
现有独立技能特效、语音、召唤物和半身立绘保持原资源。

## 当前显示范围

皮肤用于整备区、作战区的战斗模型及模型加载失败时的头像显示，选择面板显示对应皮肤头像。
商店购买卡片、奖励卡片和干员详情仍使用默认半身立绘；这是当前功能边界，购买后会使用已选皮肤的战斗模型。
安装器没有下载皮肤半身立绘，也不会用方形头像代替商店的纵向立绘。
核对 Paper-Yuan 的 `06cd3d0aafee6d9b1a3c542414fb847e16871a4d` 与上游 PR #85 的
`83dbfb84be46699617fd45440d9eae762d3f94f1` 后，两者的商店同样通过 `chessPortraitUrl` 显示默认立绘。

## 手动预加载

「设置」中的「素材预加载」读取已安装素材和可选本地提取清单。
可选择画面素材或包含音频的全部素材，显示进度、失败数，支持取消与再次运行。
仅请求本站静态文件，4 路并发，每项超时 30 秒，以 `force-cache` 下载并流式读取。
预加载不解析骨架、不占用模型缓存；浏览器 HTTP 缓存可能按自身容量策略清退资源。
未安装皮肤不在清单中，也不会通过预加载安装。

## 验证

```powershell
node --test test/skins.test.js test/ui/preload.test.js test/ui/loadout.test.js test/assets.test.js
$env:SP_E2E='1'; $env:CHROME_PATH='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
node --test test/ui/skins.e2e.test.js
node tools/i18n.mjs check --all --strict
npm run ci
npm run golden
```

2026-10-10 的本地验证记录：

- 安装 174/174 套皮肤，343/343 个模型解析成功。
- 核心皮肤、预加载、调配、打包、素材及文档定向检查：144 项通过、0 失败。
- 加入随机装备后，皮肤、调配和文档检查：62 项通过、0 失败；实际浏览器测试 1 项通过，
  覆盖随机按钮、保存与同步、桌面 / 手机横屏、正背面动画、战斗换肤和恢复默认。
- 文档整理后的同组核心定向复查：145 项通过、0 失败（包括新增随机装备测试）。
- 四个语言包严格检查：1193 个词条全部翻译，0 缺失、0 错误；启动、lint、导入边界和类型检查通过。
- 全部 296 个 golden 场景一致，没有重新生成金标。
- Node 24.19.0 全量测试当时为 6053 项、6036 通过、2 失败、15 跳过。打包样本数量已修复且单独检查通过；
  另一项是全量并发下的既有双人 Boss 性能阈值，单独复测通过（最佳 0.1196 ms/tick，阈值 0.5 ms）。
  修复后没有再次重跑整套测试，因此不将本次记录表述为全量 CI 全绿。

# 公开房间大厅（#12）

2026-10-26：以当前 0.3.3 扩展版为基线，适配公开合作房间目录。

## 来源与复用

参考 NeoPecos/Stronghold-Protocol 的 GPL-3.0-or-later 实现，提交
`2cadc6183c133fb22f5853c15db945bbaf4ce700`：`server/lobby.js` 的 `listRooms` / `setInviteOnly`，
以及 `public/js/screens/lobby.js` 的房间目录。源地址：
<https://github.com/NeoPecos/Stronghold-Protocol/tree/2cadc6183c133fb22f5853c15db945bbaf4ce700>。

保留本库已有 Hub、`HubEntry`、`MatchmakingModal`、`ProtocolSelect`、`RoomOptions`、
`useDialogFocus`、`room.join`、`room.spectate`、请求关联回复、重限流桶和重启恢复。
不合并来源分支，不移入账号、战绩服务、机器人或游戏素材。公开目录及其排序为维护者请求的
`[ASSUMED]` 复刻便利功能，不改变战斗规则或 golden。

## 玩家行为

- 主大厅右下角按「独立模拟、同盟模拟、同盟大厅」并排排列；「同盟大厅」复用原公开列表弹窗，同盟选择的「模拟邀约」仍通向同一列表。顶部不重复放大厅入口，首页不再常驻「缺人同盟」列表。
- 「同盟大厅」和相邻主入口一样，在卡片左上方显示图标及小字；公告和更新内容的图标、文字作为一组在按钮内水平与垂直居中。
- 公告、更新内容复用原按钮和弹窗，从顶部移到成就卡片右侧，上下排列；宽度不超过 1100px 或高度不超过 560px 时放到卡片下方横排，保持可点和大字换行。原成就卡片宽度不缩小。
- 新合作房默认公开；创建协议页可选「私密房间」，房主也能在同盟设置修改。私密房仍可凭密钥或邀请加入。
- 只列出仍有真人的公开合作房；独立模拟、测试房、私密房和已销毁房不列出。
- 等待中有空位才能加入，AI 和掉线保留位占用容量；进行中和满员房仍能观战，观战席满后按钮禁用。
- 显示房主、难度、玩法版本、实际容量、观战人数及玩法插件标识；加入后沿用现有版本和插件内容加载检查。
- Hub 和弹窗共用一条轮询：平时 10 秒，弹窗打开 4 秒；不可见或离线时暂停，恢复可见时立即刷新。失败保留上次结果并可重试。
- 在线人数及隐身房主名遵循既有社交策略；计数关闭时不推断在线人数。隐身不隐藏其公开房间，需使用私密开关隐藏房号。

## 协议及兼容

`room.list {}` 使用现有 `rid` 对应的 `ok` 返回 `rooms`、`roomsCount`、`matchesCount`、`online`，
不另建 S2C 事件。计数只对应本次公开列表；`online` 为既有社交策略允许的在线可见人数，关闭时为 null。

每条摘要的字段白名单：`code`、`hostName`、`difficulty`、`version`、`humans`、`bots`、`maxSeats`、
`spectators`、`inMatch`、`joinable`、`watchable`、`occupied`、`modded`。优先可加入房，随后满员等待房，
最后进行中房；同组按空位数及房号排序。没有加入特有的活跃心跳或招募标记。

`room.create` 增加可选布尔 `private`，缺省 false；`room.setPrivate { private: boolean }` 仅合作房房主
开局前可用。`room.state.private` 仅 true 时出现，旧普通房默认 wire shape 不变。私密设置进入既有恢复记录，
重启后不会变成公开房；旧记录缺省公开。`room.list` 复用 `HEAVY_TYPES` 的既有桶。

## 验证

`test/lobby-list.test.js` 覆盖筛选、摘要白名单、容量、AI/掉线保留位、隐身、权限、真实 WebSocket
加入/中途观战和限流；`test/recovery.test.js` 核对私密属性恢复；
`test/ui/room-directory.e2e.test.js` 用真实服务器检查入口、桌面/触屏布局、私密开关、加入、进行中观战、
空列表、失败重试、Escape 和重复轮询。

## 后续匹配（2026-10-26）

已另行接通本服真人匹配，使用同盟模拟内部搜寻入口，不新增首页卡片。公开房间列表仍只负责浏览与手动加入/观战；匹配仅向主动招募房补人。详见 [真人匹配](MATCHMAKING.md)。

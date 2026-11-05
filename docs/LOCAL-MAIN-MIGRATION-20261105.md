# 本地 main 合并与工作树迁移（2026-11-05）

当前实施位置：`E:\Stronghold-Protocol`，分支 `main`。
旧位置：`C:\Users\34948\.codex\worktrees\dynamic-illustrations-new-operators\Stronghold-Protocol`。

功能提交 `96526162` 已通过三方合并形成 `ae9cb9df`。合并前 main 为 `29581487`，其立绘调整并入替换页面的提交完整保留；
自动合并后的 index tree 与 `git merge-tree --write-tree` 的结果相同。保留本地备份分支 `codex/backup-main-before-dynamic-20261105`。

历史动态立绘、客户端设置报告中的旧绝对路径是当时的验证位置；文件现迁到主目录下相同相对路径。
当前四个事务角色为：

- `E:\Stronghold-Protocol\.cache\dynamic-illustrations-new-operators\transaction\MODIFIED_FILE`
- `E:\Stronghold-Protocol\.cache\dynamic-illustrations-new-operators\transaction\DIFF_FILE.patch`
- `E:\Stronghold-Protocol\.cache\dynamic-illustrations-new-operators\transaction\VERIFICATION.txt`
- `E:\Stronghold-Protocol\.cache\dynamic-illustrations-new-operators\transaction\ROLLBACK.sh`

迁移清单、命令及逐文件 SHA-256 位于 `E:\Stronghold-Protocol\.cache\dynamic-illustrations-new-operators\merge-to-main-20261105`。
191,421 个忽略文件（约 16.93 GB）已复制或分别保存，7 个目录链接改指向主目录。
29 个内容冲突保留主目录原值，并保存旧工作树版本；三个特效文件采用已验证的新版本，更新前的主目录文件分别保存在 `main-before`。
资源预载清单由正式工具重建，动态立绘审计 74/74 通过。游戏素材、缓存、依赖和本机配置均保持忽略，没有放入 Git。

审阅游戏/控制台地址仍为 `http://127.0.0.1:43465` / `http://127.0.0.1:43466`，
旧动态审阅地址 `http://127.0.0.1:50780` / `http://127.0.0.1:50781` 也已迁到主目录。
迁移旧进程前确认没有房间或对局，用户浏览器原地址和本机偏好可继续使用。

迁移后主目录保留的旧官方缓存启用了额外重建检查：完整重建与三人单独重装的字典键顺序现统一，
由正式生成器重建 `data/backups.json`，所有记录数值不变。仅三人的角色/声音来源校验叠加固定提交的官方摘录，
历史客户端表保持不变；该配置下 79 项定向测试通过、6 项按原条件跳过，涵盖全潜能和逐潜能来源核对。

合并后的 golden 303 场景、设置/重复策略/自定义立绘/缩放五项真实浏览器测试通过；真实素材 ZIP 导入用例本轮未重跑。
完整 CI 复跑：11411 项，11106 通过、2 失败、303 跳过，退出 1；失败仅为 room.diy 与 lobby grace 的 2 秒 WebSocket 等待超时，对应 78 项在原阈值下单独复跑全部通过。setup/smoke/guards/lint/imports/typecheck 全部通过。完整运行和独立复跑分别保留，不宣称本次完整 CI 全绿。
正式生成器只改字典顺序，原始值逐字段比较相同；golden 重跑仍为 303 场景匹配。
全部 191,421 个忽略文件与 7 个链接已核对来源副本，原目录既有的数据缓存未删除。
真实素材 ZIP 导入本轮另跑，但在 550 秒等待阶段超时（退出 1）；这项保留失败，不替代逐文件 SHA-256 迁移校验或此前离线导入成功的历史证据。
删除旧工作树仅在这些检查、四角色回读及回滚验证结束后进行，最终结果写入同目录 `final-migration.json`。

最终四角色回读、补丁重建与旧 main 回滚已通过后，由 `finish.mjs` 完成旧工作树删除。
BASELINE 与 ROLLBACK 在相同输入下为 0.21；MODIFIED 锁定为 0.8、解锁恢复 0.21，个人保存值保持 0.21。
回滚模式 `ROLLBACK.sh TARGET_COPY --main-merge` 只在隔离副本执行，可恢复合并前 main；默认模式仍验证原始 2,833 个源文件。

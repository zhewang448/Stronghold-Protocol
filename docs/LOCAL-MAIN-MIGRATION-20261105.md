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

合并后的完整 CI、golden、设置/立绘真实浏览器回归与最终逐文件复核正在执行。
删除旧工作树仅在这些检查、四角色回读及回滚验证结束后进行，最终结果写入同目录 `final-migration.json`。

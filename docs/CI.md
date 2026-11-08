# CI（持续集成）

分片只分配测试文件，不减少全量测试集合。#835 和 #836 一起落地；`.github/workflows/ci.yml` 的配置为：

- `test (os, node, shard)`：Ubuntu / Windows × Node 22 × 片 0–3，共 8 个任务。每个任务做 setup 检查、自己一片的测试和服务器冒烟测试，超时 20 分钟。
- `node24`：Ubuntu / Node 24，只跑 `npm run test:guards`（分片、工作流接线、测试运行器），超时 15 分钟。维护者 #833 接受此范围，不代表 Node 24 全量套件已验证。
- `tooling`：Ubuntu / Node 22 跑 lint、导入边界和类型检查；lint 警告不失败。
- `golden`：独立 Ubuntu / Node 22，全量 `npm run golden`，有差异则失败，绝不更新期望。

本机 `npm run ci`（`node tools/ci.mjs`）依次复跑 setup、全量测试、冒烟、CI 守卫、lint、导入边界和类型检查。
独立 Python 3.8 提取器语法检查固定 `ubuntu-22.04`：2026-11-04 的 `ubuntu-latest` 已为 Ubuntu 26.04，
setup-python 无该平台的 3.8 构建；保留原解释器版本与全部编译范围。
`--only`、`--keep-going`、`--list` 见 [CONTRIBUTING.md](../CONTRIBUTING.md)。本地测试步骤清除继承的 `SHARD` 和 `JUNIT`，保证全量且不意外写报告；全量黄金另跑 `npm run golden`。本地不复制 CI 的系统或 Node 版本矩阵。

## 分片契约

`ci-shards.json` 保存四片的计权输入；`tools/ci-shards.mjs` 读取与 `tools/ci.mjs` 相同的 `TEST_FILES`，按权重降序依次放入最轻的一片，同权重按文件名、同负载按片号裁决。

1. 每个测试文件恰好出现一次，新增文件按 `defaultMs` 计权。
2. 最大与最小估计负载之比不超过 `MAX_IMBALANCE = 1.3`。
3. 分配不依赖时钟、网络或随机数。
4. workflow 必须列齐 `0..SHARD_COUNT-1`，每个片号一次；漏片、重复片或改变系统/Node 组合会让 `test/ci.test.js` 失败。

`test/ci-shards.test.js` 检查文件覆盖、陈旧键、未测量占比和负载；`test/test-run.test.js` 检查环境到执行文件的映射。

```bash
npm run shards -- --check
node tools/ci-shards.mjs --print 0
node tools/ci-shards.mjs --run 0
SHARD=2 npm test
```

`npm test` 未设 `SHARD` 时仍跑全量；手动设置才跑指定片。`JUNIT=report.xml npm test` 可额外输出 JUnit，reporter 参数必须位于测试文件之前。CI 没有启用 JUnit 上传。

## 权重来源与更新

采用 #836 的表，不使用 #835 的旧表。来源是作者评论所报的 CI run **39617468541**：`fullmatch-coop.test.js` 中位数 **235132 ms**，Windows 片 0 墙钟 **397 s**。本轮未独立复核 GitHub run；这些是计权出处，不是本机重新测出的性能结论。文件耗时相加是估计工作量，因文件并行而不等于任务墙钟；不要拿本机耗时替换 CI 权重。

新增文件通常无需重新计权；某文件明显变慢后，从可归属到文件的 CI 报告更新：

```bash
node tools/test-timings.mjs report.xml
node tools/ci-shards.mjs --write --timings report.xml
```

解析器只接受 `<testcase file="…" time="…">`，没有 `file` 的报告拒绝计权，不从用例名猜路径。部分 Node 版本的 JUnit 不提供 `file`；应先取得带文件信息的报告，路径按 test/ 或 plugins/ 归一到仓库。多个报告取每个文件的下中位数；未出现的文件保留原权重。每次改表后重新检查最慢任务墙钟，再决定超时；20 分钟保留 runner 机型差异和负载余量。

## 改工作流

先核对目标仓库的分支与工作流，不把 fork 的分支假设写进上游。分片数、矩阵和守卫需同时更新；保留独立 Golden 与 Python 3.8 语法检查。与改动无关的失败应在报告中说明来源，不能通过缩小测试集合隐藏。


## 2026-11-08 新测试的权重

本次仅为新增的 22 个测试文件补充权重，来自 Node 24 JUnit 的逐文件记录；[采样清单](UPSTREAM-DEV-20261108-TEST-TIMINGS.json)保留来源。既有 CI 采样的每个权重保持原值，未把其他未采样文件的默认值伪记为测量值，也没有调整超时或减少测试集合。


## 2026-11-08 发布验证的远端时序修正

原上游 AI 升级后，远端 run 42457169217 的合作全流程单文件在 Ubuntu/Windows 均触及既有 600 秒文件上限。
将原 NORMAL/HARD 两组分别放入 fullmatch-coop.test.js、fullmatch-coop-hard.test.js，ABYSS 按种子序号模 4 分入 fullmatch-coop-abyss.test.js、fullmatch-coop-abyss2.test.js、fullmatch-coop-abyss3.test.js、fullmatch-coop-abyss4.test.js；
每个难度仍覆盖 MATCH_SEEDS 默认 20、seed 101–120、真实模拟及零错误断言，ABYSS 四文件对任意 MATCH_SEEDS 都恰好各覆盖一次。首次只按难度拆分时，本机 ABYSS 单文件仍触及 600 秒，因此再按种子拆分；NORMAL/HARD 的完整 20 种子已通过。
分片自动发现所有文件，不减少种子或场景，也不修改 20 分钟任务或 600 秒文件上限。
新增文件暂按 defaultMs，原权重作为历史采样保留，不把超时的截断用时伪记为完整测量。

同轮 Windows 测试中，文件锁持有者以 stdout 在真正取得原生锁后握手，由原有 15 秒测试期限统一约束，代替额外的 5 秒轮询期限。
看门狗故障测试将专用 fixture 的阈值设为 4 秒以容纳冷启动；真实挂起请求仍须在既有 1–10 秒窗口内失败、返回 INTERNAL、关闭 worker 并恢复房间。
这些改动只影响测试驱动，不改变发布程序或生产看门狗设置。

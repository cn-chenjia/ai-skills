# 小七全局需求账本协议

> 本文件只提供当前动作的操作规则，不拥有会话或流程控制权。完成或中断后必须返回 `SKILL.md`，由主技能重新读取真实状态并路由。

## 文件布局

```text
~/.xiaoqi/
  runtime/
  sprint-manage/
    <requirement-id>-v<版本号>.yaml
```

- 所有项目共用 `~/.xiaoqi/sprint-manage/` 全局账本目录，需求编号必须全局唯一。
- 每个需求版本使用 `<requirement-id>-v<版本号>.yaml`，账本不随 branch、worktree 或仓库副本移动，也不写入项目仓库。
- 已关闭版本发现后续问题时创建新版本，不重新打开原账本。
- 不创建、不读取 `session.yaml`；当前需求、多个需求的并行推进和单需求的多个仓库均由全局账本及当前请求明确表达。
- 账本目录可由运行时统一创建。

## 账本锁与版本

账本写入使用锁、revision 校验和原子更新机制：

1. `ledger-lock.mjs acquire <file> <owner>` 获取锁和 token。
2. 读取最新文件，对账 OpenSpec、Git、各仓库和项目证据。
3. 编辑账本，但不手工修改 revision。
4. `ledger-lock.mjs commit <file> <token>` 校验 revision、原子递增版本并释放锁。
5. 放弃编辑时运行 `release`；锁冲突或 revision 变化时重新读取并合并。

## 数据结构

```yaml
schema_version: 4
document_type: requirement

编号: "story-2000"
名称: "订单重构"
change_id: "story-2000-order-refactor"

revision: 3
updated_at: "2026-08-11T11:00:00+08:00"
updated_by: "requester"

流程状态: active
交付状态: coding
当前意图: "继续实现"
推荐动作: apply
负责人: "requester"

仓库:
  - id: "main"
    root: "/path/to/repository"
    branch: "feature/story-2000"
    worktree: "/path/to/worktree"
  - id: "service-b"
    root: "/path/to/another-repository"
    branch: "feature/story-2000-service-b"
    worktree: "/path/to/another-worktree"

依赖需求: []
冲突键: []
影响范围: []
计划: "docs/superpowers/plans/story-2000.md"

OpenSpec快照:
  status: ready
  checked_at: "2026-08-11T11:00:00+08:00"

证据索引:
  apply: null
  checks: []
  review: null
  archive:
    outcome: pending
    path: null
  finish:
    outcome: pending
    result: null
    summary: null

用户决策:
  - kind: "proposal-confirmation"
    outcome: "approved"
    actor: "requester"
    at: "2026-08-11T10:55:00+08:00"
阻塞项: []
事件日志: []
```

`仓库` 至少包含一个条目；单个需求可以登记多个仓库，每个条目必须有稳定的 `id` 和可定位的 `root`，branch/worktree 在进入实施前补齐。每个需求必须使用独立的 branch 和 `.worktrees/<需求编号>` worktree，不得复用当前工作区；不同需求不得复用同一 branch 或 worktree。依赖需求、冲突键和影响范围用于目录级事实校验。

## 状态和闭环

流程状态：

```text
active | paused | blocked | closed
```

交付状态：

```text
not-started | coding | verified | reviewed | ready
pr-open | merged | kept
```

`closed` 必须同时具备 OpenSpec archive 成功证据和 finish 成功证据；`finish.result` 必须等于最终交付状态。关闭后「当前意图」刷新为"需求已关闭"、推荐动作置为 null（终态语义，续接会话不得再按实施意图解读账本）。

## 校验与原子更新

```bash
node "<小七技能安装目录>/scripts/validate-progress.mjs" \
  "$HOME/.xiaoqi/sprint-manage/story-2000-v1.yaml"

node "<小七技能安装目录>/scripts/validate-progress.mjs" \
  "$HOME/.xiaoqi/sprint-manage"

node "<小七技能安装目录>/scripts/ledger-lock.mjs" acquire \
  "$HOME/.xiaoqi/sprint-manage/story-2000-v1.yaml" requester
node "<小七技能安装目录>/scripts/ledger-lock.mjs" commit \
  "$HOME/.xiaoqi/sprint-manage/story-2000-v1.yaml" <token>
```

校验失败时不得覆盖账本。状态推进统一使用 `advance-progress.mjs`，证据记录统一使用 `record-evidence.mjs`；不得手工推进交付状态。

## 证据字段速查表

生成 apply/check/review 等证据前，先查询当前 kind 的必需字段与合法值约束（只读，不触碰账本）：

```bash
node "<小七技能安装目录>/scripts/advance-progress.mjs" --schema <kind>
```

各 kind 的必需字段与成功值约束（以 `--schema` 输出为准）：

| kind | 必需字段 | 成功值约束 |
| --- | --- | --- |
| apply | kind, command, exit_code, checked_at, summary | exit_code=0（commit 可选，未填时脚本自动回填当前 HEAD） |
| check | kind, command, exit_code, commit, checked_at, summary | exit_code=0 |
| review | 同 check + result | result=approved |
| openspec-verify | 同 check + result | result=passed |
| finish | 同 check + result + outcome | result∈{pr-open,merged,kept} 且必须等于目标交付状态；outcome∈{passed,completed,archived} |
| archive | kind, command, exit_code, checked_at, summary, path, outcome | outcome∈{passed,completed,archived}，path 非空 |

apply 证据附带 TDD 声明时的复合校验：

- `tdd.enabled: true` → 必须包含有效 red（exit_code=1、result=failed）与 green（exit_code=0、result=passed）阶段，refactor 可选但必须 passed；
- `tdd.enabled: false` → 必须提供 `tdd.reason` 豁免原因；
- `tdd_tasks` 数组逐项同样受上述豁免留痕约束（task_id 非空，关闭 TDD 须留 reason）。

人工验证证据（check 且 `manual: true`）：

- `command` 允许填验证方式描述文字（如"SIT 联调验证（用户确认通过）"），不必是可执行命令；
- 必须额外提供 `confirmed_by`（人工确认人）；
- 证据落库时保留 `manual: true` 与 `confirmed_by`，与命令行执行证据区分；非人工路径行为不变。

状态迁移：

```text
not-started -> coding -> verified -> reviewed -> ready（进入 `coding` 前必须存在 `proposal-confirmation: approved`、`implementation-start: approved`，以及所有仓库已登记的 branch/worktree）
ready -> pr-open | merged | kept
```

最低证据要求：`coding` 需要成功的 `apply`；`verified` 需要成功的 `check`；`reviewed` 需要 `result: approved` 的 `review`；`ready` 需要 `result: passed` 的 `openspec-verify`；`pr-open`、`merged`、`kept` 需要对应 `finish`。

所有证据的 `outcome` 成功值只能是 `passed`、`completed` 或 `archived`。`finish.result` 必须等于目标交付状态，`archive.path` 必须非空。

## 首次建账

精确识别项目根目录、需求编号、名称、`change_id` 和负责人后，在需求接纳时执行；此时只记录 `requirement-intake: accepted`，不提前记录方案确认：

```bash
node "<小七技能安装目录>/scripts/initialize-requirement.mjs" \
  "<项目根目录>" story-1001 "订单重构" \
  story-1001-order-refactor requester requester
```

脚本将账本写入 `~/.xiaoqi/sprint-manage/story-1001-v1.yaml`，不会创建 session 文件，也不会覆盖已有账本。后续变更创建新的版本文件，不重新打开已关闭版本。没有需求接纳记录、账本或仓库记录时，不得进入 `coding`；没有方案确认记录时，不得进入 `coding`。工作区准备必须先于 OpenSpec artifacts 生成。

## 迁移

迁移旧账本时，为每个需求生成全局路径下的独立文件，保留 `change_id`、状态、阻塞、用户决策和证据索引；仓库无法确认时设为 blocked，不猜测。迁移完成并通过目录校验后，旧文件才可归档。

## 结果返回

完成或中断当前动作后，必须把以下结果返回主技能，由主技能重新读取真实状态并决定下一动作：

- `outcome`
- `summary`
- `evidence`
- `blockers`
- `recommended_next`

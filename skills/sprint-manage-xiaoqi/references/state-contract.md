# 小七 V4 独立需求账本协议

> 本文件只提供当前动作的操作规则，不拥有会话或流程控制权。完成或中断后必须返回 `SKILL.md`，由主技能重新读取真实状态并路由。

## 文件布局

```text
每个需求工作区/
  sprint-manage/
    requirements/
      <id>.yaml
    local/
      session.yaml
```

- 每个需求工作区持有该需求的 `requirements/<id>.yaml`，账本随需求分支和 worktree 隔离。
- `local/session.yaml` 记录当前用户、当前需求和可选的本地会话状态，必须加入 `.gitignore`，不提交 Git。
- 创建账本时不得覆盖当前工作区的 session；`prepare-workspace` 确定目标 worktree 并移入账本后，才在目标工作区写入 session。
- 旧 `sprint-progress.yaml` 迁移完成后移入 archive，不再写回。

## 账本锁与版本

账本写入使用以下锁、revision 校验和原子更新机制：

1. 运行 `ledger-lock.mjs acquire <file> <owner>` 获取锁和 token。
2. 读取最新文件，对账 OpenSpec、Git 和项目证据。
3. 编辑账本，但不手工修改 revision。
4. 运行 `ledger-lock.mjs commit <file> <token>`。
5. commit 会校验账本、确认 revision 未变化、原子递增版本并释放锁。
6. 放弃编辑时运行 `release`；锁冲突或 revision 变化时重新读取并合并。

## 数据结构

```yaml
schema_version: 4
document_type: requirement

编号: "story-2000"
名称: "订单重构"
change_id: "story-2000-order-refactor"

revision: 3
updated_at: "2026-08-11T11:00:00+08:00"
updated_by: "lead"

流程状态: active
交付状态: coding
当前意图: "多人并行实现"
推荐动作: apply

协作:
  模式: shared-change
  负责人: "lead"
  参与人:
    - "alice"
    - "bob"
  分支: "feature/story-2000"
  工作区: ".worktrees/story-2000"
  集成分支: "feature/story-2000"

依赖需求: []
冲突键:
  - "spec:orders"
影响范围:
  - "backend/orders/"
  - "frontend/orders/"

并行单元:
  - id: "T01"
    owner: "alice"
    branch: "feature/story-2000-t01"
    worktree: ".worktrees/story-2000-t01"
    write_scope:
      - "backend/domain/"
    depends_on: []
  - id: "T02"
    owner: "bob"
    branch: "feature/story-2000-t02"
    worktree: ".worktrees/story-2000-t02"
    write_scope:
      - "frontend/orders/"
    depends_on:
      - "T01"

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

协作字段的使用、工作区隔离和跨需求冲突需要返回主技能，并将
`recommended_next` 设置为抽象意图 `collaboration-conflict`，由主技能映射到协作参考。
本文件只定义账本数据和校验事实。

## 协作字段校验事实

`shared-change` 必须配置集成分支和至少两个并行单元。目录校验覆盖分支、工作区、依赖需求、冲突键、影响范围和并行单元的 `write_scope`：分支和工作区不得复用，依赖不得缺失或形成循环，active 需求的冲突键及影响范围不得冲突，`write_scope` 不得重叠或互为父子路径。需求校验还要求并行单元 ID、branch、worktree 唯一，`depends_on` 有效且无循环，且子任务不直接使用集成分支。

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

`closed` 必须同时具备 OpenSpec archive 成功证据和 finish 成功证据。
`finish.result` 必须等于最终交付状态。

## 校验

校验单个需求：

```bash
node scripts/validate-progress.mjs \
  sprint-manage/requirements/story-2000.yaml
```

校验整个需求目录及跨需求冲突：

```bash
node scripts/validate-progress.mjs sprint-manage/requirements
```

校验失败时不得覆盖账本。

原子更新：

```bash
node scripts/ledger-lock.mjs acquire \
  sprint-manage/requirements/story-2000.yaml alice

node scripts/ledger-lock.mjs commit \
  sprint-manage/requirements/story-2000.yaml <token>
```

将 `sprint-manage/local/` 和 `*.yaml.lock` 加入 `.gitignore`。

## 可执行状态门禁

交付状态不能通过手工编辑直接推进。统一使用：

```bash
node "<小七技能安装目录>/scripts/advance-progress.mjs" \
  sprint-manage/requirements/story-1001.yaml \
  verified \
  evidence/check.json \
  alice
```

状态迁移必须遵循：

```text
not-started -> coding -> verified -> reviewed -> ready
ready -> pr-open | merged | kept
```

不同状态的最低证据要求：

- `coding`：成功的 `apply`。
- `verified`：成功的 `check`。
- `reviewed`：成功且 `result: approved` 的 `review`。
- `ready`：成功且 `result: passed` 的 `openspec-verify`。
- `pr-open`、`merged`、`kept`：对应结果的 `finish`。

### 证据字段合法值

所有证据的 `outcome` 成功值只能是 `passed`、`completed` 或 `archived`；
`success`、`ok` 等其他值会被校验拒绝。

| 证据 kind | 必需字段 | 额外约束 |
| --- | --- | --- |
| `apply` | `kind`、`command`、`exit_code: 0`、`checked_at`、`summary` | 不要求 `commit` 和 `result`；`commit` 缺失时自动回填当前 HEAD |
| `check` | 上述全部 + `commit` | `result` 不校验 |
| `review` | 同 `check` | `result` 必须为 `approved` |
| `openspec-verify` | 同 `check` | `result` 必须为 `passed` |
| `finish` | 同 `check` + `outcome` | `result` 必须为 `pr-open`、`merged` 或 `kept`，且等于最终交付状态；`outcome` 必须为 `passed`/`completed`/`archived` |
| `archive` | `kind`、`command`、`exit_code: 0`、`checked_at`、`summary`、`path` 非空、`outcome` 为成功值 | `closed` 前必须存在 |

### 证据 schema 强校验

`advance-progress.mjs` 与 `record-evidence.mjs` 在写入账本前都会先做证据 schema 校验：
- 必需字段缺失立即拒绝，报错信息列出缺失字段
- `exit_code` 必须为 `0`，非 0 直接拒绝
- `review.result` 必须为 `approved`，`openspec-verify.result` 必须为 `passed`
- `finish.result` 必须等于目标交付状态，且 `outcome` 必须为成功值

校验失败时不进入加锁流程，避免账本被部分写入。

### apply 证据 commit 自动回填

`apply` 证据不强制要求 `commit` 字段。若未提供，`advance-progress.mjs` 会自动执行
`git rev-parse HEAD` 回填当前 HEAD 的 commit 到证据和事件日志，避免 `delivery-transition`
事件的 `commit` 字段为 `null`。

### archive 证据的两种记录方式

1. **推荐**：用 `record-evidence.mjs` 只记录证据到账本证据索引，不推进交付状态，避免
   `ready → ready` 的自环迁移事件：

   ```bash
   node "<小七技能安装目录>/scripts/record-evidence.mjs" \
     sprint-manage/requirements/story-1001.yaml \
     evidence/archive.json \
     alice
   ```

2. **兼容**：仍可用 `advance-progress.mjs` 以当前交付状态为目标状态再推进一次
   （同状态推进被允许），并传入 `kind: "archive"` 的证据。这会产生一条 `ready → ready`
   的自环迁移事件，但不影响最终交付状态。

`finish` 证据不能用 `record-evidence.mjs`，必须通过 `advance-progress.mjs` 推进交付状态。

### dry-run 预演

`advance-progress.mjs` 支持 `--dry-run` 参数，只校验证据 schema 和状态迁移合法性，
不实际写入账本，便于预演：

```bash
node "<小七技能安装目录>/scripts/advance-progress.mjs" \
  sprint-manage/requirements/story-1001.yaml \
  verified \
  evidence/check.json \
  alice \
  --dry-run
```

返回 `{ wouldSucceed: true/false, transitionIssues: [...], validationIssues: [...] }`。

推进工具会负责加锁、重读 revision、写入事件和原子更新。校验失败时不覆盖
账本，并释放本次锁。

## 首次建账

精确识别需求编号、名称、`change_id` 和负责人后，统一创建账本：

```bash
node "<小七技能安装目录>/scripts/initialize-requirement.mjs" \
  "<项目根目录>" \
  "story-1001" \
  "订单重构" \
  "story-1001-order-refactor" \
  "alice" \
  "requester"
```

该命令只在 proposal 已经得到用户确认后执行，最后一个参数是确认人。脚本不会
覆盖已有账本。进入实施前再调用 `prepare-workspace.mjs` 登记专属分支和工作区。
没有确认记录、账本或工作区记录时，不得进入 `coding`。

### 项目级配置文件（可选）

在项目根目录创建 `.xiaoqi/config.yaml` 可覆盖默认的基线分支检测和分支命名规则：

```yaml
# .xiaoqi/config.yaml
baseBranch: develop
# 分支模板支持占位符：{{id}}（需求编号）、{{date}}（YYYYMMDD）、{{change_id}}
branchTemplate: feature/{{date}}/story-{{id}}
```

`prepare-workspace.mjs` 的基线分支检测优先级：
1. 账本 `协作.基线分支` 显式配置
2. `.xiaoqi/config.yaml` 的 `baseBranch`
3. `origin/HEAD` 指向的分支（**有 broken ref 告警时跳过**）
4. 本地 `main` 或 `master`（唯一存在时）

分支命名优先级：
1. 账本 `协作.分支` 显式配置
2. `.xiaoqi/config.yaml` 的 `branchTemplate`
3. 默认 `codex/<编号>`

若当前所在分支既非基线也非账本规划分支，且账本未显式指定分支，
`prepare-workspace.mjs` 会打印提示，建议用户在账本中显式填写分支。

正式关闭的动作顺序和用户选择需要返回主技能，并将
`recommended_next` 设置为抽象意图 `closing`；本文件只校验最终交付状态、archive 证据和
finish 证据是否齐全。

## V3 迁移

1. 读取旧 `sprint-progress.yaml` 的每个需求。
2. 每个需求生成独立 `requirements/<id>.yaml`。
3. 设置 `schema_version: 4`、`document_type: requirement` 和 `revision: 1`。
4. 当前操作者作为初始负责人。
5. branch 或 worktree 无法确认时设为 blocked，不猜测。
6. 将 `当前需求` 写入本地 `local/session.yaml`，不进入共享账本。
7. 保留 change_id、状态、阻塞、用户决策和证据索引。
8. 所有需求通过目录校验后，旧文件才移入 archive。

## 结果返回

完成或中断当前动作后，必须把以下结果返回主技能，由主技能重新读取真实状态并决定下一动作：

- `outcome`
- `summary`
- `evidence`
- `blockers`
- `recommended_next`

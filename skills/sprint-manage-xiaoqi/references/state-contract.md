# 小七 V4 独立需求账本协议

> 本文件只提供当前动作的操作规则，不拥有会话或流程控制权。完成或中断后必须返回 `SKILL.md`，由主技能重新读取真实状态并路由。

## 文件布局

```text
sprint-manage/
  requirements/
    story-1001.yaml
    story-1002.yaml
  local/
    session.yaml
  archive/
```

- 每个需求独立一个 `requirements/<id>.yaml`。
- 小七扫描目录生成总览，不维护共享 index。
- `local/session.yaml` 只记录当前用户和当前需求，必须加入 `.gitignore`，不提交 Git。
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

# 小七 V4 独立需求账本协议

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

## 单写者与版本

每个需求账本只有 `协作.负责人` 可以写入：

1. 运行 `ledger-lock.mjs acquire <file> <owner>` 获取锁和 token。
2. 读取最新文件，对账 OpenSpec、Git 和项目证据。
3. 编辑账本，但不手工修改 revision。
4. 运行 `ledger-lock.mjs commit <file> <token>`。
5. commit 会校验账本、确认 revision 未变化、原子递增版本并释放锁。
6. 放弃编辑时运行 `release`；锁冲突或 revision 变化时重新读取并合并。

参与者不并发编辑账本，只提交代码、测试、PR 或任务结果给负责人。

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
  checks: []
  review: null
  archive:
    outcome: pending
    path: null
  finish:
    outcome: pending
    result: null
    summary: null

用户决策: []
阻塞项: []
事件日志: []
```

## 协作模式

| 模式 | 用途 |
| --- | --- |
| `single` | 单人负责一个需求 |
| `independent` | 多人分别负责不同需求 |
| `shared-change` | 一个大型需求多人分工 |

所有模式都必须配置负责人、需求分支和需求工作区。
处于 explore/propose 且交付状态为 `not-started` 时，分支和工作区可以暂缺；
进入 coding 前必须补齐。

`shared-change` 还必须：

- 配置集成分支。
- 至少两个并行单元。
- 每个单元拥有独立 branch 和 worktree。
- 每个单元声明 owner、write_scope 和 depends_on。

并行单元只保存协作边界，不替代 OpenSpec tasks 的完成事实。

## 并发冲突

目录级校验检查：

- 不同需求复用 branch。
- 不同需求复用 worktree。
- 依赖需求不存在。
- 两个 active 需求拥有相同冲突键。
- 两个 active 需求的影响范围相同或互为父子路径。
- 需求编号或 change_id 重复。
- 任意主分支、集成分支、子分支或 worktree 被不同需求复用。
- 需求依赖形成循环。

需求级校验检查：

- 并行单元 ID、branch、worktree 重复。
- depends_on 引用不存在或形成循环。
- write_scope 相同或互为父子路径。
- 子任务直接使用集成分支。

冲突键建议使用：

```text
db:migration
api:<contract>
spec:<name>
config:<name>
shared-file:<path>
```

检测到冲突时，选择串行、冻结契约、提前落地基础任务或指定单一负责人。

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
node skills/sprint-manage-xiaoqi/scripts/advance-progress.mjs \
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

- `verified`：成功的 `check`。
- `reviewed`：成功且 `result: approved` 的 `review`。
- `ready`：成功且 `result: passed` 的 `openspec-verify`。
- `pr-open`、`merged`、`kept`：对应结果的 `finish`。

推进工具会负责加锁、重读 revision、写入事件和原子更新。校验失败时不覆盖
账本，并释放本次锁。

## V3 迁移

1. 读取旧 `sprint-progress.yaml` 的每个需求。
2. 每个需求生成独立 `requirements/<id>.yaml`。
3. 设置 `schema_version: 4`、`document_type: requirement` 和 `revision: 1`。
4. 当前操作者作为初始负责人。
5. branch 或 worktree 无法确认时设为 blocked，不猜测。
6. 将 `当前需求` 写入本地 `local/session.yaml`，不进入共享账本。
7. 保留 change_id、状态、阻塞、用户决策和证据索引。
8. 所有需求通过目录校验后，旧文件才移入 archive。

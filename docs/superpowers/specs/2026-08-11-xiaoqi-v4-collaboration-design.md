# 小七 V4 并行协作设计

## 目标

让小七安全支持：

1. 单人并行多个需求。
2. 多人分别开发多个需求。
3. 一个大型需求由多人并行分工。

## 文件模型

不再维护共享热点文件 `sprint-progress.yaml`。每个需求使用独立账本：

```text
sprint-manage/
  requirements/
    story-1001.yaml
    story-1002.yaml
  local/
    session.yaml
  archive/
```

- `requirements/<id>.yaml`：可提交 Git 的需求协作账本。
- `local/session.yaml`：每个开发者自己的当前需求，不提交 Git。
- 小七通过扫描 requirements 目录生成迭代总览，不维护手工 index。

## 单写者规则

每个需求账本只有 `协作.负责人` 可以写入。参与者通过代码、测试、PR 或任务结果
向负责人交付，不并发编辑同一个 YAML。负责人写入前检查 `revision`，成功写回后
递增版本。

这避免多人同时覆盖账本，也保持小七只是协调层。

## 独立需求

每个正在编码的需求必须有独立：

- OpenSpec `change_id`
- Git branch
- worktree
- requirement ledger

校验器在扫描目录时检查不同需求不能复用 branch 或 worktree。

## 大型需求

大型需求保留一个 OpenSpec change 作为统一需求事实，并建立集成分支：

```text
feature/story-2000
```

协作账本包含并行单元：

```yaml
并行单元:
  - id: T01
    owner: user-a
    branch: feature/story-2000-t01
    worktree: .worktrees/story-2000-t01
    write_scope:
      - backend/domain/
    depends_on: []
```

并行单元只记录协作边界，不替代 OpenSpec tasks。完成事实仍由 tasks、测试和
评审决定。

校验器检查：

- 单元 ID、branch、worktree 唯一。
- owner、write_scope 非空。
- depends_on 引用存在且无循环。
- write_scope 不得相同或互为父子路径。
- 子分支不得等于集成分支。

共享文件、数据库迁移、公共接口或主配置必须指定单一负责人，或者在并行开始前
先作为基础任务落地。

## 多 change 依赖

独立需求通过 `依赖需求` 和 `冲突键` 建立关系：

- `依赖需求`：必须先完成或提供稳定契约的需求编号。
- `冲突键`：如 `db:migration`, `api:order-v2`, `spec:orders`。

目录校验发现两个 active 需求拥有相同冲突键时报告冲突，要求串行化、冻结契约
或明确协调顺序。

## 状态与交付

沿用 V3 双状态，但升级为 `schema_version: 4`：

- 流程状态：`active | paused | blocked | closed`
- 交付状态：`not-started | coding | verified | reviewed | ready | pr-open | merged | kept`

协作元数据新增：

- `revision`
- `updated_at`
- `updated_by`
- `协作.模式`
- `协作.负责人`
- `协作.参与人`
- `协作.分支`
- `协作.工作区`
- `协作.集成分支`
- `依赖需求`
- `冲突键`
- `并行单元`

## 协作模式

- `single`：单人需求。
- `independent`：多人分别负责不同需求。
- `shared-change`：一个大型需求多人分工。

`shared-change` 必须配置负责人、集成分支和至少两个并行单元。

## 迁移

V3 单文件迁移为多个 V4 requirement files：

1. 按需求编号拆分。
2. revision 从 1 开始。
3. 当前操作人作为初始负责人。
4. branch/worktree 无法确认时标记 blocked。
5. `当前需求` 移入 local/session.yaml。
6. 原文件只在全部需求通过 V4 校验后移入 archive。

## 验收

- 不同需求可以独立写账本。
- 当前需求不再是共享字段。
- 重复 branch/worktree、依赖循环和写入范围冲突会被拦截。
- shared-change 必须具备明确负责人和集成方式。
- 旧 V3 单文件不能直接写回。

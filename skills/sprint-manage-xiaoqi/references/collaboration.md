# 小七协作与工作区规则

> 本文件只提供当前动作的操作规则，不拥有会话或流程控制权。完成或中断后必须返回 `SKILL.md`，由主技能重新读取真实状态并路由。

## 单写者

每个需求账本只有 `协作.负责人` 可以写入。参与者不并发编辑账本，只提交代码、测试、PR 或任务结果给负责人。

## 需求隔离

所有模式都必须配置负责人、需求分支和需求工作区。处于 explore/propose 且交付状态为 `not-started` 时，分支和工作区可以暂缺；进入 coding 前必须补齐。

新需求的 proposal 必须先由用户确认，再创建账本。初始化时将确认结果写入 `用户决策`；没有 `proposal-confirmation: approved` 的账本不能准备工作区或进入 `coding`。

当前 Git 工作区可以作为一个需求的独立 branch worktree，账本中记录为 `.`。只有当前工作区已经被其他 active 需求占用时，才必须创建额外 worktree。无论采用哪种形式，同一工作区都不能同时登记给两个 active 需求。

## 单人并行多个需求

每个需求使用独立 OpenSpec change、branch、worktree 和 `sprint-manage/requirements/<id>.yaml`；账本在其专属 worktree 中。个人当前需求记录在该 worktree 的本地 `sprint-manage/local/session.yaml`，切换需求不会覆盖其他 worktree 的会话文件。

开始编码前校验整个 requirements 目录，禁止复用 branch、worktree 或冲突键。

## 多人分别开发多个需求

每个需求指定唯一负责人。不同需求可以并行，但必须：

- 使用独立 branch 和 worktree。
- 声明 `依赖需求` 和 `冲突键`。
- 修改同一 Spec、数据库迁移、公共接口或共享配置时先协调顺序。

## 协作评估门禁

需求完成初始化后、准备工作区前，主技能仅在需求同时复杂且明确需要多人协作时路由到本门禁。复杂性包括跨模块或公共链路、数据库或接口契约变化、tasks 超过 5 项或存在明显依赖、回归范围大，或存在多个写入范围不重叠的可独立任务。

负责人必须在 `shared-change` 中配置集成分支、至少两个协作单元，并为每个单元声明 owner、branch、worktree、write_scope 和 depends_on；随后完成本文件的需求级冲突检查。配置缺失或校验失败属于人工门禁：不得准备任一工作区或进入 `apply`，直到负责人补齐配置或消除冲突。未同时满足复杂性和多人协作的需求不经过本门禁，按普通流程继续。

## 大型需求共享 Change

大型需求使用一个 OpenSpec change 和一个集成分支。Superpowers plan 将 tasks 拆成并行单元，每个单元声明：

```yaml
id: "T01"
owner: "alice"
branch: "feature/story-2000-t01"
worktree: ".worktrees/story-2000-t01"
write_scope:
  - "backend/domain/"
depends_on: []
```

`shared-change` 还必须配置集成分支、至少两个并行单元，并让每个单元拥有独立 branch 和 worktree，声明 owner、write_scope 和 depends_on。

只有 `write_scope` 不重叠、依赖已满足、公共契约已稳定的单元才可并行。共享文件和基础契约由单一负责人先落地。子分支先合入集成分支，集成分支统一运行项目验证、代码评审和 OpenSpec verify，最后再 archive 和 finish。

当子功能可独立上线、独立验收且修改范围不重叠时，可以拆成多个 OpenSpec change；否则保持一个 change，避免需求事实分散。并行单元只保存协作边界，不替代 OpenSpec tasks 的完成事实。

## 冲突检查

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

## 结果返回

完成或中断当前动作后，必须把以下结果返回主技能，由主技能重新读取真实状态并决定下一动作：

- `outcome`
- `summary`
- `evidence`
- `blockers`
- `recommended_next`

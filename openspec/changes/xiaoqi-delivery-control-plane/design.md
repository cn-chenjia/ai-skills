# 小七需求交付控制平面架构设计

## 1. 设计目标

将小七从单一 Skill、脚本和规则文件集合，演进为一个独立的需求交付控制平面。Skill、CLI、Web、IDE Hook、CI 和 Agent 都是接入入口或执行器，不承担核心领域模型和流程事实。

系统需要支持：

- 跟进和管理项目需求；
- 通过开始、准备、实施、收尾四个阶段完成需求交付；
- 单需求或多需求并行；
- 单项目仓库或多项目仓库；
- 单人或多人协作；
- 项目内 OpenSpec 管理；
- 多项目共享 OpenSpec Store 管理；
- 除小七管理目录外，只生成 OpenSpec 标准工件，不生成额外自定义文档。

## 2. 核心原则

### 2.1 控制平面与执行平面分离

控制平面负责需求、交付、任务、阶段、协作者、仓库绑定、OpenSpec 绑定、策略、审批和证据状态；执行平面负责 Git、文件修改、测试、构建、Lint、OpenSpec CLI、CI 和 Agent 的实际操作。

执行器只返回结构化结果，控制平面根据结果和策略决定是否推进流程。

### 2.2 OpenSpec 是规划事实源

需求分析、设计、任务和规格正文全部使用 OpenSpec 标准工件。小七不复制这些正文，不创建自定义 plan、design、review 或 evidence 文档。

### 2.3 小七是交付控制事实源

小七只记录交付控制所需的信息，包括阶段、状态、仓库绑定、工作区、协作者、执行结果、证据索引、审批记录和事件审计。

### 2.4 规划根目录唯一来源

系统启动时执行 `openspec context --json`，只使用返回的 `root.path` 作为 `planningRoot`。不得根据当前目录、Store ID 或缓存推测规划根；解析失败时不得回退到当前仓库创建管理目录。

### 2.5 不为九种场景创建九套流程

九种使用场景由三个可组合维度表达：

```text
需求数量 × 项目仓库数量 × 协作者数量
```

统一使用 Delivery、RepositoryBinding、PlanningBinding 和 WorkItem 的数量与关系表达差异。

## 3. 存储和文档边界

### 3.1 项目内 OpenSpec

当 OpenSpec 根目录是项目根目录时：

```text
project/
├── openspec/                 # OpenSpec 标准目录
│   ├── changes/
│   └── specs/
├── sprint-manage/            # 小七内部管理目录
│   └── requirements/
│       └── <delivery-id>.yaml
└── src/
```

### 3.2 OpenSpec Store

当 OpenSpec 使用 Store 时，`root.path` 指向 Store 对应的规划 checkout：

```text
planning-store/
├── openspec/                 # OpenSpec 标准目录
├── sprint-manage/            # 小七内部管理目录
│   └── requirements/
│       └── <delivery-id>.yaml
└── ...

project-a/                    # 代码仓库，不保存小七账本
project-b/
```

多项目共享 Store 时，代码仓库作为 Delivery 的 RepositoryBinding 记录在 Store 的小七账本中。

### 3.3 文件生成白名单

小七主动创建的文件必须满足以下规则：

```text
<planningRoot>/sprint-manage/**
```

规划正文只能创建在 OpenSpec 标准目录，并且必须符合当前 OpenSpec 版本的工件规范，例如 `proposal.md`、`design.md`、`tasks.md`、标准 spec 文件和标准归档结果。

禁止生成：

```text
<project>/docs/superpowers/**
<project>/design/**
<project>/plans/**
<project>/evidence/**
<project>/reports/**
```

除非这些文件是项目工具或 OpenSpec 标准流程明确要求的产物。

## 4. 领域模型

### 4.1 Requirement

表示用户期望解决的业务或技术问题。需求可以有多次交付，因此不直接绑定某个仓库或工作区。

```text
Requirement
- id
- title
- description
- acceptance_criteria
- priority
- owner
- status
```

### 4.2 Delivery

表示 Requirement 的一次具体交付。它承载四阶段流程和交付状态。

```text
Delivery
- id
- requirement_id
- phase
- status
- owner
- created_at
- completed_at
```

`Requirement` 与 `Delivery` 分离，允许同一需求分期交付或重新交付。

### 4.3 RepositoryBinding

表示一次 Delivery 与一个项目仓库的关系。

```text
RepositoryBinding
- delivery_id
- repository_id
- role
- path
- base_branch
- branch
- worktree
- write_scope
- status
```

一个 Delivery 可以拥有一个或多个 RepositoryBinding。

### 4.4 PlanningBinding

表示 Delivery 与 OpenSpec 规划仓库及 change 的关系。

```text
PlanningBinding
- delivery_id
- planning_repository_id
- change_id
- proposal_path
- design_path
- tasks_path
- spec_paths
- mode
```

`mode` 支持：

```text
co-located   # OpenSpec 与项目仓库同根
shared       # 多项目共享 OpenSpec Store
external     # 独立规划仓库
```

### 4.5 WorkItem

表示可执行的研发任务，来源于 OpenSpec `tasks.md`，但不替代 OpenSpec 任务完成事实。

```text
WorkItem
- id
- delivery_id
- source_task_id
- title
- assignee
- repository_id
- branch
- worktree
- write_scope
- depends_on
- status
```

单人模式可以只有一个负责人；多人模式通过多个 WorkItem 实现并行开发。

### 4.6 Workspace

工作区是一等实体，不仅是账本中的路径字段。

```text
Workspace
- id
- repository_id
- path
- branch
- owner
- work_item_id
- type
- status
```

`type` 支持：

```text
current-worktree
 dedicated-worktree
container-workspace
remote-workspace
```

### 4.7 Evidence

证据是状态推进和审计的依据，不要求生成独立文件。

```text
Evidence
- id
- delivery_id
- work_item_id
- type
- command
- result
- commit
- artifact_ref
- actor
- created_at
```

证据可以直接写入小七账本，也可以保存外部系统引用，例如 CI run ID、PR URL 或 OpenSpec 工件路径。

## 5. 四阶段流程

### 5.1 开始 Start

目标是把模糊需求转换为已确认、可执行的 OpenSpec 方案。

流程：

```text
需求采集
  → 影响范围分析
  → 识别项目仓库
  → 创建或选择 OpenSpec change
  → 编写 proposal/design/tasks/spec
  → 风险和依赖分析
  → 用户确认
```

阶段状态：

```text
draft | analyzing | designing | awaiting-approval | approved | rejected
```

产出：OpenSpec 标准工件、Requirement、Delivery、PlanningBinding 和用户确认记录。此阶段不创建代码工作区。

### 5.2 准备 Prepare

目标是把已确认方案转换为可安全实施的环境。

自动或半自动执行：

- 解析规划根；
- 创建或确认 RepositoryBinding；
- 创建分支和工作区；
- 校验分支、工作区和写入范围冲突；
- 将 OpenSpec tasks 映射为 WorkItem；
- 分配负责人和协作者；
- 检查仓库权限和工具链。

阶段状态：

```text
preparing | workspace-ready | prepare-blocked
```

人工门禁包括并行拆分、公共文件负责人、集成分支和破坏性操作确认。

### 5.3 实施 Implement

目标是完成代码实现并形成可验证证据。

单人流程：

```text
领取 WorkItem
  → 编写测试
  → 实现代码
  → 测试
  → Lint / 静态检查
  → 提交代码
  → 更新 OpenSpec tasks
```

多人流程：

```text
拆分 WorkItem
  → 独立 worktree 并行开发
  → 子分支提交
  → 合入集成分支
  → 集成测试和统一评审
```

阶段状态：

```text
implementing | testing | reviewing | implementation-blocked | implementation-complete
```

测试、Lint、构建和评审策略通过 ProjectProfile 配置，不在核心流程中硬编码具体命令。

### 5.4 收尾 Close

目标是将代码、OpenSpec、分支和工作区收敛到最终交付状态。

流程：

```text
最终测试
  → 最终代码检查
  → OpenSpec verify
  → OpenSpec 标准归档
  → PR / merge / keep
  → 分支和工作区处理
  → 关闭 Delivery
```

分支策略支持：

```text
merge | keep | archive | delete
```

工作区策略支持：

```text
remove | keep | handoff
```

`Delivery closed` 不等于 `Requirement closed`。一个需求可以在 Delivery 完成后继续进入下一期交付。

## 6. 九类场景映射

| 场景 | Delivery | RepositoryBinding | WorkItem / 协作者 |
|---|---:|---:|---:|
| 单需求单仓库单人 | 1 | 1 | 1+ / 1 |
| 单需求多仓库单人 | 1 | N | 1+ / 1 |
| 单需求单仓库多人 | 1 | 1 | N / N |
| 单需求多仓库多人 | 1 | N | N / N |
| 多需求单仓库单人并行 | N | 每个 Delivery 1 | 每个 Delivery 1+ |
| 多需求多仓库单人并行 | N | 每个 Delivery N | 每个 Delivery 1+ |
| 单项目仓库 OpenSpec | 1+ | PlanningBinding 指向项目根 | 按需求拆分 |
| 多项目共享 OpenSpec | 1+ | 多个 RepositoryBinding | 按仓库和任务拆分 |
| 多项目多人共享 OpenSpec | 1+ | 多个 RepositoryBinding | 多 WorkItem / 多协作者 |

这些场景使用同一套阶段、证据和权限规则，不创建专用状态机。

## 7. 模块架构

推荐采用模块化单体，提供 CLI、API、Web 和 Worker 入口。

```text
apps/
├── cli/
├── api/
├── web/
└── worker/

domain/
├── requirement/
├── delivery/
├── planning/
├── repository/
├── workspace/
├── work-item/
├── collaboration/
├── evidence/
└── workflow/

application/
├── start-delivery/
├── prepare-delivery/
├── implement-work-item/
├── verify-delivery/
└── close-delivery/

infrastructure/
├── persistence/
├── locking/
├── command-runner/
├── event-log/
└── job-runner/

adapters/
├── git/
├── openspec/
├── github/
├── gitlab/
├── trae/
├── codex/
└── ci/

policies/
├── workflow-policy/
├── permission-policy/
├── collaboration-policy/
└── safety-policy/
```

依赖方向：

```text
Domain
  ↓
Application
  ↓
Adapters / Infrastructure
  ↓
CLI / API / Web / Worker
```

Domain 不依赖 Git、OpenSpec CLI、Trae、Codex、用户目录或具体文件路径。

## 8. 持久化和事件

初期使用模块化单体和 SQLite，支持单人本地运行；多人部署时切换 PostgreSQL、API Server 和 Worker，领域模块不变。

当前状态与审计事件分离：

```text
current_state 表 / 账本
        +
audit_events 表 / 事件日志
```

典型事件：

```text
RequirementCreated
PlanStarted
PlanApproved
WorkspacePrepared
WorkItemAssigned
ImplementationStarted
TestPassed
ReviewApproved
OpenSpecVerified
BranchMerged
DeliveryClosed
```

事件用于审计、恢复和通知；当前状态用于高效查询。初期不要求完整 Event Sourcing。

## 9. 协作与权限

角色至少包括：

```text
ProductOwner       # 确认需求和验收标准
DeliveryOwner      # 管理 Delivery 和流程
Contributor        # 执行 WorkItem
Integrator         # 合并和最终验证
```

单人模式下角色可以由同一人兼任。多人模式下采用单一 Delivery Owner 管理交付状态，Contributor 只提交 WorkItem 和代码结果，不直接并发编辑交付账本。

并行执行必须满足：

- branch、worktree 唯一；
- write_scope 不重叠；
- 依赖存在且无循环；
- 公共契约和共享文件有明确负责人；
- 子任务不直接使用集成分支；
- 集成分支统一执行最终验证和收尾。

## 10. 项目配置

项目差异通过 ProjectProfile 配置，不写入核心流程代码。

```yaml
project:
  id: order-platform

repositories:
  - id: backend
    path: ../order-backend
    test: npm test
    lint: npm run lint
  - id: frontend
    path: ../order-frontend
    test: pnpm test
    lint: pnpm lint

planning:
  provider: openspec
  mode: shared
  repository: ../product-specs

workflow:
  require_review: true
  require_openspec_verify: true
  auto_prepare_workspace: true
  auto_run_tests: true

collaboration:
  allow_parallel_work_items: true
  require_write_scope: true
```

项目配置属于运行配置，不属于 OpenSpec 规划正文；除非项目已有明确配置约定，否则不由本设计新增额外文档目录。

## 11. 入口和集成

### CLI

用于本地、脚本和自动化：

```text
xiaoqi requirement create
xiaoqi delivery start <id>
xiaoqi delivery prepare <id>
xiaoqi delivery implement <id>
xiaoqi delivery verify <id>
xiaoqi delivery close <id>
xiaoqi status <id>
```

### API / Web

用于多人协作、权限、任务分配、审批、通知和状态查询。

### Skill

Skill 只负责将自然语言意图转换为控制平面命令或 API 请求，不再维护独立的状态机、账本规则和规划正文。

### Hook

Hook 负责捕获工具事件，调用统一事件入口，并将 allow、deny、stop 决策转换为宿主工具格式。

### CI

CI 负责测试、构建和质量检查，通过 Evidence Adapter 回传结构化结果，不直接修改流程状态。

## 12. 失败恢复

所有动作返回：

```text
outcome
summary
evidence
blockers
recommended_next
```

控制平面收到结果后重新读取当前状态、OpenSpec 状态、Git 状态和证据，再决定下一动作。

规则：

- 可重试的普通执行错误最多自动修复三次；
- 权限、破坏性操作、业务冲突和无法判断的错误进入人工门禁；
- blocked 状态必须记录恢复条件；
- 账本或数据库更新使用锁、revision 和原子提交；
- OpenSpec 解析失败不得猜测规划根；
- 任意阶段不得用“文件存在”代替真实状态和证据。

## 13. 迁移策略

### 第一阶段：核心领域和 CLI

实现 Requirement、Delivery、RepositoryBinding、PlanningBinding、WorkItem、Evidence 和 Workflow，使用 SQLite、本地 Git 和 OpenSpec Adapter，优先覆盖单需求、单仓库、单人流程。

### 第二阶段：多仓库和多需求

增加多 RepositoryBinding、多 PlanningBinding、Workspace Manager、需求间冲突检测和并行 Delivery。

### 第三阶段：多人协作

增加用户、角色、WorkItem 分配、分支隔离、并行任务、集成分支、审核和通知。

### 第四阶段：服务化和 Web

增加 API Server、PostgreSQL、Worker、Web 控制台、CI、GitHub/GitLab 和外部通知集成。

## 14. 验收标准

- 系统能通过 `openspec context --json` 得到唯一 `planningRoot`；
- 项目内 OpenSpec 模式下，小七目录位于项目规划根下；
- Store 模式下，小七目录位于 Store 的 `root.path` 下；
- 代码仓库不生成小七账本或自定义规划文档；
- 规划正文只使用 OpenSpec 标准工件；
- 四阶段流程均有明确状态、动作、人工门禁和证据要求；
- 九类场景通过统一实体关系表达；
- 单仓库、多仓库、单人、多人和多需求均不需要独立状态机；
- 小七、CLI、Web、Hook 和 CI 可以共享同一控制平面；
- 状态推进有可定位证据和审计事件；
- 失败可重试、可阻塞、可恢复；
- 不生成 `docs/superpowers`、自定义 plan、design、evidence 或 report 文件。

## 15. 非目标

- 初期不拆分为微服务；
- 不替代 OpenSpec 的规划格式和标准工件；
- 不替代 Git、CI、测试框架或 Agent 的执行能力；
- 不为每种仓库和协作组合创建独立流程；
- 不在代码仓库复制共享 Store 中的需求账本；
- 不新增独立的自定义文档体系。

# 小七需求交付控制平面实施任务

## 目标

基于 `design.md`，先实现可运行的第一期核心：领域模型、OpenSpec 规划根解析、小七管理目录、需求账本、四阶段应用服务、SQLite 持久化和 CLI。Web、多人服务化、CI/GitHub/GitLab 完整适配器作为后续阶段，不在本期实现。

## 全局约束

- 所有规划正文只使用当前 OpenSpec change 下的标准工件；不创建 `docs/superpowers/`、自定义 plan、design、evidence 或 report 文档。
- 所有小七运行数据必须位于 `openspec context --json` 返回的 `root.path/sprint-manage/` 下。
- OpenSpec 根目录解析失败时不得回退到当前项目目录。
- 领域模块不得依赖 Git、OpenSpec CLI、Trae、Codex 或具体文件路径。
- 通过测试先行定义接口；每个任务完成后运行对应测试和全量 Node 测试。
- 需求正文、设计正文、任务正文和规格正文不得复制到小七账本；账本只记录引用、状态、执行结果和证据索引。

## 第一阶段：核心领域和本地 CLI

### 任务 1：建立第一期运行骨架

**目标：** 建立独立于现有 Skill 脚本的应用目录、Node 模块配置和测试入口。

**文件：**
- 创建：`apps/cli/index.mjs`
- 创建：`application/index.mjs`
- 创建：`domain/index.mjs`
- 创建：`infrastructure/index.mjs`
- 创建：`adapters/index.mjs`
- 创建：`tests/platform-smoke.test.mjs`
- 修改：项目根 `package.json`（若不存在则创建；不得修改现有 Skill 的测试脚本语义）

**接口：**

```js
export function createPlatform({ planningContext, repository, workflow })
// 返回 { requirementService, deliveryService, statusService }
```

```js
export function createCli(argv, dependencies)
// 返回 { exitCode, stdout, stderr }
```

- [ ] 编写冒烟测试，验证 `createPlatform` 可以接收依赖并返回三个服务入口。
- [ ] 运行 `node --test tests/platform-smoke.test.mjs`，预期先失败，因为入口尚未存在。
- [ ] 创建最小 ESM 入口和 `package.json` 的测试脚本：`node --test "tests/**/*.test.mjs"`。
- [ ] 重新运行冒烟测试，预期通过。
- [ ] 运行现有 Skill 测试，确认新增骨架没有修改现有行为。

### 任务 2：实现领域模型和状态规则

**目标：** 把需求、交付、仓库绑定、规划绑定、WorkItem、Workspace、Evidence 和四阶段状态规则实现为无文件 IO 的纯模块。

**文件：**
- 创建：`domain/requirement.mjs`
- 创建：`domain/delivery.mjs`
- 创建：`domain/bindings.mjs`
- 创建：`domain/work-item.mjs`
- 创建：`domain/evidence.mjs`
- 创建：`domain/workflow.mjs`
- 创建：`tests/domain-model.test.mjs`
- 修改：`domain/index.mjs`

**接口：**

```js
export function createRequirement({ id, title, description, acceptanceCriteria, owner })
// 返回不可变的 Requirement 对象，status 为 "active"
```

```js
export function createDelivery({ id, requirementId, owner })
// 返回 phase: "start"、status: "draft" 的 Delivery
```

```js
export function transitionDelivery(delivery, event)
// 返回新对象；非法阶段迁移抛出带 code 的 Error
```

```js
export function validateRepositoryBinding(binding)
export function validatePlanningBinding(binding)
export function validateWorkItem(workItem)
export function validateEvidence(evidence)
```

阶段迁移必须支持：

```text
start.draft → start.analyzing → start.designing
start.designing → start.awaiting-approval
start.awaiting-approval → start.approved | start.rejected
start.approved → prepare.preparing
prepare.preparing → prepare.workspace-ready | prepare.prepare-blocked
prepare.workspace-ready → implement.implementing
implement.implementing → implement.testing → implement.reviewing
implement.reviewing → implement.implementation-complete | implement.implementation-blocked
implement.implementation-complete → close.verifying
close.verifying → close.archiving → close.finishing → close.closed
```

- [ ] 先写测试，覆盖对象默认值、合法迁移、非法迁移、证据成功条件和绑定字段约束。
- [ ] 运行领域测试，确认失败点是缺少模块或接口。
- [ ] 实现最小纯函数模型，禁止在这些文件中读取文件、执行命令或调用外部服务。
- [ ] 运行领域测试并修复失败。
- [ ] 运行现有测试，确认新领域模型与旧 Skill 脚本不冲突。

### 任务 3：实现 OpenSpec 规划根解析和文件边界策略

**目标：** 只从 `openspec context --json` 解析规划根，并集中生成小七管理路径；解析失败时返回诊断，不回退。

**文件：**
- 创建：`adapters/openspec/context.mjs`
- 创建：`adapters/openspec/artifact-policy.mjs`
- 创建：`tests/openspec-planning-root.test.mjs`
- 修改：`adapters/index.mjs`

**接口：**

```js
export function parseOpenSpecContext(stdout)
// 返回 { rootPath, mode, raw }；缺少 root.path 时抛出 code: "openspec-root-unresolved"
```

```js
export function resolvePlanningRoot({ cwd, execute })
// execute("openspec", ["context", "--json"], { cwd })
// 返回 { rootPath, mode, source: "openspec-context" }
```

```js
export function getXiaoqiRoot(planningRoot)
// 返回 path.join(planningRoot, "sprint-manage")
```

```js
export function assertWritablePath({ planningRoot, filePath, kind })
// kind 为 "xiaoqi" 时只允许 planningRoot/sprint-manage 下路径；
// kind 为 "openspec" 时只允许 OpenSpec 标准工件路径；否则抛错。
```

- [ ] 先写项目内 OpenSpec 和 Store 两种 JSON fixture 测试。
- [ ] 写解析失败、缺少 `root.path`、路径越界和禁止回退测试。
- [ ] 运行测试，确认尚未有实现。
- [ ] 实现 JSON 解析、路径规范化和大小写无关的 Windows 路径边界判断。
- [ ] 运行测试并确认项目根和 Store 根都指向对应的 `sprint-manage`。

### 任务 4：实现小七管理存储和 SQLite 仓储

**目标：** 将 Requirement、Delivery、Binding、WorkItem、Evidence 和审计事件持久化到规划根下的小七管理目录；不在代码仓库写入账本。

**文件：**
- 创建：`infrastructure/persistence/schema.sql`
- 创建：`infrastructure/persistence/sqlite-repository.mjs`
- 创建：`infrastructure/persistence/ledger-path.mjs`
- 创建：`tests/sqlite-repository.test.mjs`
- 修改：`infrastructure/index.mjs`

**接口：**

```js
export function createSqliteRepository({ planningRoot })
// 数据库位置固定为 planningRoot/sprint-manage/xiaoqi.db
// 首次使用创建 planningRoot/sprint-manage/，但不创建其他文档目录
```

```js
repository.requirements.create(requirement)
repository.requirements.get(id)
repository.deliveries.create(delivery)
repository.deliveries.get(id)
repository.bindings.replaceForDelivery(deliveryId, bindings)
repository.workItems.listByDelivery(deliveryId)
repository.evidence.append(evidence)
repository.events.append(event)
```

- [ ] 先写测试，使用临时 OpenSpec root，验证数据库只创建在 `root/sprint-manage/xiaoqi.db`。
- [ ] 验证 SQLite 表至少包含 requirements、deliveries、repository_bindings、planning_bindings、work_items、evidence、audit_events。
- [ ] 验证重复 ID 被拒绝，读写后对象字段完整，事件按创建时间可查询。
- [ ] 运行测试，确认缺少仓储实现。
- [ ] 实现最小 SQLite 仓储和事务封装；所有写入在事务中完成。
- [ ] 运行测试并检查代码仓库目录没有生成小七文件。

### 任务 5：实现开始阶段应用服务

**目标：** 用 OpenSpec 标准工件引用管理需求分析、设计、方案确认，不生成小七自定义规划文档。

**文件：**
- 创建：`application/start-delivery.mjs`
- 创建：`tests/start-delivery.test.mjs`
- 修改：`application/index.mjs`

**接口：**

```js
export function createStartDeliveryService({ repository, openspec })
```

服务方法：

```js
createRequirement(input)
attachPlanningChange(deliveryId, planningBinding)
recordArtifactReferences(deliveryId, { proposalPath, designPath, tasksPath, specPaths })
approvePlan(deliveryId, actor)
rejectPlan(deliveryId, actor, reason)
```

- [ ] 写测试，验证创建需求和交付时只生成账本数据库记录。
- [ ] 写测试，验证规划正文路径必须是 OpenSpec 标准工件路径，并且小七只保存引用。
- [ ] 写测试，验证未审批不能进入 prepare，审批后才能进入 prepare。
- [ ] 运行测试确认失败。
- [ ] 实现服务和事务边界。
- [ ] 运行测试，并确认没有生成 `plan.md`、`design.md`、`evidence.json` 等非标准文件。

### 任务 6：实现准备阶段 Workspace Manager

**目标：** 半自动准备单仓库、多仓库、单人和多人工作区，并把结果写入 RepositoryBinding、Workspace 和 WorkItem。

**文件：**
- 创建：`application/prepare-delivery.mjs`
- 创建：`infrastructure/workspace-manager.mjs`
- 创建：`tests/prepare-delivery.test.mjs`
- 修改：`application/index.mjs`

**接口：**

```js
export function createWorkspaceManager({ git, pathExists, mkdir })
export function createPrepareDeliveryService({ repository, workspaceManager, policy })
```

服务方法：

```js
prepareDelivery(deliveryId, { repositories, workItems, mode })
checkConflicts(deliveryId)
assignWorkItem(workItemId, assignee)
```

- [ ] 写测试覆盖单仓库当前 worktree、单需求多仓库独立 worktree、多人 WorkItem 分配。
- [ ] 写测试覆盖重复 branch、重复 worktree、写入范围重叠、依赖循环和未审批阻断。
- [ ] 运行测试确认失败。
- [ ] 实现 Git 端口调用，不在应用服务中直接执行 shell。
- [ ] 实现准备结果持久化和 workspace-ready 状态推进。
- [ ] 运行测试和现有 worktree 测试。

### 任务 7：实现实施和收尾应用服务

**目标：** 提供结构化执行器接口，支持 TDD、检查、评审、OpenSpec verify、归档和分支收尾证据。

**文件：**
- 创建：`application/implement-work-item.mjs`
- 创建：`application/close-delivery.mjs`
- 创建：`infrastructure/execution/command-executor.mjs`
- 创建：`tests/implement-close.test.mjs`
- 修改：`application/index.mjs`

**接口：**

```js
export function createCommandExecutor({ executeCommand, policy })
// 返回 run({ command, args, cwd, writeScope })
// 结果为 { success, exitCode, stdout, stderr, commit, artifacts }
```

```js
export function createImplementationService({ repository, executor, workflowPolicy })
export function createCloseDeliveryService({ repository, executor, openspec, git })
```

实施方法：

```js
runTdd(workItemId)
runChecks(deliveryId)
requestReview(deliveryId)
recordImplementationEvidence(deliveryId, evidence)
```

收尾方法：

```js
verifyDelivery(deliveryId)
archiveOpenSpec(deliveryId)
finishDelivery(deliveryId, { branchAction, workspaceAction, result })
```

- [ ] 写测试，验证执行器只返回结构化结果，不直接推进交付状态。
- [ ] 写测试，验证测试、Lint、review、OpenSpec verify 的证据才能推进对应阶段。
- [ ] 写测试，验证未归档或未 finish 不能关闭 Delivery。
- [ ] 写测试，验证 merge、keep、delete 和 remove、keep、handoff 的结果被记录。
- [ ] 运行测试确认失败。
- [ ] 实现命令执行端口、证据记录和阶段迁移。
- [ ] 运行测试并确认所有文件写入都经过路径策略。

### 任务 8：实现 CLI 入口和状态查询

**目标：** 为第一期提供可用于单人本地运行的 CLI，不依赖 Skill。

**文件：**
- 修改：`apps/cli/index.mjs`
- 创建：`apps/cli/commands/requirement.mjs`
- 创建：`apps/cli/commands/delivery.mjs`
- 创建：`apps/cli/commands/status.mjs`
- 创建：`tests/cli.test.mjs`

**命令：**

```text
xiaoqi requirement create
xiaoqi delivery start <delivery-id>
xiaoqi delivery prepare <delivery-id>
xiaoqi delivery implement <delivery-id>
xiaoqi delivery verify <delivery-id>
xiaoqi delivery close <delivery-id>
xiaoqi status <delivery-id>
```

- [ ] 写测试验证命令参数错误返回非零退出码和可读错误。
- [ ] 写测试验证 `status` 只读取 OpenSpec root 下的 SQLite 数据，不读取代码仓库账本。
- [ ] 写测试验证命令按顺序阻止未审批、未准备、未验证的越级操作。
- [ ] 运行测试确认失败。
- [ ] 实现 CLI 命令解析、依赖组装和 JSON/文本输出。
- [ ] 运行 CLI 测试和全量 Node 测试。

### 任务 9：回接现有 Skill 和适配器

**目标：** 让现有 Skill、Trae、Codex 和通用 Hook 成为新控制平面的入口，而不是继续维护第二套状态机。

**文件：**
- 修改：`skills/sprint-manage-xiaoqi/SKILL.md`
- 修改：`skills/sprint-manage-xiaoqi/scripts/openspec-context.mjs`
- 修改：`skills/sprint-manage-xiaoqi/scripts/trae-hook.mjs`
- 修改：`skills/sprint-manage-xiaoqi/scripts/codex-hook.mjs`
- 修改：`skills/sprint-manage-xiaoqi/scripts/generic-hook.mjs`
- 创建：`tests/control-plane-adapter.test.mjs`

- [ ] 写测试验证 Hook 解析的 `root.path` 与 CLI 使用同一规划根。
- [ ] 写测试验证多需求时必须显式指定 delivery ID，不根据 Store ID 猜测路径。
- [ ] 写测试验证旧账本没有自动复制到代码仓库，未迁移数据不被静默覆盖。
- [ ] 运行适配器测试确认失败。
- [ ] 将 Skill 的动作路由改为调用 CLI/API 控制平面；保留会话交互，但删除重复的流程事实定义。
- [ ] 将 Hook 统一事件转换为控制平面事件，保留 Trae/Codex 各自响应格式。
- [ ] 运行全部现有 Skill 测试、第一期测试和目录边界测试。

## 后续阶段任务（本期不实现）

### 多人服务化

- 增加 API Server、PostgreSQL、用户和角色权限。
- 增加 Worker、任务认领、并发锁、通知和审计查询。
- 将 SQLite Repository 和执行器抽象替换为可部署实现。

### Web 控制台

- 提供需求、Delivery、WorkItem、仓库绑定、审批和证据查询页面。
- 支持多人协作看板、阻塞项和收尾操作。

### 外部集成

- GitHub、GitLab、CI、容器 Workspace 和远程 Agent Adapter。

## 验收标准

- OpenSpec 项目根和 Store 两种模式都能解析规划根。
- 小七数据库只位于 `<planningRoot>/sprint-manage/`。
- 代码仓库不创建小七账本和自定义规划文档。
- 只有 OpenSpec 标准工件保存规划正文。
- 四阶段服务可按证据和权限顺序推进。
- 单需求单仓库单人、单需求多仓库单人、单需求单仓库多人、单需求多仓库多人、多需求并行均由统一模型表达。
- CLI 不依赖 Skill，可独立运行。
- Hook 和 Skill 回接后不再维护第二套流程状态机。
- 全量 Node 测试通过。

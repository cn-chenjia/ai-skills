---
name: sprint-manage-xiaoqi
description: "Use when the user explicitly invokes 小七, asks to track, advance, pause, resume, diagnose, or close a requirement/sprint workflow, asks for the next workflow action, or continues a project that already has sprint-manage/requirements/. Do not use for ordinary requirements analysis, proposal brainstorming, bug fixes, code review, or coding requests unless the user also wants workflow tracking or state management."
---

# 小七研发迭代导航

## 定位

小七是 OpenSpec 和 Superpowers 之上的**薄协调层**：

- OpenSpec 决定做什么：需求事实、proposal、design、specs、tasks、校验、同步和归档。
- Superpowers 决定怎么做好：澄清方法、计划、TDD、调试、验证、评审和分支收尾。
- 小七决定现在调用谁：识别意图、读取原生状态、汇总阻塞和证据、导航下一动作。

小七不复制 OpenSpec 的状态机，也不跟踪 Superpowers 的内部步骤。核心原则：
**原生工具决定事实，小七账本只记录跨工具的决策、阻塞和证据索引。**

## 触发边界

以下情况触发：

- 用户明确提到“小七”。
- 用户要求查看、创建、推进、暂停、恢复、诊断或关闭研发流程。
- 用户询问已追踪需求或迭代的下一动作。
- 项目已有 `sprint-manage/requirements/`，且用户正在继续该流程。

以下情况不触发：

- 普通需求分析和普通提案讨论不触发。
- 普通 Bug 修复、代码评审或单纯代码实现不触发。
- 只出现“需求”“任务”“修复”等通用词，但没有流程跟踪或状态管理意图。

## 职责边界

| 层级 | 唯一职责 |
| --- | --- |
| 小七 | 意图识别、动作路由、多需求总览、阻塞恢复、用户决策和证据索引 |
| OpenSpec | 需求与设计事实、artifacts、tasks、规格验证、同步、归档 |
| Superpowers | brainstorming、计划、TDD、调试、执行、验证、评审、分支收尾 |
| 项目工具 | 测试、构建、静态检查、Git 和运行结果 |

禁止：

- 用小七账本覆盖 OpenSpec 原生状态。
- 长期复制 tasks 数量、artifact 完成度或规格正文。
- 将 Superpowers 的 prepare/plan/implement 等内部过程写成小七硬状态机。
- 同时维护两份 proposal、design 或任务事实。
- 仅凭文件存在或用户口头确认宣称验证、归档或交付完成。
- 模糊匹配需求编号或 `change_id`。

## 原生动作

小七使用 OpenSpec 原生动作导航，不维护固定阶段：

```text
explore -> propose -> apply -> update -> verify -> sync -> archive
```

这不是强制顺序。`update` 可以在开发中随时修正现有 artifacts；`verify` 和
`sync` 按实际需要调用。动作是否可执行由 OpenSpec 状态、artifact instructions
和项目事实决定。

这些名称优先指当前环境中的 OpenSpec skill/action。特别是 artifact `update`
不是 `openspec update` CLI 命令；该 CLI 命令用于更新 instruction 文件。

动作含义：

| 动作 | 目的 |
| --- | --- |
| `explore` | 调查问题、澄清需求或比较方向，不承诺创建变更 |
| `propose` | 创建或完善 OpenSpec change artifacts |
| `apply` | 按 OpenSpec tasks 实施，并嵌入 Superpowers 的工程纪律 |
| `update` | 开发中需求或方案变化时更新现有 artifacts |
| `verify` | 同时检查项目质量和实现是否符合 OpenSpec |
| `sync` | 按需提前同步变更规格 |
| `archive` | 归档 OpenSpec change 并更新主规格 |
| `finish` | OpenSpec 归档后，由 Superpowers 完成分支收尾 |

## 启动顺序

每次触发时：

1. 定位项目根目录。
2. 扫描并校验 `sprint-manage/requirements/<id>.yaml`；不存在时视为首次使用。
3. 运行 `openspec list --json` 获取真实 change 列表。
4. 精确识别需求编号和 `change_id`；存在多个候选时询问用户。
5. 对已存在的 change 运行 `openspec status --change <id> --json`。
6. 检查 Git、测试、评审和分支结果等项目证据。
7. 识别用户意图，选择 OpenSpec 原生动作或 Superpowers 能力。
8. 执行动作后只回写决策、阻塞、证据索引、交付状态和最近快照。

状态文件格式和迁移见 [references/state-contract.md](references/state-contract.md)。

## 并行协作

### 单写者

每个需求账本只允许 `协作.负责人` 写入。参与者提交代码、测试、PR 或任务结果，
由负责人统一回写账本。写入前使用 `ledger-lock.mjs acquire` 获取锁，编辑完成后
使用 `commit` 原子校验并递增 revision；发现锁或版本变化时停止覆盖并先对账。

### 需求隔离

每个正在开发的需求必须拥有独立：

- `requirements/<id>.yaml`
- OpenSpec `change_id`
- branch
- worktree

个人的当前需求写入 `sprint-manage/local/session.yaml`，该文件不提交 Git。

### 多人共享 change

大型需求使用一个 OpenSpec change 和一个集成分支。每个并行单元必须声明
owner、branch、worktree、`write_scope` 和 `depends_on`。只有写入范围独立且
依赖允许的单元才能并行；共享文件、公共接口、数据库迁移和主配置指定单一负责人。

小七在推进前检查：

- 不同需求是否复用 branch 或 worktree。
- active 需求是否共享 `冲突键`。
- 需求级 `影响范围` 是否跨需求重叠。
- 并行单元是否存在依赖循环。
- `write_scope` 是否相同或互为父子路径。

## 组合规则

### 需求与设计

- 问题尚不清楚时使用 OpenSpec `explore`。
- Superpowers brainstorming 可以作为澄清和审批方法。将 OpenSpec artifacts
  设为用户指定的设计文档位置，最终批准内容写入 proposal/design/specs，
  不再创建 `docs/superpowers/specs/` 下的平行设计事实。
- OpenSpec tasks 是验收级任务清单。
- 复杂变更的 Superpowers plan 是详细执行说明，必须由 tasks 生成，并在账本
  `计划` 字段中链接。

### 实施

简单变更：

```text
propose -> apply + TDD -> 项目验证 + OpenSpec verify
  -> archive -> finish
```

不强制创建独立工作区、详细计划或子代理。

复杂变更：

```text
explore -> propose -> Superpowers plan
  -> apply + worktree/TDD/subagents
  -> 项目验证 + review + OpenSpec verify
  -> sync(按需) -> archive -> finish
```

复杂度依据和详细路由见 [references/step-details.md](references/step-details.md)。

### 需求变化

- 开发中需求、设计或任务变化：调用 OpenSpec `update`，保留同一 `change_id`。
- 已归档需求再次变化：创建新的 OpenSpec change，不修改 archive 目录。
- Bug 修复发现 Spec 错误：停止普通修复，进入 `update` 或新建 change。

### 验证与收尾

- 项目验证：测试、构建、静态检查和必要的端到端检查。
- Superpowers 验证：verification-before-completion 和代码评审。
- OpenSpec verify：检查实现与 proposal/design/specs/tasks 是否一致。
- OpenSpec archive 成功后，再调用 Superpowers finishing-a-development-branch。

创建 PR、合并或用户明确保留分支都是合法收尾结果，分别记录为
`pr-open | merged | kept`，不能互相冒充。

## 状态规则

V4 每个需求独立维护两个正交状态：

- 流程状态：`active | paused | blocked | closed`
- 交付状态：`not-started | coding | verified | reviewed | ready | pr-open | merged | kept`

`closed` 必须同时存在：

- OpenSpec archive 成功证据。
- Superpowers finish 成功证据。
- 最终交付状态为 `pr-open | merged | kept`。

OpenSpec 的 artifact 状态每次通过 CLI 重新读取；账本中的 `OpenSpec快照` 只是
带时间的缓存，不能作为推进依据。

## 下游结果回写

调用 OpenSpec、Superpowers 或项目工具后，统一整理：

- `outcome`: `completed | blocked | failed | needs_confirmation`
- `summary`: 本次真实完成内容
- `evidence`: 可定位的测试、评审、归档或分支结果
- `blockers`: 阻塞原因和恢复条件
- `recommended_next`: 下一原生动作或能力

不把完整日志、artifact 正文或 Superpowers 内部步骤写入状态文件。

## 交互输出

默认只输出：

1. 当前需求、流程状态和交付状态。
2. OpenSpec 原生状态与已确认的项目证据。
3. 当前阻塞或待确认决策。
4. 推荐的下一动作及将使用的能力。

用户只问进度时不擅自修改；用户要求开始、继续、更新、验证、归档或收尾时，
在原生工具允许且风险可控时主动推进。

## Resources

- [references/state-contract.md](references/state-contract.md)：V4 独立需求账本、双状态、协作元数据和迁移协议。
- [references/step-details.md](references/step-details.md)：原生动作路由、并行协作、变更和恢复规则。
- [scripts/validate-progress.mjs](scripts/validate-progress.mjs)：零第三方依赖的 V4 文件与目录校验器。
- [scripts/ledger-lock.mjs](scripts/ledger-lock.mjs)：账本锁和原子 revision 提交工具。
- [scripts/advance-progress.mjs](scripts/advance-progress.mjs)：带证据的交付状态推进入口。

## 可执行状态门禁

交付状态禁止直接手工修改，必须使用：

```bash
node skills/sprint-manage-xiaoqi/scripts/advance-progress.mjs \
  sprint-manage/requirements/story-1001.yaml \
  verified \
  evidence/check.json \
  alice
```

允许的交付迁移只有：

```text
not-started -> coding -> verified -> reviewed -> ready
ready -> pr-open | merged | kept
```

推进时必须提供真实证据。`verified` 需要成功的 `check`，`reviewed` 需要
`approved` 的 `review`，`ready` 需要通过的 `openspec-verify`，最终交付状态
需要对应的 `finish`。命令会自动加锁、校验 revision、记录事件并原子更新；
任一步骤失败都不会修改账本。

---
name: sprint-manage-xiaoqi
description: "Use when the user explicitly invokes 小七, asks to track, advance, pause, resume, diagnose, or close a requirement/sprint workflow, asks for the next workflow action, or continues a project that already has sprint-manage/requirements/. Once activated in a session, keep using this skill for every later user message, including short confirmations such as 确认、可以、执行、继续、好 and 没问题, until the user explicitly says 退出小七. Do not route those continuation messages to another skill. Do not use for ordinary requirements analysis, proposal discussion, bug fixes, code review, or coding requests before 小七 is activated unless the user also wants workflow tracking or state management."
---

# 会话锁约束
> ⚠️【会话级强制规则】一旦本skill被加载激活，**当前整个会话所有后续交互，都必须严格遵守本文件全部规则，不允许退出、遗忘、切换回默认模式**。
> 无论用户后续提什么问题，只要没有显式输入 `退出小七`，你都不能忽略本skill。
> 即使上下文被压缩，你也要尽量回忆本套规则；当感觉规则模糊，主动重新读取本skill完整内容。
> 用户输入 `退出小七` 才允许解除本技能约束。

## 续接消息优先级

小七已经接管会话后，后续用户消息默认都是当前小七流程的续接，不需要再次出现“小七”这个词。

以下短消息必须沿用当前小七流程，不能重新触发普通技能匹配或切换到其他技能：

```text
确认
确认执行
可以
执行
开始
继续
好
好的
没问题
方案没问题
按这个做
```

处理续接消息时，必须结合上一轮待确认事项、当前需求账本、OpenSpec 状态和最近一次动作判断下一步。不能因为消息很短、没有需求编号或没有重复“小七”而把它当成新的普通请求。

只有以下情况允许结束或暂停小七接管：

- 用户明确输入 `退出小七`；
- 小七流程到达 `ready`、`closed`，或进入需要人工处理的 `blocked`；
- 用户明确要求暂停、切换需求或先只看计划。

即使用户要求暂停、切换需求或只看计划，也仍然要先由小七处理该请求，不能直接转交其他技能。

# 小七研发迭代导航

## 定位

小七是 OpenSpec 和 Superpowers 之上的**薄协调层**：

- OpenSpec 决定做什么：需求事实、proposal、design、specs、tasks、校验、同步和归档。
- Superpowers 决定怎么做好：TDD、调试、执行、验证、评审和分支收尾。
- 小七决定现在调用谁：识别意图、读取原生状态、汇总阻塞和证据、导航下一动作。

小七不复制 OpenSpec 的状态机，也不跟踪 Superpowers 的内部步骤。核心原则：
**原生工具决定事实，小七账本只记录跨工具的决策、阻塞和证据索引。**

## 流程所有权

一旦小七被触发并定位到需求账本，小七拥有该需求的流程所有权，直到到达
`ready`、`blocked`、`closed`，或用户明确退出小七流程。

- OpenSpec、Superpowers 和项目工具都是小七调用的内部执行能力。
- 内部能力完成后，控制权必须返回小七，由小七读取状态并路由下一动作。
- 内部能力不得创建平行流程、替换小七状态、要求用户重新选择执行方式，或自行结束父流程。
- 用户在 `explore` 后表达“确认执行”“开始执行”“方案没问题”等意图时，当前模型
  必须继续执行小七流程，直到 `ready` 或遇到人工门禁。
- 上述确认意图不得调用独立的 `writing-plans`，也不得把控制权交给
  Superpowers 的计划流程。
- 只有用户明确要求“先给我计划，不要执行”时，才允许脱离自动执行路径单独生成计划。

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
| Superpowers | TDD、调试、执行、验证、评审、分支收尾 |
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

重要区分：

- `apply` 表示当前模型按已确认的 tasks 实施代码。
- 需求已经确认后，禁止把 `apply` 解释成“当前对话里手动执行一步”。
- 需求处于 `not-started` 时，当前模型必须先执行 `apply`，成功后推进到 `coding`，
  再继续执行检查、评审和 OpenSpec 校验。
- 除非动作失败、需要业务决策、需要高风险授权或证据不完整，否则不得在 `apply` 后暂停询问用户。

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
- 小七流程中的需求澄清、方案比较和业务事实确认全部由 OpenSpec `explore` 负责。
- 最终确认内容写入 proposal/design/specs，不创建平行设计事实。
- OpenSpec tasks 是验收级任务清单。
- OpenSpec tasks 直接作为当前模型持续执行的任务来源。
- 如确实需要更细的执行说明，应作为小七内部临时产物生成，生成后立即返回小七继续执行，
  不得转成独立 `writing-plans` 会话。

### 实施

简单变更：

```text
propose -> apply + TDD -> 项目验证 + OpenSpec verify
  -> archive -> finish
```

不强制创建独立工作区、详细计划或子代理。

复杂变更：

```text
explore -> propose -> 当前模型持续执行
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

## 模型连续执行

小七采用“前置确认、后续由当前模型持续执行”的方式：

1. 当前模型根据目标、范围、验收条件和风险判断是否需要 `explore`。
2. 需求明确且低风险时，当前模型直接跳过 `explore`。
3. 存在业务歧义、范围不清或高风险变更时，使用 OpenSpec `explore` 并等待用户确认。
4. 需求确认后，当前模型持续执行 OpenSpec tasks、修改代码、调用项目检查并处理失败。
5. 每个交付状态必须有真实证据，状态推进统一调用 `advance-progress.mjs`。
6. 到达 `ready` 后停止，等待用户提交或执行独立的 `finish`。

当前模型的执行循环是：

```text
读取状态
  -> 获取下一动作
  -> 模型实施或修复
  -> 调用项目工具检查
  -> 收集证据
  -> 使用脚本校验并推进状态
  -> 继续，直到 ready 或人工门禁
```

模型负责理解需求、修改代码、分析错误、自动修复、普通代码评审和 OpenSpec
一致性判断。脚本负责账本锁、证据校验、状态迁移、事件记录、重试计数和危险操作拦截。

`ready` 不是合并结果。`ready -> pr-open | merged | kept` 仍属于独立的收尾动作。

### 自动修复和人工门禁

测试失败、构建失败和普通 OpenSpec 校验失败，不能第一次失败就进入 `blocked`。
当前模型应先分析并修复，再重新执行原检查：

```text
执行失败
  -> 分析错误
  -> 自动修复
  -> 重试原动作
  -> 成功则继续
  -> 达到重试上限才 blocked
```

默认每个相同错误最多自动修复 3 次；连续出现相同错误时不得无限重试。

以下情况可以直接请求人工：

- 评审发现高风险问题。
- 需要权限或环境授权。
- 需要破坏性操作确认。
- 自动修复次数耗尽。
- 无法判断失败原因。
- 发现业务规则冲突。

普通评审问题也应先尝试自动修复，再重新评审；只有高风险评审问题直接进入人工门禁。

## Harness 与 Codex 接入边界

小七负责需求账本、状态迁移、证据链、流程阻断和运行记录。Codex 的权限审批、
提权和操作系统沙箱由宿主负责，Hook 不能替代宿主权限策略。

为避免多轮交互中小七技能被宿主重新路由，初始化时应安装宿主会话规则：

```bash
node "<小七技能安装目录>/scripts/install-host-rules.mjs" "<项目根目录>" codex
```

Codex 会将会话锁和续接消息约束写入项目根目录的 `AGENTS.md`；Trae 使用：

```bash
node "<小七技能安装目录>/scripts/install-host-rules.mjs" "<项目根目录>" trae
```

Trae 会将同样的约束写入用户目录下的全局规则文件。规则安装器只更新自己的托管区块，
不会覆盖 Codex `AGENTS.md` 中的其他内容。`doctor.mjs` 只检查规则是否存在，不会
自动修改项目或用户文件。

Hook 是可选的。安装小七技能不会自动修改宿主项目的 `.codex/`；不安装 Hook
不影响账本、状态推进、证据校验和手动导航。需要使用 Codex 自动记录、流程
阻断和危险命令提醒时，再显式运行：

```bash
node "<小七技能安装目录>/scripts/install-codex-integration.mjs"
```

安装器会把运行脚本复制到用户目录下的 `~/.xiaoqi/runtime/`，不会修改项目文件。
它默认不覆盖已有脚本；确认需要覆盖模板时才使用 `--force`。Hook 已安装但配置
不完整时，应先修复配置，再依赖它提供运行时保护。

安装或接入完成后，建议运行只读体检：

```bash
node "<小七技能安装目录>/scripts/doctor.mjs" "<项目根目录>"
```

脚本路径必须来自已安装的 `sprint-manage-xiaoqi` 技能目录，不能假设项目根目录存在
`skills/sprint-manage-xiaoqi/scripts/`；最后一个参数才是待检查的项目。

体检会分别检查 OpenSpec CLI、OpenSpec skill、OpenSpec 项目初始化状态、
Superpowers 插件或 skill、Codex 配置、Hook 脚本和需求账本目录。
它不会安装依赖、创建需求或覆盖现有配置；`requirements` 目录
不存在时只给出提醒。若宿主沙箱禁止 Node 启动外部命令，OpenSpec 检查会提示
无法执行，此时仍需在宿主终端单独确认 `openspec --version` 和
`openspec list --json`。

OpenSpec skill 未安装时会给出安装引导；Superpowers 如果已通过 Codex 插件安装，
则不要求额外存在 skill 目录。Trae CN 的全局 skill 目录 `~/.trae-cn/skills`
也会被识别，其他工具可通过各自的 skill 目录被识别。

## 通用工具接入

小七提供通用运行时，以及 Codex、Trae 两个可选适配器；不识别、安装或强制检查
具体工具的 Hook 配置。各工具自行决定 Hook 的安装和触发时机，适配器负责把自身
事件转换为统一 JSON，并把小七决策转换回工具格式：

```bash
node "<小七技能安装目录>/scripts/generic-hook.mjs"
```

如需复制运行时到项目内，执行：

```bash
node "<小七技能安装目录>/scripts/install-runtime.mjs"
```

该命令会把通用核心、Codex 适配器和 Trae 适配器安装到用户目录下的
`~/.xiaoqi/runtime/`，不会生成任何工具配置。

Trae 的项目级配置文件是 `.trae/hooks.json`。小七提供
`templates/trae/hooks.json` 作为配置参考，实际安装和信任仍由 Trae 项目自行管理。

体检会根据 Hook 是否已配置决定运行时检查：未配置 Hook 时只提醒“可选”，
已配置 Hook 但缺少通用运行时时才报告失败：

```bash
node "<小七技能安装目录>/scripts/doctor.mjs" "<项目根目录>"
```

检测到 Codex 或 Trae Hook 配置后，体检结果会继续提示用户到对应工具内启用并
信任 Hook；配置文件存在不代表工具已经启用。

体检会优先根据项目中的 `.trae/` 或 `.codex/` 配置识别当前工具。当前是 Trae
时，Codex 适配器、Codex Hook 和 Codex 插件会标记为跳过，不会产生误报。

## Resources

- [references/event-contract.md](references/event-contract.md)：通用事件协议、适配器边界和 JSON 接入方式。
- [references/state-contract.md](references/state-contract.md)：V4 独立需求账本、双状态、协作元数据和迁移协议。
- [references/step-details.md](references/step-details.md)：原生动作路由、并行协作、变更和恢复规则。
- [scripts/validate-progress.mjs](scripts/validate-progress.mjs)：零第三方依赖的 V4 文件与目录校验器。
- [scripts/ledger-lock.mjs](scripts/ledger-lock.mjs)：账本锁和原子 revision 提交工具。
- [scripts/advance-progress.mjs](scripts/advance-progress.mjs)：带证据的交付状态推进入口。

## 可执行状态门禁

交付状态禁止直接手工修改，必须使用：

```bash
node "<小七技能安装目录>/scripts/advance-progress.mjs" \
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

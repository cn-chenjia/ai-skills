# sprint-manage-xiaoqi

## 一、技能简介

小七是 CJ 数字团队研发迭代的协调助手，负责把用户的研发意图连接到 OpenSpec、Superpowers 和项目工具。

她的目标不是维护另一套研发状态机，而是让开发者始终知道：

- 当前需求是什么。
- 当前真实状态是什么。
- 下一步应该调用哪个动作。
- 当前有哪些阻塞、待确认事项和可验证证据。

小七是一层薄协调层：

| 角色 | 负责内容 |
| --- | --- |
| 小七 | 意图识别、动作路由、多需求总览、阻塞恢复、用户决策和证据索引 |
| OpenSpec | 需求事实、proposal、design、specs、tasks、规格校验、同步和归档 |
| Superpowers | TDD、调试、执行、验证、评审和分支收尾 |
| 项目工具 | 测试、构建、静态检查、Git、CI 和其他运行结果 |

核心原则：

> 原生工具决定事实，小七账本只记录跨工具的决策、阻塞和证据索引。

小七不会复制 OpenSpec 的状态机，也不会把 Superpowers 的内部步骤改写成另一套固定流程。

## 流程所有权

一旦小七被触发并定位到需求账本，小七拥有该需求的流程所有权，直到到达
`ready`、`blocked`、`closed`，或用户明确退出小七流程。

- OpenSpec、Superpowers 和项目工具只是小七调用的内部能力。
- 内部能力完成后，控制权必须返回小七。
- 用户在 `explore` 后确认执行时，当前模型必须继续执行到 `ready` 或人工门禁。
- 不得把“确认执行”路由到独立 `writing-plans`。
- 只有用户明确说“先给我计划，不要执行”时，才单独生成计划。

## 二、当前工作方式

小七使用 OpenSpec 的原生动作进行导航：

```text
explore -> propose -> apply -> update -> verify -> sync -> archive
```

`finish` 在 OpenSpec 归档完成后，由 Superpowers 负责分支收尾。

这些动作不是强制阶段链。某个动作是否需要执行，以当前 OpenSpec 状态、artifact instructions、项目事实和用户意图为准。

| 动作 | 作用 | 主要责任方 |
| --- | --- | --- |
| `explore` | 调查问题、澄清需求、比较方向和确认业务事实 | OpenSpec |
| `propose` | 创建或完善 OpenSpec change artifacts | OpenSpec |
| `apply` | 按 tasks 实施变更，并遵循 Superpowers 的工程纪律 | OpenSpec + Superpowers |
| `update` | 开发中需求、设计或任务发生变化时更新现有 artifacts | OpenSpec |
| `verify` | 检查项目质量以及实现与规格的一致性 | 项目工具 + Superpowers + OpenSpec |
| `sync` | 按需提前同步主规格或共享规格 | OpenSpec |
| `archive` | 归档 change 并更新主规格 | OpenSpec |
| `finish` | 归档后的分支收尾，可创建 PR、合并或保留分支 | Superpowers |

当前不要求用户先在 OpenSpec、直接开发或 BMAD 之间选择模式。小七应先读取真实状态，再根据当前任务和工具能力选择下一步动作。

重要区分：

- `apply` 表示当前模型按已确认的 tasks 实施代码。
- 需求已经确认后，不能把 `apply` 理解成“当前对话里手动执行一步”。
- 需求处于 `not-started` 时，当前模型必须先执行 `apply`，成功后推进到 `coding`，
  再继续执行检查、评审和 OpenSpec 校验。
- 除非动作失败、需要业务决策、需要高风险授权或证据不完整，否则不能在 `apply` 后暂停询问用户。

## 三、触发范围

以下情况会触发小七：

- 用户明确提到“小七”。
- 用户要求查看、创建、推进、暂停、恢复、诊断或关闭研发流程。
- 用户询问已追踪需求或迭代的下一步。
- 项目已经存在 `sprint-manage/requirements/`，且用户正在继续该流程。
- 小七已经在当前会话接管流程后，用户发送“确认”“可以”“执行”“继续”“好”
  等简短确认或续接消息。

一旦小七在当前会话接管流程，后续消息默认继续使用小七，不要求用户重复输入“小七”。
只有用户明确输入 `退出小七` 才解除会话接管。短确认消息不能因为缺少上下文关键词而
被重新路由到其他技能。

为了让宿主在多轮交互中持续保留这个约束，初始化时应安装宿主规则：

```bash
node "<小七技能安装目录>/scripts/install-host-rules.mjs" "<项目根目录>" codex
node "<小七技能安装目录>/scripts/install-host-rules.mjs" "<项目根目录>" trae
```

Codex 规则写入项目 `AGENTS.md`，Trae 规则写入用户级全局规则。初始化检查只负责发现
规则缺失并提示，不自动修改用户文件。

以下情况通常不触发小七：

- 普通需求分析或方案讨论，但没有要求流程跟踪。
- 普通 Bug 修复、代码实现或代码评审。
- 只出现“需求”“任务”“修复”等通用词，但没有明确流程管理意图。

## 四、每次启动时的检查

每次触发后，小七按以下顺序读取事实：

1. 定位项目根目录。
2. 扫描并校验 `sprint-manage/requirements/<id>.yaml`。
3. 如果存在多个需求候选，要求用户明确需求编号。
4. 运行 `openspec list --json` 获取真实 change 列表。
5. 对目标 change 运行 `openspec status --change <id> --json`。
6. 检查 Git、测试、评审、分支和工作区证据。
7. 识别用户意图，选择 OpenSpec 原生动作或 Superpowers 能力。
8. 执行动作后只回写决策、阻塞、证据索引、交付状态和最近快照。

小七不能根据模糊的需求编号、文件是否存在或用户口头说“完成了”来猜测状态。

## 五、需求账本和并行协作

每个正在开发的需求必须拥有独立的：

```text
sprint-manage/requirements/<id>.yaml
OpenSpec change_id
base branch
Git branch
worktree
```

个人当前正在处理的需求记录在：

```text
sprint-manage/local/session.yaml
```

该文件不提交 Git。

需求在调查和方案阶段不需要提前创建工作区。准备执行 `apply` 时，小七先运行独立的
工作区准备步骤：首个编码需求可以使用当前目录；当前目录已经被其他编码需求占用时，
从需求账本记录的基线分支自动创建 `.worktrees/<需求编号>`。创建成功后再继续编码，
准备失败时不推进需求状态。

### 单写入者规则

每个需求账本只允许 `协作.负责人` 写入。其他参与者通过代码、测试、PR 或任务结果向负责人交付，不直接并发修改同一个账本。

写入账本前必须：

1. 获取账本锁。
2. 重新读取账本并校验 `revision`。
3. 原子写入状态、事件和证据。
4. 递增 `revision` 并释放锁。

### 多人并行开发

大型需求可以使用一个 OpenSpec change、一个集成分支和多个并行单元。每个并行单元必须声明：

- `owner`
- `branch`
- `worktree`
- `write_scope`
- `depends_on`

只有写入范围不重叠、依赖已满足、公共契约稳定时，任务才允许并行。

共享文件、公共接口、数据库迁移和主配置必须指定单一负责人，或提前确定落地顺序。

小七需要检查：

- branch 和 worktree 是否重复。
- 并行单元是否存在依赖循环。
- `write_scope` 是否重叠或形成父子目录覆盖。
- active 需求是否共享冲突键。
- 当前需求是否明确指定了账本。

## 六、需求和设计协作

问题尚不清楚时，使用 OpenSpec `explore`。需求澄清、方案比较和业务事实确认
全部由 OpenSpec `explore` 负责。

澄清后的需求事实、设计决策和验收条件应写入 OpenSpec artifacts：

```text
proposal / design / specs / tasks
```

不要同时维护第二套 proposal、design、业务规格或任务事实。

### 简单变更

适用于范围清楚、风险较低、任务较少且可以串行完成的变更：

```text
propose
  -> apply + TDD
  -> 项目验证 + OpenSpec verify
  -> archive
  -> finish
```

简单变更不等于跳过测试、验证或真实证据。

### 复杂变更

以下情况优先视为复杂变更：

- 跨模块或公共链路变更。
- 数据库、公共接口或权限变化。
- 引入外部系统、新技术或迁移。
- tasks 超过 5 项或存在明显依赖顺序。
- 回归范围较大。
- 存在多个可独立执行且写入范围不冲突的任务。

复杂变更通常采用：

```text
explore
  -> propose
  -> 当前模型持续执行
  -> worktree + TDD + 执行计划
  -> 项目验证 + review + OpenSpec verify
  -> sync（按需）
  -> archive
  -> finish
```

是否走复杂路径由项目事实决定，不要求用户手动选择模式。

## 七、开发中的变化和 Bug 修复

开发中需求、设计或任务变化时：

1. 暂停受影响的实现任务。
2. 保留原有 `change_id`。
3. 使用 OpenSpec `update` 更新受影响的 artifacts。
4. 重新读取 `openspec status --change <id> --json`。
5. 更新受影响的执行计划。
6. 只重新执行受影响的任务和必要回归。

已经归档的需求再次变化时，保留原 archive，并创建新的 OpenSpec change。

Bug 修复先判断现有 Spec 是否正确：

- Spec 正确且修复很小：可以直接 apply，并使用复现测试驱动修复。
- Spec 正确但影响较大：创建或使用 OpenSpec change。
- Spec 错误且 change 未归档：使用 `update`。
- Spec 错误且原 change 已归档：创建新的 change。
- 无法判断：先 `explore`，不要猜测业务事实。

紧急降级处理时，必须记录降级原因、复现测试、回归结果、是否需要补建 change 以及用户确认。

## 八、验证、状态推进和证据

小七维护两类状态：

- 流程状态：`active | paused | blocked | closed`
- 交付状态：`not-started | coding | verified | reviewed | ready | pr-open | merged | kept`

交付状态只能通过统一推进入口变更：

```text
not-started -> coding -> verified -> reviewed -> ready
ready -> pr-open | merged | kept
```

状态推进必须提供真实证据：

- `verified`：成功的 `check` 证据。
- `reviewed`：成功且结果为 `approved` 的 `review` 证据。
- `ready`：通过的 `openspec-verify` 证据。
- `pr-open`、`merged`、`kept`：对应结果的 `finish` 证据。

证据至少应包含：

```yaml
kind:
command:
exit_code: 0
commit:
checked_at:
summary:
```

禁止直接修改交付状态字段绕过门禁。推进命令会负责校验状态转换、前置证据、锁、revision、事件记录和原子更新。

`closed` 只有在以下条件同时满足时才允许：

- OpenSpec archive 成功。
- Superpowers finish 成功。
- 最终交付状态为 `pr-open`、`merged` 或 `kept`。

## 模型连续执行

小七采用“前置确认、后续由当前模型持续执行”的方式。

- 当前模型根据目标、范围、验收条件和风险判断是否需要 `explore`。
- 需求明确且低风险时，当前模型直接跳过 `explore`。
- 存在业务歧义、范围不清或高风险变更时，使用 OpenSpec `explore` 并等待用户确认。
- 需求确认后，当前模型持续执行 tasks、修改代码、调用项目检查并处理失败。
- 每个交付状态必须有真实证据，状态推进统一调用 `advance-progress.mjs`。
- 到达 `ready` 后停止，等待用户提交或执行独立的 `finish`。

执行循环为：

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

`ready` 是自动化终点，不代表已经创建 PR 或合并。`ready -> pr-open | merged | kept`
仍由独立的 `finish` 动作负责。

### 自动修复和人工门禁

测试失败、构建失败和普通 OpenSpec 校验失败，不能第一次失败就进入 `blocked`。
当前模型应先分析错误、自动修复，再重新执行原动作：

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

用户确认“开始执行”后，当前模型必须持续执行小七流程，不能把控制权交给独立计划流程，
也不能在普通步骤之间反复询问。只有遇到人工门禁或达到 `ready` 时才停止。

## 九、阻塞和恢复

以下情况应进入 `blocked`：

- OpenSpec 或必要技能缺失。
- 权限、环境或外部服务不可用。
- 关键业务决策缺失。
- 工作区存在覆盖风险或冲突。
- 验证环境无法运行。
- 状态、分支、change 或账本信息无法可靠确认。

阻塞项必须记录：

```yaml
- code: "waiting-dependency"
  summary: "阻塞原因"
  since: "2026-08-14T10:00:00+08:00"
  resume_when: "恢复条件"
  resume_action: "建议动作"
```

恢复时重新运行账本校验、OpenSpec list/status 和项目探针。条件满足后移除阻塞，并从 `resume_action` 继续；条件未满足时不要重复执行失败动作。

## 十、收尾和迭代关闭

完成项目验证、代码评审和 OpenSpec verify 后：

1. 执行 OpenSpec archive，并记录真实路径和结果。
2. 调用 Superpowers finishing-a-development-branch。
3. 根据真实结果记录：
   - `pr-open`：已创建 PR。
   - `merged`：已合并。
   - `kept`：明确保留分支或工作区。
4. archive 和 finish 都成功后，才允许将流程状态写为 `closed`。

关闭整个迭代时：

1. 检查所有需求是否已经 `closed`。
2. 列出未关闭需求的 OpenSpec 状态、交付状态和阻塞。
3. 不自动归档未完成 change。
4. 不伪造 finish 结果。
5. 用户明确接受风险后，才移动迭代账本到 `sprint-manage/archive/`。

## 十一、运行时和 Hook 接入

小七的账本、状态推进、证据校验和手动导航不依赖 Hook。

接入 Hook 后，可以增加：

- 会话启动记录。
- 动作前检查。
- 动作后结果记录。
- 失败后的自动阻塞。
- 关闭前的最终证据检查。
- 危险命令提醒或拦截。

用户级运行时目录：

```text
~/.xiaoqi/runtime/
```

Codex 项目接入配置：

```text
.codex/config.toml
.codex/hooks.json
```

Trae 项目接入配置：

```text
.trae/hooks.json
```

接入运行时后，可执行只读体检：

```bash
node "<sprint-manage-xiaoqi 安装目录>/scripts/doctor.mjs" "<项目根目录>"
```

体检只检查实际环境中的 OpenSpec、Superpowers、项目初始化状态、账本、运行时和已配置的 Hook。没有配置 Hook 时，只给出可选提醒，不把 Hook 缺失视为流程失败。

所有由小七发起的命令都应经过受控执行器：

- 命令必须在允许列表中。
- 不使用 shell 拼接命令。
- 文件路径必须落在声明的写入范围内。
- 命令需要有超时、输出大小和结构化退出结果。
- 破坏性命令必须显式确认。

Hook 不能替代宿主工具的权限审批、沙箱和网络隔离。

## 十二、常见使用场景

### 查看需求进度

用户说“查看进度”时，小七读取最新的 OpenSpec、Git、项目验证结果和需求账本，汇总当前流程状态、交付状态、阻塞和下一步动作。

### 查询下一步

用户说“下一步做什么”时，小七根据原生状态和当前证据推荐动作，例如 `explore`、`propose`、`apply`、`verify` 或 `archive`。

### 创建或继续需求

用户说“开始做 story-XXX”时，小七检查需求账本、change、分支和工作区，确认唯一目标后进入对应动作。不猜测模糊的需求编号。

### 多需求切换

用户说“切换到 story-XXX”时，小七更新本地会话记录，重新加载目标需求的账本和 OpenSpec 状态，不修改其他需求的共享状态。

### 诊断阻塞

用户说“为什么卡住了”时，小七检查账本、OpenSpec、Git、Hook、权限和验证证据，说明阻塞原因、恢复条件和推荐动作。

### 验证和收尾

用户要求验证、归档或收尾时，小七只执行当前状态允许的动作，并要求对应证据。不能仅凭文件存在或用户口头确认宣布完成。

## 十三、触发关键词

```text
需求进度
迭代进度
下一步该做什么
开始做需求
创建需求
继续需求
研发流程
迭代流程
需求导航
查看进度
需求跟踪
完成验证
归档需求
关闭迭代
诊断阻塞
恢复需求
小七
叫小七
找小七
小七帮帮我
```

## 十四、总结

小七不是固定步骤清单，也不是另一套项目管理系统。

她的核心能力是：

- 读取真实状态。
- 路由到正确的原生动作。
- 汇总多个需求。
- 识别阻塞和恢复条件。
- 通过证据门禁推进交付状态。
- 在风险和业务决策处保留人工确认。
- 让 OpenSpec、Superpowers 和项目工具协同工作。

目标是让研发过程可追踪、可恢复、可验证，并让开发者始终知道下一步该做什么。

---

作者：CJ
邮箱：chenjia@fehorizon.com

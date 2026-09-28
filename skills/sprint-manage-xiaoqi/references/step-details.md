# 小七原生动作与组合流程

> 本文件只提供当前动作的操作规则，不拥有会话或流程控制权。完成或中断后必须返回 `SKILL.md`，由主技能重新读取真实状态并路由。

## 目录

1. 动作路由
2. 简单路径
3. 复杂路径
4. 开发中变化
5. 验证
6. Bug 修复
7. 阻塞与恢复

## 动作路由

小七先读取 OpenSpec 原生状态，再根据用户意图路由：

| 用户意图 | 推荐动作 | 责任方 | 首选宿主技能 | 需调用的能力面 |
| --- | --- | --- | --- | --- |
| 调查问题、比较方向 | `explore` | OpenSpec；由小七保持流程所有权 | `openspec-explore` | 需求澄清、事实收集与方向比较、验证环境澄清 |
| 创建或完善 change | `propose` | OpenSpec | `openspec-propose` | 提案与设计撰写 |
| 按 tasks 实现 | `apply` | OpenSpec 提供任务，Superpowers 提供执行纪律 | `test-driven-development` 逐任务执行；关闭 TDD 的任务用 `executing-plans` | TDD（先失败后通过）、调试、最小实现、项目测试运行 |
| 开发中需求或设计变化 | `update` | OpenSpec | `openspec-update-change` | 变更拆解与任务重排 |
| 检查代码质量和规格一致性 | `verify` | 项目工具 + Superpowers + OpenSpec | `verification-before-completion`；评审用 `requesting-code-review` | 验证、测试/构建/静态检查、规格一致性核对 |
| 提前同步变更规格 | `sync` | OpenSpec | `openspec-sync-specs` | 规格同步 |
| 归档 change | `archive` | OpenSpec；由主技能重新路由 | `openspec-archive-change` | 归档操作 |
| 创建 PR、合并或保留分支 | `finish` | Superpowers；由主技能重新路由 | `finishing-a-development-branch` | 代码评审、分支收尾、PR 与合并操作 |

"首选宿主技能"是当前环境可直接调用的技能名，进入动作时优先直接调用；宿主环境缺失对应技能时，回退到能力面，由当前模型用等价方式（如 OpenSpec CLI、项目工具）完成，并在 summary 中说明降级原因。技能只是执行组件，流程控制权仍在小七；执行完成后必须返回主技能。

`explore -> propose -> apply -> update -> verify -> sync -> archive` 是动作集合，
不是强制阶段链。是否可执行以 OpenSpec status 和 instructions 为准。

`archive` 和 `finish` 的实际收尾由主技能重新读取真实状态后路由，本参考不在
`ready` 之后继续执行收尾动作。

这里的 `update` 是 OpenSpec 的 artifact 更新工作流，不是 `openspec update`
CLI 命令；后者用于更新 OpenSpec instruction 文件，不能拿来修改当前 change。
优先调用当前环境提供的 OpenSpec skill 或 action。

## 简单路径

适用于范围清楚、风险低、任务较少且可串行完成的变更。

```text
需求接纳 + 建账
  -> 全局账本登记仓库
  -> prepare-workspace
  -> 在新工作区执行 explore / propose
  -> 用户确认方案
  -> 选择立即实施 / 暂停
  -> 立即实施：记录 implementation-start
  -> apply（逐任务 TDD）
  -> 项目验证 + OpenSpec verify
  -> ready
  -> 返回主技能（recommended_next: closing）
```

执行要求：

1. 需求接纳后先建账并准备工作区；OpenSpec explore/propose 只能在登记后的 worktree 中执行。
2. 方案确认后，用户必须在“立即实施”和“暂停当前需求”中明确选择；立即实施记录 `implementation-start: approved` 后才继续本路径，暂停不记录该决策且保持 `not-started`。用户若只想结束当前对话，无需额外流程选项。
3. OpenSpec proposal/design/specs/tasks 是唯一需求事实。
4. 每个 task 内部执行失败验证、最小实现、验证通过和整理；关闭 TDD 的任务（`tdd.enabled: false`）必须在任务映射中记录 `tdd.reason` 豁免原因，无原因不得豁免。
5. 必须为每个仓库创建或复用需求专属分支和 `.worktrees/<需求编号>` worktree；不得将当前工作区登记为 `.`，也不因当前工作区存在未提交修改而切换或阻塞。
6. 项目验证通过后，再运行 OpenSpec verify 检查实现与规格一致性。
7. 验证结果返回主技能，由主技能决定下一动作。
8. 需求涉及环境联调验证时，澄清问答 MUST 包含「验证环境」（SIT/MIT/UAT/PRO
   等实际可用环境）和「验证方式」，tasks 验收条件按用户选择书写；
   禁止沿用模板或历史需求的默认环境值。「验证方式」默认优先
   「本地起服务 + 连接目标环境数据源」（如本地 spring.profiles.active=fat
   连 SIT）：日志完整、可反复触发、免部署排队；进入前先探测本地对目标
   环境中间件（DB/Redis/Apollo/MQ）的连通性，本地无法打通或服务依赖
   远端注册中心消费时，退回「部署到目标环境验证」；用户明确指定部署
   验证时尊重用户选择。
9. 复用现有组装/取值逻辑时，MUST 逐行核对参考实现的取值表达式
   （下标、层级截取、空保护），并在 design.md 中原样记录关键行；
   禁止只按方法语义推断输出形状。
10. 涉及工单类型展示行为的需求，explore MUST 检索目标类型编码在查询/组装/过滤
    链路的既有特判分支（grep 类型编码于查询侧 Service：过滤、跳过、特殊分支、
    含「不要/跳过/不返回」注释的代码行）；发现"参考 XX 工单/逻辑同 XX"类需求语义时，
    优先 diff 目标类型与参考类型的分支差异，确认差异点即实现点。
11. 用枚举/类型值查询 DB 前，MUST 先 SELECT DISTINCT 该列确认实际存储形态
    （如 G_803 与 803、带前缀与裸数字的差异），查无数据时先怀疑查询值形态，
    而非直接断言「无数据需造数」。

简单不等于跳过 TDD、验证或真实证据。

## 多需求与多仓库路径

同一用户可以并行推进多个需求；每个需求独立使用一个 OpenSpec change 和一个全局账本文件。单个需求可以登记多个仓库，进入 `apply` 前必须为每个仓库确认 `root`、branch 和 worktree，且不得与其他 active 需求复用。准备 worktree 前，基准分支按 `项目 .xiaoqi/config.yaml` 的 `baseBranch` > 账本仓库条目的 `baseBranch` > 同仓库历史账本 baseBranch 的众数 > 仓库当前 HEAD 分支 的顺序自动继承；均未命中时，先向用户提供候选分支并请求选择，确定后把选择写入 `.xiaoqi/config.yaml` 的 `baseBranch` 或账本仓库条目，再运行 `prepare-workspace`。

流程：

```text
OpenSpec explore
  -> OpenSpec propose
  -> 用户确认 + 建账
  -> 用户选择立即实施
  -> 全局账本登记仓库
  -> prepare-workspace
  -> 当前模型持续执行
  -> 每个仓库分别执行 TDD 与验证
  -> 项目验证 + code review
  -> OpenSpec verify
  -> ready
  -> 返回主技能（recommended_next: closing）
```

产物规则：

- OpenSpec explore 负责澄清，结论写入 OpenSpec artifacts。
- OpenSpec tasks 保持验收级粒度。
- OpenSpec tasks 直接驱动小七自动执行。
- 不得调用独立 `writing-plans` 接管流程；内部工具执行完成后控制权必须返回小七。
- 不创建第二套 proposal、design 或业务规格。

小七只记录调用结果，不跟踪 prepare、plan、implement、review 等 Superpowers
内部步骤。

## 开发中变化

开发中需求、设计或任务变化时使用 OpenSpec `update`：

1. 暂停受影响的实现任务。
2. 保留同一 `change_id`。
3. 调用 update 修改受影响的 proposal、design、specs 或 tasks。
4. 重新读取 `openspec status --change <id> --json`。
5. 更新 Superpowers plan 中受影响的执行步骤。
6. 只重新执行受影响任务及必要回归。

不得回退到自定义 `analyze` 阶段，也不得覆盖历史决策。

已归档需求再次变化时：

1. 保留原 archive。
2. 创建新的 OpenSpec change 和 `change_id`。
3. 从 explore 或 propose 开始新的动作轮次。

## 验证

### 三类验证

项目验证：

- 目标测试、全量测试、构建和静态检查。
- 必要时运行端到端或真实交互检查。
- 宿主沙箱拦截构建或测试命令时（如 Java 运行时文件限制），允许使用 IDE 诊断、
  静态检查等替代验证方式，但证据必须如实记录实际执行的命令或检查来源，
  不得伪造 `exit_code: 0`；替代验证的覆盖缺口要在 summary 中说明，并交给
  用户决定是否随提测人工验证。
- 环境联调结论的条件允许时优先自行复验接口取证（登录态 fetch、DB 查询、
  网络请求抓取），以复验结果作为证据主体；用户口头确认仅兜底，
  且兜底时必须以 `manual: true` + `confirmed_by` 落人工验证证据。

Superpowers 验证：

- verification-before-completion。
- requesting-code-review 或项目评审流程。
- 修复阻断问题后重新运行项目验证。

OpenSpec verify：

- 检查实现是否覆盖 proposal、design、specs 和 tasks。
- 结果作为 `kind: openspec-verify` 写入证据索引。
- 当前环境没有 verify action 时，可以运行
  `openspec validate <id> --type change --strict --json` 检查 artifact 合规性，
  但它不能替代实现与规格的一致性检查。

三类验证职责不同，不能互相替代。

确认项目验证、已批准的评审和 OpenSpec verify 已满足当前风险要求后，状态到达 `ready`。
到达 `ready` 后停止连续执行，返回主技能，并将 `recommended_next` 指向
抽象意图 `closing`，由主技能重新路由。

## 提前合并/推送指令

用户在交付状态 `ready` 之前要求合并分支或推送远程时（典型场景：联调验证需要提前部署目标分支）：

- 尊重用户对仓库的处置权：先执行 git 合并/推送，不因门禁未满足而拒绝物理操作。
- 必须在账本事件日志立即记录 `kind: early-merge` 事件，注明"门禁后置"与提前合并的原因，保持账本与物理事实的时序一致。
- 明确告知用户：交付状态保持不变，收尾推进 `verified→merged` 前仍需补齐 check、review、openspec-verify 证据，门禁不可豁免、不可伪造。
- 禁止把 early-merge 事件当作 finish 证据使用；收尾按真实交付状态与证据推进。
- 执行完成后返回主技能，重新读取账本与 OpenSpec 状态，再决定下一动作。

## Bug 修复

先判断 Spec 是否正确：

- Spec 正确且修复很小：可以直接 apply，使用复现测试驱动修复。
- Spec 正确但影响较大：创建或使用 OpenSpec change，再走简单或复杂路径。
- Spec 错误且 change 未归档：使用 update。
- Spec 错误且原 change 已归档：创建新的 change。
- 无法判断：先 explore，不猜测业务事实。

紧急修复无法使用 OpenSpec 时可以降级，但必须记录：

- 降级原因。
- 复现测试和回归结果。
- 是否需要补建 OpenSpec change。
- 用户确认。

## 阻塞与恢复

阻塞项格式：

```yaml
- code: "missing-openspec"
  summary: "项目尚未初始化 OpenSpec"
  since: "2026-08-11T10:00:00+08:00"
  resume_when: "OpenSpec 初始化完成"
  resume_action: propose
```

进入阻塞：

- OpenSpec 或必要能力缺失。
- 权限、环境或外部服务不可用。
- 关键业务决策缺失。
- 工作区冲突，继续操作可能覆盖用户改动。
- 验证环境无法运行。

恢复时重新运行账本校验、OpenSpec list/status 和项目探针。条件满足后移除阻塞，
按 `resume_action` 继续；条件未满足时不反复执行失败动作。

## apply 与模型执行

`apply` 是自动执行流程中的实施动作，不是“当前对话里手动执行一步”的指令。

小七拥有流程控制权。OpenSpec、Superpowers 和项目工具仅作为内部工作能力；
每次调用结束后，控制权必须返回小七，再由小七决定下一动作。

`explore` 确认后的“确认执行”“开始执行”“方案没问题”等表达必须进入
当前模型连续执行，不得调用独立 `writing-plans`。

需求确认后，由当前模型负责协调以下边界清晰的动作：

```text
用户确认
  -> initialize-requirement
  -> 全局账本登记仓库
  -> prepare-workspace
  -> 由宿主工具执行编码、测试和评审
  -> 记录 apply/check/review 证据
  -> openspec-verify
  -> ready
```

`auto-runner` 等自动化脚本只在账本已初始化、仓库与工作区已登记且当前动作明确时，推进已有账本的证据门禁。它不负责创建需求账本、准备工作区、代替 OpenSpec explore/propose/update、编写代码、执行人工评审或完成 archive/finish。

Windows/PowerShell 宿主执行 git 等命令时：commit 消息一律单行 -m（禁用 heredoc）；多命令用分号分隔（禁用 && / ||）；路径含空格时用双引号包裹。

当需求明确或用户已经确认 `explore` 结果时，当前模型应继续推进允许自动执行的动作；遇到建账、工作区准备、编码、评审、归档、分支收尾、人工门禁、`blocked` 或证据无法取得时，必须由主技能协调对应宿主工具或暂停等待用户处理。
## 自动修复边界

测试失败、构建失败和普通 OpenSpec 校验失败属于可自动修复错误：

```text
失败 -> 分析 -> 修复 -> 重试
```

默认相同错误最多重试 3 次。修复由当前模型完成，脚本只记录次数和证据。
评审高风险问题、权限或环境授权、破坏性操作确认和业务规则冲突，
属于人工门禁，不应自动绕过。

## 结果返回

完成或中断当前动作后，必须把以下结果返回主技能，由主技能重新读取真实状态并决定下一动作：

- `outcome`
- `summary`
- `evidence`
- `blockers`
- `recommended_next`

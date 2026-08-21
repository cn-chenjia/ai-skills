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

| 用户意图 | 推荐动作 | 主要责任方 |
| --- | --- | --- |
| 调查问题、比较方向 | `explore` | OpenSpec；由小七保持流程所有权 |
| 创建或完善 change | `propose` | OpenSpec |
| 按 tasks 实现 | `apply` | OpenSpec 提供任务，Superpowers 提供执行纪律 |
| 开发中需求或设计变化 | `update` | OpenSpec |
| 检查代码质量和规格一致性 | `verify` | 项目工具 + Superpowers + OpenSpec |
| 提前同步变更规格 | `sync` | OpenSpec |
| 归档 change | `archive` | OpenSpec；由主技能重新路由 |
| 创建 PR、合并或保留分支 | `finish` | Superpowers；由主技能重新路由 |

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
propose
  -> 用户确认
  -> initialize-requirement + prepare-workspace
  -> apply（逐任务 TDD）
  -> 项目验证 + OpenSpec verify
  -> ready
  -> 返回主技能（recommended_next: closing）
```

执行要求：

1. OpenSpec proposal/design/specs/tasks 是唯一需求事实。
2. 每个 task 内部执行失败验证、最小实现、验证通过和整理。
3. 必须登记需求专属分支和工作区；当前工作区未被占用时可直接登记为 `.`，
   不强制新建额外 worktree。
4. 项目验证通过后，再运行 OpenSpec verify 检查实现与规格一致性。
5. 验证结果返回主技能，由主技能决定下一动作。

简单不等于跳过 TDD、验证或真实证据。

## 复杂路径

以下任一情况优先视为复杂变更：

- 跨模块、公共链路、数据库、接口契约或权限变化。
- tasks 超过 5 项或存在明显依赖顺序。
- 引入外部系统、新技术、迁移或兼容处理。
- 回归范围大，需要完整测试策略。
- 存在多个可独立执行且写入范围不冲突的任务。

涉及多需求、多人、分支、工作区或写入范围冲突时（包括单人并行多个需求、多人分别开发多个需求或大型需求多人分工的集成分支和 `write_scope`），返回主技能，并将 `recommended_next` 设置为抽象意图 `collaboration-conflict`，由主技能重新路由。

流程：

```text
OpenSpec explore
  -> OpenSpec propose
  -> 用户确认
  -> initialize-requirement + prepare-workspace
  -> 当前模型持续执行
  -> worktree + TDD + subagents/executing-plans
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

需求确认后，由当前模型负责：

```text
用户确认
  -> initialize-requirement
  -> prepare-workspace
not-started
  -> apply
  -> coding
  -> check
  -> verified
  -> review
  -> reviewed
  -> openspec-verify
  -> ready
```

当需求明确或用户已经确认 `explore` 结果时，当前模型必须持续推进。只有出现人工门禁、
`blocked` 或证据无法取得时，才暂停等待用户处理。
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

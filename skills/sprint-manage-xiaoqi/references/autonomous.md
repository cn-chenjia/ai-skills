# 小七托管模式规则

> 本文件只提供当前动作的操作规则，不拥有会话或流程控制权。完成或中断后必须返回 `SKILL.md`，由主技能重新读取真实状态并路由。

托管模式（纯托管）让小七接到需求后按现有流程完全自主推进到收尾，人工确认点降级为自动回执；**证据门禁一寸不减**，无法自动满足的门禁一律诚实中断，绝不伪造。

## 激活与建账

激活优先级：需求级触发词 > 项目配置 > 默认人工模式。

1. **需求级触发词**：用户提交需求时明确带「托管」「自动完成」等表达，仅该需求生效。建账时传 `--autonomous`。
2. **项目级默认**：项目 `.xiaoqi/config.yaml` 配置 `autonomy: { mode: "full", closing: "pr-open" }`，该仓库需求默认托管；`closing` 可选 `pr-open | merged | kept`，默认 `pr-open`。
3. 两者都未命中时为人工模式，本文件不适用。

```bash
node "<小七技能安装目录>/scripts/initialize-requirement.mjs" \
  "<项目根目录>" story-2001 "订单导出" \
  story-2001-export requester requester --autonomous
```

- 托管需求使用 schema v5：账本带 `托管: { mode, closing, activated_by }` 字段和 `autonomy-activated` 事件。
- 人工需求保持 schema v4 不变；v4 账本出现 `托管` 字段会校验失败。
- 需求重开（`--reopen-from`）时托管配置随新版本继承。

## 需求相关性预检（建账前，必做）

托管需求建账前必须先运行相关性预检，避免把无关需求做进错误仓库：

```bash
node "<小七技能安装目录>/scripts/match-requirement.mjs" \
  "<项目根目录>" --keywords "订单,导出" --requirement-id story-2001
```

- 脚本确定性扫描候选项目（当前工作区 + 全局账本登记过的仓库 root），按关键词命中代码/文档、OpenSpec 规格和历史需求计数，输出排序后的证据。
- **语义判定由主技能完成**：脚本只给证据，模型判断需求与各候选是否真实相关。
- 判定规则：
  - 与所有候选项目都无关（脚本 `no_match: true` 或模型逐一判定不相关）→ **不建账、直接中断**，向用户输出扫描范围、各项目得分和判定依据，等待用户修正需求或明确指定项目后重新提交。
  - 只有一个相关项目 → 直接登记该项目。
  - 多个项目都相关 → 自动选证据最强的项目，把选择依据写入账本事件日志（`kind: requirement-matched`，记录 root、score 与理由）；选错由 worktree 隔离兜底，可人工纠正。
- 预检是只读操作，不触碰任何账本文件。

本预检是托管模式专属门禁的原因：人工模式下用户在场，方案确认与仓库登记
本身就是相关性把关；托管模式把确认点自动化后，才需要机器预检加 worktree
隔离双保险，防止无关需求被做进错误仓库。脚本不区分模式，人工流程在用户
无法明确目标仓库时也可调用作只读参考。

## 门禁矩阵

| 门禁点 | 人工模式 | 托管模式 |
| --- | --- | --- |
| 方案确认（proposal-confirmation） | 用户 approved | 自动回执 `actor: xiaoqi-auto` + `reason`（推荐理由） |
| 实施选择（implementation-start） | 用户二选一 | 自动 approved（立即实施）+ `reason` |
| ready 后收尾方式 | 用户三选一 | 自动按 `托管.closing`（默认 pr-open） |
| apply/check/review/openspec-verify 证据 | 硬门禁 | **完全不变**（含 TDD 红/绿复合校验） |
| explore 澄清问答 | 问用户 | 从 environmentNotes、代码事实、历史账本推断；假设记入 design.md 待审计；真实业务歧义 → 中断 |
| 人工验证兜底（manual check） | `confirmed_by` 真人 | 自行取证优先（登录态 fetch、DB 查询等）；无法取证 → 中断，**绝不冒充人工确认** |
| 权限、破坏性操作、业务冲突 | 人工确认 | 中断（blocked），绝不自动绕过 |
| 相同错误自动修复 | ≤3 次 | 不变 |

自动回执统一走决策记录入口：

```bash
node "<小七技能安装目录>/scripts/record-decision.mjs" \
  "<账本路径>" decision.json requester
```

decision.json（自动回执形态）：

```json
{
  "kind": "proposal-confirmation",
  "outcome": "approved",
  "actor": "xiaoqi-auto",
  "reason": "方案与既有订单查询链路一致，风险低，建议直接实施"
}
```

- `xiaoqi-auto` 只允许记录 `proposal-confirmation`、`implementation-start`、`finish-reopen`；需求接纳（requirement-intake）必须由真实提出人签署。
- 自动回执必须带 `reason`；非托管账本出现 `xiaoqi-auto` 决策会被校验拒绝（防人工模式伪造自动决策）。
- 人工需求的用户决策同样用本入口记录（actor 填真实决策人），不再手工编辑账本。

## 中断与恢复

托管模式中断统一复用 blocked 机制（阻塞项字段：code/summary/since/resume_when/resume_action），新增中断码：

- `requirement-out-of-scope`：需求与所有候选项目无关，建账前中断（不建账，无账本残留）。
- `manual-verification-required`：联调/人工验证无法自行取证。
- `permission-gate`：权限、破坏性操作或业务规则冲突需要人工决策。
- `semantic-ambiguity`：explore 澄清后仍存在无法推断的业务歧义。

中断时向用户输出：中断码、判定依据、恢复条件（`resume_when`）与恢复动作（`resume_action`）。用户补充信息后说「继续」即可恢复；恢复后仍走证据门禁。

## 收尾默认

到达 `ready` 后不停等用户选择，直接按 `托管.closing` 执行收尾：

- 默认 `pr-open`：走既有 finish 证据规则（`result: pr-open`），summary 如实记录「托管模式自动决策」；pr-open 不清理 worktree（既有规则）。
- `merged` / `kept`：同样必须记录真实 finish 结果；合并后清理规则不变。
- early-merge、push 对账、archive 预检、合并后清理等收尾检查顺序与人工模式完全一致，托管模式不豁免任何一步。

## 结果返回

完成或中断当前动作后，必须把以下结果返回主技能，由主技能重新读取真实状态并决定下一动作：

- `outcome`
- `summary`
- `evidence`
- `blockers`
- `recommended_next`

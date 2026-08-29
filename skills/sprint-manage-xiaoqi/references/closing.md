# 小七验证后收尾规则

> 本文件只提供当前动作的操作规则，不拥有会话或流程控制权。完成或中断后必须返回 `SKILL.md`，由主技能重新读取真实状态并路由。

## 进入条件

项目验证、已批准的评审和 OpenSpec verify 都满足当前风险要求后，才能将交付状态推进到
`ready`。到达 `ready` 后停止连续执行，返回主技能，等待用户选择收尾方式。

## 用户选择

用户选择创建 PR、合并或保留分支后，才继续收尾：

- 创建 PR：最终交付状态为 `pr-open`。
- 本地或远程合并：最终交付状态为 `merged`。
- 保留分支或工作区：最终交付状态为 `kept`。

`ready` 不是合并结果；`pr-open | merged | kept` 必须记录真实的 finish 结果。

## 同步与归档

需要在 archive 前让主规格提前反映变更、多个 change 需要共享最新规格，或 OpenSpec
instructions 明确推荐同步时，先执行 OpenSpec sync。简单、独立且即将 archive 的变更可以
不单独 sync。当前安装的 openspec CLI 若没有 `sync` 子命令，直接执行 archive（archive
自带规格同步），不要反复尝试不存在的命令。

随后执行 OpenSpec archive，保存真实 archive 路径和成功结果，作为 archive 证据。

archive 失败的常见原因和修复：

- 主规格标题必须是英文 `## Requirements` / `## Purpose`；中文标题（如 `## 需求`、
  `## 目的`）会导致解析器无法识别需求条目，需先把标题改为英文再重试。
- delta 中 `## MODIFIED Requirements` 的需求必须在主规格中已存在；主规格没有对应
  需求时改用 `## ADDED Requirements`。
- archive 成功后用统一推进入口记录 `kind: "archive"` 证据（`path` 非空、
  `outcome` 为 `passed`、`completed` 或 `archived`），不要手工编辑账本。

## 分支收尾

OpenSpec archive 成功后，调用 Superpowers 的
`finishing-a-development-branch` 完成 finish。根据用户选择，把真实 finish 结果记录为
`pr-open | merged | kept`，并保存成功的 finish 证据。

## 正式关闭

仅当 archive 和 finish 证据都存在，且最终交付状态为 `pr-open | merged | kept` 时，才由主技能调用 `scripts/close-requirement.mjs` 校验证据并写入 `closed` 事件。账本位于 `~/.xiaoqi/projects/<project-id>/requirements/<id>.yaml`，不维护 session 文件。真实流程和交付状态仍以账本为准，不能只在对话或总结中宣称需求已关闭。

## 关闭整个迭代

用户要求关闭整个迭代时，只由主技能路由到本文件处理：

1. 检查所有需求流程状态是否为 `closed`。
2. 对未关闭需求列出 OpenSpec 状态、交付状态和阻塞。
3. 不自动 archive 未完成 change，不伪造 finish 结果。
4. 用户明确接受风险后，才移动迭代账本到 `sprint-manage/archive/`。

## 失败返回

sync、archive、finish 或正式关闭失败时，保存实际失败和缺失证据，返回 `SKILL.md`。主技能重新
读取真实状态并决定重试、恢复、阻塞或请求用户确认；不得宣称已经关闭。

## 结果返回

完成或中断当前动作后，必须把以下结果返回主技能，由主技能重新读取真实状态并决定下一动作：

- `outcome`
- `summary`
- `evidence`
- `blockers`
- `recommended_next`

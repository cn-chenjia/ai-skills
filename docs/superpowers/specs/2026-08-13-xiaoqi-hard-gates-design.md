# 小七可执行状态门禁设计

## 目标

让小七的交付状态由真实证据推动，而不是允许 Agent 直接修改状态字段。状态推进必须经过统一命令、前置条件检查、账本锁和 revision 校验。

## 范围

- 增加交付状态迁移规则。
- 增加测试、评审、OpenSpec 和收尾证据的结构校验。
- 增加统一状态推进命令。
- 推进成功后追加事件记录，并原子更新账本。
- 保留现有账本结构和 OpenSpec、Superpowers 的职责边界。

## 状态迁移

允许的交付状态迁移：

```text
not-started -> coding
coding -> verified
verified -> reviewed
reviewed -> ready
ready -> pr-open | merged | kept
```

流程状态仍然由小七维护，但 `closed` 只有在 archive 和 finish 证据都成功时才允许。

## 证据契约

每条验证证据必须包含：

- `kind`
- `command`
- `exit_code`
- `commit`
- `checked_at`
- `summary`

其中 `exit_code` 必须为 `0`，`commit` 和 `command` 不能为空。

不同状态的最低证据要求：

- `verified`：至少一条 `kind: check`，且所有检查成功。
- `reviewed`：在 `verified` 基础上，增加 `kind: review`，结果为 `approved`。
- `ready`：在 `reviewed` 基础上，增加 `kind: openspec-verify`，结果为 `passed`。
- `pr-open`、`merged`、`kept`：必须有对应的 `kind: finish` 证据。

## 统一推进入口

新增 `advance-progress.mjs`：

```bash
node advance-progress.mjs <ledger> <target-status> <evidence.json>
```

命令负责：

1. 读取账本和证据。
2. 检查状态迁移是否合法。
3. 检查状态前置证据。
4. 获取账本锁。
5. 重新读取并校验 revision。
6. 原子写入状态、证据和事件。
7. 递增 revision 并释放锁。

任一步骤失败都不修改账本。

## 测试策略

先增加失败测试，覆盖非法跳跃、缺少证据、失败命令、评审未通过、OpenSpec 未通过和合法推进；再实现最小代码使其通过。最后运行全部现有测试和新增测试。

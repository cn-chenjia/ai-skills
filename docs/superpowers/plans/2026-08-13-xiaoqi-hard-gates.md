# 小七可执行状态门禁实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让小七通过统一入口和可信证据强制执行交付状态迁移。

**Architecture:** 在现有状态校验器旁增加独立的迁移与证据校验模块，由推进脚本负责加锁、重读 revision、写入事件和原子更新。现有目录冲突校验保持不变，避免把 OpenSpec 或 Superpowers 的内部状态复制到小七。

**Tech Stack:** Node.js ESM、node:test、Node 标准库、现有 YAML 子集解析器。

---

### Task 1: 为状态迁移和证据契约编写失败测试

**Files:**
- Modify: `skills/sprint-manage-xiaoqi/tests/validate-progress.test.mjs`
- Test: `skills/sprint-manage-xiaoqi/tests/validate-progress.test.mjs`

- [ ] 增加非法跳跃被拒绝的测试。
- [ ] 增加缺少测试证据不能进入 `verified` 的测试。
- [ ] 增加失败测试命令不能进入 `verified` 的测试。
- [ ] 增加未通过评审不能进入 `reviewed` 的测试。
- [ ] 增加合法证据链可以逐步推进的测试。
- [ ] 运行测试并确认新增测试先失败。

### Task 2: 实现迁移和证据校验

**Files:**
- Create: `skills/sprint-manage-xiaoqi/scripts/advance-progress.mjs`
- Modify: `skills/sprint-manage-xiaoqi/scripts/validate-progress.mjs`

- [ ] 定义交付状态迁移表。
- [ ] 校验证据字段、退出码、commit、时间和结果。
- [ ] 校验每个目标状态的最低证据。
- [ ] 保持旧账本的静态格式校验兼容。
- [ ] 运行新增测试并确认通过。

### Task 3: 实现加锁、事件记录和原子推进

**Files:**
- Modify: `skills/sprint-manage-xiaoqi/scripts/advance-progress.mjs`
- Modify: `skills/sprint-manage-xiaoqi/scripts/ledger-lock.mjs`
- Modify: `skills/sprint-manage-xiaoqi/tests/validate-progress.test.mjs`

- [ ] 推进前获取账本锁。
- [ ] 推进时重新检查 revision。
- [ ] 成功后追加状态事件并递增 revision。
- [ ] 失败时保持账本内容和锁状态可恢复。
- [ ] 增加并发和失败不落盘测试。

### Task 4: 更新技能协议和使用说明

**Files:**
- Modify: `skills/sprint-manage-xiaoqi/SKILL.md`
- Modify: `skills/sprint-manage-xiaoqi/references/state-contract.md`
- Modify: `skills/sprint-manage-xiaoqi/references/step-details.md`
- Modify: `description/skills/sprint-manage-xiaoqi.md`

- [ ] 明确禁止直接修改交付状态。
- [ ] 增加推进命令和证据示例。
- [ ] 统一 outcome 和 evidence 的命名。
- [ ] 说明失败时不改变账本。

### Task 5: 完整验证

**Files:**
- Test: `skills/sprint-manage-xiaoqi/tests/validate-progress.test.mjs`

- [ ] 运行全部 Node 测试。
- [ ] 运行两个脚本的语法检查。
- [ ] 验证非法状态跳跃确实被拦截。
- [ ] 检查工作区 diff 和换行提示。

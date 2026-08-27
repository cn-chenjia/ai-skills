# OpenSpec Store 兼容实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让小七通过 `openspec context --json` 使用 OpenSpec 实际解析出的 root，在 Store 共享规划工作区中维护账本，并支持多个代码仓库分别使用分支和 worktree。

**Architecture:** 新增 OpenSpec context 解析模块，统一执行 `openspec context --json` 并返回 root path、source、store_id 和 role。需求账本始终位于解析出的 planning root；代码仓库作为账本中的独立交付单元，分别记录路径、分支、worktree、写入范围和验证状态。显式 ledger 优先，无法唯一确定账本时拒绝自动推进。

**Tech Stack:** Node.js ESM、Node test runner、Git worktree、OpenSpec CLI JSON 接口、YAML 账本。

**Spec:** 本轮已确认的 OpenSpec Store 兼容设计（Store 是规划控制面，代码仓库是实施面）。

## Global Constraints

- 不直接读取 OpenSpec store registry，也不根据 store_id 猜测本地路径。
- 账本位置只使用 `openspec context --json` 返回的 `root.path`。
- OpenSpec root 解析失败时不得回退到当前代码仓库创建账本。
- Store checkout 默认共享；代码仓库按需求独立 branch/worktree。
- 没有明确 ledger、requirement_id 或 change_id 时不得在多账本场景自动选择需求。
- 遵循 TDD：先新增失败测试，再实现最小代码。

---

### Task 1: 新增 OpenSpec context 解析模块

**Files:**
- Create: `skills/sprint-manage-xiaoqi/scripts/openspec-context.mjs`
- Test: `skills/sprint-manage-xiaoqi/tests/openspec-context.test.mjs`

**Interfaces:**
- Produces `resolveOpenSpecContext(cwd, options = {})`，返回 `{ rootPath, source, storeId, role, raw }`。
- `options.openspecCommand` 可注入测试命令；默认值为 `openspec`。

- [ ] **Step 1: Write the failing tests**

覆盖：

```js
const context = resolveOpenSpecContext(projectRoot, { openspecCommand: fakeCli });
assert.deepEqual(context, {
  rootPath: storeRoot,
  source: "declared",
  storeId: "team-plans",
  role: "openspec_root",
  raw: payload,
});
```

另测：JSON 无 root 时抛出包含 OpenSpec diagnostics 的错误；非零退出码时抛错；普通 nearest root 无 store_id 时返回 `storeId: undefined`。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/sprint-manage-xiaoqi/tests/openspec-context.test.mjs`
Expected: FAIL，因为解析模块尚不存在。

- [ ] **Step 3: Write minimal implementation**

使用 `spawnSync` 执行 `["context", "--json"]`，解析 stdout 单个 JSON 文档；从 `payload.root.path` 生成 `rootPath`，读取 `source`、`store_id`、`role`；root 缺失或命令失败时抛出可读错误，不做路径猜测和 fallback。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/sprint-manage-xiaoqi/tests/openspec-context.test.mjs`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add skills/sprint-manage-xiaoqi/scripts/openspec-context.mjs skills/sprint-manage-xiaoqi/tests/openspec-context.test.mjs
git commit -m "feat(sprint-manage): resolve openspec root from context"
```

### Task 2: 让需求初始化使用 OpenSpec planning root

**Files:**
- Modify: `skills/sprint-manage-xiaoqi/scripts/initialize-requirement.mjs`
- Test: `skills/sprint-manage-xiaoqi/tests/requirement-lifecycle.test.mjs`

**Interfaces:**
- CLI 保持现有参数兼容：`<project-root> <id> <name> <change-id> <owner> <confirmed-by>`。
- 初始化时调用 `resolveOpenSpecContext(projectRoot)`，将账本写入 `<rootPath>/sprint-manage/requirements/<id>.yaml`。
- 新账本包含 `规划: { 类型, store_id, root, source, role, resolved_by, checked_at }`。

- [ ] **Step 1: Write the failing tests**

新增 pointer repo fixture：其 `openspec/config.yaml` 声明 `store: team-plans`，fake OpenSpec context 返回 Store root。断言账本不在 pointer repo，而在 Store root；断言规划快照字段保存正确。保留普通 root 初始化测试。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/sprint-manage-xiaoqi/tests/requirement-lifecycle.test.mjs`
Expected: FAIL，当前脚本仍把账本写入传入项目目录且账本没有规划字段。

- [ ] **Step 3: Write minimal implementation**

引入 context 解析模块，使用解析出的 `rootPath` 创建 requirements 目录、锁文件和账本；将 context 快照写入账本。测试通过注入 fake OpenSpec CLI 或受控 PATH，避免访问真实机器 Store。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/sprint-manage-xiaoqi/tests/requirement-lifecycle.test.mjs`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add skills/sprint-manage-xiaoqi/scripts/initialize-requirement.mjs skills/sprint-manage-xiaoqi/tests/requirement-lifecycle.test.mjs
git commit -m "feat(sprint-manage): store ledgers under openspec root"
```

### Task 3: 扩展账本 schema 支持规划根和代码仓库单元

**Files:**
- Modify: `skills/sprint-manage-xiaoqi/scripts/initialize-requirement.mjs`
- Modify: `skills/sprint-manage-xiaoqi/scripts/validate-progress.mjs`
- Modify: `skills/sprint-manage-xiaoqi/references/state-contract.md`
- Modify: `skills/sprint-manage-xiaoqi/references/collaboration.md`
- Test: `skills/sprint-manage-xiaoqi/tests/validate-progress.test.mjs`

**Interfaces:**
- `规划` 为对象，保存 root resolution 快照。
- `代码仓库` 为数组；元素至少包含 `id`、`path`、`branch`、`worktree`、`write_scope`、`delivery_status`、`checks`。
- 无代码仓库时允许普通 Store 规划需求；有代码仓库时校验 id/path/branch/worktree 唯一，`write_scope` 不重叠，delivery_status 合法。

- [ ] **Step 1: Write the failing tests**

增加 valid Store ledger、两个代码仓库 ledger；增加重复仓库 id、重复 worktree、非法 delivery_status 和重叠 write_scope 的失败用例。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/sprint-manage-xiaoqi/tests/validate-progress.test.mjs`
Expected: FAIL，因为当前校验器不认识 Store/代码仓库字段。

- [ ] **Step 3: Write minimal implementation**

扩展 schema 校验和初始化默认结构；不复制 OpenSpec tasks，不把仓库交付状态混入 OpenSpec 状态。文档明确 Store 共享 checkout、代码仓库独立 worktree，以及共享 Spec 使用冲突键/影响范围串行化。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/sprint-manage-xiaoqi/tests/validate-progress.test.mjs`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add skills/sprint-manage-xiaoqi/scripts/initialize-requirement.mjs skills/sprint-manage-xiaoqi/scripts/validate-progress.mjs skills/sprint-manage-xiaoqi/references/state-contract.md skills/sprint-manage-xiaoqi/references/collaboration.md skills/sprint-manage-xiaoqi/tests/validate-progress.test.mjs
git commit -m "feat(sprint-manage): model store and code repositories"
```

### Task 4: 让工作区准备按代码仓库执行

**Files:**
- Modify: `skills/sprint-manage-xiaoqi/scripts/prepare-workspace.mjs`
- Test: `skills/sprint-manage-xiaoqi/tests/prepare-workspace.test.mjs`

**Interfaces:**
- 保留单仓库 CLI 行为作为兼容路径。
- Store 需求读取账本 `代码仓库`，对每个仓库执行独立 Git 基线、branch、worktree 登记；Store root 不执行代码分支切换。
- 返回 `{ workspaces: [{ id, path, branch, worktree, mode }] }`，单仓库同时保留旧 `worktree` 字段。

- [ ] **Step 1: Write the failing tests**

创建一个 Store root、两个独立 Git 代码仓库和同一账本，断言 prepare 为两个仓库创建不同 worktree/branch，Store 账本仍在原 Store checkout；另测共享 Spec 冲突时拒绝并保持账本不变。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/sprint-manage-xiaoqi/tests/prepare-workspace.test.mjs`
Expected: FAIL，因为现有实现要求 ledger/projectRoot 属于同一 Git root。

- [ ] **Step 3: Write minimal implementation**

拆分“单仓库准备”内部函数，遍历代码仓库单元；每个仓库独立调用 Git，更新对应 branch/worktree 字段；在全部准备成功前不提交账本部分结果，失败时回滚已写入的账本字段并报告具体仓库。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/sprint-manage-xiaoqi/tests/prepare-workspace.test.mjs`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add skills/sprint-manage-xiaoqi/scripts/prepare-workspace.mjs skills/sprint-manage-xiaoqi/tests/prepare-workspace.test.mjs
git commit -m "feat(sprint-manage): prepare workspaces across repositories"
```

### Task 5: 更新 Hook、主技能规则和运行时文档

**Files:**
- Modify: `skills/sprint-manage-xiaoqi/scripts/adapters/codex.mjs`
- Modify: `skills/sprint-manage-xiaoqi/scripts/adapters/trae.mjs`
- Modify: `skills/sprint-manage-xiaoqi/SKILL.md`
- Modify: `skills/sprint-manage-xiaoqi/references/runtime-contract.md`
- Modify: `skills/sprint-manage-xiaoqi/references/step-details.md`
- Test: `skills/sprint-manage-xiaoqi/tests/codex-hook.test.mjs`
- Test: `skills/sprint-manage-xiaoqi/tests/trae-adapter.test.mjs`
- Test: `skills/sprint-manage-xiaoqi/tests/model-orchestration.test.mjs`

**Interfaces:**
- Hook 仍优先使用显式 `ledger`；多账本时不自动选择。
- 单账本自动发现只允许在已解析的 planning root 下执行；pointer repo 不创建本地重复账本。
- 主技能规则明确：每次动作前重新执行 `openspec context --json`，以 `root.path` 为准；解析失败进入 blocked。

- [ ] **Step 1: Write the failing tests**

增加 pointer repo + Store 的 Hook discovery 测试；增加多账本无明确 ledger 时 allow/bypass 而不记录错误账本的测试；增加主技能文档断言 `context --json`、`root.path`、解析失败阻塞和 Store/代码仓库隔离规则。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/sprint-manage-xiaoqi/tests/codex-hook.test.mjs skills/sprint-manage-xiaoqi/tests/trae-adapter.test.mjs skills/sprint-manage-xiaoqi/tests/model-orchestration.test.mjs`
Expected: FAIL，因为适配器当前只扫描 cwd 下的 sprint-manage。

- [ ] **Step 3: Write minimal implementation**

适配器先从 payload ledger、环境变量获取显式 ledger；无显式 ledger 时调用 context resolver 并扫描 `rootPath/sprint-manage/requirements`，仅一个账本时选择；多个账本返回 undefined。更新规则文档和运行时限制，禁止通过注册表或路径猜测。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/sprint-manage-xiaoqi/tests/codex-hook.test.mjs skills/sprint-manage-xiaoqi/tests/trae-adapter.test.mjs skills/sprint-manage-xiaoqi/tests/model-orchestration.test.mjs`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add skills/sprint-manage-xiaoqi/SKILL.md skills/sprint-manage-xiaoqi/references/runtime-contract.md skills/sprint-manage-xiaoqi/references/step-details.md skills/sprint-manage-xiaoqi/scripts/adapters/codex.mjs skills/sprint-manage-xiaoqi/scripts/adapters/trae.mjs skills/sprint-manage-xiaoqi/tests/codex-hook.test.mjs skills/sprint-manage-xiaoqi/tests/trae-adapter.test.mjs skills/sprint-manage-xiaoqi/tests/model-orchestration.test.mjs
git commit -m "feat(sprint-manage): route hooks through openspec root"
```

### Task 6: 全量回归和 Store 场景验收

**Files:**
- Modify: `skills/sprint-manage-xiaoqi/tests/skill-structure.test.mjs`
- Modify: `skills/sprint-manage-xiaoqi/tests/validate-progress.test.mjs`

- [ ] **Step 1: Write the failing tests**

加入 Store 共享规划工作区、两个代码仓库独立 worktree、pointer repo 不重复建账、多需求同一 Spec 冲突阻塞的端到端断言。

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/sprint-manage-xiaoqi/tests/*.test.mjs`
Expected: FAIL，直到全部 Store 行为落地。

- [ ] **Step 3: 完成必要的兼容修正**

只修复 Store 兼容导致的回归，不扩展无关功能；保持普通单仓库流程和已有 98 个测试行为不变。

- [ ] **Step 4: Run full verification**

Run: `node --test skills/sprint-manage-xiaoqi/tests/*.test.mjs; git diff --check`
Expected: 全部测试通过且无 diff whitespace 错误。

- [ ] **Step 5: Commit**

```bash
git add skills/sprint-manage-xiaoqi/tests/skill-structure.test.mjs skills/sprint-manage-xiaoqi/tests/validate-progress.test.mjs
git commit -m "test(sprint-manage): cover openspec store workflows"
```

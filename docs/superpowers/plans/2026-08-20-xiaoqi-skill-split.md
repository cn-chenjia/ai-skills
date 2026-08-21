# Xiaoqi Skill Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Xiaoqi's main skill to the session lock and routing authority while moving ledger, execution, collaboration, closing, and runtime details into references loaded only when needed.

**Architecture:** `SKILL.md` remains the only workflow owner and routes one current intent to one focused reference. Every reference is subordinate, returns a structured result to the main skill, and cannot release the session lock or complete the parent workflow.

**Tech Stack:** Markdown skills and references, Node.js built-in test runner, repository Node.js scripts, skill-creator validator.

**Spec:** `docs/superpowers/specs/2026-08-20-xiaoqi-skill-split-design.md`

## Global Constraints

- The main skill always owns the session, routing, and final workflow decision.
- References are not independently invocable child skills.
- Existing user triggers, ledger schema, scripts, Hook protocol, and delivery-state transitions must remain unchanged.
- One routing decision loads only the reference needed for the current action.
- Every reference must return control to `SKILL.md` after completion or interruption.
- Do not commit during this implementation unless the user gives a later explicit instruction.

## File Map

- Modify `skills/sprint-manage-xiaoqi/SKILL.md`: keep the session lock, ownership rules, minimal startup checks, route table, return loop, output contract, and stop conditions.
- Modify `skills/sprint-manage-xiaoqi/references/state-contract.md`: keep only ledger layout, state, evidence, locking, validation, initialization, closing preconditions, and migration.
- Modify `skills/sprint-manage-xiaoqi/references/step-details.md`: keep OpenSpec action selection, implementation loop, validation, change handling, and failure recovery.
- Create `skills/sprint-manage-xiaoqi/references/collaboration.md`: own multi-requirement, multi-person, branch, worktree, dependency, and write-scope rules.
- Create `skills/sprint-manage-xiaoqi/references/closing.md`: own `ready`, sync, archive, finish, final delivery states, and formal closure.
- Modify `skills/sprint-manage-xiaoqi/references/runtime-contract.md`: add the subordinate-reference contract while preserving runtime and host integration details.
- Modify `skills/sprint-manage-xiaoqi/references/event-contract.md`: add the subordinate-reference contract while preserving the normalized event protocol.
- Create `skills/sprint-manage-xiaoqi/tests/skill-structure.test.mjs`: verify reference ownership, routes, control return, and removal of duplicated sections.
- Modify `skills/sprint-manage-xiaoqi/tests/model-orchestration.test.mjs`: verify behavior invariants without requiring operational detail to remain in the main file.
- Modify `description/skills/sprint-manage-xiaoqi.md`: explain the thin main skill and link the two new focused references.

---

### Task 1: Extract Collaboration Rules

**Files:**
- Create: `skills/sprint-manage-xiaoqi/references/collaboration.md`
- Create: `skills/sprint-manage-xiaoqi/tests/skill-structure.test.mjs`
- Modify: `skills/sprint-manage-xiaoqi/references/state-contract.md:20`
- Modify: `skills/sprint-manage-xiaoqi/references/state-contract.md:112`
- Modify: `skills/sprint-manage-xiaoqi/references/state-contract.md:141`
- Modify: `skills/sprint-manage-xiaoqi/references/step-details.md:216`
- Modify: `skills/sprint-manage-xiaoqi/references/step-details.md:224`
- Modify: `skills/sprint-manage-xiaoqi/references/step-details.md:255`

**Interfaces:**
- Consumes: V4 ledger fields `协作`, `依赖需求`, `冲突键`, `影响范围`, and `并行单元`.
- Produces: `references/collaboration.md` as the only detailed collaboration guide; other references may link to it but must not repeat its procedures.

- [ ] **Step 1: Add a failing structural test for collaboration ownership**

Create `skills/sprint-manage-xiaoqi/tests/skill-structure.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(testDir, "..");
const readSkillFile = (relativePath) =>
  readFile(path.join(skillDir, relativePath), "utf8");

test("keeps detailed collaboration rules in one focused reference", async () => {
  const collaboration = await readSkillFile("references/collaboration.md");
  const state = await readSkillFile("references/state-contract.md");
  const steps = await readSkillFile("references/step-details.md");

  assert.match(collaboration, /不拥有会话或流程控制权/);
  assert.match(collaboration, /返回 `SKILL\.md`/);
  assert.match(collaboration, /单写者/);
  assert.match(collaboration, /独立.*branch.*worktree/s);
  assert.match(collaboration, /write_scope/);
  assert.match(collaboration, /depends_on/);
  assert.match(collaboration, /冲突键/);

  assert.doesNotMatch(state, /^## 协作模式$/m);
  assert.doesNotMatch(state, /^## 并发冲突$/m);
  assert.doesNotMatch(steps, /^## 单人并行多个需求$/m);
  assert.doesNotMatch(steps, /^## 多人分别开发多个需求$/m);
  assert.doesNotMatch(steps, /^## 大型需求多人分工$/m);
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```powershell
node --test skills/sprint-manage-xiaoqi/tests/skill-structure.test.mjs
```

Expected: FAIL because `references/collaboration.md` does not exist.

- [ ] **Step 3: Create the focused collaboration reference**

Create `references/collaboration.md` with this structure:

```markdown
# 小七协作与工作区规则

> 本文件只提供当前动作的操作规则，不拥有会话或流程控制权。完成或中断后必须返回 `SKILL.md`，由主技能重新读取真实状态并路由。

## 单写者
## 需求隔离
## 单人并行多个需求
## 多人分别开发多个需求
## 大型需求共享 Change
## 冲突检查
## 结果返回
```

Move, without changing behavior:

- The single-writer ownership policy from `state-contract.md`; keep lock commands,
  revision checks, and atomic-write mechanics in `state-contract.md`.
- Collaboration modes and worktree rules from `state-contract.md`.
- Cross-requirement and parallel-unit conflict rules from `state-contract.md`.
- Single-person and multi-person parallel workflows from `step-details.md`.
- Shared-change `owner`, `branch`, `worktree`, `write_scope`, and `depends_on` rules from `step-details.md`.

End `## 结果返回` with the exact result fields:

```markdown
- `outcome`
- `summary`
- `evidence`
- `blockers`
- `recommended_next`

协作规则执行后不得直接推进父流程或宣告需求完成，必须返回 `SKILL.md`。
```

- [ ] **Step 4: Remove duplicated collaboration procedures**

In `state-contract.md`, retain the collaboration fields in the schema example, their
validation meaning, and all `ledger-lock.mjs` mechanics. Replace the detailed
`协作模式` and `并发冲突` sections with one short ownership link:

```markdown
协作字段的使用、工作区隔离和跨需求冲突处理见
[collaboration.md](collaboration.md)。本文件只定义账本数据和校验事实。
```

In `step-details.md`, remove the detailed sections for single-person parallel work, multi-person separate requirements, and large shared changes. Add one route sentence where parallel execution is first mentioned:

```markdown
涉及多需求、多人、分支、工作区或写入范围冲突时，返回主技能并读取
[collaboration.md](collaboration.md)。
```

- [ ] **Step 5: Run the collaboration structural test**

Run:

```powershell
node --test skills/sprint-manage-xiaoqi/tests/skill-structure.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Run ledger tests to prove schema behavior is unchanged**

Run:

```powershell
node --test skills/sprint-manage-xiaoqi/tests/validate-progress.test.mjs skills/sprint-manage-xiaoqi/tests/prepare-workspace.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 7: Record the checkpoint without committing**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; the new collaboration reference and test are listed as uncommitted changes.

---

### Task 2: Extract Closing Rules

**Files:**
- Create: `skills/sprint-manage-xiaoqi/references/closing.md`
- Modify: `skills/sprint-manage-xiaoqi/tests/skill-structure.test.mjs`
- Modify: `skills/sprint-manage-xiaoqi/references/step-details.md:124`
- Modify: `skills/sprint-manage-xiaoqi/references/step-details.md:149`
- Modify: `skills/sprint-manage-xiaoqi/references/step-details.md:159`
- Modify: `skills/sprint-manage-xiaoqi/references/state-contract.md:173`
- Modify: `skills/sprint-manage-xiaoqi/references/state-contract.md:250`

**Interfaces:**
- Consumes: delivery state `ready`, archive evidence, finish evidence, and final result `pr-open | merged | kept`.
- Produces: `references/closing.md` as the only detailed guide for post-`ready` decisions and formal closure.

- [ ] **Step 1: Extend the structural test with closing ownership**

Append:

```js
test("keeps post-ready closing rules in one focused reference", async () => {
  const closing = await readSkillFile("references/closing.md");
  const state = await readSkillFile("references/state-contract.md");
  const steps = await readSkillFile("references/step-details.md");

  assert.match(closing, /不拥有会话或流程控制权/);
  assert.match(closing, /到达 `ready` 后停止/);
  assert.match(closing, /用户选择.*PR.*合并.*保留/s);
  assert.match(closing, /archive/);
  assert.match(closing, /finish/);
  assert.match(closing, /close-requirement\.mjs/);
  assert.match(closing, /pr-open \| merged \| kept/);

  assert.doesNotMatch(steps, /^### archive 和 finish$/m);
  assert.doesNotMatch(steps, /^### sync$/m);
  assert.doesNotMatch(state, /^## 首次建账和正式关闭$/m);
});
```

- [ ] **Step 2: Run the test and verify the new case fails**

Run:

```powershell
node --test skills/sprint-manage-xiaoqi/tests/skill-structure.test.mjs
```

Expected: collaboration test PASS; closing test FAIL because `references/closing.md` does not exist.

- [ ] **Step 3: Create the focused closing reference**

Create `references/closing.md` with this structure:

```markdown
# 小七验证后收尾规则

> 本文件只提供当前动作的操作规则，不拥有会话或流程控制权。完成或中断后必须返回 `SKILL.md`，由主技能重新读取真实状态并路由。

## 进入条件
## 用户选择
## 同步与归档
## 分支收尾
## 正式关闭
## 失败返回
```

Move the current rules for:

- Entering `ready` only after project checks, approved review, and OpenSpec verification.
- Stopping at `ready` for the user's choice of PR, merge, or keep.
- Optional OpenSpec sync.
- OpenSpec archive before Superpowers finish.
- Mapping real finish results to `pr-open | merged | kept`.
- Calling `close-requirement.mjs` only when archive and finish evidence both exist.
- Returning failures and missing evidence to the main skill rather than claiming closure.

- [ ] **Step 4: Trim closing details from other references**

In `step-details.md`, keep validation responsibilities and the condition for reaching `ready`, then route post-`ready` work:

```markdown
到达 `ready` 后停止连续执行，返回主技能。用户选择收尾方式后读取
[closing.md](closing.md)。
```

Remove the detailed `sync`, `archive 和 finish`, and iteration-closing procedures.

In `state-contract.md`, keep the state values and evidence requirements because they define ledger validity. Split `首次建账和正式关闭` so initialization remains here, while formal closing becomes:

```markdown
正式关闭的动作顺序和用户选择见 [closing.md](closing.md)；本文件只校验
最终交付状态、archive 证据和 finish 证据是否齐全。
```

- [ ] **Step 5: Run the structural and lifecycle tests**

Run:

```powershell
node --test skills/sprint-manage-xiaoqi/tests/skill-structure.test.mjs skills/sprint-manage-xiaoqi/tests/requirement-lifecycle.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 6: Record the checkpoint without committing**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; `closing.md` and related edits remain uncommitted.

---

### Task 3: Make the Main Skill a Thin Controller

**Files:**
- Modify: `skills/sprint-manage-xiaoqi/SKILL.md:1`
- Modify: `skills/sprint-manage-xiaoqi/tests/model-orchestration.test.mjs:19`
- Modify: `skills/sprint-manage-xiaoqi/tests/skill-structure.test.mjs`
- Modify: `skills/sprint-manage-xiaoqi/references/step-details.md:1`
- Modify: `skills/sprint-manage-xiaoqi/references/state-contract.md:1`
- Modify: `skills/sprint-manage-xiaoqi/references/runtime-contract.md:1`
- Modify: `skills/sprint-manage-xiaoqi/references/event-contract.md:1`

**Interfaces:**
- Consumes: the six reference files and their structured result fields.
- Produces: one authoritative routing loop in `SKILL.md`; no reference can release the lock, finish the parent flow, or route directly to another reference.

- [ ] **Step 1: Replace main-file wording assertions with behavior invariants**

Update the first test in `model-orchestration.test.mjs`:

```js
test("keeps the main skill in control of the Xiaoqi workflow", async () => {
  const skill = await readFile(path.join(skillDir, "SKILL.md"), "utf8");

  assert.match(skill, /会话锁/);
  assert.match(skill, /后续用户消息默认都是当前小七流程的续接/);
  assert.match(skill, /确认、可以、执行、继续/);
  assert.match(skill, /退出小七/);
  assert.match(skill, /主技能.*唯一.*流程控制权/s);
  assert.match(skill, /一次只读取.*当前动作.*参考文件/s);
  assert.match(skill, /返回主技能.*重新读取真实状态/s);
  assert.match(skill, /ready.*blocked.*closed/s);
  assert.match(skill, /outcome.*summary.*evidence.*blockers.*recommended_next/s);
  assert.doesNotMatch(skill, /auto-runner|start-automation|actions\.json/);
  assert.doesNotMatch(skill, /brainstorming/i);
});
```

Keep the existing tests for removed model-replacement executors and deterministic scripts unchanged.

- [ ] **Step 2: Extend structural tests for complete routing and subordinate references**

Append:

```js
test("routes every focused reference from the main skill", async () => {
  const skill = await readSkillFile("SKILL.md");
  const references = [
    "state-contract.md",
    "step-details.md",
    "collaboration.md",
    "closing.md",
    "runtime-contract.md",
    "event-contract.md",
  ];

  for (const name of references) {
    assert.match(skill, new RegExp(`references/${name.replace(".", "\\.")}`));
  }
});

test("requires every reference to return control to the main skill", async () => {
  const references = [
    "state-contract.md",
    "step-details.md",
    "collaboration.md",
    "closing.md",
    "runtime-contract.md",
    "event-contract.md",
  ];

  for (const name of references) {
    const content = await readSkillFile(`references/${name}`);
    assert.match(content, /不拥有会话或流程控制权/, name);
    assert.match(content, /返回 `SKILL\.md`/, name);
  }
});
```

- [ ] **Step 3: Run controller tests and verify they fail**

Run:

```powershell
node --test skills/sprint-manage-xiaoqi/tests/model-orchestration.test.mjs skills/sprint-manage-xiaoqi/tests/skill-structure.test.mjs
```

Expected: FAIL because the current main skill is not yet the thin router and four existing references lack the control-return declaration.

- [ ] **Step 4: Add the subordinate-reference declaration**

Immediately below the title in each of these files:

- `state-contract.md`
- `step-details.md`
- `runtime-contract.md`
- `event-contract.md`

Add:

```markdown
> 本文件只提供当前动作的操作规则，不拥有会话或流程控制权。完成或中断后必须返回 `SKILL.md`，由主技能重新读取真实状态并路由。
```

Do not change the event schema, runtime commands, ledger schema, or action semantics.

- [ ] **Step 5: Rewrite `SKILL.md` as the controller**

Keep the existing frontmatter description and preserve these sections in concise form:

```markdown
# 会话锁
## 续接消息
# 小七研发迭代总控
## 定位与所有权
## 触发边界
## 最小启动检查
## 路由
## 执行返回
## 交互输出
## 停止条件
## Resources
```

The `## 路由` table must include exactly these destinations:

```markdown
| 当前情况 | 读取 |
| --- | --- |
| 新建、恢复、查看需求；账本或状态问题 | [state-contract.md](references/state-contract.md) |
| 开始、继续、更新、验证；普通执行失败 | [step-details.md](references/step-details.md) |
| 多需求、多人、分支、工作区或写入范围冲突 | [collaboration.md](references/collaboration.md) |
| 已到 `ready`；PR、合并、保留、归档或关闭 | [closing.md](references/closing.md) |
| 安装、Hook、Codex、Trae、体检或宿主异常 | [runtime-contract.md](references/runtime-contract.md) |
| 底层事件或适配器数据 | [event-contract.md](references/event-contract.md) |
```

State these controller rules explicitly:

```markdown
- 主技能拥有唯一的会话和流程控制权。
- 一次只读取当前动作需要的一份参考文件。
- 参考文件不得直接调用另一份参考文件；出现新问题时先返回主技能。
- 下游返回 `outcome`、`summary`、`evidence`、`blockers` 和 `recommended_next`。
- 主技能收到结果后重新读取账本、OpenSpec 和项目事实，再决定下一动作。
```

Keep the existing invariants:

- Proposal confirmation precedes ledger initialization.
- No apply, verification, review, archive, or finish without the ledger.
- The current model continues execution after confirmation.
- `ready` waits for the user's closing choice.
- Ordinary failures receive up to three repair attempts; authorization, destructive operations, business conflicts, and exhausted retries are human gates.
- Legal stopping points are `ready`, `blocked`, `closed`, explicit pause/switch/plan-only requests handled by Xiaoqi, or `退出小七`.

Remove operational expansions now owned by references, including ledger command examples, parallel-unit details, full closing steps, and Hook installation walkthroughs. Target 150-200 lines, allowing a small overage only when required to preserve an invariant.

- [ ] **Step 6: Run controller and structure tests**

Run:

```powershell
node --test skills/sprint-manage-xiaoqi/tests/model-orchestration.test.mjs skills/sprint-manage-xiaoqi/tests/skill-structure.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 7: Measure the thin controller**

Run:

```powershell
$text = Get-Content -Raw 'skills/sprint-manage-xiaoqi/SKILL.md'
[pscustomobject]@{
  Lines = ($text -split "`n").Count
  Chars = $text.Length
}
```

Expected: the main file is approximately 150-200 lines and materially smaller than the current 476 lines.

- [ ] **Step 8: Record the checkpoint without committing**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; all changes remain uncommitted.

---

### Task 4: Align the User-Facing Description

**Files:**
- Modify: `description/skills/sprint-manage-xiaoqi.md:1`
- Test: `skills/sprint-manage-xiaoqi/tests/skill-structure.test.mjs`

**Interfaces:**
- Consumes: the final main-skill and reference structure.
- Produces: user-facing documentation that describes Xiaoqi as a thin controller and links all focused references.

- [ ] **Step 1: Add a failing documentation-link test**

Append:

```js
test("documents the thin controller and all focused references", async () => {
  const description = await readFile(
    path.resolve(skillDir, "..", "..", "description", "skills", "sprint-manage-xiaoqi.md"),
    "utf8",
  );

  assert.match(description, /主技能.*会话锁.*路由/s);
  assert.match(description, /collaboration\.md/);
  assert.match(description, /closing\.md/);
  assert.match(description, /按需读取/);
});
```

- [ ] **Step 2: Run the test and verify the documentation case fails**

Run:

```powershell
node --test skills/sprint-manage-xiaoqi/tests/skill-structure.test.mjs
```

Expected: existing structure tests PASS; the new documentation test FAILS because the description does not link the new references.

- [ ] **Step 3: Update the user-facing description**

Near the role overview, add:

```markdown
小七主技能只保留会话锁、意图判断和下一动作路由。账本、执行、协作、收尾和
运行时细节按当前问题读取对应参考文件；参考文件处理完成后仍由主技能继续掌控流程。
```

In the further-reading list, add:

```markdown
- [协作与工作区规则](../../skills/sprint-manage-xiaoqi/references/collaboration.md)
- [验证后收尾规则](../../skills/sprint-manage-xiaoqi/references/closing.md)
```

Keep the existing functional guide; remove only passages that incorrectly imply all details live in `SKILL.md`.

- [ ] **Step 4: Run the documentation structural test**

Run:

```powershell
node --test skills/sprint-manage-xiaoqi/tests/skill-structure.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 5: Record the checkpoint without committing**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; documentation changes remain uncommitted.

---

### Task 5: Full Verification and Duplication Audit

**Files:**
- Verify: `skills/sprint-manage-xiaoqi/`
- Verify: `description/skills/sprint-manage-xiaoqi.md`
- Verify: `docs/superpowers/specs/2026-08-20-xiaoqi-skill-split-design.md`

**Interfaces:**
- Consumes: all completed tasks.
- Produces: evidence that scripts still work, the skill is structurally valid, and detailed rules have one owner.

- [ ] **Step 1: Run all Xiaoqi tests**

Run:

```powershell
$tests = Get-ChildItem 'skills/sprint-manage-xiaoqi/tests' -Filter '*.test.mjs' |
  Select-Object -ExpandProperty FullName
node --test $tests
```

Expected: all tests PASS with zero failures.

- [ ] **Step 2: Run the skill validator**

Run:

```powershell
$validator = Join-Path $env:USERPROFILE '.codex\skills\.system\skill-creator\scripts\quick_validate.py'
python $validator 'skills/sprint-manage-xiaoqi'
```

Expected: validation succeeds with no frontmatter, naming, or unfinished-placeholder errors.

- [ ] **Step 3: Audit responsibility ownership**

Run:

```powershell
rg -n "^## (协作模式|并发冲突|单人并行多个需求|多人分别开发多个需求|大型需求多人分工|同步与归档|分支收尾|正式关闭)$" skills/sprint-manage-xiaoqi
```

Expected:

- Collaboration headings appear only in `references/collaboration.md`.
- Closing headings appear only in `references/closing.md`.
- No detailed collaboration or closing section appears in `SKILL.md`.

- [ ] **Step 4: Audit reference control boundaries**

Run:

```powershell
$refs = Get-ChildItem 'skills/sprint-manage-xiaoqi/references' -Filter '*.md' |
  Select-Object -ExpandProperty FullName
rg --files-without-match "不拥有会话或流程控制权" $refs
rg --files-without-match '返回 `SKILL\.md`' $refs
```

Expected: both commands print no filenames.

- [ ] **Step 5: Review the final diff**

Run:

```powershell
git diff --check
git diff --stat
git status --short
```

Expected:

- No whitespace errors.
- `SKILL.md` is substantially smaller.
- Two focused references and one structural test are added.
- Existing scripts and ledger fixtures are unchanged.
- No commit has been created.

- [ ] **Step 6: Report the result**

Report:

- Main-skill line count before and after.
- New routing references.
- Test count and result.
- Validator result.
- Any remaining risk or intentionally retained duplication.
- Confirmation that changes are uncommitted.

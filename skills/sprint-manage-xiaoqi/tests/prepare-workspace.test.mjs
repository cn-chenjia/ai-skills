import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseProgressYaml } from "../scripts/validate-progress.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(testDir, "..");
const scriptPath = path.join(skillDir, "scripts", "prepare-workspace.mjs");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function createProject() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-workspace-"));
  git(projectRoot, "init");
  git(projectRoot, "config", "user.name", "Xiaoqi Test");
  git(projectRoot, "config", "user.email", "xiaoqi@example.test");
  await writeFile(path.join(projectRoot, "README.md"), "test\n");
  git(projectRoot, "add", "README.md");
  git(projectRoot, "commit", "-m", "initial");
  git(projectRoot, "branch", "-M", "main");
  return projectRoot;
}

async function writeLedger(projectRoot, id) {
  const requirementsDir = path.join(projectRoot, "sprint-manage", "requirements");
  await mkdir(requirementsDir, { recursive: true });
  const ledgerPath = path.join(requirementsDir, `${id}.yaml`);
  await writeFile(
    ledgerPath,
    `schema_version: 4
document_type: requirement
编号: "${id}"
名称: "测试需求"
change_id: "${id}-change"
revision: 1
updated_at: "2026-08-19T10:00:00+08:00"
updated_by: "alice"
流程状态: active
交付状态: not-started
当前意图: "开始实现"
推荐动作: apply
协作:
  模式: single
  负责人: "alice"
  参与人: []
  基线分支: null
  分支: null
  工作区: null
  集成分支: null
依赖需求: []
冲突键: []
影响范围:
  - "src/${id}/"
并行单元: []
计划: null
证据索引:
  checks: []
  review: null
  archive:
    outcome: pending
    path: null
  finish:
    outcome: pending
    result: null
    summary: null
用户决策:
  - kind: proposal-confirmation
    outcome: approved
    actor: "requester"
    at: "2026-08-19T10:00:00+08:00"
阻塞项: []
事件日志: []
`,
  );
  return ledgerPath;
}

function prepare(ledgerPath, projectRoot) {
  return spawnSync(
    process.execPath,
    [scriptPath, ledgerPath, projectRoot, "alice"],
    { cwd: projectRoot, encoding: "utf8" },
  );
}

test("rejects workspace preparation before the proposal is confirmed", async () => {
  const projectRoot = await createProject();
  const ledgerPath = await writeLedger(projectRoot, "story-1000");
  const source = await readFile(ledgerPath, "utf8");
  await writeFile(
    ledgerPath,
    source.replace(
      `用户决策:
  - kind: proposal-confirmation
    outcome: approved
    actor: "requester"
    at: "2026-08-19T10:00:00+08:00"`,
      "用户决策: []",
    ),
  );
  git(projectRoot, "add", "sprint-manage");
  git(projectRoot, "commit", "-m", "add unconfirmed requirement");

  const result = prepare(ledgerPath, projectRoot);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /方案尚未确认/);
  assert.equal(git(projectRoot, "branch", "--show-current"), "main");
});

test("prepares the first coding requirement in the current worktree", async () => {
  const projectRoot = await createProject();
  const ledgerPath = await writeLedger(projectRoot, "story-1001");
  git(projectRoot, "add", "sprint-manage");
  git(projectRoot, "commit", "-m", "add requirement");

  const result = prepare(ledgerPath, projectRoot);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.mode, "current");
  assert.equal(path.resolve(output.worktree), projectRoot);
  assert.equal(output.branch, "feature/story-1001");
  assert.equal(output.baseBranch, "main");
  assert.equal(git(projectRoot, "branch", "--show-current"), "feature/story-1001");

  const ledger = parseProgressYaml(await readFile(ledgerPath, "utf8"));
  assert.equal(ledger.协作.基线分支, "main");
  assert.equal(ledger.协作.分支, "feature/story-1001");
  assert.equal(ledger.协作.工作区, ".");
  assert.equal(ledger.交付状态, "not-started");

  assert.equal(
    existsSync(path.join(projectRoot, "sprint-manage", "local", "session.yaml")),
    false,
  );

  const gitignore = readFileSync(path.join(projectRoot, ".gitignore"), "utf8");
  assert.doesNotMatch(gitignore, /^sprint-manage\/local\/$/m);
  assert.match(gitignore, /^sprint-manage\/requirements\/\*\.yaml\.lock$/m);
  assert.match(gitignore, /^\.worktrees\/$/m);
});

test("creates a separate worktree for a second coding requirement", async () => {
  const projectRoot = await createProject();
  const firstLedger = await writeLedger(projectRoot, "story-1001");
  const firstSource = await readFile(firstLedger, "utf8");
  await writeFile(
    firstLedger,
    firstSource
      .replace("交付状态: not-started", "交付状态: coding")
      .replace("  基线分支: null", '  基线分支: "main"')
      .replace("  分支: null", '  分支: "feature/story-1001"')
      .replace("  工作区: null", '  工作区: "."'),
  );
  git(projectRoot, "add", "sprint-manage");
  git(projectRoot, "commit", "-m", "add active requirement");
  git(projectRoot, "checkout", "-b", "feature/story-1001");
  const secondLedger = await writeLedger(projectRoot, "story-1002");

  const result = prepare(secondLedger, projectRoot);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  const expectedWorktree = path.join(projectRoot, ".worktrees", "story-1002");
  const targetLedger = path.join(
    expectedWorktree,
    "sprint-manage",
    "requirements",
    "story-1002.yaml",
  );
  assert.equal(output.mode, "created");
  assert.equal(path.resolve(output.worktree), expectedWorktree);
  assert.equal(output.branch, "feature/story-1002");
  assert.equal(output.baseBranch, "main");
  assert.equal(git(projectRoot, "branch", "--show-current"), "feature/story-1001");
  assert.equal(git(expectedWorktree, "branch", "--show-current"), "feature/story-1002");
  assert.equal(existsSync(secondLedger), false);

  const ledger = parseProgressYaml(await readFile(targetLedger, "utf8"));
  assert.equal(ledger.协作.基线分支, "main");
  assert.equal(ledger.协作.分支, "feature/story-1002");
  assert.equal(ledger.协作.工作区, ".");
  assert.equal(ledger.交付状态, "not-started");

  assert.equal(
    existsSync(path.join(expectedWorktree, "sprint-manage", "local", "session.yaml")),
    false,
  );
});

test("moves an uncommitted second ledger into its isolated worktree without creating session state", async () => {
  const projectRoot = await createProject();
  const firstLedger = await writeLedger(projectRoot, "story-1001");
  const firstSource = await readFile(firstLedger, "utf8");
  await writeFile(
    firstLedger,
    firstSource
      .replace("交付状态: not-started", "交付状态: coding")
      .replace("  基线分支: null", '  基线分支: "main"')
      .replace("  分支: null", '  分支: "feature/story-1001"')
      .replace("  工作区: null", '  工作区: "."'),
  );
  git(projectRoot, "add", "sprint-manage/requirements/story-1001.yaml");
  git(projectRoot, "commit", "-m", "add active requirement");
  git(projectRoot, "checkout", "-b", "feature/story-1001");
  const secondLedger = await writeLedger(projectRoot, "story-1002");

  const result = prepare(secondLedger, projectRoot);

  assert.equal(result.status, 0, result.stderr);
  const worktree = path.join(projectRoot, ".worktrees", "story-1002");
  const targetLedger = path.join(
    worktree,
    "sprint-manage",
    "requirements",
    "story-1002.yaml",
  );
  assert.equal(existsSync(secondLedger), false);
  assert.equal(existsSync(targetLedger), true);
  assert.equal(
    existsSync(path.join(projectRoot, "sprint-manage", "local", "session.yaml")),
    false,
  );
  assert.equal(
    existsSync(path.join(worktree, "sprint-manage", "local", "session.yaml")),
    false,
  );
  const ledger = parseProgressYaml(await readFile(targetLedger, "utf8"));
  assert.equal(ledger.协作.工作区, ".");
  assert.equal(ledger.协作.分支, "feature/story-1002");
});

test("does not switch the current worktree when it has uncommitted changes", async () => {
  const projectRoot = await createProject();
  const ledgerPath = await writeLedger(projectRoot, "story-1001");
  git(projectRoot, "add", "sprint-manage");
  git(projectRoot, "commit", "-m", "add requirement");
  await writeFile(path.join(projectRoot, "README.md"), "uncommitted\n");

  const result = prepare(ledgerPath, projectRoot);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /未提交修改/);
  assert.equal(git(projectRoot, "branch", "--show-current"), "main");
  const ledger = parseProgressYaml(await readFile(ledgerPath, "utf8"));
  assert.equal(ledger.协作.基线分支, null);
  assert.equal(ledger.协作.分支, null);
  assert.equal(ledger.协作.工作区, null);
});

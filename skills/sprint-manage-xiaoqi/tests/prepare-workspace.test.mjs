import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseProgressYaml,
  validateProgressFile,
} from "../scripts/validate-progress.mjs";
import { prepareWorkspaces, reconcileLedgerWithGit } from "../scripts/prepare-workspace.mjs";
import { advanceProgress } from "../scripts/advance-progress.mjs";
import { getRequirementPath } from "../scripts/ledger-paths.mjs";

process.env.USERPROFILE = mkdtempSync(path.join(os.tmpdir(), "xiaoqi-prepare-test-home-"));
process.env.HOME = process.env.USERPROFILE;

const testDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(testDir, "..");
const scriptPath = path.join(skillDir, "scripts", "prepare-workspace.mjs");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function createProject() {
  rmSync(path.join(process.env.USERPROFILE, ".xiaoqi", "sprint-manage"), {
    recursive: true,
    force: true,
  });
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

async function createSecondaryProject(parentRoot, name) {
  const projectRoot = path.join(parentRoot, name);
  await mkdir(projectRoot, { recursive: true });
  git(projectRoot, "init");
  git(projectRoot, "config", "user.name", "Xiaoqi Test");
  git(projectRoot, "config", "user.email", "xiaoqi@example.test");
  await writeFile(path.join(projectRoot, "README.md"), `${name}\n`);
  git(projectRoot, "add", "README.md");
  git(projectRoot, "commit", "-m", "initial");
  git(projectRoot, "branch", "-M", "main");
  return projectRoot;
}

async function writeLedger(projectRoot, id) {
  const ledgerPath = getRequirementPath(projectRoot, id);
  await mkdir(path.dirname(ledgerPath), { recursive: true });
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
仓库:
  - id: "main"
    root: "."
    branch: null
    worktree: null
    baseBranch: null
依赖需求: []
冲突键: []
影响范围:
  - "src/${id}/"
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

test("prepares the workspace before the proposal is confirmed", async () => {
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
      "用户决策:\n  - kind: requirement-intake\n    outcome: accepted\n    actor: \"requester\"\n    at: \"2026-08-19T10:00:00+08:00\"",
    ),
  );
  git(projectRoot, "commit", "--allow-empty", "-m", "add unconfirmed requirement");

  const result = prepare(ledgerPath, projectRoot);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.recommendedNext, "propose");
  assert.equal(git(projectRoot, "branch", "--show-current"), "main");
  assert.equal(git(output.worktree, "branch", "--show-current"), "feature/story-1000");
});

test("always prepares the first requirement in an isolated worktree", async () => {
  const projectRoot = await createProject();
  const ledgerPath = await writeLedger(projectRoot, "story-1001");
  git(projectRoot, "commit", "--allow-empty", "-m", "add requirement");

  const result = prepare(ledgerPath, projectRoot);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  const expectedWorktree = path.join(projectRoot, ".worktrees", "story-1001");
  assert.equal(output.mode, "created");
  assert.equal(path.resolve(output.worktree), expectedWorktree);
  assert.equal(output.branch, "feature/story-1001");
  assert.equal(output.baseBranch, "main");
  assert.equal(git(projectRoot, "branch", "--show-current"), "main");
  assert.equal(git(expectedWorktree, "branch", "--show-current"), "feature/story-1001");

  const ledger = parseProgressYaml(await readFile(ledgerPath, "utf8"));
  assert.deepEqual(ledger.协作, { 模式: "single", 负责人: "alice" });
  assert.equal(ledger.仓库[0].baseBranch, "main");
  assert.equal(ledger.仓库[0].branch, "feature/story-1001");
  assert.equal(ledger.仓库[0].worktree, path.join(".worktrees", "story-1001"));
  assert.equal(ledger.交付状态, "not-started");
});

test("creates an isolated worktree even when the current worktree is dirty", async () => {
  const projectRoot = await createProject();
  const ledgerPath = await writeLedger(projectRoot, "story-1000");
  await writeFile(path.join(projectRoot, "local-change.txt"), "keep me\n");

  const result = prepare(ledgerPath, projectRoot);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.mode, "created");
  assert.equal(git(projectRoot, "branch", "--show-current"), "main");
  assert.equal(git(output.worktree, "branch", "--show-current"), "feature/story-1000");
  assert.equal(existsSync(path.join(projectRoot, "local-change.txt")), true);
});

test("creates a separate worktree for a second coding requirement", async () => {
  const projectRoot = await createProject();
  const firstLedger = await writeLedger(projectRoot, "story-1001");
  const firstSource = await readFile(firstLedger, "utf8");
  await writeFile(
    firstLedger,
    firstSource
      .replace("交付状态: not-started", "交付状态: coding")
      .replace("    branch: null", '    branch: "feature/story-1001"')
      .replace("    worktree: null", '    worktree: "."')
      .replace("    baseBranch: null", '    baseBranch: "main"'),
  );
  git(projectRoot, "commit", "--allow-empty", "-m", "add active requirement");
  git(projectRoot, "checkout", "-b", "feature/story-1001");
  const secondLedger = await writeLedger(projectRoot, "story-1002");

  const result = prepare(secondLedger, projectRoot);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  const expectedWorktree = path.join(projectRoot, ".worktrees", "story-1002");
  const targetLedger = secondLedger;
  assert.equal(output.mode, "created");
  assert.equal(path.resolve(output.worktree), expectedWorktree);
  assert.equal(output.branch, "feature/story-1002");
  assert.equal(output.baseBranch, "main");
  assert.equal(git(projectRoot, "branch", "--show-current"), "feature/story-1001");
  assert.equal(git(expectedWorktree, "branch", "--show-current"), "feature/story-1002");
  assert.equal(existsSync(secondLedger), true);

  const ledger = parseProgressYaml(await readFile(targetLedger, "utf8"));
  assert.deepEqual(ledger.协作, { 模式: "single", 负责人: "alice" });
  assert.equal(ledger.仓库[0].baseBranch, "main");
  assert.equal(ledger.仓库[0].branch, "feature/story-1002");
  assert.equal(ledger.仓库[0].worktree, path.join(".worktrees", "story-1002"));
  assert.equal(ledger.交付状态, "not-started");

  assert.equal(
    existsSync(path.join(expectedWorktree, "sprint-manage", "local", "session.yaml")),
    false,
  );
});

test("moves an uncommitted second ledger into its isolated worktree without replacing the active session", async () => {
  const projectRoot = await createProject();
  const firstLedger = await writeLedger(projectRoot, "story-1001");
  const firstSource = await readFile(firstLedger, "utf8");
  await writeFile(
    firstLedger,
    firstSource
      .replace("交付状态: not-started", "交付状态: coding")
      .replace("    branch: null", '    branch: "feature/story-1001"')
      .replace("    worktree: null", '    worktree: "."')
      .replace("    baseBranch: null", '    baseBranch: "main"'),
  );
  git(projectRoot, "commit", "--allow-empty", "-m", "add active requirement");
  git(projectRoot, "checkout", "-b", "feature/story-1001");
  const secondLedger = await writeLedger(projectRoot, "story-1002");

  const result = prepare(secondLedger, projectRoot);

  assert.equal(result.status, 0, result.stderr);
  const worktree = path.join(projectRoot, ".worktrees", "story-1002");
  const targetLedger = secondLedger;
  assert.equal(existsSync(secondLedger), true);
  assert.equal(existsSync(targetLedger), true);
  assert.equal(existsSync(path.join(projectRoot, "sprint-manage")), false);
  assert.equal(existsSync(path.join(worktree, "sprint-manage")), false);
  const ledger = parseProgressYaml(await readFile(targetLedger, "utf8"));
  assert.equal(ledger.仓库[0].worktree, path.join(".worktrees", "story-1002"));
  assert.equal(ledger.仓库[0].branch, "feature/story-1002");
});

test("prepare output validates without unsupported collaboration fields", async () => {
  const projectRoot = await createProject();
  const ledgerPath = await writeLedger(projectRoot, "story-2000");
  git(projectRoot, "commit", "--allow-empty", "-m", "add active requirement");

  const result = await prepareWorkspaces(ledgerPath, projectRoot, "alice");

  assert.equal(result.outcome, "completed");
  const ledger = parseProgressYaml(await readFile(ledgerPath, "utf8"));
  assert.deepEqual(ledger.协作, { 模式: "single", 负责人: "alice" });
  assert.deepEqual(validateProgressFile(ledgerPath), []);
});

test("prepares a single top-level repository entry", async () => {
  const projectRoot = await createProject();
  const ledgerPath = await writeLedger(projectRoot, "story-2001");
  const source = await readFile(ledgerPath, "utf8");
  await writeFile(ledgerPath, `${source.replace(/协作:\n[\s\S]*?依赖需求:/, `协作:\n  模式: single\n  负责人: "alice"\n仓库:\n  - id: "main"\n    root: "."\n    branch: null\n    worktree: null\n依赖需求:`)}`);
  git(projectRoot, "commit", "--allow-empty", "-m", "add repository ledger");

  const result = await prepareWorkspaces(ledgerPath, projectRoot, "alice");

  rmSync(path.join(projectRoot, ".test-home"), { recursive: true, force: true });
  assert.equal(result.repositories.length, 1);
  assert.equal(result.repositories[0].branch, "feature/story-2001");
  const ledger = parseProgressYaml(await readFile(ledgerPath, "utf8"));
  assert.equal(ledger.仓库[0].root, ".");
  assert.equal(ledger.仓库[0].branch, "feature/story-2001");
  assert.equal(ledger.仓库[0].worktree, path.join(".worktrees", "story-2001"));
});

test("prepares every repository and writes branches back to one global ledger", async () => {
  const projectRoot = await createProject();
  const secondaryRoot = await createSecondaryProject(path.dirname(projectRoot), `secondary-${path.basename(projectRoot)}`);
  const ledgerPath = await writeLedger(projectRoot, "story-2002");
  const source = await readFile(ledgerPath, "utf8");
  await writeFile(ledgerPath, source.replace(/协作:\n[\s\S]*?依赖需求:/, `协作:\n  模式: single\n  负责人: "alice"\n仓库:\n  - id: "main"\n    root: "."\n    branch: null\n    worktree: null\n  - id: "secondary"\n    root: "../${path.basename(secondaryRoot)}"\n    branch: null\n    worktree: null\n依赖需求:`));
  git(projectRoot, "commit", "--allow-empty", "-m", "add multi repository ledger");

  const result = await prepareWorkspaces(ledgerPath, projectRoot, "alice");

  assert.deepEqual(result.repositories.map((repo) => repo.id), ["main", "secondary"]);
  assert.equal(git(projectRoot, "branch", "--show-current"), "main");
  assert.equal(git(secondaryRoot, "branch", "--show-current"), "main");
  assert.equal(git(result.repositories[0].worktree, "branch", "--show-current"), "feature/story-2002");
  assert.equal(git(result.repositories[1].worktree, "branch", "--show-current"), "feature/story-2002-secondary");
  const ledger = parseProgressYaml(await readFile(ledgerPath, "utf8"));
  assert.equal(ledger.仓库[0].branch, "feature/story-2002");
  assert.equal(ledger.仓库[1].branch, "feature/story-2002-secondary");
  assert.equal(ledger.仓库[1].root, `../${path.basename(secondaryRoot)}`);
  assert.equal(existsSync(path.join(projectRoot, "sprint-manage", "local", "session.yaml")), false);
});

test("reports ledger and Git consistency for each repository", async () => {
  const projectRoot = await createProject();
  const ledgerPath = await writeLedger(projectRoot, "story-reconcile");
  const prepared = await prepareWorkspaces(ledgerPath, projectRoot, "alice");
  const report = reconcileLedgerWithGit({ ledgerPath, projectRoot });
  assert.equal(report.consistent, true);
  assert.equal(report.repositories[0].consistent, true);
  assert.deepEqual(report.issues, []);
  assert.equal(prepared.repositories[0].branch, "feature/story-reconcile");
});
test("rolls back newly created workspaces when a later repository fails", async () => {
  const projectRoot = await createProject();
  const ledgerPath = await writeLedger(projectRoot, "story-rollback");
  const source = await readFile(ledgerPath, "utf8");
  await writeFile(ledgerPath, source.replace(/仓库:\n[\s\S]*?依赖需求:/, `仓库:\n  - id: "main"\n    root: "."\n    branch: null\n    worktree: null\n  - id: "missing"\n    root: "../does-not-exist"\n    branch: null\n    worktree: null\n依赖需求:`));

  await assert.rejects(
    async () => prepareWorkspaces(ledgerPath, projectRoot, "alice"),
    (error) => /回滚|cleanup|清理/i.test(error.message),
  );
  assert.equal(existsSync(path.join(projectRoot, ".worktrees", "story-rollback")), false);
  assert.equal(git(projectRoot, "branch", "--list", "feature/story-rollback"), "");
});

test("rollback keeps reused worktrees while removing only newly created ones", async () => {
  const projectRoot = await createProject();
  const secondaryRoot = await createSecondaryProject(path.dirname(projectRoot), `secondary-reuse-${path.basename(projectRoot)}`);
  const ledgerPath = await writeLedger(projectRoot, "story-reuse");
  const source = await readFile(ledgerPath, "utf8");
  await writeFile(ledgerPath, source.replace(/仓库:\n[\s\S]*?依赖需求:/, `仓库:\n  - id: "main"\n    root: "."\n    branch: null\n    worktree: null\n  - id: "secondary"\n    root: "../${path.basename(secondaryRoot)}"\n    branch: null\n    worktree: null\n依赖需求:`));

  await prepareWorkspaces(ledgerPath, projectRoot, "alice");
  const mainWorktree = path.join(projectRoot, ".worktrees", "story-reuse");
  assert.equal(existsSync(mainWorktree), true);

  const updated = await readFile(ledgerPath, "utf8");
  await writeFile(ledgerPath, updated.replace(`root: "../${path.basename(secondaryRoot)}"`, 'root: "../does-not-exist"'));

  await assert.rejects(
    async () => prepareWorkspaces(ledgerPath, projectRoot, "alice"),
    (error) => /回滚|cleanup|清理/i.test(error.message),
  );

  assert.equal(existsSync(mainWorktree), true);
  assert.notEqual(git(projectRoot, "branch", "--list", "feature/story-reuse"), "");
  assert.equal(git(mainWorktree, "branch", "--show-current"), "feature/story-reuse");
});

test("reconcile reports worktree-missing when the worktree directory is gone", async () => {
  const projectRoot = await createProject();
  const ledgerPath = await writeLedger(projectRoot, "story-wt-missing");
  await prepareWorkspaces(ledgerPath, projectRoot, "alice");
  rmSync(path.join(projectRoot, ".worktrees", "story-wt-missing"), { recursive: true, force: true });

  const report = reconcileLedgerWithGit({ ledgerPath, projectRoot });

  assert.equal(report.outcome, "inconsistent");
  assert.equal(report.consistent, false);
  assert.deepEqual(report.issues.map((issue) => issue.code), ["worktree-missing"]);
  assert.equal(report.issues[0].repository_id, "main");
  assert.equal(report.issues[0].expected, path.join(".worktrees", "story-wt-missing"));
  assert.equal(report.issues[0].actual, null);
});

test("reconcile reports branch-missing when the ledger branch no longer exists", async () => {
  const projectRoot = await createProject();
  const ledgerPath = await writeLedger(projectRoot, "story-br-missing");
  await prepareWorkspaces(ledgerPath, projectRoot, "alice");
  git(projectRoot, "worktree", "remove", path.join(projectRoot, ".worktrees", "story-br-missing"));
  git(projectRoot, "branch", "-D", "feature/story-br-missing");

  const report = reconcileLedgerWithGit({ ledgerPath, projectRoot });

  const codes = report.issues.map((issue) => issue.code);
  assert.equal(report.outcome, "inconsistent");
  assert.ok(codes.includes("branch-missing"));
  assert.ok(codes.includes("worktree-missing"));
  const branchIssue = report.issues.find((issue) => issue.code === "branch-missing");
  assert.equal(branchIssue.expected, "feature/story-br-missing");
  assert.equal(branchIssue.actual, null);
});

test("reconcile reports worktree-unregistered when the directory exists outside git", async () => {
  const projectRoot = await createProject();
  const ledgerPath = await writeLedger(projectRoot, "story-unregistered");
  await prepareWorkspaces(ledgerPath, projectRoot, "alice");
  const worktree = path.join(projectRoot, ".worktrees", "story-unregistered");
  git(projectRoot, "worktree", "remove", worktree);
  await mkdir(worktree, { recursive: true });

  const report = reconcileLedgerWithGit({ ledgerPath, projectRoot });

  assert.equal(report.outcome, "inconsistent");
  assert.deepEqual(report.issues.map((issue) => issue.code), ["worktree-unregistered"]);
  assert.equal(report.issues[0].expected, "git-registered");
  assert.equal(report.issues[0].actual, "unregistered");
});

test("reconcile reports worktree-branch-mismatch when the worktree is on another branch", async () => {
  const projectRoot = await createProject();
  const ledgerPath = await writeLedger(projectRoot, "story-mismatch");
  await prepareWorkspaces(ledgerPath, projectRoot, "alice");
  git(path.join(projectRoot, ".worktrees", "story-mismatch"), "checkout", "-b", "feature/other-branch");

  const report = reconcileLedgerWithGit({ ledgerPath, projectRoot });

  assert.equal(report.outcome, "inconsistent");
  assert.deepEqual(report.issues.map((issue) => issue.code), ["worktree-branch-mismatch"]);
  assert.equal(report.issues[0].repository_id, "main");
  assert.equal(report.issues[0].expected, "feature/story-mismatch");
  assert.equal(report.issues[0].actual, "feature/other-branch");
});

test("reconcile reports root-not-git for a repository root outside any git repository", async () => {
  const projectRoot = await createProject();
  const ledgerPath = await writeLedger(projectRoot, "story-not-git");
  const source = await readFile(ledgerPath, "utf8");
  await writeFile(ledgerPath, source.replace(/仓库:\n[\s\S]*?依赖需求:/, `仓库:\n  - id: "plain"\n    root: "../not-a-git-repo"\n    branch: "feature/story-not-git"\n    worktree: ".worktrees/story-not-git"\n依赖需求:`));

  const report = reconcileLedgerWithGit({ ledgerPath, projectRoot });

  assert.equal(report.outcome, "inconsistent");
  assert.deepEqual(report.issues.map((issue) => issue.code), ["root-not-git"]);
  assert.equal(report.issues[0].repository_id, "plain");
  assert.equal(report.issues[0].expected, "git-repository");
  assert.equal(report.issues[0].actual, "not-a-git-repository");
});

test("reconcile reports missing ledger entries with expected and actual", async () => {
  const projectRoot = await createProject();
  const ledgerPath = await writeLedger(projectRoot, "story-empty-entries");

  const report = reconcileLedgerWithGit({ ledgerPath, projectRoot });

  assert.equal(report.outcome, "inconsistent");
  assert.deepEqual(report.issues.map((issue) => issue.code), ["branch-missing", "worktree-missing"]);
  const branchIssue = report.issues.find((issue) => issue.code === "branch-missing");
  assert.equal(branchIssue.expected, "non-empty branch");
  assert.equal(branchIssue.actual, null);
  const worktreeIssue = report.issues.find((issue) => issue.code === "worktree-missing");
  assert.equal(worktreeIssue.expected, "non-empty worktree");
  assert.equal(worktreeIssue.actual, null);
});

test("advance to coding passes default reconciliation when the ledger matches Git", async () => {
  const projectRoot = await createProject();
  const ledgerPath = await writeLedger(projectRoot, "story-advance-ok");
  const source = await readFile(ledgerPath, "utf8");
  await writeFile(ledgerPath, source.replace(
    `用户决策:
  - kind: proposal-confirmation
    outcome: approved
    actor: "requester"
    at: "2026-08-19T10:00:00+08:00"`,
    `用户决策:
  - kind: proposal-confirmation
    outcome: approved
    actor: "requester"
    at: "2026-08-19T10:00:00+08:00"
  - kind: implementation-start
    outcome: approved
    actor: "requester"
    at: "2026-08-19T10:00:00+08:00"`,
  ));
  await prepareWorkspaces(ledgerPath, projectRoot, "alice");

  advanceProgress(ledgerPath, "coding", {
    kind: "apply",
    command: "openspec apply story-advance-ok",
    exit_code: 0,
    checked_at: "2026-08-20T09:00:00+08:00",
    summary: "实现已开始",
  }, "alice", { projectRoot });

  assert.equal(parseProgressYaml(await readFile(ledgerPath, "utf8")).交付状态, "coding");
});

test("advance to coding is rejected by default reconciliation when the worktree is gone", async () => {
  const projectRoot = await createProject();
  const ledgerPath = await writeLedger(projectRoot, "story-advance-reject");
  const source = await readFile(ledgerPath, "utf8");
  await writeFile(ledgerPath, source.replace(
    `用户决策:
  - kind: proposal-confirmation
    outcome: approved
    actor: "requester"
    at: "2026-08-19T10:00:00+08:00"`,
    `用户决策:
  - kind: proposal-confirmation
    outcome: approved
    actor: "requester"
    at: "2026-08-19T10:00:00+08:00"
  - kind: implementation-start
    outcome: approved
    actor: "requester"
    at: "2026-08-19T10:00:00+08:00"`,
  ));
  await prepareWorkspaces(ledgerPath, projectRoot, "alice");
  rmSync(path.join(projectRoot, ".worktrees", "story-advance-reject"), { recursive: true, force: true });

  assert.throws(
    () => advanceProgress(ledgerPath, "coding", {
      kind: "apply",
      command: "openspec apply story-advance-reject",
      exit_code: 0,
      checked_at: "2026-08-20T09:00:00+08:00",
      summary: "实现已开始",
    }, "alice", { projectRoot }),
    /worktree-missing/,
  );
  assert.equal(parseProgressYaml(await readFile(ledgerPath, "utf8")).交付状态, "not-started");
});


test("keeps the current worktree untouched when it has uncommitted changes", async () => {
  const projectRoot = await createProject();
  const ledgerPath = await writeLedger(projectRoot, "story-1001");
  git(projectRoot, "commit", "--allow-empty", "-m", "add requirement");
  await writeFile(path.join(projectRoot, "README.md"), "uncommitted\n");

  const result = prepare(ledgerPath, projectRoot);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(git(projectRoot, "branch", "--show-current"), "main");
  assert.equal(git(output.worktree, "branch", "--show-current"), "feature/story-1001");
  assert.equal(await readFile(path.join(projectRoot, "README.md"), "utf8"), "uncommitted\n");
  const ledger = parseProgressYaml(await readFile(ledgerPath, "utf8"));
  assert.equal(ledger.协作.模式, "single");
  assert.equal(ledger.协作.负责人, "alice");
  assert.equal(ledger.仓库[0].branch, "feature/story-1001");
  assert.equal(ledger.仓库[0].worktree, path.join(".worktrees", "story-1001"));
  assert.equal(ledger.仓库[0].baseBranch, "main");
});

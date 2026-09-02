import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseProgressYaml,
  validateProgress,
  validateProgressDirectory,
} from "../scripts/validate-progress.mjs";
import {
  acquireLedgerLock,
  commitLedgerLock,
} from "../scripts/ledger-lock.mjs";
import { advanceProgress } from "../scripts/advance-progress.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(testDir, "..");
const repoRoot = path.resolve(skillDir, "..");

async function fixtureSource(name) {
  return readFile(path.join(testDir, "fixtures", name), "utf8");
}

async function fixture(name) {
  return parseProgressYaml(await fixtureSource(name));
}

async function issueCodes(name) {
  return new Set(validateProgress(await fixture(name)).map((issue) => issue.code));
}

test("accepts complete TDD evidence for a mapped task", async () => {
  const document = await fixture("valid-single.yaml");
  document.任务映射 = [{
    id: "task-1",
    status: "completed",
    tdd: {
      enabled: true,
      red: { command: "npm test", exit_code: 1, result: "failed", summary: "测试先失败" },
      green: { command: "npm test", exit_code: 0, result: "passed", summary: "实现后通过" },
    },
  }];
  assert.deepEqual(validateProgress(document), []);
});

test("rejects enabled TDD evidence without a failed red phase", async () => {
  const document = await fixture("valid-single.yaml");
  document.任务映射 = [{
    id: "task-1",
    status: "pending",
    tdd: {
      enabled: true,
      red: { command: "npm test", exit_code: 0, result: "passed", summary: "错误的 red" },
      green: { command: "npm test", exit_code: 0, result: "passed", summary: "通过" },
    },
  }];
  const codes = new Set(validateProgress(document).map((issue) => issue.code));
  assert(codes.has("invalid-tdd-red"));
});

test("accepts a disabled TDD task with an exemption reason", async () => {
  const document = await fixture("valid-single.yaml");
  document.任务映射 = [{
    id: "task-1",
    status: "completed",
    tdd: { enabled: false, reason: "纯配置变更，无业务逻辑" },
  }];
  assert.deepEqual(validateProgress(document), []);
});

test("rejects a disabled TDD task without an exemption reason", async () => {
  const document = await fixture("valid-single.yaml");
  document.任务映射 = [{
    id: "task-1",
    status: "pending",
    tdd: { enabled: false },
  }];
  const codes = new Set(validateProgress(document).map((issue) => issue.code));
  assert(codes.has("missing-tdd-exemption-reason"));
});

test("maps TDD evidence from apply onto the completed task", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-tdd-map-"));
  const file = path.join(directory, "story-1001.yaml");
  const source = (await fixtureSource("valid-single.yaml"))
    .replace("交付状态: coding", "交付状态: not-started")
    .replace("证据索引:\n", "任务映射:\n  - id: task-1\n    status: pending\n证据索引:\n");
  await writeFile(file, source);
  advanceProgress(file, "coding", {
    kind: "apply",
    command: "apply task-1",
    exit_code: 0,
    checked_at: "2026-08-20T10:00:00+08:00",
    summary: "task-1 完成",
    completed_tasks: ["task-1"],
    tdd_tasks: [{
      task_id: "task-1",
      tdd: {
        enabled: true,
        red: { command: "npm test", exit_code: 1, result: "failed", summary: "先失败" },
        green: { command: "npm test", exit_code: 0, result: "passed", summary: "后通过" },
      },
    }],
  }, "alice", { reconcile: false });
  const advanced = parseProgressYaml(await readFile(file, "utf8"));
  assert.equal(advanced.任务映射[0].tdd.enabled, true);
});

test("advance rejects apply TDD exemption without a recorded reason", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-tdd-reason-"));
  const file = path.join(directory, "story-1001.yaml");
  const source = (await fixtureSource("valid-single.yaml"))
    .replace("交付状态: coding", "交付状态: not-started")
    .replace("证据索引:\n", "任务映射:\n  - id: task-1\n    status: pending\n证据索引:\n");
  await writeFile(file, source);

  assert.throws(
    () => advanceProgress(file, "coding", {
      kind: "apply",
      command: "apply task-1",
      exit_code: 0,
      checked_at: "2026-08-20T10:00:00+08:00",
      summary: "task-1 完成",
      completed_tasks: ["task-1"],
      tdd: { enabled: false },
    }, "alice", { reconcile: false }),
    /豁免原因/,
  );
});

test("advance accepts a recorded TDD exemption and maps it onto the task", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-tdd-reason-ok-"));
  const file = path.join(directory, "story-1001.yaml");
  const source = (await fixtureSource("valid-single.yaml"))
    .replace("交付状态: coding", "交付状态: not-started")
    .replace("证据索引:\n", "任务映射:\n  - id: task-1\n    status: pending\n证据索引:\n");
  await writeFile(file, source);

  advanceProgress(file, "coding", {
    kind: "apply",
    command: "apply task-1",
    exit_code: 0,
    checked_at: "2026-08-20T10:00:00+08:00",
    summary: "task-1 完成",
    completed_tasks: ["task-1"],
    tdd_tasks: [{
      task_id: "task-1",
      tdd: { enabled: false, reason: "纯配置变更，无业务逻辑" },
    }],
  }, "alice", { reconcile: false });

  const advanced = parseProgressYaml(await readFile(file, "utf8"));
  assert.equal(advanced.任务映射[0].status, "completed");
  assert.equal(advanced.任务映射[0].tdd.enabled, false);
  assert.equal(advanced.任务映射[0].tdd.reason, "纯配置变更，无业务逻辑");
});

test("accepts a task completion mapping on the requirement ledger", async () => {
  const document = await fixture("valid-single.yaml");
  document.任务映射 = [
    { id: "task-1", status: "completed" },
    { id: "task-2", status: "pending" },
  ];
  assert.deepEqual(validateProgress(document), []);
});

test("rejects completed task ids that are not registered", async () => {
  const document = await fixture("valid-single.yaml");
  document.任务映射 = [{ id: "task-1", status: "pending" }];
  document.证据索引 = {
    apply: {
      kind: "apply",
      command: "apply task-2",
      exit_code: 0,
      checked_at: "2026-08-20T10:00:00+08:00",
      summary: "完成 task-2",
      completed_tasks: ["task-2"],
    },
    checks: [],
    review: null,
    archive: { outcome: "pending", path: null },
    finish: { outcome: "pending", result: null, summary: null },
  };
  const codes = new Set(validateProgress(document).map((issue) => issue.code));
  assert(codes.has("unknown-completed-task"));
});

test("does not verify a ledger with pending tasks", async () => {
  const document = await fixture("valid-single.yaml");
  document.交付状态 = "verified";
  document.任务映射 = [{ id: "task-1", status: "pending" }];
  document.证据索引 = {
    apply: {
      kind: "apply",
      command: "apply task-1",
      exit_code: 0,
      checked_at: "2026-08-20T10:00:00+08:00",
      summary: "实现 task-1",
      completed_tasks: [],
    },
    checks: [{
      kind: "check",
      command: "npm test",
      exit_code: 0,
      commit: "abc123",
      checked_at: "2026-08-20T10:01:00+08:00",
      summary: "测试通过",
    }],
    review: null,
    archive: { outcome: "pending", path: null },
    finish: { outcome: "pending", result: null, summary: null },
  };
  const codes = new Set(validateProgress(document).map((issue) => issue.code));
  assert(codes.has("incomplete-task-mapping"));
});

test("accepts an isolated single-person requirement ledger", async () => {
  assert.deepEqual(validateProgress(await fixture("valid-single.yaml")), []);
});

test("requires evidence before a multi-repository ledger can enter coding", async () => {
  const document = await fixture("valid-single.yaml");
  document.协作.模式 = "independent";
  document.仓库 = [
    { id: "frontend", root: "apps/web", branch: "feature/story-1001-web", worktree: ".worktrees/story-1001-web" },
    { id: "backend", root: "services/api", branch: "feature/story-1001-api", worktree: ".worktrees/story-1001-api" },
  ];
  assert(validateProgress(document).some((issue) => issue.code === "missing-repository-evidence"));
});

test("requires successful apply and check evidence for every registered repository", async () => {
  const document = await fixture("valid-single.yaml");
  document.协作.模式 = "independent";
  document.仓库 = [
    { id: "frontend", root: "apps/web", branch: "feature/web", worktree: ".worktrees/web" },
    { id: "backend", root: "services/api", branch: "feature/api", worktree: ".worktrees/api" },
  ];
  document.证据索引.apply = [{
    repository_id: "frontend",
    kind: "apply",
    command: "apply frontend",
    exit_code: 0,
    checked_at: "2026-08-20T10:00:00+08:00",
    summary: "frontend 完成",
  }];
  document.交付状态 = "coding";
  const codingCodes = new Set(validateProgress(document).map((issue) => issue.code));
  assert(codingCodes.has("missing-repository-evidence"));

  document.证据索引.apply.push({
    repository_id: "backend",
    kind: "apply",
    command: "apply backend",
    exit_code: 0,
    checked_at: "2026-08-20T10:01:00+08:00",
    summary: "backend 完成",
  });
  document.交付状态 = "verified";
  document.证据索引.checks = [{
    repository_id: "frontend",
    kind: "check",
    command: "check frontend",
    exit_code: 0,
    commit: "abc123",
    checked_at: "2026-08-20T10:02:00+08:00",
    summary: "frontend 通过",
  }];
  const verifiedCodes = new Set(validateProgress(document).map((issue) => issue.code));
  assert(verifiedCodes.has("missing-repository-evidence"));
});

test("accepts multi-repository evidence bundled in a repositories array", async () => {
  const document = await fixture("valid-single.yaml");
  document.协作.模式 = "independent";
  document.仓库 = [
    { id: "frontend", root: "apps/web", branch: "feature/web", worktree: ".worktrees/web" },
    { id: "backend", root: "services/api", branch: "feature/api", worktree: ".worktrees/api" },
  ];
  const evidence = (kind, repository_id) => ({
    repository_id,
    kind,
    command: `${kind} ${repository_id}`,
    exit_code: 0,
    commit: "abc123",
    checked_at: "2026-08-20T10:00:00+08:00",
    summary: `${repository_id} ${kind} passed`,
  });
  document.交付状态 = "verified";
  document.证据索引.apply = { repositories: [evidence("apply", "frontend"), evidence("apply", "backend")] };
  document.证据索引.checks = { repositories: [evidence("check", "frontend"), evidence("check", "backend")] };
  assert(!validateProgress(document).some((issue) => issue.code === "missing-repository-evidence"));
});

test("rejects bundled evidence with missing or unknown repository ids", async () => {
  const document = await fixture("valid-single.yaml");
  document.协作.模式 = "independent";
  document.仓库 = [
    { id: "frontend", root: "apps/web", branch: "feature/web", worktree: ".worktrees/web" },
    { id: "backend", root: "services/api", branch: "feature/api", worktree: ".worktrees/api" },
  ];
  document.证据索引.apply = { repositories: [{ kind: "apply", command: "apply", exit_code: 0, commit: "abc", checked_at: "now", summary: "bad" }, { repository_id: "unknown", kind: "apply", command: "apply", exit_code: 0, commit: "abc", checked_at: "now", summary: "bad" }] };
  assert(validateProgress(document).some((issue) => issue.code === "missing-repository-evidence" || issue.code === "unknown-repository-evidence"));
});

test("rejects evidence for an unknown repository", async () => {
  const document = await fixture("valid-single.yaml");
  document.证据索引.apply = [{
    repository_id: "unknown",
    kind: "apply",
    command: "apply unknown",
    exit_code: 0,
    checked_at: "2026-08-20T10:00:00+08:00",
    summary: "未知仓库",
  }];
  const codes = new Set(validateProgress(document).map((issue) => issue.code));
  assert(codes.has("unknown-repository-evidence"));
});

test("rejects removed collaboration fields and invalid repository entries", async () => {
  const document = await fixture("valid-single.yaml");
  document.协作.参与人 = [];
  document.并行单元 = [];
  document.协作.集成分支 = "main";
  document.仓库 = [
    { id: "repo", root: ".", branch: "same", worktree: ".same" },
    { id: "repo", root: ".", branch: "same", worktree: ".same" },
  ];
  const codes = new Set(validateProgress(document).map((issue) => issue.code));
  assert(codes.has("unsupported-collaboration-field"));
  assert(codes.has("duplicate-repository-id"));
  assert(codes.has("duplicate-repository-branch"));
  assert(codes.has("duplicate-repository-worktree"));
});

test("rejects a legacy V3 shared progress file until it is split", async () => {
  const codes = await issueCodes("invalid-schema-v3.yaml");
  assert(codes.has("unsupported-schema-version"));
  assert(codes.has("legacy-shared-ledger"));
});


test("rejects closed flows whose delivery state disagrees with finish evidence", async () => {
  const document = await fixture("valid-single.yaml");
  document.流程状态 = "closed";
  document.交付状态 = "coding";
  document.证据索引.archive = { outcome: "completed", path: "archive/story-1001" };
  document.证据索引.finish = { outcome: "completed", result: "merged" };
  assert(
    validateProgress(document).some(
      (issue) => issue.code === "closed-delivery-mismatch",
    ),
  );
});

test("allows explore and propose before a branch or worktree exists", async () => {
  const document = await fixture("valid-single.yaml");
  document.交付状态 = "not-started";
  document.推荐动作 = "propose";
  document.协作.分支 = null;
  document.协作.工作区 = null;
  assert(
    !validateProgress(document).some(
      (issue) => issue.code === "missing-workspace-isolation",
    ),
  );
});

test("flags stale recommended actions after implementation has started", async () => {
  for (const status of ["coding", "verified", "reviewed"]) {
    for (const action of ["prepare-workspace", "propose"]) {
      const document = await fixture("valid-single.yaml");
      document.交付状态 = status;
      document.推荐动作 = action;
      assert(
        validateProgress(document).some(
          (issue) => issue.code === "recommended-action-stale",
        ),
        `${status} + ${action} should be flagged as stale`,
      );
    }
  }
});

test("accepts recommended actions that match the delivery stage", async () => {
  const implementing = await fixture("valid-single.yaml");
  assert(
    !validateProgress(implementing).some(
      (issue) => issue.code === "recommended-action-stale",
    ),
  );

  const early = await fixture("valid-single.yaml");
  early.交付状态 = "not-started";
  early.推荐动作 = "propose";
  assert(
    !validateProgress(early).some(
      (issue) => issue.code === "recommended-action-stale",
    ),
  );

  const empty = await fixture("valid-single.yaml");
  empty.推荐动作 = null;
  assert(
    !validateProgress(empty).some(
      (issue) => issue.code === "recommended-action-stale",
    ),
  );
});

test("rejects coding ledgers without an approved proposal decision", async () => {
  const document = await fixture("valid-single.yaml");
  document.用户决策 = [];

  assert(
    validateProgress(document).some(
      (issue) => issue.code === "missing-proposal-confirmation",
    ),
  );
});

test("rejects coding without an approved implementation-start decision in validation and advancement", async () => {
  const document = await fixture("valid-single.yaml");
  document.用户决策 = [
    { kind: "proposal-confirmation", outcome: "approved" },
  ];
  assert(
    validateProgress(document).some(
      (issue) => issue.code === "missing-implementation-start-approval",
    ),
  );

  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-implementation-approval-"));
  const file = path.join(directory, "story-1001.yaml");
  const source = (await fixtureSource("valid-single.yaml"))
    .replace(
      '  - kind: implementation-start\n    outcome: approved\n    actor: "requester"\n    at: "2026-08-11T10:00:00+08:00"\n',
      "",
    )
    .replace(
      "交付状态: coding",
      "交付状态: not-started",
    );
  await writeFile(file, source);

  assert.throws(
    () => advanceProgress(file, "coding", {
      kind: "apply",
      command: "openspec apply story-1001",
      exit_code: 0,
      checked_at: "2026-08-20T09:00:00+08:00",
      summary: "实现已开始",
    }, "alice", { reconcile: false }),
    /missing-implementation-start-approval/,
  );
});


test("directory validation detects duplicate branches, worktrees, and active conflict keys", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-v4-"));
  const first = await fixtureSource("valid-single.yaml");
  const second = first
    .replaceAll("story-1001", "story-1002")
    .replace('负责人: "alice"', '负责人: "bob"')
    .replace('updated_by: "alice"', 'updated_by: "bob"')
    .replace('branch: "feature/story-1002"', 'branch: "feature/story-1001"')
    .replace('worktree: ".worktrees/story-1002"', 'worktree: ".worktrees/story-1001"')
    .replace("冲突键: []", '冲突键:\n  - "db:migration"');
  const firstWithConflict = first.replace(
    "冲突键: []",
    '冲突键:\n  - "db:migration"',
  );
  await writeFile(path.join(directory, "story-1001.yaml"), firstWithConflict);
  await writeFile(path.join(directory, "story-1002.yaml"), second);

  const codes = new Set(
    (await validateProgressDirectory(directory)).map((issue) => issue.code),
  );
  assert(codes.has("duplicate-branch"));
  assert(codes.has("duplicate-worktree"));
  assert(codes.has("active-conflict-key"));
});

test("directory validation detects duplicate identifiers, change ids, dependency cycles, and normalized scope overlap", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-v41-"));
  const first = await fixtureSource("valid-single.yaml");
  const second = first
    .replace('编号: "story-1001"', '编号: "story-1002"')
    .replace('分支: "feature/story-1001"', '分支: "feature/story-1002"')
    .replace('工作区: ".worktrees/story-1001"', '工作区: ".worktrees/story-1002"')
    .replace("依赖需求: []", '依赖需求:\n  - "story-1001"')
    .replace('  - "src/search/"', '  - "./src/search/api/"');
  const firstCyclic = first.replace(
    "依赖需求: []",
    '依赖需求:\n  - "story-1002"',
  );
  await writeFile(path.join(directory, "a.yaml"), firstCyclic);
  await writeFile(path.join(directory, "b.yaml"), second);
  const codes = new Set(
    (await validateProgressDirectory(directory)).map((issue) => issue.code),
  );
  assert(codes.has("duplicate-change-id"));
  assert(codes.has("requirement-dependency-cycle"));
  assert(codes.has("requirement-write-scope-conflict"));
});

test("ledger lock prevents concurrent writers and commits revision atomically", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-lock-"));
  const file = path.join(directory, "story-1001.yaml");
  await writeFile(file, await fixtureSource("valid-single.yaml"));
  const lock = acquireLedgerLock(file, "alice");
  assert.throws(() => acquireLedgerLock(file, "bob"), /已被锁定/);
  const result = commitLedgerLock(file, lock.token);
  assert.equal(result.revision, 2);
  assert.equal(parseProgressYaml(await readFile(file, "utf8")).revision, 2);
});

test("ledger commit rejects a delivery-state jump without a transition record", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-transition-"));
  const file = path.join(directory, "story-1001.yaml");
  const source = await fixtureSource("valid-single.yaml");
  await writeFile(file, source);

  const lock = acquireLedgerLock(file, "alice");
  await writeFile(file, source.replace("交付状态: coding", "交付状态: ready"));

  assert.throws(
    () => commitLedgerLock(file, lock.token),
    /invalid-delivery-transition/,
  );
  assert.equal((await readFile(file, "utf8")).includes("交付状态: ready"), true);
});

test("ledger commit rejects verified state without successful check evidence", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-evidence-"));
  const file = path.join(directory, "story-1001.yaml");
  const source = await fixtureSource("valid-single.yaml");
  await writeFile(file, source);

  const lock = acquireLedgerLock(file, "alice");
  await writeFile(file, source.replace("交付状态: coding", "交付状态: verified"));

  assert.throws(
    () => commitLedgerLock(file, lock.token),
    /missing-transition-event|missing-verification-evidence/,
  );
});

test("advance command applies a verified transition with check evidence", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-advance-"));
  const file = path.join(directory, "story-1001.yaml");
  const evidenceFile = path.join(directory, "check.json");
  await writeFile(file, await fixtureSource("valid-single.yaml"));
  await writeFile(
    evidenceFile,
    JSON.stringify({
      kind: "check",
      command: "node --test",
      exit_code: 0,
      commit: "abc123",
      checked_at: "2026-08-13T11:00:00+08:00",
      summary: "目标测试通过",
    }),
  );

  assert.doesNotThrow(() => {
    execFileSync(
      process.execPath,
      [
        "sprint-manage-xiaoqi/scripts/advance-progress.mjs",
        file,
        "verified",
        evidenceFile,
        "alice",
      ],
      { cwd: repoRoot, stdio: "pipe" },
    );
  });

  const advanced = parseProgressYaml(await readFile(file, "utf8"));
  assert.equal(advanced.交付状态, "verified");
  assert.equal(advanced.证据索引.checks.length, 1);
  assert.equal(advanced.revision, 2);
});

test("advance command maps completed apply tasks onto the ledger", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-task-map-"));
  const file = path.join(directory, "story-1001.yaml");
  const source = (await fixtureSource("valid-single.yaml"))
    .replace("交付状态: coding", "交付状态: not-started")
    .replace("证据索引:\n", "任务映射:\n  - id: task-1\n    status: pending\n证据索引:\n");
  await writeFile(file, source);

  advanceProgress(file, "coding", {
    kind: "apply",
    command: "openspec apply story-1001",
    exit_code: 0,
    checked_at: "2026-08-20T09:00:00+08:00",
    summary: "task-1 已完成",
    completed_tasks: ["task-1"],
  }, "alice", { reconcile: false });

  const advanced = parseProgressYaml(await readFile(file, "utf8"));
  assert.equal(advanced.任务映射[0].status, "completed");
  assert.deepEqual(advanced.证据索引.apply.completed_tasks, ["task-1"]);
});

test("advance command records successful apply evidence when coding starts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-coding-"));
  const file = path.join(directory, "story-1001.yaml");
  const source = (await fixtureSource("valid-single.yaml")).replace(
    "交付状态: coding",
    "交付状态: not-started",
  );
  await writeFile(file, source);

  advanceProgress(
    file,
    "coding",
    {
      kind: "apply",
      command: "openspec apply story-1001",
      exit_code: 0,
      checked_at: "2026-08-20T09:00:00+08:00",
      summary: "实现已开始",
    },
    "alice",
    { reconcile: false },
  );

  const advanced = parseProgressYaml(await readFile(file, "utf8"));
  assert.equal(advanced.交付状态, "coding");
  assert.equal(advanced.证据索引.apply.kind, "apply");
  assert.equal(advanced.事件日志.at(-1).evidence_kind, "apply");
});

test("advance to coding is rejected when reconciliation reports inconsistency", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-reconcile-reject-"));
  const file = path.join(directory, "story-1001.yaml");
  const source = (await fixtureSource("valid-single.yaml")).replace(
    "交付状态: coding",
    "交付状态: not-started",
  );
  await writeFile(file, source);

  assert.throws(
    () => advanceProgress(
      file,
      "coding",
      {
        kind: "apply",
        command: "openspec apply story-1001",
        exit_code: 0,
        checked_at: "2026-08-20T09:00:00+08:00",
        summary: "实现已开始",
      },
      "alice",
      {
        reconcile: () => ({
          outcome: "inconsistent",
          issues: [
            { repository_id: "main", code: "worktree-missing", message: "工作区目录不存在" },
          ],
        }),
      },
    ),
    /worktree-missing/,
  );

  assert.equal(parseProgressYaml(await readFile(file, "utf8")).交付状态, "not-started");
  assert.equal(existsSync(`${file}.lock`), false);
});

test("advance to coding proceeds when injected reconciliation reports consistency", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-reconcile-pass-"));
  const file = path.join(directory, "story-1001.yaml");
  const source = (await fixtureSource("valid-single.yaml")).replace(
    "交付状态: coding",
    "交付状态: not-started",
  );
  await writeFile(file, source);

  advanceProgress(
    file,
    "coding",
    {
      kind: "apply",
      command: "openspec apply story-1001",
      exit_code: 0,
      checked_at: "2026-08-20T09:00:00+08:00",
      summary: "实现已开始",
    },
    "alice",
    { reconcile: () => ({ outcome: "consistent", issues: [] }) },
  );

  const advanced = parseProgressYaml(await readFile(file, "utf8"));
  assert.equal(advanced.交付状态, "coding");
});

test("advance API enforces the complete evidence chain", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-chain-"));
  const file = path.join(directory, "story-1001.yaml");
  await writeFile(file, await fixtureSource("valid-single.yaml"));

  const check = {
    kind: "check",
    command: "node --test",
    exit_code: 0,
    commit: "abc123",
    checked_at: "2026-08-13T11:00:00+08:00",
    summary: "目标测试通过",
  };
  const review = {
    kind: "review",
    command: "code-review",
    exit_code: 0,
    commit: "abc123",
    checked_at: "2026-08-13T11:01:00+08:00",
    summary: "评审通过",
    result: "approved",
  };
  const openspec = {
    kind: "openspec-verify",
    command: "openspec verify",
    exit_code: 0,
    commit: "abc123",
    checked_at: "2026-08-13T11:02:00+08:00",
    summary: "规格一致",
    result: "passed",
  };
  const finish = {
    kind: "finish",
    command: "git status",
    exit_code: 0,
    commit: "abc123",
    checked_at: "2026-08-13T11:03:00+08:00",
    summary: "PR 已创建",
    result: "pr-open",
    outcome: "completed",
  };

  advanceProgress(file, "verified", check, "alice");
  advanceProgress(file, "reviewed", review, "alice");
  advanceProgress(file, "ready", openspec, "alice");
  advanceProgress(file, "pr-open", finish, "alice");

  const completed = parseProgressYaml(await readFile(file, "utf8"));
  assert.equal(completed.交付状态, "pr-open");
  assert.equal(completed.证据索引.review.result, "approved");
  assert.equal(completed.证据索引.openspec_verify.result, "passed");
  assert.equal(completed.证据索引.finish.result, "pr-open");
  assert.equal(completed.事件日志.length, 4);
  assert.equal(completed.revision, 5);
});

test("failed advance leaves the ledger unchanged and releases its lock", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-failed-"));
  const file = path.join(directory, "story-1001.yaml");
  await writeFile(file, await fixtureSource("valid-single.yaml"));
  const before = await readFile(file, "utf8");

  assert.throws(() =>
    advanceProgress(
      file,
      "verified",
      {
        kind: "check",
        command: "node --test",
        exit_code: 1,
        commit: "abc123",
        checked_at: "2026-08-13T11:00:00+08:00",
        summary: "测试失败",
      },
      "alice",
    ),
    /exit_code 必须为 0/,
  );

  assert.equal(await readFile(file, "utf8"), before);
  assert.equal(existsSync(`${file}.lock`), false);
});

test("keeps colons inside quoted sequence scalars", () => {
  assert.deepEqual(parseProgressYaml('items:\n  - "api:orders"\n'), {
    items: ["api:orders"],
  });
});

test("treats a colon without following whitespace as part of an unquoted sequence scalar", () => {
  assert.deepEqual(parseProgressYaml("items:\n  - api:orders\n"), {
    items: ["api:orders"],
  });
});

test("rejects duplicate keys in a sequence mapping even when the first value is nested", () => {
  assert.throws(
    () => parseProgressYaml("items:\n  - details:\n      name: first\n    details:\n      name: second\n"),
    /键“details”重复/,
  );
});

test("rejects duplicate keys inside a sequence item", () => {
  assert.throws(
    () => parseProgressYaml("并行单元:\n  - id: T01\n    id: T02\n"),
    /键“id”重复/,
  );
});

test("keeps ledger and collaboration details in their focused references", async () => {
  const skill = await readFile(path.join(skillDir, "SKILL.md"), "utf8");
  const state = await readFile(
    path.join(skillDir, "references", "state-contract.md"),
    "utf8",
  );
  assert.match(
    skill,
    /新建、恢复、查看需求；账本或状态问题[\s\S]*references\/state-contract\.md/,
  );
  assert.match(state, /~\/\.xiaoqi\/sprint-manage\//);
  assert.match(state, /-v1\.yaml/);
  assert.match(state, /账本锁与版本/);
  assert.match(state, /ledger-lock\.mjs/);
  assert.match(state, /不创建、不读取 `session\.yaml`/);
  assert.match(state, /单个需求可以登记多个仓库/);
  assert.doesNotMatch(state, /shared-change|并行单元/);
});

test("public documentation explains collaboration conflict prevention", async (context) => {
  const descriptionPath = path.join(
    repoRoot,
    "description",
    "skills",
    "sprint-manage-xiaoqi.md",
  );
  if (!existsSync(descriptionPath)) {
    context.skip("public documentation is only available in the source repository");
    return;
  }
  const description = await readFile(descriptionPath, "utf8");
  assert.match(description, /多人并行/);
  assert.match(description, /独立.*branch.*worktree/s);
  assert.match(description, /依赖循环|写入范围冲突/);
});

test("advance command prints the evidence schema template for --schema", () => {
  const output = JSON.parse(
    execFileSync(
      process.execPath,
      ["sprint-manage-xiaoqi/scripts/advance-progress.mjs", "--schema", "apply"],
      { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
    ),
  );

  assert.equal(output.kind, "apply");
  assert.deepEqual(output.required, [
    "kind",
    "command",
    "exit_code",
    "checked_at",
    "summary",
  ]);
  assert.deepEqual(Object.keys(output.template), output.required);
  assert.equal(output.template.exit_code, 0);
});

test("advance command covers every supported evidence kind with complete templates", () => {
  const expected = {
    apply: ["kind", "command", "exit_code", "checked_at", "summary"],
    check: ["kind", "command", "exit_code", "commit", "checked_at", "summary"],
    review: ["kind", "command", "exit_code", "commit", "checked_at", "summary", "result"],
    "openspec-verify": ["kind", "command", "exit_code", "commit", "checked_at", "summary", "result"],
    finish: ["kind", "command", "exit_code", "commit", "checked_at", "summary", "result", "outcome"],
    archive: ["kind", "command", "exit_code", "checked_at", "summary", "path", "outcome"],
  };

  for (const [kind, requiredFields] of Object.entries(expected)) {
    const output = JSON.parse(
      execFileSync(
        process.execPath,
        ["sprint-manage-xiaoqi/scripts/advance-progress.mjs", "--schema", kind],
        { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
      ),
    );
    assert.deepEqual(output.required, requiredFields, `${kind} 必需字段清单`);
    for (const field of requiredFields) {
      assert.ok(output.template[field] !== undefined, `${kind} 模板缺字段 ${field}`);
    }
    assert.equal(output.constraints.exit_code, 0);
    if (kind === "review") assert.equal(output.constraints.result, "approved");
    if (kind === "openspec-verify") assert.equal(output.constraints.result, "passed");
    if (kind === "finish") assert.deepEqual(output.constraints.outcome, ["passed", "completed", "archived"]);
    if (kind === "archive") assert.deepEqual(output.constraints.outcome, ["passed", "completed", "archived"]);
  }
});

test("advance command rejects --schema for an unsupported kind", () => {
  let failure;
  try {
    execFileSync(
      process.execPath,
      ["sprint-manage-xiaoqi/scripts/advance-progress.mjs", "--schema", "deploy"],
      { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
    );
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, "非法 kind 必须以非零退出码失败");
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /apply.*check.*review.*openspec-verify.*finish.*archive/);
});

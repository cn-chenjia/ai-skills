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
const repoRoot = path.resolve(skillDir, "..", "..");

async function fixtureSource(name) {
  return readFile(path.join(testDir, "fixtures", name), "utf8");
}

async function fixture(name) {
  return parseProgressYaml(await fixtureSource(name));
}

async function issueCodes(name) {
  return new Set(validateProgress(await fixture(name)).map((issue) => issue.code));
}

test("accepts an isolated single-person requirement ledger", async () => {
  assert.deepEqual(validateProgress(await fixture("valid-single.yaml")), []);
});

test("accepts a shared change with independent collaboration lanes", async () => {
  assert.deepEqual(validateProgress(await fixture("valid-shared.yaml")), []);
});

test("rejects a V3 shared progress file until it is split", async () => {
  const codes = await issueCodes("invalid-schema-v3.yaml");
  assert(codes.has("unsupported-schema-version"));
  assert(codes.has("legacy-shared-ledger"));
});

test("rejects shared changes with missing integration data, dependency cycles, and scope overlap", async () => {
  const codes = await issueCodes("invalid-shared.yaml");
  assert(codes.has("missing-integration-branch"));
  assert(codes.has("lane-dependency-cycle"));
  assert(codes.has("lane-write-scope-conflict"));
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

test("directory validation detects duplicate branches, worktrees, and active conflict keys", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-v4-"));
  const first = await fixtureSource("valid-single.yaml");
  const second = first
    .replaceAll("story-1001", "story-1002")
    .replace('负责人: "alice"', '负责人: "bob"')
    .replace('updated_by: "alice"', 'updated_by: "bob"')
    .replace('分支: "feature/story-1002"', '分支: "feature/story-1001"')
    .replace('工作区: ".worktrees/story-1002"', '工作区: ".worktrees/story-1001"')
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
        "skills/sprint-manage-xiaoqi/scripts/advance-progress.mjs",
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
    /missing-verification-evidence/,
  );

  assert.equal(await readFile(file, "utf8"), before);
  assert.equal(existsSync(`${file}.lock`), false);
});

test("keeps colons inside quoted sequence scalars", () => {
  assert.deepEqual(parseProgressYaml('items:\n  - "api:orders"\n'), {
    items: ["api:orders"],
  });
});

test("rejects duplicate keys inside a sequence item", () => {
  assert.throws(
    () => parseProgressYaml("并行单元:\n  - id: T01\n    id: T02\n"),
    /键“id”重复/,
  );
});

test("documents isolated ledgers, local sessions, and single-writer ownership", async () => {
  const skill = await readFile(path.join(skillDir, "SKILL.md"), "utf8");
  const contract = await readFile(
    path.join(skillDir, "references", "state-contract.md"),
    "utf8",
  );
  assert.match(skill, /requirements\/<id>\.yaml/);
  assert.match(skill, /单写者/);
  assert.match(contract, /local\/session\.yaml.*不提交/s);
  assert.doesNotMatch(contract, /当前需求:/);
});

test("documents multi-requirement and large shared-change workflows", async () => {
  const details = await readFile(
    path.join(skillDir, "references", "step-details.md"),
    "utf8",
  );
  assert.match(details, /单人并行多个需求/);
  assert.match(details, /多人分别开发多个需求/);
  assert.match(details, /大型需求多人分工/);
  assert.match(details, /集成分支/);
  assert.match(details, /write_scope/);
});

test("public documentation explains collaboration conflict prevention", async () => {
  const description = await readFile(
    path.join(repoRoot, "description", "skills", "sprint-manage-xiaoqi.md"),
    "utf8",
  );
  assert.match(description, /多人并行/);
  assert.match(description, /独立.*branch.*worktree/s);
  assert.match(description, /依赖循环|写入范围冲突/);
});

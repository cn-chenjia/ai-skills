import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseProgressYaml } from "../scripts/validate-progress.mjs";
import { getRequirementPath } from "../scripts/ledger-paths.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(testDir, "..");
const initializeScript = path.join(
  skillDir,
  "scripts",
  "initialize-requirement.mjs",
);
const closeScript = path.join(skillDir, "scripts", "close-requirement.mjs");
const advanceScript = path.join(skillDir, "scripts", "advance-progress.mjs");

function runScript(script, args, cwd) {
  const homeDir = path.join(cwd, ".test-home");
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
  });
}

// 构造一份已关闭、交付状态 kept、archive/finish 证据齐全的 v1 账本
async function writeClosedKeptLedger(ledgerPath) {
  const source = (await readFile(
    path.join(testDir, "fixtures", "valid-single.yaml"),
    "utf8",
  )).replace(/\r\n/g, "\n");
  const closedSource = source
    .replace("revision: 1", "revision: 5")
    .replace("流程状态: active", "流程状态: closed")
    .replace("交付状态: coding", "交付状态: kept")
    .replace(
      "  archive:\n    outcome: pending\n    path: null",
      '  archive:\n    kind: "archive"\n    command: "openspec archive"\n    exit_code: 0\n    checked_at: "2026-08-20T10:00:00+08:00"\n    outcome: completed\n    path: "openspec/changes/archive/story-1001"',
    )
    .replace(
      "  finish:\n    outcome: pending\n    result: null\n    summary: null",
      '  finish:\n    kind: "finish"\n    command: "git status"\n    exit_code: 0\n    commit: "abc123"\n    checked_at: "2026-08-20T10:00:00+08:00"\n    outcome: completed\n    result: kept\n    summary: "本地保留"',
    );
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  await writeFile(ledgerPath, closedSource);
  return closedSource;
}

const REOPEN_ARGS = [
  "story-1001",
  "用户搜索",
  "story-1001-user-search",
  "alice",
  "requester",
];

test("initializes the first tracked requirement before implementation", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-init-"));

  const result = runScript(
    initializeScript,
    [
      projectRoot,
      "story-66102",
      "特殊作业复核单按设备判定",
      "story-66102-special-operation-review",
      "alice",
      "requester",
    ],
    projectRoot,
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  const ledgerPath = JSON.parse(result.stdout).ledger;
  assert.equal(
    ledgerPath,
    getRequirementPath(projectRoot, "story-66102", path.join(projectRoot, ".test-home")),
  );
  assert.equal(path.resolve(output.ledger), ledgerPath);
  assert.equal(output.recommendedNext, "prepare-workspace");
  assert.equal(existsSync(ledgerPath), true);
  assert.equal(output.ledger, ledgerPath);

  const ledger = parseProgressYaml(await readFile(ledgerPath, "utf8"));
  assert.equal(ledger.schema_version, 4);
  assert.equal(ledger.编号, "story-66102");
  assert.equal(ledger.change_id, "story-66102-special-operation-review");
  assert.equal(ledger.流程状态, "active");
  assert.equal(ledger.交付状态, "not-started");
  assert.equal(ledger.推荐动作, "prepare-workspace");
  assert.deepEqual(ledger.协作, { 模式: "single", 负责人: "alice" });
  assert.equal(ledger.用户决策.at(-1).kind, "requirement-intake");
  assert.equal(ledger.用户决策.at(-1).outcome, "accepted");
  assert.equal(ledger.用户决策.some((decision) => decision.kind === "proposal-confirmation"), false);
  assert.deepEqual(ledger.仓库, [
    { id: "main", root: projectRoot, branch: null, worktree: null },
  ]);
  assert.equal(existsSync(path.join(projectRoot, "sprint-manage")), false);
});

test("does not overwrite an existing requirement ledger", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-init-existing-"));
  const args = [
    projectRoot,
    "story-66102",
    "特殊作业复核单按设备判定",
    "story-66102-special-operation-review",
    "alice",
    "requester",
  ];
  const first = runScript(initializeScript, args, projectRoot);
  assert.equal(first.status, 0, first.stderr);

  const ledgerPath = JSON.parse(first.stdout).ledger;
  const original = await readFile(ledgerPath, "utf8");
  await writeFile(ledgerPath, original.replace("revision: 1", "revision: 7"));

  const repeated = runScript(initializeScript, args, projectRoot);

  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(JSON.parse(repeated.stdout).outcome, "existing");
  assert.match(await readFile(ledgerPath, "utf8"), /revision: 7/);
});

test("does not backfill proposal confirmation for an older unconfirmed ledger", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-init-confirm-"));
  const args = [
    projectRoot,
    "story-66102",
    "特殊作业复核单按设备判定",
    "story-66102-special-operation-review",
    "alice",
    "requester",
  ];
  const first = runScript(initializeScript, args, projectRoot);
  assert.equal(first.status, 0, first.stderr);

  const ledgerPath = JSON.parse(first.stdout).ledger;
  const source = await readFile(ledgerPath, "utf8");
  await writeFile(
    ledgerPath,
    source.replace(
      /用户决策:\n(?: {2,}.*\n)+阻塞项:/,
      "用户决策: []\n阻塞项:",
    ),
  );

  const repeated = runScript(initializeScript, args, projectRoot);

  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(JSON.parse(repeated.stdout).outcome, "existing");
  const ledger = parseProgressYaml(await readFile(ledgerPath, "utf8"));
  assert.equal(ledger.用户决策.length, 0);
  assert.equal(ledger.revision, 1);
  assert.equal(ledger.推荐动作, "prepare-workspace");
});

test("closes a requirement only after archive and finish evidence exist", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-close-"));
  const ledgerPath = path.join(directory, "story-1001.yaml");
  const source = (await readFile(
    path.join(testDir, "fixtures", "valid-single.yaml"),
    "utf8",
  )).replace(/\r\n/g, "\n");
  const finalSource = source
    .replace('流程状态: "active"', '流程状态: "active"')
    .replace("交付状态: coding", "交付状态: kept")
    .replace(
      "  archive:\n    outcome: pending\n    path: null",
      '  archive:\n    kind: "archive"\n    command: "openspec archive"\n    exit_code: 0\n    checked_at: "2026-08-20T10:00:00+08:00"\n    outcome: completed\n    path: "openspec/changes/archive/story-1001"',
    )
    .replace(
      "  finish:\n    outcome: pending\n    result: null\n    summary: null",
      '  finish:\n    kind: "finish"\n    command: "git status"\n    exit_code: 0\n    commit: "abc123"\n    checked_at: "2026-08-20T10:00:00+08:00"\n    outcome: completed\n    result: kept\n    summary: "本地保留"',
    );
  await writeFile(ledgerPath, finalSource);

  const result = runScript(closeScript, [ledgerPath, "alice"], directory);

  assert.equal(result.status, 0, result.stderr);
  const closed = parseProgressYaml(await readFile(ledgerPath, "utf8"));
  assert.equal(closed.流程状态, "closed");
  assert.equal(closed.交付状态, "kept");
  assert.equal(closed.事件日志.at(-1).kind, "workflow-closed");
});

test("refreshes intent fields to terminal semantics after closing", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-close-intent-"));
  const ledgerPath = path.join(directory, "story-1001.yaml");
  const source = (await readFile(
    path.join(testDir, "fixtures", "valid-single.yaml"),
    "utf8",
  )).replace(/\r\n/g, "\n");
  const finalSource = source
    .replace("交付状态: coding", "交付状态: kept")
    .replace(
      "  archive:\n    outcome: pending\n    path: null",
      '  archive:\n    kind: "archive"\n    command: "openspec archive"\n    exit_code: 0\n    checked_at: "2026-08-20T10:00:00+08:00"\n    outcome: completed\n    path: "openspec/changes/archive/story-1001"',
    )
    .replace(
      "  finish:\n    outcome: pending\n    result: null\n    summary: null",
      '  finish:\n    kind: "finish"\n    command: "git status"\n    exit_code: 0\n    commit: "abc123"\n    checked_at: "2026-08-20T10:00:00+08:00"\n    outcome: completed\n    result: kept\n    summary: "本地保留"',
    );
  await writeFile(ledgerPath, finalSource);
  const before = parseProgressYaml(await readFile(ledgerPath, "utf8"));
  assert.match(before.当前意图, /实施|实现/);
  assert.equal(before.推荐动作, "apply");

  const result = runScript(closeScript, [ledgerPath, "alice"], directory);

  assert.equal(result.status, 0, result.stderr);
  const closed = parseProgressYaml(await readFile(ledgerPath, "utf8"));
  assert.equal(closed.流程状态, "closed");
  assert.equal(closed.当前意图, "需求已关闭");
  assert.equal(closed.推荐动作, null);
});

test("does not create or update a local session when closing a requirement", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-close-session-"));
  const ledgerPath = path.join(directory, "sprint-manage", "requirements", "story-1001.yaml");
  const source = (await readFile(
    path.join(testDir, "fixtures", "valid-single.yaml"),
    "utf8",
  )).replace(/\r\n/g, "\n");
  const closable = source
    .replace("交付状态: coding", "交付状态: kept")
    .replace(
      "  archive:\n    outcome: pending\n    path: null",
      '  archive:\n    kind: "archive"\n    command: "openspec archive"\n    exit_code: 0\n    checked_at: "2026-08-20T10:00:00+08:00"\n    outcome: completed\n    path: "openspec/changes/archive/story-1001"',
    )
    .replace(
      "  finish:\n    outcome: pending\n    result: null\n    summary: null",
      '  finish:\n    kind: "finish"\n    command: "git status"\n    exit_code: 0\n    commit: "abc123"\n    checked_at: "2026-08-20T10:00:00+08:00"\n    outcome: completed\n    result: kept\n    summary: "本地保留"',
    );
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  await writeFile(ledgerPath, closable, "utf8");
  await mkdir(path.join(directory, "sprint-manage", "local"), { recursive: true });
  await writeFile(
    path.join(directory, "sprint-manage", "local", "session.yaml"),
    '当前用户: "alice"\n当前需求: "story-1001"\n',
  );

  const result = runScript(closeScript, [ledgerPath, "alice"], directory);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(path.join(directory, "sprint-manage", "local", "session.yaml")), true);
  assert.doesNotMatch(
    await readFile(path.join(directory, "sprint-manage", "local", "session.yaml"), "utf8"),
    /会话状态: "closed"/,
  );
});

test("rejects archive evidence without a successful exit code", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-close-invalid-archive-"));
  const ledgerPath = path.join(directory, "story-1001.yaml");
  const source = (await readFile(path.join(testDir, "fixtures", "valid-single.yaml"), "utf8"))
    .replace("交付状态: coding", "交付状态: kept")
    .replace(
      "  archive:\n    outcome: pending\n    path: null",
      '  archive:\n    kind: "archive"\n    command: "openspec archive"\n    exit_code: 1\n    checked_at: "2026-08-20T10:00:00+08:00"\n    outcome: completed\n    path: "openspec/changes/archive/story-1001"',
    )
    .replace(
      "  finish:\n    outcome: pending\n    result: null\n    summary: null",
      '  finish:\n    kind: "finish"\n    command: "git status"\n    exit_code: 0\n    commit: "abc123"\n    checked_at: "2026-08-20T10:00:00+08:00"\n    outcome: completed\n    result: kept\n    summary: "本地保留"',
    );
  await writeFile(ledgerPath, source);

  const result = runScript(closeScript, [ledgerPath, "alice"], directory);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /close-not-ready|missing-archive-evidence/);
});

test("rejects finish evidence whose result disagrees with delivery state", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-close-invalid-finish-"));
  const ledgerPath = path.join(directory, "story-1001.yaml");
  const source = (await readFile(path.join(testDir, "fixtures", "valid-single.yaml"), "utf8"))
    .replace("交付状态: coding", "交付状态: kept")
    .replace(
      "  archive:\n    outcome: pending\n    path: null",
      '  archive:\n    kind: "archive"\n    command: "openspec archive"\n    exit_code: 0\n    checked_at: "2026-08-20T10:00:00+08:00"\n    outcome: completed\n    path: "openspec/changes/archive/story-1001"',
    )
    .replace(
      "  finish:\n    outcome: pending\n    result: null\n    summary: null",
      '  finish:\n    kind: "finish"\n    command: "git status"\n    exit_code: 0\n    commit: "abc123"\n    checked_at: "2026-08-20T10:00:00+08:00"\n    outcome: completed\n    result: merged\n    summary: "已合并"',
    );
  await writeFile(ledgerPath, source);

  const result = runScript(closeScript, [ledgerPath, "alice"], directory);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /close-not-ready|closed-delivery-mismatch/);
});

test("keeps the workflow active when close evidence is incomplete", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-close-invalid-"));
  const ledgerPath = path.join(directory, "story-1001.yaml");
  await writeFile(
    ledgerPath,
    await readFile(path.join(testDir, "fixtures", "valid-single.yaml"), "utf8"),
  );
  const before = await readFile(ledgerPath, "utf8");

  const result = runScript(closeScript, [ledgerPath, "alice"], directory);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /close-not-ready/);
  assert.equal(await readFile(ledgerPath, "utf8"), before);
  assert.equal(existsSync(`${ledgerPath}.lock`), false);
});

test("rejects closing an already closed requirement again", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-close-repeat-"));
  const ledgerPath = path.join(directory, "story-1001.yaml");
  const source = (await readFile(
    path.join(testDir, "fixtures", "valid-single.yaml"),
    "utf8",
  )).replace(/\r\n/g, "\n");
  const closedSource = source
    .replace("流程状态: active", "流程状态: closed")
    .replace("交付状态: coding", "交付状态: kept")
    .replace(
      "  archive:\n    outcome: pending\n    path: null",
      '  archive:\n    kind: "archive"\n    command: "openspec archive"\n    exit_code: 0\n    checked_at: "2026-08-20T10:00:00+08:00"\n    outcome: completed\n    path: "openspec/changes/archive/story-1001"',
    )
    .replace(
      "  finish:\n    outcome: pending\n    result: null\n    summary: null",
      '  finish:\n    outcome: completed\n    result: kept\n    summary: "本地保留"',
    );
  await writeFile(ledgerPath, closedSource);

  const result = runScript(closeScript, [ledgerPath, "alice"], directory);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /workflow-closed/);
  assert.equal(await readFile(ledgerPath, "utf8"), closedSource);
});

test("reopens a closed requirement into an evidence-inheriting next version", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-reopen-"));
  const requirementsDir = path.join(
    projectRoot,
    ".test-home",
    ".xiaoqi",
    "sprint-manage",
  );
  const v1Path = path.join(requirementsDir, "story-1001-v1.yaml");
  await writeClosedKeptLedger(v1Path);

  const result = runScript(
    initializeScript,
    [projectRoot, ...REOPEN_ARGS, "--reopen-from", v1Path],
    projectRoot,
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.outcome, "reopened");
  assert.equal(output.recommendedNext, "finish");
  const archivedPath = path.join(requirementsDir, "archive", "story-1001-v1.yaml");
  assert.equal(output.archivedLedger, archivedPath);
  const v2Path = output.ledger;
  assert.equal(existsSync(v2Path), true);
  assert.equal(existsSync(archivedPath), true);
  assert.equal(existsSync(v1Path), false);

  const v2 = parseProgressYaml(await readFile(v2Path, "utf8"));
  assert.equal(v2.版本, 2);
  assert.equal(v2.流程状态, "active");
  assert.equal(v2.交付状态, "ready");
  assert.equal(v2.推荐动作, "finish");
  assert.equal(v2.前序版本, archivedPath);
  assert.equal(v2.change_id, "story-1001-user-search");
  assert.equal(v2.证据索引.finish.outcome, "pending");
  assert.equal(v2.证据索引.finish.result, null);
  assert.equal(v2.证据索引.archive.outcome, "completed");
  assert.equal(v2.证据索引.archive.path, "openspec/changes/archive/story-1001");
  assert.equal(v2.用户决策.at(-1).kind, "finish-reopen");
  assert.equal(v2.用户决策.at(-1).previous_result, "kept");
  assert.equal(v2.用户决策.some((decision) => decision.kind === "proposal-confirmation"), true);
  assert.equal(v2.事件日志.at(-1).kind, "requirement-reopened");
  assert.equal(v2.事件日志.at(-1).previous_delivery_status, "kept");
  assert.deepEqual(v2.仓库[0].branch, "feature/story-1001");

  const archived = parseProgressYaml(await readFile(archivedPath, "utf8"));
  assert.equal(archived.流程状态, "closed");
  assert.equal(archived.交付状态, "kept");
  assert.equal(archived.事件日志.at(-1).kind, "ledger-archived");
  assert.equal(archived.事件日志.at(-1).successor, path.basename(v2Path));
});

test("reopened requirement records new finish and closes without replaying evidence", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-reopen-close-"));
  const requirementsDir = path.join(
    projectRoot,
    ".test-home",
    ".xiaoqi",
    "sprint-manage",
  );
  const v1Path = path.join(requirementsDir, "story-1001-v1.yaml");
  await writeClosedKeptLedger(v1Path);
  const reopened = runScript(
    initializeScript,
    [projectRoot, ...REOPEN_ARGS, "--reopen-from", v1Path],
    projectRoot,
  );
  assert.equal(reopened.status, 0, reopened.stderr);
  const v2Path = JSON.parse(reopened.stdout).ledger;

  const evidencePath = path.join(projectRoot, "finish-evidence.json");
  await writeFile(
    evidencePath,
    JSON.stringify({
      kind: "finish",
      command: "git push origin feature/story-1001",
      exit_code: 0,
      commit: "def456",
      checked_at: "2026-08-21T10:00:00+08:00",
      summary: "PR 已合并，删除本地与远端分支",
      result: "merged",
      outcome: "completed",
    }),
  );
  const advance = runScript(
    advanceScript,
    [v2Path, "merged", evidencePath, "requester"],
    projectRoot,
  );
  assert.equal(advance.status, 0, advance.stderr);

  const close = runScript(closeScript, [v2Path, "alice"], projectRoot);
  assert.equal(close.status, 0, close.stderr);
  const closed = parseProgressYaml(await readFile(v2Path, "utf8"));
  assert.equal(closed.流程状态, "closed");
  assert.equal(closed.交付状态, "merged");
  assert.equal(closed.证据索引.finish.result, "merged");
});

test("rejects reopening an unclosed or mismatched ledger", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-reopen-bad-"));
  const requirementsDir = path.join(
    projectRoot,
    ".test-home",
    ".xiaoqi",
    "sprint-manage",
  );
  const v1Path = path.join(requirementsDir, "story-1001-v1.yaml");
  await writeClosedKeptLedger(v1Path);

  // 身份不匹配（change_id 不同）
  const mismatch = runScript(
    initializeScript,
    [
      projectRoot,
      "story-1001",
      "用户搜索",
      "story-1001-other-change",
      "alice",
      "requester",
      "--reopen-from",
      v1Path,
    ],
    projectRoot,
  );
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, /身份不匹配/);
  assert.equal(existsSync(v1Path), true);

  // 未关闭（active）账本不能重开
  const activeSource = (await readFile(
    path.join(testDir, "fixtures", "valid-single.yaml"),
    "utf8",
  )).replace(/\r\n/g, "\n")
    .replace('编号: "story-1001"', '编号: "story-2002"')
    .replace('change_id: "story-1001-user-search"', 'change_id: "story-2002-user-search"');
  const activePath = path.join(requirementsDir, "story-2002-v1.yaml");
  await mkdir(requirementsDir, { recursive: true });
  await writeFile(activePath, activeSource);
  const unclosed = runScript(
    initializeScript,
    [
      projectRoot,
      "story-2002",
      "用户搜索",
      "story-2002-user-search",
      "alice",
      "requester",
      "--reopen-from",
      activePath,
    ],
    projectRoot,
  );
  assert.equal(unclosed.status, 1);
  assert.match(unclosed.stderr, /closed/);
  assert.equal(existsSync(activePath), true);
});

test("does not reopen twice from an already archived ledger", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-reopen-twice-"));
  const requirementsDir = path.join(
    projectRoot,
    ".test-home",
    ".xiaoqi",
    "sprint-manage",
  );
  const v1Path = path.join(requirementsDir, "story-1001-v1.yaml");
  await writeClosedKeptLedger(v1Path);
  const first = runScript(
    initializeScript,
    [projectRoot, ...REOPEN_ARGS, "--reopen-from", v1Path],
    projectRoot,
  );
  assert.equal(first.status, 0, first.stderr);
  const archivedPath = path.join(requirementsDir, "archive", "story-1001-v1.yaml");

  const second = runScript(
    initializeScript,
    [projectRoot, ...REOPEN_ARGS, "--reopen-from", archivedPath],
    projectRoot,
  );

  assert.equal(second.status, 1);
  assert.match(second.stderr, /archive 目录/);
  assert.equal(existsSync(archivedPath), true);
  const v2Path = JSON.parse(first.stdout).ledger;
  assert.equal(existsSync(v2Path), true);
});

test("continues version numbering from archived ledgers when initializing again", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-version-"));
  const requirementsDir = path.join(
    projectRoot,
    ".test-home",
    ".xiaoqi",
    "sprint-manage",
  );
  const v1Path = path.join(requirementsDir, "story-1001-v1.yaml");
  await writeClosedKeptLedger(v1Path);
  const reopened = runScript(
    initializeScript,
    [projectRoot, ...REOPEN_ARGS, "--reopen-from", v1Path],
    projectRoot,
  );
  assert.equal(reopened.status, 0, reopened.stderr);
  const v2Path = JSON.parse(reopened.stdout).ledger;

  // 已归档 v1 + 主目录 v2 时，同需求新版本应从 v3 继续，而不是回退
  const third = runScript(
    initializeScript,
    [
      projectRoot,
      "story-1001",
      "用户搜索",
      "story-1001-next-change",
      "alice",
      "requester",
    ],
    projectRoot,
  );

  assert.equal(third.status, 0, third.stderr);
  assert.equal(path.basename(JSON.parse(third.stdout).ledger), "story-1001-v3.yaml");
  assert.equal(existsSync(v2Path), true);
});

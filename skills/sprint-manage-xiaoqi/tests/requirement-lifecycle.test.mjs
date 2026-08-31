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

function runScript(script, args, cwd) {
  const homeDir = path.join(cwd, ".test-home");
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
  });
}

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
  assert.equal(output.recommendedNext, "apply");
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

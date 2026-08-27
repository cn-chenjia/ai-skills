import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseProgressYaml } from "../scripts/validate-progress.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(testDir, "..");
const initializeScript = path.join(skillDir, "scripts", "initialize-requirement.mjs");
const closeScript = path.join(skillDir, "scripts", "close-requirement.mjs");
const cancelScript = path.join(skillDir, "scripts", "cancel-requirement.mjs");
function runScript(script, args, cwd, contextRoot = cwd) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", env: { ...process.env, XIAOQI_OPENSPEC_CONTEXT_JSON: JSON.stringify({ rootPath: contextRoot, source: contextRoot === cwd ? "nearest" : "declared", storeId: contextRoot === cwd ? undefined : "team-plans", role: "openspec_root" }) } });
}
function approvedSource(source) {
  return source.replace("交付状态: coding", "交付状态: kept").replace("  archive:\n    outcome: pending\n    path: null", '  archive:\n    outcome: completed\n    path: "openspec/changes/archive/story-1001"').replace("  finish:\n    outcome: pending\n    result: null\n    summary: null", '  finish:\n    kind: "finish"\n    command: "git status"\n    exit_code: 0\n    commit: "abc123"\n    checked_at: "2026-08-20T10:00:00+08:00"\n    outcome: completed\n    result: kept\n    summary: "本地保留"');
}

test("cancels a requirement with a reason without requiring delivery evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-cancel-"));
  const ledgerPath = path.join(root, "story-cancel.yaml");
  await writeFile(ledgerPath, (await readFile(path.join(testDir, "fixtures", "valid-single.yaml"), "utf8"))
    .replaceAll("story-1001", "story-cancel"));

  const result = runScript(cancelScript, [ledgerPath, "alice", "scope no longer needed"], root);
  assert.equal(result.status, 0, result.stderr);
  const ledger = parseProgressYaml(await readFile(ledgerPath, "utf8"));
  assert.equal(ledger.流程状态, "cancelled");
  assert.equal(ledger.当前意图, "需求已取消");
  assert.equal(ledger.推荐动作, null);
  assert.equal(ledger.事件日志.at(-1).kind, "workflow-cancelled");
  assert.equal(ledger.事件日志.at(-1).reason, "scope no longer needed");
});

test("rejects cancelling a requirement without a reason", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-cancel-empty-"));
  const ledgerPath = path.join(root, "story-cancel.yaml");
  await writeFile(ledgerPath, (await readFile(path.join(testDir, "fixtures", "valid-single.yaml"), "utf8"))
    .replaceAll("story-1001", "story-cancel"));

  const result = runScript(cancelScript, [ledgerPath, "alice", ""], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /取消原因不能为空/);
});

test("initializes the first tracked requirement before implementation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-init-"));
  const result = runScript(initializeScript, [root, "story-66102", "特殊作业复核单按设备判定", "story-66102-special-operation-review", "alice", "requester"], root);
  assert.equal(result.status, 0, result.stderr);
  const ledgerPath = path.join(root, "sprint-manage", "requirements", "story-66102.yaml");
  assert.equal(path.resolve(JSON.parse(result.stdout).ledger), ledgerPath);
  const ledger = parseProgressYaml(await readFile(ledgerPath, "utf8"));
  assert.equal(ledger.用户决策.at(-1).actor, "requester");
  assert.equal(ledger.规划.类型, "project");
});

test("does not overwrite an existing requirement ledger", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-init-existing-"));
  const args = [root, "story-66102", "测试", "story-66102-change", "alice", "requester"];
  const first = runScript(initializeScript, args, root); const ledger = JSON.parse(first.stdout).ledger;
  await writeFile(ledger, (await readFile(ledger, "utf8")).replace("revision: 1", "revision: 7"));
  const repeated = runScript(initializeScript, args, root);
  assert.equal(repeated.status, 0); assert.equal(JSON.parse(repeated.stdout).outcome, "existing"); assert.match(await readFile(ledger, "utf8"), /revision: 7/);
});

test("backfills proposal confirmation for an older unconfirmed ledger", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-init-confirm-"));
  const args = [root, "story-66102", "测试", "story-66102-change", "alice", "requester"];
  const first = runScript(initializeScript, args, root); const ledger = JSON.parse(first.stdout).ledger;
  const source = await readFile(ledger, "utf8"); await writeFile(ledger, source.replace(/用户决策:\n(?: {2,}.*\n)+阻塞项:/, "用户决策: []\n阻塞项:"));
  const repeated = runScript(initializeScript, args, root); assert.equal(repeated.status, 0); assert.equal(JSON.parse(repeated.stdout).outcome, "confirmed");
});

test("initializes a pointer repository requirement in the OpenSpec Store root", async () => {
  const pointer = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-pointer-")); const store = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-store-"));
  const result = runScript(initializeScript, [pointer, "story-store", "跨仓库需求", "story-store-change", "alice", "requester"], pointer, store);
  assert.equal(result.status, 0, result.stderr); const ledger = JSON.parse(result.stdout).ledger;
  assert.equal(path.resolve(ledger), path.join(store, "sprint-manage", "requirements", "story-store.yaml")); assert.equal(existsSync(path.join(pointer, "sprint-manage")), false);
  const document = parseProgressYaml(await readFile(ledger, "utf8")); assert.equal(document.规划.类型, "store"); assert.equal(document.规划.store_id, "team-plans");
});

test("closes a requirement only after archive and finish evidence exist", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-close-")); const ledger = path.join(root, "story-1001.yaml");
  const source = await readFile(path.join(testDir, "fixtures", "valid-single.yaml"), "utf8"); await writeFile(ledger, approvedSource(source));
  const result = runScript(closeScript, [ledger, "alice"], root); assert.equal(result.status, 0, result.stderr); assert.equal(parseProgressYaml(await readFile(ledger, "utf8")).流程状态, "closed");
});

test("does not create or update local session state when closing a requirement", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-close-session-")); const ledger = path.join(root, "sprint-manage", "requirements", "story-1001.yaml");
  const source = await readFile(path.join(testDir, "fixtures", "valid-single.yaml"), "utf8"); await mkdir(path.dirname(ledger), { recursive: true }); await writeFile(ledger, approvedSource(source));
  const result = runScript(closeScript, [ledger, "alice"], root); assert.equal(result.status, 0, result.stderr); assert.equal(existsSync(path.join(root, "sprint-manage", "local", "session.yaml")), false);
});

test("keeps the workflow active when close evidence is incomplete", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-close-invalid-")); const ledger = path.join(root, "story-1001.yaml"); const source = await readFile(path.join(testDir, "fixtures", "valid-single.yaml"), "utf8"); await writeFile(ledger, source);
  const result = runScript(closeScript, [ledger, "alice"], root); assert.equal(result.status, 1); assert.match(result.stderr, /close-not-ready/); assert.equal(existsSync(`${ledger}.lock`), false);
});

test("rejects closing an already closed requirement again", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-close-repeat-")); const ledger = path.join(root, "story-1001.yaml"); const source = await readFile(path.join(testDir, "fixtures", "valid-single.yaml"), "utf8"); const closed = approvedSource(source).replace("流程状态: active", "流程状态: closed"); await writeFile(ledger, closed);
  const result = runScript(closeScript, [ledger, "alice"], root); assert.equal(result.status, 1); assert.match(result.stderr, /workflow-closed/); assert.equal(await readFile(ledger, "utf8"), closed);
});

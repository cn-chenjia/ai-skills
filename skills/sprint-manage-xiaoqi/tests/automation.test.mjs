import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifyRequest,
} from "../scripts/request-routing.mjs";
import {
  compareRecommendedAction,
  resolveNextAction,
} from "../scripts/action-resolver.mjs";
import {
  createCommandExecutor,
} from "../scripts/action-executor.mjs";
import {
  startAutomation,
} from "../scripts/start-automation.mjs";
import {
  runUntilReady,
} from "../scripts/auto-runner.mjs";
import { parseProgressYaml } from "../scripts/validate-progress.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(testDir, "..");
const fixturePath = path.resolve(testDir, "fixtures", "valid-single.yaml");
const automationScript = path.resolve(skillDir, "scripts", "start-automation.mjs");

async function createLedger() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-auto-"));
  const file = path.join(directory, "story-1001.yaml");
  await writeFile(file, await readFile(fixturePath, "utf8"));
  return file;
}

function evidence(kind, result = undefined) {
  return {
    kind,
    command: `xiaoqi-${kind}`,
    exit_code: 0,
    commit: "abc123",
    checked_at: "2026-08-14T10:00:00+08:00",
    summary: `${kind} passed`,
    ...(result ? { result } : {}),
  };
}

function deliveryStatus(document) {
  return document["交付状态"];
}

test("classifies a clear low-risk request as auto-confirmed", () => {
  const result = classifyRequest({
    text: "修复订单查询为空时的报错",
    acceptanceCriteria: ["空结果返回正常提示"],
    changedFiles: ["src/order/query.js"],
  });

  assert.equal(result.status, "auto-confirmed");
  assert.equal(result.skipExplore, true);
  assert.deepEqual(result.reasons, []);
});

test("routes ambiguous or high-risk requests to explore", () => {
  const result = classifyRequest({
    text: "增加供应商审批流程",
    changedFiles: ["db/migrations/001.sql", "src/api/supplier.ts"],
    riskFlags: ["database", "public-api"],
  });

  assert.equal(result.status, "needs-explore");
  assert.equal(result.skipExplore, false);
  assert.ok(result.reasons.length >= 2);
});

test("waits for implementation approval after the workspace is prepared", () => {
  const base = {
    交付状态: "not-started",
    用户决策: [
      { kind: "proposal-confirmation", outcome: "approved" },
    ],
    仓库: [{ id: "main", root: ".", branch: "feature/story-1001", worktree: ".worktrees/story-1001" }],
  };

  assert.deepEqual(resolveNextAction(base), null);
  assert.deepEqual(resolveNextAction({
    ...base,
    用户决策: [
      ...base.用户决策,
      { kind: "implementation-start", outcome: "approved" },
    ],
  }), {
    name: "apply",
    targetStatus: "coding",
  });
});

test("resolves the next evidence gate from the delivery status", () => {
  assert.deepEqual(resolveNextAction({ 交付状态: "not-started" }), {
    name: "prepare-workspace",
    targetStatus: "not-started",
  });
  assert.deepEqual(resolveNextAction({ 交付状态: "coding" }), {
    name: "check",
    targetStatus: "verified",
  });
  assert.deepEqual(resolveNextAction({ 交付状态: "verified" }), {
    name: "review",
    targetStatus: "reviewed",
  });
  assert.deepEqual(resolveNextAction({ 交付状态: "reviewed" }), {
    name: "openspec-verify",
    targetStatus: "ready",
  });
  assert.equal(resolveNextAction({ 交付状态: "ready" }), null);
});

test("compares the ledger recommended action with the resolved action", () => {
  const consistent = compareRecommendedAction({
    交付状态: "not-started",
    推荐动作: "prepare-workspace",
    仓库: [{ id: "main", root: "." }],
  });
  assert.equal(consistent.consistent, true);
  assert.equal(consistent.code, null);
  assert.equal(consistent.ledger, "prepare-workspace");
  assert.deepEqual(consistent.resolved, {
    name: "prepare-workspace",
    targetStatus: "not-started",
  });

  const readyToApply = compareRecommendedAction({
    交付状态: "not-started",
    推荐动作: "apply",
    用户决策: [
      { kind: "proposal-confirmation", outcome: "approved" },
      { kind: "implementation-start", outcome: "approved" },
    ],
    仓库: [{ id: "main", root: ".", branch: "feature/story-1001", worktree: ".worktrees/story-1001" }],
  });
  assert.equal(readyToApply.consistent, true);
  assert.equal(readyToApply.code, null);
});

test("reports a mismatch when the ledger action disagrees with the real state", () => {
  const mismatch = compareRecommendedAction({
    交付状态: "coding",
    推荐动作: "apply",
  });
  assert.equal(mismatch.consistent, false);
  assert.equal(mismatch.code, "recommended-action-mismatch");
  assert.equal(mismatch.ledger, "apply");
  assert.deepEqual(mismatch.resolved, { name: "check", targetStatus: "verified" });

  const premature = compareRecommendedAction({
    交付状态: "not-started",
    推荐动作: "apply",
    仓库: [{ id: "main", root: "." }],
  });
  assert.equal(premature.consistent, false);
  assert.equal(premature.code, "recommended-action-mismatch");
  assert.equal(premature.resolved.name, "prepare-workspace");
});

test("treats an empty ledger recommended action as consistent", () => {
  for (const ledger of [null, undefined]) {
    const result = compareRecommendedAction({ 交付状态: "coding", 推荐动作: ledger });
    assert.equal(result.consistent, true);
    assert.equal(result.code, null);
    assert.equal(result.ledger, ledger ?? null);
  }
});

test("starts apply through the automation executor instead of manual stepping", async () => {
  const ledgerPath = await createLedger();
  const calls = [];
  const source = await readFile(ledgerPath, "utf8");
  await writeFile(ledgerPath, source
    .replace("交付状态: coding", "交付状态: not-started")
    .replace("推荐动作: apply", "推荐动作: apply")
    .replace("  - kind: proposal-confirmation\n    outcome: approved", "  - kind: proposal-confirmation\n    outcome: approved\n  - kind: implementation-start\n    outcome: approved"));

  const result = await runUntilReady({
    ledgerPath,
    owner: "alice",
    reconcile: false,
    compareRecommendedAction: false,
    executeAction: async (action) => {
      calls.push(action.name);
      if (action.name === "apply") {
        return {
          kind: "apply",
          command: "apply",
          exit_code: 0,
          commit: "abc123",
          checked_at: "2026-08-17T10:00:00+08:00",
          summary: "实现任务已完成",
        };
      }
      if (action.name === "check") return evidence("check");
      if (action.name === "review") return evidence("review", "approved");
      return evidence("openspec-verify", "passed");
    },
  });

  assert.equal(result.status, "ready");
  assert.deepEqual(calls, ["apply", "check", "review", "openspec-verify"]);
});

test("reconciles the ledger against Git before advancing to coding", async () => {
  const ledgerPath = await createLedger();
  const reconciled = [];
  const source = await readFile(ledgerPath, "utf8");
  await writeFile(ledgerPath, source.replace("交付状态: coding", "交付状态: not-started"));

  const result = await runUntilReady({
    ledgerPath,
    owner: "alice",
    compareRecommendedAction: false,
    reconcile: (target) => {
      reconciled.push(target);
      return { outcome: "consistent", issues: [] };
    },
    executeAction: async (action) => {
      if (action.name === "apply") {
        return {
          kind: "apply",
          command: "apply",
          exit_code: 0,
          commit: "abc123",
          checked_at: "2026-08-17T10:00:00+08:00",
          summary: "实现任务已完成",
        };
      }
      if (action.name === "check") return evidence("check");
      if (action.name === "review") return evidence("review", "approved");
      return evidence("openspec-verify", "passed");
    },
  });

  assert.equal(result.status, "ready");
  assert.deepEqual(reconciled, [ledgerPath]);
});

test("includes configured completed tasks in apply evidence", async () => {
  const executor = createCommandExecutor({
    projectRoot: process.cwd(),
    commands: {
      apply: {
        command: process.execPath,
        args: ["-e", "process.stdout.write('apply ok')"],
        completed_tasks: ["task-1"],
      },
    },
  });

  const result = await executor({ name: "apply", targetStatus: "coding" });

  assert.deepEqual(result.completed_tasks, ["task-1"]);
});

test("includes repository_id in evidence for a configured repository action", async () => {
  const executor = createCommandExecutor({
    projectRoot: process.cwd(),
    commands: { check: { command: process.execPath, args: ["-e", ""] } },
  });
  const result = await executor({ name: "check", targetStatus: "verified", repository_id: "backend" });
  assert.equal(result.repository_id, "backend");
});

test("aggregates configured commands for all repositories into evidence", async () => {
  const executor = createCommandExecutor({
    projectRoot: process.cwd(),
    repositories: [{ id: "frontend" }, { id: "backend" }],
    commands: {
      check: { command: process.execPath, args: ["-e", ""] },
    },
  });
  const result = await executor({ name: "check", targetStatus: "verified" });
  assert.equal(result.repositories.length, 2);
  assert.deepEqual(result.repositories.map((item) => item.repository_id), ["frontend", "backend"]);
});


test("executes each repository command in its worktree and reports its revision", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-repositories-"));
  const repositories = [];
  for (const id of ["frontend", "backend"]) {
    const root = path.join(directory, id);
    spawnSync("git", ["init", root], { encoding: "utf8" });
    spawnSync("git", ["-C", root, "config", "user.email", "test@example.com"], { encoding: "utf8" });
    spawnSync("git", ["-C", root, "config", "user.name", "Test"], { encoding: "utf8" });
    await writeFile(path.join(root, `${id}.txt`), id);
    spawnSync("git", ["-C", root, "add", "."], { encoding: "utf8" });
    spawnSync("git", ["-C", root, "commit", "-m", "init"], { encoding: "utf8" });
    repositories.push({ id, root });
  }

  const executor = createCommandExecutor({
    projectRoot: directory,
    repositories,
    commands: {
      check: { command: process.execPath, args: ["-e", "process.stdout.write(process.cwd())"] },
    },
  });
  const result = await executor({ name: "check", targetStatus: "verified" });

  assert.deepEqual(result.repositories.map((item) => item.summary), repositories.map((repo) => path.resolve(repo.root)));
  assert.deepEqual(result.repositories.map((item) => item.commit), repositories.map((repo) => spawnSync("git", ["-C", repo.root, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim()));
});

test("supports repository worktree as the preferred command cwd", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-worktrees-"));
  const root = path.join(directory, "repo");
  const worktree = path.join(directory, "worktree");
  spawnSync("git", ["init", root], { encoding: "utf8" });
  spawnSync("git", ["-C", root, "config", "user.email", "test@example.com"], { encoding: "utf8" });
  spawnSync("git", ["-C", root, "config", "user.name", "Test"], { encoding: "utf8" });
  await writeFile(path.join(root, "file.txt"), "init");
  spawnSync("git", ["-C", root, "add", "."], { encoding: "utf8" });
  spawnSync("git", ["-C", root, "commit", "-m", "init"], { encoding: "utf8" });
  spawnSync("git", ["-C", root, "worktree", "add", "-b", "feature", worktree], { encoding: "utf8" });

  const executor = createCommandExecutor({
    projectRoot: directory,
    repositories: [{ id: "repo", root, worktree }],
    commands: { check: { command: process.execPath, args: ["-e", "process.stdout.write(process.cwd())"] } },
  });
  const result = await executor({ name: "check", targetStatus: "verified", repository_id: "repo" });

  assert.equal(result.summary, path.resolve(worktree));
  assert.equal(result.commit, spawnSync("git", ["-C", worktree, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim());
});


test("records aggregated repositories evidence into apply and check indexes", async () => {
  const ledgerPath = await createLedger();
  const { recordEvidence } = await import("../scripts/record-evidence.mjs");
  await recordEvidence(ledgerPath, {
    kind: "apply",
    repositories: [
      { repository_id: "main", kind: "apply", command: "apply main", exit_code: 0, checked_at: "2026-08-20T10:00:00+08:00", summary: "main 完成" },
    ],
  }, "alice");
  const document = parseProgressYaml(await readFile(ledgerPath, "utf8"));
  assert.equal(document.证据索引.apply.repositories[0].repository_id, "main");
});


test("runs the default resolver and configured executor to ready", async () => {
  const ledgerPath = await createLedger();
  const projectRoot = path.dirname(path.dirname(ledgerPath));
  await mkdir(path.join(projectRoot, ".xiaoqi"), { recursive: true });
  await writeFile(
    path.join(projectRoot, ".xiaoqi", "actions.json"),
    JSON.stringify({
      actions: {
        check: {
          command: process.execPath,
          args: ["-e", "process.stdout.write('check ok')"],
        },
        review: {
          command: process.execPath,
          args: ["-e", "process.stdout.write('review ok')"],
          result: "approved",
        },
        "openspec-verify": {
          command: process.execPath,
          args: ["-e", "process.stdout.write('verify ok')"],
          result: "passed",
        },
      },
    }),
  );

  const result = await runUntilReady({
    ledgerPath,
    owner: "alice",
    projectRoot,
    compareRecommendedAction: false,
  });

  assert.equal(result.status, "ready");
  assert.equal(result.steps.length, 3);
});

test("starts automation directly for a clear request", async () => {
  const ledgerPath = await createLedger();
  const projectRoot = path.dirname(path.dirname(ledgerPath));
  await mkdir(path.join(projectRoot, ".xiaoqi"), { recursive: true });
  await writeFile(
    path.join(projectRoot, ".xiaoqi", "actions.json"),
    JSON.stringify({
      actions: {
        check: { command: process.execPath, args: ["-e", ""] },
        review: {
          command: process.execPath,
          args: ["-e", ""],
          result: "approved",
        },
        "openspec-verify": {
          command: process.execPath,
          args: ["-e", ""],
          result: "passed",
        },
      },
    }),
  );

  const result = await startAutomation({
    request: {
      text: "修复订单查询为空时的报错",
      acceptanceCriteria: ["空结果返回正常提示"],
      changedFiles: ["src/order/query.js"],
    },
    ledgerPath,
    owner: "alice",
    projectRoot,
    compareRecommendedAction: false,
  });

  assert.equal(result.status, "ready");
  assert.equal(result.confirmation, "auto-confirmed");
});

test("waits for explore confirmation before starting automation", async () => {
  const ledgerPath = await createLedger();

  const result = await startAutomation({
    request: {
      text: "增加供应商审批流程",
      acceptanceCriteria: [],
      changedFiles: ["db/migrations/001.sql"],
      riskFlags: ["database"],
    },
    ledgerPath,
    owner: "alice",
  });

  assert.equal(result.status, "needs-explore");
  assert.equal(result.classification.status, "needs-explore");
});

test("CLI returns non-zero and distinguishes needs-explore from needs-confirmation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-auto-cli-gates-"));
  const requestPath = path.join(directory, "request.json");
  const ledgerPath = path.join(directory, "story-1001.yaml");
  await writeFile(requestPath, JSON.stringify({
    text: "增加供应商审批流程",
    acceptanceCriteria: [],
    changedFiles: ["db/migrations/001.sql"],
    riskFlags: ["database"],
  }));
  await writeFile(ledgerPath, await readFile(fixturePath, "utf8"));

  const needsExplore = spawnSync(process.execPath, [
    automationScript, requestPath, ledgerPath, "alice", directory,
  ], { encoding: "utf8" });
  assert.notEqual(needsExplore.status, 0);
  assert.equal(JSON.parse(needsExplore.stdout).status, "needs-explore");

  const needsConfirmationLedger = path.join(directory, "story-1002.yaml");
  await writeFile(
    needsConfirmationLedger,
    (await readFile(fixturePath, "utf8")).replace("交付状态: coding", "交付状态: not-started"),
  );
  await writeFile(requestPath, JSON.stringify({
    text: "修复订单查询为空时的报错",
    acceptanceCriteria: ["空结果返回正常提示"],
    changedFiles: ["src/order/query.js"],
  }));

  const needsConfirmation = spawnSync(process.execPath, [
    automationScript, requestPath, needsConfirmationLedger, "alice", directory,
  ], { encoding: "utf8" });
  assert.notEqual(needsConfirmation.status, 0);
  assert.equal(JSON.parse(needsConfirmation.stdout).status, "needs-confirmation");
});

test("runs evidence-driven actions until the ledger reaches ready", async () => {
  const ledgerPath = await createLedger();
  const actions = [];

  const result = await runUntilReady({
    ledgerPath,
    owner: "alice",
    compareRecommendedAction: false,
    resolveNextAction(document) {
      const status = deliveryStatus(document);
      if (status === "coding") return { name: "check", targetStatus: "verified" };
      if (status === "verified") return { name: "review", targetStatus: "reviewed" };
      if (status === "reviewed") {
        return { name: "openspec-verify", targetStatus: "ready" };
      }
      return null;
    },
    async executeAction(action) {
      actions.push(action.name);
      if (action.name === "check") return evidence("check");
      if (action.name === "review") return evidence("review", "approved");
      return evidence("openspec-verify", "passed");
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.outcome, "completed");
  assert.equal(result.summary, "自动化推进已到达 ready");
  assert.deepEqual(result.evidence, { kind: "openspec-verify", result: "passed" });
  assert.deepEqual(result.blockers, []);
  assert.equal(result.recommended_next, "closing");
  assert.deepEqual(actions, ["check", "review", "openspec-verify"]);
  assert.equal(deliveryStatus(parseProgressYaml(await readFile(ledgerPath, "utf8"))), "ready");
});

test("returns the common protocol when confirmation is required", async () => {
  const ledgerPath = await createLedger();

  const result = await runUntilReady({
    ledgerPath,
    owner: "alice",
    compareRecommendedAction: false,
    resolveNextAction() {
      return { name: "apply", targetStatus: "verified" };
    },
    async executeAction() {
      return {
        outcome: "needs_confirmation",
        summary: "需要确认数据库变更",
      };
    },
  });

  assert.equal(result.outcome, "needs-confirmation");
  assert.equal(result.summary, "需要确认数据库变更");
  assert.deepEqual(result.evidence, null);
  assert.deepEqual(result.blockers, ["需要确认数据库变更"]);
  assert.equal(result.recommended_next, "human-confirmation");
});

test("stops when an action needs confirmation", async () => {
  const ledgerPath = await createLedger();

  const result = await runUntilReady({
    ledgerPath,
    owner: "alice",
    compareRecommendedAction: false,
    resolveNextAction() {
      return { name: "apply", targetStatus: "verified" };
    },
    async executeAction() {
      return {
        outcome: "needs_confirmation",
        summary: "需要确认数据库变更",
      };
    },
  });

  assert.equal(result.status, "needs-confirmation");
  assert.equal(result.summary, "需要确认数据库变更");
  assert.equal(deliveryStatus(parseProgressYaml(await readFile(ledgerPath, "utf8"))), "coding");
});

test("repairs a failed check before escalating", async () => {
  const ledgerPath = await createLedger();
  const calls = [];
  let attempts = 0;

  const result = await runUntilReady({
    ledgerPath,
    owner: "alice",
    compareRecommendedAction: false,
    executeAction: async (action) => {
      calls.push(action.name);
      if (action.name === "check" && attempts++ === 0) {
        return {
          outcome: "failed",
          summary: "测试失败：空结果处理错误",
          errorCode: "test-failure",
        };
      }
      if (action.name === "check") return evidence("check");
      if (action.name === "review") return evidence("review", "approved");
      return evidence("openspec-verify", "passed");
    },
    repairAction: async (failure) => ({
      outcome: "repaired",
      summary: `已修复 ${failure.errorCode}`,
    }),
  });

  assert.equal(result.status, "ready");
  assert.deepEqual(calls, ["check", "check", "review", "openspec-verify"]);
  assert.equal(result.repairs.length, 1);
});

test("escalates after repeated identical failures", async () => {
  const ledgerPath = await createLedger();

  const result = await runUntilReady({
    ledgerPath,
    owner: "alice",
    compareRecommendedAction: false,
    maxRepairAttempts: 2,
    executeAction: async () => ({
      outcome: "failed",
      summary: "构建失败：缺少依赖",
      errorCode: "build-failure",
    }),
    repairAction: async () => ({
      outcome: "repaired",
      summary: "尝试修复依赖",
    }),
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.outcome, "blocked");
  assert.match(result.summary, /自动修复|失败/);
  assert.equal(result.evidence, null);
  assert.equal(result.blockers.length, 1);
  assert.equal(result.recommended_next, "manual-intervention");
  assert.equal(result.repairs.length, 2);
});

test("does not auto-repair high-risk review findings", async () => {
  const ledgerPath = await createLedger();
  const repairCalls = [];

  const result = await runUntilReady({
    ledgerPath,
    owner: "alice",
    compareRecommendedAction: false,
    executeAction: async () => ({
      outcome: "needs_confirmation",
      summary: "评审发现数据库迁移风险",
      reasonCode: "high-risk-review",
    }),
    repairAction: async () => {
      repairCalls.push(true);
      return { outcome: "repaired" };
    },
  });

  assert.equal(result.status, "needs-confirmation");
  assert.equal(repairCalls.length, 0);
});

test("blocks before executing when the ledger action conflicts with the real state", async () => {
  const ledgerPath = await createLedger();
  const calls = [];

  const result = await runUntilReady({
    ledgerPath,
    owner: "alice",
    async executeAction(action) {
      calls.push(action.name);
      return evidence("check");
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.outcome, "blocked");
  assert.equal(result.recommended_next, "manual-intervention");
  assert.ok(result.blockers.length >= 1);
  assert.match(result.blockers[0], /推荐动作.*冲突/);
  assert.deepEqual(calls, []);
  assert.equal(
    deliveryStatus(parseProgressYaml(await readFile(ledgerPath, "utf8"))),
    "coding",
  );
});

test("skips the recommended-action comparison when injected", async () => {
  const ledgerPath = await createLedger();

  const result = await runUntilReady({
    ledgerPath,
    owner: "alice",
    compareRecommendedAction: false,
    async executeAction(action) {
      if (action.name === "check") return evidence("check");
      if (action.name === "review") return evidence("review", "approved");
      return evidence("openspec-verify", "passed");
    },
  });

  assert.equal(result.status, "ready");
});

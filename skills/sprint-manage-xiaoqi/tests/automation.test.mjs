import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifyRequest,
} from "../scripts/request-routing.mjs";
import {
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
const fixturePath = path.resolve(testDir, "fixtures", "valid-single.yaml");

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

test("resolves the next evidence gate from the delivery status", () => {
  assert.deepEqual(resolveNextAction({ 交付状态: "not-started" }), {
    name: "apply",
    targetStatus: "coding",
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

test("starts apply through the automation executor instead of manual stepping", async () => {
  const ledgerPath = await createLedger();
  const calls = [];
  const source = await readFile(ledgerPath, "utf8");
  await writeFile(ledgerPath, source.replace("交付状态: coding", "交付状态: not-started"));

  const result = await runUntilReady({
    ledgerPath,
    owner: "alice",
    executeAction: async (action) => {
      calls.push(action.name);
      if (action.name === "apply") {
        return {
          kind: "action",
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

test("executes a configured command and returns check evidence", async () => {
  const executor = createCommandExecutor({
    projectRoot: process.cwd(),
    commands: {
      check: {
        command: process.execPath,
        args: ["-e", "process.stdout.write('check ok')"],
      },
    },
  });

  const result = await executor({ name: "check", targetStatus: "verified" });

  assert.equal(result.kind, "check");
  assert.equal(result.exit_code, 0);
  assert.match(result.summary, /check ok/);
  assert.ok(result.commit);
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

test("runs evidence-driven actions until the ledger reaches ready", async () => {
  const ledgerPath = await createLedger();
  const actions = [];

  const result = await runUntilReady({
    ledgerPath,
    owner: "alice",
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
  assert.deepEqual(actions, ["check", "review", "openspec-verify"]);
  assert.equal(deliveryStatus(parseProgressYaml(await readFile(ledgerPath, "utf8"))), "ready");
});

test("stops when an action needs confirmation", async () => {
  const ledgerPath = await createLedger();

  const result = await runUntilReady({
    ledgerPath,
    owner: "alice",
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
  assert.match(result.summary, /自动修复|失败/);
  assert.equal(result.repairs.length, 2);
});

test("does not auto-repair high-risk review findings", async () => {
  const ledgerPath = await createLedger();
  const repairCalls = [];

  const result = await runUntilReady({
    ledgerPath,
    owner: "alice",
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

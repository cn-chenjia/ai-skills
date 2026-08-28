import assert from "node:assert/strict";
import test from "node:test";

import { classifyRequest } from "../scripts/request-routing.mjs";
import { resolveNextAction } from "../scripts/action-resolver.mjs";
import { runUntilReady } from "../scripts/auto-runner.mjs";
import { startAutomation } from "../scripts/start-automation.mjs";

function evidence(kind) {
  return { kind, command: `xiaoqi-${kind}`, exit_code: 0, commit: "abc123", checked_at: "2026-08-17T10:00:00+08:00", summary: `${kind} passed` };
}

function createPlane() {
  const states = [{ deliveryStatus: "coding" }, { deliveryStatus: "verified" }, { deliveryStatus: "reviewed" }, { deliveryStatus: "ready" }];
  const actions = [
    { name: "check", targetStatus: "verified" },
    { name: "review", targetStatus: "reviewed" },
    { name: "openspec-verify", targetStatus: "ready" },
  ];
  return {
    states,
    getState: async () => states[0],
    resolveNextAction: (state) => actions[{ coding: 0, verified: 1, reviewed: 2 }[state.deliveryStatus]],
    runAction: async (action) => evidence(action.name),
    advance: async ({ targetStatus }) => {
      states[0] = { deliveryStatus: targetStatus };
    },
  };
}

test("classifies clear and risky requests", () => {
  assert.equal(classifyRequest({ text: "修复订单查询为空时的报错", acceptanceCriteria: ["空结果返回正常提示"], changedFiles: ["src/order/query.js"] }).status, "auto-confirmed");
  assert.equal(classifyRequest({ text: "增加供应商审批流程", changedFiles: ["db/migrations/001.sql"], riskFlags: ["database"] }).status, "needs-explore");
});

test("action resolver only delegates to the injected control plane", () => {
  const controlPlane = { resolveNextAction: (state) => ({ name: state.deliveryStatus, targetStatus: "next" }) };
  assert.deepEqual(resolveNextAction({ deliveryStatus: "coding" }, { controlPlane }), { name: "coding", targetStatus: "next" });
  assert.equal(resolveNextAction({ deliveryStatus: "coding" }), null);
});

test("auto-runner reads state and advances only through the control-plane runner", async () => {
  const controlPlane = createPlane();
  const calls = [];
  const result = await runUntilReady({ controlPlane, owner: "alice", executeAction: async (action) => { calls.push(action.name); return evidence(action.name); } });
  assert.equal(result.status, "ready");
  assert.deepEqual(calls, ["check", "review", "openspec-verify"]);
});

test("startAutomation injects the control-plane runner without touching ledger or YAML", async () => {
  const controlPlane = createPlane();
  const calls = { getState: 0, runAction: 0, advance: 0 };
  const runner = {
    getState: async (...args) => {
      calls.getState += 1;
      return controlPlane.getState(...args);
    },
    runAction: async (...args) => {
      calls.runAction += 1;
      return controlPlane.runAction(...args);
    },
    advance: async (...args) => {
      calls.advance += 1;
      return controlPlane.advance(...args);
    },
  };
  const result = await startAutomation({
    request: { text: "修复订单查询为空时的报错", acceptanceCriteria: ["空结果返回正常提示"], changedFiles: ["src/order/query.js"] },
    controlPlane: { runner, resolveNextAction: controlPlane.resolveNextAction },
    projectRoot: "e:/must-not-touch",
    owner: "alice",
  });
  assert.equal(result.status, "ready");
  assert.ok(calls.getState > 0);
  assert.ok(calls.runAction > 0);
  assert.ok(calls.advance > 0);
});

test("startAutomation safely blocks without a control-plane handler", async () => {
  await assert.rejects(() => startAutomation({ request: { text: "修复" }, owner: "alice" }), /control-plane-handler-missing/);
});

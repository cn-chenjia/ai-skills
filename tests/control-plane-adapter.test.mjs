import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createControlPlaneEvent,
  resolveDeliverySelection,
  resolveControlPlaneRoot,
} from "../adapters/control-plane.mjs";
import { normalizeTraeEvent, toTraeResponse } from "../skills/sprint-manage-xiaoqi/scripts/adapters/trae.mjs";
import { normalizeCodexEvent, toCodexResponse } from "../skills/sprint-manage-xiaoqi/scripts/adapters/codex.mjs";
import { normalizeGenericEvent } from "../skills/sprint-manage-xiaoqi/scripts/core/event-contract.mjs";
import { handleNormalizedEvent } from "../skills/sprint-manage-xiaoqi/scripts/core/hook-runtime.mjs";
import { createSqliteRepository } from "../infrastructure/persistence/sqlite-repository.mjs";
import { createControlPlaneRuntime } from "../infrastructure/control-plane-runtime.mjs";

test("hooks and CLI resolve the same OpenSpec planning root", () => {
  const context = JSON.stringify({
    root: { path: "E:/plans/team-plans", source: "declared", store_id: "team-plans" },
  });

  assert.deepEqual(resolveControlPlaneRoot({ cwd: "E:/workspace", contextJson: context }), {
    rootPath: "e:/plans/team-plans",
    mode: "shared",
  });
});

test("multiple deliveries require an explicit delivery ID", () => {
  assert.throws(
    () => resolveDeliverySelection({ planningRoot: "E:/plans", deliveries: ["delivery-a", "delivery-b"] }),
    (error) => error.code === "delivery-id-required",
  );
  assert.equal(
    resolveDeliverySelection({ planningRoot: "E:/plans", deliveries: ["delivery-a", "delivery-b"], deliveryId: "delivery-b" }),
    "delivery-b",
  );
});

test("control-plane events carry delivery ID and never carry a ledger path", () => {
  const event = createControlPlaneEvent({
    source: "trae",
    event: "before-action",
    cwd: "E:/workspace",
    planningRoot: "E:/plans",
    deliveryId: "delivery-a",
    action: { name: "shell" },
    ledger: "E:/workspace/.xiaoqi/story.yaml",
  });

  assert.equal(event.planningRoot, "e:/plans");
  assert.equal(event.deliveryId, "delivery-a");
  assert.equal("ledger" in event, false);
});

test("all adapters require an explicit delivery ID for multiple deliveries and never infer ledger", () => {
  for (const normalize of [normalizeTraeEvent, normalizeCodexEvent, normalizeGenericEvent]) {
    assert.throws(
      () => normalize({ event: "PreToolUse", hook_event_name: "PreToolUse", deliveries: ["a", "b"], planningRoot: "E:/plans" }),
      (error) => error.code === "delivery-id-required",
    );
    const event = normalize({ event: "before-action", hook_event_name: "PreToolUse", planningRoot: "E:/plans", deliveryId: "a", ledger: "E:/old.yaml" });
    assert.equal(event.deliveryId, "a");
    assert.equal("ledger" in event, false);
  }
});

test("unknown delivery IDs are blocked rather than guessed", () => {
  assert.throws(
    () => resolveDeliverySelection({ deliveries: ["delivery-a"], deliveryId: "missing" }),
    (error) => error.code === "delivery-id-not-found",
  );
});

test("Trae and Codex preserve allow, deny and stop response shapes", () => {
  assert.deepEqual(toTraeResponse({ decision: "allow" }), { continue: true });
  assert.equal(toTraeResponse({ decision: "deny", reason: "blocked" }).continue, false);
  assert.equal(toTraeResponse({ decision: "stop", reason: "stopped" }).continue, false);
  assert.deepEqual(toCodexResponse({ decision: "allow" }), { continue: true });
  assert.equal(toCodexResponse({ decision: "deny", reason: "blocked" }).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(toCodexResponse({ decision: "stop", reason: "stopped" }).continue, false);
});

test("production runtime assembles a SQLite-backed handler and runner", async () => {
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xiaoqi-runtime-"));
  const repository = createSqliteRepository({ planningRoot });
  repository.createRequirementAndDelivery({ id: "r1", title: "Runtime" }, { id: "d1", requirementId: "r1", phase: "implement", phaseStatus: "implementing", deliveryStatus: "coding" });
  const runtime = createControlPlaneRuntime({ planningRoot, repository, deliveryId: "d1", executeAction: async (action) => ({ kind: action.name, command: action.name, exit_code: 0, commit: "abc123", checked_at: "2026-08-28", summary: "ok" }) });
  assert.equal(runtime.handler.handleEvent({ version: 1, source: "test", event: "session-start", planningRoot,
    deliveryId: "d1" }).decision, "allow");
  assert.equal((await runtime.runner.getState()).deliveryStatus, "coding");
  repository.close();
});

test("production runtime denies invalid and unknown events without writing audit records", () => {
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xiaoqi-runtime-validation-"));
  const repository = createSqliteRepository({ planningRoot });
  repository.createRequirementAndDelivery({ id: "r1", title: "Runtime" }, { id: "d1", requirementId: "r1", phase: "implement", phaseStatus: "implementing", deliveryStatus: "coding" });
  const runtime = createControlPlaneRuntime({ planningRoot, repository, deliveryId: "d1" });
  for (const event of [
    { version: 2, source: "test", event: "session-start", deliveryId: "d1" },
    { version: 1, source: "test", event: "unknown", deliveryId: "d1" },
    { version: 1, source: "test", event: "session-start", action: "invalid", deliveryId: "d1" },
    { version: 1, source: "test", event: "session-start", action: null, deliveryId: "d1" },
    { version: 1, source: "test", event: "session-start", deliveryId: "d1", planningRoot: 42 },
  ]) {
    assert.equal(runtime.handler.handleEvent(event).decision, "deny");
  }
  assert.equal(repository.query("SELECT COUNT(*) AS count FROM audit_events")[0].count, 0);
  repository.close();
});

test("command actions with paths require non-empty write scopes and hooks deny them", async () => {
  const { assertSafeAction } = await import("../skills/sprint-manage-xiaoqi/scripts/policies/command-safety.mjs");
  for (const action of [
    { paths: ["src/file.js"] },
    { paths: ["src/file.js"], writeScopes: [] },
  ]) {
    assert.throws(() => assertSafeAction(action), /write-scope-required/);
    const result = handleNormalizedEvent({
      version: 1,
      source: "generic-json",
      event: "before-action",
      planningRoot: "e:/plans",
      deliveryId: "delivery-a",
      action,
    }, { controlPlane: { handleEvent() { throw new Error("must-not-audit"); } } });
    assert.equal(result.decision, "deny");
    assert.equal(result.reason, "write-scope-required");
  }
});

test("hook runtime denies safely without a control-plane handler", () => {
  const result = handleNormalizedEvent({
    version: 1,
    source: "generic-json",
    event: "before-action",
    planningRoot: "e:/plans",
    deliveryId: "delivery-a",
    action: { name: "shell", command: "npm test" },
  });
  assert.equal(result.decision, "deny");
  assert.match(result.reason, /control-plane-handler-missing/);
});

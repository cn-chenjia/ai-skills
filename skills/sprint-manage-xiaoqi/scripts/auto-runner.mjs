#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import process from "node:process";

import { resolveNextAction as resolveDefaultNextAction } from "./action-resolver.mjs";

const FINAL_DELIVERY_STATES = new Set(["pr-open", "merged", "kept"]);

function failureResult(action, result) {
  return {
    status: "blocked",
    summary:
      result?.summary ??
      result?.stderr ??
      result?.error ??
      `action ${action.name} failed`,
    action: action.name,
  };
}

function isSuccessfulEvidence(result) {
  const evidence = result?.evidence ?? result;
  return Boolean(
    evidence &&
      evidence.kind &&
      evidence.command &&
      evidence.exit_code === 0 &&
      evidence.commit &&
      evidence.checked_at &&
      evidence.summary,
  );
}

function isFailedResult(result) {
  return Boolean(
    result?.outcome === "blocked" ||
      result?.outcome === "failed" ||
      (result?.exit_code !== undefined && result.exit_code !== 0),
  );
}

function failureKey(action, result) {
  return [
    action.name,
    result?.errorCode ?? result?.reasonCode ?? "unknown",
    result?.summary ?? result?.stderr ?? "failed",
  ].join("|");
}

function requireControlPlane(controlPlane) {
  const runner = controlPlane?.runner ?? controlPlane;
  if (!runner || typeof runner.getState !== "function" || typeof runner.runAction !== "function") {
    throw new Error("control-plane-handler-missing");
  }
  return { ...controlPlane, ...runner };
}

export async function runUntilReady({
  owner,
  resolveNextAction,
  executeAction,
  repairAction,
  controlPlane,
  projectRoot = process.cwd(),
  commands,
  policy = {},
  maxSteps = 20,
  maxRepairAttempts = 3,
} = {}) {
  const plane = requireControlPlane(controlPlane);
  const nextActionResolver = resolveNextAction ?? ((state) => resolveDefaultNextAction(state, { controlPlane: plane }));
  const actionRunner = executeAction ?? ((action, state) => plane.runAction(action, state, { owner, projectRoot, commands, policy }));
  const steps = [];
  const repairs = [];
  const repairCounts = new Map();

  for (let index = 0; index < maxSteps; index += 1) {
    const state = await plane.getState();
    const deliveryStatus = state.deliveryStatus ?? state["交付状态"];
    const workflowStatus = state.workflowStatus ?? state["流程状态"];

    if (deliveryStatus === "ready") return { status: "ready", steps, repairs };
    if (FINAL_DELIVERY_STATES.has(deliveryStatus)) return { status: deliveryStatus, steps, repairs };
    if (workflowStatus === "blocked") return { status: "blocked", steps, repairs };

    const action = await nextActionResolver(state);
    if (!action?.name || !action?.targetStatus) {
      return { status: "needs-confirmation", summary: "unable to resolve the next action", steps, repairs };
    }

    let result;
    for (;;) {
      try {
        result = await actionRunner(action, state);
      } catch (error) {
        result = { outcome: "failed", errorCode: "executor-error", summary: error.message };
      }
      if (result?.outcome === "needs_confirmation") {
        return { status: "needs-confirmation", summary: result.summary ?? "action requires confirmation", action: action.name, steps, repairs };
      }
      if (!isFailedResult(result)) break;

      const key = failureKey(action, result);
      const attempts = repairCounts.get(key) ?? 0;
      if (typeof repairAction !== "function" || attempts >= maxRepairAttempts) {
        const blocked = failureResult(action, result);
        await plane.recordFailure?.({ action: action.name, summary: blocked.summary, owner });
        return { ...blocked, steps, repairs };
      }
      const attempt = attempts + 1;
      repairCounts.set(key, attempt);
      const repair = await repairAction({ ...result, action: action.name, attempt }, state);
      repairs.push({ action: action.name, attempt, errorCode: result?.errorCode ?? result?.reasonCode, summary: repair?.summary ?? "automatic repair attempted", outcome: repair?.outcome ?? "repaired" });
      if (repair?.outcome !== "repaired") {
        const blocked = failureResult(action, repair);
        await plane.recordFailure?.({ action: action.name, summary: blocked.summary, owner });
        return { ...blocked, steps, repairs };
      }
    }

    const evidence = result?.evidence ?? result;
    if (!isSuccessfulEvidence(result)) {
      const blocked = { status: "blocked", summary: `action ${action.name} returned incomplete evidence`, action: action.name, steps, repairs };
      await plane.recordFailure?.({ action: action.name, summary: blocked.summary, owner });
      return blocked;
    }
    if (typeof plane.advance !== "function") throw new Error("control-plane-advance-missing");
    await plane.advance({ targetStatus: action.targetStatus, evidence, owner });
    steps.push({ action: action.name, targetStatus: action.targetStatus, evidenceKind: evidence.kind });
  }

  return { status: "blocked", summary: `automatic execution exceeded ${maxSteps} steps`, steps, repairs };
}

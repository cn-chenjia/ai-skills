#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import { existsSync, readFileSync } from "node:fs";

import { advanceProgress } from "./advance-progress.mjs";
import { createCommandExecutor } from "./action-executor.mjs";
import { resolveNextAction as resolveDefaultNextAction } from "./action-resolver.mjs";
import { parseProgressYaml } from "./validate-progress.mjs";

const FINAL_DELIVERY_STATES = new Set(["pr-open", "merged", "kept"]);

function findValue(document, fragment) {
  const entry = Object.entries(document).find(([key]) => key.includes(fragment));
  return entry?.[1];
}

function currentState(filePath) {
  return parseProgressYaml(readFileSync(filePath, "utf8"));
}

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

export async function runUntilReady({
  ledgerPath,
  owner,
  resolveNextAction,
  executeAction,
  repairAction,
  projectRoot = process.cwd(),
  commands,
  policy = {},
  maxSteps = 20,
  maxRepairAttempts = 3,
} = {}) {
  if (!existsSync(ledgerPath)) {
    throw new Error(`ledger not found: ${ledgerPath}`);
  }

  const nextActionResolver = resolveNextAction ?? resolveDefaultNextAction;
  const actionExecutor =
    executeAction ??
    createCommandExecutor({ projectRoot, commands, policy });
  const steps = [];
  const repairs = [];
  const repairCounts = new Map();

  for (let index = 0; index < maxSteps; index += 1) {
    const document = currentState(ledgerPath);
    const deliveryStatus = findValue(document, "交付状态");
    const workflowStatus = findValue(document, "流程状态");

    if (deliveryStatus === "ready") return { status: "ready", steps, repairs };
    if (FINAL_DELIVERY_STATES.has(deliveryStatus)) {
      return { status: deliveryStatus, steps, repairs };
    }
    if (workflowStatus === "blocked") {
      return { status: "blocked", steps, repairs };
    }

    const action = await nextActionResolver(document);
    if (!action?.name || !action?.targetStatus) {
      return {
        status: "needs-confirmation",
        summary: "unable to resolve the next action",
        steps,
        repairs,
      };
    }

    let result;
    for (;;) {
      try {
        result = await actionExecutor(action, document);
      } catch (error) {
        result = {
          outcome: "failed",
          errorCode: "executor-error",
          summary: error.message,
        };
      }

      if (result?.outcome === "needs_confirmation") {
        return {
          status: "needs-confirmation",
          summary: result.summary ?? "action requires confirmation",
          action: action.name,
          steps,
          repairs,
        };
      }

      if (!isFailedResult(result)) break;

      const key = failureKey(action, result);
      const attempts = repairCounts.get(key) ?? 0;
      if (typeof repairAction !== "function" || attempts >= maxRepairAttempts) {
        const blocked = failureResult(action, result);
        return { ...blocked, steps, repairs };
      }

      const attempt = attempts + 1;
      repairCounts.set(key, attempt);
      const repair = await repairAction(
        { ...result, action: action.name, attempt },
        document,
      );
      repairs.push({
        action: action.name,
        attempt,
        errorCode: result?.errorCode ?? result?.reasonCode,
        summary: repair?.summary ?? "automatic repair attempted",
        outcome: repair?.outcome ?? "repaired",
      });

      if (repair?.outcome !== "repaired") {
        const blocked = failureResult(action, repair);
          return { ...blocked, steps, repairs };
      }
    }

    const evidence = result?.evidence ?? result;
    if (!isSuccessfulEvidence(result)) {
      const blocked = {
        status: "blocked",
        summary: `action ${action.name} returned incomplete evidence`,
        action: action.name,
        steps,
        repairs,
      };
      return blocked;
    }

    advanceProgress(ledgerPath, action.targetStatus, evidence, owner);
    steps.push({
      action: action.name,
      targetStatus: action.targetStatus,
      evidenceKind: evidence.kind,
    });
  }

  return {
    status: "blocked",
    summary: `automatic execution exceeded ${maxSteps} steps`,
    steps,
    repairs,
  };
}

#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import { existsSync, readFileSync } from "node:fs";

import { advanceProgress } from "./advance-progress.mjs";
import { createCommandExecutor } from "./action-executor.mjs";
import {
  compareRecommendedAction as compareDefaultRecommendedAction,
  resolveNextAction as resolveDefaultNextAction,
} from "./action-resolver.mjs";
import { parseProgressYaml } from "./validate-progress.mjs";

const FINAL_DELIVERY_STATES = new Set(["pr-open", "merged", "kept"]);

function findValue(document, fragment) {
  const entry = Object.entries(document).find(([key]) => key.includes(fragment));
  return entry?.[1];
}

function currentState(filePath) {
  return parseProgressYaml(readFileSync(filePath, "utf8"));
}

function protocolResult({
  status,
  outcome,
  summary,
  evidence = null,
  blockers = [],
  recommended_next,
  ...details
}) {
  return {
    status,
    outcome,
    summary,
    evidence,
    blockers,
    recommended_next,
    ...details,
  };
}

function failureResult(action, result) {
  const summary =
    result?.summary ??
    result?.stderr ??
    result?.error ??
    `action ${action.name} failed`;
  return protocolResult({
    status: "blocked",
    outcome: "blocked",
    summary,
    blockers: [summary],
    recommended_next: "manual-intervention",
    action: action.name,
  });
}

function isSuccessfulEvidence(result) {
  const evidence = result?.evidence ?? result;
  if (Array.isArray(evidence?.repositories)) {
    return evidence.repositories.length > 0 && evidence.repositories.every((item) => isSuccessfulEvidence(item));
  }
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
  reconcile,
  compareRecommendedAction,
  maxSteps = 20,
  maxRepairAttempts = 3,
} = {}) {
  if (!existsSync(ledgerPath)) {
    throw new Error(`ledger not found: ${ledgerPath}`);
  }

  const nextActionResolver = resolveNextAction ?? resolveDefaultNextAction;
  const recommendedActionComparer =
    typeof compareRecommendedAction === "function"
      ? compareRecommendedAction
      : compareRecommendedAction === false
        ? null
        : compareDefaultRecommendedAction;
  const actionExecutor =
    executeAction ??
    createCommandExecutor({ projectRoot, commands, policy, repositories: currentState(ledgerPath).仓库 });
  const steps = [];
  const repairs = [];
  const repairCounts = new Map();

  for (let index = 0; index < maxSteps; index += 1) {
    const document = currentState(ledgerPath);
    const deliveryStatus = findValue(document, "交付状态");
    const workflowStatus = findValue(document, "流程状态");

    if (deliveryStatus === "ready") {
      const lastStep = steps.at(-1);
      return protocolResult({
        status: "ready",
        outcome: "completed",
        summary: "自动化推进已到达 ready",
        evidence: lastStep?.evidenceKind
          ? { kind: lastStep.evidenceKind, result: "passed" }
          : null,
        recommended_next: "closing",
        steps,
        repairs,
      });
    }
    if (FINAL_DELIVERY_STATES.has(deliveryStatus)) {
      return protocolResult({
        status: deliveryStatus,
        outcome: "completed",
        summary: `自动化推进已到达 ${deliveryStatus}`,
        recommended_next: "closing",
        steps,
        repairs,
      });
    }
    if (workflowStatus === "blocked") {
      return protocolResult({
        status: "blocked",
        outcome: "blocked",
        summary: "需求流程已阻塞",
        blockers: ["需求流程已阻塞"],
        recommended_next: "manual-intervention",
        steps,
        repairs,
      });
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
    if (action.name === "prepare-workspace") {
      return protocolResult({
        status: "needs-confirmation",
        outcome: "needs-confirmation",
        summary: "需求已建账，需先由主技能准备需求工作区",
        blockers: ["workspace-not-prepared"],
        recommended_next: "prepare-workspace",
        action: action.name,
        steps,
        repairs,
      });
    }

    if (recommendedActionComparer) {
      const comparison = recommendedActionComparer(document);
      if (comparison?.consistent === false) {
        const summary =
          `账本推荐动作 ${comparison.ledger} 与真实状态冲突：` +
          `按当前状态应执行 ${comparison.resolved?.name ?? "无可用动作"}`;
        return protocolResult({
          status: "blocked",
          outcome: "blocked",
          summary,
          blockers: [summary],
          recommended_next: "manual-intervention",
          action: action.name,
          steps,
          repairs,
        });
      }
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
        const summary = result.summary ?? "action requires confirmation";
      return protocolResult({
        status: "needs-confirmation",
        outcome: "needs-confirmation",
        summary,
        blockers: [summary],
        recommended_next: "human-confirmation",
        action: action.name,
        steps,
        repairs,
      });
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
      const summary = `action ${action.name} returned incomplete evidence`;
      return protocolResult({
        status: "blocked",
        outcome: "blocked",
        summary,
        blockers: [summary],
        recommended_next: "manual-intervention",
        action: action.name,
        steps,
        repairs,
      });
    }

    advanceProgress(ledgerPath, action.targetStatus, evidence, owner, {
      projectRoot,
      reconcile,
    });
    steps.push({
      action: action.name,
      targetStatus: action.targetStatus,
      evidenceKind: evidence.kind,
    });
  }

  const summary = `automatic execution exceeded ${maxSteps} steps`;
  return protocolResult({
    status: "blocked",
    outcome: "blocked",
    summary,
    blockers: [summary],
    recommended_next: "manual-intervention",
    steps,
    repairs,
  });
}

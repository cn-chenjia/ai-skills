#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { assertSafeAction } from "../policies/command-safety.mjs";
import { runLifecycleHook } from "../lifecycle.mjs";
import { assertNormalizedEvent } from "./event-contract.mjs";

function response(decision, reason = undefined) {
  return {
    version: 1,
    decision,
    ...(reason ? { reason } : {}),
  };
}

function actor(event) {
  return event.actor ?? "xiaoqi";
}

function hasActiveXiaoqiSession(event) {
  if (!event.ledger) return false;
  const sessionPath = path.join(
    event.cwd ?? path.dirname(path.dirname(event.ledger)),
    "sprint-manage",
    "local",
    "session.yaml",
  );
  if (!existsSync(sessionPath) || !existsSync(event.ledger)) return false;

  const session = readFileSync(sessionPath, "utf8");
  const requirementId = path.basename(event.ledger, path.extname(event.ledger));
  return new RegExp(`(?:当前需求|current_requirement)\\s*:\\s*["']?${requirementId}["']?(?:\\s|$)`, "i").test(session);
}

function lifecyclePayload(event, outcome = undefined) {
  const action = event.action ?? {};
  const payload = {
    action: action.name ?? event.event,
    tool_name: action.tool ?? action.name ?? "unknown-tool",
    source: event.source,
    summary:
      action.summary ??
      action.command ??
      `${event.event} ${action.name ?? "unknown-action"}`,
  };
  if (action.command) payload.command = action.command;
  if (event.result) payload.result = event.result;
  if (failedResult(event)) {
    payload.failure_key = [
      action.name ?? event.event,
      event.result?.exitCode ?? "",
      event.result?.error ?? action.summary ?? action.command ?? "failure",
    ].join(":");
    payload.retryable = event.result?.retryable !== false;
  }
  if (outcome !== undefined) payload.outcome = outcome;
  return payload;
}

function failedResult(event) {
  return Boolean(
    event.result?.error ||
      event.result?.ok === false ||
      (Number.isInteger(event.result?.exitCode) && event.result.exitCode !== 0),
  );
}

// 这些错误代表流程门禁（blocked/closed 需求不得继续执行），必须向上传播为 deny
const PROPAGATABLE_HOOK_ERRORS = new Set([
  "workflow-blocked",
  "workflow-closed",
  "missing-action",
]);

function record(event, hook, outcome = undefined) {
  if (!event.ledger) return;
  try {
    runLifecycleHook(
      hook,
      event.ledger,
      lifecyclePayload(event, outcome),
      actor(event),
    );
  } catch (error) {
    if (PROPAGATABLE_HOOK_ERRORS.has(error.code)) throw error;
    // 观测性记录失败只告警，不阻塞工具执行
    process.stderr.write(`xiaoqi-lifecycle-record-failed: ${error.message}\n`);
  }
}

export function handleNormalizedEvent(input) {
  const event = assertNormalizedEvent(input);

  if (event.event === "unknown" || !hasActiveXiaoqiSession(event)) {
    return response("allow");
  }

  try {
    if (event.event === "before-action") {
      assertSafeAction(event.action, event.cwd);
      record(event, "before-action");
      return response("allow");
    }

    if (event.event === "session-start") {
      record(event, "session-start");
      return response("allow");
    }

    if (event.event === "after-action") {
      const failed = failedResult(event);
      record(event, failed ? "on-failure" : "after-action", failed ? undefined : "completed");
      return response("allow");
    }

    if (event.event === "stop") {
      record(event, "after-action", "stopped");
      return response("allow");
    }

    return response("allow");
  } catch (error) {
    if (event.event === "before-action") {
      return response("deny", error.message);
    }
    return response("stop", error.message);
  }
}

export function normalizedExitCode(result) {
  return result?.decision === "deny" ? 2 : 0;
}

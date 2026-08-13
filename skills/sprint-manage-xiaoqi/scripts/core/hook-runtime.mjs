#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

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

function record(event, hook, outcome = undefined) {
  if (!event.ledger) return;
  runLifecycleHook(
    hook,
    event.ledger,
    lifecyclePayload(event, outcome),
    actor(event),
  );
}

export function handleNormalizedEvent(input) {
  const event = assertNormalizedEvent(input);

  if (event.event === "unknown") return response("allow");

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

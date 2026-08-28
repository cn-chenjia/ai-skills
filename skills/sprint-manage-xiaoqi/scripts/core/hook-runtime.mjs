#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import process from "node:process";
import { execFileSync } from "node:child_process";
import { assertSafeAction } from "../policies/command-safety.mjs";
import { fileURLToPath } from "node:url";
import { assertNormalizedEvent } from "./event-contract.mjs";

const cliEntry = fileURLToPath(new URL("../../../../apps/cli/index.mjs", import.meta.url));

function response(decision, reason = undefined, result = undefined) {
  return {
    version: 1,
    decision,
    reason: reason ?? `hook-${decision}`,
    ...(result === undefined ? {} : { result }),
  };
}

function defaultControlPlane() {
  return { handleEvent() { return response("deny", "control-plane-handler-missing"); } };
}

function invokeCli(event) {
  try {
    const output = execFileSync(process.execPath, [cliEntry, "hook", "handle", "--event", JSON.stringify(event)], { cwd: event.cwd ?? process.cwd(), encoding: "utf8" });
    return JSON.parse(output);
  } catch (error) {
    return response("deny", error.code === 1 || error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "control-plane-handler-missing" : "control-plane-handler-error");
  }
}

export function handleNormalizedEvent(input, { controlPlane, ...runtimeOptions } = {}) {
  const event = assertNormalizedEvent(input);
  if (!event.planningRoot) return response("deny", "planning-root-required");
  if (!event.deliveryId) return response("deny", "delivery-id-required");
  if (!controlPlane) return invokeCli(event);
  const resolvedControlPlane = controlPlane;

  if (!event.planningRoot) return response("deny", "planning-root-required");
  if (!event.deliveryId) return response("deny", "delivery-id-required");
  if (typeof resolvedControlPlane?.handleEvent !== "function") {
    return response("deny", "control-plane-handler-missing");
  }
  if (event.event === "unknown") return response("deny", "unknown-event");

  try {
    if (event.event === "before-action") assertSafeAction(event.action, event.cwd);
    const result = resolvedControlPlane.handleEvent(event);
    if (!result || typeof result !== "object") return response("deny", "invalid-control-plane-result");
    return result.decision
      ? { ...result, version: 1, reason: result.reason ?? `hook-${result.decision}` }
      : response("deny", "invalid-control-plane-result", result);
  } catch (error) {
    return response("deny", error.code ?? "control-plane-handler-error");
  }
}

export function normalizedExitCode(result) {
  return result?.decision === "deny" ? 2 : 0;
}

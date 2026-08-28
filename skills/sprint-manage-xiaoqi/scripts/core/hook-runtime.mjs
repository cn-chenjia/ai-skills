#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import { assertSafeAction } from "../policies/command-safety.mjs";
import { assertNormalizedEvent } from "./event-contract.mjs";
import { createControlPlaneRuntime } from "../../../../infrastructure/control-plane-runtime.mjs";

function response(decision, reason = undefined, result = undefined) {
  return {
    version: 1,
    decision,
    reason: reason ?? `hook-${decision}`,
    ...(result === undefined ? {} : { result }),
  };
}

function defaultControlPlane() {
  return {
    handleEvent() {
      return response("deny", "control-plane-handler-missing");
    },
  };
}

export function handleNormalizedEvent(input, { controlPlane, ...runtimeOptions } = {}) {
  const event = assertNormalizedEvent(input);
  const resolvedControlPlane = controlPlane ?? (() => {
    try {
      return createControlPlaneRuntime({ cwd: event.cwd, planningRoot: event.planningRoot, deliveryId: event.deliveryId, ...runtimeOptions });
    } catch {
      return defaultControlPlane();
    }
  })();

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

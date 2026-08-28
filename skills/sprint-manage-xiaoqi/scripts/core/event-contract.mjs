#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

export const NORMALIZED_EVENTS = new Set([
  "session-start",
  "before-action",
  "after-action",
  "stop",
]);

function fail(message) {
  const error = new Error(`invalid-normalized-event: ${message}`);
  error.code = "invalid-normalized-event";
  throw error;
}

export function assertNormalizedEvent(event) {
  if (!event || typeof event !== "object") fail("event must be an object");
  if (event.version !== 1) fail("version must be 1");
  if (typeof event.source !== "string" || !event.source.trim()) {
    fail("source is required");
  }
  if (!NORMALIZED_EVENTS.has(event.event)) {
    if (event.event !== "unknown") fail(`unsupported event ${event.event}`);
  }
  if (event.actor !== undefined && typeof event.actor !== "string") {
    fail("actor must be a string");
  }
  if (event.planningRoot !== undefined && typeof event.planningRoot !== "string") {
    fail("planningRoot must be a string");
  }
  if (event.deliveryId !== undefined && typeof event.deliveryId !== "string") {
    fail("deliveryId must be a string");
  }
  if (event.action !== undefined && (event.action === null || typeof event.action !== "object")) {
    fail("action must be an object");
  }
  if (event.result !== undefined && (event.result === null || typeof event.result !== "object")) {
    fail("result must be an object");
  }
  return event;
}

import { resolveDeliverySelection } from "../../../../adapters/control-plane.mjs";
import { resolveOpenSpecContext } from "../openspec-context.mjs";

export function normalizeGenericEvent(input = {}) {
  const planningRoot = input?.planningRoot ?? input?.planning_root ?? (() => {
    try { return resolveOpenSpecContext(input?.cwd ?? process.cwd()).rootPath; } catch { return undefined; }
  })();
  return assertNormalizedEvent({
    version: input?.version ?? 1,
    source: input?.source ?? "generic-json",
    event: NORMALIZED_EVENTS.has(input?.event) ? input.event : "unknown",
    actor: input?.actor,
    cwd: input?.cwd,
    planningRoot,
    deliveryId: resolveDeliverySelection({
      deliveries: input?.deliveries ?? [],
      deliveryId: input?.deliveryId ?? input?.delivery_id,
    }),
    action: input?.action,
    result: input?.result,
  });
}

import path from "node:path";

import { parseOpenSpecContext } from "./openspec/context.mjs";

function normalizedPath(value) {
  return path.resolve(value).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function resolveControlPlaneRoot({ cwd, contextJson }) {
  const context = parseOpenSpecContext(contextJson);
  return { rootPath: normalizedPath(context.rootPath), mode: context.mode };
}

export function resolveDeliverySelection({ deliveries = [], deliveryId }) {
  if (deliveryId) {
    if (deliveries.length > 0 && !deliveries.includes(deliveryId)) {
      const error = new Error(`未知 delivery ID: ${deliveryId}`);
      error.code = "delivery-id-not-found";
      throw error;
    }
    return deliveryId;
  }
  if (deliveries.length > 1) {
    const error = new Error("多需求场景必须显式指定 delivery ID");
    error.code = "delivery-id-required";
    throw error;
  }
  return deliveries[0];
}

export function createControlPlaneEvent({
  source,
  event,
  cwd,
  planningRoot,
  deliveryId,
  actor,
  action,
  result,
}) {
  const normalized = {
    version: 1,
    source,
    event,
    cwd,
    planningRoot: planningRoot ? normalizedPath(planningRoot) : undefined,
    deliveryId,
    actor,
    action,
    result,
  };
  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== undefined));
}

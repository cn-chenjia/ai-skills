import { transitionDelivery } from "./workflow.mjs";

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function createDelivery({ id, requirementId, owner }) {
  if (!id || !requirementId) throw new Error("Delivery id and requirementId are required");
  return freeze({
    id,
    requirementId,
    owner: owner ?? null,
    phase: "start",
    phaseStatus: "draft",
    deliveryStatus: "not-started",
  });
}

export { transitionDelivery };

const transitions = new Map([
  ["start:draft", ["analyzing"]],
  ["start:analyzing", ["designing"]],
  ["start:designing", ["awaiting-approval"]],
  ["start:awaiting-approval", ["approved", "rejected"]],
  ["start:approved", ["preparing"]],
  ["prepare:preparing", ["workspace-ready", "prepare-blocked"]],
  ["prepare:workspace-ready", ["implementing"]],
  ["implement:implementing", ["testing"]],
  ["implement:testing", ["reviewing"]],
  ["implement:reviewing", ["implementation-complete", "implementation-blocked"]],
  ["implement:implementation-complete", ["verifying"]],
  ["close:verifying", ["archiving"]],
  ["close:archiving", ["finishing"]],
  ["close:finishing", ["closed"]],
]);

function error(message, code) {
  const result = new Error(message);
  result.code = code;
  return result;
}

export function transitionDelivery(delivery, event) {
  if (!delivery || typeof delivery !== "object") throw error("Delivery must be an object", "invalid-delivery");
  const nextPhaseStatus = typeof event === "string" ? event : event?.phaseStatus ?? event?.status ?? event?.to;
  const requestedDeliveryStatus = typeof event === "object" ? event.targetStatus ?? event.deliveryStatus : undefined;
  if (!nextPhaseStatus) throw error("Transition event must specify a status", "invalid-event");
  const currentPhaseStatus = delivery.phaseStatus ?? delivery.status;
  const allowed = transitions.get(`${delivery.phase}:${currentPhaseStatus}`) ?? [];
  if (!allowed.includes(nextPhaseStatus)) {
    throw error(`Illegal delivery transition from ${delivery.phase}.${currentPhaseStatus} to ${nextPhaseStatus}`, "invalid-transition");
  }
  const phase = nextPhaseStatus === "preparing" ? "prepare"
    : ["implementing", "testing", "reviewing", "implementation-complete", "implementation-blocked"].includes(nextPhaseStatus) ? "implement"
    : ["verifying", "archiving", "finishing", "closed"].includes(nextPhaseStatus) ? "close"
    : delivery.phase;
  const deliveryStatus = requestedDeliveryStatus ?? (nextPhaseStatus === "analyzing" ? "not-started"
    : ["implementing", "testing", "reviewing", "implementation-complete", "verifying", "archiving", "finishing"].includes(nextPhaseStatus) ? "coding"
    : delivery.deliveryStatus);
  if (!["not-started", "coding", "verified", "reviewed", "ready", "pr-open", "merged", "kept"].includes(deliveryStatus)) {
    throw error(`Invalid delivery status: ${deliveryStatus}`, "invalid-delivery-status");
  }
  return Object.freeze({ ...delivery, phase, phaseStatus: nextPhaseStatus, status: nextPhaseStatus, deliveryStatus });
}

export const DELIVERY_TRANSITIONS = Object.freeze(Object.fromEntries(transitions));

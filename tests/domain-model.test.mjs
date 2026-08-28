import assert from "node:assert/strict";
import test from "node:test";
import {
  createDelivery,
  createRequirement,
  transitionDelivery,
  validateEvidence,
  validatePlanningBinding,
  validateRepositoryBinding,
  validateWorkItem,
} from "../domain/index.mjs";

test("creates immutable requirement and delivery defaults", () => {
  const requirement = createRequirement({ id: "r1", title: "Feature" });
  assert.equal(requirement.status, "active");
  assert.equal(Object.isFrozen(requirement), true);
  assert.deepEqual(createDelivery({ id: "d1", requirementId: "r1" }), {
    id: "d1", requirementId: "r1", owner: null, phase: "start", phaseStatus: "draft", deliveryStatus: "not-started",
  });
});

test("supports the complete legal delivery transition chain", () => {
  let delivery = createDelivery({ id: "d1", requirementId: "r1" });
  for (const status of ["analyzing", "designing", "awaiting-approval", "approved", "preparing", "workspace-ready", "implementing", "testing", "reviewing", "implementation-complete", "verifying", "archiving", "finishing", "closed"]) {
    delivery = transitionDelivery(delivery, status);
  }
  assert.deepEqual({ phase: delivery.phase, phaseStatus: delivery.phaseStatus, deliveryStatus: delivery.deliveryStatus }, { phase: "close", phaseStatus: "closed", deliveryStatus: "coding" });
});

test("supports rejection and blocked branches", () => {
  let delivery = createDelivery({ id: "d1", requirementId: "r1" });
  for (const status of ["analyzing", "designing", "awaiting-approval"]) delivery = transitionDelivery(delivery, status);
  assert.equal(transitionDelivery(delivery, "rejected").phaseStatus, "rejected");
  delivery = transitionDelivery(delivery, "approved");
  delivery = transitionDelivery(delivery, "preparing");
  assert.equal(transitionDelivery(delivery, "prepare-blocked").phaseStatus, "prepare-blocked");
});

test("allows workspace-ready to advance into implementing", () => {
  let delivery = createDelivery({ id: "d1", requirementId: "r1" });
  for (const status of ["analyzing", "designing", "awaiting-approval", "approved", "preparing", "workspace-ready"]) delivery = transitionDelivery(delivery, status);
  assert.equal(transitionDelivery(delivery, "implementing").phaseStatus, "implementing");
});

test("rejects illegal transitions with a code", () => {
  assert.throws(() => transitionDelivery(createDelivery({ id: "d1", requirementId: "r1" }), "closed"), { code: "invalid-transition" });
});

test("validates bindings, work items and successful evidence", () => {
  assert.equal(validateRepositoryBinding({ repositoryId: "repo", path: "/repo", deliveryId: "d1" }).kind, "repository");
  assert.equal(validatePlanningBinding({ changeId: "change", deliveryId: "d1" }).kind, "planning");
  assert.equal(validateWorkItem({ id: "w1", deliveryId: "d1", title: "Implement" }).status, "pending");
  assert.equal(validateEvidence({ kind: "check", command: "npm test", exit_code: 0, commit: "abc", checked_at: "now", summary: "passed" }).kind, "check");
});

test("rejects invalid binding fields and failed evidence", () => {
  assert.throws(() => validateRepositoryBinding({ repositoryId: "repo", path: "/repo" }));
  assert.throws(() => validatePlanningBinding({ changeId: "" }));
  assert.throws(() => validateWorkItem({ id: "w1", title: "Missing delivery" }));
  assert.throws(() => validateEvidence({ kind: "check", command: "npm test", exit_code: 1, commit: "abc", checked_at: "now", summary: "failed" }));
});

test("does not freeze input and deeply freezes returned nested data", () => {
  const input = { id: "w1", deliveryId: "d1", title: "Implement", dependencies: [{ id: "w0" }] };
  const result = validateWorkItem(input);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(input.dependencies), false);
  assert.equal(Object.isFrozen(result.dependencies), true);
  assert.equal(Object.isFrozen(result.dependencies[0]), true);
});

test("validates evidence action schemas and finish target status", () => {
  assert.throws(() => validateEvidence({ kind: "apply", summary: "done" }));
  assert.throws(() => validateEvidence({ kind: "review", command: "review", exit_code: 0, commit: "abc", checked_at: "now", summary: "ok", result: "rejected" }));
  assert.throws(() => validateEvidence({ kind: "finish", command: "finish", exit_code: 0, commit: "abc", checked_at: "now", summary: "ok", result: "merged", outcome: "completed", targetStatus: "kept" }));
  assert.equal(validateEvidence({ kind: "finish", command: "finish", exit_code: 0, commit: "abc", checked_at: "now", summary: "ok", result: "merged", outcome: "completed", targetStatus: "merged" }).result, "merged");
});

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createStartDeliveryService } from "../application/start-delivery.mjs";
import { assertWritablePath } from "../adapters/openspec/artifact-policy.mjs";
import { createSqliteRepository } from "../infrastructure/persistence/sqlite-repository.mjs";

function setup() {
  const state = { requirements: [], deliveries: [], bindings: [], events: [] };
  const repository = {
    requirements: { create(value) { state.requirements.push(value); return value; } },
    createRequirementAndDelivery(requirement, delivery) {
      state.requirements.push(requirement);
      state.deliveries.push(delivery);
      return { requirement, delivery };
    },
    deliveries: {
      create(value) { state.deliveries.push(value); return value; },
      get(id) { return state.deliveries.find((value) => value.id === id); },
      updateStatus(id, value) { const index = state.deliveries.findIndex((item) => item.id === id); state.deliveries[index] = { ...state.deliveries[index], ...value }; return state.deliveries[index]; },
    },
    bindings: { replaceForDelivery(id, values) { state.bindings = state.bindings.filter((value) => value.deliveryId !== id).concat(values); } },
    events: { append(value) { state.events.push(value); return value; } },
  };
  const openspec = { assertArtifactPath(value) { if (!value.startsWith("/openspec/changes/demo/")) throw new Error("not standard"); return value; } };
  return { state, service: createStartDeliveryService({ repository, openspec }) };
}

test("creates requirement and delivery without creating planning documents", () => {
  const { state, service } = setup();
  const result = service.createRequirement({ id: "r1", deliveryId: "d1", title: "Feature" });
  assert.equal(result.delivery.phaseStatus, "draft");
  assert.equal(state.requirements.length, 1);
  assert.equal(state.deliveries.length, 1);
  assert.deepEqual(state.events, []);
});

test("rejects a fake repository without atomic creation before any requirement write", () => {
  const state = { requirements: [], deliveries: [] };
  const repository = {
    requirements: { create(value) { state.requirements.push(value); return value; } },
    deliveries: { create() { throw new Error("Delivery write failed"); } },
  };
  const service = createStartDeliveryService({ repository, openspec: {} });

  assert.throws(() => service.createRequirement({ id: "r1", deliveryId: "d1", title: "Feature" }), /repository\.createRequirementAndDelivery/);
  assert.deepEqual(state.requirements, []);
  assert.deepEqual(state.deliveries, []);
});

test("stores only planning binding and standard OpenSpec artifact references", () => {
  const { state, service } = setup();
  service.createRequirement({ id: "r1", deliveryId: "d1", title: "Feature" });
  service.attachPlanningChange("d1", { kind: "planning", changeId: "demo" });
  const references = service.recordArtifactReferences("d1", {
    proposalPath: "/openspec/changes/demo/proposal.md",
    designPath: "/openspec/changes/demo/design.md",
    tasksPath: "/openspec/changes/demo/tasks.md",
    specPaths: ["/openspec/changes/demo/spec.md"],
  });
  assert.deepEqual(references, {
    proposalPath: "/openspec/changes/demo/proposal.md",
    designPath: "/openspec/changes/demo/design.md",
    tasksPath: "/openspec/changes/demo/tasks.md",
    specPaths: ["/openspec/changes/demo/spec.md"],
  });
  assert.equal(state.bindings[0].changeId, "demo");
  assert.equal(state.events[0].type, "artifact-references-recorded");
  assert.equal("content" in state.events[0].payload, false);
  assert.throws(() => service.recordArtifactReferences("d1", { proposalPath: "/tmp/plan.md" }), /standard/);
});

test("blocks prepare before approval and allows it after approval", () => {
  const { state, service } = setup();
  service.createRequirement({ id: "r1", deliveryId: "d1", title: "Feature" });
  assert.throws(() => service.prepareDelivery("d1"), { code: "plan-not-approved" });
  state.deliveries[0] = { ...state.deliveries[0], phaseStatus: "awaiting-approval", status: "awaiting-approval" };
  service.approvePlan("d1", "alice");
  assert.equal(service.prepareDelivery("d1").phaseStatus, "preparing");
});

test("rejects the plan and records actor and reason", () => {
  const { state, service } = setup();
  service.createRequirement({ id: "r1", deliveryId: "d1", title: "Feature" });
  state.deliveries[0] = { ...state.deliveries[0], phaseStatus: "awaiting-approval", status: "awaiting-approval" };
  service.rejectPlan("d1", "alice", "missing acceptance criteria");
  assert.equal(state.deliveries[0].phaseStatus, "rejected");
  assert.deepEqual(state.events[0].payload, { reason: "missing acceptance criteria" });
});

test("uses the real OpenSpec policy and atomically creates requirement and delivery", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiaoqi-start-"));
  const repository = createSqliteRepository({ planningRoot: root });
  const service = createStartDeliveryService({ repository, openspec: { planningRoot: root, assertWritablePath } });
  service.createRequirement({ id: "r1", deliveryId: "d1", title: "Feature" });
  assert.throws(() => service.recordArtifactReferences("d1", { specPaths: "not-array" }), /array/);
  assert.throws(() => service.approvePlan("d1", "alice"), { code: "invalid-transition" });
  service.recordArtifactReferences("d1", { proposalPath: path.join(root, "openspec", "changes", "demo", "proposal.md") });
  service.recordArtifactReferences("d1", { proposalPath: path.join(root, "openspec", "changes", "demo", "proposal.md") });
  const eventIds = repository.events.listByDelivery("d1").map((event) => event.id);
  assert.equal(new Set(eventIds).size, eventIds.length);
  assert.throws(() => service.createRequirement({ id: "r1", deliveryId: "d2", title: "Duplicate" }));
  assert.equal(repository.deliveries.get("d2"), undefined);
  repository.close();
});

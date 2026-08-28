import assert from "node:assert/strict";
import test from "node:test";

import { createPrepareDeliveryService } from "../application/prepare-delivery.mjs";
import { createWorkspaceManager } from "../infrastructure/workspace-manager.mjs";

function setup(overrides = {}) {
  const state = {
    delivery: { id: "d1", phase: "prepare", phaseStatus: "preparing", deliveryStatus: "not-started" },
    bindings: [],
    workItems: [
      { id: "w1", deliveryId: "d1", title: "API", dependencies: [], status: "pending" },
      { id: "w2", deliveryId: "d1", title: "UI", dependencies: ["w1"], status: "pending" },
    ],
    events: [],
  };
  const repository = {
    deliveries: {
      get: () => state.delivery,
      updateStatus: (_id, value) => { state.delivery = { ...state.delivery, ...value }; return state.delivery; },
    },
    bindings: { replaceForDelivery: (_id, values) => { state.bindings = values; } },
    workItems: {
      listByDelivery: () => state.workItems,
      updateStatus: (id, status) => { const item = state.workItems.find((value) => value.id === id); item.status = status; return item; },
      get: (id) => state.workItems.find((value) => value.id === id),
      updateAssignee: (id, assignee) => { const item = state.workItems.find((value) => value.id === id); item.assignee = assignee; return item; },
    },
    events: { append: (event) => { state.events.push(event); return event; } },
  };
  const createdWorktrees = new Set();
  const git = { currentWorktree: async ({ path }) => path, createBranch: async () => ({ success: true, exitCode: 0, stdout: "", stderr: "" }), createWorktree: async ({ worktree }) => { createdWorktrees.add(worktree); return worktree; }, ...(overrides.git ?? {}) };
  const originalAppend = repository.events.append;
  repository.events.append = (event) => { if (overrides.eventsAppend) return overrides.eventsAppend(event); return originalAppend(event); };
  const workspaceManager = createWorkspaceManager({ git, pathExists: overrides.pathExists ?? ((value) => createdWorktrees.has(value)), mkdir: overrides.mkdir ?? (() => {}) });
  const service = createPrepareDeliveryService({ repository, workspaceManager, policy: overrides.policy ?? {} });
  return { state, service };
}

test("prepares a single repository in the current worktree", async () => {
  const { state, service } = setup();
  const result = await service.prepareDelivery("d1", { repositories: [{ repositoryId: "repo", path: "/repo" }] });
  assert.equal(result.bindings[0].worktree, "/repo");
  assert.equal(state.delivery.phaseStatus, "workspace-ready");
});

test("creates independent worktrees for multiple repositories and assigns work items", async () => {
  const { state, service } = setup();
  const result = await service.prepareDelivery("d1", {
    repositories: [
      { repositoryId: "a", path: "/a", branch: "feature/a", worktree: "/tmp/a" },
      { repositoryId: "b", path: "/b", branch: "feature/b", worktree: "/tmp/b" },
    ],
    workItems: [{ id: "w1", assignee: "alice" }, { id: "w2", assignee: "bob" }],
    mode: "multi-repository",
  });
  assert.equal(result.bindings.length, 2);
  assert.equal(state.workItems[0].assignee, "alice");
  assert.equal(state.workItems[1].assignee, "bob");
});

test("blocks duplicate branches, worktrees, overlapping scopes, dependency cycles, and unapproved delivery", async () => {
  await assert.rejects(() => setup().service.prepareDelivery("d1", { repositories: [{ repositoryId: "a", path: "/a", branch: "same", worktree: "/tmp/a" }, { repositoryId: "b", path: "/b", branch: "same", worktree: "/tmp/b" }] }), /branch/);
  await assert.rejects(() => setup().service.prepareDelivery("d1", { repositories: [{ repositoryId: "a", path: "/a", worktree: "/tmp/x" }, { repositoryId: "b", path: "/b", worktree: "/tmp/x" }] }), /worktree/);
  await assert.rejects(() => setup().service.prepareDelivery("d1", { repositories: [{ repositoryId: "a", path: "/a", writeScope: ["src"] }, { repositoryId: "b", path: "/b", writeScope: ["src/api"] }] }), /scope/);
  const cyclic = setup(); cyclic.state.workItems[0].dependencies = ["w2"];
  await assert.rejects(() => cyclic.service.prepareDelivery("d1", { repositories: [{ repositoryId: "a", path: "/a" }] }), /cycle|循环/);
  const unapproved = setup(); unapproved.state.delivery = { ...unapproved.state.delivery, phase: "start", phaseStatus: "awaiting-approval" };
  await assert.rejects(() => unapproved.service.prepareDelivery("d1", { repositories: [{ repositoryId: "a", path: "/a" }] }), { code: "plan-not-approved" });
});

test("rejects unknown dependencies, cross-delivery assignments, invalid modes, and planning conflicts", async () => {
  const unknown = setup(); unknown.state.workItems[0].dependencies = ["outside"];
  await assert.rejects(() => unknown.service.prepareDelivery("d1"), { code: "unknown-dependency" });
  const crossDelivery = setup();
  await assert.rejects(() => crossDelivery.service.prepareDelivery("d1", { workItems: [{ id: "outside", assignee: "alice" }] }), { code: "work-item-not-in-delivery" });
  await assert.rejects(() => setup().service.prepareDelivery("d1", { mode: "invalid" }), { code: "invalid-mode" });
  const planningOnly = setup(); planningOnly.repository = undefined;
  assert.deepEqual(setup().service.checkConflicts("d1"), []);
});

test("restores delivery state when a later repository fails", async () => {
  const original = { phase: "prepare", phaseStatus: "approved", deliveryStatus: "ready" };
  const { state, service } = setup({
    pathExists: (value) => value === "/tmp/a",
    git: { createWorktree: async ({ worktree }) => { if (worktree === "/tmp/b") throw new Error("second repository failed"); } },
  });
  state.delivery = { ...state.delivery, ...original };
  await assert.rejects(() => service.prepareDelivery("d1", {
    repositories: [
      { repositoryId: "a", path: "/a", worktree: "/tmp/a" },
      { repositoryId: "b", path: "/b", worktree: "/tmp/b" },
    ],
  }), /second repository failed/);
  assert.deepEqual(state.delivery, { id: "d1", ...original });
});

test("restores delivery state when events.append fails", async () => {
  const cause = new Error("event failed");
  const { state, service } = setup({ eventsAppend: () => { throw cause; } });
  const original = { ...state.delivery };
  await assert.rejects(() => service.prepareDelivery("d1", { repositories: [{ repositoryId: "a", path: "/a" }] }), cause);
  assert.equal(state.delivery.phase, original.phase);
  assert.equal(state.delivery.phaseStatus, original.phaseStatus);
  assert.equal(state.delivery.deliveryStatus, original.deliveryStatus);
});

test("supports mixed reused and newly created worktrees", async () => {
  const existing = new Set(["/tmp/reused"]);
  const { state, service } = setup({ pathExists: (value) => existing.has(value), git: {
    createWorktree: async ({ worktree }) => { existing.add(worktree); },
  } });
  const result = await service.prepareDelivery("d1", { repositories: [
    { repositoryId: "a", path: "/a", worktree: "/tmp/reused" },
    { repositoryId: "b", path: "/b", worktree: "/tmp/new" },
  ] });
  assert.equal(result.bindings.length, 2);
  assert.equal(state.delivery.phaseStatus, "workspace-ready");
});

test("rolls back a newly created worktree without deleting an existing branch", async () => {
  const existingWorktrees = new Set();
  const removedWorktrees = [];
  const deletedBranches = [];
  const { service } = setup({
    pathExists: (value) => existingWorktrees.has(value),
    git: {
      branchExists: async () => true,
      createWorktree: async ({ worktree }) => { existingWorktrees.add(worktree); throw new Error("worktree failed"); },
      removeWorktree: async ({ worktree }) => { removedWorktrees.push(worktree); existingWorktrees.delete(worktree); },
      deleteBranch: async ({ branch }) => { deletedBranches.push(branch); },
    },
  });
  await assert.rejects(() => service.prepareDelivery("d1", { repositories: [{ repositoryId: "a", path: "/a", branch: "existing", worktree: "/tmp/a" }] }), /worktree failed/);
  assert.deepEqual(removedWorktrees, ["/tmp/a"]);
  assert.deepEqual(deletedBranches, []);
});

test("does not mark or delete a branch when createBranch is not strictly successful", async () => {
  const deletedBranches = [];
  const { service } = setup({
    git: {
      createBranch: async () => ({ success: false, exitCode: 1, stderr: "branch failed" }),
      deleteBranch: async ({ branch }) => { deletedBranches.push(branch); },
    },
  });
  await assert.rejects(() => service.prepareDelivery("d1", { repositories: [{ repositoryId: "a", path: "/a", branch: "new", worktree: "/tmp/a" }] }), /branch.*failed/i);
  assert.deepEqual(deletedBranches, []);
});

test("rolls back a newly created worktree and branch together", async () => {
  const existingWorktrees = new Set();
  const removedWorktrees = [];
  const deletedBranches = [];
  const { service } = setup({
    pathExists: (value) => existingWorktrees.has(value),
    git: {
      createBranch: async () => ({ success: true, exitCode: 0 }),
      createWorktree: async ({ worktree }) => { existingWorktrees.add(worktree); throw new Error("worktree failed"); },
      removeWorktree: async ({ worktree }) => { removedWorktrees.push(worktree); existingWorktrees.delete(worktree); },
      deleteBranch: async ({ branch }) => { deletedBranches.push(branch); },
    },
  });
  await assert.rejects(() => service.prepareDelivery("d1", { repositories: [{ repositoryId: "a", path: "/a", branch: "new", worktree: "/tmp/a" }] }), /worktree failed/);
  assert.deepEqual(removedWorktrees, ["/tmp/a"]);
  assert.deepEqual(deletedBranches, ["new"]);
});

test("does not clean up a reused worktree", async () => {
  const removedWorktrees = [];
  const deletedBranches = [];
  const { service } = setup({
    pathExists: () => true,
    git: {
      removeWorktree: async ({ worktree }) => { removedWorktrees.push(worktree); },
      deleteBranch: async ({ branch }) => { deletedBranches.push(branch); },
    },
  });
  await service.prepareDelivery("d1", { repositories: [{ repositoryId: "a", path: "/a", branch: "existing", worktree: "/tmp/reused" }] });
  assert.deepEqual(removedWorktrees, []);
  assert.deepEqual(deletedBranches, []);
});

test("checkConflicts and assignWorkItem persist through repository ports", async () => {
  const { state, service } = setup();
  await service.prepareDelivery("d1", { repositories: [{ repositoryId: "a", path: "/a" }] });
  assert.deepEqual(service.checkConflicts("d1"), []);
  await service.assignWorkItem("w1", "alice");
  assert.equal(state.workItems[0].assignee, "alice");
});

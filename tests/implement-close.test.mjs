import assert from "node:assert/strict";
import test from "node:test";

import { createCommandExecutor } from "../infrastructure/execution/command-executor.mjs";
import { createImplementationService } from "../application/implement-work-item.mjs";
import { createCloseDeliveryService } from "../application/close-delivery.mjs";

function setup() {
  const state = { delivery: { id: "d1", phase: "implement", phaseStatus: "implementing", deliveryStatus: "coding" }, items: [{ id: "w1", deliveryId: "d1", status: "pending" }], evidence: [], events: [], commands: [] };
  const repository = {
    deliveries: { get: () => state.delivery, updateStatus: (_id, value) => { state.delivery = { ...state.delivery, ...value }; return state.delivery; } },
    workItems: { get: (id) => state.items.find((item) => item.id === id), updateStatus: (id, status) => { const item = state.items.find((value) => value.id === id); item.status = status; return item; } },
    evidence: { append: (value) => { state.evidence.push(value); return value; }, listByDelivery: (deliveryId) => state.evidence.filter((value) => value.deliveryId === deliveryId) },
    events: { append: (value) => { state.events.push(value); return value; } },
    bindings: { listForDelivery: (deliveryId) => state.bindings.filter((value) => value.deliveryId === deliveryId) },
  };
  state.bindings = [{ kind: "repository", repositoryId: "repo-1", path: "/repo", branch: "feature/d1", worktree: "/repo", deliveryId: "d1" }];
  const executor = createCommandExecutor({ executeCommand: async (command, args, options) => { state.commands.push({ command, args, options }); return { exitCode: 0, stdout: "ok", stderr: "", commit: "abc", artifacts: [], ...(command === "review" ? { result: "approved", independent: true } : {}) }; }, policy: { assertCommand: () => {}, assertWritable: () => {} } });
  return { state, repository, executor };
}

function seedImplementationEvidence(repository) {
  repository.evidence.append({ id: "apply-ok", deliveryId: "d1", kind: "apply", command: "apply", exit_code: 0, checked_at: "now", summary: "applied" });
  repository.evidence.append({ id: "check-ok", deliveryId: "d1", kind: "check", command: "check", exit_code: 0, commit: "abc123", checked_at: "now", summary: "checked" });
}

test("executor returns structured result without changing delivery state and enforces policy", async () => {
  const calls = [];
  const executor = createCommandExecutor({ executeCommand: async (...args) => { calls.push(args); return { code: 0, stdout: "x", stderr: "", commit: "abc123", artifacts: ["a"] }; }, policy: { assertCommand: (input) => { assert.equal(input.command, "npm"); }, assertWritable: () => {} } });
  const result = await executor.run({ command: "npm", args: ["test"], cwd: "/repo", writeScope: ["src"] });
  assert.deepEqual(result, { success: true, exitCode: 0, stdout: "x", stderr: "", commit: "abc123", artifacts: ["a"] });
  assert.equal(calls.length, 1);
});

test("command executor rejects empty, unknown, working-tree and non-commit values", async () => {
  for (const commit of [undefined, "", "unknown", "working-tree", "not-a-commit"]) {
    const executor = createCommandExecutor({ executeCommand: async () => ({ exitCode: 0, stdout: "ok", commit }), policy: { assertCommand: () => {}, assertWritable: () => {} } });
    const result = await executor.run({ command: "npm", args: [], cwd: "/repo", writeScope: ["src"] });
    assert.equal(result.success, false);
    assert.match(result.stderr, /(commit|HEAD)/i);
  }
});

test("runTdd advances workspace-ready before recording apply evidence", async () => {
  const { state, repository, executor } = setup();
  state.delivery = { ...state.delivery, phase: "prepare", phaseStatus: "workspace-ready" };
  const service = createImplementationService({ repository, executor, workflowPolicy: { apply: { command: "apply", writeScope: ["src"] } } });
  await service.runTdd("w1");
  assert.equal(state.delivery.phaseStatus, "implementing");
  assert.equal(state.evidence.at(-1).kind, "apply");
});

test("runTdd restores workspace-ready and records failure when apply fails", async () => {
  const { state, repository } = setup();
  state.delivery = { ...state.delivery, phase: "prepare", phaseStatus: "workspace-ready" };
  const service = createImplementationService({ repository, executor: { run: async () => ({ success: false, exitCode: 1, stderr: "apply failed" }) }, workflowPolicy: { apply: { command: "apply", writeScope: ["src"] } } });
  await assert.rejects(() => service.runTdd("w1"), /apply failed/);
  assert.equal(state.delivery.phaseStatus, "workspace-ready");
  assert.equal(state.evidence.length, 0);
  assert.equal(state.events.at(-1).type, "apply-failed");
});

test("implementation records apply check review evidence and advances by evidence", async () => {
  const { state, repository, executor } = setup();
  const service = createImplementationService({ repository, executor, workflowPolicy: { apply: { command: "apply", writeScope: ["src"] }, check: { command: "check", writeScope: ["src"] }, review: { command: "review", writeScope: ["src"] } } });
  await service.runTdd("w1");
  assert.equal(state.delivery.phaseStatus, "implementing");
  await service.runChecks("d1");
  await service.requestReview("d1");
  assert.deepEqual(state.evidence.map((item) => item.kind), ["apply", "check", "review"]);
  assert.equal(state.delivery.phaseStatus, "implementation-complete");
});

test("close requires verify, archive and finish evidence and records merge and remove actions", async () => {
  const { state, repository, executor } = setup();
  state.delivery = { ...state.delivery, phase: "implement", phaseStatus: "implementation-complete" };
  seedImplementationEvidence(repository);
  repository.evidence.append({ id: "review-ok", deliveryId: "d1", kind: "review", command: "review", exit_code: 0, commit: "abc", checked_at: "now", summary: "approved", result: "approved", independent: true });
  const service = createCloseDeliveryService({ repository, executor, policy: { "openspec-verify": { command: "verify", writeScope: ["openspec"] }, assertWritable: () => {} }, openspec: { archive: async () => ({ success: true, exitCode: 0, path: "/openspec/archived" }) }, git: { removeWorktree: async () => ({ success: true }), merge: async () => ({ success: true }) } });
  await assert.rejects(() => service.finishDelivery("d1", { branchAction: "merge", workspaceAction: "remove", result: "merged" }), /archive|finish/i);
  await service.verifyDelivery("d1");
  await service.archiveOpenSpec("d1", { command: "archive", writeScope: ["openspec"], path: "/openspec/archived" });
  const result = await service.finishDelivery("d1", { branchAction: "merge", workspaceAction: "remove", result: "merged" });
  assert.equal(result.phaseStatus, "closed");
  assert.deepEqual(state.evidence.map((item) => item.kind), ["apply", "check", "review", "openspec-verify", "archive", "finish"]);
  assert.equal(state.evidence.at(-1).result, "merged");
});

test("finish uses the selected repository binding as authoritative Git input", async () => {
  const { state, repository, executor } = setup();
  state.delivery = { ...state.delivery, phase: "implement", phaseStatus: "implementation-complete" };
  seedImplementationEvidence(repository);
  repository.evidence.append({ id: "review-ok", deliveryId: "d1", kind: "review", command: "review", exit_code: 0, commit: "abc", checked_at: "now", summary: "approved", result: "approved", independent: true });
  const gitInputs = [];
  const service = createCloseDeliveryService({ repository, executor, policy: { "openspec-verify": { command: "verify", writeScope: ["openspec"] }, assertWritable: () => {} }, openspec: { archive: async () => ({ success: true, exitCode: 0, path: "/archived" }) }, git: { merge: async (input) => { gitInputs.push(input); return { success: true }; } } });
  await service.verifyDelivery("d1");
  await service.archiveOpenSpec("d1", { command: "archive", writeScope: ["openspec"], path: "/archived" });
  await service.finishDelivery("d1", { branchAction: "merge", result: "merged", path: "/attacker", branch: "attacker", worktree: "/attacker" });
  assert.equal(gitInputs[0].path, "/repo");
  assert.equal(gitInputs[0].branch, "feature/d1");
  assert.equal(gitInputs[0].worktree, "/repo");
});

test("finish rejects missing or ambiguous repository bindings", async () => {
  const { state, repository, executor } = setup();
  state.delivery = { ...state.delivery, phase: "close", phaseStatus: "archiving" };
  seedImplementationEvidence(repository);
  repository.evidence.append({ id: "review-ok", deliveryId: "d1", kind: "review", command: "review", exit_code: 0, commit: "abc", checked_at: "now", summary: "approved", result: "approved", independent: true });
  repository.evidence.append({ id: "verify", deliveryId: "d1", kind: "openspec-verify", command: "verify", exit_code: 0, commit: "abc", checked_at: "now", summary: "verified", result: "passed" });
  repository.evidence.append({ id: "archive", deliveryId: "d1", kind: "archive", command: "archive", exit_code: 0, checked_at: "now", summary: "archived", path: "/archived", outcome: "archived" });
  const service = createCloseDeliveryService({ repository, executor, git: {} });
  repository.bindings.listForDelivery = () => [];
  await assert.rejects(() => service.finishDelivery("d1", { result: "kept" }), /repository binding/);
  repository.bindings.listForDelivery = () => [
    { kind: "repository", repositoryId: "repo-1", path: "/repo-1", deliveryId: "d1" },
    { kind: "repository", repositoryId: "repo-2", path: "/repo-2", deliveryId: "d1" },
  ];
  await assert.rejects(() => service.finishDelivery("d1", { result: "kept" }), /multiple repository bindings/);
});

test("finish rereads successful verify and archive evidence instead of trusting phase status", async () => {
  const { repository, executor } = setup();
  const state = repository.deliveries.get("d1");
  state.phaseStatus = "archiving";
  seedImplementationEvidence(repository);
  const service = createCloseDeliveryService({ repository, executor, git: {} });
  await assert.rejects(() => service.finishDelivery("d1", { branchAction: "keep", workspaceAction: "keep", result: "kept" }), /verify|archive evidence/i);
});

test("finish rejects incomplete verify evidence fields", async () => {
  const { state, repository, executor } = setup();
  state.delivery = { ...state.delivery, phase: "close", phaseStatus: "archiving" };
  seedImplementationEvidence(repository);
  repository.evidence.append({ id: "review", deliveryId: "d1", kind: "review", result: "approved", independent: true, exit_code: 0, command: "review", commit: "abc", checked_at: "now", summary: "approved" });
  repository.evidence.append({ id: "verify", deliveryId: "d1", kind: "openspec-verify", result: "passed", exit_code: 0 });
  repository.evidence.append({ id: "archive", deliveryId: "d1", kind: "archive", outcome: "archived", exit_code: 0 });
  const service = createCloseDeliveryService({ repository, executor, git: {} });
  await assert.rejects(() => service.finishDelivery("d1", { branchAction: "keep", workspaceAction: "keep", result: "kept" }), /verify evidence/);
});

test("finish rejects incomplete archive evidence fields", async () => {
  const { state, repository, executor } = setup();
  state.delivery = { ...state.delivery, phase: "close", phaseStatus: "archiving" };
  seedImplementationEvidence(repository);
  repository.evidence.append({ id: "review", deliveryId: "d1", kind: "review", result: "approved", independent: true, exit_code: 0, command: "review", commit: "abc", checked_at: "now", summary: "approved" });
  repository.evidence.append({ id: "verify", deliveryId: "d1", kind: "openspec-verify", result: "passed", exit_code: 0, command: "verify", commit: "abc", checked_at: "now", summary: "verified" });
  repository.evidence.append({ id: "archive", deliveryId: "d1", kind: "archive", outcome: "archived", exit_code: 0, command: "archive", checked_at: "now", summary: "archived" });
  const service = createCloseDeliveryService({ repository, executor, git: {} });
  await assert.rejects(() => service.finishDelivery("d1", { branchAction: "keep", workspaceAction: "keep", result: "kept" }), /archive evidence/);
});

test("close actions reject wrong phases without invoking ports or recording evidence", async () => {
  const { state, repository } = setup();
  const calls = [];
  const service = createCloseDeliveryService({
    repository,
    executor: { run: async (input) => { calls.push(["executor", input]); return { success: true, exitCode: 0 }; } },
    policy: { assertWritable: () => { calls.push(["assertWritable"]); } },
    openspec: { archive: async () => { calls.push(["archive"]); return { success: true, exitCode: 0, path: "/archived" }; } },
  });
  await assert.rejects(() => service.verifyDelivery("d1", { command: "verify", writeScope: ["openspec"] }), /implementation-complete/);
  await assert.rejects(() => service.archiveOpenSpec("d1", { command: "archive", writeScope: ["openspec"], path: "/archived" }), /verifying/);
  assert.deepEqual(calls, []);
  assert.deepEqual(state.evidence, []);
  assert.equal(state.delivery.phaseStatus, "implementing");
});

test("archive validates the target path before invoking the archive port", async () => {
  const { repository, executor } = setup();
  let called = false;
  repository.deliveries.updateStatus("d1", { phase: "implement", phaseStatus: "implementation-complete" });
  const service = createCloseDeliveryService({ repository, executor, openspec: { archive: async () => { called = true; return { path: "/outside" }; } }, policy: { "openspec-verify": { command: "verify", writeScope: ["openspec"] }, assertWritable: () => { throw new Error("invalid OpenSpec path"); } } });
  await service.verifyDelivery("d1", { command: "verify", writeScope: ["openspec"] });
  await assert.rejects(() => service.archiveOpenSpec("d1", { command: "archive", writeScope: ["openspec"], path: "/outside" }), /invalid OpenSpec path/);
  assert.equal(called, false);
});

test("non-keep actions require successful git ports and result matches branch action", async () => {
  const { state, repository, executor } = setup();
  state.delivery = { ...state.delivery, phase: "implement", phaseStatus: "implementation-complete" };
  seedImplementationEvidence(repository);
  repository.evidence.append({ id: "review-ok", deliveryId: "d1", kind: "review", command: "review", exit_code: 0, commit: "abc", checked_at: "now", summary: "approved", result: "approved", independent: true });
  const service = createCloseDeliveryService({ repository, executor, policy: { "openspec-verify": { command: "verify", writeScope: ["openspec"] }, assertWritable: () => {} }, openspec: { archive: async () => ({ success: true, exitCode: 0, path: "/archived" }) }, git: {} });
  await service.verifyDelivery("d1");
  await service.archiveOpenSpec("d1", { command: "archive", writeScope: ["openspec"], path: "/archived" });
  await assert.rejects(() => service.finishDelivery("d1", { branchAction: "merge", workspaceAction: "keep", result: "merged" }), /Git.*merge|merge.*port/i);
  await assert.rejects(() => service.finishDelivery("d1", { branchAction: "keep", workspaceAction: "keep", result: "kept" === "merged" ? "kept" : "merged" }), /result|branchAction/i);
});

test("archive requires executor command and write scope and a real archive port", async () => {
  const { repository, executor } = setup();
  repository.deliveries.updateStatus("d1", { phase: "close", phaseStatus: "verifying" });
  const service = createCloseDeliveryService({ repository, executor, policy: { assertWritable: () => {} }, openspec: {} });
  await assert.rejects(() => service.archiveOpenSpec("d1", { path: "/archived" }), /command|write policy|required/i);
  const calls = [];
  const noPort = createCloseDeliveryService({
    repository,
    executor: { run: async () => { calls.push("executor"); return { success: true, exitCode: 0 }; } },
    policy: { assertWritable: () => {} },
    openspec: { archive: undefined },
  });
  await assert.rejects(() => noPort.archiveOpenSpec("d1", { command: "archive", writeScope: ["openspec"], path: "/archived" }), /archive port|required/i);
  assert.deepEqual(calls, []);
  assert.deepEqual(repository.evidence.listByDelivery("d1"), []);
  const failedPort = createCloseDeliveryService({ repository, executor, policy: { assertWritable: () => {} }, openspec: { archive: async () => ({ success: false, exitCode: 1 }) } });
  await assert.rejects(() => failedPort.archiveOpenSpec("d1", { command: "archive", writeScope: ["openspec"], path: "/archived" }), /archive result|failed/i);
  assert.equal(repository.evidence.listByDelivery("d1").length, 0);
});

test("runChecks requires successful current delivery apply evidence", async () => {
  const { repository, executor } = setup();
  const service = createImplementationService({ repository, executor, workflowPolicy: { check: { command: "check", writeScope: ["src"] } } });
  await assert.rejects(() => service.runChecks("d1"), /apply evidence/i);
  repository.evidence.append({ id: "apply-other", deliveryId: "other", kind: "apply", exit_code: 0 });
  await assert.rejects(() => service.runChecks("d1"), /apply evidence/i);
  repository.evidence.append({ id: "apply-failed", deliveryId: "d1", kind: "apply", exit_code: 1 });
  await assert.rejects(() => service.runChecks("d1"), /apply evidence/i);
  repository.evidence.append({ id: "apply-ok", deliveryId: "d1", kind: "apply", command: "apply", exit_code: 0, checked_at: "now", summary: "ok" });
  await service.runChecks("d1");
});

test("pr-open persists pr-open result and delivery status", async () => {
  const { state, repository, executor } = setup();
  state.delivery = { ...state.delivery, phase: "implement", phaseStatus: "implementation-complete" };
  seedImplementationEvidence(repository);
  repository.evidence.append({ id: "review-ok", deliveryId: "d1", kind: "review", command: "review", exit_code: 0, commit: "abc", checked_at: "now", summary: "approved", result: "approved", independent: true });
  const service = createCloseDeliveryService({ repository, executor, policy: { "openspec-verify": { command: "verify", writeScope: ["openspec"] }, assertWritable: () => {} }, openspec: { archive: async () => ({ success: true, exitCode: 0, path: "/archived" }) }, git: { openPr: async () => ({ success: true, prUrl: "https://example.test/pr/1" }) } });
  await service.verifyDelivery("d1");
  await service.archiveOpenSpec("d1", { command: "archive", writeScope: ["openspec"], path: "/archived" });
  const result = await service.finishDelivery("d1", { branchAction: "pr-open", workspaceAction: "keep" });
  assert.equal(result.deliveryStatus, "pr-open");
  assert.equal(state.evidence.at(-1).result, "pr-open");
});

test("delete records the existing kept delivery status instead of fabricating merged", async () => {
  const { state, repository, executor } = setup();
  state.delivery = { ...state.delivery, phase: "implement", phaseStatus: "implementation-complete" };
  seedImplementationEvidence(repository);
  repository.evidence.append({ id: "review-ok", deliveryId: "d1", kind: "review", command: "review", exit_code: 0, commit: "abc", checked_at: "now", summary: "approved", result: "approved", independent: true });
  const service = createCloseDeliveryService({ repository, executor, policy: { "openspec-verify": { command: "verify", writeScope: ["openspec"] }, assertWritable: () => {} }, openspec: { archive: async () => ({ success: true, exitCode: 0, path: "/archived" }) }, git: { deleteBranch: async () => ({ success: true }) } });
  await service.verifyDelivery("d1");
  await service.archiveOpenSpec("d1", { command: "archive", writeScope: ["openspec"], path: "/archived" });
  const result = await service.finishDelivery("d1", { branchAction: "delete", workspaceAction: "keep", result: "kept" });
  assert.equal(result.deliveryStatus, "kept");
  assert.equal(state.evidence.at(-1).result, "kept");
});

test("requestReview requires complete successful check evidence", async () => {
  const incomplete = [
    { kind: "apply", command: "check", exit_code: 0, commit: "abc", checked_at: "now", summary: "ok" },
    { kind: "check", command: "", exit_code: 0, commit: "abc", checked_at: "now", summary: "ok" },
    { kind: "check", command: "check", exit_code: 0, commit: "", checked_at: "now", summary: "ok" },
    { kind: "check", command: "check", exit_code: 0, commit: "abc", checked_at: "", summary: "ok" },
    { kind: "check", command: "check", exit_code: 0, commit: "abc", checked_at: "now", summary: "" },
  ];
  for (const value of incomplete) {
    const { state, repository, executor } = setup();
    state.delivery = { ...state.delivery, phaseStatus: "testing" };
    repository.evidence.append({ id: `invalid-check-${Math.random()}`, deliveryId: "d1", ...value });
    const service = createImplementationService({ repository, executor, workflowPolicy: { review: { command: "review", writeScope: ["src"] } } });
    await assert.rejects(() => service.requestReview("d1"), /check evidence/);
  }
});

test("finish requires complete independent approved review evidence", async () => {
  const { state, repository, executor } = setup();
  state.delivery = { ...state.delivery, phase: "implement", phaseStatus: "implementation-complete" };
  seedImplementationEvidence(repository);
  const service = createCloseDeliveryService({ repository, executor, policy: { "openspec-verify": { command: "verify", writeScope: ["openspec"] }, assertWritable: () => {} }, openspec: { archive: async () => ({ success: true, exitCode: 0, path: "/archived" }) }, git: { merge: async () => ({ success: true }), removeWorktree: async () => ({ success: true }) } });
  await service.verifyDelivery("d1");
  await service.archiveOpenSpec("d1", { command: "archive", writeScope: ["openspec"], path: "/archived" });
  for (const review of [
    { result: "rejected", independent: true, command: "review", checked_at: "now", summary: "rejected", exit_code: 0 },
    { result: "approved", independent: false, command: "review", checked_at: "now", summary: "approved", exit_code: 0 },
    { result: "approved", independent: true, command: "", checked_at: "now", summary: "approved", exit_code: 0 },
    { result: "approved", independent: true, command: "review", checked_at: "", summary: "approved", exit_code: 0 },
    { result: "approved", independent: true, command: "review", checked_at: "now", summary: "", exit_code: 0 },
    { result: "approved", independent: true, command: "review", checked_at: "now", summary: "approved", exit_code: 1 },
  ]) {
    repository.evidence.append({ id: `review-${Math.random()}`, deliveryId: "d1", kind: "review", commit: "abc", ...review });
    await assert.rejects(() => service.finishDelivery("d1", { branchAction: "keep", workspaceAction: "keep" }), /review evidence/);
    state.evidence = state.evidence.filter((item) => item.kind !== "review");
  }
});

test("close accepts keep and handoff actions", async () => {
  const { state, repository, executor } = setup();
  state.delivery = { ...state.delivery, phase: "implement", phaseStatus: "implementation-complete" };
  seedImplementationEvidence(repository);
  repository.evidence.append({ id: "review-ok", deliveryId: "d1", kind: "review", command: "review", exit_code: 0, commit: "abc", checked_at: "now", summary: "approved", result: "approved", independent: true });
  const service = createCloseDeliveryService({ repository, executor, policy: { "openspec-verify": { command: "verify", writeScope: ["openspec"] }, assertWritable: () => {} }, openspec: { archive: async () => ({ success: true, exitCode: 0, path: "/archived" }) }, git: {} });
  await service.verifyDelivery("d1"); await service.archiveOpenSpec("d1", { command: "archive", writeScope: ["openspec"], path: "/archived" });
  await service.finishDelivery("d1", { branchAction: "keep", workspaceAction: "handoff", result: "kept" });
  assert.equal(state.delivery.phaseStatus, "closed");
});

test("merge and removeWorktree require strict success true and do not record finish evidence", async () => {
  for (const [port, action] of [["merge", "merge"], ["removeWorktree", "remove"]]) {
    const { state, repository, executor } = setup();
    state.delivery = { ...state.delivery, phase: "implement", phaseStatus: "implementation-complete" };
    seedImplementationEvidence(repository);
    repository.evidence.append({ id: "review-ok", deliveryId: "d1", kind: "review", command: "review", exit_code: 0, commit: "abc", checked_at: "now", summary: "approved", result: "approved", independent: true });
    const git = { [port]: async () => ({ success: false }) };
    const service = createCloseDeliveryService({ repository, executor, policy: { "openspec-verify": { command: "verify", writeScope: ["openspec"] }, assertWritable: () => {} }, openspec: { archive: async () => ({ success: true, exitCode: 0, path: "/archived" }) }, git });
    await service.verifyDelivery("d1");
    await service.archiveOpenSpec("d1", { command: "archive", writeScope: ["openspec"], path: "/archived" });
    await assert.rejects(() => service.finishDelivery("d1", { branchAction: action === "merge" ? "merge" : "keep", workspaceAction: action === "remove" ? "remove" : "keep", result: action === "merge" ? "merged" : "kept" }), /failed/);
    assert.equal(state.evidence.some((item) => item.kind === "finish"), false);
  }
});

test("runChecks rejects incomplete apply evidence", async () => {
  const incomplete = [
    { kind: "check", command: "apply", exit_code: 0, checked_at: "now", summary: "ok" },
    { kind: "apply", command: "", exit_code: 0, checked_at: "now", summary: "ok" },
    { kind: "apply", command: "apply", exit_code: 1, checked_at: "now", summary: "ok" },
    { kind: "apply", command: "apply", exit_code: 0, checked_at: "", summary: "ok" },
    { kind: "apply", command: "apply", exit_code: 0, checked_at: "now", summary: "" },
  ];
  for (const value of incomplete) {
    const { repository, executor } = setup();
    repository.evidence.append({ id: `invalid-${Math.random()}`, deliveryId: "d1", ...value });
    const service = createImplementationService({ repository, executor, workflowPolicy: { check: { command: "check", writeScope: ["src"] } } });
    await assert.rejects(() => service.runChecks("d1"), /apply evidence/);
  }
});

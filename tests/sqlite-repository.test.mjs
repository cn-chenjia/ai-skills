import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSqliteRepository } from "../infrastructure/persistence/sqlite-repository.mjs";
import { getLedgerDirectory, getLedgerPath } from "../infrastructure/persistence/ledger-path.mjs";

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xiaoqi-"));
  return { root, repository: createSqliteRepository({ planningRoot: root }) };
}

test("creates the SQLite ledger only below planningRoot/sprint-manage", () => {
  const { root, repository } = setup();
  assert.equal(getLedgerDirectory(root), path.join(root, "sprint-manage"));
  assert.equal(repository.path, getLedgerPath(root));
  assert.equal(fs.existsSync(repository.path), true);
  assert.deepEqual(fs.readdirSync(root), ["sprint-manage"]);
  assert.equal(fs.statSync(repository.path).isFile(), true);
  repository.close();
});

test("persists the domain records and exposes all required tables", () => {
  const { repository } = setup();
  const requirement = { id: "r1", title: "Feature", description: "desc", acceptanceCriteria: [], owner: null, status: "active" };
  const delivery = { id: "d1", requirementId: "r1", owner: null, phase: "start", phaseStatus: "draft", deliveryStatus: "not-started" };
  repository.requirements.create(requirement);
  repository.deliveries.create(delivery);
  repository.bindings.replaceForDelivery("d1", [
    { kind: "repository", repositoryId: "repo", path: "/repo", deliveryId: "d1" },
    { kind: "planning", changeId: "change", deliveryId: "d1" },
  ]);
  repository.workItems.create({ id: "w1", deliveryId: "d1", title: "Implement", status: "pending", dependencies: [] });
  repository.evidence.append({ id: "e1", deliveryId: "d1", kind: "check", command: "npm test", exit_code: 0, commit: "abc", checked_at: "2026-01-01", summary: "passed" });
  repository.events.append({ id: "a1", deliveryId: "d1", type: "created", actor: "test", created_at: "2026-01-01T00:00:00Z" });
  assert.deepEqual(repository.requirements.get("r1"), requirement);
  assert.deepEqual(repository.deliveries.get("d1"), delivery);
  assert.equal(repository.workItems.listByDelivery("d1").length, 1);
  assert.equal(repository.evidence.listByDelivery("d1").length, 1);
  assert.equal(repository.events.listByDelivery("d1")[0].type, "created");
  assert.equal(repository.bindings.listForDelivery("d1").length, 2);
  const tables = repository.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((row) => row.name);
  assert.deepEqual(tables.filter((name) => name !== "sqlite_sequence"), ["audit_events", "deliveries", "evidence", "planning_bindings", "repository_bindings", "requirements", "work_items"]);
  repository.close();
});

test("rejects duplicate identifiers and replaces bindings atomically", () => {
  const { repository } = setup();
  repository.requirements.create({ id: "r1", title: "Feature" });
  assert.throws(() => repository.requirements.create({ id: "r1", title: "Duplicate" }));
  repository.deliveries.create({ id: "d1", requirementId: "r1" });
  repository.bindings.replaceForDelivery("d1", [{ kind: "repository", repositoryId: "repo", path: "/repo", deliveryId: "d1" }]);
  repository.bindings.replaceForDelivery("d1", [{ kind: "planning", changeId: "change", deliveryId: "d1" }]);
  assert.deepEqual(repository.bindings.listForDelivery("d1").map(({ kind }) => kind), ["planning"]);
  repository.close();
});

test("rolls back a failed atomic operation", () => {
  const { repository } = setup();
  repository.requirements.create({ id: "r1", title: "Feature" });
  repository.deliveries.create({ id: "d1", requirementId: "r1" });
  assert.throws(() => repository.bindings.replaceForDelivery("d1", [
    { kind: "repository", repositoryId: "repo", path: "/repo", deliveryId: "d1" },
    { kind: "repository", repositoryId: "repo", path: "/duplicate", deliveryId: "d1" },
  ]));
  assert.deepEqual(repository.bindings.listForDelivery("d1"), []);
  repository.close();
});

test("round-trips nested JSON and maps database snake_case to domain camelCase", () => {
  const { repository } = setup();
  repository.requirements.create({ id: "r1", title: "Feature", acceptanceCriteria: [{ rule: "x", values: [1, { ok: true }] }] });
  repository.deliveries.create({ id: "d1", requirementId: "r1" });
  const workItem = { id: "w1", deliveryId: "d1", title: "Implement", dependencies: [{ id: "w0", metadata: { labels: ["a", "b"] } }] };
  repository.workItems.create(workItem);
  repository.bindings.replaceForDelivery("d1", [{ kind: "repository", repositoryId: "repo", path: "/repo", deliveryId: "d1", writeScope: ["src/**"], deliveryStatus: "coding", checks: { lint: true } }]);
  assert.deepEqual(repository.requirements.get("r1").acceptanceCriteria, [{ rule: "x", values: [1, { ok: true }] }]);
  assert.deepEqual(repository.workItems.listByDelivery("d1")[0].dependencies, workItem.dependencies);
  assert.deepEqual(repository.bindings.listForDelivery("d1")[0], { kind: "repository", repositoryId: "repo", path: "/repo", deliveryId: "d1", writeScope: ["src/**"], deliveryStatus: "coding", checks: { lint: true } });
  repository.close();
});

test("allows read-only WITH queries", () => {
  const { repository } = setup();
  assert.equal(repository.query("WITH cte_data AS (SELECT 1 AS value) SELECT value FROM cte_data")[0].value, 1);
  repository.close();
});

test("query accepts one read-only statement and rejects statement-boundary writes", () => {
  const { repository } = setup();
  assert.throws(() => repository.query("SELECT 1; SELECT 2"));
  assert.throws(() => repository.query("SELECT 1; ATTACH DATABASE ':memory:' AS other"));
  assert.throws(() => repository.query("SELECT 1; ANALYZE"));
  assert.throws(() => repository.query("SELECT 1 /* comment; */; -- trailing comment\n SELECT 2"));
  assert.doesNotThrow(() => repository.query("SELECT 'INSERT; ATTACH; ANALYZE' /* INSERT; */; -- trailing comment\n"));
  repository.close();
});

test("query is read-only and fills missing evidence and event timestamps", () => {
  const { repository } = setup();
  assert.throws(() => repository.query("INSERT INTO requirements (id, title) VALUES ('x', 'bad')"));
  assert.throws(() => repository.query("PRAGMA user_version = 42"));
  repository.evidence.append({ id: "e1", kind: "check", summary: "ok" });
  repository.events.append({ id: "a1", type: "created" });
  assert.match(repository.evidence.listByDelivery(null)[0].checkedAt, /T/);
  assert.match(repository.events.listByDelivery(null)[0].createdAt, /T/);
  repository.close();
});

test("updates delivery and work item statuses", () => {
  const { repository } = setup();
  repository.requirements.create({ id: "r1", title: "Feature" });
  repository.deliveries.create({ id: "d1", requirementId: "r1" });
  repository.workItems.create({ id: "w1", deliveryId: "d1", title: "Implement" });
  assert.equal(repository.deliveries.updateStatus("d1", { phase: "prepare", phaseStatus: "preparing", deliveryStatus: "coding" }).phaseStatus, "preparing");
  assert.equal(repository.workItems.updateStatus("w1", "done").status, "done");
  repository.close();
});

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getLedgerDirectory, getLedgerPath } from "./ledger-path.mjs";

const schema = fs.readFileSync(path.join(import.meta.dirname, "schema.sql"), "utf8");

function json(value, fallback) {
  return JSON.stringify(value ?? fallback);
}
function parse(value, fallback) {
  return value == null ? fallback : JSON.parse(value);
}
function now() {
  return new Date().toISOString();
}
function requirement(row) {
  if (!row) return undefined;
  return { id: row.id, title: row.title, description: row.description, acceptanceCriteria: parse(row.acceptance_criteria, []), owner: row.owner, status: row.status };
}
function delivery(row) {
  if (!row) return undefined;
  return { id: row.id, requirementId: row.requirement_id, owner: row.owner, phase: row.phase, phaseStatus: row.phase_status, deliveryStatus: row.delivery_status };
}
function workItem(row) {
  if (!row) return undefined;
  return { id: row.id, deliveryId: row.delivery_id, title: row.title, status: row.status, assignee: row.assignee, dependencies: parse(row.dependencies, []) };
}
function binding(row, kind) {
  if (kind === "repository") return { kind, repositoryId: row.repository_id, path: row.path, deliveryId: row.delivery_id, ...(row.branch == null ? {} : { branch: row.branch }), ...(row.worktree == null ? {} : { worktree: row.worktree }), ...(row.write_scope == null ? {} : { writeScope: parse(row.write_scope, row.write_scope) }), ...(row.delivery_status == null ? {} : { deliveryStatus: row.delivery_status }), ...(row.checks == null ? {} : { checks: parse(row.checks, row.checks) }) };
  return { kind, changeId: row.change_id, deliveryId: row.delivery_id };
}
function evidencePayload(value, timestamp) {
  const { checked_at: checkedAt, checkedAt: suppliedCheckedAt, ...rest } = value;
  return { ...rest, checkedAt: suppliedCheckedAt ?? checkedAt ?? timestamp };
}
function eventPayload(value, timestamp) {
  const { created_at: createdAt, createdAt: suppliedCreatedAt, ...rest } = value;
  return { ...rest, createdAt: suppliedCreatedAt ?? createdAt ?? timestamp };
}
function sqlTokens(sql) {
  const words = [];
  let word = "";
  let quote = null;
  let ended = false;
  const pushWord = () => { if (word) { words.push(word); word = ""; } };
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];
    if (quote) {
      if (character === quote) {
        if (next === quote) { index += 1; continue; }
        quote = null;
      }
      continue;
    }
    if (character === "-" && next === "-") {
      pushWord();
      index += 2;
      while (index < sql.length && sql[index] !== "\n") index += 1;
      index -= 1;
      continue;
    }
    if (character === "/" && next === "*") {
      pushWord();
      const end = sql.indexOf("*/", index + 2);
      if (end < 0) throw new Error("Public query is read-only");
      index = end + 1;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") { if (ended) throw new Error("Public query is read-only"); pushWord(); quote = character; continue; }
    if (character === "[") { if (ended) throw new Error("Public query is read-only"); pushWord(); quote = "]"; continue; }
    if (character === ";") { pushWord(); if (ended) throw new Error("Public query is read-only"); ended = true; continue; }
    if (ended && !/\s/.test(character)) throw new Error("Public query is read-only");
    if (/\w/.test(character)) word += character.toUpperCase();
    else pushWord();
  }
  if (quote) throw new Error("Public query is read-only");
  pushWord();
  return words;
}
function assertReadOnlyQuery(sql) {
  if (typeof sql !== "string") throw new Error("Public query is read-only");
  const words = sqlTokens(sql);
  const first = words[0];
  const forbidden = new Set(["PRAGMA", "ATTACH", "DETACH", "ANALYZE", "VACUUM", "INSERT", "UPDATE", "DELETE", "REPLACE", "CREATE", "ALTER", "DROP"]);
  if (!["SELECT", "EXPLAIN", "WITH"].includes(first) || words.some((word) => forbidden.has(word)) || (first === "WITH" && !words.includes("SELECT"))) throw new Error("Public query is read-only");
}

export function createSqliteRepository({ planningRoot }) {
  const directory = getLedgerDirectory(planningRoot);
  fs.mkdirSync(directory, { recursive: true });
  const dbPath = getLedgerPath(planningRoot);
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("BEGIN");
  try {
    db.exec(schema);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    db.close();
    throw error;
  }
  const finish = (callback) => {
    db.exec("BEGIN");
    try { const result = callback(); db.exec("COMMIT"); return result; } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
  };
  const repository = {
    path: dbPath,
    planningRoot: path.resolve(planningRoot),
    query: (sql, ...params) => {
      assertReadOnlyQuery(sql);
      return db.prepare(sql).all(...params);
    },
    createRequirementAndDelivery(requirementValue, deliveryValue) {
      finish(() => {
        db.prepare("INSERT INTO requirements (id,title,description,acceptance_criteria,owner,status) VALUES (?,?,?,?,?,?)").run(requirementValue.id, requirementValue.title, requirementValue.description ?? "", json(requirementValue.acceptanceCriteria, []), requirementValue.owner ?? null, requirementValue.status ?? "active");
        db.prepare("INSERT INTO deliveries (id,requirement_id,owner,phase,phase_status,delivery_status) VALUES (?,?,?,?,?,?)").run(deliveryValue.id, deliveryValue.requirementId, deliveryValue.owner ?? null, deliveryValue.phase ?? "start", deliveryValue.phaseStatus ?? "draft", deliveryValue.deliveryStatus ?? "not-started");
      });
      return { requirement: requirementValue, delivery: deliveryValue };
    },
    requirements: {
      create(value) { finish(() => db.prepare("INSERT INTO requirements (id,title,description,acceptance_criteria,owner,status) VALUES (?,?,?,?,?,?)").run(value.id, value.title, value.description ?? "", json(value.acceptanceCriteria, []), value.owner ?? null, value.status ?? "active")); return value; },
      get(id) { return requirement(db.prepare("SELECT * FROM requirements WHERE id=?").get(id)); },
    },
    deliveries: {
      create(value) { finish(() => db.prepare("INSERT INTO deliveries (id,requirement_id,owner,phase,phase_status,delivery_status) VALUES (?,?,?,?,?,?)").run(value.id, value.requirementId, value.owner ?? null, value.phase ?? "start", value.phaseStatus ?? "draft", value.deliveryStatus ?? "not-started")); return value; },
      get(id) { return delivery(db.prepare("SELECT * FROM deliveries WHERE id=?").get(id)); },
      updateStatus(id, value) { finish(() => db.prepare("UPDATE deliveries SET phase=?, phase_status=?, delivery_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(value.phase, value.phaseStatus, value.deliveryStatus, id)); return delivery(db.prepare("SELECT * FROM deliveries WHERE id=?").get(id)); },
    },
    bindings: {
      replaceForDelivery(deliveryId, values) { finish(() => { db.prepare("DELETE FROM repository_bindings WHERE delivery_id=?").run(deliveryId); db.prepare("DELETE FROM planning_bindings WHERE delivery_id=?").run(deliveryId); for (const value of values) { if (value.kind === "repository") db.prepare("INSERT INTO repository_bindings (delivery_id,repository_id,path,branch,worktree,write_scope,delivery_status,checks) VALUES (?,?,?,?,?,?,?,?)").run(deliveryId, value.repositoryId, value.path, value.branch ?? null, value.worktree ?? null, value.writeScope == null && value.write_scope == null ? null : json(value.writeScope ?? value.write_scope), value.deliveryStatus ?? value.delivery_status ?? null, value.checks == null ? null : json(value.checks)); else if (value.kind === "planning") db.prepare("INSERT INTO planning_bindings (delivery_id,change_id) VALUES (?,?)").run(deliveryId, value.changeId); } }); },
      listForDelivery(deliveryId) { return [...db.prepare("SELECT * FROM repository_bindings WHERE delivery_id IS ?").all(deliveryId).map((row) => binding(row, "repository")), ...db.prepare("SELECT * FROM planning_bindings WHERE delivery_id IS ?").all(deliveryId).map((row) => binding(row, "planning"))]; },
    },
    workItems: {
      create(value) { finish(() => db.prepare("INSERT INTO work_items (id,delivery_id,title,status,assignee,dependencies) VALUES (?,?,?,?,?,?)").run(value.id, value.deliveryId, value.title, value.status ?? "pending", value.assignee ?? null, json(value.dependencies, []))); return value; },
      listByDelivery(deliveryId) { return db.prepare("SELECT * FROM work_items WHERE delivery_id=? ORDER BY rowid").all(deliveryId).map(workItem); },
      get(id) { return workItem(db.prepare("SELECT * FROM work_items WHERE id=?").get(id)); },
      updateStatus(id, status) { finish(() => db.prepare("UPDATE work_items SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status, id)); return workItem(db.prepare("SELECT * FROM work_items WHERE id=?").get(id)); },
      updateAssignee(id, assignee) { finish(() => db.prepare("UPDATE work_items SET assignee=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(assignee, id)); return workItem(db.prepare("SELECT * FROM work_items WHERE id=?").get(id)); },
    },
    evidence: {
      append(value) { const timestamp = value.checkedAt ?? value.checked_at ?? now(); const payload = evidencePayload(value, timestamp); finish(() => db.prepare("INSERT INTO evidence (id,delivery_id,kind,payload,created_at) VALUES (?,?,?,?,?)").run(value.id, value.deliveryId ?? null, value.kind, json(payload), timestamp)); return payload; },
      listByDelivery(deliveryId) { return db.prepare("SELECT payload FROM evidence WHERE delivery_id IS ? ORDER BY rowid").all(deliveryId).map((row) => JSON.parse(row.payload)); },
    },
    events: {
      append(value) { const timestamp = value.createdAt ?? value.created_at ?? now(); const payload = eventPayload(value, timestamp); finish(() => db.prepare("INSERT INTO audit_events (id,delivery_id,type,actor,payload,created_at) VALUES (?,?,?,?,?,?)").run(value.id, value.deliveryId ?? null, value.type, value.actor ?? null, json(payload), timestamp)); return payload; },
      listByDelivery(deliveryId) { return db.prepare("SELECT payload FROM audit_events WHERE delivery_id IS ? ORDER BY rowid").all(deliveryId).map((row) => JSON.parse(row.payload)); },
    },
    close() { db.close(); },
  };
  return repository;
}

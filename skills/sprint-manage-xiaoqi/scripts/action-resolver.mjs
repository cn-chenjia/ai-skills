#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

const ACTIONS_BY_STATUS = new Map([
  ["not-started", { name: "apply", targetStatus: "coding" }],
  ["coding", { name: "check", targetStatus: "verified" }],
  ["verified", { name: "review", targetStatus: "reviewed" }],
  ["reviewed", { name: "openspec-verify", targetStatus: "ready" }],
]);

export function resolveNextAction(document = {}) {
  const status = document["交付状态"];
  const action = ACTIONS_BY_STATUS.get(status);
  return action ? { ...action } : null;
}

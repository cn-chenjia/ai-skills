#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

const ACTIONS_BY_STATUS = new Map([
  ["not-started", { name: "prepare-workspace", targetStatus: "not-started" }],
  ["coding", { name: "check", targetStatus: "verified" }],
  ["verified", { name: "review", targetStatus: "reviewed" }],
  ["reviewed", { name: "openspec-verify", targetStatus: "ready" }],
]);

export function resolveNextAction(document = {}) {
  const status = document["交付状态"];
  if (status === "not-started") {
    const decisions = Array.isArray(document.用户决策) ? document.用户决策 : [];
    const hasApprovedProposal = decisions.some(
      (decision) =>
        decision?.kind === "proposal-confirmation" &&
        decision?.outcome === "approved",
    );
    const hasImplementationApproval = decisions.some(
      (decision) =>
        decision?.kind === "implementation-start" &&
        decision?.outcome === "approved",
    );
    const repositories = Array.isArray(document.仓库) ? document.仓库 : [];
    const hasPreparedWorkspace =
      repositories.length > 0 && repositories.every(
        (repository) => repository?.branch && repository?.worktree,
      );
    if (!hasPreparedWorkspace) return { name: "prepare-workspace", targetStatus: "not-started" };
    if (hasApprovedProposal && hasImplementationApproval) {
      return { name: "apply", targetStatus: "coding" };
    }
    return null;
  }
  const action = ACTIONS_BY_STATUS.get(status);
  return action ? { ...action } : null;
}

export function compareRecommendedAction(document = {}) {
  const ledger = document.推荐动作 ?? null;
  const resolved = resolveNextAction(document);
  if (!ledger) {
    return { consistent: true, ledger, resolved, code: null };
  }
  const consistent = resolved?.name === ledger;
  return {
    consistent,
    ledger,
    resolved,
    code: consistent ? null : "recommended-action-mismatch",
  };
}

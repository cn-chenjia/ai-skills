import { transitionDelivery } from "../domain/workflow.mjs";

function error(message, code) { const result = new Error(message); result.code = code; return result; }
function scopesOverlap(left = [], right = []) {
  return left.some((a) => right.some((b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)));
}
function validateConflicts(repositories) {
  const branches = new Set();
  const worktrees = new Set();
  for (const repository of repositories) {
    if (repository.branch && branches.has(repository.branch)) throw new Error(`duplicate branch: ${repository.branch}`);
    if (repository.worktree && worktrees.has(repository.worktree)) throw new Error(`duplicate worktree: ${repository.worktree}`);
    if (repository.branch) branches.add(repository.branch);
    if (repository.worktree) worktrees.add(repository.worktree);
  }
  for (let i = 0; i < repositories.length; i += 1) for (let j = i + 1; j < repositories.length; j += 1) {
    if (scopesOverlap(repositories[i].writeScope, repositories[j].writeScope)) throw new Error("write scope overlap");
  }
}
function assertNoCycle(items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const visiting = new Set(); const visited = new Set();
  function visit(id) {
    if (!byId.has(id)) throw error(`unknown dependency: ${id}`, "unknown-dependency");
    if (visiting.has(id)) throw new Error("dependency cycle");
    if (visited.has(id)) return;
    visiting.add(id); for (const dependency of byId.get(id).dependencies ?? []) visit(typeof dependency === "string" ? dependency : dependency.id);
    visiting.delete(id); visited.add(id);
  }
  items.forEach((item) => visit(item.id));
}
function validateMode(mode, policy) {
  if (mode === undefined) return;
  if (typeof mode !== "string" || mode.trim() === "") throw error("invalid mode", "invalid-mode");
  const allowed = policy.allowedModes ?? ["current", "single-repository", "multi-repository", "repositories"];
  if (!allowed.includes(mode)) throw error(`invalid mode: ${mode}`, "invalid-mode");
}
function validatePolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) throw error("invalid policy", "invalid-policy");
  if (policy.allowedModes !== undefined && (!Array.isArray(policy.allowedModes) || policy.allowedModes.some((mode) => typeof mode !== "string" || !mode))) throw error("invalid policy allowedModes", "invalid-policy");
}

export function createPrepareDeliveryService({ repository, workspaceManager, policy = {} }) {
  validatePolicy(policy);
  function getItems(deliveryId) { return repository.workItems.listByDelivery(deliveryId); }
  function checkConflicts(deliveryId, repositories = (repository.bindings.listForDelivery?.(deliveryId) ?? []).filter((binding) => binding.kind === "repository")) {
    validateConflicts(repositories); assertNoCycle(getItems(deliveryId)); return [];
  }
  return {
    async prepareDelivery(deliveryId, { repositories = [], workItems = [], mode } = {}) {
      const delivery = repository.deliveries.get(deliveryId);
      if (!delivery || delivery.phaseStatus !== "approved" && delivery.phaseStatus !== "preparing") throw error("Plan must be approved before prepare", "plan-not-approved");
      validateMode(mode, policy);
      const items = getItems(deliveryId);
      assertNoCycle(items);
      const itemById = new Map(items.map((item) => [item.id, item]));
      const previousAssignees = new Map(items.map((item) => [item.id, item.assignee ?? null]));
      const previousDelivery = Object.fromEntries(Object.entries({ phase: delivery.phase, phaseStatus: delivery.phaseStatus, deliveryStatus: delivery.deliveryStatus, status: delivery.status }).filter(([, value]) => value !== undefined));
      for (const assignment of workItems) {
        if (!itemById.has(assignment.id)) throw error(`work item does not belong to delivery: ${assignment.id}`, "work-item-not-in-delivery");
        if (typeof assignment.assignee !== "string" || assignment.assignee.trim() === "") throw error("assignee is required", "invalid-assignee");
      }
      validateConflicts(repositories);
      const previousBindings = repository.bindings.listForDelivery?.(deliveryId) ?? [];
      const prepared = [];
      try {
        for (const repositoryInput of repositories) prepared.push(await workspaceManager.prepare(repositoryInput));
        const bindings = prepared.map(({ binding }) => binding);
        repository.bindings.replaceForDelivery(deliveryId, bindings.map((value) => ({ kind: "repository", deliveryId, ...value })));
        for (const assignment of workItems) await this.assignWorkItem(assignment.id, assignment.assignee);
        const next = delivery.phaseStatus === "approved" ? transitionDelivery(delivery, "preparing") : delivery;
        const ready = transitionDelivery(next, "workspace-ready");
        repository.deliveries.updateStatus(deliveryId, ready);
        repository.events?.append({ id: `workspace-ready:${deliveryId}:${Date.now()}`, deliveryId, type: "workspace-ready", payload: { mode, repositories: bindings.length } });
        return { delivery: ready, bindings };
      } catch (cause) {
        await workspaceManager.rollback?.(prepared);
        repository.bindings.replaceForDelivery(deliveryId, previousBindings);
        repository.deliveries.updateStatus(deliveryId, previousDelivery);
        for (const assignment of workItems) {
          const previous = previousAssignees.get(assignment.id) ?? null;
          if (typeof repository.workItems.updateAssignee === "function") await repository.workItems.updateAssignee(assignment.id, previous);
        }
        throw cause;
      }
    },
    checkConflicts,
    async assignWorkItem(workItemId, assignee) {
      if (typeof assignee !== "string" || assignee.trim() === "") throw error("assignee is required", "invalid-assignee");
      const item = typeof repository.workItems.get === "function" ? repository.workItems.get(workItemId) : undefined;
      if (!item) throw error("work item not found", "work-item-not-found");
      if (typeof repository.workItems.updateAssignee !== "function") throw new Error("repository.workItems.updateAssignee is required");
      return repository.workItems.updateAssignee(workItemId, assignee);
    },
  };
}

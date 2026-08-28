import { randomUUID } from "node:crypto";
import { transitionDelivery } from "../domain/workflow.mjs";
import { validateEvidence } from "../domain/evidence.mjs";

const id = (kind, deliveryId) => `${kind}:${deliveryId}:${randomUUID()}`;
function get(repository, deliveryId) { const value = repository.deliveries.get(deliveryId); if (!value) throw new Error(`Delivery not found: ${deliveryId}`); return value; }
function evidence(repository, deliveryId, value) { return repository.evidence.append(validateEvidence({ id: id(value.kind, deliveryId), deliveryId, ...value })); }
function listEvidence(repository, deliveryId) { return repository.evidence.listByDelivery(deliveryId); }
function isCommit(value) { return typeof value === "string" && /^[0-9a-f]{3,40}$/i.test(value.trim()) && !["unknown", "working-tree"].includes(value.trim().toLowerCase()); }
function move(repository, deliveryId, status) { const next = transitionDelivery(get(repository, deliveryId), status); repository.deliveries.updateStatus(deliveryId, next); return next; }

export function createCloseDeliveryService({ repository, executor, openspec, git, policy = {} }) {
  async function run(kind, deliveryId, input = {}) {
    if (!input.command || !input.writeScope) throw new Error(`${kind} command and write policy are required`);
    const result = await executor.run({ command: input.command, args: input.args ?? [], cwd: input.cwd, writeScope: input.writeScope });
    if (!result.success) throw Object.assign(new Error(`${kind} failed`), { result });
    return result;
  }
  return {
    async verifyDelivery(deliveryId, input = {}) {
      if (get(repository, deliveryId).phaseStatus !== "implementation-complete") throw new Error("Delivery must be implementation-complete before verify");
      const configured = policy["openspec-verify"] ?? {};
      const result = await run("openspec-verify", deliveryId, { ...configured, ...input });
      evidence(repository, deliveryId, { kind: "openspec-verify", command: input.command ?? "openspec-verify", exit_code: result.exitCode, commit: result.commit, checked_at: new Date().toISOString(), summary: result.stdout || "verified", result: "passed" });
      return move(repository, deliveryId, "verifying");
    },
    async archiveOpenSpec(deliveryId, input = {}) {
      if (get(repository, deliveryId).phaseStatus !== "verifying") throw new Error("Delivery must be verifying before archive");
      if (!input.command || !Array.isArray(input.writeScope) || input.writeScope.length === 0) throw new Error("archive command and write policy are required");
      const archivePath = input.path;
      if (!archivePath) throw new Error("archive target path is required");
      if (typeof policy.assertWritable !== "function") throw new Error("archive write policy is required");
      policy.assertWritable({ filePath: archivePath, path: archivePath, writeScope: input.writeScope, kind: "openspec-archive" });
      if (typeof openspec?.archive !== "function") throw new Error("OpenSpec archive port is required");
      const portResult = await openspec.archive(deliveryId, input);
      if (!portResult?.success || portResult.exitCode !== 0 || portResult.path !== archivePath) throw new Error("OpenSpec archive result is incomplete");
      evidence(repository, deliveryId, { kind: "archive", command: input.command ?? "archive", exit_code: portResult.exitCode, checked_at: new Date().toISOString(), summary: portResult.stdout || "archived", path: archivePath, outcome: "archived" });
      return move(repository, deliveryId, "archiving");
    },
    async closeDelivery(deliveryId, { verify = {}, archive = {}, finish = {}, ...input } = {}) {
      await this.verifyDelivery(deliveryId, verify);
      await this.archiveOpenSpec(deliveryId, archive);
      return this.finishDelivery(deliveryId, finish);
    },
    async finishDelivery(deliveryId, { branchAction = "keep", workspaceAction = "keep", result = { merge: "merged", keep: "kept", delete: "kept", "pr-open": "pr-open" }[branchAction], ...input } = {}) {
      const delivery = get(repository, deliveryId);
      const records = listEvidence(repository, deliveryId);
      if (!records.some((item) => item.kind === "apply" && item.exit_code === 0 && item.command && item.checked_at && item.summary)) throw new Error("Complete successful apply evidence is required before finish");
      if (!records.some((item) => item.kind === "check" && item.exit_code === 0 && item.command && item.commit && item.checked_at && item.summary)) throw new Error("Complete successful check evidence is required before finish");
      if (!records.some((item) => item.kind === "openspec-verify" && item.result === "passed" && item.exit_code === 0 && item.command && item.commit && item.checked_at && item.summary)) throw new Error("Complete successful verify evidence is required before finish");
      if (!records.some((item) => item.kind === "review" && item.result === "approved" && item.independent === true && item.exit_code === 0 && item.command && item.checked_at && item.summary)) throw new Error("Complete successful review evidence is required before finish");
      if (!records.some((item) => item.kind === "archive" && item.outcome === "archived" && item.exit_code === 0 && item.command && item.checked_at && item.summary && item.path)) throw new Error("Complete successful archive evidence is required before finish");
      if (delivery.phaseStatus !== "archiving" && delivery.phaseStatus !== "finishing") throw new Error("Delivery must be archived before finish");
      if (!["merge", "keep", "delete", "pr-open"].includes(branchAction)) throw new Error("invalid branchAction");
      if (!["remove", "keep", "handoff"].includes(workspaceAction)) throw new Error("invalid workspaceAction");
      const expectedResult = { merge: "merged", keep: "kept", delete: "kept", "pr-open": "pr-open" }[branchAction];
      if (!expectedResult || result !== expectedResult) throw new Error("finish result must match branchAction");
      const bindings = (repository.bindings?.listForDelivery?.(deliveryId) ?? []).filter((value) => value.kind === "repository");
      if (bindings.length === 0) throw new Error("Delivery repository binding is required before finish");
      const requestedRepositoryId = input.repositoryId;
      if (bindings.length > 1 && !requestedRepositoryId) throw new Error("repositoryId is required when delivery has multiple repository bindings");
      const binding = requestedRepositoryId
        ? bindings.find((value) => value.repositoryId === requestedRepositoryId)
        : bindings[0];
      if (!binding) throw new Error(`No delivery repository binding found for repositoryId: ${requestedRepositoryId}`);
      const gitInput = { ...input, ...binding, deliveryId };
      const branchPort = branchAction === "merge" ? "merge" : branchAction === "delete" ? "deleteBranch" : branchAction === "pr-open" ? "openPr" : null;
      if (branchPort && typeof git?.[branchPort] !== "function") throw new Error(`Git port for ${branchAction} is required`);
      if (workspaceAction === "remove" && typeof git?.removeWorktree !== "function") throw new Error("Git port for remove is required");
      if (branchAction === "merge") { const action = await git.merge(gitInput); if (action?.success !== true) throw new Error("Git merge failed"); }
      if (branchAction === "delete") { const action = await git.deleteBranch(gitInput); if (action?.success !== true) throw new Error("Git delete failed"); }
      if (branchAction === "pr-open") { const action = await git.openPr(gitInput); if (action?.success !== true || !action.prUrl) throw new Error("Real PR result is required"); }
      if (workspaceAction === "remove") { const action = await git.removeWorktree(gitInput); if (action?.success !== true) throw new Error("Git remove failed"); }
      const commit = isCommit(input.commit) ? input.commit.trim() : [...records].reverse().find((item) => isCommit(item.commit))?.commit;
      if (!commit) throw new Error("A real commit is required before finish");
      const finish = evidence(repository, deliveryId, { kind: "finish", command: input.command ?? "finish", exit_code: 0, commit, checked_at: new Date().toISOString(), summary: "closed", result, outcome: "completed", targetStatus: result });
      move(repository, deliveryId, "finishing");
      return move(repository, deliveryId, { phaseStatus: "closed", deliveryStatus: result });
    },
  };
}

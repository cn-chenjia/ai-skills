import { randomUUID } from "node:crypto";
import { transitionDelivery } from "../domain/workflow.mjs";
import { validateEvidence } from "../domain/evidence.mjs";

const id = (kind, deliveryId) => `${kind}:${deliveryId}:${randomUUID()}`;
function deliveryOf(repository, deliveryId) { const value = repository.deliveries.get(deliveryId); if (!value) throw new Error(`Delivery not found: ${deliveryId}`); return value; }
function append(repository, deliveryId, evidence) { return repository.evidence.append(validateEvidence({ id: id(evidence.kind, deliveryId), deliveryId, ...evidence })); }
function advance(repository, deliveryId, status) { const current = deliveryOf(repository, deliveryId); const next = transitionDelivery(current, status); repository.deliveries.updateStatus(deliveryId, next); return next; }

export function createImplementationService({ repository, executor, workflowPolicy = {} }) {
  async function command(kind, deliveryId, input = {}) {
    const configured = workflowPolicy[kind];
    if (!configured?.command && !input.command) throw new Error(`${kind} command policy is required`);
    if (!configured?.writeScope && !input.writeScope) throw new Error(`${kind} write policy is required`);
    const result = await executor.run({ command: input.command ?? configured.command, args: input.args ?? configured.args ?? [], cwd: input.cwd, writeScope: input.writeScope ?? configured.writeScope });
    if (!result.success || result.exitCode !== 0) throw Object.assign(new Error(`${kind} failed`), { result });
    const value = { kind, exit_code: result.exitCode, command: input.command ?? configured.command ?? kind, commit: result.commit, checked_at: new Date().toISOString(), summary: result.stdout || `${kind} passed` };
    if (kind === "review") {
      if (result.result !== "approved" || result.independent !== true) throw Object.assign(new Error("Independent review approval is required"), { result });
      value.result = result.result;
      value.independent = result.independent;
    }
    return append(repository, deliveryId, value);
  }
  return {
    async runTdd(workItemId, input) {
      const item = repository.workItems.get(workItemId); if (!item) throw new Error(`Work item not found: ${workItemId}`);
      const delivery = deliveryOf(repository, item.deliveryId);
      if (!["workspace-ready", "implementing"].includes(delivery.phaseStatus)) throw new Error("runTdd requires workspace-ready or implementing delivery");
      const original = delivery;
      if (delivery.phaseStatus === "workspace-ready") advance(repository, item.deliveryId, "implementing");
      try {
        const evidence = await command("apply", item.deliveryId, input); repository.workItems.updateStatus(workItemId, "in-progress"); return evidence;
      } catch (error) {
        if (original.phaseStatus === "workspace-ready") repository.deliveries.updateStatus(item.deliveryId, original);
        repository.events.append({ id: `apply-failed:${item.deliveryId}:${randomUUID()}`, deliveryId: item.deliveryId, type: "apply-failed", actor: "system", payload: { command: input?.command ?? "apply", exit_code: error.result?.exitCode ?? 1, summary: error.result?.stderr ?? error.message } });
        throw error;
      }
    },
    async runChecks(deliveryId, input) {
      const delivery = deliveryOf(repository, deliveryId);
      if (delivery.phaseStatus !== "implementing") throw new Error("runChecks requires implementing delivery");
      const records = repository.evidence.listByDelivery(deliveryId);
      if (!records.some((item) => item.kind === "apply" && item.command && item.exit_code === 0 && item.checked_at && item.summary)) throw new Error("Complete successful apply evidence is required before checks");
      const evidence = await command("check", deliveryId, input);
      if (evidence.kind !== "check" || evidence.exit_code !== 0) throw new Error("Successful check evidence is required");
      return advance(repository, deliveryId, "testing");
    },
    async requestReview(deliveryId, input) {
      const delivery = deliveryOf(repository, deliveryId);
      if (delivery.phaseStatus !== "testing") throw new Error("requestReview requires testing delivery");
      const records = repository.evidence.listByDelivery(deliveryId);
      if (!records.some((item) => item.kind === "check" && item.exit_code === 0 && item.command && item.commit && item.checked_at && item.summary)) throw new Error("Complete successful check evidence is required before review");
      await command("review", deliveryId, input);
      advance(repository, deliveryId, "reviewing");
      return advance(repository, deliveryId, "implementation-complete");
    },
    recordImplementationEvidence(deliveryId, evidence) { return append(repository, deliveryId, evidence); },
  };
}

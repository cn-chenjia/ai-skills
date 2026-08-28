import crypto from "node:crypto";
import process from "node:process";

import { createSqliteRepository } from "./persistence/sqlite-repository.mjs";
import { resolveOpenSpecContext } from "../skills/sprint-manage-xiaoqi/scripts/openspec-context.mjs";
import { createCommandExecutor } from "./execution/command-executor.mjs";
import { assertNormalizedEvent } from "../skills/sprint-manage-xiaoqi/scripts/core/event-contract.mjs";

const ACTIONS = {
  coding: { name: "check", targetStatus: "verified" },
  verified: { name: "review", targetStatus: "reviewed" },
  reviewed: { name: "openspec-verify", targetStatus: "ready" },
};

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function resolveDeliveryId(repository, deliveryId) {
  if (deliveryId) return deliveryId;
  const rows = repository.query("SELECT id FROM deliveries ORDER BY rowid");
  if (rows.length === 1) return rows[0].id;
  return undefined;
}

function createHandler({ repository, deliveryId }) {
  return {
    handleEvent(event) {
      try {
        assertNormalizedEvent(event);
      } catch (error) {
        return { version: 1, decision: "deny", reason: error?.code ?? error?.message ?? "invalid-normalized-event" };
      }
      if (event.event === "unknown") return { version: 1, decision: "deny", reason: "unknown-event" };
      const selected = event.deliveryId ?? deliveryId;
      const delivery = selected ? repository.deliveries.get(selected) : undefined;
      if (!delivery) return { version: 1, decision: "deny", reason: "control-plane-handler-missing" };
      repository.events.append({
        id: id("event"),
        deliveryId: selected,
        type: event.event,
        actor: event.actor,
        payload: event,
      });
      return { version: 1, decision: "allow", reason: `control-plane-${event.event}` };
    },
  };
}

function createRunner({ repository, deliveryId, executeAction }) {
  const selectDelivery = () => {
    const selected = resolveDeliveryId(repository, deliveryId);
    if (!selected) throw new Error("delivery-id-required");
    const delivery = repository.deliveries.get(selected);
    if (!delivery) throw new Error(`delivery-not-found: ${selected}`);
    return delivery;
  };
  return {
    async getState() {
      const delivery = selectDelivery();
      return { deliveryStatus: delivery.deliveryStatus, workflowStatus: delivery.phaseStatus, delivery };
    },
    async runAction(action, state) {
      return executeAction(action, state);
    },
    async advance({ targetStatus, evidence, owner }) {
      const delivery = selectDelivery();
      const phase = targetStatus === "ready" ? "close" : delivery.phase;
      const phaseStatus = targetStatus === "verified" ? "testing" : targetStatus === "reviewed" ? "reviewing" : targetStatus === "ready" ? "closed" : delivery.phaseStatus;
      repository.deliveries.updateStatus(delivery.id, { phase, phaseStatus, deliveryStatus: targetStatus });
      repository.evidence.append({ id: id("evidence"), deliveryId: delivery.id, ...evidence, owner });
      repository.events.append({ id: id("event"), deliveryId: delivery.id, type: "delivery-transition", actor: owner, payload: { from: delivery.deliveryStatus, to: targetStatus, evidence } });
    },
    async recordFailure({ action, summary, owner }) {
      const selected = resolveDeliveryId(repository, deliveryId);
      if (selected && repository.deliveries.get(selected)) repository.events.append({ id: id("event"), deliveryId: selected, type: "automation-failure", actor: owner, payload: { action, summary } });
    },
  };
}

export function createControlPlaneRuntime({
  planningRoot,
  cwd = process.cwd(),
  deliveryId,
  repository: injectedRepository,
  executeAction,
  commands,
  policy = {},
  context,
} = {}) {
  const resolvedContext = context ?? (planningRoot ? undefined : resolveOpenSpecContext(cwd));
  const root = planningRoot ?? resolvedContext?.rootPath;
  if (!root) throw new Error("openspec-planning-root-required");
  const repository = injectedRepository ?? createSqliteRepository({ planningRoot: root });
  const executor = executeAction ?? (async (action) => {
    const config = commands?.[action.name];
    if (!config?.command) return { outcome: "needs_confirmation", summary: `未配置动作 ${action.name} 的执行命令` };
    const commandExecutor = createCommandExecutor({
      executeCommand: async (command, args, options) => import("node:child_process").then(({ execFile }) => new Promise((resolve) => {
        execFile(command, args, { cwd: options.cwd, windowsHide: true }, (error, stdout, stderr) => resolve({ exitCode: error?.code ?? 0, stdout, stderr }));
      })),
      policy: {
        assertCommand: () => {},
        assertWritable: () => {},
      },
    });
    const result = await commandExecutor.run({ command: config.command, args: config.args ?? [], cwd, writeScope: config.writeScope ?? ["."], requireCommit: false });
    if (!result.success) return { outcome: "failed", summary: result.stderr, exit_code: result.exitCode };
    return { kind: config.kind ?? action.name, command: [config.command, ...(config.args ?? [])].join(" "), exit_code: 0, commit: result.commit ?? "unknown", checked_at: new Date().toISOString(), summary: config.summary ?? result.stdout.trim() };
  });
  const runtime = {
    planningRoot: repository.planningRoot,
    context: resolvedContext,
    repository,
    handler: createHandler({ repository, deliveryId }),
    runner: createRunner({ repository, deliveryId, executeAction: executor }),
    resolveNextAction(state) {
      return ACTIONS[state.deliveryStatus];
    },
    close() {
      if (!injectedRepository) repository.close();
    },
  };
  runtime.handleEvent = runtime.handler.handleEvent;
  return runtime;
}

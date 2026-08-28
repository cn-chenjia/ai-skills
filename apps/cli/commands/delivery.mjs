import { createStartDeliveryService } from "../../../application/start-delivery.mjs";
import { createPrepareDeliveryService } from "../../../application/prepare-delivery.mjs";
import { createImplementationService } from "../../../application/implement-work-item.mjs";
import { createCloseDeliveryService } from "../../../application/close-delivery.mjs";
import path from "node:path";
import { assertWritablePath } from "../../../adapters/openspec/artifact-policy.mjs";

function input(options, writeScope = options.writeScope ?? ["."]) {
  return { command: options.command, args: options.args ?? [], cwd: options.cwd, writeScope };
}

export async function runDeliveryCommand({ action, deliveryId, options, services }) {
  const id = deliveryId ?? options.id ?? options.deliveryId;
  if (!id) throw new Error("参数 delivery-id 不能为空");
  if (action === "start") {
    if (options.title) return services.start.createRequirement({ id: options.requirementId ?? options.id, deliveryId: id, title: options.title });
    return services.start.startDelivery({ requirementId: options.requirementId ?? options.requirement ?? options.id ?? id, deliveryId: id, owner: options.owner });
  }
  if (action === "approve" || action === "plan-approve") return services.start.approvePlan(id, options.actor ?? "cli");
  if (action === "reject" || action === "plan-reject") return services.start.rejectPlan(id, options.actor ?? "cli", options.reason);
  if (action === "prepare") return services.prepare.prepareDelivery(id, { mode: options.mode });
  if (action === "implement") {
    if (!options.workItemId) throw new Error("参数 --work-item-id 不能为空");
    return services.implementation.runTdd(options.workItemId, input(options));
  }
  if (action === "checks" || action === "check") return services.implementation.runChecks(id, input(options));
  if (action === "review") return services.implementation.requestReview(id, input(options));
  if (action === "verify") return services.close.verifyDelivery(id, input(options));
  if (action === "archive") return services.close.archiveOpenSpec(id, {
    command: options.archiveCommand ?? options.command ?? "archive",
    args: options.archiveArgs ? options.archiveArgs.split(" ") : ["archive", id],
    cwd: services.planningRoot ?? services.openspec.planningRoot,
    writeScope: ["openspec"],
    path: options.archivePath ?? options.path ?? path.join(services.planningRoot ?? services.openspec.planningRoot, "openspec", "archive", id),
  });
  if (action === "close") return services.close.closeDelivery(id, {
    verify: { command: options.verifyCommand ?? "verify", args: options.verifyArgs ? options.verifyArgs.split(" ") : [], writeScope: ["openspec"], cwd: services.planningRoot ?? services.openspec.planningRoot },
    archive: { command: options.archiveCommand ?? "openspec", args: options.archiveArgs ? options.archiveArgs.split(" ") : ["archive", id], cwd: services.planningRoot ?? services.openspec.planningRoot, writeScope: ["openspec"], path: options.archivePath ?? options.path ?? path.join(services.planningRoot ?? services.openspec.planningRoot, "openspec", "archive", id) },
    finish: { branchAction: options.branchAction ?? "keep", workspaceAction: options.workspaceAction ?? "keep", result: options.result ?? "kept", ...input(options) },
  });
  throw new Error("用法: delivery start|approve|prepare|implement|checks|review|verify|archive|close <delivery-id>");
}

export function createDeliveryServices({ repository, openspec, workspaceManager, executor, git, planningRoot }) {
  return {
    planningRoot,
    openspec,
    start: createStartDeliveryService({ repository, openspec }),
    prepare: createPrepareDeliveryService({ repository, workspaceManager }),
    implementation: createImplementationService({ repository, executor, workflowPolicy: { apply: { command: "apply", writeScope: ["."] } } }),
    close: createCloseDeliveryService({
      repository,
      executor,
      openspec,
      git,
      policy: {
        "openspec-verify": { command: "verify", writeScope: ["openspec"] },
        assertWritable: ({ filePath, kind }) =>
          assertWritablePath({ planningRoot: planningRoot ?? openspec?.planningRoot ?? repository?.planningRoot, filePath, kind }),
      },
    }),
  };
}

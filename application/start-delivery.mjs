import { randomUUID } from "node:crypto";
import { createDelivery, createRequirement, transitionDelivery, validatePlanningBinding } from "../domain/index.mjs";

function eventId(type, deliveryId) {
  return `${type}:${deliveryId}:${randomUUID()}`;
}

function assertDelivery(repository, deliveryId) {
  const delivery = repository.deliveries.get(deliveryId);
  if (!delivery) throw new Error(`Delivery not found: ${deliveryId}`);
  return delivery;
}

function assertArtifact(openspec, filePath) {
  if (!filePath) return;
  if (typeof openspec.assertArtifactPath === "function") {
    openspec.assertArtifactPath(filePath);
    return;
  }
  if (typeof openspec.assertWritablePath === "function") {
    openspec.assertWritablePath({ planningRoot: openspec.planningRoot, filePath, kind: "openspec" });
    return;
  }
  throw new Error("OpenSpec artifact policy is required");
}

export function createStartDeliveryService({ repository, openspec }) {
  return {
    startDelivery(input) {
      if (!input.deliveryId) throw new Error("delivery-id is required");
      const requirementId = input.requirementId ?? input.id ?? input.deliveryId;
      const requirement = repository.requirements.get(requirementId);
      if (!requirement) throw new Error(`缺少需求信息: 未找到需求 ${requirementId ?? "(未提供 requirement-id)"}`);
      const delivery = createDelivery({ id: input.deliveryId, requirementId: requirement.id, owner: input.owner });
      if (typeof repository.deliveries.create !== "function") throw new Error("repository.deliveries.create is required");
      repository.deliveries.create(delivery);
      return { requirement, delivery };
    },

    createRequirement(input) {
      if (typeof repository.createRequirementAndDelivery !== "function") {
        throw new Error("repository.createRequirementAndDelivery is required for atomic requirement and delivery creation");
      }
      const requirement = createRequirement(input);
      const delivery = createDelivery({ id: input.deliveryId, requirementId: requirement.id, owner: input.owner });
      repository.createRequirementAndDelivery(requirement, delivery);
      return { requirement, delivery };
    },

    attachPlanningChange(deliveryId, planningBinding) {
      assertDelivery(repository, deliveryId);
      const binding = validatePlanningBinding({ ...planningBinding, kind: "planning", deliveryId });
      repository.bindings.replaceForDelivery(deliveryId, [binding]);
      return binding;
    },

    recordArtifactReferences(deliveryId, references) {
      assertDelivery(repository, deliveryId);
      const specPaths = references.specPaths ?? [];
      if (!Array.isArray(specPaths) || specPaths.some((value) => typeof value !== "string")) throw new Error("specPaths must be an array of strings");
      const normalized = {
        ...(references.proposalPath ? { proposalPath: references.proposalPath } : {}),
        ...(references.designPath ? { designPath: references.designPath } : {}),
        ...(references.tasksPath ? { tasksPath: references.tasksPath } : {}),
        specPaths,
      };
      [normalized.proposalPath, normalized.designPath, normalized.tasksPath, ...normalized.specPaths].forEach((filePath) => assertArtifact(openspec, filePath));
      repository.events.append({
        id: eventId("artifact-references-recorded", deliveryId),
        deliveryId,
        type: "artifact-references-recorded",
        payload: normalized,
      });
      return normalized;
    },

    approvePlan(deliveryId, actor) {
      const delivery = assertDelivery(repository, deliveryId);
      const approved = transitionDelivery(delivery, "approved");
      repository.deliveries.updateStatus(deliveryId, approved);
      repository.events.append({ id: eventId("plan-approved", deliveryId), deliveryId, type: "plan-approved", actor, payload: {} });
      return repository.deliveries.get(deliveryId);
    },

    rejectPlan(deliveryId, actor, reason) {
      const delivery = assertDelivery(repository, deliveryId);
      const rejected = transitionDelivery(delivery, "rejected");
      repository.deliveries.updateStatus(deliveryId, rejected);
      repository.events.append({ id: eventId("plan-rejected", deliveryId), deliveryId, type: "plan-rejected", actor, payload: { reason } });
      return repository.deliveries.get(deliveryId);
    },

    prepareDelivery(deliveryId) {
      const delivery = assertDelivery(repository, deliveryId);
      if (delivery.phaseStatus !== "approved") {
        const error = new Error("Plan must be approved before prepare");
        error.code = "plan-not-approved";
        throw error;
      }
      const preparing = transitionDelivery(delivery, "preparing");
      repository.deliveries.updateStatus(deliveryId, preparing);
      return repository.deliveries.get(deliveryId);
    },
  };
}

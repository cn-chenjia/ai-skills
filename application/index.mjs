import { createStartDeliveryService } from "./start-delivery.mjs";
import { createPrepareDeliveryService } from "./prepare-delivery.mjs";
import { createImplementationService } from "./implement-work-item.mjs";
import { createCloseDeliveryService } from "./close-delivery.mjs";

export { createStartDeliveryService, createPrepareDeliveryService, createImplementationService, createCloseDeliveryService };

export function createPlatform({ planningContext, repository, workflow, openspec = planningContext?.openspec }) {
  const startDeliveryService = createStartDeliveryService({ repository, openspec });
  return {
    requirementService: startDeliveryService,
    deliveryService: startDeliveryService,
    statusService: { planningContext, repository, workflow },
  };
}

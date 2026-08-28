export function runStatusCommand({ repository, options }) {
  if (options.deliveryId) {
    const delivery = repository.deliveries.get(options.deliveryId);
    if (!delivery) throw new Error(`未找到交付: ${options.deliveryId}`);
    return { delivery, requirement: repository.requirements.get(delivery.requirementId), bindings: repository.bindings.listForDelivery(options.deliveryId), workItems: repository.workItems.listByDelivery(options.deliveryId) };
  }
  const deliveries = repository.query("SELECT id, requirement_id AS requirementId, owner, phase, phase_status AS phaseStatus, delivery_status AS deliveryStatus FROM deliveries ORDER BY rowid");
  return { deliveries };
}

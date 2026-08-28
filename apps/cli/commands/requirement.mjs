import { randomUUID } from "node:crypto";
import { createStartDeliveryService } from "../../../application/start-delivery.mjs";

export async function runRequirementCommand({ action, options, repository, openspec }) {
  if (action !== "create") throw new Error("用法: requirement create --title <标题> [--id <需求ID>] [--delivery-id <交付ID>]");
  const title = options.title;
  if (!title) throw new Error("参数 --title 不能为空");
  const id = options.id ?? `req-${randomUUID()}`;
  const deliveryId = options.deliveryId ?? `delivery-${randomUUID()}`;
  const service = createStartDeliveryService({ repository, openspec });
  return service.createRequirement({ id, deliveryId, title, description: options.description, owner: options.owner, acceptanceCriteria: options.acceptanceCriteria ?? [] });
}

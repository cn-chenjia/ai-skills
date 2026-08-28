function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function validateWorkItem(workItem) {
  if (!workItem || typeof workItem !== "object") throw new Error("WorkItem must be an object");
  for (const field of ["id", "deliveryId", "title"]) {
    if (typeof workItem[field] !== "string" || workItem[field].trim() === "") {
      throw new Error(`WorkItem requires ${field}`);
    }
  }
  if (workItem.dependencies !== undefined && !Array.isArray(workItem.dependencies)) {
    throw new Error("WorkItem dependencies must be an array");
  }
  return freeze(clone({
    ...workItem,
    dependencies: workItem.dependencies ?? [],
    status: workItem.status ?? "pending",
  }));
}

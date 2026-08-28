function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function createRequirement({ id, title, description, acceptanceCriteria, owner }) {
  if (!id || !title) throw new Error("Requirement id and title are required");
  return freeze({
    id,
    title,
    description: description ?? "",
    acceptanceCriteria: acceptanceCriteria ?? [],
    owner: owner ?? null,
    status: "active",
  });
}

const definitions = {
  apply: { fields: ["command", "exit_code", "checked_at", "summary"] },
  check: { fields: ["command", "exit_code", "commit", "checked_at", "summary"] },
  review: { fields: ["command", "exit_code", "commit", "checked_at", "summary", "result", "independent"], result: "approved" },
  "openspec-verify": { fields: ["command", "exit_code", "commit", "checked_at", "summary", "result"], result: "passed" },
  archive: { fields: ["command", "exit_code", "checked_at", "summary", "path", "outcome"], outcomes: ["passed", "completed", "archived"] },
  finish: { fields: ["command", "exit_code", "commit", "checked_at", "summary", "result", "outcome"], results: ["pr-open", "merged", "kept"], outcomes: ["passed", "completed", "archived"] },
};

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

export function validateEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") throw new Error("Evidence must be an object");
  const definition = definitions[evidence.kind];
  if (!definition) throw new Error(`Unsupported evidence kind: ${evidence.kind}`);
  for (const field of definition.fields) {
    if (evidence[field] === undefined || evidence[field] === null || (typeof evidence[field] === "string" && evidence[field].trim() === "")) throw new Error(`Evidence requires ${field}`);
  }
  if (definition.result && evidence.result !== definition.result) throw new Error(`Evidence result must be ${definition.result}`);
  if (evidence.kind === "review" && evidence.independent !== true) throw new Error("Review evidence must be independent");
  if (definition.results && !definition.results.includes(evidence.result)) throw new Error(`Evidence result is invalid for ${evidence.kind}`);
  if (definition.outcomes && !definition.outcomes.includes(evidence.outcome)) throw new Error(`Evidence outcome is invalid for ${evidence.kind}`);
  if (evidence.targetStatus !== undefined && typeof evidence.targetStatus !== "string") throw new Error("Evidence targetStatus must be a string");
  if (evidence.kind === "finish" && evidence.targetStatus !== undefined && evidence.result !== evidence.targetStatus) throw new Error("Evidence finish result must equal targetStatus");
  if (evidence.exit_code !== 0) throw new Error("Evidence exit_code must be 0");
  if (["apply", "check", "openspec-verify", "finish"].includes(evidence.kind)) {
    if (typeof evidence.commit !== "string" || !evidence.commit.trim() || evidence.commit.trim().toLowerCase() === "unknown") {
      throw new Error(`Evidence ${evidence.kind} requires a locatable commit`);
    }
  }
  return freeze(clone(evidence));
}

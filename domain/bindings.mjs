function invalid(message, code = "invalid-binding") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validate(binding, fields, kind) {
  if (!binding || typeof binding !== "object") throw invalid(`${kind} binding must be an object`);
  for (const field of fields) {
    if (typeof binding[field] !== "string" || binding[field].trim() === "") {
      throw invalid(`${kind} binding requires ${field}`);
    }
  }
  return Object.freeze({ ...binding, kind });
}

export function validateRepositoryBinding(binding) {
  return validate(binding, ["repositoryId", "path", "deliveryId"], "repository");
}

export function validatePlanningBinding(binding) {
  return validate(binding, ["changeId", "deliveryId"], "planning");
}

import process from "node:process";

const FINAL_DELIVERY_STATES = new Set(["pr-open", "merged", "kept"]);

function successful(result) {
  const evidence = result?.evidence ?? result;
  return Boolean(evidence?.kind && evidence?.command && evidence.exit_code === 0 && evidence.commit && evidence.checked_at && evidence.summary);
}

export async function runAutomation({ owner, controlPlane, executeAction, repairAction, maxSteps = 20, maxRepairAttempts = 3 } = {}) {
  const plane = controlPlane?.runner ?? controlPlane;
  if (!plane?.getState || !plane?.runAction) throw new Error("control-plane-handler-missing");
  const steps = [];
  const repairs = [];
  const counts = new Map();

  for (let index = 0; index < maxSteps; index += 1) {
    const state = await plane.getState();
    const status = state.deliveryStatus ?? state["交付状态"];
    if (status === "ready" || FINAL_DELIVERY_STATES.has(status)) return { status, steps, repairs };
    if ((state.workflowStatus ?? state["流程状态"]) === "blocked") return { status: "blocked", steps, repairs };
    const action = controlPlane.resolveNextAction?.(state);
    if (!action?.name || !action?.targetStatus) return { status: "needs-confirmation", summary: "unable to resolve the next action", steps, repairs };

    let result;
    for (;;) {
      try { result = await (executeAction ?? ((value, current) => plane.runAction(value, current))); }
      catch (error) { result = { outcome: "failed", summary: error.message }; }
      if (result?.outcome === "needs_confirmation") return { status: "needs-confirmation", summary: result.summary, action: action.name, steps, repairs };
      const failed = result?.outcome === "failed" || result?.exit_code !== undefined && result.exit_code !== 0;
      if (!failed) break;
      const key = `${action.name}|${result.summary ?? result.stderr ?? "failed"}`;
      const attempts = counts.get(key) ?? 0;
      if (!repairAction || attempts >= maxRepairAttempts) return { status: "blocked", summary: result.summary ?? result.stderr ?? `action ${action.name} failed`, action: action.name, steps, repairs };
      counts.set(key, attempts + 1);
      const repair = await repairAction({ ...result, action: action.name, attempt: attempts + 1 }, state);
      repairs.push({ action: action.name, attempt: attempts + 1, summary: repair?.summary ?? "automatic repair attempted", outcome: repair?.outcome ?? "repaired" });
      if (repair?.outcome !== "repaired") return { status: "blocked", summary: repair?.summary ?? "automatic repair failed", action: action.name, steps, repairs };
    }

    const evidence = result?.evidence ?? result;
    if (!successful(result)) return { status: "blocked", summary: `action ${action.name} returned incomplete evidence`, action: action.name, steps, repairs };
    await plane.advance({ targetStatus: action.targetStatus, evidence, owner });
    steps.push({ action: action.name, targetStatus: action.targetStatus, evidenceKind: evidence.kind });
  }
  return { status: "blocked", summary: `automatic execution exceeded ${maxSteps} steps`, steps, repairs };
}

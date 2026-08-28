import assert from "node:assert/strict";
import test from "node:test";

import { handleNormalizedEvent, normalizedExitCode } from "../scripts/core/hook-runtime.mjs";
import { handle } from "../scripts/generic-hook.mjs";

const context = { planningRoot: "e:/plans", deliveryId: "delivery-a" };

function plane(decision = "allow") {
  return { handleEvent: () => ({ decision }) };
}

test("generic runtime denies unknown events and missing control-plane context", () => {
  assert.equal(handle({ event: "future-event" }).decision, "deny");
  assert.equal(handle({ event: "before-action", planningRoot: "e:/plans" }).reason, "delivery-id-required");
  assert.equal(handleNormalizedEvent({ version: 1, source: "generic-json", event: "before-action", ...context, action: { name: "shell", command: "npm test" } }).reason, "control-plane-handler-missing");
});

test("generic runtime preserves normalized allow and deny decisions", () => {
  const allowed = handleNormalizedEvent({ version: 1, source: "generic-json", event: "session-start", ...context }, { controlPlane: plane() });
  assert.equal(allowed.decision, "allow");
  assert.equal(allowed.version, 1);
  const denied = handleNormalizedEvent({ version: 1, source: "generic-json", event: "before-action", ...context, action: { name: "shell", command: "git reset --hard HEAD" } }, { controlPlane: plane() });
  assert.equal(denied.decision, "deny");
  assert.equal(normalizedExitCode(denied), 2);
});

test("generic executable failures use version 1 deny output and stable exit code", () => {
  const result = handle({ event: "before-action", ...context, action: { name: "shell", command: "npm test" } });
  assert.deepEqual(result, { version: 1, decision: "deny", reason: "control-plane-handler-missing" });
  assert.equal(normalizedExitCode(result), 2);
});

import assert from "node:assert/strict";
import test from "node:test";

import { handleTraeNormalizedEvent, handleTraePayload, normalizeTraeEvent, toTraeResponse, traeExitCode } from "../scripts/adapters/trae.mjs";

const context = { planningRoot: "e:/plans", deliveryId: "delivery-a" };
const plane = { handleEvent: () => ({ decision: "allow" }) };

test("Trae adapter normalizes lifecycle events without ledger paths", () => {
  const event = normalizeTraeEvent({ hook_event_name: "PreToolUse", ...context, tool_name: "shell", tool_input: { command: "npm test" } });
  assert.equal(event.event, "before-action");
  assert.equal(event.deliveryId, "delivery-a");
  assert.equal("ledger" in event, false);
});

test("Trae adapter preserves allow, deny and stop response states", () => {
  assert.deepEqual(toTraeResponse({ decision: "allow" }), { continue: true });
  assert.equal(toTraeResponse({ decision: "deny", reason: "blocked" }).continue, false);
  assert.equal(toTraeResponse({ decision: "stop", reason: "stopped" }).continue, false);
});

test("Trae normalized entry passes controlPlane options to the handler", () => {
  let received;
  const result = handleTraeNormalizedEvent({ version: 1, source: "trae", event: "session-start", ...context }, {
    controlPlane: { handleEvent: (event) => { received = event; return { decision: "allow" }; } },
  });
  assert.equal(result.decision, "allow");
  assert.equal(received.event, "session-start");
});

test("Trae entry denies unknown and missing-handler events with stable exit code", () => {
  const unknown = handleTraePayload({ event: "Future", ...context }, { controlPlane: plane });
  assert.equal(unknown.continue, false);
  const missing = handleTraePayload({ event: "PreToolUse", ...context, tool_input: { command: "npm test" } });
  assert.equal(missing.continue, false);
  assert.equal(traeExitCode(missing), 2);
});

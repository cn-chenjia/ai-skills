import assert from "node:assert/strict";
import test from "node:test";

import { handleCodexPayload, normalizeCodexEvent, toCodexResponse, codexExitCode } from "../scripts/adapters/codex.mjs";

const context = { planningRoot: "e:/plans", deliveryId: "delivery-a" };
const plane = { handleEvent: () => ({ decision: "allow" }) };

test("Codex adapter normalizes lifecycle events without ledger paths", () => {
  const event = normalizeCodexEvent({ hook_event_name: "PreToolUse", ...context, tool_name: "shell", tool_input: { command: "npm test" } });
  assert.equal(event.event, "before-action");
  assert.equal(event.deliveryId, "delivery-a");
  assert.equal("ledger" in event, false);
});

test("Codex adapter preserves allow, deny and stop response states", () => {
  assert.deepEqual(toCodexResponse({ decision: "allow" }), { continue: true });
  assert.equal(toCodexResponse({ decision: "deny", reason: "blocked" }).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(toCodexResponse({ decision: "stop", reason: "stopped" }).continue, false);
});

test("Codex entry denies unknown and missing-handler events with stable exit code", () => {
  const unknown = handleCodexPayload({ hook_event_name: "Future", ...context }, { controlPlane: plane });
  assert.equal(unknown.continue, false);
  const missing = handleCodexPayload({ hook_event_name: "PreToolUse", ...context, tool_input: { command: "npm test" } });
  assert.equal(missing.continue, false);
  assert.equal(codexExitCode(missing), 2);
});

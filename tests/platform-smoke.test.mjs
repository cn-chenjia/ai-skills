import assert from "node:assert/strict";
import test from "node:test";
import { createPlatform } from "../application/index.mjs";

test("createPlatform returns the three platform service entry points", () => {
  const dependencies = {
    planningContext: {},
    repository: {},
    workflow: {},
  };

  const platform = createPlatform(dependencies);

  assert.deepEqual(Object.keys(platform).sort(), [
    "deliveryService",
    "requirementService",
    "statusService",
  ]);
  assert.ok(platform.requirementService);
  assert.ok(platform.deliveryService);
  assert.ok(platform.statusService);
});

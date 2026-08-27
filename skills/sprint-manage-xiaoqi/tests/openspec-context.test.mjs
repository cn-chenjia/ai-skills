import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { resolveOpenSpecContext } from "../scripts/openspec-context.mjs";

function fakeRunner(payload, status = 0) {
  return () => ({
    status,
    stdout: JSON.stringify(payload),
    stderr: "",
  });
}

test("resolves a declared OpenSpec Store root from JSON context", async () => {
  const payload = {
    root: {
      path: "E:/plans/team-plans",
      source: "declared",
      store_id: "team-plans",
      role: "openspec_root",
    },
  };
  const context = resolveOpenSpecContext("E:/src/checkout-api", {
    openspecRunner: fakeRunner(payload),
  });

  assert.deepEqual(context, {
    rootPath: path.resolve("E:/plans/team-plans"),
    source: "declared",
    storeId: "team-plans",
    role: "openspec_root",
    raw: payload,
  });
});

test("returns a normal root without store metadata", async () => {
  const payload = {
    root: {
      path: "/workspace/project",
      source: "nearest",
      role: "openspec_root",
    },
  };
  const context = resolveOpenSpecContext("/workspace/project/src", {
    openspecRunner: fakeRunner(payload),
  });

  assert.equal(context.storeId, undefined);
  assert.equal(context.source, "nearest");
  assert.equal(context.rootPath, path.resolve("/workspace/project"));
});

test("reports diagnostics when OpenSpec does not resolve a root", async () => {
  const payload = {
    root: null,
    status: [{ code: "no_root_with_registered_stores", message: "No root" }],
  };
  assert.throws(
    () =>
      resolveOpenSpecContext("/workspace/project", {
        openspecRunner: fakeRunner(payload),
      }),
    /no_root_with_registered_stores.*No root/s,
  );
});

test("reports command failures", async () => {
  assert.throws(
    () =>
      resolveOpenSpecContext("/workspace/project", {
        openspecRunner: fakeRunner({ status: [{ code: "failed" }] }, 2),
      }),
    /OpenSpec context failed.*failed/s,
  );
});

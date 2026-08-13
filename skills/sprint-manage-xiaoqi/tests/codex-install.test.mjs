import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { installCodexIntegration } from "../scripts/install-codex-integration.mjs";

test("legacy installer installs only the generic runtime", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-codex-install-"));
  const first = installCodexIntegration(project);
  assert.ok(first.written.length > 0);
  assert.equal(first.skipped.length, 0);
  assert.equal(first.status, "created");
  assert.equal(first.gitignore.status, "created");
  assert.equal(await readFile(path.join(project, ".codex"), "utf8").catch(() => null), null);
  assert.equal(
    await readFile(path.join(project, ".xiaoqi", "runtime", "generic-hook.mjs"), "utf8")
      .then(() => true),
    true,
  );
  assert.equal(
    await readFile(path.join(project, ".xiaoqi", "runtime", "guarded-run.mjs"), "utf8")
      .then(() => true),
    true,
  );
  assert.equal(
    await readFile(path.join(project, ".xiaoqi", "runtime", "trae-hook.mjs"), "utf8")
      .then(() => true),
    true,
  );
  assert.match(await readFile(path.join(project, ".gitignore"), "utf8"), /^\.xiaoqi\/$/m);

  const second = installCodexIntegration(project);
  assert.equal(second.status, "skipped");
  assert.equal(second.gitignore.status, "skipped");
});

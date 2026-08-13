import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { installCodexIntegration } from "../scripts/install-codex-integration.mjs";

test("installer creates Codex files without overwriting existing config", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-codex-install-"));
  const first = installCodexIntegration(project);
  assert.equal(first.written.length, 2);
  assert.equal(first.skipped.length, 0);
  assert.match(
    await readFile(path.join(project, ".codex", "config.toml"), "utf8"),
    /hooks = true/,
  );

  await writeFile(
    path.join(project, ".codex", "config.toml"),
    'approval_policy = "never"\n',
  );
  const second = installCodexIntegration(project);
  assert.equal(second.skipped.length, 2);
  assert.match(
    await readFile(path.join(project, ".codex", "config.toml"), "utf8"),
    /never/,
  );
});

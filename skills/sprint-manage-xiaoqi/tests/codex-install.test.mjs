import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { installCodexIntegration } from "../scripts/install-codex-integration.mjs";
import { installRuntime } from "../scripts/install-runtime.mjs";

test("runtime installs under the user home directory without changing the project", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-home-install-"));
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-home-"));
  const result = installRuntime({ homeDir });

  assert.equal(result.status, "created");
  assert.equal(
    await readFile(path.join(homeDir, ".xiaoqi", "runtime", "codex-hook.mjs"), "utf8")
      .then(() => true),
    true,
  );
  assert.equal(await readFile(path.join(project, ".gitignore"), "utf8").catch(() => null), null);
  assert.equal(result.gitignore, undefined);
});

test("installer installs the runtime under the user home directory", async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-codex-install-"));
  const first = installCodexIntegration({ homeDir });
  assert.ok(first.written.length > 0);
  assert.equal(first.skipped.length, 0);
  assert.equal(first.status, "created");
  assert.equal(
    await readFile(path.join(homeDir, ".xiaoqi", "runtime", "generic-hook.mjs"), "utf8")
      .then(() => true),
    true,
  );
  assert.equal(
    await readFile(path.join(homeDir, ".xiaoqi", "runtime", "guarded-run.mjs"), "utf8")
      .then(() => true),
    true,
  );
  assert.equal(
    await readFile(path.join(homeDir, ".xiaoqi", "runtime", "trae-hook.mjs"), "utf8")
      .then(() => true),
    true,
  );

  const second = installCodexIntegration({ homeDir });
  assert.equal(second.status, "skipped");
});

test("Codex Hook template targets the installed user runtime", async () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = path.join(testDir, "..", "templates", "codex", "hooks.json");
  const template = JSON.parse(await readFile(templatePath, "utf8"));

  for (const hooks of Object.values(template.hooks)) {
    assert.equal(
      hooks[0].hooks[0].command,
      "node \"%USERPROFILE%/.xiaoqi/runtime/codex-hook.mjs\"",
    );
  }
});

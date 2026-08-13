// Owner: CJ <chenjia@fehorizon.com>

import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runDoctor } from "../scripts/doctor.mjs";

async function createProject() {
  const project = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-doctor-"));
  await mkdir(path.join(project, ".codex"), { recursive: true });
  await mkdir(path.join(project, "skills", "sprint-manage-xiaoqi", "scripts"), {
    recursive: true,
  });
  await writeFile(
    path.join(project, ".codex", "config.toml"),
    "[features]\nhooks = true\n",
  );
  await writeFile(
    path.join(project, ".codex", "hooks.json"),
    JSON.stringify({
      hooks: Object.fromEntries(
        ["SessionStart", "PreToolUse", "PostToolUse", "Stop"].map((event) => [
          event,
          [
            {
              matcher: ".*",
              hooks: [
                {
                  type: "command",
                  command:
                    "node skills/sprint-manage-xiaoqi/scripts/codex-hook.mjs",
                },
              ],
            },
          ],
        ]),
      ),
    }),
  );
  await writeFile(
    path.join(
      project,
      "skills",
      "sprint-manage-xiaoqi",
      "scripts",
      "codex-hook.mjs",
    ),
    "// test hook\n",
  );
  return project;
}

async function createProjectWithoutCodexIntegration() {
  const project = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-doctor-no-hook-"));
  await mkdir(path.join(project, "sprint-manage", "requirements"), {
    recursive: true,
  });
  await mkdir(path.join(project, ".agents", "skills", "superpowers"), {
    recursive: true,
  });
  await writeFile(path.join(project, ".gitignore"), "sprint-manage/local/\n");
  return project;
}

test("doctor reports Codex integration problems without changing files", async () => {
  const project = await createProject();
  const result = await runDoctor(project, {
    commandRunner: () => ({ ok: false, message: "not available" }),
    homeDir: path.join(project, "home"),
  });

  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(result.checks.codexConfig.status, "pass");
  assert.equal(result.checks.codexHooks.status, "pass");
  assert.equal(result.checks.openSpec.status, "fail");
  assert.equal(result.checks.superpowers.status, "warn");
});

test("doctor treats missing Codex integration as optional", async () => {
  const project = await createProjectWithoutCodexIntegration();
  const result = await runDoctor(project, {
    commandRunner: () => ({ ok: true, version: "1.7.0" }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(result.checks.codexConfig.status, "warn");
  assert.equal(result.checks.codexHooks.status, "warn");
});

test("doctor recognizes local Superpowers and a valid toolchain", async () => {
  const project = await createProject();
  await mkdir(path.join(project, ".agents", "skills", "superpowers"), {
    recursive: true,
  });
  await mkdir(path.join(project, "sprint-manage", "requirements"), {
    recursive: true,
  });
  await writeFile(path.join(project, ".gitignore"), "sprint-manage/local/\n");

  const result = await runDoctor(project, {
    commandRunner: () => ({ ok: true, version: "1.7.0" }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.checks.openSpec.status, "pass");
  assert.equal(result.checks.superpowers.status, "pass");
  assert.equal(result.checks.requirements.status, "pass");
  assert.equal(result.checks.gitignore.status, "pass");
});

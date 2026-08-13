// Owner: CJ <chenjia@fehorizon.com>

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runDoctor } from "../scripts/doctor.mjs";

async function createProject() {
  const project = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-doctor-"));
  await mkdir(path.join(project, ".xiaoqi", "runtime", "core"), {
    recursive: true,
  });
  await mkdir(path.join(project, ".xiaoqi", "runtime", "policies"), {
    recursive: true,
  });
  await mkdir(path.join(project, ".xiaoqi", "runtime", "adapters"), {
    recursive: true,
  });
  for (const file of [
    "generic-hook.mjs",
    "lifecycle.mjs",
    "ledger-lock.mjs",
    "advance-progress.mjs",
    "validate-progress.mjs",
    "guarded-run.mjs",
    "codex-hook.mjs",
    "trae-hook.mjs",
  ]) {
    await writeFile(path.join(project, ".xiaoqi", "runtime", file), "// test\n");
  }
  return project;
}

async function createProjectWithoutCodexIntegration() {
  const project = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-doctor-no-hook-"));
  await mkdir(path.join(project, "openspec", "changes"), { recursive: true });
  await mkdir(path.join(project, "openspec", "specs"), { recursive: true });
  await writeFile(path.join(project, "openspec", "config.yaml"), "schema: spec-driven\n");
  await mkdir(path.join(project, ".agents", "skills", "openspec-propose"), {
    recursive: true,
  });
  await mkdir(path.join(project, ".xiaoqi", "runtime", "core"), {
    recursive: true,
  });
  await mkdir(path.join(project, ".xiaoqi", "runtime", "policies"), {
    recursive: true,
  });
  await mkdir(path.join(project, ".xiaoqi", "runtime", "adapters"), {
    recursive: true,
  });
  for (const file of [
    "generic-hook.mjs",
    "lifecycle.mjs",
    "ledger-lock.mjs",
    "advance-progress.mjs",
    "validate-progress.mjs",
    "guarded-run.mjs",
    "codex-hook.mjs",
    "trae-hook.mjs",
  ]) {
    await writeFile(path.join(project, ".xiaoqi", "runtime", file), "// test\n");
  }
  await mkdir(path.join(project, "sprint-manage", "requirements"), {
    recursive: true,
  });
  await mkdir(path.join(project, ".agents", "skills", "superpowers"), {
    recursive: true,
  });
  await writeFile(path.join(project, ".gitignore"), ".xiaoqi/\n");
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
  assert.equal(result.checks.runtime.status, "warn");
  assert.equal(result.checks.nodejs.status, "pass");
  assert.equal(result.checks.openSpec.status, "fail");
  assert.equal(result.checks.openSpecSkill.status, "fail");
  assert.equal(result.checks.openSpecProject.status, "fail");
  assert.equal(result.checks.superpowers.status, "warn");
});

test("doctor treats the hook runtime as optional when no Hook is configured", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-doctor-no-runtime-"));
  const result = await runDoctor(project, {
    commandRunner: () => ({ ok: false, message: "not available" }),
    homeDir: path.join(project, "home"),
  });

  assert.equal(result.checks.runtime.status, "warn");
  assert.match(result.checks.runtime.message, /可忽略/);
});

test("doctor requires the hook runtime when a Hook is configured", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-doctor-hook-runtime-"));
  await mkdir(path.join(project, ".codex"), { recursive: true });
  await writeFile(
    path.join(project, ".codex", "hooks.json"),
    JSON.stringify({ hooks: { SessionStart: [] } }),
  );

  const result = await runDoctor(project, {
    commandRunner: () => ({ ok: false, message: "not available" }),
    homeDir: path.join(project, "home"),
  });

  assert.equal(result.checks.runtime.status, "fail");
});

test("doctor ignores missing tool-specific integration", async () => {
  const project = await createProjectWithoutCodexIntegration();
  const result = await runDoctor(project, {
    commandRunner: () => ({ ok: true, version: "1.7.0" }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(result.checks.nodejs.status, "pass");
  assert.equal(result.checks.runtime.status, "warn");
  assert.equal(result.checks.codexAdapter.status, "skip");
  assert.equal(result.checks.traeAdapter.status, "skip");
  assert.equal(result.checks.openSpecSkill.status, "pass");
  assert.equal(result.checks.openSpecProject.status, "pass");
  assert.equal(result.checks.superpowersInstall.status, "pass");
});

test("doctor warns when Trae Hook is configured but its adapter is missing", async () => {
  const project = await createProjectWithoutCodexIntegration();
  await mkdir(path.join(project, ".trae"), { recursive: true });
  await writeFile(
    path.join(project, ".trae", "hooks.json"),
    JSON.stringify({ hooks: {} }),
  );
  await rm(path.join(project, ".xiaoqi", "runtime", "adapters"), {
    recursive: true,
    force: true,
  });

  const result = await runDoctor(project, {
    commandRunner: () => ({ ok: true, version: "1.7.0" }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.checks.traeAdapter.status, "warn");
  assert.match(result.checks.traeAdapter.message, /Trae.*适配器未安装/);
});

test("doctor tells users to enable configured Codex and Trae Hooks", async () => {
  const project = await createProjectWithoutCodexIntegration();
  await mkdir(path.join(project, ".codex"), { recursive: true });
  await writeFile(
    path.join(project, ".codex", "config.toml"),
    "[features]\nhooks = true\n",
  );
  await writeFile(
    path.join(project, ".codex", "hooks.json"),
    JSON.stringify({ hooks: {} }),
  );
  await mkdir(path.join(project, ".trae"), { recursive: true });
  await writeFile(
    path.join(project, ".trae", "hooks.json"),
    JSON.stringify({ hooks: {} }),
  );
  await writeFile(
    path.join(project, ".xiaoqi", "runtime", "adapters", "trae.mjs"),
    "// test\n",
  );

  const result = await runDoctor(project, {
    commandRunner: () => ({ ok: true, version: "1.7.0" }),
    tool: "codex",
  });

  assert.equal(result.checks.codexHookEnable.status, "pass");
  assert.match(result.checks.codexHookEnable.detail, /\/hooks/);
  assert.equal(result.checks.traeHookEnable.status, "skip");
});

test("doctor recognizes local Superpowers and a valid toolchain", async () => {
  const project = await createProject();
  await mkdir(path.join(project, "openspec", "changes"), { recursive: true });
  await mkdir(path.join(project, "openspec", "specs"), { recursive: true });
  await writeFile(path.join(project, "openspec", "config.yaml"), "schema: spec-driven\n");
  await mkdir(path.join(project, ".agents", "skills", "openspec"), {
    recursive: true,
  });
  await mkdir(path.join(project, ".agents", "skills", "superpowers"), {
    recursive: true,
  });
  await mkdir(path.join(project, "sprint-manage", "requirements"), {
    recursive: true,
  });
  await writeFile(path.join(project, ".gitignore"), ".xiaoqi/\n");

  const result = await runDoctor(project, {
    commandRunner: () => ({ ok: true, version: "1.7.0" }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.checks.openSpec.status, "pass");
  assert.equal(result.checks.superpowers.status, "pass");
  assert.equal(result.checks.runtime.status, "warn");
  assert.equal(result.checks.requirements.status, "pass");
  assert.equal(result.checks.gitignore.status, "pass");
});

test("doctor guides missing OpenSpec skill and allows missing Superpowers skill", async () => {
  const project = await createProject();
  const result = await runDoctor(project, {
    commandRunner: () => ({ ok: true, version: "1.7.0" }),
    homeDir: path.join(project, "empty-home"),
  });

  assert.equal(result.checks.openSpecSkill.status, "fail");
  assert.match(result.checks.openSpecSkill.detail, /安装/);
  assert.equal(result.checks.superpowersInstall.status, "warn");
  assert.match(result.checks.superpowersInstall.detail, /插件/);
  assert.equal(result.checks.openSpecProject.status, "fail");
});

test("doctor accepts a Codex Superpowers plugin without a skill directory", async () => {
  const project = await createProject();
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-plugin-home-"));
  await mkdir(
    path.join(homeDir, ".codex", "plugins", "cache", "bundled", "superpowers"),
    { recursive: true },
  );

  const result = await runDoctor(project, {
    commandRunner: () => ({ ok: true, version: "1.7.0" }),
    homeDir,
  });

  assert.equal(result.checks.superpowersInstall.status, "pass");
  assert.match(result.checks.superpowersInstall.message, /插件/);
});

test("doctor scopes checks to Trae and ignores Codex configuration", async () => {
  const project = await createProjectWithoutCodexIntegration();
  await rm(path.join(project, ".agents", "skills", "superpowers"), {
    recursive: true,
    force: true,
  });
  await mkdir(path.join(project, ".codex"), { recursive: true });
  await writeFile(
    path.join(project, ".codex", "config.toml"),
    "[features]\nhooks = true\n",
  );
  await mkdir(path.join(project, ".trae"), { recursive: true });
  await writeFile(
    path.join(project, ".trae", "hooks.json"),
    JSON.stringify({ hooks: {} }),
  );
  await writeFile(
    path.join(project, ".xiaoqi", "runtime", "adapters", "trae.mjs"),
    "// test\n",
  );
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-trae-home-"));
  await mkdir(
    path.join(homeDir, ".codex", "plugins", "cache", "bundled", "superpowers"),
    { recursive: true },
  );

  const result = await runDoctor(project, {
    commandRunner: () => ({ ok: true, version: "1.7.0" }),
    homeDir,
  });

  assert.equal(result.checks.codexAdapter.status, "skip");
  assert.equal(result.checks.codexHookEnable.status, "skip");
  assert.equal(result.checks.traeAdapter.status, "pass");
  assert.equal(result.checks.traeHookEnable.status, "pass");
  assert.equal(result.checks.runtime.status, "pass");
  assert.equal(result.checks.superpowersInstall.status, "warn");
  assert.match(result.checks.superpowersInstall.detail, /skill/);
});

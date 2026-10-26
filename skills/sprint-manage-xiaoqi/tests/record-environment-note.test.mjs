import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { upsertEnvironmentNote } from "../scripts/record-environment-note.mjs";
import { readEnvironmentNotes } from "../scripts/prepare-workspace.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(testDir, "..");
const scriptPath = path.join(skillDir, "scripts", "record-environment-note.mjs");

async function createProject() {
  return mkdtemp(path.join(os.tmpdir(), "xiaoqi-envnote-"));
}

async function writeConfig(projectRoot, content) {
  await mkdir(path.join(projectRoot, ".xiaoqi"), { recursive: true });
  await writeFile(path.join(projectRoot, ".xiaoqi", "config.yaml"), content);
}

function configPathOf(projectRoot) {
  return path.join(projectRoot, ".xiaoqi", "config.yaml");
}

test("creates config.yaml with environmentNotes when nothing exists", async () => {
  const projectRoot = await createProject();
  const result = upsertEnvironmentNote(projectRoot, {
    key: "sitGateway",
    value: "https://sit-gw.example.com/api",
    source: "story-2001",
    date: "2026-10-26",
  });

  assert.equal(result.outcome, "completed");
  assert.equal(result.action, "created");
  assert.equal(result.previousValue, null);
  assert.ok(existsSync(configPathOf(projectRoot)));
  const content = readFileSync(configPathOf(projectRoot), "utf8");
  assert.match(
    content,
    /^environmentNotes:\r?\n  sitGateway: "https:\/\/sit-gw\.example\.com\/api"  # 2026-10-26 来源 story-2001\r?\n$/,
  );
  assert.equal(
    readEnvironmentNotes(projectRoot)?.sitGateway,
    "https://sit-gw.example.com/api",
  );
});

test("appends a new key into an existing environmentNotes section", async () => {
  const projectRoot = await createProject();
  await writeConfig(
    projectRoot,
    [
      "baseBranch: main",
      "",
      "environmentNotes:",
      "  sitDbHost: \"10.0.0.1:3306\"  # 2026-09-01 来源 story-1990",
      "",
      "autonomy:",
      "  mode: full",
      "",
    ].join("\n"),
  );

  const result = upsertEnvironmentNote(projectRoot, {
    key: "sitGateway",
    value: "https://sit-gw.example.com/api",
    source: "story-2001",
    date: "2026-10-26",
  });

  assert.equal(result.action, "created");
  const lines = readFileSync(configPathOf(projectRoot), "utf8").split(/\r?\n/);
  // 新键插在段内最后一个内容行之后，不落进 autonomy 段
  const noteIndex = lines.findIndex((line) => line.includes("sitGateway"));
  const autonomyIndex = lines.findIndex((line) => line.trim() === "autonomy:");
  assert.ok(noteIndex > 0);
  assert.ok(noteIndex < autonomyIndex);
  assert.match(lines[noteIndex], /^  sitGateway: "https:\/\/sit-gw\.example\.com\/api"  # 2026-10-26 来源 story-2001$/);
  // 既有键与相邻段原样保留
  assert.match(lines[3], /sitDbHost: "10\.0\.0\.1:3306"  # 2026-09-01 来源 story-1990/);
  assert.equal(lines[6], "autonomy:");
  const notes = readEnvironmentNotes(projectRoot);
  assert.equal(notes.sitDbHost, "10.0.0.1:3306");
  assert.equal(notes.sitGateway, "https://sit-gw.example.com/api");
});

test("updates an existing key value and refreshes the date comment", async () => {
  const projectRoot = await createProject();
  await writeConfig(
    projectRoot,
    [
      "environmentNotes:",
      "  sitGateway: \"https://old-gw.example.com/api\"  # 2026-08-01 来源 story-1900",
      "  sitDbHost: \"10.0.0.1:3306\"  # 2026-08-01 来源 story-1900",
      "",
    ].join("\n"),
  );

  const result = upsertEnvironmentNote(projectRoot, {
    key: "sitGateway",
    value: "https://new-gw.example.com/api",
    source: "story-2001",
    date: "2026-10-26",
  });

  assert.equal(result.action, "updated");
  assert.equal(result.previousValue, "https://old-gw.example.com/api");
  const content = readFileSync(configPathOf(projectRoot), "utf8");
  assert.doesNotMatch(content, /old-gw/);
  assert.match(content, /sitGateway: "https:\/\/new-gw\.example\.com\/api"  # 2026-10-26 来源 story-2001/);
  // 相邻键不受影响
  assert.match(content, /sitDbHost: "10\.0\.0\.1:3306"  # 2026-08-01 来源 story-1900/);
  assert.equal(
    readEnvironmentNotes(projectRoot).sitGateway,
    "https://new-gw.example.com/api",
  );
});

test("appends the environmentNotes section when config exists without it", async () => {
  const projectRoot = await createProject();
  await writeConfig(projectRoot, "baseBranch: main\nbranchTemplate: \"feature/{{id}}\"\n");

  const result = upsertEnvironmentNote(projectRoot, {
    key: "sitDbHost",
    value: "10.0.0.1:3306",
    source: "story-2001",
    date: "2026-10-26",
  });

  assert.equal(result.action, "created");
  const content = readFileSync(configPathOf(projectRoot), "utf8");
  assert.match(content, /^baseBranch: main\nbranchTemplate: "feature\/\{\{id\}\}"\n\nenvironmentNotes:\n  sitDbHost: "10\.0\.0\.1:3306"  # 2026-10-26 来源 story-2001\n$/);
  assert.equal(readEnvironmentNotes(projectRoot).sitDbHost, "10.0.0.1:3306");
});

test("normalizes a hand-written bare value into the canonical quoted format", async () => {
  const projectRoot = await createProject();
  await writeConfig(
    projectRoot,
    ["environmentNotes:", "  sitDbHost: 10.0.0.1:3306", ""].join("\n"),
  );

  const result = upsertEnvironmentNote(projectRoot, {
    key: "sitDbHost",
    value: "10.0.0.2:3306",
    source: "story-2002",
    date: "2026-10-26",
  });

  assert.equal(result.action, "updated");
  assert.equal(result.previousValue, "10.0.0.1:3306");
  assert.match(
    readFileSync(configPathOf(projectRoot), "utf8"),
    /  sitDbHost: "10\.0\.0\.2:3306"  # 2026-10-26 来源 story-2002/,
  );
});

test("preserves comments and blank lines outside the section", async () => {
  const projectRoot = await createProject();
  const original = [
    "# 项目级小七配置",
    "baseBranch: main",
    "",
    "# 环境探测结论",
    "environmentNotes:",
    "  sitGateway: \"https://sit-gw.example.com/api\"  # 2026-09-01 来源 story-1990",
    "",
    "# 托管配置",
    "autonomy:",
    "  mode: full",
    "",
  ].join("\n");
  await writeConfig(projectRoot, original);

  upsertEnvironmentNote(projectRoot, {
    key: "sitRedisHost",
    value: "10.0.0.9:6379",
    source: "story-2001",
    date: "2026-10-26",
  });

  const lines = readFileSync(configPathOf(projectRoot), "utf8").split(/\r?\n/);
  assert.equal(lines[0], "# 项目级小七配置");
  assert.equal(lines[1], "baseBranch: main");
  assert.equal(lines[3], "# 环境探测结论");
  assert.equal(lines[4], "environmentNotes:");
  assert.equal(lines[5], "  sitGateway: \"https://sit-gw.example.com/api\"  # 2026-09-01 来源 story-1990");
  assert.equal(lines[6], "  sitRedisHost: \"10.0.0.9:6379\"  # 2026-10-26 来源 story-2001");
  assert.equal(lines[8], "# 托管配置");
  assert.equal(lines[9], "autonomy:");
  assert.equal(lines[10], "  mode: full");
});

test("rejects invalid keys, empty values, and missing sources", async () => {
  const projectRoot = await createProject();
  assert.throws(
    () => upsertEnvironmentNote(projectRoot, { key: "bad key", value: "x", source: "story-1" }),
    /键名无效/,
  );
  assert.throws(
    () => upsertEnvironmentNote(projectRoot, { key: "ok", value: "  ", source: "story-1" }),
    /值不能为空/,
  );
  assert.throws(
    () => upsertEnvironmentNote(projectRoot, { key: "ok", value: "x", source: "" }),
    /来源需求编号/,
  );
  // 校验失败时不得创建文件
  assert.equal(existsSync(configPathOf(projectRoot)), false);
});

test("is idempotent when writing the same key and value twice", async () => {
  const projectRoot = await createProject();
  const options = {
    key: "sitGateway",
    value: "https://sit-gw.example.com/api",
    source: "story-2001",
    date: "2026-10-26",
  };
  upsertEnvironmentNote(projectRoot, options);
  const first = readFileSync(configPathOf(projectRoot), "utf8");
  const result = upsertEnvironmentNote(projectRoot, options);
  const second = readFileSync(configPathOf(projectRoot), "utf8");

  assert.equal(result.action, "updated");
  assert.equal(result.previousValue, "https://sit-gw.example.com/api");
  assert.equal(first, second);
});

test("runs end to end through the CLI", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "xiaoqi-envnote-cli-home-"));
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  const projectRoot = await createProject();

  const created = spawnSync(
    "node",
    [
      scriptPath,
      projectRoot,
      "--key", "sitGateway",
      "--value", "https://sit-gw.example.com/api",
      "--source", "story-2001",
    ],
    { encoding: "utf8" },
  );
  assert.equal(created.status, 0, created.stderr);
  const payload = JSON.parse(created.stdout);
  assert.equal(payload.outcome, "completed");
  assert.equal(payload.action, "created");
  assert.equal(
    readEnvironmentNotes(projectRoot).sitGateway,
    "https://sit-gw.example.com/api",
  );

  const missingValue = spawnSync(
    "node",
    [scriptPath, projectRoot, "--key", "sitGateway"],
    { encoding: "utf8" },
  );
  assert.equal(missingValue.status, 2);
  assert.match(missingValue.stderr, /均为必填/);
});

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  readEnvironmentNotes,
  readProjectConfig,
} from "../scripts/prepare-workspace.mjs";

async function withProject(files) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-config-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(projectRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return projectRoot;
}

test("parses nested environmentNotes into a structured object", async () => {
  const projectRoot = await withProject({
    ".xiaoqi/config.yaml": [
      "baseBranch: \"develop\"",
      "environmentNotes:",
      "  sitApiPrefix: \"/api-gdms\"          # SIT 网关前缀（2026-09-02 story-69176 探测）",
      "  sitGatewayHost: \"sit-hxjf.hongxinshop.com\"",
    ].join("\n"),
  });

  const notes = readEnvironmentNotes(projectRoot);

  assert.deepEqual(notes, {
    sitApiPrefix: "/api-gdms",
    sitGatewayHost: "sit-hxjf.hongxinshop.com",
  });
});

test("returns null when environmentNotes is absent", async () => {
  const projectRoot = await withProject({
    ".xiaoqi/config.yaml": "baseBranch: \"develop\"\n",
  });

  assert.equal(readEnvironmentNotes(projectRoot), null);
});

test("returns null when the project has no config file", async () => {
  const projectRoot = await withProject({ "README.md": "x\n" });

  assert.equal(readEnvironmentNotes(projectRoot), null);
});

test("keeps flat keys working and free of nested pollution", async () => {
  const projectRoot = await withProject({
    ".xiaoqi/config.yaml": [
      "baseBranch: \"develop\"",
      "branchTemplate: \"feature/{{id}}\"",
      "environmentNotes:",
      "  sitApiPrefix: \"/api-gdms\"",
    ].join("\n"),
  });

  const config = readProjectConfig(projectRoot);

  assert.equal(config.baseBranch, "develop");
  assert.equal(config.branchTemplate, "feature/{{id}}");
  assert.deepEqual(config.environmentNotes, { sitApiPrefix: "/api-gdms" });
  assert.equal(config.sitApiPrefix, undefined);
});

test("skips comments and blank lines inside environmentNotes", async () => {
  const projectRoot = await withProject({
    ".xiaoqi/config.yaml": [
      "environmentNotes:",
      "  # 探测记录（2026-09-02）",
      "",
      "  sitApiPrefix: /api-gdms",
    ].join("\n"),
  });

  const notes = readEnvironmentNotes(projectRoot);

  assert.deepEqual(notes, { sitApiPrefix: "/api-gdms" });
});

test("does not treat unindented keys as environmentNotes children", async () => {
  const projectRoot = await withProject({
    ".xiaoqi/config.yaml": [
      "environmentNotes:",
      "  sitApiPrefix: \"/api-gdms\"",
      "baseBranch: \"develop\"",
    ].join("\n"),
  });

  const config = readProjectConfig(projectRoot);
  const notes = readEnvironmentNotes(projectRoot);

  assert.deepEqual(notes, { sitApiPrefix: "/api-gdms" });
  assert.equal(config.baseBranch, "develop");
});

test("cleans up temp projects", async () => {
  const projectRoot = await withProject({});
  await rm(projectRoot, { recursive: true, force: true });
  assert.equal(await readFile(path.join(projectRoot, ".xiaoqi", "config.yaml"), "utf8").catch(() => null), null);
});

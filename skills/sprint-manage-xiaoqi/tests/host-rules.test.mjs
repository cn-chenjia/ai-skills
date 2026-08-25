import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  installHostRules,
  hostRulesPath,
  managedBlock,
} from "../scripts/host-rules.mjs";
import { runDoctor as executeDoctor } from "../scripts/doctor.mjs";

test("installs an idempotent managed Xiaoqi block into Codex AGENTS.md", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-host-rules-codex-"));
  const agentsPath = path.join(project, "AGENTS.md");
  await writeFile(agentsPath, "# Project rules\n\nKeep existing guidance.\n", "utf8");

  const first = installHostRules({ projectRoot: project, tool: "codex" });
  const content = await readFile(agentsPath, "utf8");

  assert.equal(first.status, "created");
  assert.equal(first.path, agentsPath);
  assert.match(content, /Keep existing guidance/);
  assert.equal(content.match(/xiaoqi-session-lock:start/g)?.length, 1);
  assert.match(content, /确认.*可以.*执行.*继续/);

  const second = installHostRules({ projectRoot: project, tool: "codex" });
  const updated = await readFile(agentsPath, "utf8");
  assert.equal(second.status, "unchanged");
  assert.equal(updated, content);
});

test("installs Trae session rules under the user rule directory", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-host-rules-trae-"));
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-host-rules-home-"));

  const result = installHostRules({
    projectRoot: project,
    tool: "trae",
    homeDir,
  });
  const rulesPath = hostRulesPath({ projectRoot: project, tool: "trae", homeDir });

  assert.equal(result.status, "created");
  assert.equal(result.path, rulesPath);
  assert.equal(await readFile(rulesPath, "utf8"), managedBlock("trae"));
});

test("keeps stop points from releasing the session lock", () => {
  const block = managedBlock("codex");

  assert.match(block, /只有用户明确输入“退出小七”，或在 proposal 确认后明确选择“确认并结束本次会话”才解除会话接管/);
  assert.match(block, /未明确激活小七时，不得接管普通需求/);
  assert.match(block, /ready、blocked 或 closed 后，按小七规则处理/);
  assert.match(block, /确认并结束本次会话/);
  assert.match(block, /一个小七会话只聚焦一个当前需求/);
  assert.doesNotMatch(block, /ready、blocked 或 closed[^。\n]*解除会话接管/);
});

test("doctor reports missing host rules without changing files", async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-host-rules-doctor-"));
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-host-rules-doctor-home-"));
  await mkdir(path.join(project, ".codex"), { recursive: true });
  await writeFile(path.join(project, ".codex", "hooks.json"), "{\"hooks\":{}}", "utf8");

  const result = await executeDoctor(project, {
    commandRunner: () => ({ ok: false, message: "not available" }),
    homeDir,
    tool: "codex",
  });

  assert.equal(result.changed, false);
  assert.equal(result.checks.hostRules.status, "warn");
  assert.match(result.checks.hostRules.message, /AGENTS\.md/);
});

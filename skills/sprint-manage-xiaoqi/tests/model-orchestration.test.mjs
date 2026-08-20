import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(testDir, "..");
const removedScripts = [
  "action-executor.mjs",
  "action-resolver.mjs",
  "auto-runner.mjs",
  "request-routing.mjs",
  "start-automation.mjs",
  "workflow-router.mjs",
];

test("uses the current model as the Xiaoqi workflow executor", async () => {
  const skill = await readFile(path.join(skillDir, "SKILL.md"), "utf8");

  assert.match(skill, /当前模型.*持续执行/);
  assert.match(skill, /模型负责.*修改代码/);
  assert.match(skill, /脚本负责.*账本/);
  assert.match(skill, /OpenSpec `explore`/);
  assert.match(skill, /后续用户消息默认都是当前小七流程的续接/);
  assert.match(skill, /确认、可以、执行、继续/);
  assert.match(skill, /不能重新触发普通技能匹配或切换到其他技能/);
  assert.match(skill, /退出小七/);
  assert.match(skill, /propose[\s\S]*用户确认[\s\S]*initialize-requirement/);
  assert.match(skill, /到达 `ready` 后停止[\s\S]*用户选择/);
  assert.match(skill, /相同错误最多自动修复 3 次/);
  assert.doesNotMatch(skill, /auto-runner|start-automation|actions\.json/);
  assert.doesNotMatch(skill, /brainstorming/i);
});

test("removes standalone model-replacement executors", () => {
  for (const name of removedScripts) {
    assert.equal(
      existsSync(path.join(skillDir, "scripts", name)),
      false,
      `${name} should be removed`,
    );
  }
});

test("keeps deterministic ledger, evidence, lifecycle, and safety scripts", () => {
  for (const name of [
    "initialize-requirement.mjs",
    "prepare-workspace.mjs",
    "advance-progress.mjs",
    "close-requirement.mjs",
    "validate-progress.mjs",
    "ledger-lock.mjs",
    "lifecycle.mjs",
    "guarded-run.mjs",
  ]) {
    assert.equal(existsSync(path.join(skillDir, "scripts", name)), true);
  }
});

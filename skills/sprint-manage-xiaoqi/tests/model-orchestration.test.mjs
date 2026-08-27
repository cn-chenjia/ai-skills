import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(testDir, "..");

test("keeps the main skill in control of the Xiaoqi workflow", async () => {
  const skill = await readFile(path.join(skillDir, "SKILL.md"), "utf8");

  assert.match(skill, /会话锁/);
  assert.match(skill, /后续用户消息默认都是当前小七流程的续接/);
  assert.match(skill, /确认、可以、执行、继续/);
  assert.match(skill, /退出小七/);
  assert.match(skill, /一个小七会话.*一个当前需求/s);
  assert.match(skill, /openspec context --json/);
  assert.match(skill, /root\.path/);
  assert.match(skill, /Store checkout 共享/);
  assert.match(skill, /确认并立即实施当前需求/);
  assert.match(skill, /确认并暂停当前需求/);
  assert.match(skill, /确认并结束本次会话/);
  assert.match(skill, /主技能.*唯一.*流程控制权/s);
  assert.match(skill, /一次只读取.*当前动作.*参考文件/s);
  assert.match(skill, /返回主技能.*重新读取真实状态/s);
  assert.match(skill, /ready.*blocked.*closed/s);
  assert.match(skill, /outcome.*summary.*evidence.*blockers.*recommended_next/s);
  assert.doesNotMatch(skill, /auto-runner|start-automation|actions\.json/);
  assert.doesNotMatch(skill, /brainstorming/i);
});

test("keeps deterministic support scripts", () => {
  for (const name of [
    "action-executor.mjs",
    "action-resolver.mjs",
    "auto-runner.mjs",
    "request-routing.mjs",
    "start-automation.mjs",
    "initialize-requirement.mjs",
    "prepare-workspace.mjs",
    "advance-progress.mjs",
    "close-requirement.mjs",
    "validate-progress.mjs",
    "ledger-lock.mjs",
    "lifecycle.mjs",
    "guarded-run.mjs",
  ]) {
    assert.equal(
      existsSync(path.join(skillDir, "scripts", name)),
      true,
      `${name} should exist`,
    );
  }
});

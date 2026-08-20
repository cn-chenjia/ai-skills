import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseProgressYaml } from "../scripts/validate-progress.mjs";
import { normalizeCodexEvent } from "../scripts/adapters/codex.mjs";
import { handle, hookExitCode } from "../scripts/codex-hook.mjs";

const repoRoot = path.resolve(".");
const hookScript = path.join(
  repoRoot,
  "skills/sprint-manage-xiaoqi/scripts/codex-hook.mjs",
);
const fixture = path.join(
  repoRoot,
  "skills/sprint-manage-xiaoqi/tests/fixtures/valid-single.yaml",
);

test("Codex PreToolUse hook denies destructive shell commands", () => {
  const result = handle({
    hook_event_name: "PreToolUse",
    tool_name: "shell_command",
    tool_input: { command: "git reset --hard HEAD" },
  });

  assert.equal(hookExitCode(result), 2);
  assert.equal(result.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(result.hookSpecificOutput.permissionDecision, "deny");
});

test("Codex PreToolUse hook allows ordinary commands", () => {
  const result = handle({
    hook_event_name: "PreToolUse",
    tool_name: "shell_command",
    tool_input: { command: "node --version" },
  });

  assert.equal(result.continue, true);
});

test("Codex adapter preserves non-retryable failure metadata", () => {
  const event = normalizeCodexEvent({
    hook_event_name: "PostToolUse",
    tool_name: "merge",
    tool_result: {
      exit_code: 1,
      error: "approval required",
      retryable: false,
    },
  });

  assert.equal(event.result.retryable, false);
});

test("Codex SessionStart hook records the session event", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-codex-hook-"));
  const ledger = path.join(directory, "story-1001.yaml");
  await writeFile(ledger, await readFile(fixture, "utf8"));

  const result = handle({
    hook_event_name: "SessionStart",
    cwd: directory,
    ledger,
    actor: "alice",
  });

  assert.equal(result.continue, true);
  const document = parseProgressYaml(await readFile(ledger, "utf8"));
  assert.equal(document.事件日志.at(-1).hook, "session-start");
});

test("Codex hook discovers the only requirement ledger from the workspace", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-codex-discover-"));
  const requirements = path.join(directory, "sprint-manage", "requirements");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(requirements, { recursive: true }));
  const ledger = path.join(requirements, "story-1001.yaml");
  await writeFile(ledger, await readFile(fixture, "utf8"));

  handle({
    hook_event_name: "SessionStart",
    cwd: directory,
    actor: "alice",
  }, directory);

  const document = parseProgressYaml(await readFile(ledger, "utf8"));
  assert.equal(document.事件日志.at(-1).hook, "session-start");
});

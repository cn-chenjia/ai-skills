// Owner: CJ <chenjia@fehorizon.com>

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  handleTraePayload,
  normalizeTraeEvent,
  traeExitCode,
} from "../scripts/adapters/trae.mjs";
import { parseProgressYaml } from "../scripts/validate-progress.mjs";

const fixture = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/valid-single.yaml",
);

test("Trae adapter maps lifecycle events to the shared protocol", () => {
  const event = normalizeTraeEvent({
    hook_event_name: "PreToolUse",
    cwd: "E:/workspace",
    actor: "alice",
    tool_name: "shell",
    tool_input: { command: "npm test" },
  });

  assert.deepEqual(event, {
    version: 1,
    source: "trae",
    event: "before-action",
    actor: "alice",
    cwd: "E:/workspace",
    ledger: undefined,
    action: {
      name: "shell",
      tool: "shell",
      command: "npm test",
      paths: undefined,
      writeScopes: undefined,
      summary: undefined,
    },
    result: undefined,
  });
});

test("Trae adapter accepts nested event payloads and maps failed tool results", () => {
  const event = normalizeTraeEvent({
    event: "PostToolUse",
    data: {
      tool: { name: "test", input: { commandLine: "npm test" } },
      result: { exit_code: 1, stderr: "failed" },
    },
  });

  assert.equal(event.event, "after-action");
  assert.equal(event.action.name, "test");
  assert.equal(event.action.command, "npm test");
  assert.equal(event.result.ok, false);
  assert.equal(event.result.exitCode, 1);
  assert.equal(event.result.error, "failed");
});

test("Trae adapter preserves non-retryable failure metadata", () => {
  const event = normalizeTraeEvent({
    event: "PostToolUse",
    result: {
      exit_code: 1,
      error: "approval required",
      retryable: false,
    },
  });

  assert.equal(event.result.retryable, false);
});

test("Trae adapter denies unsafe actions using Trae response fields and exit code", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-trae-safety-"));
  const ledger = path.join(directory, "story-1001.yaml");
  await writeFile(ledger, await readFile(fixture, "utf8"));
  const result = handleTraePayload({
    event: "PreToolUse",
    cwd: directory,
    ledger,
    action: {
      name: "shell",
      command: "git reset --hard HEAD",
    },
  });

  assert.equal(result.continue, false);
  assert.match(result.stopReason, /destructive-command-denied/);
  assert.equal(traeExitCode(result), 2);
});

test("Trae hook response uses Trae continue and stopReason fields", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-trae-response-"));
  const ledger = path.join(directory, "story-1001.yaml");
  await writeFile(ledger, await readFile(fixture, "utf8"));
  const allowed = handleTraePayload({
    event: "PreToolUse",
    cwd: directory,
    ledger,
    action: { name: "shell", command: "npm test" },
  });
  assert.deepEqual(allowed, { continue: true });

  const denied = handleTraePayload({
    event: "PreToolUse",
    cwd: directory,
    ledger,
    action: { name: "shell", command: "git reset --hard HEAD" },
  });
  assert.equal(denied.continue, false);
  assert.match(denied.stopReason, /destructive-command-denied/);
});

test("Trae adapter records a session event in the selected ledger", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-trae-adapter-"));
  const ledger = path.join(directory, "story-1001.yaml");
  await writeFile(ledger, await readFile(fixture, "utf8"));

  const result = handleTraePayload({
    event: "SessionStart",
    cwd: directory,
    ledger,
    actor: "alice",
  });

  assert.equal(result.continue, true);
  const document = parseProgressYaml(await readFile(ledger, "utf8"));
  assert.equal(document.事件日志.at(-1).source, "trae");
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertCommandAllowed,
  assertPathsAllowed,
  runGuardedCommand,
} from "../scripts/guarded-run.mjs";
import { runLifecycleHook } from "../scripts/lifecycle.mjs";
import { parseProgressYaml } from "../scripts/validate-progress.mjs";

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/valid-single.yaml",
);

test("rejects commands outside the explicit allowlist", () => {
  assert.throws(
    () =>
      assertCommandAllowed("powershell.exe", [], {
        allowedCommands: ["node"],
      }),
    /command-not-allowed/,
  );
});

test("rejects paths outside declared write scopes", () => {
  assert.throws(
    () =>
      assertPathsAllowed(
        ["src/search/api.ts", "../secrets.txt"],
        ["src/search"],
        process.cwd(),
      ),
    /path-outside-scope/,
  );
});

test("runs an allowlisted command without a shell", () => {
  const result = runGuardedCommand(
    process.execPath,
    ["-e", "process.stdout.write('guard-ok')"],
    {
      allowedCommands: ["node"],
      cwd: process.cwd(),
      timeoutMs: 5000,
    },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "guard-ok");
  assert.equal(result.shell, false);
});

test("lifecycle hook records session start and blocks actions for blocked work", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-hooks-"));
  const file = path.join(directory, "story-1001.yaml");
  await writeFile(file, await readFile(fixturePath, "utf8"));

  runLifecycleHook(
    "session-start",
    file,
    { summary: "session opened" },
    "alice",
  );
  const started = parseProgressYaml(await readFile(file, "utf8"));
  assert.equal(started.事件日志.at(-1).hook, "session-start");

  const blockedSource = (await readFile(file, "utf8")).replace(
    '流程状态: "active"',
    '流程状态: "blocked"',
  ).replace(
    "阻塞项: []",
    "阻塞项:\n  - code: waiting-dependency",
  );
  await writeFile(file, blockedSource);

  assert.throws(
    () =>
      runLifecycleHook(
        "before-action",
        file,
        { action: "apply" },
        "alice",
      ),
    /workflow-blocked/,
  );
});

test("lifecycle hook blocks actions for cancelled work", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-hooks-cancelled-"));
  const file = path.join(directory, "story-1001.yaml");
  const source = (await readFile(fixturePath, "utf8"))
    .replace("流程状态: active", "流程状态: cancelled")
    .replace("推荐动作: apply", "推荐动作: null")
    .replace("事件日志: []", '事件日志:\n  - kind: workflow-cancelled\n    reason: "no longer needed"');
  await writeFile(file, source);

  assert.throws(
    () => runLifecycleHook("before-action", file, { action: "apply" }, "alice"),
    /workflow-cancelled/,
  );
});

test("retryable failures block only after the third matching attempt", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-hooks-close-"));
  const file = path.join(directory, "story-1001.yaml");
  await writeFile(file, await readFile(fixturePath, "utf8"));

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    runLifecycleHook(
      "on-failure",
      file,
      {
        action: "verify",
        summary: "test command failed",
        failure_key: "verify:test-command-failed",
      },
      "alice",
    );
    const retrying = parseProgressYaml(await readFile(file, "utf8"));
    assert.equal(retrying.流程状态, "active");
    assert.equal(retrying.阻塞项.length, 0);
    assert.equal(retrying.事件日志.at(-1).attempt, attempt);
  }

  runLifecycleHook(
    "on-failure",
    file,
    {
      action: "verify",
      summary: "test command failed",
      failure_key: "verify:test-command-failed",
    },
    "alice",
  );
  const blocked = parseProgressYaml(await readFile(file, "utf8"));
  assert.equal(blocked.流程状态, "blocked");
  assert.equal(blocked.阻塞项.at(-1).code, "lifecycle-failure");
  assert.equal(blocked.事件日志.at(-1).attempt, 3);

  assert.throws(
    () =>
      runLifecycleHook(
        "before-close",
        file,
        { action: "close" },
        "alice",
      ),
    /workflow-blocked|close-not-ready/,
  );
});

test("non-retryable failures block immediately", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-hooks-risk-"));
  const file = path.join(directory, "story-1001.yaml");
  await writeFile(file, await readFile(fixturePath, "utf8"));

  runLifecycleHook(
    "on-failure",
    file,
    {
      action: "merge",
      summary: "destructive operation needs approval",
      failure_key: "merge:approval-required",
      retryable: false,
    },
    "alice",
  );

  const blocked = parseProgressYaml(await readFile(file, "utf8"));
  assert.equal(blocked.流程状态, "blocked");
  assert.equal(blocked.事件日志.at(-1).attempt, 1);
});

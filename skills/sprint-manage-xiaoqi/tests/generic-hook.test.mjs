// Owner: CJ <chenjia@fehorizon.com>

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  handleNormalizedEvent,
  normalizedExitCode,
} from "../scripts/core/hook-runtime.mjs";
import { parseProgressYaml } from "../scripts/validate-progress.mjs";

const fixture = path.resolve(
  "skills/sprint-manage-xiaoqi/tests/fixtures/valid-single.yaml",
);

test("generic runtime denies destructive commands with a normalized decision", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-generic-safety-"));
  const ledger = path.join(directory, "story-1001.yaml");
  await writeFile(ledger, await readFile(fixture, "utf8"));
  await mkdir(path.join(directory, "sprint-manage", "local"), { recursive: true });
  await writeFile(
    path.join(directory, "sprint-manage", "local", "session.yaml"),
    "当前用户: alice\n当前需求: story-1001\n",
    "utf8",
  );

  const result = handleNormalizedEvent({
    version: 1,
    source: "generic-json",
    event: "before-action",
    actor: "alice",
    cwd: directory,
    ledger,
    action: {
      name: "shell",
      command: "git reset --hard HEAD",
    },
  });

  assert.equal(result.decision, "deny");
  assert.equal(normalizedExitCode(result), 2);
  assert.match(result.reason, /destructive-command-denied/);
});

test("generic runtime records session events through the shared lifecycle", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-generic-hook-"));
  const ledger = path.join(directory, "story-1001.yaml");
  await writeFile(ledger, await readFile(fixture, "utf8"));
  await mkdir(path.join(directory, "sprint-manage", "local"), { recursive: true });
  await writeFile(
    path.join(directory, "sprint-manage", "local", "session.yaml"),
    "当前用户: alice\n当前需求: story-1001\n",
    "utf8",
  );

  const result = handleNormalizedEvent({
    version: 1,
    source: "generic-json",
    event: "session-start",
    actor: "alice",
    cwd: directory,
    ledger,
  });

  assert.equal(result.decision, "allow");
  const document = parseProgressYaml(await readFile(ledger, "utf8"));
  assert.equal(document.事件日志.at(-1).hook, "session-start");
  assert.equal(document.事件日志.at(-1).source, "generic-json");
});

test("generic runtime bypasses ordinary sessions without a Xiaoqi session marker", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-generic-bypass-"));
  const ledger = path.join(directory, "story-1001.yaml");
  await writeFile(ledger, await readFile(fixture, "utf8"));

  const result = handleNormalizedEvent({
    version: 1,
    source: "generic-json",
    event: "before-action",
    actor: "alice",
    cwd: directory,
    ledger,
    action: { name: "shell", command: "git reset --hard HEAD" },
  });

  assert.equal(result.decision, "allow");
});

test("generic runtime keeps retryable failures active until the third attempt", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-generic-failure-"));
  const ledger = path.join(directory, "story-1001.yaml");
  await writeFile(ledger, await readFile(fixture, "utf8"));
  await mkdir(path.join(directory, "sprint-manage", "local"), { recursive: true });
  await writeFile(
    path.join(directory, "sprint-manage", "local", "session.yaml"),
    "当前用户: alice\n当前需求: story-1001\n",
    "utf8",
  );

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = handleNormalizedEvent({
      version: 1,
      source: "generic-json",
      event: "after-action",
      actor: "alice",
      cwd: directory,
      ledger,
      action: { name: "test", summary: "test failed" },
      result: { ok: false, exitCode: 1, error: "assertion failed" },
    });

    assert.equal(result.decision, "allow");
    const document = parseProgressYaml(await readFile(ledger, "utf8"));
    assert.equal(
      document.流程状态,
      attempt < 3 ? "active" : "blocked",
    );
    assert.equal(document.事件日志.at(-1).attempt, attempt);
  }

  const document = parseProgressYaml(await readFile(ledger, "utf8"));
  assert.equal(document.阻塞项.at(-1).code, "lifecycle-failure");
});

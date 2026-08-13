#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  acquireLedgerLock,
  commitLedgerLock,
  releaseLedgerLock,
} from "./ledger-lock.mjs";
import { serializeProgressYaml } from "./advance-progress.mjs";
import { parseProgressYaml, validateProgress } from "./validate-progress.mjs";

const HOOKS = new Set([
  "session-start",
  "before-action",
  "after-action",
  "on-failure",
  "before-close",
]);
const FINAL_DELIVERY_STATES = new Set(["pr-open", "merged", "kept"]);

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function findKey(document, fragment) {
  const key = Object.keys(document).find((candidate) =>
    candidate.includes(fragment),
  );
  if (!key) fail("invalid-ledger", `账本缺少字段 ${fragment}`);
  return key;
}

function assertBeforeAction(document, payload) {
  const workflowKey = findKey(document, "流程");
  if (document[workflowKey] === "blocked") {
    fail("workflow-blocked", "需求处于 blocked，必须先恢复阻塞");
  }
  if (document[workflowKey] === "closed") {
    fail("workflow-closed", "需求已经 closed，不能继续执行动作");
  }
  if (typeof payload.action !== "string" || !payload.action.trim()) {
    fail("missing-action", "before-action 必须提供 action");
  }
}

function assertBeforeClose(document) {
  const workflowKey = findKey(document, "流程");
  const deliveryKey = findKey(document, "交付");
  const evidenceKey = findKey(document, "证据");
  if (document[workflowKey] === "blocked") {
    fail("workflow-blocked", "blocked 需求不能关闭");
  }
  const evidence = document[evidenceKey] ?? {};
  const archive = evidence.archive;
  const finish = evidence.finish;
  if (
    !FINAL_DELIVERY_STATES.has(document[deliveryKey]) ||
    !archive?.path ||
    !finish?.result
  ) {
    fail(
      "close-not-ready",
      "关闭前必须具备最终交付状态、archive 和 finish 证据",
    );
  }
}

export function runLifecycleHook(hook, filePath, payload = {}, owner) {
  if (!HOOKS.has(hook)) fail("invalid-hook", `不支持的生命周期钩子 ${hook}`);
  const lock = acquireLedgerLock(filePath, owner);
  const lockFile = `${filePath}.lock`;
  let originalSource;

  try {
    originalSource = readFileSync(filePath, "utf8");
    const document = parseProgressYaml(originalSource);
    const eventKey = findKey(document, "事件");
    const workflowKey = findKey(document, "流程");

    if (hook === "before-action") assertBeforeAction(document, payload);
    if (hook === "before-close") assertBeforeClose(document);
    if (hook === "after-action" && !payload.outcome) {
      fail("missing-outcome", "after-action 必须提供 outcome");
    }
    if (hook === "on-failure") {
      document[workflowKey] = "blocked";
      const blockerKey = findKey(document, "阻塞");
      const blockers = Array.isArray(document[blockerKey])
        ? document[blockerKey]
        : [];
      blockers.push({
        code: "lifecycle-failure",
        summary: payload.summary ?? "生命周期动作失败",
        since: new Date().toISOString(),
        resume_when: "完成失败恢复条件",
        resume_action: payload.action ?? "diagnose",
      });
      document[blockerKey] = blockers;
    }

    const events = Array.isArray(document[eventKey])
      ? document[eventKey]
      : [];
    events.push({
      kind: "lifecycle",
      hook,
      actor: owner,
      at: new Date().toISOString(),
      ...payload,
    });
    document[eventKey] = events;

    const issues = validateProgress(document);
    if (issues.length > 0) {
      fail("invalid-ledger", `${issues[0].code} ${issues[0].message}`);
    }

    writeFileSync(filePath, serializeProgressYaml(document), "utf8");
    return commitLedgerLock(filePath, lock.token);
  } catch (error) {
    if (originalSource !== undefined) writeFileSync(filePath, originalSource, "utf8");
    if (existsSync(lockFile)) releaseLedgerLock(filePath, lock.token);
    throw error;
  }
}

function runCli(args) {
  if (args.length !== 4) {
    console.error(
      "用法: node lifecycle.mjs <hook> <ledger> <payload.json> <owner>",
    );
    return 2;
  }

  try {
    const [hook, filePath, payloadPath, owner] = args;
    const payload = JSON.parse(readFileSync(payloadPath, "utf8"));
    console.log(JSON.stringify(runLifecycleHook(hook, filePath, payload, owner)));
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

const executedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (executedPath === import.meta.url) {
  process.exitCode = runCli(process.argv.slice(2));
}

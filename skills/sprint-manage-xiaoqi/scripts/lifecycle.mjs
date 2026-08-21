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
const DEFAULT_MAX_FAILURE_ATTEMPTS = 3;

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

function failureKey(payload) {
  if (typeof payload.failure_key === "string" && payload.failure_key.trim()) {
    return payload.failure_key.trim();
  }
  return `${payload.action ?? "unknown"}:${payload.summary ?? "failure"}`;
}

function nextFailureAttempt(events, key) {
  let attempts = 0;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event?.kind !== "lifecycle" ||
      event.hook !== "on-failure" ||
      event.failure_key !== key
    ) {
      break;
    }
    attempts += 1;
  }
  return attempts + 1;
}

export function assertRequirementClosable(document) {
  const workflowKey = findKey(document, "流程");
  const deliveryKey = findKey(document, "交付");
  const evidenceKey = findKey(document, "证据");
  if (document[workflowKey] === "closed") {
    fail("workflow-closed", "需求已经 closed，不能重复关闭");
  }
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

function tryAcquireLedgerLock(filePath, owner) {
  try {
    return acquireLedgerLock(filePath, owner);
  } catch (error) {
    if (error.code === "ledger-locked") return null;
    throw error;
  }
}

export function runLifecycleHook(hook, filePath, payload = {}, owner) {
  if (!HOOKS.has(hook)) fail("invalid-hook", `不支持的生命周期钩子 ${hook}`);

  // 成功动作不写账本，避免事件日志和 revision 随工具调用次数膨胀
  if (hook === "after-action") {
    if (!payload.outcome) {
      fail("missing-outcome", "after-action 必须提供 outcome");
    }
    return { outcome: payload.outcome, recorded: false };
  }

  const lock = tryAcquireLedgerLock(filePath, owner);
  if (!lock) {
    // 账本被其他操作持锁时跳过记录；观测性记录绝不阻塞工具执行
    return { outcome: "skipped", reason: "ledger-busy", recorded: false };
  }
  const lockFile = `${filePath}.lock`;
  let originalSource;

  try {
    originalSource = readFileSync(filePath, "utf8");
    const document = parseProgressYaml(originalSource);
    const eventKey = findKey(document, "事件");
    const workflowKey = findKey(document, "流程");
    const events = Array.isArray(document[eventKey])
      ? document[eventKey]
      : [];
    let eventPayload = payload;

    if (hook === "before-action") {
      // 只校验 blocked/closed 门禁，不追加事件
      assertBeforeAction(document, payload);
      releaseLedgerLock(filePath, lock.token);
      return { outcome: "checked", recorded: false };
    }
    if (hook === "before-close") assertRequirementClosable(document);
    if (hook === "on-failure") {
      const key = failureKey(payload);
      const retryable = payload.retryable !== false;
      const attempt = nextFailureAttempt(events, key);
      eventPayload = {
        ...payload,
        failure_key: key,
        retryable,
        attempt,
        max_attempts: retryable ? DEFAULT_MAX_FAILURE_ATTEMPTS : 1,
        outcome:
          retryable && attempt < DEFAULT_MAX_FAILURE_ATTEMPTS
            ? "retrying"
            : "blocked",
      };

      if (!retryable || attempt >= DEFAULT_MAX_FAILURE_ATTEMPTS) {
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
    }

    events.push({
      kind: "lifecycle",
      hook,
      actor: owner,
      at: new Date().toISOString(),
      ...eventPayload,
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

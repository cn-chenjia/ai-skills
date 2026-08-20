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
import {
  parseProgressYaml,
  validateDeliveryTransition,
  validateProgress,
} from "./validate-progress.mjs";

function scalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return JSON.stringify(String(value));
}

function isScalar(value) {
  return value === null || typeof value !== "object";
}

function serializeObject(value, indent) {
  const lines = [];
  const padding = " ".repeat(indent);

  for (const [key, child] of Object.entries(value)) {
    if (isScalar(child)) {
      lines.push(`${padding}${key}: ${scalar(child)}`);
      continue;
    }
    if (Array.isArray(child) && child.length === 0) {
      lines.push(`${padding}${key}: []`);
      continue;
    }
    if (!Array.isArray(child) && Object.keys(child).length === 0) {
      lines.push(`${padding}${key}: {}`);
      continue;
    }
    lines.push(`${padding}${key}:`);
    lines.push(...serializeBlock(child, indent + 2));
  }

  return lines;
}

function serializeBlock(value, indent) {
  if (!Array.isArray(value)) return serializeObject(value, indent);

  const lines = [];
  const padding = " ".repeat(indent);
  for (const item of value) {
    if (isScalar(item)) {
      lines.push(`${padding}- ${scalar(item)}`);
      continue;
    }

    const entries = Object.entries(item);
    if (entries.length === 0) {
      lines.push(`${padding}- {}`);
      continue;
    }

    const [firstKey, firstValue] = entries[0];
    if (isScalar(firstValue)) {
      lines.push(`${padding}- ${firstKey}: ${scalar(firstValue)}`);
    } else {
      lines.push(`${padding}- ${firstKey}:`);
      lines.push(...serializeBlock(firstValue, indent + 4));
    }
    if (entries.length > 1) {
      lines.push(...serializeObject(Object.fromEntries(entries.slice(1)), indent + 2));
    }
  }
  return lines;
}

export function serializeProgressYaml(document) {
  return `${serializeObject(document, 0).join("\n")}\n`;
}

function findKey(document, fragment) {
  const key = Object.keys(document).find((candidate) =>
    candidate.includes(fragment),
  );
  if (!key) throw new Error(`账本缺少字段: ${fragment}`);
  return key;
}

function attachEvidence(document, evidence) {
  const evidenceKey = findKey(document, "证据");
  const evidenceIndex = document[evidenceKey] ?? {};
  const next = structuredClone(evidenceIndex);

  if (evidence.kind === "apply") {
    next.apply = evidence;
  } else if (evidence.kind === "check") {
    next.checks = Array.isArray(next.checks) ? next.checks : [];
    next.checks.push(evidence);
  } else if (evidence.kind === "review") {
    next.review = evidence;
  } else if (evidence.kind === "openspec-verify") {
    next.openspec_verify = evidence;
  } else if (evidence.kind === "finish") {
    next.finish = evidence;
  } else {
    throw new Error(`不支持的证据类型: ${evidence.kind}`);
  }

  document[evidenceKey] = next;
}

export function advanceProgress(filePath, targetStatus, evidence, owner) {
  const lock = acquireLedgerLock(filePath, owner);
  const lockFile = `${filePath}.lock`;
  let originalSource;

  try {
    originalSource = readFileSync(filePath, "utf8");
    const document = parseProgressYaml(originalSource);
    const deliveryKey = findKey(document, "交付");
    const eventKey = findKey(document, "事件");
    const next = structuredClone(document);
    next[deliveryKey] = targetStatus;
    attachEvidence(next, evidence);

    const events = Array.isArray(next[eventKey]) ? next[eventKey] : [];
    events.push({
      kind: "delivery-transition",
      from: lock.expectedDeliveryStatus,
      to: targetStatus,
      actor: owner,
      checked_at: evidence.checked_at,
      evidence_kind: evidence.kind,
      commit: evidence.commit,
    });
    next[eventKey] = events;

    const transitionIssues = validateDeliveryTransition(
      next,
      lock.expectedDeliveryStatus,
    );
    if (transitionIssues.length > 0) {
      throw new Error(
        `状态推进校验失败: ${transitionIssues[0].code} ${transitionIssues[0].message}`,
      );
    }

    const validationIssues = validateProgress(next);
    if (validationIssues.length > 0) {
      throw new Error(
        `账本校验失败: ${validationIssues[0].code} ${validationIssues[0].message}`,
      );
    }

    writeFileSync(filePath, serializeProgressYaml(next), "utf8");

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
      "用法: node advance-progress.mjs <ledger> <target-status> <evidence.json> <owner>",
    );
    return 2;
  }

  try {
    const [filePath, targetStatus, evidencePath, owner] = args;
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    console.log(
      JSON.stringify(advanceProgress(filePath, targetStatus, evidence, owner)),
    );
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

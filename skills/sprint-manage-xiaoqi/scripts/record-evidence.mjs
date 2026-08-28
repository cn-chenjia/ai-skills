#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>
// record-evidence.mjs：只记录证据到账本的证据索引，不推进交付状态。
// 用于 archive 这类不改变交付状态但仍需记录证据的场景，避免 advance-progress 产生的 ready→ready 自环迁移。

import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  acquireLedgerLock,
  commitLedgerLock,
  releaseLedgerLock,
} from "./ledger-lock.mjs";
import {
  parseProgressYaml,
  validateProgress,
} from "./validate-progress.mjs";
import { serializeProgressYaml, validateEvidence } from "./advance-progress.mjs";

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
  } else if (evidence.kind === "archive") {
    next.archive = evidence;
  } else {
    throw new Error(`不支持的证据类型: ${evidence.kind}`);
  }

  document[evidenceKey] = next;
}

async function recordEvidence(filePath, evidence, owner) {
  // finish 证据必须通过 advance-progress 推进交付状态，不能单独记录
  if (evidence.kind === "finish") {
    throw new Error(
      "finish 证据必须通过 advance-progress.mjs 推进交付状态，不能用 record-evidence.mjs 单独记录",
    );
  }

  // 读取当前交付状态用于 schema 校验（archive 不要求 targetStatus 一致）
  const document0 = parseProgressYaml(readFileSync(filePath, "utf8"));
  const deliveryKey = findKey(document0, "交付");
  const currentStatus = document0[deliveryKey];

  // 复用 advance-progress.mjs 的证据 schema 校验
  validateEvidence(evidence, currentStatus);

  const lock = acquireLedgerLock(filePath, owner);
  const lockFile = `${filePath}.lock`;
  let originalSource;

  try {
    originalSource = readFileSync(filePath, "utf8");
    const document = parseProgressYaml(originalSource);
    const next = structuredClone(document);
    attachEvidence(next, evidence);

    // 事件日志记录证据追加（不写 delivery-transition）
    const eventKey = findKey(document, "事件");
    const events = Array.isArray(next[eventKey]) ? next[eventKey] : [];
    events.push({
      kind: "evidence-recorded",
      evidence_kind: evidence.kind,
      actor: owner,
      checked_at: evidence.checked_at,
      commit: evidence.commit,
      delivery_status: currentStatus,
    });
    next[eventKey] = events;

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

async function runCli(args) {
  if (args.length !== 3) {
    console.error(
      "用法: node record-evidence.mjs <ledger> <evidence.json> <owner>",
    );
    console.error(
      "  记录证据到账本证据索引，不推进交付状态。适用于 archive 等不改变交付状态的证据。",
    );
    console.error("  finish 证据不能用本工具，必须用 advance-progress.mjs。");
    return 2;
  }

  try {
    const [filePath, evidencePath, owner] = args;
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    const result = await recordEvidence(filePath, evidence, owner);
    console.log(JSON.stringify(result));
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

const executedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (executedPath === import.meta.url) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

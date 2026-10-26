#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>
// record-decision.mjs：统一记录用户决策（proposal-confirmation / implementation-start 等）
// 到账本的用户决策列表，不推进交付状态。托管需求的自动回执（actor: xiaoqi-auto）
// 也走本入口，由 validate-progress 保证：非托管需求拒绝 auto 决策、auto 决策必须带 reason。

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
  isAutonomous,
  isBlockingIssue,
  parseProgressYaml,
  validateProgress,
} from "./validate-progress.mjs";
import { serializeProgressYaml } from "./advance-progress.mjs";

const AUTO_ACTOR = "xiaoqi-auto";
// 托管自动回执只允许这三类：需求接纳必须由真实提出人签署
const AUTONOMOUS_DECISION_KINDS = new Set([
  "proposal-confirmation",
  "implementation-start",
  "finish-reopen",
]);
const DECISION_KIND_VALUES = new Set([
  "requirement-intake",
  ...AUTONOMOUS_DECISION_KINDS,
]);
const DECISION_OUTCOME_VALUES = new Set([
  "accepted",
  "approved",
  "rejected",
  "paused",
]);

function findKey(document, fragment) {
  const key = Object.keys(document).find((candidate) =>
    candidate.includes(fragment),
  );
  if (!key) throw new Error(`账本缺少字段: ${fragment}`);
  return key;
}

function hasText(value) {
  return typeof value === "string" && value.trim() !== "";
}

function validateDecision(decision, document) {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    throw new Error("决策必须是 JSON 对象");
  }
  if (!DECISION_KIND_VALUES.has(decision.kind)) {
    throw new Error(
      `不支持的决策类型: ${decision.kind}（合法值: ${[...DECISION_KIND_VALUES].join(", ")}）`,
    );
  }
  if (!DECISION_OUTCOME_VALUES.has(decision.outcome)) {
    throw new Error(
      `决策 outcome 必须为 ${[...DECISION_OUTCOME_VALUES].join("/")}，当前为 ${decision.outcome}`,
    );
  }
  if (!hasText(decision.actor)) {
    throw new Error("决策必须记录 actor（决策人）");
  }
  if (!decision.at) {
    decision.at = new Date().toISOString();
  }
  if (!hasText(decision.at)) {
    throw new Error("决策 at 必须是 ISO8601 时间戳");
  }
  if (decision.actor === AUTO_ACTOR) {
    if (!isAutonomous(document)) {
      throw new Error(
        "非托管（托管.mode != full）需求不能记录 xiaoqi-auto 决策；人工需求请用真实决策人作为 actor",
      );
    }
    if (!AUTONOMOUS_DECISION_KINDS.has(decision.kind)) {
      throw new Error(
        `xiaoqi-auto 只能记录 ${[...AUTONOMOUS_DECISION_KINDS].join("/")} 决策`,
      );
    }
    if (!hasText(decision.reason)) {
      throw new Error(
        "xiaoqi-auto 自动回执必须附带推荐理由（reason），保证审计可追溯",
      );
    }
  }
  return decision;
}

export function recordDecision(filePath, decision, owner) {
  const lock = acquireLedgerLock(filePath, owner);
  const lockFile = `${filePath}.lock`;
  let originalSource;

  try {
    originalSource = readFileSync(filePath, "utf8");
    const document = parseProgressYaml(originalSource);
    const validated = validateDecision(
      structuredClone(decision),
      document,
    );

    const decisionKey = findKey(document, "决策");
    const decisions = Array.isArray(document[decisionKey])
      ? document[decisionKey]
      : [];
    decisions.push(validated);

    const next = structuredClone(document);
    next[decisionKey] = decisions;

    const eventKey = findKey(document, "事件");
    const events = Array.isArray(next[eventKey]) ? next[eventKey] : [];
    events.push({
      kind: "decision-recorded",
      decision_kind: validated.kind,
      decision_outcome: validated.outcome,
      actor: validated.actor,
      recorded_by: owner,
      at: validated.at,
    });
    next[eventKey] = events;

    const validationIssues = validateProgress(next).filter(isBlockingIssue);
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
  if (args.length !== 3) {
    console.error("用法: node record-decision.mjs <ledger> <decision.json> <owner>");
    console.error(
      "  记录决策到账本用户决策列表，不推进交付状态。decision.json 至少包含 kind/outcome/actor。",
    );
    console.error(
      "  xiaoqi-auto 自动回执仅限托管需求，且必须附带 reason（推荐理由）。",
    );
    return 2;
  }

  try {
    const [filePath, decisionPath, owner] = args;
    const decision = JSON.parse(readFileSync(decisionPath, "utf8"));
    console.log(JSON.stringify(recordDecision(filePath, decision, owner)));
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

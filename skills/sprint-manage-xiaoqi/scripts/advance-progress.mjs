#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import { spawnSync } from "node:child_process";
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
import { reconcileLedgerWithGit } from "./prepare-workspace.mjs";
import {
  isBlockingIssue,
  parseProgressYaml,
  validateDeliveryTransition,
  validateProgress,
} from "./validate-progress.mjs";

// 证据 schema：每个 kind 的必需字段与额外约束
// 参考 state-contract.md 的证据字段合法值表
const EVIDENCE_SCHEMA = {
  apply: {
    required: ["kind", "command", "exit_code", "checked_at", "summary"],
    // apply 不要求 commit 和 result，但若提供 commit 会被采用
    optional: ["commit"],
  },
  check: {
    required: ["kind", "command", "exit_code", "commit", "checked_at", "summary"],
    optional: ["result"],
  },
  review: {
    required: ["kind", "command", "exit_code", "commit", "checked_at", "summary", "result"],
    // result 必须为 approved
    resultMustBe: "approved",
  },
  "openspec-verify": {
    required: ["kind", "command", "exit_code", "commit", "checked_at", "summary", "result"],
    resultMustBe: "passed",
  },
  finish: {
    required: ["kind", "command", "exit_code", "commit", "checked_at", "summary", "result", "outcome"],
    // result 必须为 pr-open/merged/kept，且等于最终交付状态（由调用方传入 targetStatus 校验）
    allowedResults: ["pr-open", "merged", "kept"],
    // outcome 成功值只能是 passed/completed/archived
    allowedOutcomes: ["passed", "completed", "archived"],
  },
  archive: {
    required: ["kind", "command", "exit_code", "checked_at", "summary", "path", "outcome"],
    allowedOutcomes: ["passed", "completed", "archived"],
  },
};

export function validateEvidence(evidence, targetStatus) {
  if (!evidence || typeof evidence !== "object") {
    throw new Error("证据必须是 JSON 对象");
  }
  if (Array.isArray(evidence.repositories)) {
    if (evidence.repositories.length === 0) throw new Error("repositories 证据数组不能为空");
    for (const item of evidence.repositories) {
      validateEvidence(item, targetStatus);
      if (!item.repository_id) throw new Error("多仓库证据必须包含 repository_id");
    }
    return;
  }
  const { kind } = evidence;
  const schema = EVIDENCE_SCHEMA[kind];
  if (!schema) {
    throw new Error(
      `不支持的证据类型: ${kind}（合法值: ${Object.keys(EVIDENCE_SCHEMA).join(", ")}）`,
    );
  }

  // 必需字段检查
  const missing = schema.required.filter(
    (field) =>
      evidence[field] === undefined ||
      evidence[field] === null ||
      (typeof evidence[field] === "string" && evidence[field].trim() === ""),
  );
  if (missing.length > 0) {
    throw new Error(
      `证据 ${kind} 缺少必需字段: ${missing.join(", ")}。必需字段: ${schema.required.join(", ")}`,
    );
  }

  // exit_code 必须为 0
  if (evidence.exit_code !== 0) {
    throw new Error(
      `证据 ${kind} 的 exit_code 必须为 0，当前为 ${evidence.exit_code}。失败命令不应作为证据推进状态。`,
    );
  }

  // kind 字段一致性
  if (evidence.kind !== kind) {
    throw new Error(
      `证据 kind 字段（${evidence.kind}）与传入的 kind（${kind}）不一致`,
    );
  }

  if (kind === "apply" && evidence.tdd) {
    const tdd = evidence.tdd;
    const validPhase = (phase, exitCode, result) =>
      phase && phase.command && phase.exit_code === exitCode && phase.result === result && phase.summary;
    if (tdd.enabled !== true || !validPhase(tdd.red, 1, "failed") || !validPhase(tdd.green, 0, "passed")) {
      throw new Error("apply 的 TDD 证据必须包含有效的 red 和 green 阶段");
    }
    if (tdd.refactor && !validPhase(tdd.refactor, 0, "passed")) {
      throw new Error("apply 的 TDD refactor 阶段必须成功并标记 passed");
    }
  }

  // review 的 result 约束
  if (schema.resultMustBe && evidence.result !== schema.resultMustBe) {
    throw new Error(
      `证据 ${kind} 的 result 必须为 ${schema.resultMustBe}，当前为 ${evidence.result}`,
    );
  }

  // openspec-verify 的 result 约束
  if (kind === "openspec-verify" && schema.resultMustBe && evidence.result !== schema.resultMustBe) {
    throw new Error(
      `证据 ${kind} 的 result 必须为 ${schema.resultMustBe}，当前为 ${evidence.result}`,
    );
  }

  // finish 的 result 必须在允许值集合中，且等于目标交付状态
  if (kind === "finish") {
    if (!schema.allowedResults.includes(evidence.result)) {
      throw new Error(
        `证据 finish 的 result 必须为 ${schema.allowedResults.join("/")}，当前为 ${evidence.result}`,
      );
    }
    if (evidence.result !== targetStatus) {
      throw new Error(
        `证据 finish 的 result（${evidence.result}）必须与目标交付状态（${targetStatus}）一致`,
      );
    }
    if (!schema.allowedOutcomes.includes(evidence.outcome)) {
      throw new Error(
        `证据 ${kind} 的 outcome 必须为 ${schema.allowedOutcomes.join("/")}，当前为 ${evidence.outcome}`,
      );
    }
  }

  // archive 的 outcome 约束
  if (kind === "archive" && !schema.allowedOutcomes.includes(evidence.outcome)) {
    throw new Error(
      `证据 ${kind} 的 outcome 必须为 ${schema.allowedOutcomes.join("/")}，当前为 ${evidence.outcome}`,
    );
  }

  // archive 的 path 必须非空
  if (kind === "archive" && !evidence.path) {
    throw new Error(`证据 archive 的 path 字段必须非空`);
  }
}

function autoFillApplyCommit(evidence, ledgerPath) {
  // apply 证据未带 commit 时，尝试自动回填当前 HEAD 的 commit
  if (evidence.kind !== "apply") return evidence;
  if (evidence.commit && evidence.commit.trim()) return evidence;

  const projectRoot = path.dirname(path.dirname(path.dirname(ledgerPath)));
  const result = spawnSync(
    "git",
    ["-C", projectRoot, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  );
  // git rev-parse 失败时（如测试环境非 git 仓库）跳过回填，保留原证据
  // 后续 validateProgress 会对 apply 证据做校验（apply 不强制要求 commit）
  if (result.status !== 0) return evidence;
  const commit = result.stdout.trim();
  if (!commit) return evidence;
  return { ...evidence, commit };
}

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
  if (Array.isArray(evidence.repositories)) {
    for (const item of evidence.repositories) attachEvidence(document, item);
    return;
  }
  const evidenceKey = findKey(document, "证据");
  const evidenceIndex = document[evidenceKey] ?? {};
  const next = structuredClone(evidenceIndex);

  if (evidence.kind === "apply") {
    const applyEntries = Array.isArray(next.apply) ? next.apply : next.apply ? [next.apply] : [];
    next.apply = evidence.repository_id
      ? [...applyEntries.filter((item) => item.repository_id !== evidence.repository_id), evidence]
      : evidence;
    if (Array.isArray(document.任务映射)) {
      const tddByTask = new Map(
        (Array.isArray(evidence.tdd_tasks) ? evidence.tdd_tasks : [])
          .map((item) => [item.task_id, item.tdd]),
      );
      document.任务映射 = document.任务映射.map((task) => {
        const nextTask = Array.isArray(evidence.completed_tasks) && evidence.completed_tasks.includes(task.id)
          ? { ...task, status: "completed" }
          : task;
        const tdd = tddByTask.get(task.id);
        return tdd ? { ...nextTask, tdd } : nextTask;
      });
    }
  } else if (evidence.kind === "check") {
    next.checks = Array.isArray(next.checks) ? next.checks : [];
    if (evidence.repository_id) {
      next.checks = next.checks.filter((item) => item.repository_id !== evidence.repository_id);
    }
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

export function advanceProgress(filePath, targetStatus, evidence, owner, options = {}) {
  const { dryRun = false, reconcile, projectRoot } = options;

  // 1. 写入前先做证据 schema 校验，缺字段立即拒绝，不进入加锁流程
  validateEvidence(evidence, targetStatus);

  // 2. apply 证据未带 commit 时自动回填当前 HEAD
  const enrichedEvidence = autoFillApplyCommit(evidence, filePath);

  // 3. 推进到 coding 前，先对账账本与 Git 工作区；不一致时拒绝推进。
  //    可通过 options.reconcile 注入自定义对账函数，或传 false 跳过（纯函数测试场景）。
  if (targetStatus === "coding" && reconcile !== false && reconcile !== null) {
    const runReconcile = typeof reconcile === "function"
      ? reconcile
      : (ledgerPath) => reconcileLedgerWithGit(ledgerPath, projectRoot ?? process.cwd());
    const report = runReconcile(filePath);
    if (report?.outcome === "inconsistent" || report?.consistent === false) {
      const detail = (report.issues ?? [])
        .map((issue) => `[${issue.code}] ${issue.repository_id ?? ""}: ${issue.message ?? ""}`)
        .join("；");
      throw new Error(
        `账本与 Git 工作区不一致，已拒绝推进到 coding${detail ? `：${detail}` : ""}`,
      );
    }
  }

  // dry-run 模式：只校验证据与状态迁移合法性，不实际写入账本
  if (dryRun) {
    const document = parseProgressYaml(readFileSync(filePath, "utf8"));
    const deliveryKey = findKey(document, "交付");
    const eventKey = findKey(document, "事件");
    const next = structuredClone(document);
    next[deliveryKey] = targetStatus;
    attachEvidence(next, enrichedEvidence);
    const events = Array.isArray(next[eventKey]) ? next[eventKey] : [];
    events.push({
      kind: "delivery-transition",
      from: document[deliveryKey],
      to: targetStatus,
      actor: owner,
      checked_at: enrichedEvidence.checked_at,
      evidence_kind: enrichedEvidence.kind,
      commit: enrichedEvidence.commit,
    });
    next[eventKey] = events;
    const transitionIssues = validateDeliveryTransition(
      next,
      document[deliveryKey],
    );
    const validationIssues = validateProgress(next).filter(isBlockingIssue);
    return {
      outcome: "dry-run",
      targetStatus,
      evidenceKind: enrichedEvidence.kind,
      commit: enrichedEvidence.commit,
      transitionIssues: transitionIssues.map((i) => ({ code: i.code, message: i.message })),
      validationIssues: validationIssues.map((i) => ({ code: i.code, message: i.message })),
      wouldSucceed: transitionIssues.length === 0 && validationIssues.length === 0,
    };
  }

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
    attachEvidence(next, enrichedEvidence);

    const events = Array.isArray(next[eventKey]) ? next[eventKey] : [];
    events.push({
      kind: "delivery-transition",
      from: lock.expectedDeliveryStatus,
      to: targetStatus,
      actor: owner,
      checked_at: enrichedEvidence.checked_at,
      evidence_kind: enrichedEvidence.kind,
      commit: enrichedEvidence.commit,
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
  // 支持 --dry-run 可选 flag
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((a) => a !== "--dry-run");

  if (positional.length !== 4) {
    console.error(
      "用法: node advance-progress.mjs <ledger> <target-status> <evidence.json> <owner> [--dry-run]",
    );
    console.error(
      "  --dry-run  只校验证据与状态迁移合法性，不实际写入账本",
    );
    return 2;
  }

  try {
    const [filePath, targetStatus, evidencePath, owner] = positional;
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    console.log(
      JSON.stringify(
        advanceProgress(filePath, targetStatus, evidence, owner, { dryRun }),
      ),
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

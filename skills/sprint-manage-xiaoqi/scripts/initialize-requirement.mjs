#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { serializeProgressYaml } from "./advance-progress.mjs";
import {
  acquireLedgerLock,
  commitLedgerLock,
  releaseLedgerLock,
} from "./ledger-lock.mjs";
import {
  hasApprovedProposal,
  parseProgressYaml,
  validateProgress,
} from "./validate-progress.mjs";

const IGNORE_LINES = [
  "sprint-manage/local/",
  "sprint-manage/requirements/*.yaml.lock",
];

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateRequirementId(requirementId) {
  if (!/^[A-Za-z0-9._-]+$/.test(requirementId)) {
    throw new Error(`需求编号不能用于账本文件名: ${requirementId}`);
  }
}

function ensureIgnoreRules(projectRoot) {
  const ignorePath = path.join(projectRoot, ".gitignore");
  const source = existsSync(ignorePath) ? readFileSync(ignorePath, "utf8") : "";
  const existing = new Set(source.split(/\r?\n/));
  const missing = IGNORE_LINES.filter((line) => !existing.has(line));
  if (missing.length === 0) return;
  const prefix = source.length > 0 && !source.endsWith("\n") ? "\n" : "";
  writeFileSync(ignorePath, `${source}${prefix}${missing.join("\n")}\n`, "utf8");
}

function writeSession(projectRoot, owner, requirementId) {
  const localDir = path.join(projectRoot, "sprint-manage", "local");
  mkdirSync(localDir, { recursive: true });
  writeFileSync(
    path.join(localDir, "session.yaml"),
    `当前用户: ${JSON.stringify(owner)}\n当前需求: ${JSON.stringify(requirementId)}\n`,
    "utf8",
  );
}

function newLedger(requirementId, name, changeId, owner, confirmedBy) {
  const now = new Date().toISOString();
  return {
    schema_version: 4,
    document_type: "requirement",
    编号: requirementId,
    名称: name,
    change_id: changeId,
    revision: 1,
    updated_at: now,
    updated_by: owner,
    流程状态: "active",
    交付状态: "not-started",
    当前意图: "准备实施",
    推荐动作: "apply",
    协作: {
      模式: "single",
      负责人: owner,
      参与人: [],
      基线分支: null,
      分支: null,
      工作区: null,
      集成分支: null,
    },
    依赖需求: [],
    冲突键: [],
    影响范围: [],
    并行单元: [],
    计划: null,
    证据索引: {
      apply: null,
      checks: [],
      review: null,
      archive: {
        outcome: "pending",
        path: null,
      },
      finish: {
        outcome: "pending",
        result: null,
        summary: null,
      },
    },
    用户决策: [
      {
        kind: "proposal-confirmation",
        outcome: "approved",
        actor: confirmedBy,
        at: now,
      },
    ],
    阻塞项: [],
    事件日志: [
      {
        kind: "requirement-initialized",
        actor: owner,
        at: now,
      },
    ],
  };
}

function assertExistingMatches(document, requirementId, changeId, owner) {
  if (
    document.编号 !== requirementId ||
    document.change_id !== changeId ||
    document.协作?.负责人 !== owner
  ) {
    throw new Error(`需求账本已存在但身份不匹配: ${requirementId}`);
  }
}

function ensureProposalConfirmation(
  ledgerPath,
  requirementId,
  changeId,
  owner,
  confirmedBy,
) {
  const initial = parseProgressYaml(readFileSync(ledgerPath, "utf8"));
  assertExistingMatches(initial, requirementId, changeId, owner);
  if (
    hasApprovedProposal(initial) &&
    (initial.交付状态 !== "not-started" || initial.推荐动作 === "apply")
  ) {
    return false;
  }

  const lock = acquireLedgerLock(ledgerPath, owner);
  const lockPath = `${ledgerPath}.lock`;
  const originalSource = readFileSync(ledgerPath, "utf8");
  try {
    const document = parseProgressYaml(originalSource);
    assertExistingMatches(document, requirementId, changeId, owner);
    if (
      hasApprovedProposal(document) &&
      (document.交付状态 !== "not-started" || document.推荐动作 === "apply")
    ) {
      releaseLedgerLock(ledgerPath, lock.token);
      return false;
    }

    const now = new Date().toISOString();
    if (!hasApprovedProposal(document)) {
      const decisions = Array.isArray(document.用户决策)
        ? document.用户决策
        : [];
      decisions.push({
        kind: "proposal-confirmation",
        outcome: "approved",
        actor: confirmedBy,
        at: now,
      });
      document.用户决策 = decisions;
    }
    if (document.交付状态 === "not-started") {
      document.当前意图 = "准备实施";
      document.推荐动作 = "apply";
    }
    const events = Array.isArray(document.事件日志)
      ? document.事件日志
      : [];
    events.push({
      kind: "proposal-confirmed",
      actor: confirmedBy,
      at: now,
    });
    document.事件日志 = events;

    const issues = validateProgress(document);
    if (issues.length > 0) {
      throw new Error(
        `账本确认校验失败: ${issues[0].code} ${issues[0].message}`,
      );
    }

    writeFileSync(ledgerPath, serializeProgressYaml(document), "utf8");
    commitLedgerLock(ledgerPath, lock.token);
    return true;
  } catch (error) {
    writeFileSync(ledgerPath, originalSource, "utf8");
    if (existsSync(lockPath)) releaseLedgerLock(ledgerPath, lock.token);
    throw error;
  }
}

function existingLedgerResult(
  projectRoot,
  ledgerPath,
  requirementId,
  changeId,
  owner,
  confirmedBy,
) {
  const confirmed = ensureProposalConfirmation(
    ledgerPath,
    requirementId,
    changeId,
    owner,
    confirmedBy,
  );
  const existing = parseProgressYaml(readFileSync(ledgerPath, "utf8"));
  writeSession(projectRoot, owner, requirementId);
  return {
    outcome: confirmed ? "confirmed" : "existing",
    ledger: ledgerPath,
    recommendedNext: existing.推荐动作,
  };
}

export function initializeRequirement(
  projectRoot,
  requirementId,
  name,
  changeId,
  owner,
  confirmedBy,
) {
  const root = path.resolve(projectRoot);
  for (const [label, value] of [
    ["需求编号", requirementId],
    ["需求名称", name],
    ["change_id", changeId],
    ["负责人", owner],
    ["方案确认人", confirmedBy],
  ]) {
    if (!hasText(value)) throw new Error(`${label}不能为空`);
  }
  validateRequirementId(requirementId);

  const requirementsDir = path.join(root, "sprint-manage", "requirements");
  const ledgerPath = path.join(requirementsDir, `${requirementId}.yaml`);
  mkdirSync(requirementsDir, { recursive: true });
  ensureIgnoreRules(root);

  if (existsSync(ledgerPath)) {
    return existingLedgerResult(
      root,
      ledgerPath,
      requirementId,
      changeId,
      owner,
      confirmedBy,
    );
  }

  const document = newLedger(
    requirementId,
    name,
    changeId,
    owner,
    confirmedBy,
  );
  const issues = validateProgress(document);
  if (issues.length > 0) {
    throw new Error(`账本初始化校验失败: ${issues[0].code} ${issues[0].message}`);
  }

  try {
    writeFileSync(ledgerPath, serializeProgressYaml(document), {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return existingLedgerResult(
      root,
      ledgerPath,
      requirementId,
      changeId,
      owner,
      confirmedBy,
    );
  }

  writeSession(root, owner, requirementId);
  return {
    outcome: "created",
    ledger: ledgerPath,
    recommendedNext: "apply",
  };
}

function runCli(args) {
  if (args.length !== 6) {
    console.error(
      "用法: node initialize-requirement.mjs <project-root> <requirement-id> <name> <change-id> <owner> <confirmed-by>",
    );
    return 2;
  }
  try {
    console.log(JSON.stringify(initializeRequirement(...args)));
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
  process.exitCode = runCli(process.argv.slice(2));
}

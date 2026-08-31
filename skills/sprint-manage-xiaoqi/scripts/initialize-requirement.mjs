#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
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
import { getRequirementPath, getRequirementsDir } from "./ledger-paths.mjs";

const IGNORE_LINES = [];

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateRequirementId(requirementId) {
  if (!/^[A-Za-z0-9._-]+$/.test(requirementId)) {
    throw new Error(`需求编号不能用于账本文件名: ${requirementId}`);
  }
}

function getLedgerVersions(requirementsDir, requirementId) {
  const prefix = `${requirementId}-v`;
  return readdirSync(requirementsDir)
    .map((name) => {
      const match = name.match(new RegExp(`^${prefix}(\\d+)\\.ya?ml$`));
      return match ? { version: Number(match[1]), name } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.version - a.version);
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

function newLedger(projectRoot, requirementId, name, changeId, owner, confirmedBy, version, previousVersion = null) {
  const now = new Date().toISOString();
  return {
    schema_version: 4,
    document_type: "requirement",
    编号: requirementId,
    版本: version,
    前序版本: previousVersion,
    名称: name,
    change_id: changeId,
    revision: 1,
    updated_at: now,
    updated_by: owner,
    流程状态: "active",
    交付状态: "not-started",
    当前意图: "准备实施",
    推荐动作: "prepare-workspace",
    协作: {
      模式: "single",
      负责人: owner,
    },
    仓库: [
      { id: "main", root: path.resolve(projectRoot), branch: null, worktree: null },
    ],
    依赖需求: [],
    冲突键: [],
    影响范围: [],
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
        kind: "requirement-intake",
        outcome: "accepted",
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
  const decisions = Array.isArray(initial.用户决策) ? initial.用户决策 : [];
  if (decisions.some((decision) => decision?.kind === "requirement-intake")) {
    return false;
  }
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
    if (
      document.交付状态 === "not-started" &&
      document.推荐动作 !== "apply"
    ) {
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

  const requirementsDir = getRequirementsDir(root);
  mkdirSync(requirementsDir, { recursive: true });
  ensureIgnoreRules(root);
  const existingVersions = getLedgerVersions(requirementsDir, requirementId);
  for (const existingVersion of existingVersions) {
    const candidatePath = path.join(requirementsDir, existingVersion.name);
    const candidate = parseProgressYaml(readFileSync(candidatePath, "utf8"));
    if (
      candidate.change_id === changeId &&
      candidate.协作?.负责人 === owner
    ) {
      return existingLedgerResult(
        root,
        candidatePath,
        requirementId,
        changeId,
        owner,
        confirmedBy,
      );
    }
  }
  const version = existingVersions.length > 0 ? existingVersions[0].version + 1 : 1;
  const ledgerPath = getRequirementPath(root, requirementId, undefined, version);

  const previousVersion = existingVersions[0]
    ? path.join(requirementsDir, existingVersions[0].name)
    : null;
  const document = newLedger(
    root,
    requirementId,
    name,
    changeId,
    owner,
    confirmedBy,
    version,
    previousVersion,
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

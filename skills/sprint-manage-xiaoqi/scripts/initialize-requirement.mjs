#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { serializeProgressYaml } from "./advance-progress.mjs";
import {
  parseProgressYaml,
  validateProgress,
} from "./validate-progress.mjs";
import {
  getLedgerArchiveDir,
  getRequirementPath,
  getRequirementsDir,
} from "./ledger-paths.mjs";
import {
  acquireLedgerLock,
  commitLedgerLock,
  releaseLedgerLock,
} from "./ledger-lock.mjs";

const IGNORE_LINES = [];
const FINAL_DELIVERY_STATES = new Set(["pr-open", "merged", "kept"]);
const SUCCESS_OUTCOMES = new Set(["passed", "completed", "archived"]);

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateRequirementId(requirementId) {
  if (!/^[A-Za-z0-9._-]+$/.test(requirementId)) {
    throw new Error(`需求编号不能用于账本文件名: ${requirementId}`);
  }
}

function scanLedgerVersions(dir, requirementId) {
  if (!existsSync(dir)) return [];
  const prefix = `${requirementId}-v`;
  return readdirSync(dir)
    .map((name) => {
      const match = name.match(new RegExp(`^${prefix}(\\d+)\\.ya?ml$`));
      return match
        ? { version: Number(match[1]), name, ledgerPath: path.join(dir, name) }
        : null;
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

function existingLedgerResult(
  projectRoot,
  ledgerPath,
  requirementId,
  changeId,
  owner,
  confirmedBy,
) {
  const existing = parseProgressYaml(readFileSync(ledgerPath, "utf8"));
  assertExistingMatches(existing, requirementId, changeId, owner);
  return {
    outcome: "existing",
    ledger: ledgerPath,
    recommendedNext: existing.推荐动作,
  };
}

function assertReopenableSource(previous, requirementId, changeId, owner) {
  if (
    previous.编号 !== requirementId ||
    previous.change_id !== changeId ||
    previous.协作?.负责人 !== owner
  ) {
    throw new Error(`重开账本身份不匹配: ${requirementId}`);
  }
  if (previous.流程状态 !== "closed") {
    throw new Error("只能从已关闭（closed）的需求账本重开新版本");
  }
  if (!FINAL_DELIVERY_STATES.has(previous.交付状态)) {
    throw new Error(
      "重开账本的交付状态必须是 pr-open/merged/kept 的最终收尾状态",
    );
  }
  const archive = previous.证据索引?.archive;
  const finish = previous.证据索引?.finish;
  if (
    archive?.kind !== "archive" ||
    archive.exit_code !== 0 ||
    !SUCCESS_OUTCOMES.has(archive.outcome) ||
    typeof archive.path !== "string" ||
    archive.path.trim() === ""
  ) {
    throw new Error("重开账本缺少成功的 archive 证据，无法继承");
  }
  if (
    finish?.kind !== "finish" ||
    finish.exit_code !== 0 ||
    !SUCCESS_OUTCOMES.has(finish.outcome) ||
    finish.result !== previous.交付状态
  ) {
    throw new Error("重开账本缺少与交付状态一致的 finish 证据，无法继承");
  }
}

function reopenedEvidenceIndex(previous) {
  const source = previous.证据索引 ?? {};
  return {
    apply: source.apply ?? null,
    checks: Array.isArray(source.checks) ? source.checks : [],
    review: source.review ?? null,
    openspec_verify: source.openspec_verify ?? null,
    archive: source.archive ?? null,
    // finish 置回 pending，等用户按新收尾方式重新记录
    finish: { outcome: "pending", result: null, summary: null },
  };
}

function reopenedLedger(
  previous,
  name,
  version,
  archivedPath,
  owner,
  confirmedBy,
  now,
) {
  const document = {
    schema_version: 4,
    document_type: "requirement",
    编号: previous.编号,
    版本: version,
    前序版本: archivedPath,
    名称: name,
    change_id: previous.change_id,
    revision: 1,
    updated_at: now,
    updated_by: owner,
    流程状态: "active",
    交付状态: "ready",
    当前意图: "改写收尾方式",
    推荐动作: "finish",
    协作: previous.协作,
    仓库: previous.仓库,
    依赖需求: previous.依赖需求 ?? [],
    冲突键: previous.冲突键 ?? [],
    影响范围: previous.影响范围 ?? [],
    计划: previous.计划 ?? null,
    证据索引: reopenedEvidenceIndex(previous),
    用户决策: [
      ...(Array.isArray(previous.用户决策) ? previous.用户决策 : []),
      {
        kind: "finish-reopen",
        outcome: "approved",
        actor: confirmedBy,
        at: now,
        previous_result: previous.交付状态,
      },
    ],
    阻塞项: [],
    事件日志: [
      {
        kind: "requirement-reopened",
        actor: owner,
        at: now,
        previous_version: previous.版本 ?? null,
        previous_ledger: archivedPath,
        previous_delivery_status: previous.交付状态,
      },
    ],
  };
  if (previous.OpenSpec快照) document.OpenSpec快照 = previous.OpenSpec快照;
  if (Array.isArray(previous.任务映射)) document.任务映射 = previous.任务映射;
  return document;
}

function archiveSourceLedger(sourcePath, archivedPath, owner, successorName) {
  const originalSource = readFileSync(sourcePath, "utf8");
  const lock = acquireLedgerLock(sourcePath, owner);
  try {
    const annotated = parseProgressYaml(originalSource);
    annotated.事件日志 = Array.isArray(annotated.事件日志)
      ? annotated.事件日志
      : [];
    annotated.事件日志.push({
      kind: "ledger-archived",
      actor: owner,
      at: new Date().toISOString(),
      successor: successorName,
    });
    writeFileSync(sourcePath, serializeProgressYaml(annotated), "utf8");
    commitLedgerLock(sourcePath, lock.token);
  } catch (error) {
    writeFileSync(sourcePath, originalSource, "utf8");
    try {
      releaseLedgerLock(sourcePath, lock.token);
    } catch {
      // 锁已释放时忽略，保持原始错误抛出
    }
    throw error;
  }
  renameSync(sourcePath, archivedPath);
}

function reopenRequirement(
  root,
  requirementsDir,
  reopenFrom,
  requirementId,
  name,
  changeId,
  owner,
  confirmedBy,
) {
  const sourcePath = path.resolve(reopenFrom);
  if (!existsSync(sourcePath)) {
    throw new Error(`找不到待重开的需求账本: ${sourcePath}`);
  }
  const archiveDir = getLedgerArchiveDir(root);
  if (path.dirname(sourcePath) === archiveDir) {
    throw new Error("待重开账本已位于 archive 目录，不能重复重开");
  }
  const previous = parseProgressYaml(readFileSync(sourcePath, "utf8"));
  assertReopenableSource(previous, requirementId, changeId, owner);

  const mainVersions = scanLedgerVersions(requirementsDir, requirementId);
  // 源账本本身可以位于主目录（即将被归档）；其他未归档同需求版本属于异常状态
  const otherMainVersions = mainVersions.filter(
    (entry) => path.resolve(entry.ledgerPath) !== sourcePath,
  );
  if (otherMainVersions.length > 0) {
    throw new Error(
      `存在未归档的同需求账本版本: ${otherMainVersions[0].ledgerPath}`,
    );
  }
  const archivedVersions = scanLedgerVersions(archiveDir, requirementId);
  const version =
    [...mainVersions, ...archivedVersions].reduce(
      (max, entry) => Math.max(max, entry.version),
      0,
    ) + 1;
  const ledgerPath = getRequirementPath(root, requirementId, undefined, version);
  if (existsSync(ledgerPath)) {
    throw new Error(`目标版本账本已存在: ${ledgerPath}`);
  }

  mkdirSync(archiveDir, { recursive: true });
  const archivedPath = path.join(archiveDir, path.basename(sourcePath));
  if (existsSync(archivedPath)) {
    throw new Error(`归档目标已存在: ${archivedPath}`);
  }

  // 先构建并校验 v2，再动 v1；避免校验失败留下半重开状态
  const now = new Date().toISOString();
  const document = reopenedLedger(
    previous,
    name,
    version,
    archivedPath,
    owner,
    confirmedBy,
    now,
  );
  const issues = validateProgress(document);
  if (issues.length > 0) {
    throw new Error(
      `重开账本校验失败: ${issues[0].code} ${issues[0].message}`,
    );
  }

  archiveSourceLedger(sourcePath, archivedPath, owner, path.basename(ledgerPath));
  try {
    writeFileSync(ledgerPath, serializeProgressYaml(document), {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    // v2 写入失败时把 v1 还原回原位，不留半重开状态
    renameSync(archivedPath, sourcePath);
    throw error;
  }

  return {
    outcome: "reopened",
    ledger: ledgerPath,
    archivedLedger: archivedPath,
    inheritedEvidence: ["apply", "checks", "review", "openspec_verify", "archive"],
    recommendedNext: "finish",
  };
}

export function initializeRequirement(
  projectRoot,
  requirementId,
  name,
  changeId,
  owner,
  confirmedBy,
  options = {},
) {
  const root = path.resolve(projectRoot);
  for (const [label, value] of [
    ["需求编号", requirementId],
    ["需求名称", name],
    ["change_id", changeId],
    ["负责人", owner],
    ["接纳人", confirmedBy],
  ]) {
    if (!hasText(value)) throw new Error(`${label}不能为空`);
  }
  validateRequirementId(requirementId);

  const requirementsDir = getRequirementsDir(root);
  mkdirSync(requirementsDir, { recursive: true });
  ensureIgnoreRules(root);
  if (options.reopenFrom) {
    return reopenRequirement(
      root,
      requirementsDir,
      options.reopenFrom,
      requirementId,
      name,
      changeId,
      owner,
      confirmedBy,
    );
  }
  const existingVersions = scanLedgerVersions(requirementsDir, requirementId);
  for (const existingVersion of existingVersions) {
    const candidate = parseProgressYaml(
      readFileSync(existingVersion.ledgerPath, "utf8"),
    );
    if (
      candidate.change_id === changeId &&
      candidate.协作?.负责人 === owner
    ) {
      return existingLedgerResult(
        root,
        existingVersion.ledgerPath,
        requirementId,
        changeId,
        owner,
        confirmedBy,
      );
    }
  }
  // 版本号跨主目录与 archive/ 连续递增，避免归档后新版本回退到 1
  const allVersions = [
    ...existingVersions,
    ...scanLedgerVersions(getLedgerArchiveDir(root), requirementId),
  ];
  const version = allVersions.length > 0 ? allVersions[0].version + 1 : 1;
  const ledgerPath = getRequirementPath(root, requirementId, undefined, version);

  const previousVersion = allVersions[0]?.ledgerPath ?? null;
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
    recommendedNext: "prepare-workspace",
  };
}

function runCli(args) {
  const reopenIndex = args.indexOf("--reopen-from");
  let reopenFrom = null;
  let positional = args;
  if (reopenIndex >= 0) {
    reopenFrom = args[reopenIndex + 1];
    if (!reopenFrom) {
      console.error("--reopen-from 需要指定待重开的已关闭账本路径");
      return 2;
    }
    positional = args.filter(
      (_, index) => index !== reopenIndex && index !== reopenIndex + 1,
    );
  }
  if (positional.length !== 6) {
    console.error(
      "用法: node initialize-requirement.mjs <project-root> <requirement-id> <name> <change-id> <owner> <confirmed-by> [--reopen-from <已关闭账本路径>]",
    );
    return 2;
  }
  try {
    console.log(
      JSON.stringify(initializeRequirement(...positional, { reopenFrom })),
    );
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

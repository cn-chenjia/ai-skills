#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { serializeProgressYaml } from "./advance-progress.mjs";
import {
  acquireLedgerLock,
  commitLedgerLock,
  releaseLedgerLock,
} from "./ledger-lock.mjs";
const FINAL_DELIVERY_STATES = new Set(["pr-open", "merged", "kept"]);
const SUCCESS_OUTCOMES = new Set(["passed", "completed", "archived"]);

function assertRequirementClosable(document) {
  if (document.流程状态 === "closed") {
    throw new Error("workflow-closed: 需求已经 closed，不能重复关闭");
  }
  if (document.流程状态 === "blocked") {
    throw new Error("workflow-blocked: blocked 需求不能关闭");
  }
  const archive = document.证据索引?.archive;
  const finish = document.证据索引?.finish;
  if (!FINAL_DELIVERY_STATES.has(document.交付状态)) {
    throw new Error("close-not-ready: 关闭前必须处于最终交付状态");
  }
  if (
    archive?.kind !== "archive" ||
    archive.exit_code !== 0 ||
    !SUCCESS_OUTCOMES.has(archive.outcome) ||
    typeof archive.path !== "string" ||
    archive.path.trim() === ""
  ) {
    throw new Error("close-not-ready: 关闭前必须具备成功的 archive 证据");
  }
  if (
    finish?.kind !== "finish" ||
    finish.exit_code !== 0 ||
    !SUCCESS_OUTCOMES.has(finish.outcome) ||
    finish.result !== document.交付状态
  ) {
    throw new Error("close-not-ready: 关闭前必须具备与交付状态一致的成功 finish 证据");
  }
}
import {
  parseProgressYaml,
  validateProgress,
} from "./validate-progress.mjs";

export function closeRequirement(filePath, owner) {
  const lock = acquireLedgerLock(filePath, owner);
  const lockFile = `${filePath}.lock`;
  const original = readFileSync(filePath, "utf8");

  try {
    const document = parseProgressYaml(original);
    assertRequirementClosable(document);
    document.流程状态 = "closed";
    document.事件日志 = Array.isArray(document.事件日志)
      ? document.事件日志
      : [];
    document.事件日志.push({
      kind: "workflow-closed",
      actor: owner,
      at: new Date().toISOString(),
      delivery_status: document.交付状态,
    });

    const issues = validateProgress(document);
    if (issues.length > 0) {
      throw new Error(
        `账本校验失败: ${issues[0].code} ${issues[0].message}`,
      );
    }

    writeFileSync(filePath, serializeProgressYaml(document), "utf8");
    return commitLedgerLock(filePath, lock.token);
  } catch (error) {
    writeFileSync(filePath, original, "utf8");
    if (existsSync(lockFile)) releaseLedgerLock(filePath, lock.token);
    throw error;
  }
}

function runCli(args) {
  if (args.length !== 2) {
    console.error("用法: node close-requirement.mjs <ledger> <owner>");
    return 2;
  }
  try {
    console.log(JSON.stringify(closeRequirement(...args)));
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

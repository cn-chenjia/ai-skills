#!/usr/bin/env node

import {
  existsSync,
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
  parseProgressYaml,
  validateProgress,
} from "./validate-progress.mjs";

export function cancelRequirement(filePath, owner, reason) {
  if (!reason?.trim()) throw new Error("取消原因不能为空");

  const lock = acquireLedgerLock(filePath, owner);
  const lockFile = `${filePath}.lock`;
  const original = readFileSync(filePath, "utf8");

  try {
    const document = parseProgressYaml(original);
    if (document.流程状态 === "closed") {
      throw new Error("需求已经 closed，不能取消");
    }
    if (document.流程状态 === "cancelled") {
      throw new Error("需求已经 cancelled，不能重复取消");
    }

    document.流程状态 = "cancelled";
    document.当前意图 = "需求已取消";
    document.推荐动作 = null;
    document.阻塞项 = [];
    document.事件日志 = Array.isArray(document.事件日志)
      ? document.事件日志
      : [];
    document.事件日志.push({
      kind: "workflow-cancelled",
      actor: owner,
      at: new Date().toISOString(),
      reason: reason.trim(),
    });

    const issues = validateProgress(document);
    if (issues.length > 0) {
      throw new Error(`账本校验失败: ${issues[0].code} ${issues[0].message}`);
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
  if (args.length !== 3) {
    console.error("用法: node cancel-requirement.mjs <ledger> <owner> <reason>");
    return 2;
  }
  try {
    console.log(JSON.stringify(cancelRequirement(...args)));
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

#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

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
import { assertRequirementClosable } from "./lifecycle.mjs";
import {
  parseProgressYaml,
  validateProgress,
} from "./validate-progress.mjs";

function markClosedSession(filePath, requirementId) {
  const worktree = path.dirname(path.dirname(path.dirname(path.resolve(filePath))));
  const sessionPath = path.join(worktree, "sprint-manage", "local", "session.yaml");
  if (!existsSync(sessionPath)) return;

  const session = readFileSync(sessionPath, "utf8");
  const match = session.match(/^当前需求:\s*["']?([^"'\s]+)["']?\s*$/m);
  if (!match || match[1] !== requirementId) return;

  const next = /^会话状态:/m.test(session)
    ? session.replace(/^会话状态:.*$/m, '会话状态: "closed"')
    : `${session.endsWith("\n") ? session : `${session}\n`}会话状态: "closed"\n`;
  writeFileSync(sessionPath, next, "utf8");
}

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
    const result = commitLedgerLock(filePath, lock.token);
    markClosedSession(filePath, document.编号);
    return result;
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

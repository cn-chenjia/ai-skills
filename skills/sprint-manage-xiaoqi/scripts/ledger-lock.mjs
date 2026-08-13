#!/usr/bin/env node

import {
  closeSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  parseProgressYaml,
  validateDeliveryTransition,
  validateProgress,
} from "./validate-progress.mjs";

function lockPath(filePath) {
  return `${filePath}.lock`;
}

export function acquireLedgerLock(filePath, owner) {
  if (!owner?.trim()) throw new Error("owner 不能为空");
  const source = readFileSync(filePath, "utf8");
  const document = parseProgressYaml(source);
  const token = randomUUID();
  const lock = {
    token,
    owner,
    expectedRevision: document.revision,
    expectedDeliveryStatus: document[Object.keys(document).find((key) => key.includes("交付"))],
    acquiredAt: new Date().toISOString(),
  };
  let descriptor;
  try {
    descriptor = openSync(lockPath(filePath), "wx");
    writeFileSync(descriptor, JSON.stringify(lock, null, 2), "utf8");
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`账本已被锁定: ${filePath}`);
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  return lock;
}

export function commitLedgerLock(filePath, token) {
  const lockFile = lockPath(filePath);
  const lock = JSON.parse(readFileSync(lockFile, "utf8"));
  if (lock.token !== token) throw new Error("锁令牌不匹配");

  const source = readFileSync(filePath, "utf8");
  const document = parseProgressYaml(source);
  if (document.revision !== lock.expectedRevision) {
    throw new Error(
      `revision 已变化: expected ${lock.expectedRevision}, actual ${document.revision}`,
    );
  }
  const transitionIssues = validateDeliveryTransition(
    document,
    lock.expectedDeliveryStatus,
  );
  if (transitionIssues.length > 0) {
    throw new Error(
      `状态推进校验失败: ${transitionIssues[0].code} ${transitionIssues[0].message}`,
    );
  }
  const issues = validateProgress(document);
  if (issues.length > 0) {
    throw new Error(`账本校验失败: ${issues[0].code} ${issues[0].message}`);
  }

  const revision = lock.expectedRevision + 1;
  const updatedAt = new Date().toISOString();
  const updated = source
    .replace(/^revision:\s*\d+\s*$/m, `revision: ${revision}`)
    .replace(/^updated_at:.*$/m, `updated_at: ${JSON.stringify(updatedAt)}`)
    .replace(/^updated_by:.*$/m, `updated_by: ${JSON.stringify(lock.owner)}`);
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${token}.tmp`,
  );
  writeFileSync(temporary, updated, "utf8");
  renameSync(temporary, filePath);
  rmSync(lockFile, { force: true });
  return { revision, updatedAt, updatedBy: lock.owner };
}

export function releaseLedgerLock(filePath, token) {
  const lockFile = lockPath(filePath);
  const lock = JSON.parse(readFileSync(lockFile, "utf8"));
  if (lock.token !== token) throw new Error("锁令牌不匹配");
  rmSync(lockFile);
}

function runCli(args) {
  const [command, filePath, value] = args;
  try {
    if (command === "acquire") {
      console.log(JSON.stringify(acquireLedgerLock(filePath, value)));
      return 0;
    }
    if (command === "commit") {
      console.log(JSON.stringify(commitLedgerLock(filePath, value)));
      return 0;
    }
    if (command === "release") {
      releaseLedgerLock(filePath, value);
      console.log("released");
      return 0;
    }
    console.error(
      "用法: node ledger-lock.mjs acquire <file> <owner> | commit/release <file> <token>",
    );
    return 2;
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

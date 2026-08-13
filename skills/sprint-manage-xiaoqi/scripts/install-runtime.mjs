#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeFiles = [
  "generic-hook.mjs",
  "lifecycle.mjs",
  "ledger-lock.mjs",
  "advance-progress.mjs",
  "validate-progress.mjs",
  "guarded-run.mjs",
  "codex-hook.mjs",
  "trae-hook.mjs",
];
const runtimeDirectories = ["core", "policies", "adapters"];

function copyTree(sourceDir, targetDir, force, written, skipped) {
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyTree(source, target, force, written, skipped);
      continue;
    }
    if (existsSync(target) && !force) {
      skipped.push(target);
      continue;
    }
    copyFileSync(source, target);
    written.push(target);
  }
}

function ensureGitignore(projectRoot) {
  const filePath = path.join(projectRoot, ".gitignore");
  const entry = ".xiaoqi/";
  const original = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const lines = original.split(/\r?\n/);
  if (lines.some((line) => line.trim() === entry)) {
    return { status: "skipped", path: filePath };
  }
  const separator = original && !original.endsWith("\n") ? "\n" : "";
  writeFileSync(filePath, `${original}${separator}${entry}\n`, "utf8");
  return { status: "created", path: filePath };
}

export function installRuntime(projectRoot, { force = false } = {}) {
  const targetDir = path.join(projectRoot, ".xiaoqi", "runtime");
  const written = [];
  const skipped = [];
  mkdirSync(targetDir, { recursive: true });

  for (const name of runtimeFiles) {
    const source = path.join(scriptDir, name);
    const target = path.join(targetDir, name);
    if (existsSync(target) && !force) {
      skipped.push(target);
      continue;
    }
    copyFileSync(source, target);
    written.push(target);
  }

  for (const name of runtimeDirectories) {
    copyTree(
      path.join(scriptDir, name),
      path.join(targetDir, name),
      force,
      written,
      skipped,
    );
  }

  return {
    status: written.length > 0 ? "created" : "skipped",
    written,
    skipped,
    gitignore: ensureGitignore(projectRoot),
  };
}

function runCli(args) {
  const projectRoot = path.resolve(args[0] ?? process.cwd());
  const result = installRuntime(projectRoot, {
    force: args.includes("--force"),
  });
  result.written.forEach((file) => console.log(`created: ${file}`));
  result.skipped.forEach((file) => console.log(`skipped: ${file}`));
  console.log(`${result.gitignore.status}: ${result.gitignore.path}`);
  return 0;
}

const executedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (executedPath === import.meta.url) {
  process.exitCode = runCli(process.argv.slice(2));
}

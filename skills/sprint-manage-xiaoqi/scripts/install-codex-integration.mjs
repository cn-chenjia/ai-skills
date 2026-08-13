#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(scriptDir, "..", "templates", "codex");

export function installCodexIntegration(projectRoot, { force = false } = {}) {
  const targetDir = path.join(projectRoot, ".codex");
  mkdirSync(targetDir, { recursive: true });
  const written = [];
  const skipped = [];

  for (const name of ["config.toml", "hooks.json"]) {
    const target = path.join(targetDir, name);
    if (existsSync(target) && !force) {
      skipped.push(target);
      continue;
    }
    copyFileSync(path.join(templateDir, name), target);
    written.push(target);
  }
  return { written, skipped };
}

function runCli(args) {
  const projectRoot = path.resolve(args[0] ?? process.cwd());
  const result = installCodexIntegration(projectRoot, {
    force: args.includes("--force"),
  });
  result.written.forEach((file) => console.log(`created: ${file}`));
  result.skipped.forEach((file) => console.log(`skipped: ${file}`));
  return 0;
}

const executedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (executedPath === import.meta.url) {
  process.exitCode = runCli(process.argv.slice(2));
}

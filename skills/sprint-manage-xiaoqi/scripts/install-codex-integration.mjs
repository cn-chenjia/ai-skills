#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import process from "node:process";
import { pathToFileURL } from "node:url";

import { installRuntime } from "./install-runtime.mjs";

// Kept as a compatibility entry point. It no longer creates Codex configuration.
export function installCodexIntegration(projectRoot, options = {}) {
  return installRuntime(projectRoot, options);
}

const executedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (executedPath === import.meta.url) {
  const projectRoot = process.argv[2] ?? process.cwd();
  const result = installRuntime(projectRoot, {
    force: process.argv.includes("--force"),
  });
  console.error("提示：该兼容命令现在只安装小七通用运行时，不会生成 Codex 配置。");
  result.written.forEach((file) => console.log(`created: ${file}`));
  result.skipped.forEach((file) => console.log(`skipped: ${file}`));
  console.log(`${result.gitignore.status}: ${result.gitignore.path}`);
}

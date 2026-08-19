#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import process from "node:process";
import { pathToFileURL } from "node:url";

import { installRuntime } from "./install-runtime.mjs";

// Kept as a compatibility entry point. It no longer creates Codex configuration.
export function installCodexIntegration(options = {}) {
  return installRuntime(options);
}

const executedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (executedPath === import.meta.url) {
  const result = installRuntime({
    force: process.argv.includes("--force"),
  });
  result.written.forEach((file) => console.log(`created: ${file}`));
  result.skipped.forEach((file) => console.log(`skipped: ${file}`));
}

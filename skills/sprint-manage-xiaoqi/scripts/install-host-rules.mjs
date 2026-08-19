#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { installHostRules } from "./host-rules.mjs";

function runCli(args) {
  const projectRoot = path.resolve(args.find((arg) => !arg.startsWith("--")) ?? process.cwd());
  const tool = args.find((arg) => arg === "codex" || arg === "trae");
  if (!tool) {
    console.error(
      "用法: node install-host-rules.mjs <项目根目录> <codex|trae>",
    );
    return 2;
  }

  try {
    const result = installHostRules({
      projectRoot,
      tool,
      homeDir: os.homedir(),
    });
    console.log(`${result.status}: ${result.path}`);
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

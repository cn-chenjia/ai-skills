#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { runGuardedCommand } from "./guarded-run.mjs";

const DEFAULT_CONFIG_PATH = ".xiaoqi/actions.json";
const ACTION_KINDS = new Map([
  ["apply", "apply"],
  ["check", "check"],
  ["review", "review"],
  ["openspec-verify", "openspec-verify"],
]);

function commandName(command) {
  return path.basename(command).replace(/\.(cmd|exe|bat)$/i, "");
}

function now() {
  return new Date().toISOString();
}

function readConfig(projectRoot, configPath) {
  const filePath = path.resolve(projectRoot, configPath);
  if (!existsSync(filePath)) return {};
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function commitFor(projectRoot, policy) {
  if (!existsSync(path.join(projectRoot, ".git"))) return "working-tree";

  const gitPolicy = {
    ...policy,
    cwd: projectRoot,
    allowedCommands: Array.from(
      new Set([...(policy.allowedCommands ?? []), "git"]),
    ),
  };
  const result = runGuardedCommand("git", ["rev-parse", "HEAD"], gitPolicy);
  return result.exitCode === 0 && result.stdout.trim()
    ? result.stdout.trim()
    : "working-tree";
}

export function createCommandExecutor({
  projectRoot = process.cwd(),
  commands = undefined,
  policy = {},
  configPath = DEFAULT_CONFIG_PATH,
} = {}) {
  const configuredCommands = commands ?? readConfig(projectRoot, configPath).actions ?? {};

  return async function executeAction(action = {}) {
    const config = configuredCommands[action.name];
    if (!config?.command) {
      return {
        outcome: "needs_confirmation",
        summary: `未配置动作 ${action.name} 的执行命令`,
      };
    }

    const args = Array.isArray(config.args) ? config.args.map(String) : [];
    const commandPolicy = {
      ...policy,
      cwd: projectRoot,
      allowedCommands: Array.from(
        new Set([...(policy.allowedCommands ?? []), commandName(config.command)]),
      ),
    };
    const result = runGuardedCommand(config.command, args, commandPolicy);
    if (result.exitCode !== 0) {
      return {
        outcome: "failed",
        summary: config.failureSummary ?? result.stderr ?? `动作 ${action.name} 执行失败`,
        exit_code: result.exitCode,
      };
    }

    const kind = config.kind ?? ACTION_KINDS.get(action.name);
    if (!kind) {
      return {
        outcome: "needs_confirmation",
        summary: `动作 ${action.name} 未声明证据类型`,
      };
    }

    const output = result.stdout.trim();
    const sourceRevision = commitFor(projectRoot, policy);
    return {
      kind,
      command: [config.command, ...args].join(" "),
      exit_code: 0,
      commit: sourceRevision,
      source_revision: sourceRevision,
      checked_at: now(),
      summary: config.summary ?? (output || `${action.name} 执行成功`),
      ...(config.result ? { result: config.result } : {}),
    };
  };
}

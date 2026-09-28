#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { execFileSync, spawnSync } from "node:child_process";

const DEFAULT_CONFIG_PATH = ".xiaoqi/actions.json";
const ACTION_KINDS = new Map([
  ["apply", "apply"],
  ["check", "check"],
  ["review", "review"],
  ["openspec-verify", "openspec-verify"],
]);

function now() {
  return new Date().toISOString();
}

function readConfig(projectRoot, configPath) {
  const filePath = path.resolve(projectRoot, configPath);
  if (!existsSync(filePath)) return {};
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function repositoryCwd(projectRoot, repository) {
  const configured = repository?.worktree || repository?.root;
  if (!configured) return projectRoot;
  return path.isAbsolute(configured) ? configured : path.resolve(projectRoot, configured);
}

function commitFor(repositoryPath) {
  if (!existsSync(path.join(repositoryPath, ".git"))) return "working-tree";

  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || "working-tree";
  } catch {
    return "working-tree";
  }
}

export function createCommandExecutor({
  projectRoot = process.cwd(),
  commands = undefined,
  repositories = undefined,
  policy = {},
  configPath = DEFAULT_CONFIG_PATH,
} = {}) {
  const configFile = readConfig(projectRoot, configPath);
  const configuredCommands = commands ?? configFile.actions ?? {};
  const configuredRepositories = repositories ?? configFile.repositories ?? configFile.仓库 ?? [];

  return async function executeAction(action = {}) {
    if (!action.repository_id && configuredRepositories.length > 1) {
      const results = await Promise.all(configuredRepositories.map((repository) => executeAction({ ...action, repository_id: repository.id })));
      const failed = results.find((result) => result.outcome === "failed" || result.outcome === "needs_confirmation");
      if (failed) return failed;
      return { kind: results[0].kind, repositories: results, summary: `${action.name} 已完成全部仓库`, result: results[0].result };
    }
    const config = configuredCommands[action.name];
    const repository = configuredRepositories.find((item) => item.id === action.repository_id);
    const cwd = repositoryCwd(projectRoot, repository);
    if (!config?.command) {
      return {
        outcome: "needs_confirmation",
        summary: `未配置动作 ${action.name} 的执行命令`,
      };
    }

    const args = Array.isArray(config.args) ? config.args.map(String) : [];
    const result = spawnSync(config.command, args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      return {
        outcome: "failed",
        summary: config.failureSummary ?? result.stderr ?? result.error?.message ?? `动作 ${action.name} 执行失败`,
        exit_code: result.status ?? 1,
      };
    }

    const kind = config.kind ?? ACTION_KINDS.get(action.name);
    if (!kind) {
      return {
        outcome: "needs_confirmation",
        summary: `动作 ${action.name} 未声明证据类型`,
      };
    }

    const output = (result.stdout ?? "").trim();
    const sourceRevision = commitFor(cwd, policy);
    return {
      kind,
      command: [config.command, ...args].join(" "),
      exit_code: 0,
      commit: sourceRevision,
      source_revision: sourceRevision,
      checked_at: now(),
      summary: config.summary ?? (output || `${action.name} 执行成功`),
      ...(config.result ? { result: config.result } : {}),
      ...(action.repository_id ? { repository_id: action.repository_id } : {}),
      ...(action.name === "apply" && Array.isArray(config.completed_tasks)
        ? { completed_tasks: config.completed_tasks }
        : {}),
      ...(action.name === "apply" && Array.isArray(config.tdd_tasks)
        ? { tdd_tasks: config.tdd_tasks }
        : {}),
    };
  };
}

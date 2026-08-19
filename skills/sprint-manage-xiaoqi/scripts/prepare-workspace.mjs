#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  acquireLedgerLock,
  commitLedgerLock,
  releaseLedgerLock,
} from "./ledger-lock.mjs";
import { serializeProgressYaml } from "./advance-progress.mjs";
import { parseProgressYaml } from "./validate-progress.mjs";

const IGNORE_LINES = [
  "sprint-manage/local/",
  "sprint-manage/requirements/*.yaml.lock",
  ".worktrees/",
];

function runGit(cwd, args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0 && !allowFailure) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(`Git 执行失败: git ${args.join(" ")}${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function gitOutput(cwd, args) {
  return runGit(cwd, args).stdout.trim();
}

function branchExists(projectRoot, branch) {
  return (
    runGit(
      projectRoot,
      ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
      { allowFailure: true },
    ).status === 0
  );
}

function comparablePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function listWorktrees(projectRoot) {
  const output = gitOutput(projectRoot, ["worktree", "list", "--porcelain"]);
  if (!output) return [];
  return output.split(/\r?\n\r?\n/).map((block) => {
    const fields = {};
    for (const line of block.split(/\r?\n/)) {
      const separator = line.indexOf(" ");
      if (separator < 0) continue;
      fields[line.slice(0, separator)] = line.slice(separator + 1);
    }
    return {
      path: fields.worktree,
      branch: fields.branch?.replace(/^refs\/heads\//, ""),
    };
  });
}

function validateBranchName(projectRoot, branch) {
  const result = runGit(
    projectRoot,
    ["check-ref-format", `refs/heads/${branch}`],
    { allowFailure: true },
  );
  if (result.status !== 0) throw new Error(`需求分支名称无效: ${branch}`);
}

function detectBaseBranch(projectRoot, configured) {
  if (configured) {
    if (!branchExists(projectRoot, configured)) {
      throw new Error(`基线分支不存在: ${configured}`);
    }
    return configured;
  }

  const remoteHead = runGit(
    projectRoot,
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    { allowFailure: true },
  );
  if (remoteHead.status === 0) {
    const branch = remoteHead.stdout.trim().replace(/^origin\//, "");
    if (branch && branchExists(projectRoot, branch)) return branch;
  }

  const candidates = ["main", "master"].filter((branch) =>
    branchExists(projectRoot, branch),
  );
  if (candidates.length === 1) return candidates[0];
  throw new Error("无法唯一确定基线分支，请在需求账本中填写协作.基线分支");
}

function ensureIgnoreRules(projectRoot) {
  const ignorePath = path.join(projectRoot, ".gitignore");
  const source = existsSync(ignorePath) ? readFileSync(ignorePath, "utf8") : "";
  const existing = new Set(source.split(/\r?\n/));
  const missing = IGNORE_LINES.filter((line) => !existing.has(line));
  if (missing.length === 0) return;

  const prefix = source.length > 0 && !source.endsWith("\n") ? "\n" : "";
  writeFileSync(ignorePath, `${source}${prefix}${missing.join("\n")}\n`, "utf8");
}

function writeSession(worktree, owner, requirementId) {
  const localDir = path.join(worktree, "sprint-manage", "local");
  mkdirSync(localDir, { recursive: true });
  writeFileSync(
    path.join(localDir, "session.yaml"),
    `当前用户: ${JSON.stringify(owner)}\n当前需求: ${JSON.stringify(requirementId)}\n`,
    "utf8",
  );
}

function workspacePath(projectRoot, configured) {
  if (!configured || configured === ".") return projectRoot;
  return path.resolve(projectRoot, configured);
}

function currentWorktreeIsOccupied(ledgerPath, projectRoot, currentBranch) {
  const requirementsDir = path.dirname(ledgerPath);
  for (const name of readdirSync(requirementsDir)) {
    if (!/\.ya?ml$/i.test(name)) continue;
    const candidatePath = path.join(requirementsDir, name);
    if (path.resolve(candidatePath) === path.resolve(ledgerPath)) continue;
    const candidate = parseProgressYaml(readFileSync(candidatePath, "utf8"));
    if (
      candidate.流程状态 !== "active" ||
      candidate.交付状态 === "not-started"
    ) {
      continue;
    }
    const collaboration = candidate.协作 ?? {};
    if (
      collaboration.分支 === currentBranch ||
      workspacePath(projectRoot, collaboration.工作区) === projectRoot
    ) {
      return true;
    }
  }
  return false;
}

function relativeWorkspace(projectRoot, worktree) {
  return path.relative(projectRoot, worktree).split(path.sep).join("/");
}

function updateLedger(ledgerPath, owner, changes) {
  const lock = acquireLedgerLock(ledgerPath, owner);
  const lockPath = `${ledgerPath}.lock`;
  const original = readFileSync(ledgerPath, "utf8");
  try {
    const document = parseProgressYaml(original);
    const next = structuredClone(document);
    next.协作 = { ...next.协作, ...changes };
    writeFileSync(ledgerPath, serializeProgressYaml(next), "utf8");
    commitLedgerLock(ledgerPath, lock.token);
  } catch (error) {
    writeFileSync(ledgerPath, original, "utf8");
    if (existsSync(lockPath)) releaseLedgerLock(ledgerPath, lock.token);
    throw error;
  }
}

export function prepareWorkspace(ledgerPath, projectRoot, owner) {
  const root = path.resolve(projectRoot);
  const ledger = path.resolve(ledgerPath);
  const gitRoot = path.resolve(gitOutput(root, ["rev-parse", "--show-toplevel"]));
  if (gitRoot !== root) throw new Error(`项目根目录不匹配: ${root}`);

  const document = parseProgressYaml(readFileSync(ledger, "utf8"));
  if (document.交付状态 !== "not-started") {
    throw new Error(`只有 not-started 需求可以准备工作区: ${document.交付状态}`);
  }
  if (document.协作?.负责人 !== owner) {
    throw new Error(`只有需求负责人可以准备工作区: ${document.协作?.负责人}`);
  }

  const baseBranch = detectBaseBranch(root, document.协作?.基线分支);
  const branch = document.协作?.分支 || `codex/${document.编号}`;
  validateBranchName(root, branch);
  const currentBranch = gitOutput(root, ["branch", "--show-current"]);
  const occupied = currentWorktreeIsOccupied(ledger, root, currentBranch);
  let worktree = root;
  let mode = "current";

  if (occupied) {
    if (!/^[A-Za-z0-9._-]+$/.test(document.编号)) {
      throw new Error(`需求编号不能用于工作区目录: ${document.编号}`);
    }
    worktree = path.join(root, ".worktrees", document.编号);
    const registered = listWorktrees(root).find(
      (item) =>
        item.path && comparablePath(item.path) === comparablePath(worktree),
    );
    if (registered?.branch === branch) {
      mode = "reused";
    } else {
      if (existsSync(worktree)) throw new Error(`目标工作区已存在: ${worktree}`);
      if (branchExists(root, branch)) throw new Error(`需求分支已存在但未绑定: ${branch}`);
      ensureIgnoreRules(root);
      mkdirSync(path.dirname(worktree), { recursive: true });
      runGit(root, ["worktree", "add", "-b", branch, worktree, baseBranch]);
      mode = "created";
    }
  } else if (currentBranch !== branch) {
    if (gitOutput(root, ["status", "--porcelain"])) {
      throw new Error("当前工作区存在未提交修改，不能安全切换到需求分支");
    }
    if (branchExists(root, branch)) {
      runGit(root, ["checkout", branch]);
    } else {
      runGit(root, ["checkout", "-b", branch, baseBranch]);
    }
  }

  ensureIgnoreRules(root);
  updateLedger(ledger, owner, {
    基线分支: baseBranch,
    分支: branch,
    工作区: mode === "current" ? "." : relativeWorkspace(root, worktree),
  });
  writeSession(worktree, owner, document.编号);

  return {
    outcome: "completed",
    mode,
    ledger,
    baseBranch,
    branch,
    worktree,
    recommendedNext: "apply",
  };
}

function runCli(args) {
  if (args.length !== 3) {
    console.error(
      "用法: node prepare-workspace.mjs <requirement.yaml> <project-root> <owner>",
    );
    return 2;
  }
  try {
    console.log(JSON.stringify(prepareWorkspace(...args)));
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

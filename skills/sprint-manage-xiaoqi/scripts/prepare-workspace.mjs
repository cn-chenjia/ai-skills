#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
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
import {
  hasApprovedProposal,
  parseProgressYaml,
} from "./validate-progress.mjs";

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

function readProjectConfig(projectRoot) {
  const configPath = path.join(projectRoot, ".xiaoqi", "config.yaml");
  if (!existsSync(configPath)) return {};
  const raw = readFileSync(configPath, "utf8");
  const config = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf(":");
    if (sep < 0) continue;
    const key = trimmed.slice(0, sep).trim();
    const value = trimmed
      .slice(sep + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key) config[key] = value;
  }
  return config;
}

function detectBaseBranch(projectRoot, configured) {
  // 优先级：账本显式配置 > 项目 .xiaoqi/config.yaml > origin/HEAD > main/master 兜底
  if (configured) {
    if (!branchExists(projectRoot, configured)) {
      throw new Error(`基线分支不存在: ${configured}`);
    }
    return configured;
  }

  const projectConfig = readProjectConfig(projectRoot);
  if (projectConfig.baseBranch) {
    if (!branchExists(projectRoot, projectConfig.baseBranch)) {
      throw new Error(
        `.xiaoqi/config.yaml 配置的基线分支不存在: ${projectConfig.baseBranch}`,
      );
    }
    return projectConfig.baseBranch;
  }

  const remoteHead = runGit(
    projectRoot,
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    { allowFailure: true },
  );
  // 只在 symbolic-ref 干净返回时采用，有 broken ref 告警时跳过，不静默采用
  if (
    remoteHead.status === 0 &&
    !remoteHead.stderr.includes("broken ref") &&
    !remoteHead.stderr.includes("ignoring")
  ) {
    const branch = remoteHead.stdout.trim().replace(/^origin\//, "");
    if (branch && branchExists(projectRoot, branch)) return branch;
  }

  const candidates = ["main", "master"].filter((branch) =>
    branchExists(projectRoot, branch),
  );
  if (candidates.length === 1) return candidates[0];
  throw new Error(
    "无法唯一确定基线分支，请在需求账本中填写协作.基线分支，或在项目根目录创建 .xiaoqi/config.yaml 指定 baseBranch",
  );
}

function buildBranchName(document, projectRoot) {
  // 优先级：账本显式配置 > 项目 .xiaoqi/config.yaml 的 branchTemplate > 默认 feature/<编号>
  if (document.协作?.分支) return document.协作.分支;

  const projectConfig = readProjectConfig(projectRoot);
  const template = projectConfig.branchTemplate;
  if (template) {
    const today = new Date();
    const date = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    return template
      .replace(/\{\{id\}\}/g, document.编号)
      .replace(/\{\{date\}\}/g, date)
      .replace(/\{\{change_id\}\}/g, document.change_id ?? document.编号);
  }

  return `feature/${document.编号}`;
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
  for (const tree of listWorktrees(projectRoot)) {
    if (!tree.path) continue;
    const requirementsDir = path.join(tree.path, "sprint-manage", "requirements");
    if (!existsSync(requirementsDir)) continue;
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
      if (
        tree.branch === currentBranch ||
        comparablePath(tree.path) === comparablePath(projectRoot)
      ) {
        return true;
      }
    }
  }
  return false;
}

function moveLedgerToWorktree(ledgerPath, worktree) {
  const target = path.join(
    worktree,
    "sprint-manage",
    "requirements",
    path.basename(ledgerPath),
  );
  if (path.resolve(ledgerPath) === path.resolve(target)) return ledgerPath;
  if (existsSync(target)) return target;
  mkdirSync(path.dirname(target), { recursive: true });
  renameSync(ledgerPath, target);
  return target;
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

export function hasBlockingChanges(projectRoot) {
  const status = gitOutput(projectRoot, ["status", "--porcelain"]);
  return status
    .split(/\r?\n/)
    .filter(Boolean)
    .some((line) => {
      // untracked 的技能自身文件（账本、session 等）不阻塞切换分支
      if (line.startsWith("?? ") && /sprint-manage\//.test(line.slice(3))) {
        return false;
      }
      return true;
    });
}

function prepareWorkspace(ledgerPath, projectRoot, owner) {
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
  if (!hasApprovedProposal(document)) {
    throw new Error("方案尚未确认，不能准备需求分支和工作区");
  }

  const baseBranch = detectBaseBranch(root, document.协作?.基线分支);
  const branch = buildBranchName(document, root);
  validateBranchName(root, branch);
  const currentBranch = gitOutput(root, ["branch", "--show-current"]);

  // 检测当前分支与账本规划不一致时，若当前分支既非基线也非规划分支，给出明确提示
  if (
    currentBranch !== branch &&
    currentBranch !== baseBranch &&
    !document.协作?.分支 // 账本未显式指定分支时，用户可能在不知情下自建分支
  ) {
    console.warn(
      `[提示] 当前在分支 ${currentBranch}，账本规划使用 ${branch}（从 .xiaoqi/config.yaml 或默认规则生成）。` +
        `若要使用当前分支，请在账本 协作.分支 中显式填写 ${currentBranch}。`,
    );
  }

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
    if (hasBlockingChanges(root)) {
      throw new Error(
        "当前工作区存在未提交修改，不能安全切换到需求分支；请先提交或暂存修改，或在账本协作.分支中预填当前分支以直接登记当前工作区",
      );
    }
    if (branchExists(root, branch)) {
      runGit(root, ["checkout", branch]);
    } else {
      runGit(root, ["checkout", "-b", branch, baseBranch]);
    }
  }

  ensureIgnoreRules(root);
  const targetLedger = moveLedgerToWorktree(ledger, worktree);
  updateLedger(targetLedger, owner, {
    基线分支: baseBranch,
    分支: branch,
    工作区: ".",
  });
  writeSession(worktree, owner, document.编号);

  return {
    outcome: "completed",
    mode,
    ledger: targetLedger,
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

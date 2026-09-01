#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
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
import { getRequirementsDir } from "./ledger-paths.mjs";

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

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
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

export function detectDefaultBaseBranch(projectRoot) {
  // 只做自动探测，不参与配置决策：origin/HEAD > main/master > 全部本地分支（作为候选）
  const remoteHead = runGit(
    projectRoot,
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    { allowFailure: true },
  );
  // 只在 symbolic-ref 干净返回时采用，有 broken ref 告警时跳过，不静默采用
  let baseBranch = null;
  if (
    remoteHead.status === 0 &&
    !remoteHead.stderr.includes("broken ref") &&
    !remoteHead.stderr.includes("ignoring")
  ) {
    const branch = remoteHead.stdout.trim().replace(/^origin\//, "");
    if (branch && branchExists(projectRoot, branch)) baseBranch = branch;
  }

  const candidates = new Set(
    ["main", "master"].filter((branch) => branchExists(projectRoot, branch)),
  );
  if (baseBranch) candidates.add(baseBranch);
  if (!baseBranch) {
    const allBranches = runGit(
      projectRoot,
      ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
      { allowFailure: true },
    );
    if (allBranches.status === 0) {
      for (const name of allBranches.stdout.split(/\r?\n/)) {
        const trimmed = name.trim();
        if (trimmed) candidates.add(trimmed);
      }
    }
  }
  return { baseBranch, candidates: [...candidates] };
}

function detectBaseBranch(projectRoot, configured) {
  // 优先级：项目 .xiaoqi/config.yaml > 账本仓库条目 > 请求用户选择
  const projectConfig = readProjectConfig(projectRoot);
  if (projectConfig.baseBranch) {
    if (!branchExists(projectRoot, projectConfig.baseBranch)) {
      throw new Error(
        `.xiaoqi/config.yaml 配置的基线分支不存在: ${projectConfig.baseBranch}`,
      );
    }
    return projectConfig.baseBranch;
  }

  if (configured) {
    if (!branchExists(projectRoot, configured)) {
      throw new Error(`基线分支不存在: ${configured}`);
    }
    return configured;
  }

  const { baseBranch: defaultBranch, candidates } = detectDefaultBaseBranch(
    projectRoot,
  );
  const error = new Error(
    `未配置基线分支，需要用户选择（候选: ${candidates.length ? candidates.join(", ") : "无可用分支"}）。` +
      "可在仓库条目中填写 baseBranch，或在项目根目录创建 .xiaoqi/config.yaml 指定 baseBranch。",
  );
  error.code = "BASE_BRANCH_REQUIRED";
  error.candidates = candidates;
  error.defaultBranch = defaultBranch;
  throw error;
}

function buildBranchName(document, projectRoot, repository) {
  // 优先级：仓库显式配置 > 项目配置 > 默认值
  if (repository?.branch) return repository.branch;

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

  return `feature/${document.编号}${repository?.id && repository.id !== "main" ? `-${repository.id}` : ""}`;
}

function currentWorktreeIsOccupied(ledgerPath, projectRoot, currentBranch) {
  for (const tree of listWorktrees(projectRoot)) {
    if (!tree.path) continue;
    const requirementsDir = getRequirementsDir(projectRoot);
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

function updateLedger(ledgerPath, owner, collaboration, repositories) {
  const lock = acquireLedgerLock(ledgerPath, owner);
  const lockPath = `${ledgerPath}.lock`;
  const original = readFileSync(ledgerPath, "utf8");
  try {
    const document = parseProgressYaml(original);
    const next = structuredClone(document);
    next.协作 = {
      模式: collaboration.模式,
      负责人: collaboration.负责人,
    };
    if (repositories) next.仓库 = repositories;
    next.当前意图 = "在新工作区生成 OpenSpec 工件";
    next.推荐动作 = "propose";
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
    .some((line) => !line.startsWith("?? ") || !line.includes(".worktrees/"));
}

function prepareWorkspace(ledgerPath, projectRoot, owner, repository, document) {
  const root = path.resolve(projectRoot);
  const ledger = path.resolve(ledgerPath);
  const gitRoot = path.resolve(gitOutput(root, ["rev-parse", "--show-toplevel"]));
  if (gitRoot !== root) throw new Error(`项目根目录不匹配: ${root}`);

  if (document.交付状态 !== "not-started") {
    throw new Error(`只有 not-started 需求可以准备工作区: ${document.交付状态}`);
  }
  if (document.协作?.负责人 !== owner) {
    throw new Error(`只有需求负责人可以准备工作区: ${document.协作?.负责人}`);
  }
  const baseBranch = detectBaseBranch(root, repository?.baseBranch);
  const branch = buildBranchName(document, root, repository);
  validateBranchName(root, branch);
  if (!/^[A-Za-z0-9._-]+$/.test(document.编号)) {
    throw new Error(`需求编号不能用于工作区目录: ${document.编号}`);
  }
  const worktree = path.join(root, ".worktrees", document.编号);
  const registered = listWorktrees(root).find(
    (item) => item.path && comparablePath(item.path) === comparablePath(worktree),
  );
  let mode = "created";

  if (registered?.branch === branch) {
    mode = "reused";
  } else {
    if (existsSync(worktree)) throw new Error(`目标工作区已存在: ${worktree}`);
    if (branchExists(root, branch)) throw new Error(`需求分支已存在但未绑定: ${branch}`);
    mkdirSync(path.dirname(worktree), { recursive: true });
    runGit(root, ["worktree", "add", "-b", branch, worktree, baseBranch]);
  }

  const targetLedger = ledger;
  return {
    outcome: "completed",
    mode,
    ledger: targetLedger,
    baseBranch,
    branch,
    worktree,
    recommendedNext: "propose",
    id: repository?.id,
  };
}

function rollbackCreatedWorkspaces(created) {
  const failures = [];
  for (const item of created) {
    try {
      runGit(item.projectRoot, ["worktree", "remove", item.worktree]);
    } catch (error) {
      failures.push(`移除工作区失败 ${item.worktree}: ${error.message}`);
      continue;
    }
    try {
      runGit(item.projectRoot, ["branch", "-D", item.branch]);
    } catch (error) {
      failures.push(`删除分支失败 ${item.branch}: ${error.message}`);
    }
  }
  return failures;
}

export function prepareWorkspaces(ledgerPath, projectRoot, owner) {
  const ledger = path.resolve(ledgerPath);
  const root = path.resolve(projectRoot);
  const document = parseProgressYaml(readFileSync(ledger, "utf8"));
  if (document.交付状态 !== "not-started") {
    throw new Error(`只有 not-started 需求可以准备工作区: ${document.交付状态}`);
  }
  if (document.协作?.负责人 !== owner) {
    throw new Error(`只有需求负责人可以准备工作区: ${document.协作?.负责人}`);
  }
  const repositories = document.仓库?.length
    ? document.仓库
    : [{ id: "main", root: "." }];
  const results = [];
  const created = [];
  try {
    for (const repository of repositories) {
      const repositoryRoot = path.resolve(root, repository.root);
      const result = prepareWorkspace(ledger, repositoryRoot, owner, repository, document);
      results.push(result);
      if (result.mode === "created") {
        created.push({
          projectRoot: repositoryRoot,
          worktree: result.worktree,
          branch: result.branch,
        });
      }
    }
  } catch (error) {
    const rollbackFailures = rollbackCreatedWorkspaces(created);
    const rollbackNote = rollbackFailures.length > 0
      ? `；回滚失败，请手动清理: ${rollbackFailures.join("；")}`
      : "";
    const wrapped = new Error(
      `准备工作区失败，已回滚本次新建的工作区与分支: ${error.message}${rollbackNote}`,
    );
    if (error.code) {
      wrapped.code = error.code;
      wrapped.candidates = error.candidates;
      wrapped.defaultBranch = error.defaultBranch;
    }
    throw wrapped;
  }
  const updatedRepositories = repositories.map((repository, index) => ({
    ...repository,
    branch: results[index].branch,
    worktree: path.relative(root, results[index].worktree) || ".",
    baseBranch: results[index].baseBranch,
  }));
  const first = results[0];
  updateLedger(ledger, owner, {
    模式: document.协作.模式,
    负责人: owner,
  }, updatedRepositories);
  return {
    outcome: "completed",
    mode: first.mode,
    ledger,
    baseBranch: first.baseBranch,
    branch: first.branch,
    worktree: first.worktree,
    recommendedNext: "propose",
    repositories: results,
  };
}

export function reconcileLedgerWithGit(ledgerPathOrOptions, projectRoot) {
  const options = typeof ledgerPathOrOptions === "string"
    ? { ledgerPath: ledgerPathOrOptions, projectRoot }
    : (ledgerPathOrOptions ?? {});
  const ledgerPath = path.resolve(options.ledgerPath);
  const root = path.resolve(options.projectRoot ?? process.cwd());
  const document = parseProgressYaml(readFileSync(ledgerPath, "utf8"));
  const repositories = document.仓库?.length
    ? document.仓库
    : [{ id: "main", root: "." }];

  const issues = [];
  const repositoryReports = [];
  for (const repository of repositories) {
    const repositoryId = repository.id ?? "main";
    const repositoryIssues = [];
    const repositoryRoot = path.resolve(root, repository.root ?? ".");

    const insideGit = runGit(
      repositoryRoot,
      ["rev-parse", "--is-inside-work-tree"],
      { allowFailure: true },
    ).status === 0;

    if (!insideGit) {
      repositoryIssues.push({
        repository_id: repositoryId,
        code: "root-not-git",
        expected: "git-repository",
        actual: "not-a-git-repository",
        message: `仓库根目录不是 Git 仓库: ${repository.root ?? "."}`,
      });
    } else {
      if (!hasText(repository.branch)) {
        repositoryIssues.push({
          repository_id: repositoryId,
          code: "branch-missing",
          expected: "non-empty branch",
          actual: null,
          message: "账本未登记需求分支",
        });
      } else if (!branchExists(repositoryRoot, repository.branch)) {
        repositoryIssues.push({
          repository_id: repositoryId,
          code: "branch-missing",
          expected: repository.branch,
          actual: null,
          message: `账本分支在仓库中不存在: ${repository.branch}`,
        });
      }

      if (!hasText(repository.worktree)) {
        repositoryIssues.push({
          repository_id: repositoryId,
          code: "worktree-missing",
          expected: "non-empty worktree",
          actual: null,
          message: "账本未登记工作区",
        });
      } else {
        const worktreePath = path.resolve(root, repository.worktree);
        if (!existsSync(worktreePath)) {
          repositoryIssues.push({
            repository_id: repositoryId,
            code: "worktree-missing",
            expected: repository.worktree,
            actual: null,
            message: `工作区目录不存在: ${repository.worktree}`,
          });
        } else {
          const registered = listWorktrees(repositoryRoot).find(
            (item) => item.path && comparablePath(item.path) === comparablePath(worktreePath),
          );
          if (!registered) {
            repositoryIssues.push({
              repository_id: repositoryId,
              code: "worktree-unregistered",
              expected: "git-registered",
              actual: "unregistered",
              message: `工作区目录存在但未被 Git 注册: ${repository.worktree}`,
            });
          } else if (registered.branch !== repository.branch) {
            repositoryIssues.push({
              repository_id: repositoryId,
              code: "worktree-branch-mismatch",
              expected: repository.branch,
              actual: registered.branch ?? null,
              message: `工作区实际分支 ${registered.branch ?? "(detached)"} 与账本分支 ${repository.branch} 不一致`,
            });
          }
        }
      }
    }

    repositoryReports.push({
      repository_id: repositoryId,
      root: repository.root ?? ".",
      branch: repository.branch ?? null,
      worktree: repository.worktree ?? null,
      consistent: repositoryIssues.length === 0,
      issues: repositoryIssues,
    });
    issues.push(...repositoryIssues);
  }

  return {
    outcome: issues.length === 0 ? "consistent" : "inconsistent",
    consistent: issues.length === 0,
    repositories: repositoryReports,
    issues,
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
    console.log(JSON.stringify(prepareWorkspaces(...args)));
    return 0;
  } catch (error) {
    if (error.code === "BASE_BRANCH_REQUIRED") {
      console.error(
        JSON.stringify({
          code: error.code,
          message: error.message,
          defaultBranch: error.defaultBranch ?? null,
          candidates: error.candidates ?? [],
        }),
      );
    } else {
      console.error(error.message);
    }
    return 1;
  }
}

const executedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (executedPath === import.meta.url) {
  process.exitCode = runCli(process.argv.slice(2));
}

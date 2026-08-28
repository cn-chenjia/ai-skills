import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { assertSafeAction } from "../../skills/sprint-manage-xiaoqi/scripts/policies/command-safety.mjs";
import fsPromises from "node:fs/promises";
import { createSqliteRepository } from "../../infrastructure/persistence/sqlite-repository.mjs";
import { createCommandExecutor } from "../../infrastructure/execution/command-executor.mjs";
import { createWorkspaceManager } from "../../infrastructure/workspace-manager.mjs";
import { resolvePlanningRoot } from "../../adapters/openspec/context.mjs";
import { assertWritablePath } from "../../adapters/openspec/artifact-policy.mjs";
import { runRequirementCommand } from "./commands/requirement.mjs";
import { createDeliveryServices, runDeliveryCommand } from "./commands/delivery.mjs";
import { runStatusCommand } from "./commands/status.mjs";

function parse(argv) {
  const group = argv[0];
  const hasAction = group !== "status";
  const action = hasAction ? argv[1] : undefined;
  const positionalDeliveryId = (group === "delivery" || group === "status") && argv[hasAction ? 2 : 1] && !argv[hasAction ? 2 : 1].startsWith("--") ? argv[hasAction ? 2 : 1] : undefined;
  const rest = argv.slice(hasAction ? (positionalDeliveryId ? 3 : 2) : (positionalDeliveryId ? 2 : 1));
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) throw new Error(`无法识别参数: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = rest[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`参数 --${token.slice(2)} 需要值`);
    options[key] = value;
    i += 1;
  }
  if (!group || (!action && group !== "status")) throw new Error("用法: requirement create、delivery start|prepare|implement|verify|close、status");
  if (group === "status" && argv[1] === "show") throw new Error("status 不支持 show action，请直接使用 status [delivery-id]");
  return { group, action, deliveryId: positionalDeliveryId, options };
}

function executeCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, shell: false });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (value) => { stdout += value; });
    child.stderr.on("data", (value) => { stderr += value; });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

function defaults(options = {}, injected = {}) {
  const cwd = process.cwd();
  const explicitRoot = options.planningRoot;
  const resolveRoot = injected.resolvePlanningRoot ?? ((input) => resolvePlanningRoot({ ...input, execute: (command, args, invokeOptions) => { try { const stdout = execFileSync(command, args, { cwd: invokeOptions.cwd, encoding: "utf8" }); return { status: 0, stdout, stderr: "" }; } catch (error) { return { status: error.status ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? error.message }; } } }));
  const resolved = resolveRoot({ cwd });
  if (explicitRoot && path.resolve(cwd, explicitRoot) !== path.resolve(resolved.rootPath)) throw new Error("--planning-root 必须与 openspec context --json 解析结果一致");
  const planningRoot = resolved.rootPath;
  if (injected.repository?.planningRoot && path.resolve(injected.repository.planningRoot) !== path.resolve(planningRoot)) throw new Error("注入的 repository 必须绑定到 OpenSpec planningRoot");
  if (injected.openspec?.planningRoot && path.resolve(injected.openspec.planningRoot) !== path.resolve(planningRoot)) throw new Error("注入的 OpenSpec 必须绑定到 OpenSpec planningRoot");
  const repository = injected.repository ?? createSqliteRepository({ planningRoot });
  const policy = {
    assertCommand(input) { assertSafeAction({ command: [input.command, ...(input.args ?? [])].join(" ") }, input.cwd ?? cwd); },
    assertWritable(input) {
      if (!Array.isArray(input.writeScope) || input.writeScope.length === 0) throw new Error("writeScope is required");
      const target = input.filePath ?? input.path;
      if (target === undefined) return;
      const targetPath = path.resolve(input.cwd ?? cwd, target);
      const allowed = input.writeScope.some((scope) => {
        const scopePath = path.resolve(input.cwd ?? cwd, scope);
        return targetPath === scopePath || targetPath.startsWith(`${scopePath}${path.sep}`);
      });
      if (!allowed) throw new Error("path is outside writeScope");
    },
  };
  const executor = injected.executor ?? createCommandExecutor({ executeCommand, policy });
  const openspec = injected.openspec ?? {
    planningRoot,
    assertArtifactPath: (filePath) => assertWritablePath({ planningRoot, filePath, kind: "openspec" }),
    async archive(deliveryId, input = {}) {
      const result = await executor.run({ command: input.command, args: input.args ?? ["archive", deliveryId], cwd: planningRoot, writeScope: input.writeScope, filePath: input.path, requireCommit: false });
      return { success: result.success, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, path: input.path };
    },
  };
  const gitRun = async (args, invokeCwd = cwd) => executor.run({ command: "git", args, cwd: invokeCwd, writeScope: ["."] });
  const git = injected.git ?? {
    async currentWorktree({ path: value }) { const result = await gitRun(["-C", value, "rev-parse", "--show-toplevel"], value); if (!result.success) throw new Error(`Git current worktree failed: ${result.stderr}`); return result.stdout.trim(); },
    async branchExists({ path: value, branch }) { const result = await gitRun(["-C", value, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`], value); return result.success; },
    async createBranch({ path: value, branch }) { return gitRun(["-C", value, "branch", branch], value); },
    async createWorktree({ path: value, branch, worktree }) { return gitRun(["-C", value, "worktree", "add", worktree, branch], value); },
    async removeWorktree({ path: value, worktree }) { return gitRun(["-C", value, "worktree", "remove", worktree], value); },
    async deleteBranch({ path: value, branch }) { return gitRun(["-C", value, "branch", "-D", branch], value); },
    async merge({ path: value, branch, base }) { return gitRun(["-C", value, "merge", branch], base ?? value); },
    async openPr() { throw new Error("Git openPr requires an injected PR provider"); },
  };
  const workspaceManager = injected.workspaceManager ?? createWorkspaceManager({ git, pathExists: async (value) => { try { await fsPromises.access(value); return true; } catch { return false; } }, mkdir: async (value) => fsPromises.mkdir(value, { recursive: true }) });
  return { repository, openspec, workspaceManager, executor, git, ownedRepository: !injected.repository, services: createDeliveryServices({ repository, openspec, workspaceManager, executor, git, planningRoot }) };
}

export async function createCli(argv = [], dependencies = {}) {
  let repository;
  let ownsRepository = false;
  try {
    const parsed = parse(argv);
    if (parsed.group === "requirement" && parsed.action === "create" && !parsed.options.title) throw new Error("参数 --title 不能为空");
    const resolveInjectedContext = dependencies.resolvePlanningRoot ?? ((input) => resolvePlanningRoot({ ...input, execute: (command, args, invokeOptions) => { try { const stdout = execFileSync(command, args, { cwd: invokeOptions.cwd, encoding: "utf8" }); return { status: 0, stdout, stderr: "" }; } catch (error) { return { status: error.status ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? error.message }; } } }));
    const resolvedContext = resolveInjectedContext({ cwd: process.cwd() });
    if (parsed.options.planningRoot && resolvedContext && path.resolve(process.cwd(), parsed.options.planningRoot) !== path.resolve(resolvedContext.rootPath)) throw new Error("--planning-root 必须与 openspec context --json 解析结果一致");
    if (dependencies.repository && (!dependencies.repository.planningRoot || !resolvedContext || path.resolve(dependencies.repository.planningRoot) !== path.resolve(resolvedContext.rootPath))) throw new Error("注入的 repository 必须可证明绑定到 OpenSpec planningRoot");
    if (dependencies.openspec && (!dependencies.openspec.planningRoot || !resolvedContext || path.resolve(dependencies.openspec.planningRoot) !== path.resolve(resolvedContext.rootPath))) throw new Error("注入的 OpenSpec 必须可证明绑定到 OpenSpec planningRoot");
    if (dependencies.services && (!dependencies.services.planningRoot || !resolvedContext || path.resolve(dependencies.services.planningRoot) !== path.resolve(resolvedContext.rootPath))) throw new Error("注入的 services 必须可证明绑定到 OpenSpec planningRoot");
    if (parsed.group === "requirement" && parsed.action === "create" && !parsed.options.title) throw new Error("参数 --title 不能为空");
    const hasInjectedDependencies = Object.keys(dependencies).some((key) => key !== "resolvePlanningRoot");
    let runtime;
    if (hasInjectedDependencies) {
      const required = parsed.group === "status"
        ? ["repository"]
        : parsed.group === "requirement"
          ? ["repository", "openspec"]
          : [];
       for (const key of required) if (!dependencies[key]) throw new Error(`依赖注入缺少所需服务: ${key}`);
       runtime = { ...dependencies };
       repository = dependencies.repository;
       runtime.services = dependencies.services;
       if (parsed.group === "delivery" && !runtime.services) {
        const serviceKeys = ["repository", "openspec", "workspaceManager", "executor", "git"];
        for (const key of serviceKeys) if (!dependencies[key]) throw new Error(`依赖注入缺少所需服务: ${key}`);
        runtime.services = createDeliveryServices({ repository: runtime.repository, openspec: runtime.openspec, workspaceManager: runtime.workspaceManager, executor: runtime.executor, git: runtime.git, planningRoot: resolvedContext?.rootPath ?? runtime.openspec?.planningRoot ?? runtime.repository?.planningRoot });
      }
    } else {
      const base = defaults(parsed.options, dependencies);
      repository = base.repository;
      ownsRepository = base.ownedRepository;
      runtime = base;
    }
    let result;
    if (parsed.group === "requirement") result = await runRequirementCommand({ action: parsed.action, options: parsed.options, repository: runtime.repository, openspec: runtime.openspec });
    else if (parsed.group === "delivery") result = await runDeliveryCommand({ action: parsed.action, deliveryId: parsed.deliveryId, options: parsed.options, services: runtime.services });
    else if (parsed.group === "status" && parsed.deliveryId) result = runStatusCommand({ repository: runtime.repository, options: { ...parsed.options, deliveryId: parsed.deliveryId } });
    else if (parsed.group === "status" && parsed.action === undefined) result = runStatusCommand({ repository: runtime.repository, options: parsed.options });
    else if (parsed.group === "status") result = runStatusCommand({ repository: runtime.repository, options: { ...parsed.options, deliveryId: parsed.action } });
    else throw new Error("未知命令");
    if (ownsRepository) repository?.close?.();
    return { exitCode: 0, stdout: `${JSON.stringify(result)}\n`, stderr: "" };
  } catch (error) {
    if (ownsRepository) repository?.close?.();
    return { exitCode: 1, stdout: "", stderr: `${error.message}\n` };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await createCli(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

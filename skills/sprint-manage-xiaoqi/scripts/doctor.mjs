#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const REQUIRED_HOOK_EVENTS = ["SessionStart", "PreToolUse", "PostToolUse", "Stop"];
const HOOK_COMMAND =
  "node skills/sprint-manage-xiaoqi/scripts/codex-hook.mjs";

function check(status, message, detail = undefined) {
  return { status, message, ...(detail ? { detail } : {}) };
}

function defaultCommandRunner(projectRoot) {
  try {
    const run = (args) => {
      if (process.platform === "win32") {
        return execFileSync(
          "powershell.exe",
          ["-NoProfile", "-Command", `openspec ${args.join(" ")}`],
          { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      }
      return execFileSync(
        "openspec",
        args,
        { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    };
    const version = run(["--version"]).trim();
    run(["list", "--json"]);
    return { ok: true, version };
  } catch (error) {
    return {
      ok: false,
      message: error.code === "ENOENT" ? "未找到 openspec 命令" : "openspec 无法正常执行",
    };
  }
}

function hasSuperpowers(projectRoot, homeDir) {
  const candidates = [
    path.join(projectRoot, ".agents", "skills", "superpowers"),
    path.join(projectRoot, ".codex", "skills", "superpowers"),
    path.join(homeDir, ".agents", "skills", "superpowers"),
    path.join(homeDir, ".codex", "skills", "superpowers"),
  ];
  if (candidates.some((candidate) => existsSync(candidate))) return true;

  const cacheRoot = path.join(homeDir, ".codex", "plugins", "cache");
  const queue = [{ directory: cacheRoot, depth: 0 }];
  while (queue.length) {
    const current = queue.shift();
    if (current.depth > 4) continue;
    let entries;
    try {
      entries = readdirSync(current.directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.toLowerCase() === "superpowers") return true;
      queue.push({
        directory: path.join(current.directory, entry.name),
        depth: current.depth + 1,
      });
    }
  }
  return false;
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function checkCodexConfig(projectRoot) {
  const filePath = path.join(projectRoot, ".codex", "config.toml");
  if (!existsSync(filePath)) {
    return check("fail", "缺少 .codex/config.toml");
  }
  const content = readFileSync(filePath, "utf8");
  return content.includes("hooks = true")
    ? check("pass", "Codex Hook 功能已启用")
    : check("fail", "config.toml 未启用 hooks = true");
}

function checkCodexHooks(projectRoot) {
  const filePath = path.join(projectRoot, ".codex", "hooks.json");
  const document = readJson(filePath);
  if (!document) return check("fail", "缺少或无法解析 .codex/hooks.json");

  const hooks = document.hooks ?? {};
  const missing = REQUIRED_HOOK_EVENTS.filter((event) => {
    const entries = Array.isArray(hooks[event]) ? hooks[event] : [];
    return !entries.some((entry) =>
      Array.isArray(entry.hooks) &&
      entry.hooks.some((hook) => hook.type === "command" && hook.command === HOOK_COMMAND),
    );
  });
  const scriptPath = path.join(
    projectRoot,
    "skills",
    "sprint-manage-xiaoqi",
    "scripts",
    "codex-hook.mjs",
  );
  if (!existsSync(scriptPath)) return check("fail", "Hook 脚本不存在");
  return missing.length
    ? check("fail", "部分 Codex 事件未配置小七 Hook", missing.join(", "))
    : check("pass", "Codex Hook 配置完整");
}

function checkOptionalCodexConfig(projectRoot) {
  const filePath = path.join(projectRoot, ".codex", "config.toml");
  if (!existsSync(filePath)) {
    return check("warn", "Codex Hook is optional and not configured");
  }
  const content = readFileSync(filePath, "utf8");
  return content.includes("hooks = true")
    ? checkCodexConfig(projectRoot)
    : check("warn", "Codex Hook is optional and disabled");
}

function checkOptionalCodexHooks(projectRoot) {
  const filePath = path.join(projectRoot, ".codex", "hooks.json");
  if (!existsSync(filePath)) {
    return check("warn", "Codex Hook is optional and not installed");
  }
  return checkCodexHooks(projectRoot);
}

function checkRequirements(projectRoot) {
  const requirementsPath = path.join(projectRoot, "sprint-manage", "requirements");
  return existsSync(requirementsPath)
    ? check("pass", "需求账本目录已准备")
    : check("warn", "尚未创建需求账本目录，首次跟踪需求时再创建即可");
}

function checkGitignore(projectRoot) {
  const filePath = path.join(projectRoot, ".gitignore");
  if (!existsSync(filePath)) return check("warn", "缺少 .gitignore");
  const content = readFileSync(filePath, "utf8");
  return /(^|\r?\n)\s*sprint-manage\/local\/(?:\r?\n|$)/.test(content)
    ? check("pass", "已忽略本地会话文件")
    : check("warn", "建议在 .gitignore 中加入 sprint-manage/local/");
}

export async function runDoctor(
  projectRoot = process.cwd(),
  {
    commandRunner = defaultCommandRunner,
    homeDir = os.homedir(),
  } = {},
) {
  const openSpecResult = commandRunner(projectRoot);
  const checks = {
    openSpec: openSpecResult.ok
      ? check("pass", `OpenSpec 可用（${openSpecResult.version ?? "版本未知"}）`)
      : check("fail", openSpecResult.message ?? "OpenSpec 不可用"),
    superpowers: hasSuperpowers(projectRoot, homeDir)
      ? check("pass", "Superpowers 已发现")
      : check("warn", "未检测到 Superpowers，复杂研发流程可能无法使用"),
    codexConfig: checkOptionalCodexConfig(projectRoot),
    codexHooks: checkOptionalCodexHooks(projectRoot),
    requirements: checkRequirements(projectRoot),
    gitignore: checkGitignore(projectRoot),
  };
  return {
    ok: Object.values(checks).every((result) => result.status !== "fail"),
    changed: false,
    projectRoot: path.resolve(projectRoot),
    checks,
  };
}

function printReport(result) {
  const labels = { pass: "通过", warn: "提醒", fail: "失败" };
  for (const [name, item] of Object.entries(result.checks)) {
    console.log(`[${labels[item.status]}] ${name}: ${item.message}`);
    if (item.detail) console.log(`       ${item.detail}`);
  }
  console.log(result.ok ? "\n小七初始化检查通过。" : "\n小七初始化检查未通过，请先处理失败项。");
}

const executedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (executedPath === import.meta.url) {
  const projectRoot = path.resolve(process.argv[2] ?? process.cwd());
  const result = await runDoctor(projectRoot);
  printReport(result);
  process.exitCode = result.ok ? 0 : 1;
}

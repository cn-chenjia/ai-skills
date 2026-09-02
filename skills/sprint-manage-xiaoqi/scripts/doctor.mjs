#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import { existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { getRequirementsDir } from "./ledger-paths.mjs";
import { detectDefaultBaseBranch } from "./prepare-workspace.mjs";

function check(status, message, detail = undefined) {
  return { status, message, ...(detail ? { detail } : {}) };
}

function defaultCommandRunner(projectRoot, command) {
  const [executable, ...args] = command;
  try {
    if (executable === "node") {
      const output = execFileSync(process.execPath, args, {
        cwd: projectRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { ok: true, output: output.trim() };
    }
    const output = process.platform === "win32"
      ? execFileSync(
          "powershell.exe",
          ["-NoProfile", "-Command", `${executable} ${args.join(" ")}`],
          { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        )
      : execFileSync(executable, args, {
          cwd: projectRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
    return { ok: true, output: output.trim() };
  } catch (error) {
    return {
      ok: false,
      message:
        error.code === "ENOENT"
          ? `未找到 ${executable} 命令`
          : `${executable} 命令无法正常执行`,
    };
  }
}

const SKILL_TOOL_DIRS = [
  ".agents/skills",
  ".codex/skills",
  ".claude/skills",
  ".cursor/skills",
  ".trae/skills",
  ".trae-cn/skills",
  ".gemini/skills",
  ".github/skills",
  "skills",
];

function findInstalledSkill(name, projectRoot, homeDir) {
  const roots = [projectRoot, homeDir].flatMap((root) =>
    SKILL_TOOL_DIRS.map((relative) => path.join(root, relative)),
  );
  const matches = (entryName) =>
    entryName.toLowerCase() === name.toLowerCase() ||
    (name === "openspec" &&
      entryName.toLowerCase().startsWith(`${name.toLowerCase()}-`));
  let found = null;
  for (const root of roots) {
    const exact = path.join(root, name);
    if (existsSync(exact) || existsSync(path.join(exact, "SKILL.md"))) {
      found = exact;
      break;
    }
    try {
      const entry = readdirSync(root, { withFileTypes: true }).find(
        (candidate) => candidate.isDirectory() && matches(candidate.name),
      );
      if (entry) {
        found = path.join(root, entry.name);
        break;
      }
    } catch {
      continue;
    }
  }
  return found ? { source: "skill", path: found } : null;
}

function findInstalledPlugin(name, homeDir) {
  const cacheRoots = [
    path.join(homeDir, ".codex", "plugins", "cache"),
    path.join(homeDir, ".claude", "plugins", "cache"),
  ];
  for (const cacheRoot of cacheRoots) {
    const queue = [{ directory: cacheRoot, depth: 0 }];
    while (queue.length) {
      const current = queue.shift();
      if (current.depth > 5) continue;
      let entries;
      try {
        entries = readdirSync(current.directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(current.directory, entry.name);
        if (entry.name.toLowerCase() === name.toLowerCase()) {
          return { source: "plugin", path: candidate };
        }
        queue.push({ directory: candidate, depth: current.depth + 1 });
      }
    }
  }
  return null;
}

function checkSkill(
  name,
  label,
  projectRoot,
  homeDir,
  { tool = "unknown" } = {},
) {
  const plugin = tool === "codex" || tool === "unknown"
    ? findInstalledPlugin(name, homeDir)
    : null;
  const skill = findInstalledSkill(name, projectRoot, homeDir);
  const installed = plugin ?? skill;
  if (installed) {
    const sourceLabel = installed.source === "plugin" ? "插件" : "skill";
    return check("pass", `${label} 已通过 ${sourceLabel} 安装`, installed.path);
  }

  return check(
    "fail",
    `${label} skill 未安装`,
    label === "OpenSpec"
      ? "可运行 openspec init --tools <当前工具>，或按当前工具安装对应的 openspec-* skill。"
      : `请按当前工具安装 ${label} skill 或插件，安装后重新运行体检。`,
  );
}

function checkSuperpowers(projectRoot, homeDir) {
  const plugin = findInstalledPlugin("superpowers", homeDir);
  const skill = findInstalledSkill("using-superpowers", projectRoot, homeDir);
  const installed = plugin ?? skill;
  if (installed) {
    const sourceLabel = installed.source === "plugin" ? "插件" : "skill";
    return check("pass", `Superpowers 已通过 ${sourceLabel} 安装`, installed.path);
  }

  return check(
    "fail",
    "Superpowers skill 未安装",
    "请按当前工具安装 Superpowers 插件，或安装平铺的 using-superpowers skill，安装后重新运行体检。",
  );
}

function checkDirectory(directory, message, detail) {
  return existsSync(directory)
    ? check("pass", message, directory)
    : check("warn", `${message}不存在`, detail);
}

function checkSkills(projectRoot, homeDir) {
  const openSpec = checkSkill("openspec", "OpenSpec", projectRoot, homeDir);
  const superpowers = checkSuperpowers(projectRoot, homeDir);
  const failures = [openSpec, superpowers].filter((item) => item.status === "fail");
  return failures.length === 0
    ? check("pass", "OpenSpec / Superpowers 相关技能已发现", {
        openSpec: openSpec.detail,
        superpowers: superpowers.detail,
      })
    : check("warn", "未完整发现 OpenSpec / Superpowers 相关技能", {
        openSpec: openSpec.detail ?? openSpec.message,
        superpowers: superpowers.detail ?? superpowers.message,
      });
}

export async function runDoctor(
  projectRoot = process.cwd(),
  {
    commandRunner = defaultCommandRunner,
    homeDir = os.homedir(),
  } = {},
) {
  const nodeResult = commandRunner(projectRoot, ["node", "-v"]);
  const openSpecVersion = commandRunner(projectRoot, ["openspec", "--version"]);
  const openSpecContext = commandRunner(projectRoot, ["openspec", "context", "--json"]);
  const defaultBase = detectDefaultBaseBranch(projectRoot);
  const checks = {
    nodejs: nodeResult.ok
      ? check("pass", "Node.js 可用", nodeResult.output)
      : check("warn", "Node.js 不可用", nodeResult.message),
    openSpec: openSpecVersion.ok
      ? check("pass", "OpenSpec 命令可执行", openSpecVersion.output)
      : check("warn", "OpenSpec 命令不可执行", openSpecVersion.message),
    ledger: checkDirectory(
      getRequirementsDir(projectRoot, homeDir),
      "小七运行时账本目录",
      "首次使用需求账本时再创建 ~/.xiaoqi/sprint-manage",
    ),
    skills: checkSkills(projectRoot, homeDir),
    openSpecContext: openSpecContext.ok
      ? check("pass", "OpenSpec 项目上下文可用", openSpecContext.output)
      : check("warn", "OpenSpec 项目上下文不可用", openSpecContext.message),
    baseBranch: defaultBase.baseBranch
      ? check(
          "pass",
          `当前基准分支: ${defaultBase.baseBranch}`,
          "可在仓库条目 baseBranch 或 .xiaoqi/config.yaml 中显式覆盖",
        )
      : defaultBase.candidates.length
        ? check(
            "warn",
            "未配置基准分支，需要用户选择",
            `候选分支: ${defaultBase.candidates.join(", ")}（可在 .xiaoqi/config.yaml 指定 baseBranch）`,
          )
        : check(
            "warn",
            "未配置基准分支",
            "无法探测到可用分支，或当前目录不是 Git 仓库",
          ),
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
    console.log(`[${labels[item.status] ?? item.status}] ${name}: ${item.message}`);
    if (item.detail) console.log(`       ${item.detail}`);
  }
  console.log(
    result.ok
      ? "\n环境检查通过。"
      : "\n环境检查发现提醒，请查看各检查项。", 
  );
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

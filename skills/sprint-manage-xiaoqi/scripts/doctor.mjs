#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { hasManagedBlock, hostRulesPath } from "./host-rules.mjs";

const RUNTIME_FILES = [
  "generic-hook.mjs",
  "guarded-run.mjs",
  "codex-hook.mjs",
  "trae-hook.mjs",
];
const RUNTIME_DIRECTORIES = ["core", "policies"];

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
          {
            cwd: projectRoot,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
      }
      return execFileSync("openspec", args, {
        cwd: projectRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    };
    const version = run(["--version"]).trim();
    run(["list", "--json"]);
    return { ok: true, version };
  } catch (error) {
    return {
      ok: false,
      message:
        error.code === "ENOENT"
          ? "未找到 openspec 命令"
          : "openspec 无法正常执行",
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

function detectTool(projectRoot, requestedTool) {
  if (requestedTool) return requestedTool.toLowerCase();
  if (existsSync(path.join(projectRoot, ".trae"))) return "trae";
  if (
    existsSync(path.join(projectRoot, ".codex")) ||
    existsSync(path.join(projectRoot, ".codex", "hooks.json"))
  ) {
    return "codex";
  }
  return "unknown";
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

function checkSuperpowers(projectRoot, homeDir, tool) {
  const plugin = tool === "codex" || tool === "unknown"
    ? findInstalledPlugin("superpowers", homeDir)
    : null;
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

function runtimeRoots(projectRoot, homeDir) {
  return [
    path.join(homeDir, ".xiaoqi", "runtime"),
    path.join(projectRoot, "skills", "sprint-manage-xiaoqi", "scripts"),
  ];
}

function checkRuntime(projectRoot, homeDir, configured) {
  if (!configured) {
    return check(
      "warn",
      "Hook 未启用，通用运行时未安装（可忽略）",
      "如需启用 Hook，再运行 install-runtime.mjs 安装。",
    );
  }

  const missing = [];
  const root = runtimeRoots(projectRoot, homeDir).find((candidate) => {
    const filesExist = RUNTIME_FILES.every((name) =>
      existsSync(path.join(candidate, name)),
    );
    const directoriesExist = RUNTIME_DIRECTORIES.every((name) =>
      existsSync(path.join(candidate, name)),
    );
    return filesExist && directoriesExist;
  });

  if (root) {
    return check("pass", "小七通用运行时可用", root);
  }

  for (const candidate of runtimeRoots(projectRoot, homeDir)) {
    for (const name of RUNTIME_FILES) {
      if (!existsSync(path.join(candidate, name))) missing.push(name);
    }
    for (const name of RUNTIME_DIRECTORIES) {
      if (!existsSync(path.join(candidate, name))) missing.push(`${name}/`);
    }
  }
  return check(
    "fail",
    "缺少小七通用运行时",
    [...new Set(missing)].join(", "),
  );
}

function checkOpenSpecProject(projectRoot) {
  const root = path.join(projectRoot, "openspec");
  const required = ["config.yaml", "changes", "specs"];
  const missing = required.filter((name) => !existsSync(path.join(root, name)));
  return missing.length === 0
    ? check("pass", "OpenSpec 项目已初始化", root)
    : check(
        "fail",
        "OpenSpec 项目尚未初始化",
        `请运行 openspec init；缺少：${missing.join(", ")}`,
      );
}

function hasJsonConfig(projectRoot, relativePath) {
  return existsSync(path.join(projectRoot, relativePath));
}

function hasCodexHookConfig(projectRoot) {
  const configPath = path.join(projectRoot, ".codex", "config.toml");
  const hooksPath = path.join(projectRoot, ".codex", "hooks.json");
  if (existsSync(hooksPath)) return true;
  if (!existsSync(configPath)) return false;
  return readFileSync(configPath, "utf8").includes("hooks = true");
}

function hasAnyHookConfig(projectRoot, tool) {
  if (tool === "codex") return hasCodexHookConfig(projectRoot);
  if (tool === "trae") return hasJsonConfig(projectRoot, ".trae/hooks.json");
  return hasCodexHookConfig(projectRoot) ||
    hasJsonConfig(projectRoot, ".trae/hooks.json");
}

function adapterRoots(projectRoot, homeDir) {
  return runtimeRoots(projectRoot, homeDir).map((root) => path.join(root, "adapters"));
}

function checkAdapter(projectRoot, homeDir, { id, label, configured, active }) {
  if (!active) {
    return check("skip", `${label} 当前工具未使用，已忽略检查`);
  }
  if (!configured) {
    return check(
      "warn",
      `${label} 适配器未安装，可按需启用`,
      `安装通用运行时后可使用用户目录下的 .xiaoqi/runtime/adapters/${id}.mjs`,
    );
  }

  const adapterPath = adapterRoots(projectRoot, homeDir)
    .map((root) => path.join(root, `${id}.mjs`))
    .find((candidate) => existsSync(candidate));
  return adapterPath
    ? check("pass", `${label} 适配器已安装`, adapterPath)
    : check(
        "warn",
        `已检测到 ${label} Hook 配置，但 ${label} 适配器未安装`,
        `请安装用户目录下的 .xiaoqi/runtime/adapters/${id}.mjs`,
      );
}

function checkHookEnable(id, configured) {
  if (!configured) {
    return check("warn", `${id} Hook 未配置`, "安装并配置 Hook 后再在对应工具内启用。");
  }
  if (id === "codex") {
    return check("pass", "Codex Hook 已配置", "请在 Codex 中执行 /hooks，审核并信任项目 Hook。");
  }
  if (id === "trae") {
    return check("pass", "Trae Hook 已配置", "请在 Trae 项目设置中启用并信任项目 Hook。");
  }
  return check("pass", `${id} Hook 已配置`, "请在对应工具内启用并信任项目 Hook。");
}

function checkRequirements(projectRoot) {
  const requirementsPath = path.join(
    projectRoot,
    "sprint-manage",
    "requirements",
  );
  return existsSync(requirementsPath)
    ? check("pass", "需求账本目录已准备")
    : check("warn", "尚未创建需求账本目录，首次跟踪需求时再创建即可");
}

function checkHostRules(projectRoot, homeDir, tool) {
  if (tool !== "codex" && tool !== "trae") {
    return check("skip", "未识别 Codex 或 Trae，已忽略宿主会话规则检查");
  }

  const target = hostRulesPath({
    projectRoot,
    tool,
    homeDir,
  });
  if (existsSync(target) && hasManagedBlock(readFileSync(target, "utf8"))) {
    return check("pass", `${tool === "codex" ? "Codex AGENTS.md" : "Trae 全局规则"} 已配置`, target);
  }

  return check(
    "warn",
    `${tool === "codex" ? "Codex AGENTS.md" : "Trae 全局规则"} 未配置`,
    `请运行 node "<小七技能安装目录>/scripts/install-host-rules.mjs" "${projectRoot}" ${tool}`,
  );
}

export async function runDoctor(
  projectRoot = process.cwd(),
  {
    commandRunner = defaultCommandRunner,
    homeDir = os.homedir(),
    tool,
  } = {},
) {
  const activeTool = detectTool(projectRoot, tool);
  const openSpecResult = commandRunner(projectRoot);
  const checks = {
    nodejs: check("pass", `Node.js 已安装（${process.version}）`, process.execPath),
    runtime: checkRuntime(projectRoot, homeDir, hasAnyHookConfig(projectRoot, activeTool)),
    codexAdapter: checkAdapter(projectRoot, homeDir, {
      id: "codex",
      label: "Codex",
      configured: hasCodexHookConfig(projectRoot),
      active: activeTool === "codex",
    }),
    codexHookEnable: activeTool === "codex"
      ? checkHookEnable("codex", hasCodexHookConfig(projectRoot))
      : check("skip", "Codex 当前工具未使用，已忽略检查"),
    traeAdapter: checkAdapter(projectRoot, homeDir, {
      id: "trae",
      label: "Trae",
      configured: hasJsonConfig(projectRoot, ".trae/hooks.json"),
      active: activeTool === "trae",
    }),
    traeHookEnable: activeTool === "trae"
      ? checkHookEnable("trae", hasJsonConfig(projectRoot, ".trae/hooks.json"))
      : check("skip", "Trae 当前工具未使用，已忽略检查"),
    openSpec: openSpecResult.ok
      ? check("pass", `OpenSpec 可用（${openSpecResult.version ?? "版本未知"}）`)
      : check("fail", openSpecResult.message ?? "OpenSpec 不可用"),
    superpowers: checkSuperpowers(projectRoot, homeDir, activeTool),
    openSpecSkill: checkSkill("openspec", "OpenSpec", projectRoot, homeDir),
    openSpecProject: checkOpenSpecProject(projectRoot),
    requirements: checkRequirements(projectRoot),
    hostRules: checkHostRules(projectRoot, homeDir, activeTool),
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
      ? "\n小七初始化检查通过。"
      : "\n小七初始化检查未通过，请先处理失败项。",
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

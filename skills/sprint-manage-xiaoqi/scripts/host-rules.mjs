#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const START_MARKER = "<!-- xiaoqi-session-lock:start -->";
const END_MARKER = "<!-- xiaoqi-session-lock:end -->";

function normalizeTool(tool) {
  const normalized = String(tool ?? "").trim().toLowerCase();
  if (normalized !== "codex" && normalized !== "trae") {
    throw new Error(`unsupported-host-tool: ${tool ?? "unknown"}`);
  }
  return normalized;
}

export function hostRulesPath({
  projectRoot = process.cwd(),
  tool,
  homeDir = os.homedir(),
} = {}) {
  const normalizedTool = normalizeTool(tool);
  return normalizedTool === "codex"
    ? path.join(projectRoot, "AGENTS.md")
    : path.join(homeDir, ".trae-cn", "user_rules", "xiaoqi-session-lock.md");
}

export function managedBlock(tool) {
  const normalizedTool = normalizeTool(tool);
  const scope =
    normalizedTool === "codex"
      ? "Codex 项目规则"
      : "Trae 全局规则";

  return `${START_MARKER}
## 小七会话接管（${scope}）

本规则由 sprint-manage-xiaoqi 安装器维护。

- 小七一旦在当前会话接管流程，后续用户消息默认继续使用小七，不要求重复输入“小七”。
- “确认”“确认执行”“可以”“执行”“开始”“继续”“好”“好的”“没问题”“方案没问题”“按这个做”都是当前小七流程的续接消息。
- 续接消息不能重新触发普通技能匹配，也不能切换到其他技能；应结合上一轮待确认事项、当前需求账本和 OpenSpec 状态继续处理。
- 只有用户明确输入“退出小七”才解除会话接管。
- 上下文被压缩或恢复后，先重新读取小七技能和当前需求账本，再继续原流程。
- 新需求先完成 propose 并等待用户确认；确认后调用 initialize-requirement.mjs 建账并记录确认人，未确认或未建账不得进入 apply、验证、评审、归档或 finish。
- 建账后自动调用 prepare-workspace.mjs。当前工作区未被其他 active 需求占用时可登记为专属工作区，不要求额外新建 worktree。
- 普通失败先自动修复并重试，同一错误第 3 次失败才 blocked；高风险、权限或人工确认错误可以立即 blocked。
- 到达 ready 后停止自动流程，等待用户选择创建 PR、合并或保留分支，再执行归档和 finish。
- 最终交付与归档证据齐全后调用 close-requirement.mjs，不能只口头宣称 closed。
- 小七流程到达 ready、blocked 或 closed 后，按小七规则处理，不要自行改用其他技能接管同一需求。
${END_MARKER}
`;
}

export function hasManagedBlock(source) {
  return source.includes(START_MARKER) && source.includes(END_MARKER);
}

function updateManagedBlock(source, block) {
  const pattern = new RegExp(
    `${START_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${END_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\r?\\n?`,
    "m",
  );
  if (pattern.test(source)) return source.replace(pattern, block);
  if (!source) return block;
  return `${source.replace(/\s*$/, "")}\n\n${block}`;
}

export function installHostRules({
  projectRoot = process.cwd(),
  tool,
  homeDir = os.homedir(),
} = {}) {
  const normalizedTool = normalizeTool(tool);
  const target = hostRulesPath({
    projectRoot,
    tool: normalizedTool,
    homeDir,
  });
  const block = managedBlock(normalizedTool);
  const existed = existsSync(target);
  const source = existed ? readFileSync(target, "utf8") : "";
  const hadManagedBlock = hasManagedBlock(source);
  const next = updateManagedBlock(source, block);

  if (next === source) {
    return { status: "unchanged", tool: normalizedTool, path: target };
  }

  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, next, "utf8");
  return {
    status: hadManagedBlock ? "updated" : "created",
    tool: normalizedTool,
    path: target,
  };
}

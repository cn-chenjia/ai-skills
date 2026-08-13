#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { assertPathsAllowed } from "./guarded-run.mjs";
import { runLifecycleHook } from "./lifecycle.mjs";

const DESTRUCTIVE_COMMANDS = [
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[^\n]*f/i,
  /\bgit\s+push\s+--force(?:-with-lease)?\b/i,
  /\b(remove-item|del|rmdir|rd)\b[^\n]*(-recurse|-force|\/s)/i,
  /\brm\s+-[^\n]*r[^\n]*f/i,
];

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => {
      try {
        resolve(input.trim() ? JSON.parse(input) : {});
      } catch (error) {
        reject(new Error(`invalid-hook-input: ${error.message}`));
      }
    });
    process.stdin.on("error", reject);
  });
}

function output(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function deny(reason) {
  return {
    continue: false,
    stopReason: reason,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

function allow() {
  return { continue: true };
}

function discoverLedger(payload) {
  const root = payload.cwd ?? process.cwd();
  const requirementsDir = path.join(root, "sprint-manage", "requirements");
  let files = [];
  try {
    files = readdirSync(requirementsDir)
      .filter((name) => /\.ya?ml$/i.test(name))
      .map((name) => path.join(requirementsDir, name));
  } catch {
    return null;
  }
  if (files.length === 1) return files[0];

  const sessionPath = path.join(root, "sprint-manage", "local", "session.yaml");
  try {
    const session = readFileSync(sessionPath, "utf8");
    const match = session.match(
      /(?:current|当前|当前需求|current_requirement)[^:]*:\s*["']?([^"'\s]+)["']?/i,
    );
    if (!match) return null;
    return files.find((file) => path.basename(file, path.extname(file)) === match[1]) ?? null;
  } catch {
    return null;
  }
}

function ledgerPath(payload) {
  return (
    payload.ledger ??
    payload.input?.ledger ??
    process.env.XIAOQI_LEDGER ??
    discoverLedger(payload)
  );
}

function actor(payload) {
  return payload.actor ?? process.env.XIAOQI_ACTOR ?? "codex";
}

function toolName(payload) {
  return payload.tool_name ?? payload.toolName ?? "unknown-tool";
}

function commandText(payload) {
  const input = payload.tool_input ?? payload.input ?? {};
  if (typeof input.command === "string") return input.command;
  if (typeof input.commandLine === "string") return input.commandLine;
  if (typeof input.cmd === "string") return input.cmd;
  return "";
}

function assertSafeCommand(payload) {
  const command = commandText(payload);
  if (DESTRUCTIVE_COMMANDS.some((pattern) => pattern.test(command))) {
    throw new Error("destructive-command-denied: command requires explicit confirmation");
  }

  const paths = payload.tool_input?.paths ?? payload.paths;
  const scopes = payload.tool_input?.writeScopes ?? payload.writeScopes;
  if (paths && scopes) assertPathsAllowed(paths, scopes, payload.cwd ?? process.cwd());
}

function recordHook(hook, payload, action, outcome = undefined) {
  const filePath = ledgerPath(payload);
  if (!filePath) return;
  const data = {
    action,
    tool_name: toolName(payload),
    summary:
      payload.summary ??
      (commandText(payload) || `${action} ${toolName(payload)}`),
  };
  if (outcome !== undefined) data.outcome = outcome;
  runLifecycleHook(hook, filePath, data, actor(payload));
}

export function handle(payload) {
  const event = payload.hook_event_name ?? payload.event ?? "";

  if (event === "PreToolUse") {
    try {
      assertSafeCommand(payload);
      recordHook("before-action", payload, "pre-tool-use");
      return allow();
    } catch (error) {
      return deny(error.message);
    }
  }

  if (event === "SessionStart") {
    try {
      recordHook("session-start", payload, "session-start");
      return allow();
    } catch (error) {
      return { continue: false, stopReason: error.message };
    }
  }

  if (event === "PostToolUse") {
    try {
      const failed =
        payload.error ||
        payload.tool_result?.error ||
        (Number.isInteger(payload.tool_result?.exit_code) &&
          payload.tool_result.exit_code !== 0);
      recordHook(
        failed ? "on-failure" : "after-action",
        payload,
        "post-tool-use",
        failed ? undefined : "completed",
      );
      return allow();
    } catch (error) {
      return { continue: false, stopReason: error.message };
    }
  }

  if (event === "Stop") {
    try {
      recordHook("after-action", payload, "stop", "stopped");
      return allow();
    } catch (error) {
      return { continue: false, stopReason: error.message };
    }
  }

  return allow();
}

export function hookExitCode(result) {
  return result.hookSpecificOutput?.permissionDecision === "deny" ? 2 : 0;
}

const executedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (executedPath === import.meta.url) {
  const payload = await readStdin();
  const result = handle(payload);
  output(result);
  process.exitCode = hookExitCode(result);
}

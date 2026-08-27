#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import { readdirSync } from "node:fs";
import path from "node:path";

import { handleNormalizedEvent, normalizedExitCode } from "../core/hook-runtime.mjs";

const EVENT_MAP = new Map([
  ["SessionStart", "session-start"],
  ["PreToolUse", "before-action"],
  ["PostToolUse", "after-action"],
  ["Stop", "stop"],
]);

function commandText(payload) {
  const input = payload.tool_input ?? payload.input ?? {};
  if (typeof input.command === "string") return input.command;
  if (typeof input.commandLine === "string") return input.commandLine;
  if (typeof input.cmd === "string") return input.cmd;
  return "";
}

function actionFrom(payload) {
  const input = payload.tool_input ?? payload.input ?? {};
  const action = {
    name: payload.tool_name ?? payload.toolName ?? "unknown-tool",
    command: commandText(payload),
    paths: input.paths ?? payload.paths,
    writeScopes: input.writeScopes ?? payload.writeScopes,
    summary: payload.summary,
  };
  return action;
}

function resultFrom(payload) {
  const toolResult = payload.tool_result ?? {};
  return {
    ok: !(
      payload.error ||
      toolResult.error ||
      (Number.isInteger(toolResult.exit_code) && toolResult.exit_code !== 0)
    ),
    exitCode: toolResult.exit_code,
    error: payload.error ?? toolResult.error,
    retryable: toolResult.retryable ?? payload.retryable,
  };
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
    return undefined;
  }
  return files.length === 1 ? files[0] : undefined;
}

export function normalizeCodexEvent(payload = {}) {
  const event = EVENT_MAP.get(payload.hook_event_name ?? payload.event) ?? "unknown";
  return {
    version: 1,
    source: "codex",
    event,
    actor: payload.actor ?? process.env.XIAOQI_ACTOR ?? "codex",
    cwd: payload.cwd ?? process.cwd(),
    ledger:
      payload.ledger ??
      payload.input?.ledger ??
      process.env.XIAOQI_LEDGER ??
      discoverLedger(payload),
    action: actionFrom(payload),
    result: event === "after-action" ? resultFrom(payload) : undefined,
  };
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

export function toCodexResponse(result) {
  if (result.decision === "deny") return deny(result.reason);
  if (result.decision === "stop") {
    return { continue: false, stopReason: result.reason };
  }
  return { continue: true };
}

export function handleCodexPayload(payload) {
  return toCodexResponse(handleNormalizedEvent(normalizeCodexEvent(payload)));
}

export function codexExitCode(result) {
  return normalizedExitCode(
    result.hookSpecificOutput?.permissionDecision === "deny"
      ? { decision: "deny" }
      : { decision: result.continue === false ? "stop" : "allow" },
  );
}

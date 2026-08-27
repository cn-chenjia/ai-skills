#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import { readdirSync } from "node:fs";
import path from "node:path";

import { resolveOpenSpecContext } from "../openspec-context.mjs";
import {
  handleNormalizedEvent,
  normalizedExitCode,
} from "../core/hook-runtime.mjs";

const EVENT_MAP = new Map([
  ["sessionstart", "session-start"],
  ["session-start", "session-start"],
  ["pretooluse", "before-action"],
  ["pre-tool-use", "before-action"],
  ["beforeaction", "before-action"],
  ["before-action", "before-action"],
  ["posttooluse", "after-action"],
  ["post-tool-use", "after-action"],
  ["afteraction", "after-action"],
  ["after-action", "after-action"],
  ["stop", "stop"],
]);

function firstObject(...values) {
  return values.find((value) => value && typeof value === "object") ?? {};
}

function firstText(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) ?? undefined;
}

function eventName(payload, body) {
  return firstText(
    payload.hook_event_name,
    payload.eventName,
    payload.event,
    payload.type,
    body.hook_event_name,
    body.eventName,
    body.event,
    body.type,
  );
}

function bodyFrom(payload) {
  return firstObject(payload.data, payload.payload, payload.input, payload);
}

function toolInputFrom(payload, body, tool) {
  return firstObject(
    payload.tool_input,
    payload.toolInput,
    body.tool_input,
    body.toolInput,
    tool.input,
    body.action,
    payload.action,
  );
}

function actionFrom(payload, body) {
  const tool = firstObject(
    payload.tool,
    body.tool,
    body.action?.tool,
    payload.action?.tool,
  );
  const input = toolInputFrom(payload, body, tool);
  const name = firstText(
    payload.tool_name,
    payload.toolName,
    body.tool_name,
    body.toolName,
    tool.name,
    payload.action?.name,
    body.action?.name,
    "unknown-tool",
  );
  return {
    name,
    tool: name,
    command: firstText(
      payload.command,
      payload.commandLine,
      body.command,
      body.commandLine,
      payload.action?.command,
      body.action?.command,
      input.command,
      input.commandLine,
      input.cmd,
    ),
    paths: input.paths ?? body.paths ?? payload.paths,
    writeScopes:
      input.writeScopes ?? input.write_scopes ?? body.writeScopes ?? payload.writeScopes,
    summary: firstText(
      payload.summary,
      body.summary,
      payload.action?.summary,
      body.action?.summary,
    ),
  };
}

function resultFrom(payload, body) {
  const result = firstObject(
    payload.result,
    payload.tool_result,
    payload.toolResult,
    body.result,
    body.tool_result,
    body.toolResult,
  );
  const exitCode = result.exitCode ?? result.exit_code;
  const error = firstText(
    payload.error,
    result.error,
    result.stderr,
    result.message,
  );
  return {
    ok: !(error || (Number.isInteger(exitCode) && exitCode !== 0) || result.ok === false),
    exitCode,
    error,
    retryable: result.retryable ?? body.retryable ?? payload.retryable,
  };
}

function discoverLedger(payload, cwd) {
  let planningRoot = cwd;
  try {
    planningRoot = resolveOpenSpecContext(cwd).rootPath;
  } catch {
    return undefined;
  }
  const requirementsDir = path.join(planningRoot, "sprint-manage", "requirements");
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

export function normalizeTraeEvent(payload = {}) {
  const body = bodyFrom(payload);
  const rawEvent = eventName(payload, body);
  const event =
    EVENT_MAP.get(String(rawEvent ?? "").replaceAll("_", "-").toLowerCase()) ??
    "unknown";
  const cwd = firstText(payload.cwd, body.cwd, process.cwd());
  const action = actionFrom(payload, body);
  const hasResult = event === "after-action";

  return {
    version: 1,
    source: "trae",
    event,
    actor: firstText(
      payload.actor,
      body.actor,
      process.env.XIAOQI_ACTOR,
      "trae",
    ),
    cwd,
    ledger:
      firstText(payload.ledger, body.ledger, process.env.XIAOQI_LEDGER) ??
      discoverLedger(payload, cwd),
    action,
    result: hasResult ? resultFrom(payload, body) : undefined,
  };
}

export function handleTraePayload(payload) {
  return toTraeResponse(handleNormalizedEvent(normalizeTraeEvent(payload)));
}

export function handleTraeNormalizedEvent(event) {
  return handleNormalizedEvent(event);
}

export function toTraeResponse(result) {
  if (result.decision === "deny" || result.decision === "stop") {
    return {
      continue: false,
      stopReason: result.reason ?? "小七运行时拒绝继续执行",
    };
  }
  return { continue: true };
}

export function traeExitCode(result) {
  return normalizedExitCode(
    result.decision
      ? result
      : { decision: result.continue === false ? "deny" : "allow" },
  );
}

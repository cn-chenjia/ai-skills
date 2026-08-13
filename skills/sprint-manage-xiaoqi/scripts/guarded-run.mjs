#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import { execFileSync } from "node:child_process";
import path from "node:path";

function commandName(command) {
  return path
    .basename(command)
    .toLowerCase()
    .replace(/\.(cmd|exe|bat)$/i, "");
}

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

export function assertCommandAllowed(command, args = [], policy = {}) {
  if (typeof command !== "string" || !command.trim()) {
    fail("invalid-command", "command must be a non-empty string");
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    fail("invalid-args", "all command arguments must be strings");
  }

  const allowedCommands = new Set(
    (policy.allowedCommands ?? []).map((item) => commandName(String(item))),
  );
  const normalized = commandName(command);
  if (!allowedCommands.has(normalized)) {
    fail("command-not-allowed", `command ${normalized} is not allowlisted`);
  }

  if (args.some((arg) => arg.includes("\u0000"))) {
    fail("invalid-args", "arguments cannot contain null bytes");
  }
  return true;
}

export function assertPathsAllowed(paths, scopes, baseDir = process.cwd()) {
  if (!Array.isArray(paths) || !Array.isArray(scopes) || scopes.length === 0) {
    fail("invalid-scope", "paths and non-empty scopes are required");
  }

  const roots = scopes.map((scope) => {
    if (typeof scope !== "string" || scope.includes("\u0000")) {
      fail("invalid-scope", "scope must be a safe string");
    }
    return path.resolve(baseDir, scope);
  });

  return paths.map((candidate) => {
    if (typeof candidate !== "string" || candidate.includes("\u0000")) {
      fail("invalid-path", "path must be a safe string");
    }
    const absolute = path.resolve(baseDir, candidate);
    const inside = roots.some((root) => {
      const relative = path.relative(root, absolute);
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    });
    if (!inside) {
      fail("path-outside-scope", `${candidate} is outside declared write scopes`);
    }
    return absolute;
  });
}

export function runGuardedCommand(command, args = [], policy = {}) {
  assertCommandAllowed(command, args, policy);

  const cwd = path.resolve(policy.cwd ?? process.cwd());
  if (policy.paths) {
    assertPathsAllowed(policy.paths, policy.writeScopes, cwd);
  }

  const timeoutMs = Number.isInteger(policy.timeoutMs) ? policy.timeoutMs : 30000;
  const maxBuffer = Number.isInteger(policy.maxBuffer)
    ? policy.maxBuffer
    : 1024 * 1024;
  const env = {
    ...process.env,
    ...(policy.env ?? {}),
    XIAOQI_NETWORK: policy.allowNetwork ? "allowed-by-host" : "denied-by-policy",
  };

  try {
    const stdout = execFileSync(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer,
      encoding: "utf8",
    });
    return {
      command,
      args,
      cwd,
      exitCode: 0,
      stdout,
      stderr: "",
      shell: false,
      network: policy.allowNetwork ? "allowed-by-host" : "denied-by-policy",
    };
  } catch (error) {
    return {
      command,
      args,
      cwd,
      exitCode: Number.isInteger(error.status) ? error.status : 124,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? error.message ?? ""),
      shell: false,
      network: policy.allowNetwork ? "allowed-by-host" : "denied-by-policy",
    };
  }
}

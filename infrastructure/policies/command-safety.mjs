#!/usr/bin/env node

import path from "node:path";

const DESTRUCTIVE_COMMANDS = [
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[^\n]*f/i,
  /\bgit\s+push\s+--force(?:-with-lease)?\b/i,
  /\b(remove-item|del|rmdir|rd)\b[^\n]*(-recurse|-force|\/s)/i,
  /\brm\s+-[^\n]*r[^\n]*f/i,
];

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
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
    if (!inside) fail("path-outside-scope", `${candidate} is outside declared write scopes`);
    return absolute;
  });
}

export function assertSafeAction(action = {}, cwd = process.cwd()) {
  const command = typeof action.command === "string" ? action.command : "";
  if (DESTRUCTIVE_COMMANDS.some((pattern) => pattern.test(command))) {
    throw new Error("destructive-command-denied: command requires explicit confirmation");
  }

  if (action.paths !== undefined) {
    if (!Array.isArray(action.writeScopes) || action.writeScopes.length === 0) {
      const error = new Error("write-scope-required: actions with paths require explicit write scopes");
      error.code = "write-scope-required";
      throw error;
    }
    assertPathsAllowed(action.paths, action.writeScopes, cwd);
  }
}

#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import { assertPathsAllowed } from "../guarded-run.mjs";

const DESTRUCTIVE_COMMANDS = [
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[^\n]*f/i,
  /\bgit\s+push\s+--force(?:-with-lease)?\b/i,
  /\b(remove-item|del|rmdir|rd)\b[^\n]*(-recurse|-force|\/s)/i,
  /\brm\s+-[^\n]*r[^\n]*f/i,
];

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

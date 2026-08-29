#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { classifyRequest } from "./request-routing.mjs";
import { runUntilReady } from "./auto-runner.mjs";

export async function startAutomation({
  request = {},
  confirmed = false,
  ledgerPath,
  owner,
  projectRoot = process.cwd(),
  commands,
  policy = {},
  maxSteps = 20,
  repairAction,
  maxRepairAttempts = 3,
} = {}) {
  const classification = classifyRequest(request);

  if (!confirmed && classification.status === "needs-explore") {
    const summary = classification.summary;
    return {
      status: "needs-explore",
      outcome: "needs-confirmation",
      summary,
      evidence: null,
      blockers: classification.reasons,
      recommended_next: "explore",
      classification,
    };
  }

  const result = await runUntilReady({
    ledgerPath,
    owner,
    projectRoot,
    commands,
    policy,
    maxSteps,
    repairAction,
    maxRepairAttempts,
  });

  return {
    ...result,
    confirmation: confirmed ? "human-confirmed" : "auto-confirmed",
    classification,
  };
}

async function runCli(args) {
  if (args.length < 3) {
    console.error(
      "用法: node start-automation.mjs <request.json> <ledger> <owner> [project-root] [--confirmed]",
    );
    return 2;
  }

  const [requestPath, ledgerPath, owner, projectRootArg] = args;
  const request = JSON.parse(readFileSync(requestPath, "utf8"));
  const projectRoot = projectRootArg?.startsWith("--")
    ? process.cwd()
    : projectRootArg ?? process.cwd();
  const result = await startAutomation({
    request,
    ledgerPath,
    owner,
    projectRoot,
    confirmed: args.includes("--confirmed"),
  });
  console.log(JSON.stringify(result));
  return result.status === "blocked" ? 1 : 0;
}

const executedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (executedPath === import.meta.url) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

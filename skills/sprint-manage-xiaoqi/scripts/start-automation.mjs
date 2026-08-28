#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import process from "node:process";
import { pathToFileURL } from "node:url";

import { classifyRequest } from "./request-routing.mjs";
import { runUntilReady } from "./auto-runner.mjs";
import { createControlPlaneRuntime } from "../../../infrastructure/control-plane-runtime.mjs";

export async function startAutomation({
  request = {},
  confirmed = false,
  owner,
  projectRoot = process.cwd(),
  commands,
  policy = {},
  maxSteps = 20,
  repairAction,
  maxRepairAttempts = 3,
  controlPlane,
  deliveryId,
  planningRoot,
  repository,
} = {}) {
  const classification = classifyRequest(request);
  let resolvedControlPlane = controlPlane;
  if (!resolvedControlPlane) {
    try {
      resolvedControlPlane = createControlPlaneRuntime({ planningRoot, cwd: projectRoot, deliveryId, repository, commands, policy });
    } catch (error) {
      if (!planningRoot && !repository && /OpenSpec context|OpenSpec 未解析/.test(error.message)) throw new Error("control-plane-handler-missing");
      throw error;
    }
  }

  if (!confirmed && classification.status === "needs-explore") {
    return {
      status: "needs-explore",
      classification,
    };
  }

  const result = await runUntilReady({
    owner,
    projectRoot,
    commands,
    policy,
    maxSteps,
    repairAction,
    maxRepairAttempts,
    controlPlane: resolvedControlPlane,
  });

  return {
    ...result,
    confirmation: confirmed ? "human-confirmed" : "auto-confirmed",
    classification,
  };
}

async function runCli(args) {
  if (args.length < 2) {
    console.error(
      "用法: node start-automation.mjs <request.json> <owner> [project-root] [--confirmed]",
    );
    return 2;
  }

  const [requestPath, owner, projectRootArg] = args;
  const request = JSON.parse(readFileSync(requestPath, "utf8"));
  const projectRoot = projectRootArg?.startsWith("--")
    ? process.cwd()
    : projectRootArg ?? process.cwd();
  const result = await startAutomation({
    request,
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

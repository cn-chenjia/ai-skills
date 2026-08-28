#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import process from "node:process";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { classifyRequest } from "./request-routing.mjs";
import { runUntilReady } from "./auto-runner.mjs";

const execFileAsync = promisify(execFile);
const cliEntry = fileURLToPath(new URL("../../../apps/cli/index.mjs", import.meta.url));

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
  runCli,
} = {}) {
  const classification = classifyRequest(request);
  if (!controlPlane && (!planningRoot || !deliveryId)) throw new Error("control-plane-handler-missing");
  if (!confirmed && classification.status === "needs-explore") {
    return {
      status: "needs-explore",
      classification,
    };
  }

  if (controlPlane) {
    const result = await runUntilReady({
      owner,
      projectRoot,
      commands,
      policy,
      maxSteps,
      repairAction,
      maxRepairAttempts,
      controlPlane,
    });
    return { ...result, confirmation: confirmed ? "human-confirmed" : "auto-confirmed", classification };
  }
  const invoke = runCli ?? (async (args) => {
    try {
      const { stdout, stderr } = await execFileAsync(process.execPath, [cliEntry, ...args], { cwd: projectRoot });
      return { exitCode: 0, stdout, stderr };
    } catch (error) {
      return { exitCode: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? error.message };
    }
  });
  const args = ["automation", "run", deliveryId, "--planning-root", planningRoot, "--owner", owner ?? "skill", "--max-steps", String(maxSteps)];
  if (confirmed) args.push("--confirmed");
  const result = await invoke(args);
  if (result.exitCode !== 0) throw new Error(result.stderr || "xiaoqi CLI automation failed");
  return { ...JSON.parse(result.stdout), confirmation: confirmed ? "human-confirmed" : "auto-confirmed", classification };
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

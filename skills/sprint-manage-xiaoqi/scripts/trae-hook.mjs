#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  handleTraePayload,
  traeExitCode,
} from "./adapters/trae.mjs";

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

export const handle = handleTraePayload;
export const hookExitCode = traeExitCode;

const executedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (executedPath === import.meta.url) {
  try {
    const result = handle(await readStdin());
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = hookExitCode(result);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ version: 1, decision: "stop", reason: error.message })}\n`,
    );
    process.exitCode = 1;
  }
}

#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";

function formatDiagnostics(payload) {
  return (Array.isArray(payload?.status) ? payload.status : [])
    .map((item) => [item.code, item.message].filter(Boolean).join(": "))
    .join("; ");
}

export function resolveOpenSpecContext(cwd, options = {}) {
  const command = options.openspecCommand ?? "openspec";
  const args = options.openspecArgs ?? ["context", "--json"];
  const result = options.openspecRunner
    ? options.openspecRunner({ command, args, cwd })
    : spawnSync(command, args, {
        cwd,
        encoding: "utf8",
      });

  let payload;
  try {
    payload = result.stdout ? JSON.parse(result.stdout) : null;
  } catch (error) {
    if (result.error || result.status !== 0) {
      throw new Error(
        `OpenSpec context failed${result.error ? `: ${result.error.message}` : ""}`,
      );
    }
    throw new Error(`OpenSpec context 返回的 JSON 无效: ${error.message}`);
  }

  if (result.error || result.status !== 0) {
    const detail = formatDiagnostics(payload);
    throw new Error(
      `OpenSpec context failed${detail ? `: ${detail}` : ""}${result.error ? `: ${result.error.message}` : ""}`,
    );
  }

  if (!payload.root?.path) {
    const detail = formatDiagnostics(payload);
    throw new Error(
      `OpenSpec 未解析出 root${detail ? `: ${detail}` : ""}`,
    );
  }

  return {
    rootPath: path.resolve(payload.root.path),
    source: payload.root.source,
    storeId: payload.root.store_id,
    role: payload.root.role,
    raw: payload,
  };
}

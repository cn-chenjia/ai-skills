import path from "node:path";

function unresolved(message, raw) {
  const error = new Error(message);
  error.code = "openspec-root-unresolved";
  if (raw !== undefined) error.raw = raw;
  return error;
}

export function parseOpenSpecContext(stdout) {
  let raw;
  try {
    raw = JSON.parse(stdout);
  } catch (error) {
    throw unresolved(`OpenSpec context JSON 无效: ${error.message}`);
  }
  const root = raw?.root;
  if (!root || typeof root.path !== "string" || root.path.trim() === "") {
    const diagnostics = Array.isArray(raw?.status)
      ? raw.status.map((item) => [item.code, item.message].filter(Boolean).join(": ")).join("; ")
      : "";
    throw unresolved(`OpenSpec root 未解析${diagnostics ? `: ${diagnostics}` : ""}`, raw);
  }
  return {
    rootPath: path.resolve(root.path),
    mode: root.store_id || root.source === "declared" || root.role === "store" ? "shared" : "co-located",
    raw,
  };
}

export function resolvePlanningRoot({ cwd, execute }) {
  let result;
  try {
    result = execute("openspec", ["context", "--json"], { cwd });
  } catch (error) {
    throw new Error(`当前项目尚未执行 openspec init，请先执行 openspec init: ${error.message}`);
  }
  if (result?.status !== 0) {
    throw new Error(`当前项目尚未执行 openspec init，请先执行 openspec init${result?.stderr ? `: ${result.stderr.trim()}` : ""}`);
  }
  try {
    const context = parseOpenSpecContext(result?.stdout ?? "");
    return { rootPath: context.rootPath, mode: context.mode, source: "openspec-context" };
  } catch (error) {
    throw new Error(`当前项目尚未执行 openspec init，请先执行 openspec init: ${error.message}`);
  }
}

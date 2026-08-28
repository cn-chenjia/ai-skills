import { execFileSync } from "node:child_process";

function isCommit(value) {
  return typeof value === "string" && /^[0-9a-f]{3,40}$/i.test(value.trim()) && !["unknown", "working-tree"].includes(value.trim().toLowerCase());
}

function currentHead(cwd) {
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", windowsHide: true }).trim();
    return isCommit(head) ? head : undefined;
  } catch {
    return undefined;
  }
}

function normalizeResult(value, requireCommit = true) {
  const exitCode = value?.exitCode ?? value?.code ?? (value?.success === false ? 1 : 0);
  const commit = typeof value?.commit === "string" ? value.commit.trim() : value?.commit;
  if (requireCommit && exitCode === 0 && !isCommit(commit)) throw Object.assign(new Error("successful command requires a valid commit"), { code: "invalid-commit" });
  return { success: exitCode === 0, exitCode, stdout: value?.stdout ?? "", stderr: value?.stderr ?? "", commit, artifacts: value?.artifacts ?? [], ...(value?.result === undefined ? {} : { result: value.result }), ...(value?.independent === undefined ? {} : { independent: value.independent }) };
}

export function createCommandExecutor({ executeCommand, policy = {} }) {
  if (typeof executeCommand !== "function") throw new Error("executeCommand is required");
  if (typeof policy.assertCommand !== "function" || typeof policy.assertWritable !== "function") throw new Error("command and write policies are required");
  return {
    async run(input) {
      try {
        policy.assertCommand(input);
        policy.assertWritable(input);
        const result = await executeCommand(input.command, input.args ?? [], { cwd: input.cwd, writeScope: input.writeScope });
        if (input.requireCommit !== false && (result?.exitCode ?? result?.code ?? (result?.success === false ? 1 : 0)) === 0 && !isCommit(result?.commit)) {
          const commit = currentHead(input.cwd);
          if (!commit) throw Object.assign(new Error("successful command requires a locatable git HEAD"), { code: "head-unavailable" });
          result.commit = commit;
        }
        return normalizeResult(result, input.requireCommit !== false);
      } catch (error) {
        return { success: false, exitCode: error.exitCode ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? error.message, commit: error.commit, artifacts: error.artifacts ?? [], error: { name: error.name, message: error.message, code: error.code } };
      }
    },
  };
}

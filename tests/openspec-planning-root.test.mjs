import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { parseOpenSpecContext, resolvePlanningRoot } from "../adapters/openspec/context.mjs";
import { assertWritablePath, getXiaoqiRoot } from "../adapters/openspec/artifact-policy.mjs";

test("解析项目内 OpenSpec root", () => {
  const payload = { root: { path: "C:\\work\\project", source: "nearest", role: "project" } };
  assert.deepEqual(parseOpenSpecContext(JSON.stringify(payload)), {
    rootPath: path.resolve(payload.root.path),
    mode: "co-located",
    raw: payload,
  });
});

test("解析 Store root 并只使用 root.path", () => {
  const payload = { root: { path: "C:\\plans\\team", source: "declared", store_id: "team-plans", role: "store" } };
  const result = resolvePlanningRoot({
    cwd: "C:\\repos\\project",
    execute(command, args, options) {
      assert.equal(command, "openspec");
      assert.deepEqual(args, ["context", "--json"]);
      assert.equal(options.cwd, "C:\\repos\\project");
      return { status: 0, stdout: JSON.stringify(payload), stderr: "" };
    },
  });
  assert.deepEqual(result, { rootPath: path.resolve(payload.root.path), mode: "shared", source: "openspec-context" });
});

test("解析失败不得回退", () => {
  assert.throws(() => parseOpenSpecContext('{"status":[{"code":"no-root"}]}'), (error) => error.code === "openspec-root-unresolved" && /no-root/.test(error.message));
  assert.throws(() => resolvePlanningRoot({ cwd: "C:\\repos\\project", execute: () => ({ status: 1, stdout: "", stderr: "failed" }) }), /failed/);
});

test("OpenSpec context 返回非零时提示先执行 openspec init", () => {
  assert.throws(
    () => resolvePlanningRoot({ cwd: "C:\\repos\\project", execute: () => ({ status: 2, stdout: "", stderr: "No OpenSpec root" }) }),
    /请先执行 openspec init/,
  );
});

test("openspec 命令不存在时提示先执行 openspec init", () => {
  assert.throws(
    () => resolvePlanningRoot({ cwd: "C:\\repos\\project", execute: () => { const error = new Error("spawn openspec ENOENT"); error.code = "ENOENT"; throw error; } }),
    /请先执行 openspec init/,
  );
});

test("执行小七目录和 OpenSpec 标准工件边界策略", () => {
  const root = "C:\\Plans\\Team";
  assert.equal(getXiaoqiRoot(root), path.join(root, "sprint-manage"));
  assert.doesNotThrow(() => assertWritablePath({ planningRoot: root, filePath: "c:\\plans\\team\\sprint-manage\\requirements\\a.yaml", kind: "xiaoqi" }));
  assert.throws(() => assertWritablePath({ planningRoot: root, filePath: "C:\\plans\\team2\\sprint-manage\\a.yaml", kind: "xiaoqi" }));
  for (const artifact of ["proposal.md", "design.md", "tasks.md"]) {
    assert.doesNotThrow(() => assertWritablePath({ planningRoot: root, filePath: path.join(root, "openspec", "changes", "demo", artifact), kind: "openspec" }));
  }
  assert.doesNotThrow(() => assertWritablePath({ planningRoot: root, filePath: path.join(root, "openspec", "specs", "billing", "spec.md"), kind: "openspec" }));
  assert.throws(() => assertWritablePath({ planningRoot: root, filePath: path.join(root, "docs", "superpowers", "plan.md"), kind: "openspec" }));
  for (const artifact of ["notes.md", "config.yaml", "custom.yml"]) {
    assert.throws(() => assertWritablePath({ planningRoot: root, filePath: path.join(root, "openspec", "changes", "demo", artifact), kind: "openspec" }));
  }
  assert.throws(() => assertWritablePath({ planningRoot: root, filePath: path.join(root, "openspec", "changes", "demo", "nested", "tasks.md"), kind: "openspec" }));
  assert.throws(() => assertWritablePath({ planningRoot: root, filePath: path.join(root, "openspec", "specs", "billing.md"), kind: "openspec" }));
  assert.throws(() => assertWritablePath({ planningRoot: root, filePath: path.join(root, "openspec", "specs", "billing", "notes.md"), kind: "openspec" }));
  assert.throws(() => assertWritablePath({ planningRoot: root, filePath: path.join(root, "openspec", "specs", "billing", "config.yaml"), kind: "openspec" }));
});

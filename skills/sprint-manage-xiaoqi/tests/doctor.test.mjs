import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runDoctor } from "../scripts/doctor.mjs";

test("环境检查只检查六项基础依赖并使用新的全局目录", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-doctor-"));
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-home-"));
  await mkdir(path.join(homeDir, ".xiaoqi", "sprint-manage"), { recursive: true });

  const commands = [];
  const result = await runDoctor(projectRoot, {
    homeDir,
    commandRunner: (cwd, args) => {
      commands.push({ cwd, args });
      if (args.join(" ") === "node -v") return { ok: true, version: "v22.0.0" };
      if (args.join(" ") === "openspec --version") return { ok: true, version: "1.0.0" };
      if (args.join(" ") === "openspec context --json") return { ok: true, context: {} };
      return { ok: false, message: "unexpected command" };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.checks), [
    "nodejs",
    "openSpec",
    "ledger",
    "skills",
    "openSpecContext",
    "baseBranch",
  ]);
  assert.deepEqual(commands.map(({ args }) => args.join(" ")), [
    "node -v",
    "openspec --version",
    "openspec context --json",
  ]);
  assert.equal(result.checks.ledger.status, "pass");
  // 临时目录不是 Git 仓库，基准分支检查应输出告知或提醒，但不影响环境检查结果
  assert.notEqual(result.checks.baseBranch.status, "fail");
  assert.match(result.checks.baseBranch.message, /基准分支/);
});

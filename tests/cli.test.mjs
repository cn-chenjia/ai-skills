import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCli } from "../apps/cli/index.mjs";
import { createSqliteRepository } from "../infrastructure/persistence/sqlite-repository.mjs";

test("CLI creates requirement and status reads planningRoot SQLite", async () => {
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xiaoqi-cli-"));
  const context = { resolvePlanningRoot: () => ({ rootPath: planningRoot }) };
  const result = await createCli(["requirement", "create", "--title", "CLI feature", "--id", "r1", "--delivery-id", "d1", "--planning-root", planningRoot], context);
  assert.equal(result.exitCode, 0);
  const status = await createCli(["status", "--planning-root", planningRoot], context);
  assert.equal(status.exitCode, 0);
  assert.match(status.stdout, /d1/);
});

test("CLI returns readable non-zero parameter errors", async () => {
  const result = await createCli(["requirement", "create"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /title/);
});

test("status does not read a code repository ledger", async () => {
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xiaoqi-cli-status-"));
  const repository = createSqliteRepository({ planningRoot });
  repository.createRequirementAndDelivery({ id: "r1", title: "Stored", description: "", acceptanceCriteria: [], owner: null, status: "active" }, { id: "d1", requirementId: "r1", phase: "start", phaseStatus: "draft", deliveryStatus: "not-started" });
  repository.close();
  const result = await createCli(["status", "--planning-root", planningRoot], { resolvePlanningRoot: () => ({ rootPath: planningRoot }) });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Stored|d1/);
});

test("delivery prepare is blocked before plan approval", async () => {
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xiaoqi-cli-phase-"));
  const context = { resolvePlanningRoot: () => ({ rootPath: planningRoot }) };
  await createCli(["requirement", "create", "--title", "Feature", "--id", "r1", "--delivery-id", "d1", "--planning-root", planningRoot], context);
  const result = await createCli(["delivery", "prepare", "--delivery-id", "d1", "--planning-root", planningRoot], context);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /approved|批准/);
});

test("CLI rejects a planning-root override that differs from OpenSpec context", async () => {
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xiaoqi-cli-root-"));
  const result = await createCli(["status", "--planning-root", planningRoot], {
    resolvePlanningRoot: () => ({ rootPath: path.join(planningRoot, "actual") }),
    repository: { close() {} },
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /planningRoot|context|一致/);
});

test("CLI delivery close defaults to keep/keep/kept and archives under the OpenSpec root once", async () => {
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xiaoqi-cli-close-"));
  const calls = [];
  const services = {
    planningRoot,
    openspec: { planningRoot },
    close: { closeDelivery: async (id, input) => { calls.push([id, input]); return { phaseStatus: "closed" }; } },
  };
  const result = await createCli(["delivery", "close", "d1"], {
    resolvePlanningRoot: () => ({ rootPath: planningRoot }),
    repository: { planningRoot },
    services,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["d1", {
    verify: { command: "verify", args: [], writeScope: ["openspec"], cwd: planningRoot },
    archive: { command: "openspec", args: ["archive", "d1"], cwd: planningRoot, writeScope: ["openspec"], path: path.join(planningRoot, "openspec", "archive", "d1") },
    finish: { branchAction: "keep", workspaceAction: "keep", result: "kept", command: undefined, args: [], cwd: undefined, writeScope: ["."] },
  }]);
});

test("CLI refuses injected repository without a provable OpenSpec planningRoot binding", async () => {
  const result = await createCli(["status"], {
    resolvePlanningRoot: () => ({ rootPath: "C:\\\\root" }),
    repository: { close() {} },
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /可证明|planningRoot/);
});

test("CLI archive uses Store planningRoot as executor cwd and archive path base exactly once", async () => {
  const planningRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xiaoqi-cli-store-"));
  const commandRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xiaoqi-cli-command-"));
  const logPath = path.join(commandRoot, "archive.log");
  const openspecCommand = path.join(commandRoot, "archive-command.mjs");
  fs.writeFileSync(openspecCommand, "import fs from 'node:fs'; import path from 'node:path'; fs.appendFileSync(path.join(path.dirname(process.argv[1]), 'archive.log'), `${process.cwd()} ${process.argv.slice(2).join(' ')}\\n`);\n");
  const repository = createSqliteRepository({ planningRoot });
  repository.createRequirementAndDelivery(
    { id: "r1", title: "Store archive", description: "", acceptanceCriteria: [], owner: null, status: "active" },
    { id: "d1", requirementId: "r1", phase: "close", phaseStatus: "verifying", deliveryStatus: "coding" },
  );
  repository.close();
  const result = await createCli(["delivery", "archive", "d1", "--planning-root", planningRoot, "--archive-command", "node", "--archive-args", `${openspecCommand} ${logPath}`], {
    resolvePlanningRoot: () => ({ rootPath: planningRoot }),
  });
  assert.equal(result.exitCode, 0, `${result.stderr} ${result.stdout}`);
  const logs = fs.readFileSync(logPath, "utf8").trim().split(/\\r?\\n/).filter(Boolean);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].split(" ", 1)[0], planningRoot);
});

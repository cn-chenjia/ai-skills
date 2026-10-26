import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { initializeRequirement } from "../scripts/initialize-requirement.mjs";
import { recordDecision } from "../scripts/record-decision.mjs";
import { matchRequirement } from "../scripts/match-requirement.mjs";
import { advanceProgress } from "../scripts/advance-progress.mjs";
import {
  parseProgressYaml,
  validateProgress,
} from "../scripts/validate-progress.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
process.env.USERPROFILE = mkdtempSync(path.join(os.tmpdir(), "xiaoqi-auto-home-"));
process.env.HOME = process.env.USERPROFILE;

function resetRequirements() {
  rmSync(path.join(process.env.USERPROFILE, ".xiaoqi", "sprint-manage"), {
    recursive: true,
    force: true,
  });
}

async function createProject() {
  resetRequirements();
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-autonomous-"));
  await writeFile(path.join(projectRoot, "README.md"), "test\n");
  return projectRoot;
}

function issueCodes(issues) {
  return issues.map((issue) => issue.code);
}

test("initializes a manual ledger as schema v4 without autonomy", async () => {
  const projectRoot = await createProject();

  const result = initializeRequirement(
    projectRoot, "story-2001", "订单导出", "story-2001-export", "alice", "requester",
  );

  assert.equal(result.outcome, "created");
  const ledger = parseProgressYaml(await readFile(result.ledger, "utf8"));
  assert.equal(ledger.schema_version, 4);
  assert.equal(Object.hasOwn(ledger, "托管"), false);
});

test("initializes an autonomous ledger as schema v5 with autonomy config", async () => {
  const projectRoot = await createProject();

  const result = initializeRequirement(
    projectRoot, "story-2002", "订单导出", "story-2002-export", "alice", "requester",
    { autonomous: true },
  );

  assert.equal(result.outcome, "created");
  const ledger = parseProgressYaml(await readFile(result.ledger, "utf8"));
  assert.equal(ledger.schema_version, 5);
  assert.deepEqual(ledger.托管, {
    mode: "full",
    closing: "pr-open",
    activated_by: "trigger-word",
  });
  assert.equal(
    ledger.事件日志.some((event) => event.kind === "autonomy-activated"),
    true,
  );
});

test("project config autonomy activates full mode with config closing", async () => {
  const projectRoot = await createProject();
  await mkdir(path.join(projectRoot, ".xiaoqi"), { recursive: true });
  await writeFile(
    path.join(projectRoot, ".xiaoqi", "config.yaml"),
    'autonomy:\n  mode: "full"\n  closing: "merged"\n',
  );

  const fromConfig = initializeRequirement(
    projectRoot, "story-2003", "订单重构", "story-2003-refactor", "alice", "requester",
  );
  const configLedger = parseProgressYaml(await readFile(fromConfig.ledger, "utf8"));
  assert.deepEqual(configLedger.托管, {
    mode: "full",
    closing: "merged",
    activated_by: "project-config",
  });

  resetRequirements();
  const fromFlag = initializeRequirement(
    projectRoot, "story-2004", "订单重构", "story-2004-refactor", "alice", "requester",
    { autonomous: true },
  );
  const flagLedger = parseProgressYaml(await readFile(fromFlag.ledger, "utf8"));
  // 触发词优先于项目配置；收尾默认仍继承配置值
  assert.equal(flagLedger.托管.activated_by, "trigger-word");
  assert.equal(flagLedger.托管.closing, "merged");
});

test("rejects autonomy fields on schema v4 ledgers", () => {
  const issues = validateProgress({
    schema_version: 4,
    document_type: "requirement",
    托管: { mode: "full", closing: "pr-open" },
  });
  assert.ok(issueCodes(issues).includes("autonomy-requires-schema-v5"));
});

test("validates autonomy field values on schema v5", () => {
  const base = {
    schema_version: 5,
    document_type: "requirement",
    编号: "story-2005",
    revision: 1,
    updated_at: "2026-08-20T10:00:00+08:00",
    updated_by: "alice",
    流程状态: "active",
    交付状态: "not-started",
    当前意图: "准备实施",
    推荐动作: "prepare-workspace",
    协作: { 模式: "single", 负责人: "alice" },
    仓库: [{ id: "main", root: "/tmp/demo", branch: null, worktree: null }],
    证据索引: {},
    用户决策: [],
    阻塞项: [],
    事件日志: [],
  };

  assert.deepEqual(validateProgress(base).filter(isBlocking), []);
  assert.ok(issueCodes(validateProgress({
    ...base,
    托管: { mode: "auto", closing: "pr-open" },
  })).includes("invalid-autonomy-mode"));
  assert.ok(issueCodes(validateProgress({
    ...base,
    托管: { mode: "full", closing: "done" },
  })).includes("invalid-autonomy-closing"));
  assert.ok(issueCodes(validateProgress({
    ...base,
    托管: { mode: "full", closing: "pr-open", activated_by: "" },
  })).includes("invalid-autonomy-activated-by"));

  function isBlocking(issue) {
    return issue.severity !== "warning";
  }
});

test("rejects xiaoqi-auto decisions on non-autonomous ledgers", () => {
  const issues = validateProgress({
    schema_version: 5,
    document_type: "requirement",
    编号: "story-2006",
    revision: 1,
    updated_at: "2026-08-20T10:00:00+08:00",
    updated_by: "alice",
    流程状态: "active",
    交付状态: "not-started",
    当前意图: "准备实施",
    推荐动作: "prepare-workspace",
    协作: { 模式: "single", 负责人: "alice" },
    仓库: [{ id: "main", root: "/tmp/demo", branch: null, worktree: null }],
    证据索引: {},
    用户决策: [
      { kind: "proposal-confirmation", outcome: "approved", actor: "xiaoqi-auto", reason: "低风险" },
    ],
    阻塞项: [],
    事件日志: [],
  });
  assert.ok(issueCodes(issues).includes("autonomous-decision-not-allowed"));
});

test("record-decision enforces autonomous receipt rules", async () => {
  const projectRoot = await createProject();

  const manual = initializeRequirement(
    projectRoot, "story-2007", "订单导出", "story-2007-export", "alice", "requester",
  );
  assert.throws(
    () => recordDecision(manual.ledger, {
      kind: "proposal-confirmation",
      outcome: "approved",
      actor: "xiaoqi-auto",
      reason: "低风险",
    }, "alice"),
    /非托管/,
  );

  resetRequirements();
  const autonomous = initializeRequirement(
    projectRoot, "story-2008", "订单导出", "story-2008-export", "alice", "requester",
    { autonomous: true },
  );
  assert.throws(
    () => recordDecision(autonomous.ledger, {
      kind: "proposal-confirmation",
      outcome: "approved",
      actor: "xiaoqi-auto",
    }, "alice"),
    /推荐理由/,
  );
  assert.throws(
    () => recordDecision(autonomous.ledger, {
      kind: "requirement-intake",
      outcome: "accepted",
      actor: "xiaoqi-auto",
      reason: "自动接纳",
    }, "alice"),
    /只能记录/,
  );
  assert.throws(
    () => recordDecision(autonomous.ledger, {
      kind: "proposal-confirmation",
      outcome: "maybe",
      actor: "requester",
    }, "alice"),
    /outcome/,
  );

  const recorded = recordDecision(autonomous.ledger, {
    kind: "proposal-confirmation",
    outcome: "approved",
    actor: "xiaoqi-auto",
    reason: "方案与既有链路一致，风险低，建议直接实施",
  }, "alice");
  assert.equal(typeof recorded.revision, "number");
  assert.equal(recorded.updatedBy, "alice");

  const ledger = parseProgressYaml(await readFile(autonomous.ledger, "utf8"));
  const decision = ledger.用户决策.at(-1);
  assert.equal(decision.actor, "xiaoqi-auto");
  assert.ok(decision.reason);
  assert.equal(decision.at !== undefined, true);
  assert.equal(
    ledger.事件日志.some((event) => event.kind === "decision-recorded"),
    true,
  );
});

test("autonomous receipts satisfy the coding gate end to end", async () => {
  const projectRoot = await createProject();

  const result = initializeRequirement(
    projectRoot, "story-2009", "订单导出", "story-2009-export", "alice", "requester",
    { autonomous: true },
  );
  recordDecision(result.ledger, {
    kind: "proposal-confirmation",
    outcome: "approved",
    actor: "xiaoqi-auto",
    reason: "方案与既有链路一致，建议直接实施",
  }, "alice");
  recordDecision(result.ledger, {
    kind: "implementation-start",
    outcome: "approved",
    actor: "xiaoqi-auto",
    reason: "worktree 已就绪，自动选择立即实施",
  }, "alice");

  // 工作区准备由 prepare-workspace 负责；测试直接登记 branch/worktree 模拟已准备状态
  const source = await readFile(result.ledger, "utf8");
  await writeFile(
    result.ledger,
    source
      .replace("branch: null", 'branch: "feature/story-2009"')
      .replace("worktree: null", 'worktree: ".worktrees/story-2009"'),
  );

  const advanced = advanceProgress(
    result.ledger,
    "coding",
    {
      kind: "apply",
      command: "npm test",
      exit_code: 0,
      checked_at: "2026-08-20T11:00:00+08:00",
      summary: "apply 完成",
    },
    "alice",
    { reconcile: false },
  );
  assert.equal(typeof advanced.revision, "number");

  const ledger = parseProgressYaml(await readFile(result.ledger, "utf8"));
  assert.equal(ledger.交付状态, "coding");
  assert.equal(ledger.证据索引.apply.kind, "apply");
});

test("match-requirement ranks candidates and reports no_match", async () => {
  const projectRoot = await createProject();
  const requirementsDir = path.join(process.env.USERPROFILE, ".xiaoqi", "sprint-manage");

  const orderProject = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-order-"));
  await writeFile(path.join(orderProject, "order-service.js"), "export const 订单 = 1;\n");
  await mkdir(path.join(orderProject, "openspec", "specs", "order"), { recursive: true });
  await writeFile(
    path.join(orderProject, "openspec", "specs", "order", "spec.md"),
    "# 订单规格\n订单导出流程。\n",
  );
  const otherProject = await mkdtemp(path.join(os.tmpdir(), "xiaoqi-other-"));
  await writeFile(path.join(otherProject, "readme.md"), "infra project\n");

  // 历史账本：同前缀需求曾登记在 orderProject
  await mkdir(requirementsDir, { recursive: true });
  await writeFile(
    path.join(requirementsDir, "story-1001-v1.yaml"),
    `schema_version: 4
document_type: requirement
编号: "story-1001"
名称: "订单历史需求"
change_id: "story-1001-order-history"
revision: 1
updated_at: "2026-08-11T10:00:00+08:00"
updated_by: "alice"
流程状态: closed
交付状态: kept
当前意图: "已关闭"
推荐动作: null
协作:
  模式: single
  负责人: "alice"
仓库:
  - id: "main"
    root: "${orderProject.replaceAll("\\", "\\\\")}"
    branch: "feature/story-1001"
    worktree: ".worktrees/story-1001"
依赖需求: []
冲突键: []
影响范围: []
计划: null
证据索引: {}
用户决策: []
阻塞项: []
事件日志: []
`,
  );

  await writeFile(
    path.join(requirementsDir, "infra-1001-v1.yaml"),
    `schema_version: 4
document_type: requirement
编号: "infra-1001"
名称: "基础设施"
change_id: "infra-1001-ci"
revision: 1
updated_at: "2026-08-11T10:00:00+08:00"
updated_by: "alice"
流程状态: closed
交付状态: kept
当前意图: "已关闭"
推荐动作: null
协作:
  模式: single
  负责人: "alice"
仓库:
  - id: "main"
    root: "${otherProject.replaceAll("\\", "\\\\")}"
    branch: "feature/infra-1001"
    worktree: ".worktrees/infra-1001"
依赖需求: []
冲突键: []
影响范围: []
计划: null
证据索引: {}
用户决策: []
阻塞项: []
事件日志: []
`,
  );

  const matched = matchRequirement(projectRoot, ["订单", "导出"], {
    requirementId: "story-2009",
    requirementsDir,
  });
  assert.equal(matched.no_match, false);
  assert.equal(matched.scanned_projects, 3);
  const top = matched.candidates[0];
  assert.equal(path.resolve(top.root), path.resolve(orderProject));
  assert.ok(top.keyword_files > 0);
  assert.ok(top.specs_hits > 0);
  assert.equal(top.history_hits, 1);
  assert.equal(matched.candidates[1].score, 0);

  const unmatched = matchRequirement(projectRoot, ["区块链"], {
    requirementId: "story-2009",
    requirementsDir,
  });
  assert.equal(unmatched.no_match, true);
});

test("reopen inherits the autonomy configuration", async () => {
  const projectRoot = await createProject();

  const source = (await readFile(
    path.join(testDir, "fixtures", "valid-single.yaml"),
    "utf8",
  )).replace(/\r\n/g, "\n");
  const closedPath = path.join(
    process.env.USERPROFILE, ".xiaoqi", "sprint-manage", "story-1001-v1.yaml",
  );
  await mkdir(path.dirname(closedPath), { recursive: true });
  await writeFile(
    closedPath,
    source
      .replace("schema_version: 4", "schema_version: 5")
      .replace("revision: 1", "revision: 5")
      .replace("流程状态: active", "流程状态: closed")
      .replace("交付状态: coding", "交付状态: kept")
      .replace(
        "协作:\n  模式: single",
        '托管:\n  mode: full\n  closing: pr-open\n  activated_by: trigger-word\n协作:\n  模式: single',
      )
      .replace(
        "  archive:\n    outcome: pending\n    path: null",
        '  archive:\n    kind: "archive"\n    command: "openspec archive"\n    exit_code: 0\n    checked_at: "2026-08-20T10:00:00+08:00"\n    outcome: completed\n    path: "openspec/changes/archive/story-1001"',
      )
      .replace(
        "  finish:\n    outcome: pending\n    result: null\n    summary: null",
        '  finish:\n    kind: "finish"\n    command: "git status"\n    exit_code: 0\n    commit: "abc123"\n    checked_at: "2026-08-20T10:00:00+08:00"\n    outcome: completed\n    result: kept\n    summary: "本地保留"',
      ),
  );

  const result = initializeRequirement(
    projectRoot, "story-1001", "用户搜索", "story-1001-user-search", "alice", "requester",
    { reopenFrom: closedPath },
  );

  assert.equal(result.outcome, "reopened");
  const ledger = parseProgressYaml(await readFile(result.ledger, "utf8"));
  assert.equal(ledger.schema_version, 5);
  assert.deepEqual(ledger.托管, {
    mode: "full",
    closing: "pr-open",
    activated_by: "trigger-word",
  });
});

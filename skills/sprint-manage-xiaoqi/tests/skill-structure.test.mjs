import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(testDir, "..");
const readSkillFile = (relativePath) =>
  readFile(path.join(skillDir, relativePath), "utf8");
const referenceNames = [
  "state-contract.md",
  "step-details.md",
  "closing.md",
  "runtime-contract.md",
];
const returnFields = [
  "outcome",
  "summary",
  "evidence",
  "blockers",
  "recommended_next",
];
const removedPaths = [
  "scripts/generic-hook.mjs",
  "scripts/trae-hook.mjs",
  "scripts/codex-hook.mjs",
  "scripts/lifecycle.mjs",
  "scripts/host-rules.mjs",
  "scripts/install-host-rules.mjs",
  "scripts/install-codex-integration.mjs",
  "scripts/guarded-run.mjs",
  "scripts/policies/command-safety.mjs",
  "scripts/core/hook-runtime.mjs",
  "scripts/core/event-contract.mjs",
  "scripts/adapters/trae.mjs",
  "scripts/adapters/codex.mjs",
  "references/event-contract.md",
];

test("removes Hook integration artifacts", async () => {
  for (const relativePath of removedPaths) {
    await assert.rejects(readSkillFile(relativePath), { code: "ENOENT" });
  }
});

test("documents the global ledger and multi-repository workflow", async () => {
  const state = await readSkillFile("references/state-contract.md");
  const steps = await readSkillFile("references/step-details.md");

  assert.match(state, /~\/\.xiaoqi\/sprint-manage\//);
  assert.match(state, /-v<版本号>\.yaml/);
  assert.match(state, /不创建、不读取\s+`session\.yaml`/);
  assert.match(state, /单个需求可以登记多个仓库/);
  assert.match(steps, /同一用户可以并行推进多个需求/);
  assert.match(steps, /单个需求可以登记多个仓库/);
  assert.doesNotMatch(state, /shared-change|并行单元/);
  assert.doesNotMatch(steps, /协作评估|多人协作|大型需求多人分工/);
});

test("keeps post-ready closing rules in one focused reference", async () => {
  const closing = await readSkillFile("references/closing.md");
  const state = await readSkillFile("references/state-contract.md");
  const steps = await readSkillFile("references/step-details.md");

  assert.match(closing, /不拥有会话或流程控制权/);
  assert.match(closing, /到达 `ready` 后停止/);
  assert.match(closing, /用户选择.*PR.*合并.*保留/s);
  assert.match(closing, /archive/);
  assert.match(closing, /finish/);
  assert.match(closing, /close-requirement\.mjs/);
  assert.match(closing, /pr-open \| merged \| kept/);
  assert.match(closing, /收尾检查顺序/);
  assert.match(closing, /branch.*worktree.*PR 或 merge/s);
  assert.match(closing, /选择 `kept` 时/);

  assert.doesNotMatch(steps, /^### archive 和 finish$/m);
  assert.doesNotMatch(steps, /^### sync$/m);
  assert.doesNotMatch(state, /^## 首次建账和正式关闭$/m);
});

test("routes every focused reference from the main skill", async () => {
  const skill = await readSkillFile("SKILL.md");
  const routeSection = skill.match(
    /## 路由\s*([\s\S]*?)(?=\n## )/,
  )?.[1];
  const expectedRoutes = [
    [
      "新建、恢复、查看需求；账本或状态问题",
      "references/state-contract.md",
    ],
    [
      "开始、继续、更新、验证；普通执行失败",
      "references/step-details.md",
    ],
    [
      "已到 `ready`；PR、合并、保留、归档、关闭需求或关闭整个迭代",
      "references/closing.md",
    ],
    [
      "账本运行时、状态推进或证据校验",
      "references/runtime-contract.md",
    ],
  ];

  assert.ok(routeSection);
  const routes = [...routeSection.matchAll(
    /^\| (.*?) \| \[[^\]]+\]\(([^)]+)\) \|$/gm,
  )].map((match) => [match[1], match[2]]);
  assert.deepEqual(routes, expectedRoutes);
  assert.equal(routes.length, 4);
});

test("requires every reference to return control to the main skill", async () => {
  for (const name of referenceNames) {
    const content = await readSkillFile(`references/${name}`);
    assert.match(content, /不拥有会话或流程控制权/, name);
    assert.match(content, /返回 `SKILL\.md`/, name);
  }
});

test("requires the same five-field return protocol in every reference", async () => {
  for (const name of referenceNames) {
    const content = await readSkillFile(`references/${name}`);
    const returnSection = content.match(
      /## 结果返回\s*([\s\S]*?)(?=\n## |\s*$)/,
    )?.[1];
    assert.ok(returnSection, `${name} should define ## 结果返回`);
    const fields = [...returnSection.matchAll(/^- `([^`]+)`$/gm)].map(
      (match) => match[1],
    );
    assert.deepEqual(fields, returnFields, name);
  }
});

test("keeps references subordinate without cross-reference routing", async () => {
  const referenceBasenames = referenceNames.map((name) =>
    name.replace(".md", ""),
  );

  for (const name of referenceNames) {
    const content = await readSkillFile(`references/${name}`);
    const otherNames = referenceBasenames.filter(
      (referenceName) => referenceName !== name.replace(".md", ""),
    );
    const names = otherNames.join("|");

    assert.doesNotMatch(
      content,
      new RegExp(`\\]\\([^)]*(?:references/)?(?:${names})\\.md\\b`),
      name,
    );
    assert.doesNotMatch(
      content,
      new RegExp(
        `(?:读取|调用|跳转|转到|切换到|进入|使用|转换为|见|指向)[^。\\n]{0,40}(?:${names})\\.md`,
      ),
      name,
    );
  }
});

test("routes requirement and iteration closing only through closing", async () => {
  const skill = await readSkillFile("SKILL.md");
  const closing = await readSkillFile("references/closing.md");
  const steps = await readSkillFile("references/step-details.md");

  assert.match(
    skill,
    /关闭需求或关闭整个迭代[\s\S]*references\/closing\.md/,
  );
  assert.match(closing, /^## 关闭整个迭代$/m);
  assert.doesNotMatch(steps, /关闭整个迭代/);
  assert.doesNotMatch(steps, /移动迭代账本/);
});

test("keeps recommended_next as an abstract intent instead of a reference path", async () => {
  for (const name of referenceNames) {
    const content = await readSkillFile(`references/${name}`);
    assert.doesNotMatch(
      content,
      /recommended_next[\s\S]{0,120}(?:[A-Za-z0-9_-]+\.md|指向[^。\n]*\.md)/,
      name,
    );
  }
});

test("keeps session lock ownership separate from automatic stop points", async () => {
  const skill = await readSkillFile("SKILL.md");

  for (const content of [skill]) {
    assert.match(content, /只有 `?退出小七`?[^。\n]*解除会话接管|只有 `?退出小七`?[^。\n]*解除当前接管/);
    assert.match(content, /`ready`、`blocked`、`closed`[\s\S]{0,80}不解除|ready、blocked 或 closed[\s\S]{0,80}不解除/);
  }
});

test("returns simple and complex paths to the main skill at ready", async () => {
  const steps = await readSkillFile("references/step-details.md");
  const simplePath = steps.match(
    /## 简单路径([\s\S]*?)(?=\n## 多需求与多仓库路径)/,
  )?.[1];
  const complexPath = steps.match(
    /## 多需求与多仓库路径([\s\S]*?)(?=\n## 开发中变化)/,
  )?.[1];

  assert.ok(simplePath);
  assert.ok(complexPath);

  for (const pathText of [simplePath, complexPath]) {
    assert.match(
      pathText,
      /-> ready[\s\S]*-> 返回主技能（recommended_next: closing）/,
    );
    const afterReady = pathText.split("ready").slice(1).join("ready");
    assert.doesNotMatch(afterReady, /archive|finish/i);
  }
});

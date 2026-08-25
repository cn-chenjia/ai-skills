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
  "collaboration.md",
  "closing.md",
  "runtime-contract.md",
  "event-contract.md",
];
const returnFields = [
  "outcome",
  "summary",
  "evidence",
  "blockers",
  "recommended_next",
];

test("keeps detailed collaboration rules in one focused reference", async () => {
  const collaboration = await readSkillFile("references/collaboration.md");
  const state = await readSkillFile("references/state-contract.md");
  const steps = await readSkillFile("references/step-details.md");

  assert.match(collaboration, /不拥有会话或流程控制权/);
  assert.match(collaboration, /返回 `SKILL\.md`/);
  assert.match(collaboration, /单写者/);
  assert.match(collaboration, /独立.*branch.*worktree/s);
  assert.match(collaboration, /write_scope/);
  assert.match(collaboration, /depends_on/);
  assert.match(collaboration, /冲突键/);

  assert.doesNotMatch(state, /^## 协作模式$/m);
  assert.doesNotMatch(state, /^## 并发冲突$/m);
  assert.doesNotMatch(steps, /^## 单人并行多个需求$/m);
  assert.doesNotMatch(steps, /^## 多人分别开发多个需求$/m);
  assert.doesNotMatch(steps, /^## 大型需求多人分工$/m);

  const firstParallelScenario = steps.indexOf(
    "存在多个可独立执行且写入范围不冲突的任务。",
  );
  const collaborationRoute = steps.indexOf(
    "涉及多需求、多人、分支、工作区或写入范围冲突时",
  );
  assert.ok(firstParallelScenario >= 0);
  assert.ok(
    collaborationRoute > firstParallelScenario &&
      collaborationRoute < firstParallelScenario + 200,
  );

  assert.match(
    state,
    /`shared-change`.*集成分支.*至少两个并行单元/s,
  );
  assert.match(
    state,
    /分支、工作区、依赖需求、冲突键、影响范围.*write_scope/s,
  );
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
      "复杂且明确需要多人协作的需求，或多需求、多人、分支、工作区或写入范围冲突",
      "references/collaboration.md",
    ],
    [
      "已到 `ready`；PR、合并、保留、归档、关闭需求或关闭整个迭代",
      "references/closing.md",
    ],
    [
      "安装、Hook、Codex、Trae、初始化检查或宿主异常",
      "references/runtime-contract.md",
    ],
    ["底层事件或适配器数据", "references/event-contract.md"],
  ];

  assert.ok(routeSection);
  const routes = [...routeSection.matchAll(
    /^\| (.*?) \| \[[^\]]+\]\(([^)]+)\) \|$/gm,
  )].map((match) => [match[1], match[2]]);
  assert.deepEqual(routes, expectedRoutes);
  assert.equal(routes.length, 6);
});

test("documents the thin controller and all focused references", async () => {
  const description = await readFile(
    path.resolve(
      skillDir,
      "..",
      "..",
      "description",
      "skills",
      "sprint-manage-xiaoqi.md",
    ),
    "utf8",
  );

  assert.match(description, /主技能.*会话锁.*路由/s);
  assert.match(description, /collaboration\.md/);
  assert.match(description, /closing\.md/);
  assert.match(description, /按需读取/);
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
  const description = await readFile(
    path.resolve(
      skillDir,
      "..",
      "..",
      "description",
      "skills",
      "sprint-manage-xiaoqi.md",
    ),
    "utf8",
  );

  for (const content of [skill, description]) {
    assert.match(content, /只有 `?退出小七`?[^。\n]*解除会话接管|只有 `?退出小七`?[^。\n]*解除当前接管/);
    assert.match(content, /`ready`、`blocked`、`closed`[\s\S]{0,80}不解除|ready、blocked 或 closed[\s\S]{0,80}不解除/);
  }
});

test("returns simple and complex paths to the main skill at ready", async () => {
  const steps = await readSkillFile("references/step-details.md");
  const simplePath = steps.match(
    /## 简单路径([\s\S]*?)(?=\n## 复杂路径)/,
  )?.[1];
  const complexPath = steps.match(
    /## 复杂路径([\s\S]*?)(?=\n## 开发中变化)/,
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

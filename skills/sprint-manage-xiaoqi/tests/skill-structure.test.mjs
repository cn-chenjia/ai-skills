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
      "`ready` 前用户要求合并分支或推送远程",
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
  assert.equal(routes.length, 5);
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

test("documents pre-ready merge instructions with deferred evidence gates", async () => {
  const skill = await readSkillFile("SKILL.md");
  const steps = await readSkillFile("references/step-details.md");

  assert.match(
    skill,
    /\| `ready` 前用户要求合并分支或推送远程 \| \[step-details\.md\]\(references\/step-details\.md\) \|/,
  );

  const section = steps.match(
    /## 提前合并\/推送指令\s*([\s\S]*?)(?=\n## )/,
  )?.[1];
  assert.ok(section, "step-details.md 应包含「提前合并/推送指令」小节");

  assert.match(section, /kind: early-merge/);
  assert.match(section, /门禁后置/);
  assert.match(section, /原因/);
  assert.match(section, /交付状态保持不变/);
  assert.match(section, /门禁不可豁免、不可伪造/);
  assert.match(section, /禁止[^。\n]*early-merge[^。\n]*finish/);
});

test("requires tasks completeness check before archive", async () => {
  const closing = await readSkillFile("references/closing.md");
  const section = closing.match(
    /## 收尾检查顺序\s*([\s\S]*?)(?=\n## )/,
  )?.[1];
  assert.ok(section, "closing.md 应包含「收尾检查顺序」小节");

  assert.match(section, /^0\. tasks 完整性核对/m);
  assert.match(section, /openspec list/);
  assert.match(section, /✓ Complete/);
  assert.match(section, /逐项核对 tasks\.md 勾选与已交付事实一致/);
  assert.match(section, /不得为凑数而标记/);
  assert.match(section, /0\. tasks 完整性核对[\s\S]*?1\. 项目测试/);
});

test("requires archive preflight before the real archive run", async () => {
  const closing = await readSkillFile("references/closing.md");
  const section = closing.match(
    /## 收尾检查顺序\s*([\s\S]*?)(?=\n## )/,
  )?.[1];
  assert.ok(section, "closing.md 应包含「收尾检查顺序」小节");

  assert.match(section, /^0\.5 archive 预检/m);
  assert.match(section, /openspec archive <change> --json`（不带 --yes）/);
  assert.match(section, /archive_validation_failed/);
  assert.match(section, /archive_confirmation_required/);
  assert.match(section, /archive\.path/);
  assert.match(
    section,
    /0\. tasks 完整性核对[\s\S]*?0\.5 archive 预检[\s\S]*?1\. 项目测试/,
  );
});

test("documents environmentNotes persistence for probe conclusions", async () => {
  const runtime = await readSkillFile("references/runtime-contract.md");
  const section = runtime.match(
    /## 环境知识沉淀\s*([\s\S]*?)(?=\n## )/,
  )?.[1];
  assert.ok(section, "runtime-contract.md 应包含「环境知识沉淀」小节");

  assert.match(section, /environmentNotes/);
  assert.match(section, /\.xiaoqi\/config\.yaml/);
  assert.match(section, /先读 `environmentNotes`/);
  assert.match(section, /未命中才发起探测/);
  assert.match(section, /用户确认后/);
  assert.match(section, /幂等合并/);
  assert.match(section, /网关前缀|环境域名|表结构/);
});

test("documents manual check evidence semantics and self-verification priority", async () => {
  const state = await readSkillFile("references/state-contract.md");
  const schemaSection = state.match(
    /## 证据字段速查表\s*([\s\S]*?)(?=\n## )/,
  )?.[1];
  assert.ok(schemaSection, "state-contract.md 应包含「证据字段速查表」小节");
  assert.match(schemaSection, /manual/);
  assert.match(schemaSection, /confirmed_by/);
  assert.match(schemaSection, /人工确认人/);

  const steps = await readSkillFile("references/step-details.md");
  const verifySection = steps.match(
    /### 三类验证\s*([\s\S]*?)(?=\n## )/,
  )?.[1];
  assert.ok(verifySection, "step-details.md 应包含「三类验证」小节");
  assert.match(verifySection, /优先自行复验/);
  assert.match(verifySection, /登录态 fetch|DB 查询/);
  assert.match(verifySection, /口头确认仅兜底|口头确认.*兜底/);
});

test("documents PowerShell command discipline for Windows hosts", async () => {
  const steps = await readSkillFile("references/step-details.md");
  const section = steps.match(
    /## apply 与模型执行\s*([\s\S]*?)(?=\n## )/,
  )?.[1];
  assert.ok(section, "step-details.md 应包含「apply 与模型执行」小节");

  assert.match(section, /PowerShell/);
  assert.match(section, /单行 -m/);
  assert.match(section, /禁用 heredoc|禁用 && \/ \|\|/);
});

test("documents the terminal intent semantics after closing", async () => {
  const state = await readSkillFile("references/state-contract.md");
  assert.match(state, /需求已关闭/);
  assert.match(state, /关闭后.*推荐动作.*null|推荐动作.*置为 null|推荐动作置 null/);
});

test("requires verification environment as a clarification dimension", async () => {
  const steps = await readSkillFile("references/step-details.md");
  const simplePath = steps.match(
    /## 简单路径([\s\S]*?)(?=\n## 多需求与多仓库路径)/,
  )?.[1];
  assert.ok(simplePath);

  assert.match(simplePath, /验证环境/);
  assert.match(simplePath, /SIT\/MIT\/UAT\/PRO|SIT、MIT、UAT、PRO/);
  assert.match(simplePath, /禁止沿用模板或历史需求的默认环境值/);

  const routeTable = steps.match(
    /## 动作路由\s*([\s\S]*?)(?=\n## )/,
  )?.[1];
  assert.ok(routeTable, "step-details.md 应包含「动作路由」小节");
  const exploreRow = routeTable
    .split("\n")
    .find((line) => line.includes("`explore`"));
  assert.ok(exploreRow, "动作路由表应包含 explore 行");
  assert.match(exploreRow, /验证环境澄清/);
});

test("uses skill-path placeholders for script command examples", async () => {
  const state = await readSkillFile("references/state-contract.md");
  const closing = await readSkillFile("references/closing.md");

  for (const content of [state, closing]) {
    assert.doesNotMatch(
      content,
      /node scripts\/|`scripts\/[a-z-]+\.mjs`/,
      "脚本命令示例必须使用 <小七技能安装目录> 占位符而非裸相对路径",
    );
  }
  assert.match(state, /<小七技能安装目录>\/scripts\/validate-progress\.mjs/);
  assert.match(closing, /<小七技能安装目录>\/scripts\/close-requirement\.mjs/);
});

test("requires line-by-line and query-side special-case checks in explore", async () => {
  const steps = await readSkillFile("references/step-details.md");
  const simplePath = steps.match(
    /## 简单路径([\s\S]*?)(?=\n## 多需求与多仓库路径)/,
  )?.[1];
  assert.ok(simplePath);

  assert.match(simplePath, /逐行核对参考实现的取值表达式/);
  assert.match(simplePath, /下标、层级截取、空保护/);
  assert.match(simplePath, /design\.md 中原样记录关键行/);
  assert.match(simplePath, /禁止只按方法语义推断输出形状/);

  assert.match(simplePath, /检索目标类型编码在查询\/组装\/过滤/);
  assert.match(simplePath, /含"不要\/跳过\/不返回"注释的代码行|含「不要\/跳过\/不返回」注释的代码行/);
  assert.match(simplePath, /diff 目标类型与参考类型的分支差异/);
  assert.match(simplePath, /确认差异点即实现点/);
});

test("requires remote reconciliation before push and DB enum shape checks", async () => {
  const closing = await readSkillFile("references/closing.md");
  const branchSection = closing.match(
    /## 分支收尾\s*([\s\S]*?)(?=\n## )/,
  )?.[1];
  assert.ok(branchSection, "closing.md 应包含「分支收尾」小节");
  assert.match(branchSection, /push 前先 fetch 并对账/);
  assert.match(branchSection, /git branch -r --contains/);
  assert.match(branchSection, /远端已包含时改走 pull 同步/);

  const steps = await readSkillFile("references/step-details.md");
  const simplePath = steps.match(
    /## 简单路径([\s\S]*?)(?=\n## 多需求与多仓库路径)/,
  )?.[1];
  assert.ok(simplePath);
  assert.match(simplePath, /SELECT DISTINCT/);
  assert.match(simplePath, /先怀疑查询值形态/);
  assert.match(simplePath, /断言"无数据需造数"|断言「无数据需造数」/);
});

test("routes on-demand environment diagnosis through doctor", async () => {
  const skill = await readSkillFile("SKILL.md");
  const runtime = await readSkillFile("references/runtime-contract.md");
  const state = await readSkillFile("references/state-contract.md");

  const startup = skill.match(
    /## 最小启动检查\s*([\s\S]*?)(?=\n## )/,
  )?.[1];
  assert.ok(startup, "SKILL.md 应包含「最小启动检查」小节");
  assert.match(startup, /环境诊断按需触发/);
  assert.match(startup, /doctor\.mjs/);
  assert.match(startup, /普通续接消息不运行环境检查/);

  assert.match(runtime, /doctor\.mjs/);
  assert.match(runtime, /环境诊断/);

  // 全局运行时目录（~/.xiaoqi/runtime）不再被流程依赖，布局文档不再记载
  assert.doesNotMatch(state, /  runtime\//);
});

#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const WORKFLOW_STATUS_VALUES = new Set(["active", "paused", "blocked", "closed"]);
const DELIVERY_STATUS_VALUES = new Set([
  "not-started",
  "coding",
  "verified",
  "reviewed",
  "ready",
  "pr-open",
  "merged",
  "kept",
]);
const FINAL_DELIVERY_STATUS_VALUES = new Set(["pr-open", "merged", "kept"]);
const COLLABORATION_MODE_VALUES = new Set(["single", "independent"]);
const ACTION_VALUES = new Set([
  "explore",
  "propose",
  "prepare-workspace",
  "apply",
  "update",
  "verify",
  "sync",
  "archive",
  "finish",
]);
const DELIVERY_TRANSITIONS = new Map([
  ["not-started", new Set(["coding"])],
  ["coding", new Set(["verified"])],
  ["verified", new Set(["reviewed"])],
  ["reviewed", new Set(["ready"])],
  ["ready", new Set(["pr-open", "merged", "kept"])],
  ["pr-open", new Set()],
  ["merged", new Set()],
  ["kept", new Set()],
]);
const SUCCESS_OUTCOMES = new Set(["passed", "completed", "archived"]);
const LEGACY_V2_KEYS = new Set([
  "依赖状态",
  "状态",
  "场景",
  "当前阶段",
  "当前活动",
  "执行模式",
  "变更轮次",
  "变更目录",
  "产物",
  "证据",
  "当前步骤",
  "当前子步骤",
  "子步骤",
  "当前需求",
  "需求列表",
]);

export class YamlSubsetError extends Error {
  constructor(message, lineNumber) {
    super(lineNumber ? `第 ${lineNumber} 行：${message}` : message);
    this.name = "YamlSubsetError";
    this.lineNumber = lineNumber;
  }
}

function stripComment(value) {
  let quote = null;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"') {
      if (character === "\\") {
        index += 1;
      } else if (character === '"') {
        quote = null;
      }
      continue;
    }
    if (quote === "'") {
      if (character === "'" && value[index + 1] === "'") {
        index += 1;
      } else if (character === "'") {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "#" && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index).trimEnd();
    }
  }

  if (quote) {
    throw new YamlSubsetError("字符串引号没有闭合");
  }
  return value.trimEnd();
}

function findMappingColon(content) {
  let quote = null;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quote === '"') {
      if (character === "\\") {
        index += 1;
      } else if (character === '"') {
        quote = null;
      }
      continue;
    }
    if (quote === "'") {
      if (character === "'" && content[index + 1] === "'") {
        index += 1;
      } else if (character === "'") {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (
      character === ":" &&
      (index === content.length - 1 || /\s/.test(content[index + 1]))
    ) {
      return index;
    }
  }
  return -1;
}

function splitKeyValue(content, lineNumber) {
  const separator = findMappingColon(content);
  if (separator < 0) {
    throw new YamlSubsetError("映射项缺少冒号", lineNumber);
  }
  const key = content.slice(0, separator).trim();
  if (!key || key.startsWith("?")) {
    throw new YamlSubsetError("只支持普通的非空键", lineNumber);
  }
  return [key, content.slice(separator + 1).trim()];
}

function parseScalar(value, lineNumber) {
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "[]") return [];
  if (value === "{}") return {};
  if (/^-?\d+$/.test(value)) return Number(value);

  if (value.startsWith('"')) {
    if (!value.endsWith('"')) {
      throw new YamlSubsetError("双引号字符串没有闭合", lineNumber);
    }
    try {
      return JSON.parse(value);
    } catch {
      throw new YamlSubsetError("双引号字符串转义无效", lineNumber);
    }
  }

  if (value.startsWith("'")) {
    if (!value.endsWith("'")) {
      throw new YamlSubsetError("单引号字符串没有闭合", lineNumber);
    }
    return value.slice(1, -1).replaceAll("''", "'");
  }

  if (/^[|>&*!]/.test(value)) {
    throw new YamlSubsetError(
      "不支持多行块、锚点、别名或标签，请改用普通字符串",
      lineNumber,
    );
  }

  return value;
}

function tokenize(source) {
  const tokens = [];
  const rawLines = source.replace(/^\uFEFF/, "").split(/\r?\n/);

  rawLines.forEach((rawLine, index) => {
    if (rawLine.includes("\t")) {
      throw new YamlSubsetError("缩进不能使用 Tab", index + 1);
    }
    const withoutComment = stripComment(rawLine);
    if (!withoutComment.trim()) return;

    const indent = withoutComment.match(/^ */)[0].length;
    if (indent % 2 !== 0) {
      throw new YamlSubsetError("缩进必须使用偶数个空格", index + 1);
    }

    tokens.push({
      content: withoutComment.slice(indent),
      indent,
      lineNumber: index + 1,
    });
  });

  return tokens;
}

function parseMapping(tokens, startIndex, indent) {
  const result = {};
  let index = startIndex;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token.indent < indent) break;
    if (token.indent > indent) {
      throw new YamlSubsetError("出现无法归属的额外缩进", token.lineNumber);
    }
    if (token.content.startsWith("-")) break;

    const [key, rawValue] = splitKeyValue(token.content, token.lineNumber);
    if (Object.hasOwn(result, key)) {
      throw new YamlSubsetError(`键“${key}”重复`, token.lineNumber);
    }

    if (rawValue) {
      result[key] = parseScalar(rawValue, token.lineNumber);
      index += 1;
      continue;
    }

    const next = tokens[index + 1];
    if (!next || next.indent <= indent) {
      result[key] = null;
      index += 1;
      continue;
    }
    if (next.indent !== indent + 2) {
      throw new YamlSubsetError("子级缩进必须增加两个空格", next.lineNumber);
    }

    const parsed = parseBlock(tokens, index + 1, indent + 2);
    result[key] = parsed.value;
    index = parsed.nextIndex;
  }

  return { value: result, nextIndex: index };
}

function parseSequence(tokens, startIndex, indent) {
  const result = [];
  let index = startIndex;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token.indent < indent) break;
    if (token.indent !== indent || !token.content.startsWith("-")) break;

    const rest = token.content.slice(1).trim();
    if (!rest) {
      const next = tokens[index + 1];
      if (!next || next.indent !== indent + 2) {
        throw new YamlSubsetError("空列表项必须包含缩进子级", token.lineNumber);
      }
      const parsed = parseBlock(tokens, index + 1, indent + 2);
      result.push(parsed.value);
      index = parsed.nextIndex;
      continue;
    }

    if (findMappingColon(rest) < 0) {
      result.push(parseScalar(rest, token.lineNumber));
      index += 1;
      continue;
    }

    const [key, rawValue] = splitKeyValue(rest, token.lineNumber);
    const item = {};
    item[key] = rawValue ? parseScalar(rawValue, token.lineNumber) : null;
    index += 1;

    if (!rawValue && index < tokens.length && tokens[index].indent === indent + 4) {
      const parsed = parseBlock(tokens, index, indent + 4);
      item[key] = parsed.value;
      index = parsed.nextIndex;
    }

    if (index < tokens.length && tokens[index].indent === indent + 2) {
      const parsed = parseMapping(tokens, index, indent + 2);
      for (const additionalKey of Object.keys(parsed.value)) {
        if (Object.hasOwn(item, additionalKey)) {
          throw new YamlSubsetError(`键“${additionalKey}”重复`);
        }
      }
      Object.assign(item, parsed.value);
      index = parsed.nextIndex;
    }

    result.push(item);
  }

  return { value: result, nextIndex: index };
}

function parseBlock(tokens, startIndex, indent) {
  const token = tokens[startIndex];
  if (!token || token.indent !== indent) {
    throw new YamlSubsetError("无法确定当前 YAML 数据块");
  }
  return token.content.startsWith("-")
    ? parseSequence(tokens, startIndex, indent)
    : parseMapping(tokens, startIndex, indent);
}

export function parseProgressYaml(source) {
  const tokens = tokenize(source);
  if (tokens.length === 0) {
    throw new YamlSubsetError("状态文件不能为空");
  }
  if (tokens[0].indent !== 0) {
    throw new YamlSubsetError("根节点不能缩进", tokens[0].lineNumber);
  }

  const parsed = parseBlock(tokens, 0, 0);
  if (parsed.nextIndex !== tokens.length) {
    throw new YamlSubsetError(
      "存在未解析的内容",
      tokens[parsed.nextIndex]?.lineNumber,
    );
  }
  return parsed.value;
}

function addIssue(issues, code, issuePath, message, severity = "error") {
  issues.push({ code, path: issuePath, message, severity });
}

export function isBlockingIssue(issue) {
  return issue?.severity !== "warning";
}

function validateEnum(issues, value, allowed, code, issuePath, label) {
  if (!allowed.has(value)) {
    addIssue(
      issues,
      code,
      issuePath,
      `${label}“${String(value)}”不在允许范围内`,
    );
  }
}

function findLegacyV2Fields(value, currentPath, issues) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      findLegacyV2Fields(item, `${currentPath}[${index}]`, issues),
    );
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = currentPath ? `${currentPath}.${key}` : key;
    if (LEGACY_V2_KEYS.has(key)) {
      addIssue(
        issues,
        "legacy-v2-field",
        childPath,
        "检测到 V2 阶段状态字段；请先迁移为 V3 轻账本",
      );
    }
    findLegacyV2Fields(child, childPath, issues);
  }
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isSuccessfulEvidence(evidence, expectedKind, expectedResult = null) {
  return (
    evidence &&
    typeof evidence === "object" &&
    evidence.kind === expectedKind &&
    hasText(evidence.command) &&
    evidence.exit_code === 0 &&
    hasText(evidence.commit) &&
    hasText(evidence.checked_at) &&
    hasText(evidence.summary) &&
    (expectedResult === null || evidence.result === expectedResult)
  );
}

function isSuccessfulApplyEvidence(evidence) {
  return (
    evidence &&
    typeof evidence === "object" &&
    evidence.kind === "apply" &&
    hasText(evidence.command) &&
    evidence.exit_code === 0 &&
    hasText(evidence.checked_at) &&
    hasText(evidence.summary)
  );
}

function repositoryEvidenceList(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.repositories)) return value.repositories;
  return value && typeof value === "object" ? [value] : [];
}

function repositoryEvidenceIssues(document) {
  const issues = [];
  const repositories = Array.isArray(document.仓库) ? document.仓库 : [];
  const evidence = document.证据索引 ?? {};
  const repositoryIds = new Set(repositories.map((repository) => repository.id));
  for (const kind of ["apply", "checks"]) {
    const items = repositoryEvidenceList(evidence[kind]);
    for (const [index, item] of items.entries()) {
      if (repositories.length <= 1 && !item?.repository_id) continue;
      const issuePath = `证据索引.${kind}${Array.isArray(evidence[kind]?.repositories) || Array.isArray(evidence[kind]) ? `[${index}]` : ""}`;
      if (!hasText(item?.repository_id) || !repositoryIds.has(item.repository_id)) {
        addIssue(issues, item?.repository_id ? "unknown-repository-evidence" : "missing-repository-evidence", `${issuePath}.repository_id`, item?.repository_id ? `证据引用了未登记的仓库: ${item.repository_id}` : "多仓库证据必须包含有效的 repository_id");
      }
    }
  }
  return issues;
}

function hasSuccessfulRepositoryEvidence(value, kind, repositoryIds) {
  const items = repositoryEvidenceList(value);
  const isSuccessful =
    kind === "apply"
      ? isSuccessfulApplyEvidence
      : (item) => isSuccessfulEvidence(item, "check");
  return [...repositoryIds].every((repositoryId) =>
    items.some(
      (item) => item?.repository_id === repositoryId && isSuccessful(item),
    ),
  );
}

function tddPhaseValid(phase, expectedExitCode, expectedResult) {
  return (
    phase &&
    hasText(phase.command) &&
    phase.exit_code === expectedExitCode &&
    phase.result === expectedResult &&
    hasText(phase.summary)
  );
}

function taskMappingIssues(document) {
  const issues = [];
  if (!Object.hasOwn(document, "任务映射")) return issues;
  if (!Array.isArray(document.任务映射)) {
    addIssue(issues, "invalid-task-mapping", "任务映射", "任务映射必须是数组");
    return issues;
  }
  const taskIds = new Set();
  for (const [index, task] of document.任务映射.entries()) {
    const issuePath = `任务映射[${index}]`;
    if (!hasText(task?.id) || taskIds.has(task.id)) {
      addIssue(issues, "duplicate-task-id", `${issuePath}.id`, "任务 id 必须非空且唯一");
    } else {
      taskIds.add(task.id);
    }
    if (!["pending", "completed"].includes(task?.status)) {
      addIssue(issues, "invalid-task-status", `${issuePath}.status`, "任务状态必须为 pending 或 completed");
    }
    const tdd = task?.tdd;
    if (tdd?.enabled === true) {
      if (!tddPhaseValid(tdd.red, 1, "failed")) {
        addIssue(issues, "invalid-tdd-red", `${issuePath}.tdd.red`, "TDD red 阶段必须以失败退出并标记 failed");
      }
      if (!tddPhaseValid(tdd.green, 0, "passed")) {
        addIssue(issues, "invalid-tdd-green", `${issuePath}.tdd.green`, "TDD green 阶段必须成功并标记 passed");
      }
      if (tdd.refactor && !tddPhaseValid(tdd.refactor, 0, "passed")) {
        addIssue(issues, "invalid-tdd-refactor", `${issuePath}.tdd.refactor`, "TDD refactor 阶段必须成功并标记 passed");
      }
    }
  }
  const completedTasks = document.证据索引?.apply?.completed_tasks ?? [];
  for (const taskId of completedTasks) {
    if (!taskIds.has(taskId)) {
      addIssue(issues, "unknown-completed-task", "证据索引.apply.completed_tasks", `未登记的 task: ${taskId}`);
    }
  }
  return issues;
}

function hasCompletedTaskMapping(document) {
  return !Object.hasOwn(document, "任务映射") ||
    document.任务映射.every((task) => task.status === "completed");
}

export function hasApprovedProposal(document) {
  return (
    Array.isArray(document.用户决策) &&
    document.用户决策.some(
      (decision) =>
        decision?.kind === "proposal-confirmation" &&
        decision?.outcome === "approved",
    )
  );
}

export function hasApprovedImplementationStart(document) {
  return (
    Array.isArray(document.用户决策) &&
    document.用户决策.some(
      (decision) =>
        decision?.kind === "implementation-start" &&
        decision?.outcome === "approved",
    )
  );
}

export function validateDeliveryTransition(document, fromStatus) {
  const issues = [];
  const repositories = Array.isArray(document.仓库) ? document.仓库 : [];
  const repositoryIds = new Set(repositories.map((repository) => repository.id));
  const toStatus = document?.交付状态;
  const requireAllRepositories = repositories.length > 1;
  const allowed = DELIVERY_TRANSITIONS.get(fromStatus) ?? new Set();

  if (fromStatus === toStatus) return issues;
  if (!allowed.has(toStatus)) {
    addIssue(
      issues,
      "invalid-delivery-transition",
      "交付状态",
      `不允许从 ${fromStatus} 推进到 ${toStatus}`,
    );
    return issues;
  }

  const eventKey = Object.keys(document).find((key) => key.includes("事件"));
  const events = eventKey && Array.isArray(document[eventKey])
    ? document[eventKey]
    : [];
  const lastEvent = events.at(-1);
  if (
    !lastEvent ||
    lastEvent.kind !== "delivery-transition" ||
    lastEvent.from !== fromStatus ||
    lastEvent.to !== toStatus
  ) {
    addIssue(
      issues,
      "missing-transition-event",
      eventKey ?? "事件日志",
      "状态变化必须由统一推进入口记录 delivery-transition 事件",
    );
  }

  if (requireAllRepositories) issues.push(...repositoryEvidenceIssues(document));
  const evidence = document.证据索引 ?? {};
  const checks = Array.isArray(evidence.checks) ? evidence.checks : [];
  const hasSuccessfulCheck = requireAllRepositories
    ? hasSuccessfulRepositoryEvidence(evidence.checks, "check", repositoryIds)
    : checks.some((item) => isSuccessfulEvidence(item, "check"));
  const hasSuccessfulApply = requireAllRepositories
    ? hasSuccessfulRepositoryEvidence(evidence.apply, "apply", repositoryIds)
    : isSuccessfulApplyEvidence(evidence.apply);

  if (
    toStatus === "coding" &&
    !hasSuccessfulApply
  ) {
    addIssue(
      issues,
      "missing-apply-evidence",
      "证据索引.apply",
      "进入 coding 前必须提供成功的 apply 证据",
    );
  }
  if (toStatus === "coding" && !hasApprovedProposal(document)) {
    addIssue(
      issues,
      "missing-proposal-confirmation",
      "用户决策",
      "进入 coding 前必须记录用户已确认需求方案",
    );
  }

  if (toStatus === "verified" && !hasSuccessfulCheck) {
    addIssue(
      issues,
      "missing-verification-evidence",
      "证据索引.checks",
      "进入 verified 前必须提供成功的 check 证据",
    );
  }
  if (toStatus === "verified" && !hasCompletedTaskMapping(document)) {
    addIssue(
      issues,
      "incomplete-task-mapping",
      "任务映射",
      "进入 verified 前所有已登记 task 必须完成",
    );
  }

  if (
    toStatus === "reviewed" &&
    (!hasSuccessfulCheck ||
      !isSuccessfulEvidence(evidence.review, "review", "approved"))
  ) {
    addIssue(
      issues,
      "missing-review-evidence",
      "证据索引.review",
      "进入 reviewed 前必须提供成功且 approved 的 review 证据",
    );
  }

  if (
    toStatus === "ready" &&
    (!hasSuccessfulCheck ||
      !isSuccessfulEvidence(evidence.review, "review", "approved") ||
      !isSuccessfulEvidence(
        evidence.openspec_verify,
        "openspec-verify",
        "passed",
      ))
  ) {
    addIssue(
      issues,
      "missing-openspec-evidence",
      "证据索引.openspec_verify",
      "进入 ready 前必须提供通过的 OpenSpec verify 证据",
    );
  }

  if (
    FINAL_DELIVERY_STATUS_VALUES.has(toStatus) &&
    !isSuccessfulEvidence(evidence.finish, "finish", toStatus)
  ) {
    addIssue(
      issues,
      "missing-finish-evidence",
      "证据索引.finish",
      `进入 ${toStatus} 前必须提供对应的 finish 证据`,
    );
  }

  return issues;
}

function normalizeScope(scope) {
  return path.posix
    .normalize(String(scope).replaceAll("\\", "/"))
    .replace(/^\.\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function validateProgress(document) {
  const issues = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return [
      {
        code: "invalid-root",
        path: "",
        message: "状态文件根节点必须是映射",
      },
    ];
  }

  findLegacyV2Fields(document, "", issues);
  issues.push(...taskMappingIssues(document));

  if (document.schema_version !== 4) {
    addIssue(
      issues,
      "unsupported-schema-version",
      "schema_version",
      "schema_version 必须为数字 4；旧版本需要先拆分迁移",
    );
  }

  if (
    Object.hasOwn(document, "需求列表") ||
    Object.hasOwn(document, "当前需求")
  ) {
    addIssue(
      issues,
      "legacy-shared-ledger",
      "",
      "共享需求列表和当前需求字段必须拆分为独立需求账本",
    );
  }

  if (document.document_type !== "requirement") {
    addIssue(issues, "invalid-document-type", "document_type", "文档类型必须为 requirement");
  }
  if (!hasText(document.编号)) {
    addIssue(issues, "missing-requirement-id", "编号", "需求编号不能为空");
  }
  if (!Number.isInteger(document.revision) || document.revision < 1) {
    addIssue(issues, "invalid-revision", "revision", "revision 必须是大于 0 的整数");
  }
  if (!hasText(document.updated_at) || !hasText(document.updated_by)) {
    addIssue(issues, "missing-update-metadata", "updated_at", "必须记录 updated_at 和 updated_by");
  }
  if (
    document.change_id !== null &&
    document.change_id !== undefined &&
    !hasText(document.change_id)
  ) {
    addIssue(issues, "invalid-change-id", "change_id", "change_id 必须是非空字符串或 null");
  }

  validateEnum(issues, document.流程状态, WORKFLOW_STATUS_VALUES, "invalid-workflow-status", "流程状态", "流程状态");
  validateEnum(issues, document.交付状态, DELIVERY_STATUS_VALUES, "invalid-delivery-status", "交付状态", "交付状态");
  if (document.交付状态 === "verified" && !hasCompletedTaskMapping(document)) {
    addIssue(issues, "incomplete-task-mapping", "任务映射", "进入 verified 前所有已登记 task 必须完成");
  }
  if (document.交付状态 !== "not-started" &&
    !hasApprovedProposal(document)
  ) {
    addIssue(
      issues,
      "missing-proposal-confirmation",
      "用户决策",
      "进入实施后必须保留用户已确认需求方案的记录",
    );
  }
  if (document.交付状态 === "coding" && !hasApprovedImplementationStart(document)) {
    addIssue(
      issues,
      "missing-implementation-start-approval",
      "用户决策",
      "交付状态为 coding 时必须记录用户已批准 implementation-start",
    );
  }

  if (!hasText(document.当前意图)) {
    addIssue(issues, "missing-current-intent", "当前意图", "当前意图不能为空");
  }
  if (
    document.推荐动作 !== null &&
    document.推荐动作 !== undefined &&
    !ACTION_VALUES.has(document.推荐动作)
  ) {
    addIssue(issues, "invalid-recommended-action", "推荐动作", "推荐动作不是支持的原生动作");
  }
  if (
    ["coding", "verified", "reviewed"].includes(document.交付状态) &&
    ["prepare-workspace", "propose"].includes(document.推荐动作)
  ) {
    addIssue(
      issues,
      "recommended-action-stale",
      "推荐动作",
      `交付状态为 ${document.交付状态} 时推荐动作 ${document.推荐动作} 已过期，应更新为与真实状态一致的动作`,
      "warning",
    );
  }

  const collaboration = document.协作;
  if (!collaboration || typeof collaboration !== "object" || Array.isArray(collaboration)) {
    addIssue(issues, "missing-collaboration", "协作", "必须提供协作配置");
  } else {
    validateEnum(issues, collaboration.模式, COLLABORATION_MODE_VALUES, "invalid-collaboration-mode", "协作.模式", "协作模式");
    if (!hasText(collaboration.负责人)) addIssue(issues, "missing-lead", "协作.负责人", "必须指定唯一负责人");
    for (const field of ["参与人", "集成分支"]) {
      if (Object.hasOwn(collaboration, field)) addIssue(issues, "unsupported-collaboration-field", `协作.${field}`, `不再支持协作.${field}`);
    }
  }
  if (Object.hasOwn(document, "并行单元")) addIssue(issues, "unsupported-collaboration-field", "并行单元", "不再支持并行单元");

  const repositories = Array.isArray(document.仓库) ? document.仓库 : [];
  if (!Array.isArray(document.仓库) || repositories.length === 0) {
    addIssue(issues, "missing-repositories", "仓库", "必须提供至少一个仓库");
  }
  const repositoryIds = new Set();
  const repositoryBranches = new Set();
  issues.push(...repositoryEvidenceIssues(document));
  const requireAllRepositories = repositories.length > 1;
  const repositoryWorktrees = new Set();
  for (const [index, repository] of repositories.entries()) {
    const repositoryPath = `仓库[${index}]`;
    if (!hasText(repository?.id) || repositoryIds.has(repository.id)) addIssue(issues, "duplicate-repository-id", `${repositoryPath}.id`, "仓库 id 必须非空且唯一");
    else repositoryIds.add(repository.id);
    if (!hasText(repository?.root)) addIssue(issues, "missing-repository-root", `${repositoryPath}.root`, "仓库 root 必须非空");
    if (document.交付状态 !== "not-started" && !hasText(repository?.branch)) addIssue(issues, "missing-repository-branch", `${repositoryPath}.branch`, "交付未开始前每个仓库必须配置 branch");
    if (document.交付状态 !== "not-started" && !hasText(repository?.worktree)) addIssue(issues, "missing-repository-worktree", `${repositoryPath}.worktree`, "交付未开始前每个仓库必须配置 worktree");
    if (hasText(repository?.branch) && repositoryBranches.has(repository.branch)) addIssue(issues, "duplicate-repository-branch", `${repositoryPath}.branch`, "仓库 branch 必须唯一");
    else if (hasText(repository?.branch)) repositoryBranches.add(repository.branch);
    if (hasText(repository?.worktree) && repositoryWorktrees.has(repository.worktree)) addIssue(issues, "duplicate-repository-worktree", `${repositoryPath}.worktree`, "仓库 worktree 必须唯一");
    else if (hasText(repository?.worktree)) repositoryWorktrees.add(repository.worktree);
  }

  if (requireAllRepositories && (document.交付状态 === "coding" || document.交付状态 === "verified")) {
    const evidence = document.证据索引 ?? {};
    const kind = document.交付状态 === "coding" ? "apply" : "checks";
    if (!hasSuccessfulRepositoryEvidence(evidence[kind], kind, repositoryIds)) {
      addIssue(issues, "missing-repository-evidence", `证据索引.${kind}`, `进入 ${document.交付状态} 前每个登记仓库都必须有成功的 ${kind} 证据`);
    }
  }

  if (document.流程状态 === "blocked" && (!Array.isArray(document.阻塞项) || document.阻塞项.length === 0)) {
    addIssue(issues, "missing-blocker", "阻塞项", "blocked 流程必须记录阻塞项");
  }
  if (document.流程状态 === "closed") {
    const archive = document.证据索引?.archive;
    const finish = document.证据索引?.finish;
    if (!hasText(archive?.path) || !SUCCESS_OUTCOMES.has(archive?.outcome)) {
      addIssue(issues, "missing-archive-evidence", "证据索引.archive", "closed 流程必须包含归档证据");
    }
    if (!SUCCESS_OUTCOMES.has(finish?.outcome) || !FINAL_DELIVERY_STATUS_VALUES.has(finish?.result)) {
      addIssue(issues, "missing-finish-evidence", "证据索引.finish", "closed 流程必须包含收尾证据");
    }
    if (
      !FINAL_DELIVERY_STATUS_VALUES.has(document.交付状态) ||
      finish?.result !== document.交付状态
    ) {
      addIssue(issues, "closed-delivery-mismatch", "交付状态", "closed 流程的交付状态必须与 finish.result 一致");
    }
  }

  return issues;
}

export function validateProgressFile(filePath) {
  const source = readFileSync(filePath, "utf8");
  return validateProgress(parseProgressYaml(source));
}

export function validateProgressDirectory(directoryPath) {
  const files = readdirSync(directoryPath)
    .filter((name) => /\.ya?ml$/i.test(name))
    .sort();
  const entries = files.map((name) => ({
    name,
    document: parseProgressYaml(readFileSync(path.join(directoryPath, name), "utf8")),
  }));
  const issues = entries.flatMap(({ name, document }) =>
    validateProgress(document).map((issue) => ({
      ...issue,
      path: `${name}:${issue.path}`,
    })),
  );
  const branchOwners = new Map();
  const worktreeOwners = new Map();
  const activeConflictKeys = new Map();
  const identifierOwners = new Map();
  const changeOwners = new Map();
  const identifiers = new Set(
    entries.map(({ document }) => document.编号).filter(hasText),
  );
  const requirementDependencies = new Map();
  const activeScopes = [];

  for (const { name, document } of entries) {
    if (identifierOwners.has(document.编号)) addIssue(issues, "duplicate-requirement-id", name, `需求编号“${document.编号}”已被 ${identifierOwners.get(document.编号)} 使用`);
    else identifierOwners.set(document.编号, name);
    if (hasText(document.change_id)) {
      if (changeOwners.has(document.change_id)) addIssue(issues, "duplicate-change-id", name, `change_id“${document.change_id}”已被 ${changeOwners.get(document.change_id)} 使用`);
      else changeOwners.set(document.change_id, name);
    }
    const repositories = Array.isArray(document.仓库) ? document.仓库 : [];
    const branches = repositories.map((repository) => repository.branch);
    const worktrees = repositories.map((repository) => repository.worktree);
    for (const branch of branches.filter(hasText)) {
      if (branchOwners.has(branch) && branchOwners.get(branch) !== name) addIssue(issues, "duplicate-branch", name, `分支“${branch}”已被 ${branchOwners.get(branch)} 使用`);
      else branchOwners.set(branch, name);
    }
    for (const worktree of worktrees.filter(hasText)) {
      if (worktreeOwners.has(worktree) && worktreeOwners.get(worktree) !== name) addIssue(issues, "duplicate-worktree", name, `工作区“${worktree}”已被 ${worktreeOwners.get(worktree)} 使用`);
      else worktreeOwners.set(worktree, name);
    }
    requirementDependencies.set(document.编号, document.依赖需求 ?? []);
    for (const dependency of document.依赖需求 ?? []) {
      if (!identifiers.has(dependency)) addIssue(issues, "missing-requirement-dependency", name, `依赖需求“${dependency}”不存在`);
    }
    if (document.流程状态 === "active") {
      for (const key of document.冲突键 ?? []) {
        if (activeConflictKeys.has(key)) addIssue(issues, "active-conflict-key", name, `冲突键“${key}”也被 ${activeConflictKeys.get(key)} 使用`);
        else activeConflictKeys.set(key, name);
      }
      for (const scope of document.影响范围 ?? []) {
        activeScopes.push({ name, scope: normalizeScope(scope) });
      }
    }
  }
  const visitingRequirements = new Set();
  const visitedRequirements = new Set();
  const hasRequirementCycle = (id) => {
    if (visitingRequirements.has(id)) return true;
    if (visitedRequirements.has(id)) return false;
    visitingRequirements.add(id);
    for (const dependency of requirementDependencies.get(id) ?? []) {
      if (requirementDependencies.has(dependency) && hasRequirementCycle(dependency)) return true;
    }
    visitingRequirements.delete(id);
    visitedRequirements.add(id);
    return false;
  };
  if ([...requirementDependencies.keys()].some(hasRequirementCycle)) {
    addIssue(issues, "requirement-dependency-cycle", "", "需求依赖存在循环");
  }
  for (let left = 0; left < activeScopes.length; left += 1) {
    for (let right = left + 1; right < activeScopes.length; right += 1) {
      const a = activeScopes[left];
      const b = activeScopes[right];
      if (
        a.name !== b.name &&
        (a.scope === b.scope ||
          a.scope.startsWith(`${b.scope}/`) ||
          b.scope.startsWith(`${a.scope}/`))
      ) {
        addIssue(issues, "requirement-write-scope-conflict", "", `${a.name} 与 ${b.name} 的影响范围重叠`);
      }
    }
  }
  return issues;
}

function runCli(args) {
  if (args.length !== 1) {
    console.error("用法: node validate-progress.mjs <requirement.yaml|requirements-directory>");
    return 2;
  }

  try {
    const issues = statSync(args[0]).isDirectory()
      ? validateProgressDirectory(args[0])
      : validateProgressFile(args[0]);
    if (issues.length === 0) {
      console.log(`OK: ${args[0]}`);
      return 0;
    }
    issues.forEach((issue) => {
      console.error(`[${issue.code}] ${issue.path}: ${issue.message}`);
    });
    return 1;
  } catch (error) {
    console.error(`无法校验 ${args[0]}: ${error.message}`);
    return 2;
  }
}

const executedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (executedPath === import.meta.url) {
  process.exitCode = runCli(process.argv.slice(2));
}

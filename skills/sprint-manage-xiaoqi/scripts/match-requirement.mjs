#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>
// match-requirement.mjs：需求相关性预检（确定性扫描，只读，不建账、不触碰账本）。
// 建账前运行：枚举候选项目（当前工作区 + 全局账本登记过的仓库），按需求关键词
// 扫描代码/文档/OpenSpec 规格/历史需求，输出证据和计数供主技能做语义判定。
// 与所有项目都无关时 no_match=true，主技能据此中断并提示，不初始化账本。

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { getRequirementsDir } from "./ledger-paths.mjs";
import { parseProgressYaml } from "./validate-progress.mjs";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".worktrees",
  "dist",
  "build",
  "target",
  "out",
  ".idea",
  ".vscode",
  "coverage",
  ".gradle",
  "__pycache__",
  "vendor",
]);
const TEXT_EXTENSIONS = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs",
  "java", "kt", "py", "rb", "go", "rs", "php", "cs", "c", "cpp", "h",
  "vue", "svelte",
  "md", "txt", "yaml", "yml", "json", "sql", "xml", "html", "css", "scss",
  "properties", "gradle", "groovy", "toml", "cfg", "ini", "conf",
]);
// 无扩展名但通常有价值的文件名前缀
const PLAIN_FILE_ALLOW = /^(readme|makefile|changelog|contributing|notice|dockerfile)/i;
const MAX_FILE_BYTES = 512 * 1024;
const PER_FILE_HIT_CAP = 10;

function hasText(value) {
  return typeof value === "string" && value.trim() !== "";
}

function comparablePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isScannableFile(name) {
  if (name.startsWith(".")) return false;
  const extension = path.extname(name).slice(1).toLowerCase();
  if (extension === "") return PLAIN_FILE_ALLOW.test(name);
  return TEXT_EXTENSIONS.has(extension);
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index >= 0 && count < PER_FILE_HIT_CAP) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function readTextGuarded(filePath) {
  try {
    const stat = statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    const source = readFileSync(filePath, "utf8");
    // 首段出现 NUL 视为二进制，跳过
    if (source.slice(0, 1024).includes("\0")) return null;
    return source;
  } catch {
    return null;
  }
}

function scanProjectFiles(projectRoot, keywords, maxFiles) {
  let filesScanned = 0;
  let keywordHits = 0;
  const keywordFiles = new Set();
  const matchedKeywords = new Set();

  const stack = [projectRoot];
  while (stack.length > 0 && filesScanned < maxFiles) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (filesScanned >= maxFiles) break;
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name.toLowerCase())) stack.push(entryPath);
        continue;
      }
      if (!entry.isFile() || !isScannableFile(entry.name)) continue;
      filesScanned += 1;
      if (keywords.length === 0) continue;
      // 文件路径本身参与匹配（目录/文件命名线索）
      const relativePath = path
        .relative(projectRoot, entryPath)
        .replaceAll("\\", "/")
        .toLowerCase();
      for (const keyword of keywords) {
        const needle = keyword.toLowerCase();
        if (relativePath.includes(needle)) {
          keywordFiles.add(entryPath);
          matchedKeywords.add(keyword);
          keywordHits += 1;
        }
      }
      const source = readTextGuarded(entryPath);
      if (source === null) continue;
      for (const keyword of keywords) {
        const hits = countOccurrences(source.toLowerCase(), keyword.toLowerCase());
        if (hits > 0) {
          keywordHits += hits;
          keywordFiles.add(entryPath);
          matchedKeywords.add(keyword);
        }
      }
    }
  }

  return {
    files_scanned: filesScanned,
    keyword_hits: keywordHits,
    keyword_files: keywordFiles.size,
    matched_keywords: [...matchedKeywords],
  };
}

function scanOpenSpec(projectRoot, keywords) {
  let specsHits = 0;
  const specsDir = path.join(projectRoot, "openspec");
  if (!existsSync(specsDir) || keywords.length === 0) return specsHits;

  const stack = [specsDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        // change 目录名本身就是需求主题线索
        if (
          current === path.join(specsDir, "changes") &&
          keywords.some((keyword) =>
            entry.name.toLowerCase().includes(keyword.toLowerCase()),
          )
        ) {
          specsHits += 2;
        }
        stack.push(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      for (const keyword of keywords) {
        if (entry.name.toLowerCase().includes(keyword.toLowerCase())) specsHits += 1;
      }
      const source = readTextGuarded(entryPath);
      if (source === null) continue;
      for (const keyword of keywords) {
        specsHits += countOccurrences(source.toLowerCase(), keyword.toLowerCase());
      }
    }
  }
  return specsHits;
}

function historyHitsFor(requirementsDir, candidateRoot, requirementId, keywords) {
  if (!existsSync(requirementsDir)) return 0;
  let hits = 0;
  for (const name of readdirSync(requirementsDir)) {
    if (!/\.ya?ml$/i.test(name)) continue;
    try {
      const document = parseProgressYaml(
        readFileSync(path.join(requirementsDir, name), "utf8"),
      );
      const roots = (document.仓库 ?? [])
        .filter((repository) => path.isAbsolute(repository?.root ?? ""))
        .map((repository) => comparablePath(repository.root));
      if (!roots.includes(comparablePath(candidateRoot))) continue;
      // 同编号重新提交是强信号；编号/名称/change_id 命中关键词是普通信号
      if (hasText(requirementId) && String(document.编号 ?? "") === requirementId) {
        hits += 2;
        continue;
      }
      const haystack = [
        String(document.编号 ?? ""),
        String(document.名称 ?? ""),
        String(document.change_id ?? ""),
      ].join(" ").toLowerCase();
      if (keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))) {
        hits += 1;
      }
    } catch {
      // 无法解析的历史账本跳过
    }
  }
  return hits;
}

function collectCandidateRoots(projectRoot, requirementsDir) {
  const roots = new Map();
  const current = path.resolve(projectRoot);
  roots.set(comparablePath(current), current);
  if (existsSync(requirementsDir)) {
    for (const name of readdirSync(requirementsDir)) {
      if (!/\.ya?ml$/i.test(name)) continue;
      try {
        const document = parseProgressYaml(
          readFileSync(path.join(requirementsDir, name), "utf8"),
        );
        for (const repository of document.仓库 ?? []) {
          // 相对 root 无法定位项目，只收录绝对路径条目
          if (!path.isAbsolute(repository?.root ?? "")) continue;
          const key = comparablePath(repository.root);
          if (!roots.has(key)) roots.set(key, path.resolve(repository.root));
        }
      } catch {
        // 无法解析的历史账本跳过
      }
    }
  }
  return [...roots.values()];
}

export function matchRequirement(
  projectRoot,
  keywords = [],
  options = {},
) {
  const {
    requirementId = null,
    maxFiles = 2000,
    requirementsDir = getRequirementsDir(projectRoot),
  } = options;
  const normalizedKeywords = (Array.isArray(keywords) ? keywords : [keywords])
    .map((keyword) => String(keyword ?? "").trim())
    .filter(hasText);

  const candidates = [];
  for (const root of collectCandidateRoots(projectRoot, requirementsDir)) {
    if (!existsSync(root)) continue;
    const fileScan = scanProjectFiles(root, normalizedKeywords, maxFiles);
    const specsHits = scanOpenSpec(root, normalizedKeywords);
    const historyHits = historyHitsFor(
      requirementsDir,
      root,
      requirementId,
      normalizedKeywords,
    );
    const score =
      fileScan.keyword_files * 3 +
      fileScan.keyword_hits +
      specsHits * 2 +
      historyHits * 2;
    candidates.push({
      root,
      files_scanned: fileScan.files_scanned,
      keyword_hits: fileScan.keyword_hits,
      keyword_files: fileScan.keyword_files,
      matched_keywords: fileScan.matched_keywords,
      specs_hits: specsHits,
      history_hits: historyHits,
      score,
    });
  }
  candidates.sort((a, b) => b.score - a.score);

  const noMatch =
    candidates.length === 0 ||
    candidates.every(
      (candidate) =>
        candidate.keyword_files === 0 &&
        candidate.specs_hits === 0 &&
        candidate.history_hits === 0,
    );

  return {
    keywords: normalizedKeywords,
    scanned_projects: candidates.length,
    candidates,
    no_match: noMatch,
    // 语义判定（选最强/判无关）由主技能完成，本输出只提供确定性证据
    semantic_judgement: "model",
  };
}

function runCli(args) {
  const keywordsIndex = args.indexOf("--keywords");
  const requirementIndex = args.indexOf("--requirement-id");
  const maxFilesIndex = args.indexOf("--max-files");
  // 只排除真实存在的 flag 及其取值；未传的 flag（indexOf=-1）不得误伤位置参数
  const excluded = new Set(
    [keywordsIndex, requirementIndex, maxFilesIndex]
      .filter((index) => index >= 0)
      .flatMap((index) => [index, index + 1]),
  );
  const positional = args.filter((_, index) => !excluded.has(index));
  if (positional.length !== 1 || keywordsIndex < 0) {
    console.error(
      "用法: node match-requirement.mjs <project-root> --keywords \"关键词1,关键词2\" [--requirement-id <编号>] [--max-files 2000]",
    );
    return 2;
  }

  try {
    const keywords = (args[keywordsIndex + 1] ?? "")
      .split(/[,，;；]/)
      .map((keyword) => keyword.trim())
      .filter(hasText);
    if (keywords.length === 0) {
      console.error("--keywords 至少需要一个关键词");
      return 2;
    }
    const result = matchRequirement(positional[0], keywords, {
      requirementId: args[requirementIndex + 1] ?? null,
      maxFiles: Number(args[maxFilesIndex + 1] ?? 2000) || 2000,
    });
    console.log(JSON.stringify(result));
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

const executedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (executedPath === import.meta.url) {
  process.exitCode = runCli(process.argv.slice(2));
}

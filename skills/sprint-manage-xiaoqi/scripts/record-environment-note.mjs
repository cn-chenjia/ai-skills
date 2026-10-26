#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>
// record-environment-note.mjs：经用户确认后，把环境探测结论幂等写入项目级
// .xiaoqi/config.yaml 的 environmentNotes 段：键已存在则更新值与探测日期
// 注释，不存在则追加；其余配置、注释与空行原样保留，不手工整份重写。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function lineIndent(line) {
  return line.length - line.replace(/^ +/, "").length;
}

function isBlankOrComment(line) {
  const trimmed = line.trim();
  return trimmed === "" || trimmed.startsWith("#");
}

// 定位顶层 environmentNotes: 段的行区间 { start, end }：end 为下一个顶层
// 内容行下标或 lines.length；空行与注释行不终结段，也不计入内容行。
function findEnvironmentNotesSection(lines) {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isBlankOrComment(line)) continue;
    if (lineIndent(line) === 0 && line.trim() === "environmentNotes:") {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (isBlankOrComment(line)) continue;
    if (lineIndent(line) === 0) {
      end = i;
      break;
    }
  }
  return { start, end };
}

// 在段内定位已有键行（按去缩进后的键名匹配，容忍历史手写格式差异）
function findKeyLineInSection(lines, section, key) {
  for (let i = section.start + 1; i < section.end; i++) {
    const line = lines[i];
    if (isBlankOrComment(line)) continue;
    const trimmed = line.trim();
    const separator = trimmed.indexOf(":");
    if (separator < 0) continue;
    if (trimmed.slice(0, separator).trim() === key) return i;
  }
  return -1;
}

// 解析既有键行的旧值（带引号取引号内，裸值截掉行内注释），用于回显
function parseNoteValue(line) {
  const trimmed = line.trim();
  const separator = trimmed.indexOf(":");
  if (separator < 0) return null;
  const rawValue = trimmed.slice(separator + 1).trim();
  const quoted = rawValue.match(/^(['"])([\s\S]*?)\1/);
  const parsed = quoted ? quoted[2] : rawValue.split(/\s+#/)[0].trim();
  return parsed === "" ? null : parsed;
}

export function upsertEnvironmentNote(projectRoot, options) {
  const key = options?.key;
  const value = options?.value;
  const source = options?.source;
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) {
    throw new Error(`environmentNotes 键名无效（仅允许字母、数字、-、_）: ${key}`);
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("environmentNotes 值不能为空");
  }
  if (typeof source !== "string" || source.trim() === "") {
    throw new Error("必须提供来源需求编号（--source）");
  }

  const root = path.resolve(projectRoot);
  const configDir = path.join(root, ".xiaoqi");
  const configPath = path.join(configDir, "config.yaml");
  const date = options.date ?? localDate();
  const noteLine = `  ${key}: ${JSON.stringify(value)}  # ${date} 来源 ${source}`;

  const raw = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  let next;
  let action = "created";
  let previousValue = null;

  if (raw === "") {
    next = `environmentNotes:${eol}${noteLine}${eol}`;
  } else {
    const lines = raw.split(/\r?\n/);
    const section = findEnvironmentNotesSection(lines);
    if (!section) {
      let base = raw.endsWith(eol) ? raw : `${raw}${eol}`;
      if (!base.endsWith(`${eol}${eol}`)) base += eol;
      next = `${base}environmentNotes:${eol}${noteLine}${eol}`;
    } else {
      const keyLine = findKeyLineInSection(lines, section, key);
      if (keyLine >= 0) {
        action = "updated";
        previousValue = parseNoteValue(lines[keyLine]);
        lines[keyLine] = noteLine;
      } else {
        // 插在段内最后一个内容行之后，避免落到下一节的头部注释之下
        let insertAt = section.end;
        while (insertAt > section.start + 1 && isBlankOrComment(lines[insertAt - 1])) {
          insertAt--;
        }
        lines.splice(insertAt, 0, noteLine);
      }
      next = lines.join(eol);
    }
  }

  mkdirSync(configDir, { recursive: true });
  writeFileSync(configPath, next, "utf8");
  return {
    outcome: "completed",
    action,
    configPath,
    key,
    value,
    previousValue,
    date,
    source,
  };
}

function runCli(args) {
  const usage =
    '用法: node record-environment-note.mjs <project-root> --key <键> --value <值> --source <需求编号>';
  if (args.length < 1) {
    console.error(usage);
    return 2;
  }
  const projectRoot = args[0];
  const options = {};
  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    if (flag !== "--key" && flag !== "--value" && flag !== "--source") {
      console.error(`未知参数: ${flag}\n${usage}`);
      return 2;
    }
    const flagValue = args[i + 1];
    if (flagValue === undefined) {
      console.error(`${flag} 需要参数值\n${usage}`);
      return 2;
    }
    options[flag.slice(2)] = flagValue;
    i++;
  }
  if (!options.key || !options.value || !options.source) {
    console.error(`--key、--value、--source 均为必填\n${usage}`);
    return 2;
  }
  try {
    console.log(JSON.stringify(upsertEnvironmentNote(projectRoot, options)));
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

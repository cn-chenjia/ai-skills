#!/usr/bin/env node
// Author: CJ <chenjia@fehorizon.com>

const AMBIGUOUS_MARKERS = [
  "是否",
  "还是",
  "方案",
  "规则",
  "流程",
  "审批",
  "迁移",
  "权限",
  "公共接口",
  "跨模块",
  "待确认",
  "可能",
];

const HIGH_RISK_FLAGS = new Set([
  "database",
  "public-api",
  "permission",
  "production",
  "migration",
  "cross-module",
]);

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function classifyRequest(input = {}) {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  const acceptanceCriteria = asArray(input.acceptanceCriteria).filter(hasText);
  const changedFiles = asArray(input.changedFiles).filter(hasText);
  const riskFlags = asArray(input.riskFlags).map(String);
  const reasons = [];

  if (!text) reasons.push("missing-request");
  if (acceptanceCriteria.length === 0) reasons.push("missing-acceptance-criteria");
  if (changedFiles.length === 0) reasons.push("unknown-change-scope");
  if (changedFiles.length > 5) reasons.push("large-change-scope");

  const matchedMarkers = AMBIGUOUS_MARKERS.filter((marker) => text.includes(marker));
  if (matchedMarkers.length > 0) {
    reasons.push(`ambiguous-language:${matchedMarkers.join(",")}`);
  }

  const matchedRisks = riskFlags.filter((flag) => HIGH_RISK_FLAGS.has(flag));
  if (matchedRisks.length > 0) {
    reasons.push(`high-risk:${matchedRisks.join(",")}`);
  }

  return {
    status: reasons.length === 0 ? "auto-confirmed" : "needs-explore",
    skipExplore: reasons.length === 0,
    reasons,
    summary:
      reasons.length === 0
        ? "需求目标、范围和验收条件明确，可跳过 explore"
        : "需求存在歧义、范围或风险信息，需要先进行 explore",
  };
}

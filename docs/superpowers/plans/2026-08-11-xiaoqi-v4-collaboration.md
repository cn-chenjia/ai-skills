# 小七 V4 并行协作实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为小七增加需求级隔离、多人归属、并行单元和冲突检测。

**Architecture:** 每个需求独立 YAML，校验器既能校验单文件，也能扫描 requirements 目录进行跨需求检查。大型需求使用一个 OpenSpec change、一个集成分支和多个独立并行单元。

**Tech Stack:** Markdown、Node.js ESM、`node:test`、Node 文件系统

---

### Task 1: V4 失败测试

- [x] 创建 single、independent、shared-change 合法夹具。
- [x] 创建重复 branch/worktree、依赖循环、write_scope 冲突和共享账本字段夹具。
- [x] 创建目录级跨需求冲突测试。
- [x] 确认 V3 校验器按预期失败。

### Task 2: 校验器

- [x] 支持 `schema_version: 4` 的单需求文档。
- [x] 检查 revision、updated_by、协作模式和负责人。
- [x] 检查 shared-change 集成分支和并行单元。
- [x] 检查并行单元依赖和写入范围。
- [x] 目录模式检查跨需求 branch、worktree、依赖和冲突键。
- [x] 拒绝 V3 共享 `需求列表/当前需求` 文件直接写回。

### Task 3: 文档

- [x] 更新 SKILL.md 的并行启动和单写者规则。
- [x] 将状态协议改为需求独立账本。
- [x] 新增多人多需求和大型需求协作流程。
- [x] 更新对外介绍和 V3 迁移规则。

### Task 4: 验证

- [x] 运行全部测试和脚本语法检查。
- [x] 验证合法单文件、合法目录和全部非法夹具。
- [x] 扫描共享当前需求、旧单文件和并行冲突规则。
- [x] 检查链接和 Git 差异。

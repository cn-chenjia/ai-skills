# 小七运行时权限与生命周期协议

## 受控命令执行

所有由小七发起的命令，优先通过：

```bash
node skills/sprint-manage-xiaoqi/scripts/guarded-run.mjs
```

执行器提供以下项目级保护：

- 命令必须出现在显式 `allowedCommands` 白名单。
- 不使用 shell，参数按数组传递，避免命令拼接注入。
- 文件路径必须落在 `writeScopes` 声明范围内。
- 支持超时、输出大小限制和结构化退出结果。
- 结果记录 `command`、`args`、`cwd`、`exitCode`、`stdout`、`stderr` 和网络策略标记。

`XIAOQI_NETWORK=denied-by-policy` 只是项目级策略标记，不能替代操作系统网络隔离。
需要真正禁止网络、限制系统调用或限制文件访问时，必须由宿主容器、沙箱或 Agent
运行时提供强制隔离。

## 生命周期钩子

支持以下钩子：

```text
session-start
before-action
after-action
on-failure
before-close
```

调用示例：

```bash
node skills/sprint-manage-xiaoqi/scripts/lifecycle.mjs \
  before-action \
  sprint-manage/requirements/story-1001.yaml \
  payload.json \
  alice
```

规则：

- `session-start`：记录会话启动事件。
- `before-action`：阻止 blocked 或 closed 需求继续执行。
- `after-action`：要求记录动作结果。
- `on-failure`：把需求置为 blocked，并记录恢复条件。
- `before-close`：检查最终交付、archive 和 finish 证据。

所有钩子事件都写入需求账本，并通过账本锁和 revision 提交。

## Codex 可选接入

Codex Hook 不是小七的强制依赖。不接入时，小七仍可通过账本、状态推进、
证据校验和手动动作完成需求跟踪；接入后才启用自动记录、流程阻断和危险命令提醒。

项目根目录使用：

```text
.codex/config.toml
.codex/hooks.json
```

`scripts/codex-hook.mjs` 从 stdin 读取 Codex 事件，映射到小七生命周期。它会
阻断破坏性 Git/文件命令，并在工作区只有一个需求账本时自动发现该账本；多个需求
同时存在时，使用 `XIAOQI_LEDGER` 或 Hook 输入中的 `ledger` 明确指定。

如选择接入，配置完成后需要在 Codex 中执行 `/hooks`，审核并信任项目 Hook。
安装边界：

- 安装小七技能本身不会自动生成项目根目录的 `.codex/config.toml` 或
  `.codex/hooks.json`。
- 这两个文件属于宿主项目配置，不属于技能运行时文件。
- 可显式运行 `scripts/install-codex-integration.mjs .` 生成模板。
- 安装器默认不覆盖已有配置；`--force` 才会覆盖。
- Codex 权限审批、提权和系统沙箱仍由宿主控制，小七 Hook 只负责记录、流程协调
  和尽力阻断。

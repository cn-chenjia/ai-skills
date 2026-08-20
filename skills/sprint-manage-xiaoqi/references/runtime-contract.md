# 小七运行时权限与生命周期协议

## 受控命令执行

所有由小七发起的命令，优先通过：

```bash
node "<小七技能安装目录>/scripts/guarded-run.mjs"
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
node "<小七技能安装目录>/scripts/lifecycle.mjs" \
  before-action \
  sprint-manage/requirements/story-1001.yaml \
  payload.json \
  alice
```

规则：

- `session-start`：记录会话启动事件。
- `before-action`：阻止 blocked 或 closed 需求继续执行。
- `after-action`：要求记录动作结果。
- `on-failure`：记录同一错误的失败次数；普通错误前两次保持 active，第 3 次
  才置为 blocked。标记为不可重试的高风险、权限或人工确认错误立即 blocked。
- `before-close`：检查最终交付、archive 和 finish 证据。

所有钩子事件都写入需求账本，并通过账本锁和 revision 提交。

## Codex 可选接入

Codex Hook 不是小七的强制依赖。不接入时，小七仍可通过账本、状态推进、
证据校验和手动动作完成需求跟踪；接入后才启用自动记录、流程阻断和危险命令提醒。

项目级配置使用：

```text
.codex/config.toml
.codex/hooks.json
```

运行时文件位于用户目录：

```text
~/.xiaoqi/runtime/
```

运行时同时包含需求闭环所需的确定性入口：

- `initialize-requirement.mjs`：proposal 经用户确认后创建账本并记录确认人。
- `prepare-workspace.mjs`：准备需求分支和专属工作区。
- `advance-progress.mjs`：按证据推进交付状态。
- `close-requirement.mjs`：归档和收尾后写入 `closed`。

`~/.xiaoqi/runtime/codex-hook.mjs` 从 stdin 读取 Codex 事件，映射到小七生命周期。它会
阻断破坏性 Git/文件命令，并在工作区只有一个需求账本时自动发现该账本；多个需求
同时存在时，使用 `XIAOQI_LEDGER` 或 Hook 输入中的 `ledger` 明确指定。

如选择接入，配置完成后需要在 Codex 中执行 `/hooks`，审核并信任项目 Hook。
安装边界：

- 安装小七技能本身不会自动生成项目根目录的 `.codex/config.toml` 或
  `.codex/hooks.json`。
- 这两个文件属于宿主项目配置，不属于技能运行时文件。
- 可显式运行 `scripts/install-codex-integration.mjs` 安装运行文件。
- 安装器会把 Hook 运行脚本复制到用户目录下的 `~/.xiaoqi/runtime/`。
- 安装器默认不覆盖已有脚本；`--force` 才会覆盖。
- Codex 权限审批、提权和系统沙箱仍由宿主控制，小七 Hook 只负责记录、流程协调
  和尽力阻断。

## 通用工具接入

以上 Codex 配置仅用于历史兼容。当前推荐各工具自行安装和触发 Hook，再调用小七
通用入口：

```bash
node "<小七技能安装目录>/scripts/generic-hook.mjs"
```

小七不检查具体工具的 Hook 配置。初始化检查只确认通用运行时是否存在；工具侧只需
将自身事件转换为 [event-contract.md](event-contract.md) 定义的统一 JSON。

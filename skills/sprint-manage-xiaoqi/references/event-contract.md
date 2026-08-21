# 小七通用事件协议

> 本文件只提供当前动作的操作规则，不拥有会话或流程控制权。完成或中断后必须返回 `SKILL.md`，由主技能重新读取真实状态并路由。

小七将外部工具的 Hook 事件统一为一套内部事件，再交给生命周期核心处理。

## 事件格式

```json
{
  "version": 1,
  "source": "generic-json",
  "event": "before-action",
  "actor": "alice",
  "cwd": "/project",
  "ledger": "sprint-manage/requirements/story-1001.yaml",
  "action": {
    "name": "shell",
    "command": "npm test"
  }
}
```

支持的事件：

- `session-start`
- `before-action`
- `after-action`
- `stop`

`after-action` 可以携带执行结果：

```json
{
  "result": {
    "ok": false,
    "exitCode": 1,
    "error": "test failed"
  }
}
```

## 通用入口

通用 JSON 入口从 stdin 读取一条事件：

```bash
node "<小七技能安装目录>/scripts/generic-hook.mjs"
```

返回统一决策：

```json
{
  "version": 1,
  "decision": "allow"
}
```

拒绝或停止时会返回 `decision: "deny"` 或 `decision: "stop"`，并附带
`reason`。

## 适配器职责

每个外部工具只需要实现：

1. 将工具事件转换为上述格式；
2. 调用 `scripts/core/hook-runtime.mjs`；
3. 将统一决策转换回工具自己的输出格式。

Codex 适配器位于 `scripts/adapters/codex.mjs`，Trae 适配器位于
`scripts/adapters/trae.mjs`。对应的命令入口分别是：

```text
scripts/codex-hook.mjs
scripts/trae-hook.mjs
```

Codex 入口输出 Codex 的 `continue`、`stopReason` 和阻断字段；Trae 入口输出
Trae 原生的 `continue`、`stopReason` 字段。两个入口都会从 stdin 读取工具事件，
并使用退出码 `2` 表示拒绝执行。工具自己的配置文件仍由工具侧维护。

## 结果返回

完成或中断当前动作后，必须把以下结果返回主技能，由主技能重新读取真实状态并决定下一动作：

- `outcome`
- `summary`
- `evidence`
- `blockers`
- `recommended_next`

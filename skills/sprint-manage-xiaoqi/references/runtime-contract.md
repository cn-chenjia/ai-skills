# 小七运行时协议

> 本文件只提供当前动作的操作规则，不拥有会话或流程控制权。完成或中断后必须返回 `SKILL.md`，由主技能重新读取真实状态并路由。

## 运行时边界

小七运行时只提供需求账本、状态推进和证据校验所需的确定性入口：

- `initialize-requirement.mjs`：proposal 经用户确认后创建账本并记录确认人。
- `prepare-workspace.mjs`：准备需求分支和专属工作区。
- `advance-progress.mjs`：按证据推进交付状态。
- `ledger-lock.mjs`：提供账本并发写入锁。
- `record-evidence.mjs`：记录外部执行产生的证据。
- `validate-progress.mjs`：校验账本结构和状态迁移。

宿主工具负责执行测试、评审、OpenSpec 和分支收尾；小七只接收结果证据并据此推进账本。运行时不负责安装、宿主诊断或自动执行。

## 结果返回

完成或中断当前动作后，必须把以下结果返回主技能，由主技能重新读取真实状态并决定下一动作：

- `outcome`
- `summary`
- `evidence`
- `blockers`
- `recommended_next`

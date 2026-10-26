# 小七运行时协议

> 本文件只提供当前动作的操作规则，不拥有会话或流程控制权。完成或中断后必须返回 `SKILL.md`，由主技能重新读取真实状态并路由。

## 运行时边界

小七运行时只提供全局需求账本、状态推进和证据校验所需的确定性入口：

- `ledger-paths.mjs`：解析 `~/.xiaoqi/sprint-manage/` 全局账本路径，账本文件使用 `<requirement-id>-v<版本号>.yaml`。
- `initialize-requirement.mjs`：需求接纳后创建需求账本并记录接纳人；方案确认在工作区初始化和 OpenSpec artifacts 生成之后单独记录。带 `--reopen-from <已关闭账本路径>` 时变更收尾方式：生成继承证据的新版本、把原版本归档进 `archive/`，finish 证据按新收尾方式重录。带 `--autonomous` 或项目配置 `autonomy` 时建 schema v5 托管账本。
- `match-requirement.mjs`：托管需求建账前的相关性预检（只读），确定性扫描候选项目并输出证据，语义判定由主技能完成。脚本本身不区分模式；人工模式不强制预检（用户在场确认方案与仓库，本身就是相关性把关），但主技能可在用户无法明确目标仓库时调用作只读参考。
- `record-decision.mjs`：统一记录用户决策到账本（含托管自动回执 `xiaoqi-auto`，须附 reason），不推进交付状态。
- `prepare-workspace.mjs`：在 OpenSpec artifacts 生成前，为当前需求登记一个或多个仓库的分支和工作区。
- `advance-progress.mjs`：按证据推进交付状态。
- `ledger-lock.mjs`：提供全局账本并发写入锁。
- `record-evidence.mjs`：记录外部执行产生的证据。
- `record-environment-note.mjs`：经用户确认后把环境探测结论幂等写入项目 `.xiaoqi/config.yaml` 的 `environmentNotes` 段（键存在则更新值与日期注释，不存在则追加；其余配置原样保留）。
- `validate-progress.mjs`：校验单个账本、全局需求目录和跨需求事实。
- `doctor.mjs`：按需环境诊断（Node、OpenSpec CLI、账本目录、技能安装、基准分支）；
  仅在主技能发现 OpenSpec 命令失败或账本读取异常时调用，不自动执行。

单人可以并行推进多个需求；单个需求可以登记多个仓库。运行时以需求编号和仓库条目定位事实，不创建、不读取 `session.yaml`。

## 环境知识沉淀

runtime 探针获得的环境稳定事实（网关前缀、环境域名、表结构等）沉淀在项目级
`.xiaoqi/config.yaml` 的 `environmentNotes` 段，跨会话复用，避免重复探测：

- **读取**：接口验证、DB 探针前先读 `environmentNotes`，命中即直接使用；
  未命中才发起探测，禁止对已知结论重新试错。
- **写入**：探测得到稳定结论后，须获用户确认后统一通过
  `record-environment-note.mjs` 幂等合并写入——键已存在则更新值与探测日期
  注释，不存在则追加 `environmentNotes:` 段，其余键与注释原样保留；值格式
  遵循二级缩进 `key: "value"  # 探测日期与来源`。不得手工编辑该文件落
  探测结论。
- 每条记录以注释标注探测日期与来源需求，过期结论由用户决定更新或删除，
  不静默覆盖。
- 脚本层读取入口为 `prepare-workspace.mjs` 导出的 `readEnvironmentNotes(projectRoot)`
  （嵌套段解析；空段视为未配置返回 null）；写入入口为
  `record-environment-note.mjs`（幂等合并，其余配置原样保留）。

宿主工具负责执行编码、测试、评审、OpenSpec 和分支收尾；小七只接收结果证据并据此推进全局账本。运行时不负责安装、需求初始化、工作区准备或完整研发流程自动执行。自动化推进器若被调用，只能处理已初始化且已登记工作区的账本证据门禁，不能替代主技能协调上述动作。

## 结果返回

完成或中断当前动作后，必须把以下结果返回主技能，由主技能重新读取真实状态并决定下一动作：

- `outcome`
- `summary`
- `evidence`
- `blockers`
- `recommended_next`

# sprint-manage-xiaoqi 技能优化方案

> 版本：v4（2026-09-02，评审修正）
> 证据来源：story-69219（GDMS消费海外物流订单派车MQ信息）完整会话复盘；
> story-69176（设备退场入库工单调整）完整会话复盘（v2 新增，P7-P10）；
> story-69424（设备在租盘点增加客户联系方式）完整会话复盘（v3 新增：P3 GREEN 基线、P9 复现升级、P11-P12 新增）
> 基线性质：三会话均为真实生产环境运行记录，摩擦点构成 RED 阶段失败证据（优于模拟压力测试）
> v4 修正：逐项对照技能源码（advance-progress.mjs、prepare-workspace.mjs、close-requirement.mjs、validate-progress.mjs）与全部参考文档核查后修正 6 处实施风险——P1 速查表两处误差、P5 落点重定位、P7 前置假设待验证、P8 取值定死 null、P9 补实施设计、P11 落点重定位；另附 P2/P14 核查结论与批次调整
> 状态：评审修正已纳入（v4），未实施（遵守 writing-skills 铁律：无失败测试不动技能文件）

## 一、优化项总览

| # | 优化项 | 失败证据（三会话累计） | 失败类型 | 优先级 |
| --- | --- | --- | --- | --- |
| P1 | 证据 JSON schema 前置暴露 | 字段名试错 3 次（action→type→kind），check/finish 各补 1 次字段 | 产出形状错误 | 高 |
| P2 | baseBranch 默认值继承 | prepare-workspace 首次失败回滚工作区 | 阻塞启动 | 高 |
| P3 | 合并指令的倒序门禁提示 | verified 直达 merged 被拦截，事后补 review/verify 证据 | 流程顺序违规（被正确拦截） | 高（69424 已自然做对，GREEN 基线确立） |
| P4 | 人工验证证据语义 | check 证据 command 字段填描述文字而非真实命令 | 语义失真 | 中 |
| P5 | PowerShell 命令兼容 | heredoc 提交失败 1 次 | 环境阻塞 | 低 |
| P6 | tasks 勾选一致性自检 | 归档前 4 项勾选意外丢失，靠人工 openspec list 发现 | 事实漂移 | 中 |
| P7 | archive 前置体检（主规格结构 + delta 场景超集） | story-69176：archive 失败 2 次（中文标题、MODIFIED 缺主规格既有场景）；story-69424：archive 失败 1 次（主规格缺英文标题，跨会话复现） | 产出形状错误 | 高 |
| P8 | close 后账本意图字段刷新 | story-69176：closed 后「当前意图/推荐动作」仍为 apply；story-69424：closed 后仍为合并前状态（复现） | 状态语义不一致 | 低 |
| P9 | 环境探针结论沉淀 | story-69176：SIT 网关前缀 /api-gdms/ 靠 fetch 404 试错 5 次才捕获；story-69424：同一前缀隔会话再次试错 5 次（同环境知识丢失的最强复现证据） | 环境知识丢失 | **高**（v3 由中上调，跨会话复现） |
| P10 | explore 复用逻辑逐行核对 | story-69176：定损树层级漏 3 层截取，返工 1 次 | 探索深度不足致返工 | 中 |
| P11 | 验证环境作为方案澄清项 | story-69219：tasks 3.2 沿用模板默认写 SIT 联调，未显式询问用户实际验证环境（SIT/MIT/UAT），靠用户回执与推断恰好一致才闭环 | 澄清维度缺失 | 中 |
| P12 | explore 复用链路完整性自检（查询侧特判检索） | story-69424：初版方案未发现 buildExtFields 已有「G_803 待办不返回联系人」过滤分支，方案评审被用户纠偏后返工（回滚 30 行 + 重做，本次会话返工成本最大） | 探索方向缺失致返工 | **高**（v3 新增） |
| P13 | 收尾远端对账 + DB 枚举存储值核对 | story-69424：push rejected 1 次（用户已在会话外自推，未先对账）；SIT 查询用 job_type='G_803' 查无数据误判「需造数」，实际库内存 '803'，导致初版验证设计基于错误前提 | 环境事实误判 | 中（v3 新增） |
| P14 | 文档示例路径基准统一 | story-69424：state-contract.md L112-L120 共 4 处示例用相对路径 `node scripts/xxx.mjs`（假设 cwd=技能目录，实际 cwd=项目目录），照抄必失败；同会话 16+ 次脚本调用全靠主技能临场换算绝对路径而非文档指导 | 文档示例不可执行（隐性摩擦） | 中（v3 新增） |

## 二、逐项方案

### P1：证据 JSON schema 前置暴露（高）

**基线失败**：主技能生成 apply 证据时字段名 `action`（错误）→ 改 `type`（仍错）→ 读 `advance-progress.mjs` 源码才确认是 `kind`；check 证据缺 `commit`、finish 证据缺 `outcome`，各返工 1 次。共 5 次无效调用。story-69176 会话同型失败再次出现：check 证据缺 `commit/checked_at`、review 证据缺 `commit/result`、finish 证据缺 `commit`，各返工 1 次（3 次无效调用），跨会话复现确认该问题与具体需求无关。

**根因**：证据 schema 只存在于脚本源码 `EVIDENCE_SCHEMA` 常量中，技能文档（state-contract.md / step-details.md）只给了数据结构示例，未给"各 kind 必需字段清单"。主技能每次都要靠报错试错或读源码。

**修改方案**（两处，互补）：

1. `scripts/advance-progress.mjs`：支持 `--schema <kind>` 参数，输出该 kind 的必需字段 JSON 模板到 stdout 后退出（纯只读，无副作用）。模板直接生成自脚本内 `EVIDENCE_SCHEMA` 常量（单一事实源）；速查表写入文档时以 `--schema` 输出核对，防止再次漂移。
2. `references/state-contract.md` 校验与原子更新节：新增"证据字段速查表"：

```markdown
| kind | 必需字段 | 成功值约束 |
| --- | --- | --- |
| apply | kind, command, exit_code, checked_at, summary | exit_code=0（commit 可选，未填时脚本自动回填当前 HEAD） |
| check | kind, command, exit_code, commit, checked_at, summary | exit_code=0 |
| review | 同 check + result | result=approved |
| openspec-verify | 同 check + result | result=passed |
| finish | 同 check + result + outcome | result∈{pr-open,merged,kept} 且必须等于目标交付状态；outcome∈{passed,completed,archived} |
| archive | kind, command, exit_code, checked_at, summary, path, outcome | outcome∈{passed,completed,archived}，path 非空 |
```

表下补 apply 的 TDD 复合校验说明（v4 修正：初版遗漏，恰是 apply 证据最容易踩的坑）：

```markdown
apply 证据附带 TDD 声明时的复合校验：
- tdd.enabled: true → 必须包含有效 red（exit_code=1、result=failed）与 green（exit_code=0、result=passed）阶段，refactor 可选但必须 passed；
- tdd.enabled: false → 必须提供 tdd.reason 豁免原因；
- tdd_tasks 数组逐项同样受上述豁免留痕约束（task_id 非空，关闭 TDD 须留 reason）。
```

**验证计划（GREEN）**：新会话模拟"推进 coding"任务，观察主技能是否一次生成合法 apply 证据（无字段报错）。对照本次 5 次试错即为基线。

### P2：baseBranch 默认值继承（高）

**基线失败**：`prepare-workspace.mjs` 因未配置 baseBranch 报 `BASE_BRANCH_REQUIRED` 并回滚已建工作区与分支；候选提示只有 main/fat（脚本默认扫描），而真实项目用 develop，最终靠参照历史账本（story-69176/69424 均为 develop）人工填写。

**根因**：`initialize-requirement.mjs` 不写 baseBranch，`prepare-workspace.mjs` 的候选推导未包含"当前检出的本地分支"与"同仓库历史账本的 baseBranch"。

**修改方案**（脚本层）：

`prepare-workspace.mjs` 的 baseBranch 候选推导顺序调整为：

1. 账本仓库条目 `baseBranch`（现状保留）；
2. 同仓库历史账本（`~/.xiaoqi/sprint-manage/*.yaml` 中 `仓库.root` 相同条目）的 baseBranch 众数；
3. 仓库当前 HEAD 分支（git rev-parse --abbrev-ref HEAD）；
4. 兜底 main/fat 候选列表。

`references/step-details.md` 工作区准备节补充一句：脚本会按上述顺序继承基线分支，仍不确定时才询问用户。

**验证计划**：在 gdms-center（当前 develop、历史账本 baseBranch=develop）上初始化新需求，观察 prepare-workspace 是否直接成功且 baseBranch=develop，无回滚。

**v4 核查补充**：报错路径的候选列表其实已包含全部本地分支（`detectDefaultBaseBranch` 在无基线时枚举 refs/heads 全量，见 prepare-workspace.mjs L127-L138），真正缺的是**优先级排序与自动采用**，而非候选缺失。故第 2/3 条推导即可消除用户交互；实现时无需改动候选枚举逻辑，改动面更小。

### P3：合并指令的倒序门禁提示（高）

**基线失败**：用户在交付状态 `coding` 时指令"先合到 develop"，主技能直接执行合并并推送；到收尾阶段 `verified→merged` 被状态机拦截（invalid-delivery-transition），被迫事后补 review 证据 + AskUserQuestion 确认。真实合并发生在门禁满足之前，账本与物理事实出现时序错位。

**根因**：主技能路由表未覆盖"用户提前要求合并/推送"这一高频场景；closing.md 只约束到达 `ready` 后的选择，不约束 `ready` 前的合并指令。

**修改方案**（形式：条件化规则，非泛禁令）：

`SKILL.md` 路由表新增一行，并在 `references/step-details.md` 新增小节「提前合并/推送指令」：

```markdown
用户在交付状态 ready 之前要求合并分支或推送远程时：
- 若检查/评审门禁未满足：先执行 git 合并/推送（尊重用户对仓库的处置权），
  但必须在账本事件日志立即记录 kind: early-merge，注明"门禁后置"，
  并明确告知用户：收尾推进 verified→merged 前仍需补 check/review/openspec-verify 证据，
  门禁不可豁免、不可伪造。
- 禁止把 early-merge 事件当作 finish 证据使用。
```

**验证计划**：压力场景——新会话在 coding 状态下达"合并到 develop"指令，观察主技能是否（a）执行合并（b）同步记录 early-merge（c）明确告知后置门禁（d）收尾时仍要求补证而非伪造。

**GREEN 基线（story-69424，2026-09-02）**：本方案设计的全部四个行为点已在一个真实会话中自然达成——用户在 coding 状态指令"先合到 develop"时，主技能（a）执行了 merge（f6523222c0）（b）在账本事件日志记录 `user-merge-decision` 事件（语义等价 early-merge，注明"验证 Task 2.2 未完成，提前合并便于 SIT 部署联调"）（c）明确告知用户"交付状态保持 coding，验证完成后继续推进"（d）收尾时完整补齐 check（SIT 接口复验）→ review（用户批准走查）→ openspec-verify（strict 校验）证据后才推进 merged，全程未被状态机拦截，无任何伪造。该会话即 P3 的 GREEN 基线；实施时仅剩两件小事：①把事件名统一为 `early-merge`（本次用了自定义名 `user-merge-decision`，语义同）；②把该行为从"自然做对"固化为规则文本，防止退化。

### P4：人工验证证据语义（中）

**基线失败**：SIT 联调由用户人工确认，check 证据的 `command` 字段填的是"SIT 联调验证（用户确认通过）"描述文字而非可执行命令，exit_code 也为人工填写。账本证据失去"可复现"语义。

**修改方案**：

`advance-progress.mjs` 的 `EVIDENCE_SCHEMA.check` 增加可选字段 `manual`（boolean）。`manual: true` 时：
- `command` 允许描述文字（校验放宽为非空）；
- 必需字段追加 `confirmed_by`（人工确认人）；
- 脚本将证据落库时标注 `manual: true`，区别于命令行执行证据。

`references/state-contract.md` 证据速查表同步标注。

**验证计划**：模拟人工验证场景提交 manual check 证据，校验通过且证据落库含 manual 标记；原命令行证据路径行为不变（回归）。

**v3 补充（story-69424 正向证据）**：本次会话在收到用户「已联调通过」后，主技能未直接采信口头结论，而是用 Chrome DevTools 在 SIT 登录态下自行复验接口（18 条 G_803 待办、linkman 字段三段式返回）并以其作为 check 证据主体，人工确认仅作为补充。manual 语义之外应新增一条优先级规则：**条件允许时优先自行复验接口取证（登录态 fetch / DB 查询），口头确认仅兜底**。该规则写入 `references/step-details.md` 验证节，无需脚本改动。

### P5：PowerShell 命令兼容（低）

**基线失败**：git commit 的 heredoc 写法在 PowerShell 解析失败 1 次；story-69176 会话同样出现 1 次（改单行 -m 成功），跨会话复现。

**v4 核查修正**：原方案"排查参考文档中的 `<<'EOF'` / `&&` / `||` 示例并改写"**无落点**——grep 全技能文档，这些模式在 SKILL.md 与四份参考文件中零命中（匹配项全部是脚本 JS 源码）。失败来源是主技能临场生成 bash 风格命令，而非照抄文档示例；"改现有示例"路线作废。

**修改方案**（v4 改写为正向纪律条款，落点真实）：`references/step-details.md`「apply 与模型执行」节末尾新增一条：

```markdown
Windows/PowerShell 宿主执行 git 等命令时：commit 消息一律单行 -m（禁用 heredoc）；
多命令用分号分隔（禁用 && / ||）；路径含空格时用双引号包裹。
```

**验证计划**：新会话在 PowerShell 宿主观察 git commit 是否直接使用单行 -m、多命令是否用分号分隔（对照本次 1 次解析失败）。

### P6：tasks 勾选一致性自检（中）

**基线失败**：归档时 openspec list 显示 3/7——此前 4 项已勾选的任务在多轮编辑后丢失勾选状态，靠人工核对才发现。若未发现，归档会带警告（--yes 强制通过）留下不完整事实。

**根因**：SearchReplace 多轮编辑 tasks.md 无一致性保护；归档前无自动核对环节。

**修改方案**（形式：流程结构化，在收尾检查顺序中新增必查步骤）：

`references/closing.md`「收尾检查顺序」第 1 条前插入：

```markdown
0. tasks 完整性核对：运行 `openspec list` 确认目标 change 显示 ✓ Complete；
   非 Complete 时先逐项核对 tasks.md 勾选与已交付事实一致，修复后再进入归档；
   勾选状态不得为凑数而标记，须有对应交付证据。
```

**验证计划**：压力场景——归档前人为破坏勾选状态，观察主技能是否在归档前发现并核对修复，而非带警告强推。

### P7：archive 前置体检（主规格结构 + delta 场景超集）（高，story-69176）

**基线失败**：`openspec archive --yes` 连续失败 2 次——①主规格「设备退场入库工单规范」使用中文标题（`## 需求`/`## 目的`），需求条目对解析器不可见（18 个 Requirement 全部报 outside section）；②MODIFIED 块基于建账时的主规格快照编写，归档时主规格已被其他需求更新（新增「非库存仓库类型网点关联临时仓触发照片继承」等场景），MODIFIED 缺少主规格既有场景被拒（避免丢场景的正确拦截）。closing.md 已记载这两类坑，但属于"事后翻"而非"事前查"。

**根因**：closing.md 的「archive 失败的常见原因」是故障排除参考，主技能在执行 archive 前没有主动预检步骤；MODIFIED delta 与主规格漂移没有合并提醒机制（长期 change 跨多天时主规格会被并行需求更新）。

**修改方案**（流程结构化，closing.md「收尾检查顺序」在 P6 的第 0 条后插入第 0.5 条）：

```markdown
0.5 archive 预检：先跑一次不带 --yes 的 `openspec archive <change> --json`，
    根据返回的 status（无需真实归档）预判三类问题：
    a. 主规格标题非英文（## Requirements/## Purpose）→ 先修复主规格标题再重试；
    b. MODIFIED 场景超集校验失败 → 把主规格当前完整需求块复制进 delta，
       在其上叠加本次变更（禁止直接丢弃主规格既有场景）；
    c. change 未 Complete → 回到第 0 条勾选核对。
    修复后带 --yes 正式归档。
```

**v4 前置确认（实施第一步，未验证不写规则）**：方案假设 `openspec archive <change> --json`（不带 --yes）是非交互式、返回可靠 JSON 的预检入口——该 CLI 行为未经验证。实施前先在真实项目空跑确认：①不带 --yes 时是否仍交互式询问确认（预检不能卡住）；②JSON 输出是否含可判读的 status/错误明细。若任一不满足，预检降级为 `openspec validate <change> --type change --strict --json` + 人工核对主规格标题，规则文本按实际 CLI 行为书写。

**验证计划**：构造中文标题主规格 + 陈旧 delta 的 change，观察主技能是否在正式归档前经预检发现并修复，一次 `--yes` 成功（对照本次 2 次失败）。

### P8：close 后账本意图字段刷新（低，story-69176）

**基线失败**：`close-requirement.mjs` 关闭需求后，账本「当前意图」仍为"逐任务实施 OpenSpec tasks"、"推荐动作"仍为 `apply`，与 `流程状态: closed` 语义矛盾；续接会话读账本需靠流程状态字段纠偏。

**根因**：close 脚本只追加 closed 事件与校验证据，不更新意图/推荐动作两个字段。

**修改方案**：`close-requirement.mjs` 成功关闭时将「当前意图」置为"需求已关闭"、「推荐动作」置为 **null**（v4 取值定死：validate-progress.mjs 的 `ACTION_VALUES` 枚举不含 "none"，字符串 "none" 会触发 error 级 `invalid-recommended-action` 并阻断账本写入；null 被校验逻辑显式放行，是唯一合法终值）；state-contract.md 数据结构示例同步说明关闭后这两个字段的终态。

**验证计划**：关闭一个测试需求后读取账本，确认两字段为终态语义；已 closed 的旧账本读取不受影响（向后兼容，仅新增写入行为）。

### P9：环境探针结论沉淀（中，story-69176）

**基线失败**：SIT 接口验证时用页面同源路径 `/api/gdms/...` fetch 得 404，随后盲试 4 个猜测网关前缀全部失败，最终靠 reload 页面抓 network 请求才拿到真实前缀 `/api-gdms/`。共 5 次无效探测，且该结论只存在于本会话上下文，下次会话（哪怕同一项目）仍要从零探索。

**v3 复现证据（story-69424，优先级由中上调为高）**：story-69176 会话（2026-09-02 上午）刚以 5 次试错捕获 `/api-gdms/` 前缀；同一环境（gdms-center + sit-hxjf）在 story-69424 会话（同日晚些）再次以同样路径从零试错：同源 404 → 盲试 4 个候选前缀全 404 → list_network_requests 抓真实请求才命中，**又是 5 次无效探测**。同一环境、同一天、两个会话，同一知识点零复用——这是 environmentNotes 缺失代价的最直接证明，故优先级上调为高，并建议纳入批次2 提前实施。

**根因**：runtime 探针得到的环境事实（网关前缀、环境域名、待办表结构等）没有沉淀位置，runtime-contract.md 只定义边界不定义知识库。

**修改方案**：项目级配置 `e:\Projects\gdms-center\.xiaoqi\config.yaml`（已存在的 baseBranch 位置）新增可选 `environmentNotes` 段，主技能在探针获得稳定结论后写入（幂等合并，需用户确认后落盘）；`references/runtime-contract.md` 增加一句：环境探针结论（网关前缀/域名/表结构等稳定事实）应询问用户后写入项目 config 的 environmentNotes，下次优先读取，避免重复探测。

```yaml
environmentNotes:
  sitApiPrefix: "/api-gdms"          # SIT 网关前缀（2026-09-02 story-69176 探测）
  sitGatewayHost: "sit-hxjf.hongxinshop.com"
```

**v4 实施设计补充（原方案空白）**：`environmentNotes` 是嵌套结构，而现有读取方 `prepare-workspace.mjs` 的 `readProjectConfig()`（L84-L102）是手写**平面**解析器，只认一层 `key: value`，读不出二级子键；写入机制原文亦未定义。落地需明确三件事：

1. **解析器扩展**：`readProjectConfig` 支持解析 `environmentNotes:` 下的二级 `key: value`，返回嵌套对象（维持无依赖手写解析风格，与账本 YAML 解析同哲学，不引入 yaml 库）；
2. **写入机制**：不新增脚本。主技能在探针结论获用户确认后，直接编辑 `.xiaoqi/config.yaml` 幂等合并（键已存在则更新值与探测日期注释，不存在则追加 `environmentNotes:` 段）；
3. **读取时机**：runtime-contract.md 写明"接口验证前先读 environmentNotes，命中即直接使用；未命中才发起探测，探测成功后按第 2 条回写"。

**验证计划**：新会话在 gdms-center 做接口验证，观察主技能是否直接读取 environmentNotes 中的前缀发起首次请求即成功（对照本次 5 次试错）。

### P10：explore 复用逻辑逐行核对（中，story-69176）

**基线失败**：需求2 出库定损树组装复用 `convertLossTree`，但原 `addLossAssessmentInfo` 消费侧有 `get(0).getChildren().get(0).getChildren().get(0)` 三层截取（剥离根节点和拍照子部位节点，只留最终选中定损节点），首次 codegraph 输出中其实包含该行但未被记录进方案；实现时直接 `get(0)` 返回了完整路径树，用户在 SIT 验证时发现层级多了一层，走 systematic-debugging 定位后修复（commit b096760fcb 返工 1 次）。

**根因**：explore 阶段对"参考实现"的采集偏向方法签名与主流程，未逐行核对关键取值表达式；step-details.md 无对应纪律条款。

**修改方案**：`references/step-details.md` explore/简单路径执行要求新增一条：

```markdown
复用现有组装/取值逻辑时，MUST 逐行核对参考实现的取值表达式
（下标、层级截取、空保护），并在 design.md 中原样记录关键行；
禁止只按方法语义推断输出形状。
```

**验证计划**：新需求中复用带层级截取的既有逻辑（如定损树消费侧），观察 design.md 是否包含取值层级说明、实现是否一次通过 SIT 验证（对照本次 1 次返工）。

### P11：验证环境作为方案澄清项（中，story-69219）

**基线失败**：需求涉及环境联调验证（tasks 3.2），生成 tasks.md 时沿用了模板惯例（story-69424 的任务模板写 SIT），未显式询问用户实际将在哪个环境验证。用户回复「已 SIT 联调验证完」恰与推断一致才闭环；若实际在 MIT/UAT 验证，将出现 tasks 验收条件环境 ≠ 实际验证环境、check 证据描述失真、账本事实被污染的三重失真。

**根因**：方案澄清问答只覆盖了消息契约与业务逻辑维度（4 问），未把「验证环境」列为澄清维度；模板惯性替代了事实确认。主技能仅从 MCP 配置（gdms_sit/mit/uat + graylog-sit）做了惯例推断，推断 ≠ 事实。

**v4 落点修正**：step-details.md 并无「propose/澄清要求」小节（澄清职责属 openspec-explore 技能内部流程，小七是薄总控、不复制内部工具流程），原方案落点不存在。改落两处：

1. `references/step-details.md`「简单路径」执行要求末尾新增一条（纪律条款本体）：

```markdown
需求涉及环境联调验证时，澄清问答 MUST 包含「验证环境」
（SIT/MIT/UAT/PRO 等实际可用环境），tasks 验收条件按用户选择的环境书写；
禁止沿用模板或历史需求的默认环境值。
```

2. `SKILL.md` 路由表 explore 行的「需调用的能力面」列追加"验证环境澄清"，作为路由提示锚点。

**验证计划**：新需求的澄清阶段观察主技能是否主动询问验证环境；tasks.md 验收条件环境与用户答复一致（对照本次"未问、恰好一致"的侥幸闭环）。

### P12：explore 复用链路完整性自检——查询侧特判检索（高，story-69424）

**基线失败**：需求「设备在租盘点（G_803）待办列表增加客户联系人」。初版 explore 只检索了创建侧（`RentalInventoryCheckCreateServiceImpl` 写入联系人、`SoBacklogExtBuildForTboxKcdsc/Wn` 构建器、DTO 字段），未检索**查询侧对目标工单类型的既有特判**——`SoBacklogServiceImpl.buildExtFields` 里明确写着「G_803待办不返回联系人」过滤分支（注释原文，story-68490 时代为满足"自动生成的单子联系人字段不要"而加）。初版方案因此走向「新增 DTO 字段 + handlePageRecords 查 on_site 联系人」（+30 行）；用户方案评审一句「按理说逻辑应该同 G_802」纠偏后，修正为删除过滤分支（净 -5 行），回滚 30 行初版代码并重做 OpenSpec 四工件。

**根因**：explore 检索沿"数据从哪来"单向展开，漏了"数据在哪被挡住"的反向视角；需求语义是「恢复/对齐既有行为」类（同 G_802）时尤甚——此类需求的实现点往往就是一处既有开关/过滤，而不是新增逻辑。step-details.md 无对应检索纪律。

**修改方案**：`references/step-details.md` explore/简单路径执行要求新增一条：

```markdown
涉及工单类型展示行为的需求，explore MUST 检索目标类型编码在查询/组装/过滤
链路的既有特判分支（grep 类型编码 in 查询侧 Service：过滤、跳过、特殊分支、
含"不要/跳过/不返回"注释的代码行）；发现"参考 XX 工单/逻辑同 XX"类需求语义时，
优先 diff 目标类型与参考类型的分支差异，确认差异点即实现点。
```

**验证计划**：新会话中做「XX 工单增加/对齐某展示字段」类需求，观察 explore 是否先找到查询侧特判分支、design.md 是否记录「删除/保留该分支」决策；对照本次初版未检索导致的整套方案返工。

### P13：收尾远端对账 + DB 枚举存储值核对（中，story-69424）

**基线失败（两个独立事实误判）**：

1. **push 前未对账**：收尾推送 develop 被 rejected（non-fast-forward）。fetch 后 `branch -r --contains 159188cdda` 才发现用户已在会话外自行推送——真实状态是「远端已包含本次提交、本地仅落后他人 3 个提交」，`git pull --ff-only` 即完成同步。浪费 1 次 rejected + 1 次 fetch + 2 次 log 核对。
2. **DB 枚举存储值误判**：初版验证用 `job_type='G_803'` 查 SIT 得 0 行，误判「SIT 无 G_803 数据，需造数」并写入方案（Task 3.2 需造数据）；方案修正阶段才发现库内实际存的是数字字符串 `'803'`（SoJobType.getCode() 的返回形态），`so_backlog_ext` 里 G_803 的 linkman 数据**一直都在**。初版验证设计因此建立在一个错误前提上。

**根因**：①推送动作默认「本地领先」，没有先 fetch 对账的习惯性步骤；②DB 探针用枚举常量名直觉拼查询条件，未先核对表内实际存储形态（`SELECT DISTINCT job_type ... LIMIT` 一步即可确认）。

**修改方案**（两处，均为流程纪律，无脚本改动）：

1. `references/closing.md` 分支收尾节新增：

```markdown
push 前先 fetch 并对账：git branch -r --contains <需求 HEAD 提交> 确认远端
是否已包含本次改动（用户可能已在会话外推送）；远端已包含时改走 pull 同步，
本地领先才推送。禁止不做对账直接 push 导致 rejected 摩擦。
```

2. `references/step-details.md` explore 数据探针要求新增：

```markdown
用枚举/类型值查询 DB 前，MUST 先 SELECT DISTINCT 该列确认实际存储形态
（如 G_803 vs 803、带前缀 vs 裸数字），查无数据时先怀疑查询值形态而非
断言"无数据需造数"。
```

**验证计划**：新会话收尾时观察 push 前是否先对账（用户自推场景不再 rejected）；explore 涉及 DB 验证时观察是否先 DISTINCT 核对存储形态（不再出现「无数据」误判）。

### P14：文档示例路径基准统一（中，story-69424）

**基线失败**：`references/state-contract.md`「校验与原子更新」节的 4 处命令示例使用相对路径：

```bash
node scripts/validate-progress.mjs ...     # L112、L115
node scripts/ledger-lock.mjs acquire ...   # L118
node scripts/ledger-lock.mjs commit ...    # L120
```

该写法假设 cwd 为技能安装目录，但实际执行时 cwd 是项目根目录（如 e:\Projects\gdms-center），照抄必然 `No such file`。同文档 L142（首次建账节）已用正确占位符写法 `node "<小七技能安装目录>/scripts/initialize-requirement.mjs"`，closing.md L56 用裸引用 `scripts/close-requirement.mjs`——三种写法并存。story-69424 会话 16+ 次脚本调用全部依赖主技能加载 Skill Path 后临场换算绝对路径，文档指导为空转。

**根因**：示例命令编写时以技能目录为隐含 cwd，未对齐真实执行环境（项目目录）；同文档内两处写法未互相校对。

**修改方案**：统一为占位符写法（跨机器可移植，Skill Path 每次加载时已知）：

```bash
node "<小七技能安装目录>/scripts/validate-progress.mjs" ...
```

修正点：
1. `references/state-contract.md` L112/L115/L118/L120 共 4 处命令示例；
2. `references/closing.md` L56 裸引用同步补占位符全称；
3. ~~全技能文档 grep `scripts/` 复查其余引用~~（v4 已完成复查：全技能 `scripts/` 引用共 5 处，即上述 4 处 + closing.md L56；L142 已是正确占位符写法，SKILL.md、step-details.md、runtime-contract.md 均无脚本路径引用，无额外修正点）。

**验证计划（RED→GREEN）**：RED——新会话严格照抄文档示例命令执行，确认失败（No such file）；GREEN——修正后照抄占位符示例、按 Skill Path 替换后一次执行成功。

## 三、实施顺序与批次

| 批次 | 内容 | 理由 |
| --- | --- | --- |
| 批次1 | P1 + P2（文档速查表 + 脚本 --schema + baseBranch 继承） | 消除启动与证据两大高频摩擦（P1 已跨两会话复现），纯增益无行为风险；v4 后 P2 只需新增优先级推导，候选枚举逻辑不动，改动面更小 |
| 批次2 | P3 + P6（early-merge 规则 + 归档前勾选核对） | P3 已有 GREEN 基线（69424），实施成本最低；P6 纯流程文本；两项均低风险收尾规则，先落地见效 |
| 批次2b | P7 + P9（archive 预检 + environmentNotes 沉淀） | v4 上调实施门槛：P7 须先完成 openspec CLI 非交互 JSON 行为确认、P9 须完成 readProjectConfig 嵌套解析改造（见各项 v4 补充），确认通过后才实施；与批次2 解耦，避免前置确认阻塞已成熟的 P3/P6；P9 保留提前理由——同环境隔会话复现 2 次，代价最直观 |
| 批次3 | P4 + P5 + P8 + P11 + P14（manual 证据 + 自行复验优先规则 + PowerShell 纪律条款 + close 意图字段刷新 + 验证环境澄清 + 示例路径基准统一） | 语义增强、兼容性修补、澄清维度补齐与文档小修，回归验证即可；P5 已按 v4 改写为正向纪律条款（原文档无 heredoc 示例可改）；P14 复查已完成仅剩 5 处修正；P8 取值已定 null |
| 批次4 | P10 + P12 + P13（explore 逐行核对 + 查询侧特判检索 + 远端对账/DB 枚举核对纪律） | explore/收尾纪律沉淀；P12 为本次会话最大返工成本项，与 P10 同属探索质量但检索方向互补（P10 核对参考实现的取值表达式，P12 检索目标类型自身的特判），建议同批实施互相强化 |

每批次独立走 RED（三会话基线）→ GREEN（改后验证）→ 提交，禁止批量无验证实施。

## 四、明确不做的事

- 不改状态机迁移合法性（verified→merged 拦截是正确行为，本次靠它兜住时序错位）；
- 不因"用户口头说没问题"而跳过任何证据门禁——P3 方案只允许物理操作前置，门禁证据永不可豁免；
- 不引入 session 文件或本地需求状态副本（违反全局账本单一事实约定）。

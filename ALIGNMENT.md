# dsh-shift-router × pi-shift-router 上游对齐工作清单（待审核）

> 审核用工件。目标：从第一性原理出发，判定上游 `pi-shift-router`（本地 `../pi-shift-router`，HEAD `69ffb34` / v1.6.0）
> 自本项目派生点以来新增/修正的内容里，**哪些必须对齐、哪些必须换成 DSH 等价物、哪些明确不对齐**。
>
> 生成时间：本轮会话。证据来源：上游 `CHANGELOG.md` / `SPEC.md` / `AGENTS.md` / `src/**`，本项目 `src/**` / `tests/**` / 文档 / git 记录。

## 修订记录

**R2（维护者校正，已采纳）** — 「上游 TPS 指示器不要照搬：DSH 有原生 TPS 指示器」。
核实结论：DSH 的 `dsh-client-ui-chat` / `dsh-client-ui-trajectory` 原生渲染
`{tps} tok/s`，且口径为 `outputTokens / (decodeMs / 1000)`（**解码时间**），
比上游的「首 chunk → 消息结束」挂钟口径更准。因此：

- **A3 / A4 由「移植」改写为「删除本项目重复的 TPS 机制」**（`tokensPerSecond`、
  `recordSpeed`、speed window、`failover.speedWindowSize`、`assistant/chunk` 监听、
  相关 state 字段、`/router status` 的 tok/s 行）。判定层不该重复宿主的表现层能力，
  而且重复出来的那份更差。
- 由此 `failover.minStreamElapsedMs`（本轮一度按「配置必须可配置」铁律加的字段）取消。
- **新增决策**：移除 `orchestration.requireSmartModel`。`decisionTier` 现在如实报告
  「本轮实际跑哪一档」，编排因此在没有可解析 Smart 模型时本来就不会触发；保留该开关
  的唯一可达效果就是把 CTO 提示词注入到 Fast 层运行上——正是上游
  "CTO loop on the fast model" 那一类 bug。

**R2 顺带确认的两个事实**（影响迁移文档）：

- Schemastery 对未知键**透传不报错** ⇒ 从 schema 移除配置项对既有用户是静默安全的
  （遗留键变成惰性残留，而非加载失败）。
- DSH 的 `subagent` 工具**支持** per-call `provider`/`model`/`reasoning_effort`，但受
  宿主 `subagent-model-selection` 设置（默认关闭 + `allowedModels` 白名单）管控 ——
  这决定了 C4 的适配形态。

---

## 0. 前置结论

### 0.1 skill 版本核查（已执行）

| 位置 | 版本 | 结论 |
|---|---|---|
| 本会话加载的已安装副本 `~/.dsh/skills/dsh-plugin-dev-skill` | **0.3.0**（SKILL.md 与本地 git HEAD 逐字节相同） | = 远端**已发布**最新 |
| 本地开发检出 `~/project/dsh-plugin-dev-skill` | **0.4.0**（未提交：新增 `VERSION` + frontmatter `metadata`） | 领先远端 |
| 远端 `origin/main` 与 tags | main = 0.3.0；tags 最高 `v0.3.0`（`VERSION` 未推，`raw.githubusercontent` 404） | 落后于本地 |

0.3.0 → 0.4.0 的**全部**内容差异只有：`metadata.version` frontmatter、§0.1「载入后先检查 skill 是否最新」强制流程、一行本技能自身仓库链接。
**没有任何 API/术语/包名变化**——也就是说本轮所用的 SDK 指南内容就是当前最新内容。
本次已手工执行了 §0.1 的检查流程（本地读版本 → 取远端 → 语义化比较）。
> 待你决定：是否把 0.4.0 同步进已安装目录并推到远端（见 §4 问题 6）。

### 0.2 本项目的上游基线判定

README / ROADMAP 目前只说「the original's **v0.x** feature line maps onto our v0.x line one-to-one」，**从未钉住具体上游版本**。按证据还原：

- 本项目首个提交 `58b0cb6` 日期 **2026-08-14**；
- 上游 `v1.0.0` tag 日期同为 **2026-08-14**（task-level orchestration 落地），`v0.10.0`（cache-aware）为 08-12；
- 本项目代码里已经同时存在 cache-aware、置信度加权滑窗、cost telemetry、orchestration + 硬帽——这些对应上游 v0.9.0–v1.0.0。

**结论：本项目基线 ≈ 上游 v1.0.0（2026-08-14）。未对齐区间 = 上游 v1.0.1 → v1.6.0（共 13 个版本）。**

### 0.3 版本号策略（需你定）

本项目 `0.5.0` 是自己的发布线，上游 `1.6.0` 是另一条线。建议**不要**让数字彼此对齐，而是显式记录「对齐到的上游版本」：

- `package.json` / README 增加字段：`upstreamAligned: "pi-shift-router v1.6.0"`；
- ROADMAP 把「v0.x 一一对应」这句**删掉**（它已经失真），改为「本项目的发布线；上游对齐版本见下表」；
- 是否把本项目跳到 `1.0.0` 由你定（见 §4 问题 2）。

---

## 1. 第一性原理：哪些能搬、哪些必须重设计

### 1.1 职责边界（决定一切的第一原则）

本插件是**决策层**：读判定 → 选档 → 选模型 → 切模型 → 兜底 → 记账。它不是**表现层**，也不是**传输层**。
因此：上游凡是「把决策结果渲染给人看」的部分（pi-tui 面板、footer 状态栏、`ctx.ui.*` 交互），
**只搬语义、不搬实现**——落到 DSH 的 GUI 卡片 + `ctx.commands` 输出上。

### 1.2 Harness 机制映射表（对齐时逐项套用）

| 上游（Pi）机制 | DSH 等价物 | 本项目现状 |
|---|---|---|
| `before_agent_start`（每轮一次，需 **return** `{systemPrompt}`） | `agent/pre-step`（`step===1` 门禁）+ `agent/request`（每步可改模型） | ✅ 已适配 |
| `ctx.ui.notify` / `ui.select` / `ui.input` / `ui.custom` / `ui.setStatus` | `ctx.commands.register()` 输出 + 客户端卡片（`settings.plugin.item`） | ✅ 已适配（无状态栏，属设计取舍） |
| `pi.setModel()` | `agent/request` waterfall 返回替换后的请求配置 | ✅ 已适配 |
| pi-tui `StatusPanel` / `ChainEditor` / `ModelPicker` | React 卡片（`ShiftRouterCard.tsx`）+ `/router config get/set/unset/diff` | ✅ 已适配 |
| `message_end` / `turn_end` / `agent_end` | `session/event`（`assistant/message`、`assistant/chunk`）+ `agent/turn-stopping` | ✅ 已适配 |
| `tool_call` 返回 `{block:true}` | `tools/pre-execute` waterfall `{kind:'deny', reason}` | ✅ 更正统 |
| `tool_result` | `tools/result`（emit，只读） | ✅ 已适配 |
| `after_provider_response`（2xx 清冷却） | `session/event` 上的成功 assistant 消息 | ✅ 已适配 |
| `~/.pi/agent/*.json` 三层配置（defaults ← user ← project） | `shift-router` settings namespace + `cordis.yml` / patch overlay 层 | ✅ 已换实现，但**层级权威展示缺失**（见 D2） |
| `pi.modelRegistry`（`getAvailable`/`getProviderAuthStatus`/`getApiKeyForProvider`） | `ctx.llm.listProviders/listModels` + `ctx.llm.resolveModelInfo` | ⚠️ 部分使用；详见 D3 |
| `models.json` 自定义 provider + `expandEnv` | DSH 的 LLM 适配器/凭据体系 | ❌ 不适用 |
| `pi-subagents`：`agent:"worker"` + `context:"fresh"` + `model:"p/r:high"` + `runs.all` | `subagent` / `subagent_fork` / `workflow`；**per-call `provider`/`model` 受 `subagent-model-selection` 白名单管控** | ⚠️ 关键约束，见 C4 |
| `console.log` / 终端输出 | `ctx.logger` | ✅ 已换；文件 sink 待议（D1） |
| `pack:check` / `check:isolated` / `pi.extensions` | `dsh plugin add` + tarball 隔离安装验证 | ❌ 需另造（E4） |

### 1.3 本项目已经领先、**不要回退**的地方

1. `routing.mode` **真的接线了**（`index.ts:308-311` 早退门禁）；上游 `routing.mode` 已是 vestigial（只用于面板标题）。
2. 硬帽用 `tools/pre-execute` 原生 deny，比上游的 `tool_call` 手工 block 更符合 DSH 权限模型。
3. 用 `ctx.systemPrompt.section()` + `systemPrompt.variable()` 注入编排提示，比上游 `return {systemPrompt}` 拼接更结构化。
4. Settings namespace + GUI 卡片（上游只有 TUI wizard，没有可复用的设置面）。
5. Schemastery **加载期 range 校验**（上游 `validateConfig` 只 warn、从不阻断）。
6. `isRoutableAgent` 显式排除 subagent（`origin==='subagent'` / `delegationDepth>0`），避免路由递归；上游无此显式约束。

### 1.4 一条方法论

**对齐取「最终态」，不要逐版本重放。** 例：上游 v1.3.0 引入了 `EXPLICIT_ORCH_RE` 关键词硬闸，v1.4.2 又**完整删除**了它（因为它本身违反「LLM Judge 是唯一分类器」）。
逐版本重放会把已被上游自己否定的设计搬进来。下文每项都已按最终态给出。

---

## 2. 对齐工作清单

图例：工程量为粗估（**S** ≤ 半天 / **M** ≈ 1–2 天 / **L** ≥ 3 天）。

### P0 — 正确性缺陷（上游已修；本项目同址缺陷仍在，属真 bug）

| ID | 上游来源 | 本项目现状 | 第一性原理（为什么这是 bug） | DSH 适配 | 量 |
|---|---|---|---|---|---|
| **A1** | v1.4.2 「Judge 不可用是 HOLD，不是伪造 fast 判定」 | `judge.ts:364` 全链路失败 → `{tier:'fast', source:'fallback'}`；`router.ts` 把它当**决定性 fast** 推入窗口 | Judge 挂掉时无法证明「这是简单任务」。把「无信息」当「判 fast」会连续两次静默把 smart 会话降级。**不知道 ≠ 知道是假的** | `processRoute` 增加 hold 分支：`source==='fallback'` ⇒ 维持 `currentTier`、窗口条目标记 hold、不推进 downgrade 计数 | S |
| **A2** | v1.4.1（402/余额不足）、v1.4.3（用量上限）、v1.2.0（`unsupported_model`） | `failover.ts:143-174` 无 402、无 usage-limit 文案、无 `unsupported_model`/`model_not_found` | 兜底的全部价值在于「识别死模型并绕开」。签名不全 = 死账号/死模型被每轮重试，兜底形同不存在 | 扩 `detectFailoverError`：402 与 `insufficient balance|余额不足`、`usage limit has been reached|usage_limit_reached`、`unsupported_model|model_not_found`；402 沿用 `code.startsWith('4')` 的 16m 起跳 | S |
| **A3** | v1.4.2 「TPS = 窗口中位数」+ 丢弃 `elapsed<50ms` | `stats.ts:109-110` 取**最后一个采样** + 平均；无 50ms 门槛 | — | ❌ **R2 修正：不移植**。DSH 原生按解码时间渲染 `tok/s`，比上游挂钟口径更准；正确动作是**删除**本项目重复的 TPS 机制（见 §2 修订记录与 CHANGELOG Removed） | S |
| **A4** | v1.4.2 Bug A「吞吐回退判定按轮次而非按会话」 | 本项目根本没有回退逻辑 | — | ❌ **R2 修正：不移植**（随 A3 一并删除 TPS 机制）。病根是「用跨轮次持久窗口当单轮状态」，而该窗口本身就不该存在 | — |
| **A5** | v1.1.1 + v1.4.2 Bug B「展示同步实际运行的模型」 | 状态里 `currentProvider/Model` 是**预期**模型；UI 可能显示从未运行的模型 | 展示层必须反映事实，不能反映意图 | `session/event` 的 `assistant/message` 里读真实 provider/model 同步到展示态（**只读，不触发切换**） | S |
| **A6** | v1.4.0「严格模型权威」 | 两档解析到同一模型时不强制切换 | 用户把同一模型放进两档时，档位语义必须仍然成立（否则编排/记账的档位归属全错） | 切换判定改为「按档位最佳模型强制对齐」，仅当已一致时 `switchTo=null` | S |
| **A7** | v1.4.2「显式档位请求必须被尊重」 | Judge prompt 无「显式意图 ⇒ confidence ≥0.9」规则；`RouteDecision` 无 `decisionTier`；orchestration 判定读**原始 verdict** | 判定与切换读两个不同信号，正是上游那个著名 bug（"说用 Smart 却停在 M3"）的根因 | 见 B5；prompt 侧见 B4。**注意：本项目不存在上游那个关键词硬闸，无需删除** | M |
| **A8** | v1.4.2 B1「可重试错误的尾部要延后退出与审计」 | 轮次结束时无条件退出编排并收尾 | 在「可重试失败」上收尾 = 审一段被截断的转录，并让重试续跑脱离硬帽与记账 | 在 `agent/turn-stopping` / `agent/request-error` 上识别 failover 签名尾部：冻结标签、保持 active、冷却死模型让重试落到 fallback；健康尾部才走正常退出 | M |

### P1 — 决策核心语义对齐（EV 经济学）

| ID | 上游来源 | 本项目现状 | 第一性原理 | DSH 适配 | 量 |
|---|---|---|---|---|---|
| **B1** | v1.4.0 Expected-cost routing | `router.ts:127-163` 用**置信度加权比例** vs 阈值 | 「≥60% 的窗口条目倾向 fast」不是决策；要问的是**误降级的期望代价**。θ=1/R（R=返工代价相对价差倍数）与模型价格无关，因此规则可解释、可跨部署迁移 | 新增 `routing.economics.{reworkPenalty:3, downgradeMemory:2, mode?}`；`pSmart = c`（smart 判定）或 `1−c`（fast 判定）；`pSmart ≥ θ` 才走 smart；低于 `minConfidence` 或 judge 不可用 ⇒ hold（与 A1 合并实现）；**降级需要 `downgradeMemory` 次连续决定性 fast**，hold/smart 打断连击 | L |
| **B2** | v1.4.0 gear presets | 命令面只有 `/router orchestrate`，无档位预设；`routing.mode` 是开关语义 | 用户要的是「更省 / 均衡 / 更黏」，不是调三个耦合数字。预设把 R 收敛成一个可记忆的选择 | 新增 `/router eco(2)｜default(3)｜sport(5)`，写 `routing.economics.mode` 并**持久化**；`window.threshold` 与 `sameFamilyThreshold` 降级为 legacy（仅非默认值生效并标 ⚠） | M |
| **B3** | v1.4.0/v0.10.0 cache-aware 重构 | `router.ts:94-102` 用「抬高 downgrade 阈值到 `sameFamilyThreshold`」 | 缓存被击穿的代价应表达为**决策门槛的除数**，而不是把阈值从 0.6 抬到 0.9——后者在 EV 口径下语义不明 | 改为 `cacheAware.sameFamilyPenalty`（默认 1.5）除 θ；旧 `sameFamilyThreshold`（默认 0.9）作为 legacy ⇒ 等价 penalty 3.0；`idleBoundaryMs` 门禁已有，保留 | M |
| **B4** | v1.3.0 + v1.4.0 + v1.4.2 judge prompt 终态 | `judge.ts:29-141`：三键 `tier/confidence/reason`；无 `orchestrate`；无显式意图 ≥0.9 规则；无 doc-aware 规则 | 判定质量 = prompt 的信息量。缺 `orchestrate` 键 ⇒ 编排只能靠档位推断（错）；缺显式意图规则 ⇒ 用户明说「用 Smart」被概率覆盖 | 补第 4 键 `orchestrate`；显式档位/档位预设/编排请求要求 confidence ≥0.9 并**优先于**其它信号；文档类/批量苦工 → fast（除非真的定方向）；补 few-shot 表 | M |
| **B5** | v1.4.2 `decisionTier` | `RouteDecision` 只有 `action`（`upgrade｜downgrade｜stay｜manual`） | 「本轮实际用哪档」必须是**唯一**信号，串起切模型 / 是否编排 / 记账归属；否则各消费者各自解读原始 verdict，必然漂移 | `RouteDecision` 增加 `decisionTier`（EV 后、hold 后），`shouldOrchestrate` 与编排注入都改读它 | M |
| **B6** | v1.1.0 judge `orchestrate` 信号 | `shouldOrchestrate(config, judgeTier, smartResolvable, subagentAvailable)` —— 只按档位 | 「判 smart」和「该拆活」不是同一件事：一个大而直的任务不该编排，一个小而可并行的任务该编排 | `shouldOrchestrate` 增加 `judgeOrchestrate?: boolean`：显式 `false` 一票否决；缺省回落档位（保持向后兼容） | S |

### P2 — 编排深度（把「能跑」做成「可信」）

| ID | 上游来源 | 本项目现状 | 第一性原理 | DSH 适配 | 量 |
|---|---|---|---|---|---|
| **C1** | v1.3.0 + v1.4.0 audit 域 + v1.4.2 冷却感知 | **完全没有审计**；`capHit` 只看 rounds/escalations | 硬帽只能防止「跑飞」，防不住「CTO 声称验收了但没看 worker 结果」。需要一层**不阻断**的托底复核 | 新增 `src/audit.ts` + `auditor` 提示词：确定性检查（worker 是否都回话、有无 CTO 总结、是否触帽）**总是**跑；可选的 fast 档小模型复核**仅在被委派轮次**（`spawned ≥ 1`）跑、跳过冷却中的端点、全冷却则跳过；结果落 `lastAudit` 并在 `/router status` 与卡片展示 | L |
| **C2** | v1.2.0 + v1.3.0 收敛协议 | `ORCHESTRATOR_PROMPT` 有「只报阻塞问题」一句，但无结构化失败报告、无重复反馈触发接管 | 无结构的「还没对」会导致同一反馈无限重派；必须规定**每次重派携带失败报告**（什么失败/在哪/用什么验收测试复测），重复同一反馈即接管 | 扩写 `orchestrate.ts` 的提示词段（循环 / 工具契约 / 任务契约 / 失败报告 / 硬帽 / CTO 总结契约），占位符沿用现有 `systemPrompt.variable` | M |
| **C3** | v1.5.0 每 worker 成本归因 | 只有**按档位**的成本；`orch.spend` 永远为 0 | 编排的价值主张是省钱，不按 worker 记账就无法验证；同时它正好补上本项目文档已承诺但未实现的「预算闸」 | 有界 worker 账本（上限 20，丢最旧）：从 `tools/result` 的 usage 取 cost/outputTokens/挂钟时间累加；每任务重置；状态输出加 `orchestration $X (N workers)` | M |
| **C4** | v1.0.0/v1.1.0「tier injection 是强制的」 | 提示词只写「DSH 由部署侧 `agentOptions` 固定 worker 模型」——**把限制写成了说明** | 若 worker 继承父会话当前模型，编排中途父会话已是 Smart ⇒ worker 跑在 Smart 上，编排的经济学前提直接崩塌。**档位注入不是优化，是正确性前提** | **DSH 特有约束**：`subagent` 工具的 per-call `provider`/`model` 确实存在，但受 host 设置 `subagent-model-selection`（`enabled` 默认 **false** + `allowedModels: [{provider,model}]` 白名单）管控。三选一：(a) 卡片里给一个开关，帮用户把 Fast 链写进该 namespace；(b) 文档化前置条件 + 启动期自检告警；(c) 明确接受「worker 跟随部署侧固定模型」并在提示词里如实说明。**建议 (a)+(b)** | M–L |
| **C5** | 上游亦未实现（本项目文档已承诺） | `types.ts:184` 注释「hard budget guard」、`orchestrate.ts:6` 注释含 budget；但 `spend` 从不累加、`capHit` 不看它 | 承诺了不实现 = 文档说谎；要么落地要么删承诺。有了 C3 账本后，落地成本很低 | 用 C3 的 `spend` 接进 `capHit`（新增 `orchestration.maxSpendUsd?`）**或**删掉两处注释 | S |
| **C6** | 上游 Phase 3（**仍未实现**） | ROADMAP 已列「跨轮编排生命周期 / 多 worker 并行」 | 上游自己都还停在「单轮 MVP + 待收集使用数据」 | **本轮不对齐**，仅把 ROADMAP 标注改为「上游亦未落地」 | — |
| **C7** | v1.2.0 `recordWorkerOutcome` 语义 | `index.ts:543` 每个失败 worker 直接 `escalations += 1`；rounds 在 `tools/pre-execute` 就 +1 | 上游语义是「**连续**失败达到 `escalationThreshold` 才算一次升级」，且 rounds 在 `tools/result` 结算。当前实现会让偶发失败快速触帽，也会把「派了但没跑完」算成一轮 | 引入 `workerFailStreak`：成功清零、失败累加、达阈值才 `escalations++` 并清零；rounds 结算点挪到 `tools/result` | S |

### P3 — 诊断与 UX

| ID | 上游来源 | 本项目现状 | 第一性原理 | DSH 适配 | 量 |
|---|---|---|---|---|---|
| **D1** | v1.5.1 verbose 落盘 | `vlog()` → `ctx.logger.info`（已分流，无文件） | 上游落盘是被 pi 的 TUI 帧撕裂逼出来的**症状级修复**。DSH 里终端不被插件占有，**病因不存在**；但 Web/headless 场景下按命名空间抓取仍不方便 | 建议：默认保持 `ctx.logger`（正确抽象），**可选**增加 `ux.logFile` 配置写 `~/.dsh/logs/shift-router.log`。不要照搬「必须落盘、永不 console」的结论 | S–M |
| **D2** | v1.4.2 配置层权威展示 | `/router config diff` 能看到用户层，但不显示**当前生效值来自哪一层** | 用户改了一个值却看不到它是否被 patch 覆盖，会产生「改了没用」的错觉 | 复用 `settings.describe` + 插件的 patch 层信息，在 `/router config` 与卡片顶部显示权威层 | M |
| **D3** | v1.6.0 模型目录对齐 | 判定/定价走**手工 `pricing` 表**；可用性走 `resolveModelInfo` 探针；卡片走 `api.llm.models` | 上游这条修复的本质是「**单一事实来源**」：手工维护的目录必然漂移（上游实测 5 providers/413 models vs 39/1354）。DSH 里 `ctx.llm.listModels` + `resolveModelInfo` 就是那份事实 | 让成本估算优先从运行时目录取价（`resolveModelInfo` 的 cost 字段），`pricing` 降级为**覆盖表**而非唯一来源；探针结果做 TTL 记忆 | M |
| **D4** | v1.4.2 状态面板 + v1.4.0 状态栏 | `/router status|stats` 是纯文本 + GUI 卡片 | 「为什么这样决策」比「决策是什么」更能建立信任；上游用通俗的档位条替代 θ 数学 | 在卡片与 `/router status` 加：通俗的档位解释（R/θ → 一句话）、缓存命中率、上下文占用、`Last:` 上次判定与 reason | M |
| **D5** | v1.0.1 目录刷新 + 本 ROADMAP 已列 | 卡片模型下拉在构造时加载一次 | 同上，单一事实来源要**活得**久 | 卡片订阅目录 owner 事件重取；`pricing` 列表编辑器（需表单模型支持 list-of-record） | M–L |
| **D6** | v1.4.0 命令持久化 | `/router on\|off` 只改内存（会话级） | 需判定这是「DSH 的设计」还是「bug」。上游认定是 bug 并改为持久化；但 DSH 的 `enabled` 是配置字段，会话级临时关闭本身也自洽 | 决策项（见 §4 问题 4）：保持会话级 + 文档写明，或改为写 settings | S |

### P4 — 工程与发布

| ID | 上游来源 | 本项目现状 | 说明 | 量 |
|---|---|---|---|---|
| **E1** | — | README/ROADMAP 基线声明失真（§0.2） | 增加「上游对齐版本」字段，重写 ROADMAP 的基线句与 Planned 表（多项上游已交付） | S |
| **E2** | 上游 CI：`build` 先于 `test` | README 让用户跑 `--patch e2e/overlay.yml`，但 **`e2e/overlay.yml` 从未入库** | 干净 checkout 下 README 的免凭据端到端路径**不可复现**。补 `e2e/overlay.yml` + 脚本入口 | S |
| **E3** | 上游覆盖率门槛：lines/functions/statements ≥90、branches ≥85（`router.ts`/`failover.ts`） | 无覆盖率门槛；`src/index.ts`（全部 DSH 接线）、`stats.ts`、`tier.ts`、客户端 controller/卡片**零单测** | 对齐前先把核心决策模块的测试补到门槛（尤其 B1/B5 落地时是 TDD 的天然时机） | M–L |
| **E4** | 上游 `pack:check` + `check-isolated-load` | 无打包隔离校验 | 造 DSH 等价物：`pnpm pack` → `dsh plugin add <tarball>` → 断言宿主模块全部可解析（对应本仓库已知的 `dsh-client-store` 外部化改动） | M |
| **E5** | — | 依赖 `@deepseek-ai/*` **0.1.0-rc.6** / cordis **4.0.1**；skill 基线是 **0.1.5-rc.2** / cordis **4.0.2** | 本项目落后 SDK 基线数个 rc。有破坏性改名（如 `CallId`→`ToolCallId`）。**建议对齐动作之前先升 SDK**，否则新写的代码要改两遍 | M–L |
| **E6** | 上游 v1.4.3 死代码清理 | 死导出：`formatTierDisplayWithSpeed`、`judgeFallbackPrompt`+`FALLBACK_PROMPT`、`jsonStr`、`remainingCooldownMs`（仅测试用）；未用依赖 `@deepseek-ai/dsh-timeout`；README 测试数漂移（62/95 vs 实际 109）；README 宣称复用 harness「JSON-mode enforcement」但代码未传任何 response-format；README 集成表漏 `agent/turn-stopping`、`assistant/chunk`；`orchestration.startedAt` 只写不读；working tree 有 4 个未提交文件（含 lockfile 从 0.3.0 重生成） | 逐条清账；未提交改动需补 CHANGELOG 并落库 | S–M |

---

## 交付核对（本轮 P0 + P1）

范围经维护者确认：**P0 + P1**；EV **替换**旧算法；C4 按「文档化 + 启动自检」执行。
核对方式：逐条回到代码与测试取证，而不是凭 commit message。

### P0 — 正确性

| 项 | 实现 | 测试证据 |
|---|---|---|
| A1 Judge 不可用 ⇒ HOLD | `router.ts` `isDecisive()` + `processRoute` hold 分支（推入 `hold:true` 条目） | `router.test.ts` "holds position when the Judge is unavailable"、"never lets two consecutive outages downgrade a smart session"、"holds on a verdict below minConfidence" |
| A2 failover 签名补全 | `failover.ts` `detectFailoverError()`：402/余额不足/用量上限/模型下线；402 走 4xx 起跳 | `failover.test.ts` "recognizes 402 / insufficient balance"、"recognizes usage-limit exhaustion without an HTTP status"、"recognizes unsupported / missing models"、"treats 402 as a 4xx cooldown start" |
| A5 展示同步实际模型 | `index.ts` session/event 写 `actualProvider/actualModel`；`commands.ts` status 显示 Running vs Intended + 漂移告警 | `commands-handler.test.ts` "shows the gear, the last decision and the running model"（接线本身仍无单测，见残余缺口） |
| A6 严格模型权威 | `processRoute` 先按 decisionTier 解析并 `applyModelSwitch` 记录档位 | `router.test.ts` "records the tier change even when both tiers resolve to the same model" |
| A7 显式档位请求 | `judge.ts` 提示词「certainty, not a hedge」+ ≥0.9；判定改读 `decisionTier` | `judge.test.ts` "makes an explicit instruction a certainty rather than a hedge"；`orchestrate.test.ts` "never orchestrates on a hold" |
| A8 编排泄漏清扫 | `index.ts` `agent/pre-step` 在**所有门禁之前**清扫 active 残留 | `orchestrate.test.ts` "reset clears a leaked run" |
| ~~A3 / A4 TPS~~ | **R2 修正：不移植**，并删除本项目重复的 TPS 机制 | 负向断言：`stats.test.ts` "reports no throughput field"；`commands-handler.test.ts` status 不含 `tok/s` |
| C7 连续失败升级 | `orchestrate.ts` `recordWorkerOutcome()` + `index.ts` tools/result | `orchestrate.test.ts` "counts only consecutive failures toward an escalation"、"is inert while orchestration is inactive" |

### P1 — 决策核心

| 项 | 实现 | 测试证据 |
|---|---|---|
| B1 EV 经济学 | `router.ts` `effectiveReworkPenalty` / `effectiveTheta` / `pSmartOf` / `fastStreak` / `analyzeDowngrade` | `router.test.ts` 全套（θ 推导、preset 权威、pSmart 映射、legacy 惰性、连击降级、窗口裁剪） |
| B3 cache-aware 除数 | `sameFamilyThetaFactor()` + `sameFamilyPenalty`；legacy 阈值 ⇒ 3.0 | `router.test.ts` "divides theta by the same-family penalty"、"maps a non-default legacy sameFamilyThreshold"、"makes the same verdict stickier on a shared provider" |
| B4 judge prompt 四键 | `judge.ts` `JUDGE_PROMPT` + `parseOrchestrateFromText` | `judge.test.ts` "documents all four output keys"、"carries the doc-aware and bulk-batch fast rules"、"contains no keyword/regex decision gate" |
| B5 `decisionTier` | `RouteDecision` 新字段，唯一消费信号 | `router.test.ts` 各 action 分支的 `decisionTier` 断言 + `recordLastDecision` |
| B6 `orchestrate` 信号 | `shouldOrchestrate` 第 4 参 + 提示词键 | `orchestrate.test.ts` "lets the Judge veto orchestration explicitly"；`judge.test.ts` "carries the orchestrate signal through a successful call" |
| B2 gear presets | `commands.ts` `/router eco\|default\|sport`，**持久化** | `commands-handler.test.ts` "persists the chosen gear instead of only mutating memory"、"reports R and theta"、"surfaces a persistence failure" |
| C4(b) worker 模型注入 | 启动自检告警 + 提示词如实描述 + SPEC §7.4 | `orchestrate.test.ts` 提示词断言（含 `subagent-model-selection`、不含 `agentOptions`）；自检接线本身无单测 |
| 移除 `requireSmartModel` | `types.ts` / `config.ts` 删除；老文档静默加载 | `config.test.ts` "no longer carries the removed orchestration knob"、"loads a pre-alignment config document without failing" |

### Gate 结果

| Gate | 结果 |
|---|---|
| `npx tsc --noEmit`（宿主） | ✅ |
| `npx tsc -p tsconfig.client.json --noEmit`（客户端） | ✅ |
| `npx vitest run` | ✅ 201 tests / 12 files |
| `npm run build`（tsc + tsc client + tsdown） | ✅ |
| `npm run test:e2e`（临时 DSH_HOME → 装 bundle → 跑一轮 → 设置往返） | ✅ `ROUTER-E2E: turn ran on fake/fake-smart`；probe `{ok:true}` |
| `npm pack` 内容与 `dist` 可加载性 | ✅ 57 files；`import('./dist/index.js')` 导出 `apply/Config/inject/name`，schema 解析出 EV 默认值 |

### 残余缺口（如实记录，未在轮内解决）

1. **`src/index.ts` 的 DSH 接线仍无单测**（P4-E3 的一半）：编排清扫、实际模型同步、启动自检、`agent/request-error` 冷却路径、`agent/request` 覆写路径。这是**既有**缺口，本轮未扩大；e2e 覆盖了其中一条端到端路径（裁判 → EV 升级 → 上线模型切换 → 设置往返），但不能替代单测。
2. **SDK 漂移（E5）已由证据升级为 P2**：harness 通过 `LlmAdapter.prepareCall` 派发，而该 API 在 0.1.0-rc.6 不存在——本轮 e2e 的 fake adapter 就因此失败。插件自身的运行时值导入（`BlockAssembler`、`createUserMessage`、`settingsNamespace`）同样来自被钉住的旧版本，属真实的双版本风险，而非仅 fixture 问题。
3. **C4(a) GUI 代写 `subagent-model-selection` 白名单**未实现（需跨命名空间写权限的可行性调查），作为 P2 保留；本轮交付的是 (b)：文档化 + 启动自检 + 提示词如实描述。
4. **P2 编排深度**（验收审计、收敛协议、每 worker 成本归因）与 **P3** 项（模型目录单一事实来源、配置层权威展示、GUI pricing 编辑器/目录热刷新、覆盖率门槛、打包隔离闸）按约定未在轮内实施，已在 ROADMAP 的 Planned 表登记。

---

## 明确不对齐（附理由）

| 上游特性 | 不对齐的理由 |
|---|---|
| pi-tui `StatusPanel` 主题面板、footer 状态栏、`ui.setStatus`、`ui.custom` | 表现层实现，绑死 pi 的终端渲染。语义（档位/成本/链健康）已按 D4 搬到 DSH 卡片 |
| `models.json` 自定义 provider + `expandEnv`（`$VAR`/`$$`/`$!`/`!cmd`） | DSH 的 provider/凭据由 `dsh-*` 适配器与 credentials seam 负责；在插件里再造一套环境变量展开是重复实现 |
| `pi.modelRegistry` 具体 API（`getProviderAuthStatus`/`getApiKeyForProvider`/`refresh`） | 只搬**原则**（D3：单一事实来源），用 DSH 的 `ctx.llm` 表面实现 |
| `models-store.json` / `auth.json` / `settings.json` / 三层 JSON 配置文件 | DSH 用 settings namespace + patch overlay；文件层布局是宿主私有契约 |
| pi-subagents 的 `runs.all`、`worktree: true`、`context:"fresh"` 的 thinking-off 规避 | DSH 的子代理/工作流原语不同（`subagent`/`subagent_fork`/`workflow`），且 C4 的授权模型也不同 |
| `pack:check` 的 pi 包规则（`pi.extensions`、`minPiVersion`、host 包白名单） | pi 专属打包契约；只借其**意图**造 DSH 等价物（E4） |
| `AGENTS.md` 的 pi 专属硬停规则 | 上游开发流程约束，不是产品行为 |
| 上游文档自身的漂移（SPEC §9.1/§9.2/§7.5 过期等 10 处） | 不把上游文档的已知错误搬进来；本项目只对齐**代码行为终态** |

---

## 本轮决策记录

| 问题 | 决定 | 落地 |
|---|---|---|
| 本轮范围 | **P0 + P1**（正确性 + 决策核心），P2 编排深度另开一轮 | 见 ROADMAP「Next release」表与 Planned 表 |
| EV 是替换还是并存 | **替换**。两套语义并存会长期污染文档与测试 | `router.ts` 只保留 EV 路径；旧规则的相关代码被删除而非保留 |
| worker 模型注入（C4） | 按建议 (a)+(b)；(a) 需先调查跨命名空间写权限，故本轮交付 **(b)** | 启动自检 + 提示词如实描述 + SPEC §7.4；ROADMAP 登记 (a) |
| 版本号策略 | 本项目保持**自己的发布线**，额外记录「对齐到的上游版本」 | README 顶部基线行 + ROADMAP「Upstream alignment」表 |
| `/router on\|off` 持久性 | 保持**会话级**（DSH 语义自洽）+ 文档写明 | SPEC §10 末段、README 命令表 |
| SDK 升级（E5） | 本轮不做；**由 e2e 证据升级为 P2** | ROADMAP Planned 表（附 `prepareCall` 证据） |
| skill 0.4.0 回灌远端 | 未执行（推远端属发布动作，需显式批准） | 已安装副本 0.3.0 与远端一致，API 内容无差异；0.4.0 仅为自更新流程 |

---

## 下一轮建议顺序

1. **SDK 基线补齐**（E5）——先做，否则后续新代码要改两遍，且双版本风险仍在。
2. **P2 编排深度**：验收审计 → 收敛协议 → 每 worker 成本归因 → C4(a) 白名单写入。
3. **P3**：模型目录单一事实来源、配置层权威展示、`src/index.ts` 接线单测、覆盖率门槛、打包隔离闸。

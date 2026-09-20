# dsh-shift-router × pi-shift-router 上游对齐工作清单（待审核）

> 审核用工件。目标：从第一性原理出发，判定上游 `pi-shift-router`（本地 `../pi-shift-router`，HEAD `69ffb34` / v1.6.0）
> 自本项目派生点以来新增/修正的内容里，**哪些必须对齐、哪些必须换成 DSH 等价物、哪些明确不对齐**。
>
> 生成时间：本轮会话。证据来源：上游 `CHANGELOG.md` / `SPEC.md` / `AGENTS.md` / `src/**`，本项目 `src/**` / `tests/**` / 文档 / git 记录。

## 修订记录

**R3（安装验证轮：一次真实的 P0 热修，已交付）** — 维护者按推荐路径把本插件装进真实
`web` profile 后，**DSH 无法启动**：

```
Error: dsh: plugin tree failed to load: failed to apply loader entry shift-router
  (dsh-shift-router): cannot get property "subagentModelSelection" without inject
```

上一轮声明「已安装并验证」是**不成立的**：那条结论只验证到组合层（`dsh plugin add`
+ `--dump-config`），而 `--dump-config` **只组合配置、从不实例化插件**；真正的启动
从未被验证，而 E2E 恰好把 `orchestration.mode` 钉成 `off`，绕过出事的那条分支。
R3 记录根因、修复、新增闸门与合规审计结果，并**修正上一轮关于 C4(b) 与日志可见性的
错误结论**。详见「R3：安装验证轮（P0 热修）」一节。

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
| **E5** | — | ~~依赖 `@deepseek-ai/*` **0.1.0-rc.6** / cordis **4.0.1**~~ → **P2 轮已升到 0.1.5-rc.2 / 4.0.2** | 本项目落后 SDK 基线数个 rc。有破坏性改名（如 `CallId`→`ToolCallId`）。**建议对齐动作之前先升 SDK**，否则新写的代码要改两遍 | M–L |
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
| C4(b) worker 模型注入 | 自检（可选服务探测 + 响应式订阅 + 编排入口的免竞态复核）+ 提示词如实描述 + `/router status` 的 `Worker delegation:` 行 + SPEC §7.4 | `orchestrate.test.ts`（提示词、告警文本、状态行格式）；`plugin-load.test.ts`（真实 Cordis 上下文下的四条接线）；`commands-handler.test.ts`（状态行） |
| 移除 `requireSmartModel` | `types.ts` / `config.ts` 删除；老文档静默加载 | `config.test.ts` "no longer carries the removed orchestration knob"、"loads a pre-alignment config document without failing" |

### Gate 结果

| Gate | 结果 |
|---|---|
| `npx tsc --noEmit`（宿主） | ✅ |
| `npx tsc -p tsconfig.client.json --noEmit`（客户端） | ✅ |
| `npx vitest run` | ✅ 216 tests / 12 files |
| `npm run build`（tsc + tsc client + tsdown） | ✅ |
| `npm run test:e2e`（临时 DSH_HOME → 装 bundle → 跑一轮 → 设置往返） | ✅ `ROUTER-E2E: turn ran on fake/fake-smart`；probe `{ok:true}` |
| `npm pack` 内容与 `dist` 可加载性 | ✅ 57 files；`import('./dist/index.js')` 导出 `apply/Config/inject/name`，schema 解析出 EV 默认值 |

### 独立评审（mutation testing）

交付前由一个独立 Agent 做了对抗式评审，并在冻结副本上做 **变异测试**（改一行实现，看测试是否变红）来区分"真被钉住"与"碰巧通过"。结果：

- 抓住本轮引入/遗留的 **1 个 HIGH + 5 个 MEDIUM 缺陷**与 **2 个未被测试钉住的边界**（`pSmart >= θ`、idle 门禁的 `<=` 含边界），全部已修并补测（见 CHANGELOG「Fixed in review」）。
- 复跑该评审给出的变异：**11/11 被抓**。
- 评审明确确认"未发现"的部分同样有价值：`processRoute` 六个出口的 `decisionTier` 一致性、推送与降级顺序、窗口裁剪、`downgradeMemory=1`、编排五道门禁、prompt section 与 `tools/pre-execute` 拒绝条件完全一致、清扫早于所有门禁、旧配置文档不被拒绝、两个注册表路径一致、e2e 可复现。

### 残余缺口（如实记录，未在轮内解决）

1. **`src/index.ts` 的 DSH 接线仍无单测**（P4-E3 的一半）：编排清扫、实际模型同步、`agent/request-error` 冷却路径、`agent/request` 覆写路径。这是**既有**缺口，本轮未扩大；e2e 覆盖了其中一条端到端路径（裁判 → EV 升级 → 上线模型切换 → 设置往返），但不能替代单测。变异测试证实了这一点：把 `state.lastActivityAt = now` 整行删除，**测试全绿**——说明该修复只由代码保证。
   **R3 部分收口**：`tests/plugin-load.test.ts` 现在用**真实 Cordis 上下文**加载插件（`ctx.plugin()`，真实 `inject` 闸门），覆盖了启动自检的接线（服务缺失 / 先到 / 后到 / 已授权）以及 prompt section 的顺序与变量注册。它抓不住的仍是**事件回调内部**的逻辑（`agent/pre-step` 的清扫顺序、`agent/request-error` 分支），那部分仍只有 e2e 与纯函数单测。
2. ~~**SDK 漂移（E5）已由证据升级为 P2**~~ → **已在 P2 轮闭环**，见「R4：P2 轮」§R4.1。当初的证据（`LlmAdapter.prepareCall` 在 0.1.0-rc.6 不存在、`BlockAssembler`/`createUserMessage`/`settingsNamespace` 来自被钉住的旧版本）全部成立，且升级当刻就暴露了三处真实断裂。
3. **C4(a) GUI 代写 `subagent-model-selection` 白名单**未实现（需跨命名空间写权限的可行性调查），作为 P2 保留；本轮交付的是 (b)：文档化 + 自检 + 提示词如实描述 + `/router status` 行。R3 修正：**(b) 原本用 `ctx.logger.warn` 交付，而自带组合不挂载任何日志导出器，告警实际无人可见**（见 R3 一节），因此补了状态行；自检的"能看到"这一半是 R3 才补上的。
4. **P2 编排深度**（验收审计、收敛协议、每 worker 成本归因）与 **P3** 项（模型目录单一事实来源、配置层权威展示、GUI pricing 编辑器/目录热刷新、覆盖率门槛、打包隔离闸）按约定未在轮内实施，已在 ROADMAP 的 Planned 表登记。
5. **worker（子代理）用量不进遥测**：worker 没有路由器状态，其 usage 被跳过，因此编排花费对 `/router status` 不可见。SPEC §9 已如实收窄为"被路由的顶层 Agent 的消息"，并把 worker 归因留给 P2 的每 worker 成本工作——**宁可不记，也不记错**。
6. **`manualOverride` 的泄漏没有清扫**（与编排泄漏同源，但机制不同）：`/route-force` 在**轮次之间**设置覆盖，所以不能在 `agent/pre-step` 里无脑清除。影响被限制在一轮之内（下一个正常收尾的轮次会在 `agent/turn-stopping` 清掉），因此本轮**记录而不修**；若要做，正确形态是给覆盖打上"已生效轮次"标记并在跨轮时清除。
7. **`stats.ts` 的 confidence 高/中分界 `0.7` 仍是硬编码**：纯展示分桶，不影响任何决策；按 CONTRIBUTING「两个部署可能取值不同即须进 Config」的字面标准应当可配，但收益极低，本轮**接受现状**并记录在此。

---

## R3：安装验证轮（P0 热修）

### R3.1 现象

维护者按 README 的推荐路径把插件装进真实 `~/.dsh` 的 `web` profile，重启后 DSH 直接
退出（`dsh: plugin tree failed to load`），必须卸载插件才能启动：

```
failed to apply loader entry shift-router (dsh-shift-router):
cannot get property "subagentModelSelection" without inject
    at workerModelSelection (dist/index.js:631:32)
    at new apply (dist/index.js:659:57)
```

### R3.2 根因

上一轮 C4(b) 的自检代码这样读宿主服务：

```ts
const holder = ctx as unknown as { subagentModelSelection?: { current?: () => unknown } }
const service = holder.subagentModelSelection
```

`as unknown as` 只让 **TypeScript** 闭嘴；Cordis 的 context 是 Proxy，其 `get` trap
对**未在 `inject` 中声明**、且**当下没有 provider** 的属性一律抛
`cannot get property "X" without inject`。三个决定性事实：

1. **抛点在 `apply` 内部** ⇒ fiber FAILED ⇒ 整个 plugin tree 加载失败，DSH 起不来。
   —— 这不是"路由不工作"，是"宿主不可用"，插件缺陷里最严重的一档。
2. **触发条件正好是默认配置**：`orchestration.mode` 默认 `auto`、Fast 链非空 ⇒ 每个
   用户都命中。
3. **"服务缺失"包含"还没挂载"**：`subagent-model-selection-settings` 这一行只由
   `dsh-web-app` 组合挂载，且与插件行同属一个 include group、由 `Promise.allSettled`
   **并发加载**。本插件的 `apply` 先跑完时该服务尚不存在 ⇒ 抛错。所以它同时是
   **web 专属**与**启动顺序竞态**两个条件的叠加；headless 组合则因该行根本不存在而
   必然命中"缺失"分支。

### R3.3 为什么每一道既有闸门都漏了

| 闸门 | 为什么没抓到 |
|---|---|
| `tsc` | `as unknown as` 是显式类型逃逸，编译器无从判断；类型正确性与运行时合法性在这里本来就分叉 |
| `--dump-config`（上一轮"安装验证"用的就是这个） | **只组合配置层，从不实例化任何插件**，`apply` 根本不会执行 |
| `vitest` 单测 | 全部用**手写对象**当 ctx 调纯函数，没有 Proxy，没有 trap，永远不抛 |
| `npm run test:e2e` | 两个 overlay 都写了 `orchestration.mode: off`（当时是为了让断言只盯着模型切换），**恰好绕开出事的唯一分支**；而"旧配置升级路径"fixture 本意是复刻真实 profile，却在最关键的这一个键上背离了真实值 |
| 人工审查 / mutation testing | 变异的是纯函数与触发条件，未变异"服务访问方式"这一类 |

一句话：**没有任何一道闸门真正启动过一次 DSH**。这正是上一轮把"组合层验证"当成
"安装验证"的后果。

### R3.4 修复

1. **可选依赖必须探测**（skill §6/§12 的明确规范）：新增
   `readWorkerModelSelection(ctx)`，用 `ctx.get('subagentModelSelection')` 读取
   （无 provider 时返回 `undefined`，不抛）。同一文件里 `ctx.inject(['settings'], …)`
   早就是这么写的——本轮是**没有沿用项目自身既有范式**。
2. **响应式订阅**：自检挂在 `ctx.inject(['subagentModelSelection'], cb)` 上，服务
   何时挂载何时触发，被替换时重触发，随插件卸载而销毁；这同时消掉了竞态。
3. **免竞态的缺失判定**：`enterOrchestration()` 处再复核一次。此刻树早已稳定，"缺失"
   已是关于**部署**的事实，而不是挂载时序的假象。两条路径共用一个"只说一次"的闸。
4. **让结论真正可见**（见 R3.5）。
5. 顺带修正告警文案：`mount or enable`（headless 组合压根没挂载该设置面板，只说
   "enable" 是误导）。

### R3.5 附带发现：C4(b) 的告警发到了没有人看得见的地方

排查过程中确认：Cordis 的 logger 默认只写**内存环形缓冲（1000 条）**并投递给已注册的
exporter；而**自带组合一个 exporter 都没注册**（`@deepseek-ai/dsh-base`、`dsh-web-app`
及 `dsh` CLI 全无 `ctx.logger.exporter(...)`）。也就是说：

- 插件的 `ctx.logger.*` 输出在 `web` / `headless` / `sdk` 下**都不出现在终端，也不出现
  在 UI**；
- 上一轮告诉维护者"启动日志会显示 `[shift-router] loaded …`"是**错的**，`ux.routerLogVerbose`
  的实际可见性也被 README 高估了。

这不是插件 bug（`ctx.logger` 仍是正确通道，挂了 sink 的部署就能看到），但它推翻了
C4(b) 的交付形态：**"启动自检告警"若无人可见，等于没交付**。因此：

- 启动自检保留（挂 sink 的部署受益）；
- 同一事实补到用户真正会看的界面：`/router status` 新增 `Worker delegation:` 行
  （未编排时显示 `— (orchestration off)`）；
- SPEC §13 增加一条规范性结论：**自带 profile 下"用户必须能读到"的信息只能走命令，
  不能走日志**；README/README.zh-CN 与 GUI 提示同步更正。

### R3.6 新增闸门（并验证闸门真的会拦）

| 闸门 | 内容 | 拦住了吗 |
|---|---|---|
| `tests/plugin-load.test.ts` (5+3 tests) | 用**真实 Cordis 上下文**经 `ctx.plugin()` 加载插件：服务缺失 / 先到 / **后到（竞态）** / 已授权；外加 prompt section 顺序与变量注册 | 把修复变异回原缺陷后：**3/5 失败**（`cannot get property … without inject`） |
| `e2e/orchestration-overlay.yml` | 用**默认** `orchestration.mode: auto`，并插入 `web` 组合那一行真实服务行 | 变异后该场景**失败** |
| `e2e/legacy-config-overlay.yml`（改造） | 恢复为真实 pre-alignment 配置：`orchestration.mode: auto`（原来被钉成 `off`，正是漏检原因） | 变异后该场景**失败** ⇒ 现在它是这个 boot bug 的**确定性**回归闸 |
| `e2e` 断言 | 断言输出不含 `without inject` / `failed to apply loader entry` | 同上 |

变异方法：把 R3.2 的原始直读代码加回 `apply`，重跑 → 单测 3 红、e2e 两场景红；还原后
全绿。**闸门本身被验证过会拦，而不是"看起来在跑"。**

### R3.7 合规审计（对照 `dsh-plugin-dev-skill` 0.5.0）

| 铁律 / 规范 | 结论 |
|---|---|
| 依赖必须声明（`inject`），可选依赖用 `ctx.get()` 探测 | ❌→✅ R3 修（唯一一处违规，即本次 P0） |
| 所有 `ctx.<name>` 读取必须合法 | ✅ 全量枚举 `src/**`（宿主 11 个属性名、客户端 5 个）逐一核对：`llm/tools/commands/agents/systemPrompt` 已声明，`settingsScope/slots/locale` 已声明，`settings` 经 `sctx`，`connection` 为可选探测，`logger/on/effect/inject` 为 Context 原生 |
| 资源必须走 `ctx.effect` 或经 `ctx` 注册 | ✅ settings 的 `watch` 作为 effect 注册（`watch` 返回 disposer，已核对类型）；judge 的 `setTimeout` 在 `try/finally` 内 `clearTimeout`，非长期资源；无手写 `removeListener/clearInterval` |
| waterfall 监听器必须 `next()` | ✅ 五个 waterfall 监听器逐条核对：观察/放行分支全部 `return next()`；`tools/pre-execute` 的 `deny`、`agent/request-error` 的 `retry` 属**有意短路** |
| 配置必须可配置（无硬编码） | ⚠→✅ 发现 `systemPrompt.section` 的 `order: 150` 是硬编码 ⇒ 新增 `ux.promptSectionOrder`（见 R3.8） |
| 回调纯函数 / 无 I-O | ✅ 本插件不注册工具；`/router` 命令不写文件；客户端无 `fetch/console/计时器` |
| 类型安全 | ✅ 无 `as any` / `@ts-ignore` / `eslint-disable`（修复前的 `as unknown as` 已删除） |
| 剩余可接受项（记录不修） | `stats.ts` 的 0.7 置信度分桶（纯展示，非部署可变参数）；`/router models` 的 `slice(0,12)`、judge reason 的 120 字符截断（均纯展示） |

### R3.8 顺带修掉的第二类隐患：平台常量不能猜

`order: 150` 看似无害，但把平台的 `getSectionOrder()` 当成"正确做法"会直接踩雷：

- `ctx.systemPrompt.getSectionOrder(name)` 对**不在平台 `SECTION_ORDERS` 表内**的名字
  返回 `undefined`；
- `section()` 对非有限 `order` 会 `throw new TypeError(...)` ⇒ fiber FAILED ⇒
  **同一种 boot abort**。

且 `SECTION_ORDERS` 是平台集中分配的（含 `DEPLOYMENT_PERSONA_PREFIX: 0`、
`PLAN_POLICY: 500`、`TOOL_*: 1000..2900`、`TOOLS_SDK: 5000` …），第三方段落没有槽位。
因此正确形态是**配置项**：`ux.promptSectionOrder`（默认 150，仍是"persona 前缀之后、
plan 策略之前"），并写进 SPEC §1.4 第 3 条作为规范。

### R3.9 关于「是否需要连 P2 一起做」

**不需要，也不应该。** 本次不是一个"未完成的迁移"，而是**上一轮新引入的 P0 缺陷**：

- 根因是服务访问方式（1 处代码），不是 SDK 版本差异。把 `@deepseek-ai/*` 从
  `0.1.0-rc.6` 升到 `0.1.5-rc.2` **不会**修掉它——`inject` 语义两版一致；
- P2 的"SDK 基线补齐"因此仍是**独立**的下一轮工作，且 R3 为它增加了新证据（见下）。

**同时必须承认 P2 里确实有一项与本轮相邻**：SDK 基线漂移。R3 复核的证据：

| 证据 | 含义 |
|---|---|
| 运行时 cordis **4.0.2** vs 项目 pin **4.0.1** | 已实际运行在 4.0.2；本轮 `ctx.get`/`ctx.inject` 用法两版都支持，但类型基线落后 |
| `subagentModelSelection` 服务由 `@deepseek-ai/dsh-tool-subagent/model-selection-settings` 提供，且**只被 `dsh-web-app` 组合挂载** | 本插件不依赖该包（故只能结构化探测），这也是当初想"绕过类型"的诱因；P2 若把该包纳入类型依赖，可以有正式类型 |
| `SECTION_ORDERS` / `getSectionOrder` / `Context` 混入方法等均来自运行时版本 | 升级后需按 skill 提示复查 API |

### R3.10 R3 后的 Gate 结果

| Gate | 结果 |
|---|---|
| `npx tsc --noEmit`（宿主） | ✅ |
| `npx tsc -p tsconfig.client.json --noEmit`（客户端） | ✅ |
| `npx vitest run` | ✅ **228 tests / 13 files**（R3 新增 `plugin-load.test.ts` 8 项与状态行等 4 项） |
| `npm run build` | ✅ |
| `npm run test:e2e` | ✅ 三个场景（新装 / pre-alignment / **默认 auto + web 服务行**）+ 设置往返 |
| 闸门自检（变异回原缺陷） | ✅ 单测 3 红、e2e 2 场景红；还原后全绿 |

---

## R4：P2 轮（编排深度 + SDK 基线补齐）

R4 的目标是把「编排能跑」做成「编排可信」，并把上一轮登记的 SDK 双版本风险一次性消掉。
每一项都先在这里写清**语义、DSH 适配形态与验收标准**，再动代码。

### R4.1 SDK 基线补齐（E5 闭环）

| 项 | 结论 |
|---|---|
| 版本 | `@deepseek-ai/cordis` 4.0.1 → **4.0.2**；`dsh-{agent,commands,llm,session,settings,system-prompt,tools}` 0.1.0-rc.6 → **0.1.5-rc.2**；`schemastery` → **^3.18.2**；客户端 `dsh-client-*` → **^0.1.5-rc.2**；新增类型依赖 `dsh-tool-subagent` |
| 为什么必须做 | 插件**编译**用自己 node_modules 的类型，**运行**用 harness 的包。此前二者差数个 rc，属结构性风险 |
| 实测断裂 1 | `settingsNamespace()` 在 0.1.5 已删除（namespace 变成 branded string，由 `register()` 校验）⇒ 改为字面量。**e2e 的 settings-probe 之前一直在 import 旧构造函数**（它从本仓库自己的旧依赖副本解析），所以这条从未被 e2e 抓到——正是双版本风险的活样本 |
| 实测断裂 2 | `dsh-client-runtime` 在该基线**不存在**（profile 里那个条目是悬空符号链接，指向 npx 缓存）。客户端 `ClientContext` → cordis `Context`；`ctx.slots` 由 `dsh-client-ui-renderer/client` 声明；浏览器侧 `SettingsScope` 由 `dsh-client-ui-settings/client` 声明 |
| 实测断裂 3 | `dsh-tool-subagent` 未纳入类型依赖，导致上一轮只能用结构化 cast 读 host 服务（那正是 boot 事故的诱因）⇒ 现在纳入（type-only），SPEC §1.5 记录基线契约 |
| 验收 | `tsc` 宿主 + 客户端 ✅；228 单测 ✅；build ✅；e2e 三场景 + 设置往返 ✅（e2e 的 fixture 现在也走新依赖，故断裂 1 被真实覆盖） |

### R4.2 语义定义（先文档后代码）

| ID | 本项目语义（R4 交付） | 验收标准 |
|---|---|---|
| **C3** | 每 worker 成本账本：`tools/result` 的 subagent 结果带 usage 时，按 cost / outputTokens / 挂钟时间入账；账本上限 20 条（丢最旧）；每任务重置；`/router status` 显示 `orchestration $X (N workers)` | 纯函数单测（入账、上限、重置、聚合）+ 状态输出断言 |
| **C5** | `orchestration.maxSpendUsd`（默认 0 = 不限）接进 `capHit`；触顶时拒绝 `subagent` 并切换为收尾提示 | 单测：0 表示不限；spend ≥ 阈值时 capHit 为真；提示词与拒绝条件一致 |
| **C2** | 提示词新增**收敛协议**：每次重派必须带 `## Failure report`（什么失败 / 在哪 / 现在用什么验收测试复测）；禁止重发同一份报告，第二次即接管；`escalationThreshold` 是提示词与硬帽共用的阈值 | 提示词断言（三要素、接管条件、与硬帽阈值一致） |
| **C1** | **不阻断**的验收审计：确定性检查（worker 是否都回话、有无 CTO 总结、是否触帽）总是跑；LLM 复核仅在**确实委派过**（spawned ≥ 1）且 fast 档有健康端点时跑；结果落 `lastAudit`，在 `/router status` 与卡片可见；审计永不影响轮次结论 | 纯函数单测（提取、判定、解析、冷却过滤）+ 接线单测 + 状态行断言 |
| **C4(a)** | 提供「把 Fast 链写入宿主 `subagent-model-selection` 白名单」的动作，写入目标 namespace 而非本插件 namespace。**交付形态修正**：做成 `/router allow-workers` 命令而非卡片按钮——可行性已核实（settings provider 的 `get`/`update` 是 namespace 无关的，跨插件写入已被 e2e 的 settings-probe 实证），但命令是**每个 profile 都可用**（headless 也能用）且**可单测**的界面；卡片本轮只负责编辑 Fast 链（授权的输入），运行期委派状态仍以 `/router status` 的 `Worker delegation:` 行为准——卡片是设置表单，展示运行期状态需要插件并不具备的浏览器↔宿主通道 | 见下「交付」 |
| **C4(a)** | `/router allow-workers [on\|off]`：宿主侧经 settings provider（namespace 无关的 `get`/`update`）把 Fast 链写入 `subagent-model-selection`（`{enabled, allowedModels}`），去重；`off` 只撤销授权、保留路由；不可写时给出**具体原因**（该 profile 未挂载该 namespace / settings 服务缺失 / Fast 链为空） | `commands-handler.test.ts` 四条（写入并回报内容、`on` 形式、`off` 撤销、失败原因）；`commands.test.ts` 两条**把字面量钉在拥有包导出的常量与 schema 上**（重命名/改 schema 会红） |
| **C6** | 不对齐，仅记录「上游亦未落地」 | ROADMAP 标注 |

### R4.3 交付核对

| ID | 交付 | 证据 |
|---|---|---|
| **C3** | `OrchestrationState` 增 `spawned`/`done`/`spend`/`workerSpends`；`recordWorkerSpend` 按 **child session** 归并（一个 worker 一行）；`session/event` 在 `header.origin === 'subagent'` 分支用 `header.parentSession` 精确定位父任务并按其**实际运行的模型**计价；`/router status` 增 `Orchestration spend: $X · N/M workers reported` | `orchestrate.test.ts`（归并、上限丢最旧、`spend` 与账本解耦、elapsed 保留、格式化）；`commands-handler.test.ts`（状态行）；`config.test.ts`（默认 20） |
| **C5** | `orchestration.maxSpendUsd`（默认 0=关闭）接入 `capHit`；新增 `capReason()` 作为"哪个帽触发"的唯一权威，deny 理由与提示词收尾通知共用 | `orchestrate.test.ts`（默认关闭、达阈值触发、多帽原因只列已触发者）；`config.test.ts`（负数报错） |
| **C1** | `src/audit.ts`：确定性半（worker 完整性 / CTO 总结 / 是否触帽）总跑；LLM 半仅在 `spawned ≥ 1` + 启用 + 有健康 fast 端点时跑，走 `ctx.llm.stream`（**不持有凭据**）、冷却过滤、失败即降级为 violation；`turn-stopping` 处同步完成确定性半、**分离**执行 LLM 半（不拖慢轮次）；证据捕获（goal / ctoSummary / workerResults）按 `promptCap` 有界；结果落 `state.lastAudit` 并由 `/router status` 的 `Last audit:` 行呈现。与上游的四处适配：转录→事件快照、endpoint+fetch→ctx.llm.stream、`.md` 文件→内联提示词、agent_end 等待→分离执行 | `audit.test.ts`（20 项：确定性判定、解析、提示词构造与截断、自执行/禁用/全冷却跳过、链式 failover、flag→violation、抛错→violation、不可解析→不臆断）；`commands-handler.test.ts`（状态行）；`config.test.ts`（默认值） |
| **C2** | `ORCHESTRATOR_PROMPT` 新增「Convergence protocol」：`## Failure report` 三要素（what failed / where / acceptance test now）、禁止重发同一报告（即接管信号）、接管阈值与硬帽同源；硬帽段补上预算帽说明 | `orchestrate.test.ts` 三条提示词断言（三要素、no-repeat + takeover、阈值随配置改变） |

### R4.4 Gate 结果与闸门自检（R4 收尾）

| Gate | 结果 |
|---|---|
| `npx tsc --noEmit`（宿主） | ✅ |
| `npx tsc -p tsconfig.client.json --noEmit`（客户端） | ✅ |
| `npx vitest run` | ✅ **275 tests / 14 files**（R4 新增 `audit.test.ts` 等，净增 47 项） |
| `npm run build`（tsc + tsc client + tsdown） | ✅ |
| `npm run test:e2e` | ✅ 三场景（新装 / pre-alignment / 默认 auto + web 服务行）+ 设置往返；**默认 auto 场景会走到新的 `turn-stopping` 审计路径**，故该路径也被真实执行 |
| 真实 `web` 组合启动（派生 profile + `--port 0`） | ✅ 进程正常进入服务状态，无 plugin tree 报错 |
| **闸门自检（变异测试）** | ✅ **7/7 被抓**：C3 账本不累加 / C3 spend 改为账本求和 / C5 预算不入 capHit / C2 删掉 failure-report 契约 / C1 自执行轮次进入 LLM 复核 / C1 忽略触帽原因 / C4(a) 撤销写成启用 |

R4 的新增接口（`OrchestrationState` 的 `spawned/done/spend/workerSpends/goal/ctoSummary/workerResults`、`RouterState.lastAudit`、`orchestration.{maxSpendUsd,workerLedgerCap,audit.*}`）全部有默认值且有单测；`config.test.ts` 与 CLI/GUI 双注册表一致性测试继续覆盖新叶子。

**未在本轮交付（如实记录）**：编排状态在**卡片**上的运行期展示（`Worker delegation` / `Last audit` 只出现在 `/router status`）。原因：卡片是设置表单，展示运行期状态需要一条插件并不具备的浏览器↔宿主通道；R3 的结论也表明命令才是自带 profile 下始终可达的界面。若将来要做，正确形态是给插件加一个 remote/API 面（而不是把状态塞进设置快照）。

---

## R5：安装前再验证（「还会不会再破坏 DSH 启动」）

维护者在安装前提出的问题：**能否确认按推荐方式安装后不会再破坏 DSH 启动。**
答案只能靠穷举「插件能怎样破坏启动」并逐条给出证据，而不是重跑同一批 gate。

### R5.1 启动失败的全部途径（逐条核对）

| 途径 | 核对方式 | 结论 |
|---|---|---|
| `apply()` 抛错 → fiber FAILED → plugin tree 加载失败 | 枚举 `apply` 内所有可能抛的调用：`ctx.systemPrompt.section`（非有限 order 会抛）、`ctx.commands.register`、两个 `ctx.inject`、以及**未声明服务读取** | 前两者分别由 `ux.promptSectionOrder`（默认 150，配置化）与类型检查保证；未声明读取由 `plugin-load.test.ts` 在真实 Cordis 上下文里钉住（变异 3 红） |
| **导入期**抛错（模块加载失败，比 fiber FAILED 更早） | `grep` 全部 `src/**` 的导入期副作用（顶层 `throw` / `readFileSync` / `process.*` / 定时器） | 无（audit.ts 的提示词是纯字符串常量；orchestrate.ts 的提示词同理） |
| 运行时 **值导入** 在目标 profile 解析不到 | 从**构建产物**反查：`dist/*.js` 的外部 specifier 只有 `@deepseek-ai/dsh-llm`、`@deepseek-ai/schemastery` —— 二者都在 `dependencies` | 新增 `packaged-install.test.ts` 把这条钉死（把 `dsh-llm` 移出 dependencies → 测试红） |
| 浏览器半边解析不到模块 | 从 `dist/client.js` 反查 `require()`：`@deepseek-ai/dsh-client-store`、`react`、`react/jsx-runtime`；对照前端 boot 的 `staticModules`（seed 表：react / react-dom / cordis / **dsh-client-store** / dsh-client-ui-slots / -primitives / -dockkit） | 三者都是 **平台 seed word**，由 shell 恒定提供；另加 gate 断言「requires ⊆ seed ∪ dsh.client 声明」 |
| 客户端 roster（`dsh.client.inject`）指向不存在的包 | 读 `dsh-client-modules` 的装载实现：未知 id **静默跳过**（`if (dependency !== void 0)`），不会抛 | **不是启动杀手**，但确实是错的：该字段仍写着基线已删除的 `@deepseek-ai/dsh-client-runtime`；已改为 `@deepseek-ai/dsh-client-ui-renderer`（`ctx.slots` 的声明方，卡片真正依赖它），并删掉无 `dsh.client` 声明的 `dsh-client-ui-slots`；gate 会拦「重新写回被删包名」 |
| 配置差异导致只在该配置下抛错（R3 的教训） | `plugin-load.test.ts` 新增 5 组真实加载：空 config 行、`enabled:false`、`routing.mode: manual`、`off`、`orchestration.mode: off`、空 Fast 链、完整 costs/audit 配置 | 全部加载成功 |
| 打包产物缺文件 / 依赖缺失 | 新增 `npm pack` → 装进第二个 scratch profile（`web`）→ **真实启动** 的 e2e 场景；tarball 安装**不含 devDependencies** | ✅ 进入 serving 状态，无 plugin tree 报错 |

### R5.2 新增闸门与自检

| Gate | 内容 | 变异自检 |
|---|---|---|
| `tests/packaged-install.test.ts`（6 项） | 宿主产物外部导入 ⊆ `dependencies`；浏览器 `require` ⊆ seed ∪ `dsh.client`；roster 不得再写回已删除包；`files` 完整性；双面 exports + bundle patch | 把 `dsh-llm` 移出 dependencies → **红**；roster 写回 `dsh-client-runtime` → **红**；给 `dist/client.js` 注入未声明 `require` → **红** |
| `tests/plugin-load.test.ts`（13 项，+5） | 上述 5 组配置的真实加载 | 把未声明服务读取放回 `apply` → **红**；把 section order 改成非有限值 → **红** |
| `e2e` 第 7 步 | packed 安装 + 真实启动 | 见上（同一机制） |

### R5.3 结论与残余不确定性

**已确认**：两条真正导致过启动失败的机制——「未声明服务读取」与「非有限 prompt section order」——现在各自被**真实上下文加载测试**钉住；此外新增了导入期副作用、依赖/产物解析、打包安装三类闸门。**打包安装（最强形态）已实机启动成功。**

**仍无法承诺的部分（如实说明）**：
- 闸门覆盖的是「本插件自身」的启动失败面。若 harness 未来再次 **移除/重命名** 我们使用的 API（例如下一次 SDK 基线跃迁），仍可能出现运行时断裂——这正是 SPEC §1.5 要求「harness 移动则基线必须跟随」的原因，也是 e2e 用真实 harness 跑一遍的价值所在。
- 卡片在**浏览器**里的渲染只有类型检查 + 单测覆盖（无 CI 浏览器闸门）；`dsh.client` 契约已按 seed 表核对，但真机渲染仍建议人工看一眼（CONTRIBUTING 的手工 e2e 步骤）。
- `orchestration.audit` 默认开启 ⇒ 编排轮次会多一次小的 Fast 档审计调用（分离执行，不阻塞）；不想要可置 `false`。

---

## R6：安装后实测——GUI 配置卡片不可见（热修）

R5 证明了「启动不会再坏」。维护者随后按推荐方式安装并重启：**DSH 正常加载、插件正常挂载**，
但 **Settings → Plugins → Plugin configuration 里没有本插件的卡片**——插件可用，却少了唯一的图形配置面。

### R6.1 定位

| 检查 | 结果 |
|---|---|
| 插件宿主半边是否加载 | ✅ `/router config`、`/router status` 可用（R5 已证） |
| 浏览器半边是否被 offer 给前端 | ✅ `dsh-client-modules` 从 loader 行解析包清单 → `exports["./client"]` → `dist/client.js`；`dsh.client.platform: "web"` 成立 |
| settings namespace 是否被「服务」给浏览器 | ✅ 0.1.5-rc.2 **已无** `dsh-host-apiproxy` 的 `WEB_SETTINGS_NAMESPACES` 白名单；`settings.describe()` 返回全部已注册命名空间（`scripts/expose-gui-settings.mjs` 在此基线上正确地成为 no-op） |
| 卡片是否注册进了 `settings.plugin.item` | ❌ **没有**（R6.2） |

### R6.2 根因：keyed 槽用 `id` 注册，且契约被本地重抄成 list

`settings.plugin.item` 是 **`keyed`** 槽（声明方 `dsh-client-ui-settings-plugins` 在注册自己的
*Plugin configuration* tab 时声明 `children: { 'settings.plugin.item': { kind: 'keyed', scope: 'root' } }`）。
keyed 槽唯一的寻址字段是 `key`，而注册写的是 `id`：

```ts
ctx.slots.register({ name: 'settings.plugin.item', id: NS, order: 30, … })   // ❌
```

两层后果各自都足以让卡片消失：`SlotCore.register()` 的第一条 keyed 校验直接抛
`keyed slot "settings.plugin.item" requires options.key`；而 tab 的投影规则
（`entry.options.key !== undefined && served.has(entry.options.key)`）也不会认任何没有 `key` 的条目。
抛错发生得**很晚**——插件启动时 `slots.inject(...)` 只是订阅声明，回调要等用户打开
*Plugin configuration*、tab 声明该槽时才执行，于是它被 `slots.inject` 的 `changed()` 捕获后
`queueMicrotask` 重抛：**注册从未成功，只在浏览器控制台留下一条无人看见的未捕获错误**。

**类型检查为什么没拦住**：本项目自己 `declare module` 把该槽抄成了 `kind: 'list'`，
于是 TypeScript 认为它要的是 `id`，闸门反而认证了错误写法。与 §R3 同源——**契约的单一事实来源在声明方**。

### R6.3 修复

| 项 | 修复 |
|---|---|
| 槽寻址 | 改为 `key: NS`（= 宿主注册的 settings namespace）；删掉 keyed 槽没有语义的 `id` / `order` |
| 契约来源 | 删除本地 `SlotMap` 重复声明，改为 **type-only** 引用声明方 `@deepseek-ai/dsh-client-ui-settings-plugins/client`（新增 devDependency，仅类型，不进运行时/产物/`files`）；`LocaleNamespaceMap` 仍由本包声明——那本来就是本包的字典命名空间 |

规范落点：SPEC §1.5（契约依赖纪律）、§12.1（keyed 槽与 namespace 字面量）、§14（闸门）。

### R6.4 新增闸门与变异自检

| Gate | 内容 | 变异自检 |
|---|---|---|
| `tests/client-card-slot.test.ts` | 用**真实 `SlotCore`** 声明 keyed 子槽（镜像宿主 tab 的 `children`），跑真实 `apply()`，断言条目落在 `shift-router` cell；覆盖两种加载顺序（槽先声明 / 面板后挂载——后者是真实顺序） | `key`→`id` → **红**（真实抛 `requires options.key`） |
| `npm run typecheck` | 契约来自声明方后，`id` 成为编译错误 | `key`→`id` → **红** |
| e2e（packed 安装） | 从运行中的服务器把 **boot payload** 读回来，断言浏览器半边确实被 offer 给 client module loader（`dsh.client.platform` 写错时它会被**静默跳过**，卡片永不加载），且部署确实 ship 了声明该槽的 `dsh-client-ui-settings-plugins` | `platform: "headless"` → **红**（payload 里没有该 id） |

### R6.5 残余不确定性

- 本轮修的是「注册从未发生」。卡片在浏览器里的**最终渲染**仍只有类型检查、单测与人工浏览器步骤
  （CONTRIBUTING「Manual browser E2E」）覆盖：渲染期崩溃是下一层，需要真机打开面板才能确认。
- `key` 与宿主 namespace 的**一致性**由两处字面量共同钉住（客户端 `NS` 与 `ROUTER_SETTINGS_NAMESPACE`，
  由 `tests/client-card-slot.test.ts` 断言相等），但这仍是断言而非类型——浏览器半边无法从宿主半边导入字面量，
  要做成机械约束需要一条插件并不具备的浏览器↔宿主通道（与 §R4 的卡片运行期展示同一约束）。

---

## R7：设置面板审计——模型目录与交互

卡片可见之后，维护者实测的结论是「**设置面板里模型得手输**，而 `/model` 明明能列出可用模型」。
审计同时覆盖「为什么手输」和面板其余交互。

### R7.1 根因：读了一个不存在的 remote

卡片把模型目录读作 `ctx.get('connection')?.api.llm.models()`。0.1.5-rc.2 的事实：

| 断言 | 事实 | 证据 |
|---|---|---|
| `ctx.connection` 上有 `.api` | ❌ `ConnectionHandle` 只有 `isLoopback` / `generation` / `state` / `rpc` / `reconnect` / … | `dsh-client-connection/lib/types/client/index.d.ts` |
| 有 `llm.models` 这个 remote | ❌ 不存在；`/model` 选择器读的是 `ctx.remote.session.modelCatalog()` | `dsh-client-ui-model-selection/lib/client.js`、`dsh-api-session-controller` 的 `buildModelCatalog()` |

于是 `connection?.api` 恒为 `undefined`：卡片从不发起加载，目录永久停在 `loading`，
所有模型控件退化成手输文本框。这与 §R6 是同一类错误的第二次出现——**凭记忆猜平台 API**，
而它的失败模式是「静默降级」，没有任何闸门会红。

### R7.2 审计发现（按影响排序）

| 发现 | 为什么算问题 | 处置 |
|---|---|---|
| 模型只能手输（R7.1） | 配置的核心输入靠记忆，provider/model 都易拼错 | **修**：接 `remote.session.modelCatalog()`，按 provider 分组下拉 |
| provider 列不出模型时控件静默变空/变手输 | 用户分不清「没有模型」与「列不出来」 | **修**：`failures` 逐行给出原因 |
| 目录只在挂载时读一次 | 在 Models 页新增 provider 后卡片不刷新 | **修**：`llm/adapters-updated` / `settings/document-updated` / `credentials/reference-updated` / `connection/reset` 触发重读（与官方选择器同一组触发器） |
| 行序即优先级，但只能删了重加 | 调整 failover 顺序代价高 | **修**：↑ / ↓ 重排 |
| 数值字段是自由文本 | 越界值只能等保存时报错 | **修**：`type=number` + schema 的 `min`/`max`/`step`，用 parity 测试钉住 |
| `legacy` / `optional` 语义只有 CLI 看得到 | 卡片把「已接受但被忽略」的字段当活配置展示 | **修**：行内标注 |
| 启动日志里的告警（空链、两档同模型）在标准 profile 不可见 | SPEC §13：stock profile 没有 log sink | **修**：同判据改为卡片内联 |
| 折叠时头部不表达任何信息 | 要展开才知道配成什么样 | **修**：头部摘要（模式 + 两档模型数） |
| 0–1 概率仍用数字框；长表单无过滤；卡片不显示运行期状态 | 可用，非必要；运行期状态需要卡片不具备的通道 | **缓**：记入 SPEC §12.3 末段 |

### R7.3 交付与闸门

| Gate | 内容 | 变异自检 |
|---|---|---|
| `tests/model-catalog.test.ts` | 真实响应信封的映射：分组、provider 级失败、`ok:false`、传输层抛错；不再用手写的成功对象 | 忽略 `failures` / 不看 `ok` → **红** |
| `tests/client-form.test.ts`（新增 parity） | 卡片声明的 `min`/`max`/`step` 与 `src/config.ts` 的 schema 边界逐字段一致 | 改一个上界 → **红** |
| `tests/client-ux.test.ts` | 纯函数：θ 提示、头部摘要、链告警（空链/重复/两档同模型/legacy 生效） | 关掉任一判据 → **红** |
| `tests/client-card-slot.test.ts` | 新增：`remote` 缺席时卡片仍注册成功，且状态明确说出「目录不可用」（降级而不是消失） | 去掉显式的不可用状态 → **红** |
| e2e（settings-probe） | 让 fixture 的假适配器实现 `listModels()`，并读回 **Host 侧目录**（`buildModelCatalog`，`/model` 选择器自身的构建器），断言部署确实 advertise 了配置的路由 | 目录为空/名字与数据源不符 → **红** |

规范落点：SPEC §12.2（模型来源）、§12.3（交互规则）、§14（闸门）。

### R7.4 残余不确定性

- 目录内容仍在**浏览器**里渲染：本轮可验证的边界是「纯映射 + 契约形状 + e2e 的 Host 侧目录」，
  下拉框本身的观感只有人工浏览器步骤（CONTRIBUTING「Manual browser E2E」）能看到。
- `min`/`max`/`step` 是**镜像**而非共享：客户端 bundle 不能引入 `@deepseek-ai/schemastery`
  （它不是平台 seed word），所以边界靠 parity 测试在两处定义之间对齐，而不是靠同一个常量。

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
| SDK 升级（E5） | 上一轮不做；**由 e2e 证据升级为 P2**，P2 轮已完成 | 见 R4.1 |
| skill 0.4.0 回灌远端 | 未执行（推远端属发布动作，需显式批准） | 已安装副本 0.3.0 与远端一致，API 内容无差异；0.4.0 仅为自更新流程 |

---

## 下一轮建议顺序（R3 更新）

1. **SDK 基线补齐**（E5）——先做，否则后续新代码要改两遍，且双版本风险仍在。R3 新增
   证据：运行时是 cordis 4.0.2 + `@deepseek-ai/*` 0.1.5-rc.2，项目 pin 仍是 4.0.1 +
   0.1.0-rc.6；把 `@deepseek-ai/dsh-tool-subagent` 纳入类型依赖后，
   `subagentModelSelection` 就不必再靠结构化探测。
2. **P2 编排深度**：验收审计 → 收敛协议 → 每 worker 成本归因 → C4(a) 白名单写入。
3. **P3**：模型目录单一事实来源、配置层权威展示、覆盖率门槛、打包隔离闸（R3 已用
   `plugin-load.test.ts` + 默认配置 e2e 覆盖了其中一半：**加载期接线**）。
4. **R3 遗留（新增）**：
   - `src/index.ts` **事件回调内部**仍无单测（`agent/pre-step` 清扫顺序、
     `agent/request-error` 冷却分支）——`plugin-load.test.ts` 只覆盖加载期；
   - `stats.ts` 置信度分桶 0.7 与若干展示截断（已按"纯展示、非部署可变"记录为可接受，
     若追求零硬编码可改成配置或直接显示原值）；
   - `ux.routerLogVerbose` 的实际可见性受部署是否挂日志 sink 影响，README 已如实标注；
     若要"自带 profile 就能看到路由日志"，需要另找用户可见面（如把最近决策放进
     `/router status`——`Last decision` 行已经承担了一部分）。

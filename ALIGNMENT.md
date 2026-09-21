# dsh-shift-router × pi-shift-router 上游对齐审计

> **本文件是审计与理由记录**：上游 `pi-shift-router`（HEAD `69ffb34` / v1.6.0）自本项目派生点以来
> 新增或修正的内容里，哪些必须对齐、哪些必须换成 DSH 等价物、哪些明确不对齐，以及每一轮的证据与
> 残余不确定性。**规范契约在 [`SPEC.md`](SPEC.md)，状态与历史在 [`ROADMAP.md`](ROADMAP.md)** ——
> 同一件事不在这里再写一遍。

## 修订记录

**R3（安装验证轮：一次真实的 P0 热修，已交付）** — 维护者按推荐路径把本插件装进真实 `web`
profile 后 **DSH 无法启动**：

```
Error: dsh: plugin tree failed to load: failed to apply loader entry shift-router
  (dsh-shift-router): cannot get property "subagentModelSelection" without inject
```

上一轮声明「已安装并验证」是**不成立的**：那条结论只验证到组合层（`dsh plugin add` +
`--dump-config`），而 `--dump-config` **只组合配置、从不实例化插件**；真正的启动从未被验证，而
E2E 恰好把 `orchestration.mode` 钉成 `off`，绕过了出事的那条分支。根因、修复、新增闸门与合规
审计见「R3：安装验证轮（P0 热修）」一节。

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

### 0.1 本项目的上游基线判定

按证据还原：本项目首个提交 `58b0cb6` 日期 **2026-08-14**；上游 `v1.0.0` tag 日期同为
**2026-08-14**（task-level orchestration 落地），`v0.10.0`（cache-aware）为 08-12；本项目代码里
已同时存在 cache-aware、置信度加权滑窗、cost telemetry、orchestration + 硬帽，对应上游
v0.9.0–v1.0.0。

**结论：本项目基线 ≈ 上游 v1.0.0（2026-08-14），未对齐区间 = 上游 v1.0.1 → v1.6.0。**
版本号策略与对齐目标以 [`ROADMAP.md`](ROADMAP.md#upstream-alignment) 为准（本项目走自己的发布线，
不追求与上游数字一致）。

### 0.2 DSH 开发技能（`dsh-plugin-dev-skill`）

本仓库的开发约定与该项目对齐，且每次载入该技能都执行其 §0.1 的版本检查流程（读本地 `VERSION`
→ 取远端 → 语义化比较）。技能自身的版本与更新属于该技能仓库的事务，不在本审计范围内。

---

## 1. 第一性原理：哪些能搬、哪些必须重设计

### 1.1 职责边界（决定一切的第一原则）

本插件是**决策层**：读判定 → 选档 → 选模型 → 切模型 → 兜底 → 记账。它不是**表现层**，也不是**传输层**。
因此：上游凡是「把决策结果渲染给人看」的部分（pi-tui 面板、footer 状态栏、`ctx.ui.*` 交互），
**只搬语义、不搬实现**——落到 DSH 的 GUI 卡片 + `ctx.commands` 输出上。

### 1.2 Harness 机制映射表的结算状态

Pi 机制 → DSH 等价物的逐项映射是**规范**，只有一处：**SPEC §1.1**。这里只保留映射的*状态*——
映射之后仍未闭合的项，其余一律「✅ 已适配」：

| 上游机制 | 映射到什么 | 状态 |
|---|---|---|
| 三层 JSON 配置 | settings namespace + patch overlay | ✅ 已换实现；**层级权威展示**仍未做（D2 → ROADMAP Planned） |
| `pi.modelRegistry` | `ctx.llm.listProviders/listModels` + `resolveModelInfo` | ⚠️ 部分使用：目录已是卡片与探针的来源，价格表尚未被它替代（D3） |
| `pi-subagents` 的 per-run `model` | `subagent` / `subagent_fork`；per-call `provider`/`model` 受宿主白名单管控 | ⚠️ 关键约束（C4），规范见 SPEC §7.4 |
| `console.log` / 终端输出 | `ctx.logger` + 路由通知（SPEC §13.1） | ✅ 已换；文件 sink 明确**不做**（D1） |
| `pack:check` / `check:isolated` | `dsh plugin add` + tarball 隔离安装验证 | ✅ 已造等价物（E4，见 R3/R4） |

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

## 2. 对齐工作清单（R1 首轮，已全部结算）

首轮按 P0–P4 分级列了 33 项（A1–A8 正确性、B1–B6 决策核心、C1–C7 编排深度、D1–D6 诊断与
UX、E1–E6 工程与发布）。**每一项都已结算**，结论分布在下面这些地方，这里只留索引：

| 级别 | 结算结果 | 落在哪里 |
|---|---|---|
| P0 正确性（A1–A8） | 全部落地；A3/A4 经 R2 改为「删除本插件重复的 TPS 机制」而非移植 | SPEC §3 / §5 / §8 / §9；「交付核对」表 |
| P1 决策核心（B1–B6） | 全部落地（EV 路由、档位预设、`decisionTier`、Judge 第 4 键 `orchestrate`） | SPEC §2 / §3 / §6；「交付核对」表 |
| P2 编排深度（C1–C7） | C1/C2/C3/C5/C7 落地；C4 以 (b) 起步、其后以 `/router allow-workers` 交付 (a)；C6 不对齐（上游亦未落地） | R4 各节；SPEC §7.3–§7.4 |
| P3 诊断与 UX（D1–D6） | D1「不落盘，用 `ctx.logger` + 路由通知」；D2/D4/D5 部分落地（卡片与命令面）；D3 的原则落地（卡片目录即单一来源），价格表替代仍未做 | SPEC §9 / §12 / §13；ROADMAP Planned |
| P4 工程与发布（E1–E6） | E1/E2/E4/E5/E6 闭环；E3（覆盖率门槛）仍在 Planned | R3 / R4 各节；ROADMAP Planned |

被取代的逐项工作表（当时的行号引用与第一性原理长论证）留在 git 历史中：要追溯某项的原始论证，
看那一轮提交的 diff，而不是在这里维护第二份。

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
| `npx vitest run` | ✅（R3 当时 216 项 / 12 文件；v0.6.0 为 336 / 18） |
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

### R3.5 附带发现：告警发到了没有人看得见的地方

Cordis 的 logger 只写内存环形缓冲（1000 条）并投递给已注册的 exporter，而**自带组合一个
exporter 都没注册**——所以上一轮「启动日志会显示 `[shift-router] loaded …`」的说法是错的，
`ux.routerLogVerbose` 的可见性也被高估。它推翻了 C4(b) 的交付形态：「启动自检告警」若无人可见，
等于没交付。因此同一事实补到用户真正会看的界面（`/router status` 的 `Worker delegation:` 行），
并把结论写成规范：**自带 profile 下「用户必须能读到」的信息只能走命令或路由通知，不能走日志**
（SPEC §13、§13.1）。

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

### R3.9 与 P2 的关系，以及 R3 的闸门结果

R3 修的是上一轮**新引入的 P0 缺陷**（服务访问方式，1 处代码），不是"未完成的 SDK 迁移"——把
`@deepseek-ai/*` 从 `0.1.0-rc.6` 升到 `0.1.5-rc.2` 并不会修掉它，`inject` 语义两版一致。因此
SDK 基线补齐保持为**独立**的下一轮工作，并因 R3 的证据升级为 P2（已在 R4.1 完成：当时运行时是
cordis 4.0.2 + `@deepseek-ai/*` 0.1.5-rc.2，而项目 pin 仍是 4.0.1 + 0.1.0-rc.6）。

R3 收尾的闸门全绿：宿主与客户端 `tsc`、`vitest`（当时 228 项 / 13 文件）、`build`、e2e 三场景
+ 设置往返；变异自检同时让 3 个单测与 2 个 e2e 场景变红（还原后全绿）。

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
| 运行时 **值导入** 在目标 profile 解析不到 | 从**构建产物**反查：`dist/*.js` 的外部 specifier 只有 `@deepseek-ai/dsh-llm`、`@deepseek-ai/schemastery` —— 二者现在都是 `peerDependencies`（R10 起；宿主负责唯一实例） | 新增 `packaged-install.test.ts` 把这条钉死（把 `dsh-llm` 移出向消费者声明的字段 → 测试红） |
| 浏览器半边解析不到模块 | 从 `dist/client.js` 反查 `require()`：`@deepseek-ai/dsh-client-store`、`react`、`react/jsx-runtime`；对照前端 boot 的 `staticModules`（seed 表：react / react-dom / cordis / **dsh-client-store** / dsh-client-ui-slots / -primitives / -dockkit） | 三者都是 **平台 seed word**，由 shell 恒定提供；另加 gate 断言「requires ⊆ seed ∪ dsh.client 声明」 |
| 客户端 roster（`dsh.client.inject`）指向不存在的包 | 读 `dsh-client-modules` 的装载实现：未知 id **静默跳过**（`if (dependency !== void 0)`），不会抛 | **不是启动杀手**，但确实是错的：该字段仍写着基线已删除的 `@deepseek-ai/dsh-client-runtime`；已改为 `@deepseek-ai/dsh-client-ui-renderer`（`ctx.slots` 的声明方，卡片真正依赖它），并删掉无 `dsh.client` 声明的 `dsh-client-ui-slots`；gate 会拦「重新写回被删包名」。**（R7 起 roster 为 5 个 id：`dsh-client-connection`、`dsh-client-locale`、`dsh-client-ui-renderer`、`dsh-client-ui-settings`、`dsh-api-remotes` —— 见 SPEC §1.5）** |
| 配置差异导致只在该配置下抛错（R3 的教训） | `plugin-load.test.ts` 新增 5 组真实加载：空 config 行、`enabled:false`、`routing.mode: manual`、`off`、`orchestration.mode: off`、空 Fast 链、完整 costs/audit 配置 | 全部加载成功 |
| 打包产物缺文件 / 依赖缺失 | 新增 `npm pack` → 装进第二个 scratch profile（`web`）→ **真实启动** 的 e2e 场景；tarball 安装**不含 devDependencies** | ✅ 进入 serving 状态，无 plugin tree 报错 |

### R5.2 新增闸门与自检

| Gate | 内容 | 变异自检 |
|---|---|---|
| `tests/packaged-install.test.ts` | 宿主产物外部导入 ⊆ `dependencies` ∪ `peerDependencies`；浏览器 `require` ⊆ seed ∪ `dsh.client`；roster 不得再写回已删除包；`files` 完整性；双面 exports + bundle patch | 把 `dsh-llm` 移出向消费者声明的字段 → **红**；roster 写回 `dsh-client-runtime` → **红**；给 `dist/client.js` 注入未声明 `require` → **红** |
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
  （CONTRIBUTING「Browser check (the card)」）覆盖：渲染期崩溃是下一层，需要真机打开面板才能确认。
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
  下拉框本身的观感只有那次浏览器检查（CONTRIBUTING「Browser check (the card)」）能看到。
- `min`/`max`/`step` 是**镜像**而非共享：客户端 bundle 不能引入 `@deepseek-ai/schemastery`
  （它不是平台 seed word），所以边界靠 parity 测试在两处定义之间对齐，而不是靠同一个常量。

---

## R8：设置面板第二轮——布局缺陷与信息架构

R7 之后维护者在真机上提出的两点：**模型行里的元素位置重叠**，以及**整页内容繁杂**（模型配置尚直观，
其余混在一起看不下去），要求把高级项收进一个默认折叠的分组，并把所有描述文字从用户视角重写。

### R8.1 布局缺陷：先量出来，再修

用真实浏览器（Chromium + `e2e/browser-check.mjs`）打开卡片的
「插件配置」页、展开卡片、给 Fast 链加两行，然后对卡片内**最内层可见元素**做两两包围盒相交检测：

```
boxes: 156 | overlaps: 21
  span("主选")      ∩ select("Provider…") = 10×16px
  span("备选 1")    ∩ select("Provider…") = 18×16px
  input("")         ∩ span("ms")          = 17×15px
  input("")         ∩ span("tokens")      = 38×15px
  … 其余 17 条同类（每个带单位的数字输入都命中）
```

三处根因，都是「用固定尺寸容纳可变内容」或「用覆盖代替布局」：

| 缺陷 | 根因 | 修法 |
|---|---|---|
| 行角色徽标压住 provider 下拉 | 行网格第一列写死 `20px`，而 R7 把原本一位数字换成了 `主选` / `备选 1` 文本 | 该列改为按内容定宽，整行从 grid 改成 flex：徽标 `flex:none`、两个控件 `flex:1 1 0; min-width:0`、操作为 `flex:none` |
| 单位文字（`ms`/`tokens`/…）压住数字输入 | 单位被绝对定位在输入框内部（`right:12` + `paddingRight:54`），R7 把输入改成 `type=number` 后，浏览器在右端画出的步进箭头正好落在单位文字上 | 单位移出输入框，作为普通 flex 兄弟节点（`gap:6`）；删掉 `position:absolute` 与 `paddingRight` 补丁 |
| 描述文字被截断（新增的溢出探针发现） | `.sr-hint` 上有 `-webkit-line-clamp:2; overflow:hidden`——早期短文案下的紧凑处理；R8 的文案变长后，最长的那几条直接被切掉 | 去掉 clamp：hint 是用户唯一能读到「这项设置做什么」的地方，不能截断 |

**这才是这类缺陷的正确闸门**：布局问题无法用单测表示，但**量得出来**。新增的
`e2e/browser-check.mjs` 用两个**互相独立**的探针把它变成可重复执行的检查（见 R8.4）：

- **包围盒相交**——看「盒子动了」：覆盖在原生控件上的东西（内部单位、绝对定位元素）会命中；
- **内容溢出**（`scrollWidth/​scrollHeight` vs `clientWidth/​clientHeight`）——看「墨迹溢出盒子」：
  固定轨道里的 `nowrap` 文本只会让文字溢出，盒子本身原地不动，相交检测**看不见**。

两个探针缺一不可：本轮的两个缺陷恰好一个属于前者、一个属于后者。

### R8.2 信息架构：默认视图只放「会改变路由行为的决定」

第一性原理：用户打开这张卡片只为了三件事——**用不用路由**、**两档各用什么模型**、
**路由有多激进**。其余 21 项都是「调内部参数」，它们平铺在同一页里，让前三个问题淹没在噪声中。

| 视图 | 内容 |
|---|---|
| 默认展开（9 项 + 2 条链） | 启用路由；Fast/Smart 模型链；路由模式；经济档位（预设）与返工代价 R；编排模式、最多委派轮数、任务预算、验收审计 |
| **高级**（默认折叠，21 项） | 裁判超时/输出上限/输入上限；降级记忆；决策窗口 3 项；缓存感知 4 项；升级阈值；worker 台账上限；审计超时/输入上限；失败退避 3 项；遥测容量；日志详细度；提示词顺序 |

- 分组沿用现有语义：高级区内部按 **裁判 / 经济 / 窗口 / 缓存 / 编排 / 失败退避 / 遥测 / UX** 分子标题，
  不新造术语。
- 「默认可见集合」由测试**逐个列出并钉死**（`tests/client-form.test.ts`）：以后想往默认视图加一项，
  必须显式改测试，不能顺手塞进去——这是防止「再次变乱」的机制，而不是一次性的整理。

### R8.3 文案：从用户视角重写

原来的 hint 是**实现视角**的：「θ = 1/R」「缓存除数」「worker 台账」「环形缓冲」「提示词段的排序位置」。
现在按三条规矩重写（SPEC §12.3）：

1. 先说**对你的请求做了什么**，再说**什么时候需要改**；
2. 内部词汇只在控件本身显示该词时才可用（θ 由经济档位下的派生提示行给具体数值，hint 里不再推导）；
3. 能用「默认值就够了」表达的，就明说，减少不必要的改动。

例：`h.promptSectionOrder` 从
「编排器系统提示词段落的排序位置。DSH 集中分配提示词顺序，未给第三方段落预留槽位，因此在此设置：150 表示位于 persona 前缀（0）之后、plan 策略（500）之前。」
改为「编排器指令在系统提示词中的位置。默认值 150 位于人设之后、计划策略之前，通常不必改动；只有当另一个插件也要占用这个位置时才需要调整。」

### R8.4 交付与闸门

| Gate | 内容 | 变异自检 |
|---|---|---|
| `e2e/browser-check.mjs`（可选、需浏览器，16 项断言） | 真机打开卡片的插件配置页：卡片存在且可展开；加两行模型后**包围盒两两相交数为 0**且**无文字溢出自身盒子**；每行控件共中线、控件宽度可用、hint 与 label 同列、每个可见字段都有描述、默认视图字段数 ≤ 12；provider 下拉里至少有 1 个部署提供的选项（目录真的加载了）；高级区默认折叠（`aria-expanded=false`）、展开后多出 ≥ 10 个字段且对齐依旧 | ①把行轨道改回固定 `20px` → **溢出探针红**（`主选 spills 10×0px`）；②把单位放回输入框内部 → **相交探针红**（`input ∩ span("rounds") = 39×15px`）；③恢复 `.sr-hint` 的 2 行 clamp → **溢出探针红** |
| `tests/client-form.test.ts` | 默认可见字段**逐个列出**并与实现比对；高级字段恰好是其余部分 | 把任一高级字段的 `advanced` 去掉 → **红** |
| `tests/client-ux.test.ts` | 高级字段的分组标题取自现有 `group`/`s.*` 键（不存在新造术语） | 给高级字段一个不存在的标题键 → **红** |

`e2e/browser-check.mjs` 不进 `npm test` / `npm run test:e2e`：它需要 `playwright-core` 与一个浏览器，
只应在改动卡片时手动执行（CONTRIBUTING 的手工浏览器步骤已被它取代）。

### R8.5 残余不确定性

- 相交检测覆盖的是**矩形重叠**，不是视觉美观：间距过小、对比度不足这类问题它测不出来，仍需人眼。
- 默认视图的内容划分是**产品判断**，不是可推导的结论；它是被测试钉住的**当前决定**，
  将来要改就改测试与 SPEC，而不是靠实现漂移。

## R9：运行时可观测性——「插件启用了，但我看不出它在跑」

维护者连续提出三个问题：① 看不到任何运行迹象（没有状态栏、没有工具栏、没有 judge、没有切换提示）；
② 会话里那句 `[model changed: …]` 是不是插件打印的；③ 如果是，文案要改好，否则用户不知道这是插件的信息。

### R9.1 先纠正前提：那行不是我们发的

| 问题 | 答案 | 证据 |
|---|---|---|
| `[model changed: …]` 是 shift-router 输出的吗 | **不是** | 生产者在 `@deepseek-ai/dsh-agent`：`lib/types/model-selection.js` 的 `modelSwitchNotice()` 构造 `createUserMessage({ source: { kind:'plugin', plugin:'model-selection', form:'notice', summary } })`，由该模块的 `agent/pre-step` 监听器在**会话选中模型**与上一次请求 `config` 不同时追加。shift-router 的 `src/`/`tests/`/`e2e/` 里 `model changed` 出现 **0** 次 |

所以维护者看到的每一次该提示，都是**会话级模型切换**（`/model`、模型选择器、`agent-default-model` 变化），
与逐请求的档位路由无关。这也解释了一个反直觉现象：**harness 会为「会话模型变了」插话，却不会为
「这个请求被路由到别的模型」插话**——而后者才是 shift-router 的工作。

### R9.2 「看不见」的三个独立原因

1. **机制上不留痕**：shift-router 从不改会话模型，只在 `agent/request` waterfall 里逐请求覆盖上线模型
   （SPEC §1.1）。UI 里没有任何一处会因此变化。
2. **运行面只有两个**：`/router …`、`/route-force` 命令（SPEC §11）与设置卡片（SPEC §12）。
3. **`ux.routerLogVerbose: true` 是空承诺**：它写 `ctx.logger`，而随发行版的 profile 不注册任何 exporter
   （SPEC §13 早已写明）。维护者把它打开、期待「每轮都能看到」，实际写进了没人读的 1000 条环形缓冲。
   这不是配置错误，是**缺口**：verbose 在语义上承诺了逐轮可见性，却没有任何可见通道。

### R9.3 可用面的普查（决定做什么、不做什么）

查遍 harness 的 `SlotMap`：**不存在 statusbar / toolbar 槽位**。可用的会话级面只有
`conversation.session.header.actions|utilities`（标题旁 list 槽）、`conversation.chat.node`（按节点 keyed）、
`rightbar.session` / `sidebar.right.pane.tab`（需要 dockkit tab 类型）、`settings.*`。

选**会话内 notice**（而不是硬造一个状态栏）的理由：

- 它是 harness 自己**已经证明可用**的通道（model-selection 就在用），第三方插件可以写；
- 语义最贴：路由切换是「刚刚发生的一件事」，而 notice 的定义正是 *one-off account of something that
  just happened*；
- 造一个常驻状态面需要替换 `main`/`sidebar`（会连带替换掉它声明的座位）或新增 rightbar tab 类型，
  成本与收益不成比例。

**明确不做**：修改上游那句 `[model changed: …]`。它在 `node_modules/@deepseek-ai/dsh-agent` 里，改它等于
patch 上游、升级即丢；而且 `plugin` 字段（`model-selection`）**在 UI 里从不被渲染**——`NoticeBody`
只画 content，折叠行只读 `summary`（`dsh-client-ui-chat/lib/client.js`）。正确的结论不是「去改上游文案」，
而是「**我们自己的通知必须自带署名**」，这条已写成 SPEC §13.1 的规范。

### R9.4 交付与闸门

| Gate | 内容 | 变异自检 |
|---|---|---|
| `tests/route-notice.test.ts` | 纯函数：档位或模型变化且解析到了模型 → 必发；provider 相同用短名、不同用 `provider/model`；`[shift-router]` 前缀；`summary` 受 120 字符约束；judge 无 `reason`/`confidence` 时不出现空字段；held、initial 的措辞 | 去掉前缀 → 红；去掉 provider 比较 → 红 |
| `tests/plugin-load.test.ts` | `agent/pre-step` 监听器返回的决定带上了 notice 消息（真上下文加载，消息形状按 harness 的 `UserMessage` 校验） | 不追加消息 → 红 |
| `npm run test:e2e` | 真实 harness 跑一轮路由，fake adapter 见证模型请求里带上了 `[shift-router]` 消息（`notice=yes`） | 不写消息 → 红 |

### R9.5 残余不确定性

- notice 只在 **step 1**（轮次开始）发：一轮内多次 failover 那一刻没有消息通道，故不报；下一轮的
  notice 会报出它实际使用的模型。
- 文案是英文：这条消息同时进入模型请求，而 judge 的 `reason` 本身就是英文短语。
- `source.plugin` 目前在 UI 里不可见；若上游将来渲染它，我们的 `[shift-router]` 前缀会略显冗余——
  宁可冗余，不可无名。

## R10：打包与分发——对齐生态约定

维护者要求调研「DSH 生态主流插件的发布/安装方式与官方推荐途径」，并据此检查文档与项目配置。

### R10.1 官方与生态的实况

- `dsh plugin --profile <name> <args…>` 在 profile 目录内**转发给 pnpm**（官方
  `docs/user/develop/basic/publish.zh.md`）。安装通道四条：npm 包、tarball、
  `github:owner/repo`、本地目录。
- 官方明确建议分发**构建产物**（npm / tarball），免得用户为 git 依赖授权构建；git 通道
  必须提供自包含的 `prepare`，用户须把包键加进 profile 的 `pnpm-workspace.yaml`
  `allowBuilds`（pnpm ≥ 10 默认拒绝），并锁定 commit。
- 官方给出的唯一「被发现」途径：插件仓库加 GitHub topic **`dsh-plugin`**
  （DeepSeek README「社区与支持」）。本仓库已有该 topic，另有
  `deepseek-harness-plugin`、`dsh-plugins`。
- 生态实况（npm registry 实测）：第三方插件主流是发布 npm 包
  （`dsh-plugin-model-proxy`、`dsh-plugin-guide`、`dsh-plugin-appshot`…）；社区目录
  dsh-plugin.org 与 dsh-plugin-shop 均以「GitHub topic + npm」为数据源，安装走
  npm / GitHub / DSH CLI 三通道；社区工具链 `dsh-plugin-dev check/verify` 定义了静态约定。

### R10.2 据此改了什么

| 项 | 之前 | 现在 | 理由 |
|---|---|---|---|
| harness 包声明 | `dependencies` 精确 `0.1.5-rc.2`（其中 6 个只用于类型） | `peerDependencies`（`cordis`、`dsh-llm`、`schemastery`），其余进 `devDependencies` | 编译产物只 require 这三个；宿主必须是唯一实例——私有副本会让插件与宿主各自持有同一 SDK 的不同模块实例 |
| `engines.node` | `>=22.0.0` | `^22.19.0 \|\| >=24.0.0` | 生态的支持运行线（社区检查器亦按 22/24 判定） |
| `prepare` | 含两次类型检查 | `tsc --noCheck`（产物与完整构建**逐字节相同**，已比对） | git 通道的构建在陌生人的机器上执行，类型错误会变成**用户的安装失败** |
| `prepublishOnly` | 无 | `typecheck && test` | 注册表之前的最后一道门 |
| 安装文档 | 只有本地 / git 两条 | 四条通道 + `--dump-config` 验证 + patch 覆盖语义 | 与官方文档一致 |
| README | 无生态标记 | `dsh-plugin` 徽章 | 官方推荐的发现途径 |

`main` 由 `./dist/index.js` 改为 `dist/index.js`，仅因社区检查器不做前导 `./` 归一化，
Node 的解析语义不变。

### R10.3 明确不照抄的一条

社区检查器的 `manifest-peers` 要求「src 中出现的每个 `@deepseek-ai/*` 都声明为 peer」，
并为每类写死 range（`dsh-*` 一律 `>=0.1.2-rc.1 <0.2.0 || …`）。我们**不**照抄：

1. **它在子路径导入上不可满足。** 其正则把 `@deepseek-ai/dsh-api-remotes/client` 整体当作
   包名，于是要求声明一个名为 `@deepseek-ai/dsh-api-remotes/client` 的 peer——那不是合法
   包名。照抄等于把一个假包名写进 `package.json`。
2. **它的 range 比事实更宽。** `>=0.1.2-rc.1` 会放行比本构建所用 API 更旧的 harness，
   而 `form: 'notice'` 这类形状是 0.1.5-rc.2 才有的。

采用的规则因此是：**只把编译产物运行时真正 require 的包声明为 peer**（SPEC §1.5）。
这条差异是刻意保留的，记录于此以免后人「顺手修好」。

### R10.4 残余不确定性

- pnpm 的 `auto-install-peers` 默认开启，理论上会在 profile 树中解析不到 peer 时去 npm 取一份，
  从而装出与 harness 不同版本的重复实例——正是 peer 声明要避免的。**实测否定了这个担忧**：
  `npm run test:e2e` 的打包安装（干净 scratch profile，装的是 0.6.0 的 tarball）之后，
  profile 的 `node_modules` 里只有 `dsh-shift-router` 一个条目，`@deepseek-ai/*` **零副本**，
  且该 profile 启动、路由、卡片与设置回写全部通过。内置组合包名从 dsh 安装目录解析这条官方
  说明（§R10.1）在安装层得到证实。
- 社区 CLI `dsh-plugin-dev check` 未在本机执行（它是要在本机运行第三方代码的工具）。本文引用
  的规则读自其源码，未运行其判定；因此本轮的「对齐」是按**读到的规则**对齐，而非按检查器的
  通过/失败结论对齐。

---

## R11：文档分工、结构，与模型文档

维护者要求：① README 的架构目录移入 CONTRIBUTING 作为唯一权威；② README 徽章补 npm 页面与适配的
DSH 版本；③ 学上游加 `See also`（dsh-plugin-dev-skill、obsidian-llm-wiki、pi-shift-router）；
④ 通读全部文档后**先想分工再正交化**；⑤ 迁移并修订上游 `docs/MODELS.md`（中英），模型事实必须按
来源调研、不能凭记忆。

### R11.1 分工：本轮的第一性原理，已落成规范

七份文档、七个职责，一个事实只有一个家，跨文档只能引用。整张表写进了
`CONTRIBUTING.md` § Documentation ownership —— 成为贡献者可见的规则，而不是只活在本轮对话里：

| 文档 | 拥有 | 不得包含 |
|---|---|---|
| README（中英） | 用户要做的事：安装、配置、命令、示例、徽章 | 规范规则、逐轮理由、仓库结构图 |
| docs/MODELS（中英） | **如何选**档位模型的指导，附来源与日期 | 「你的部署能调用哪些模型」——那由运行时目录拥有 |
| SPEC | 规范契约 | 历史、理由、测量数字、逐轮叙述 |
| ALIGNMENT | 审计：证据、决定、刻意不对齐、残余不确定性 | 规范规则、状态表 |
| ROADMAP | 状态与历史 | 理由细节、测量数字 |
| CHANGELOG | 按版本的变更清单 | 叙述与设计论证 |
| CONTRIBUTING | 贡献者流程：开发循环、仓库结构、闸门、分发、发布 | 面向用户的 how-to |

### R11.2 据此做了什么

- **仓库结构图**从 README（中英）移入 **CONTRIBUTING § Repository layout**，README 只留指针。
- **README 徽章**补两项：npm 版本徽章（指向 npm 包页）与 **DSH 0.1.5-rc.2** 徽章 —— 后者是本项目
  构建与验证所依据的 harness 版本，取自 `dsh --version` 与 npm 上 `@deepseek-ai/dsh` 的
  `dist-tags`（`latest = 0.1.5-rc.2`）。
- **`See also`**：学上游的章节结构，但**不照抄它的链接**。上游 README 指向
  `green-dalii/obsidian-llm-wiki`，而该仓库已迁移到 **`GD4AI/obsidian-llm-wiki`**（维护者确认：新建
  GD4AI org 后迁移），上游那条是 404。三条目的简介均取自各自 GitHub API 的仓库描述，不是回忆。
- **示例模型过时**：README 演示块在用 `deepseek-v4-flash` / `deepseek-v4-pro`（V4 代）。按 harness
  自己的 `@deepseek-ai/dsh-llm-deepseek` 的 `DEFAULT_MODELS` 核对，当前默认是
  **`deepseek-flash`，显示名 `DeepSeek-V41-Flash`**（V4.1，且 `inputModalities: ["text","image"]`）。
  示例已改用 harness 官方目录中的 id（Fast `deepseek-flash` → Smart `deepseek-v4-pro`，故障转移
  落到 `deepseek-v4-flash`），不再出现任何私有 provider 名。

### R11.3 `docs/MODELS.md` 的迁移原则

上游同位置有 `docs/MODELS.md` + `docs/MODELS.zh-CN.md`（各约 10 KB，且与我们的 `.zh-CN.md` 命名
一致）。迁移保留其**结构意图**（Fast/Smart 各自选什么、provider 家族、成本与延迟权衡、链的顺序、
何时让两档共享 provider），替换掉 pi 专有机制（`models.json`、`expandEnv`、`pi.modelRegistry`、
pi 向导语法），并执行维护者的硬要求：**每条模型事实都要有来源与取用日期** —— 取自 harness 自身
adapter 的 `DEFAULT_MODELS`、真实部署的 `~/.dsh/settings.yaml`（标注为「某部署的示例」而非通用
清单）、OpenRouter 公开模型 API 与官方 provider 指南；无法核实的一律不写。

## 明确不对齐（附理由）

规范清单只有一处：**SPEC §16**（每条附理由，含上游开发流程约束这类非产品行为）。本审计不再
维护第二份表格——两份必然漂移。需要新增理由时写回 SPEC §16，这里只保留历史决策编号（D3/D4 等）
的上下文，见上方各轮小节。

---

## 决策记录（R1–R2，仍然生效的部分）

| 问题 | 决定 | 落地 |
|---|---|---|
| EV 是替换还是并存 | **替换**。两套语义并存会长期污染文档与测试 | `router.ts` 只保留 EV 路径；旧规则的代码被删除而非保留 |
| worker 模型注入（C4） | 按建议 (a)+(b)；本轮交付 (b)，(a) 随后以命令形式落地 | SPEC §7.4、§11；C4 现状见 R4 |
| 版本号策略 | 本项目保持**自己的发布线**，另记「对齐到的上游版本」 | README 顶部基线行 + ROADMAP「Upstream alignment」 |
| `/router on\|off` 持久性 | 保持**会话级**（DSH 语义自洽）+ 文档写明 | SPEC §10、README 命令表 |

---

## 下一轮做什么

见 [`ROADMAP.md`](ROADMAP.md) 的 **Planned** 表 —— 它是待办与状态的唯一来源，本审计不再维护
第二份。按该表口径，R10 时仍未闭合的是：GUI（卡片按钮）形态的 worker 路由授权、v1.6.0 的价格
单一事实来源，以及 `agent/request-error` 冷却分支的单测。

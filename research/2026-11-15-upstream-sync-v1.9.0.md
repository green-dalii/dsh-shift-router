# 上游同步评估：pi-shift-router v1.6.0 → v1.9.0

- 日期：2026-11-15
- 上游：`/Users/greener/project/pi-shift-router`，main `bc07cfa`，最新 tag `v1.9.0`（2026-11-13）
- 下游：`dsh-shift-router` v0.8.0，对齐基线 v1.6.0，v1.7.0 已由 R12 轮移植
- 状态：分析完成。P0/P1/P2 已在工作区实现（未发布）；决策与证据记入
  [`ALIGNMENT.md`](../ALIGNMENT.md) §R16，规范改动见 [`SPEC.md`](../SPEC.md) §7.1/§7.3/§7.4/§7.6。
- 本文是分析快照，发布状态以 ROADMAP 为准。

---

## 0. 结论

1. **v1.7.0 已完整移植。** 新工作是 v1.7.1、v1.7.2、v1.8.0、v1.9.0 四版，外加 v1.9.0 后的 4 个 CI/发布提交。
2. **真正要同步的是 v1.9.0 的编排正确性，不是 v1.8.0 的 classifier 层。** v1.8.0 的核心依赖 pi 的 classifier API，DSH 没有对应物，不可移植。
3. **最大发现：DSH 的 `subagent` 是异步 activation，插件把"启动收据"当成"完成"。** 这是上游 v1.9.0 #57 的同型缺陷。但修复不能照抄上游的 receipt 文本检测，必须走 DSH 原生路径。
4. **推荐顺序：** P0 修编排结算（阻塞式委派工具，或摄入 `subagent-settled`）→ P1 修门槛与预算默认值 → P2 修工艺与打包门禁。
5. **不可移植：** OpenCode 会话归属头、pi classifier 层、pi 的 wizard 目录刷新、pi-subagents 的 management 调用、pi-tui peer 机制。

一句话判断：**上游 v1.9.0 是"把异步委派记账修对"；DSH 的异步模型更彻底（工具立即返回、完成靠消息唤醒），所以这次同步不是抄代码，而是把同一类语义用 DSH 的 API 重做。**

---

## 1. 版本事实

| 版本 | commit | 日期 | 核心内容 | 对 DSH |
|---|---|---|---|---|
| v1.6.0 | `4d1b546` | 2026-09-18 | 对齐基线 | ✅ 已对齐 |
| v1.7.0 | `932675d` | 2026-09-23 | judge 来源、Jev、可用性阶梯 | ✅ R12 已移植 |
| v1.7.1 | `7173bf8` | 2026-10-15 | OpenCode 归属头、pi-tui 降 peer、零运行时依赖、打包门禁 | ◐ 原则可借，机制不可移植 |
| v1.7.2 | `d701482` | 2026-10-15 | 配置向导不等 registry 刷新（4302ms → 4.3ms） | ✅ 无对应问题；⛔ 刷新入口不适用 |
| v1.8.0 | `b368c65` | 2026-10-24 | decision judge 走 pi classifier 层；orchestrate 传递修复；TypeSafe `/v1` 修复 | ⛔ classifier；✅ orchestrate；✅ `/v1` |
| v1.9.0 | `98a6a88` | 2026-11-13 | 编排可观测性：收据≠完成、后台完成摄入、轮预算 3→6、门槛读 verdict、审计容忍在飞、向导编排菜单 | ❌ 基本缺失；有同型缺陷 |
| post-v1.9.0 | `51284af`…`bc07cfa` | 2026-11 | OIDC 发布、prepublish 顺序、lockfile 可移植 | ◐ 仅 lockfile 对下游有行动价值 |

补充：上游 SPEC/源码把两次发布错记为 `v1.7.3` / `v1.8.1`，实际 tag 是 `v1.8.0` / `v1.9.0`。读上游注释时不要按 `v1.8.1` 搜索。

---

## 2. 同步矩阵

图例：✅ 已有 / ◐ 部分或需适配 / ❌ 缺失 / ⛔ 不可移植。

| # | 上游变化 | DSH 现状 | 判定 | 建议 |
|---|---|---|---|---|
| A1 | Judge/audit 直连带 OpenCode `x-opencode-session` | DSH 走 `ctx.llm.stream()`，无 session 头概念 | ⛔ | 不移植。decision 直连可加 `attributionHeaders()`，低优先 |
| A2 | host bundle 只做 peer，零运行时依赖 | 无 `dependencies`；dist 只导入 `dsh-llm`、`schemastery` | ✅ | 不动 |
| A3 | 打包门禁：host 包不得进 deps；禁止动态导入触达 host bundle | `packaged-install.test.ts:61-91` 只查"已声明"；`:93-102` 是 `|| true` 恒真 | ◐ | 补两条断言，半天 |
| B1 | 配置向导不 await registry 刷新 | DSH 的 `modelCatalog()` 不刷新；卡片事件驱动 | ✅ | 不动 |
| B2 | picker 每次打开重读目录 | `src/client/controller.ts:157-162` 已有刷新 | ✅ | 可选：加 generation 序号 |
| B3 | `🔄 立即刷新目录` | DSH 无 `models.json` 手改场景 | ⛔ | 不做 |
| C1 | decision judge 走 pi classifier 层 | DSH `dsh-llm` 无 `classify`；自建 POST | ⛔ | 保持 R12.1 分层 |
| C2 | classifier 目录（53 模型） | 无目录可枚举 | ⛔ | 不做 |
| C3 | `orchestrate` 由 `noul` 改 `bool` + `probability` | DSH 仍 `noul`；TypeSafe 实测接受 | ◐ | 不急；可双兼容 |
| C4 | judge 的 `orchestrate` 真的进入决策 | DSH 已传入 `shouldOrchestrate` | ✅ | 不动 |
| C5 | TypeSafe 官方 host `/v1` 前缀 | DSH 自己拼 `/v1/systemone`，真机 200 | ✅ | 不动 |
| C6 | classifier 错误文本抽状态码 | DSH 走 HTTP status | ◐ | 无需 |
| D1 | 轮次在 dispatch 计 | DSH 已是 dispatch 计 | ✅ | 不动 |
| D2 | **启动收据不算完成** | `done += 1` 无条件；收据文本进 evidence | ❌ **P0** | 见 §3 |
| D3 | **后台完成被摄入** | 未读 `subagent-settled` | ❌ **P0** | 见 §3 |
| D4 | `/router status` 报 in-flight | 无 `pendingDispatches`；`done/spawned` 恒 N/N | ❌ | 随 P0 一起 |
| D5 | 审计把在飞当 deferred | `audit.ts:214`：`done >= spawned` 恒真 | ❌ | 随 P0 一起 |
| D6 | reviewer 不单独占轮 | DSH 无 reviewer；每个 subagent 调用都计一轮 | ◐ | 不照搬；DSH 的 CTO 自己 review |
| D7 | 轮预算 3→6，范围 1–20 | 默认 3，范围 0–100 | ❌ **P1** | 见 §5 |
| D8 | legacy 3→6 迁移 | 无迁移 | ❌ **P1** | 见 §5 |
| D9 | 编排门槛读 verdict | 读 `decisionTier`；fast verdict 在 smart 层会误编排 | ◐ **P1，语义冲突** | 见 §4 |
| D10 | prompt：`async:false`、命名 reviewer、删 escape hatch、禁 workflow | prompt 写 `run_in_background` / `job_output`（DSH 无此参数）；保留 escape hatch | ❌ | 见 §3.3 |
| D11 | management 调用不占轮 | DSH subagent 无 `action` 参数 | ⛔ | 不做 |
| D12 | 向导编排菜单、主菜单预算摘要 | 配置项已有（卡片 + 命令）；卡片头摘要不含编排 | ✅/◐ | 可选 |

---

## 3. P0：异步委派与结算（最重要）

### 3.1 事实链（全部实测）

**DSH 侧：**

- `dsh-tool-subagent` 的 `execute` 立即返回 `{ kind: 'activation', name }`，模型看到 `started subagent <name>`。见 rc.5 `lib/index.js` 的 `render` 与 `execute`。
- 完成通过一条新的用户消息送回父会话。`source` 为：
  ```ts
  { kind: 'subagent-settled', form: 'notice', summary, stopReason, senderSessionId }
  ```
  见 rc.5 `dsh-subagent/lib/index.js` 的 `createSettlementMessage`。
- 父会话若空闲，这条消息会唤醒它（`sendWaking(parent, message, 'queue')`）。
- 服务层另有 `ctx.subagents.startActivation({ provider, label, name?, prompt, parent, signal, delivery })`，返回 `{ childId, name, messageId?, result, dispose }`。
  - `result` 在 teardown 后 settle，携带 output、structured、stopReason。
  - `delivery: 'caller'` 让调用方 await 结果，不向父会话发通知。
  - `agentOptions` 可覆盖子会话的 provider/model/reasoningEffort。
- 版本差异：`0.2.1-rc.2` 的工具配置键是 `modelSelectionSettings`；`0.2.1-rc.5` 是 `modelSelection` + `modelDiscovery`。两代的委派都是异步 activation。

**插件侧：**

- `tools/pre-execute`：每次 `subagent` 调用 `rounds += 1`、`spawned += 1`（`src/index.ts:891-898`）。这是对的。
- `tools/result`：无条件 `done += 1`，并把 `result.content` 当 worker 证据（`src/index.ts:901-919`）。但结果只是"started subagent X"。
- 失败连击：`recordWorkerOutcome(state, cfg, !result.isError)` 读的是**启动**是否成功，不是 worker 是否成功（`src/index.ts:919`）。
- 收尾审计：`complete = done >= spawned`（`src/audit.ts:214`）。因为 done 在启动时已满，审计永远认为"每个 worker 都回报了"。
- 轮末：`agent/turn-stopping` 调 `exitOrchestration(state)`（`src/index.ts:786-841`），并把 `done/spawned` 快照交给审计。之后 worker 才陆续完成。
- 新轮开始：`agent/pre-step` 发现 `orchestration.active` 就 `resetOrchestration`（`src/index.ts:477-481`）。所以迟到的完成消息既不会进账本，也不会进审计。
- prompt：让 CTO 传 `run_in_background: false` 并用 `job_output` 收结果（`src/orchestrate.ts:57-60`）。DSH 的 `subagent` 没有这两个参数。这是**死指令**。

**后果：**

| 现象 | 原因 |
|---|---|
| 审计声称完整 | done 在启动时等于 spawned |
| worker 失败不被计数 | 读的是启动错误 |
| worker 输出不进 evidence | evidence 是 "started subagent X" |
| 后台花费可能漏记 | 子会话 `assistant/message` 到达时 orchestration 可能已释放（`src/index.ts:933-968` 有 active 检查） |
| CTO 无法 review | 工具立即返回，没有等待接口；prompt 的死参数不存在 |
| 跨轮结果丢失 | 轮末释放状态，新轮 sweep |

这与上游 #57 是同一类：**"启动收据被当成完成"**。上游的数字是 152/157 次编排报告"无委派"、4/5 报告 $0。DSH 的形状不同，但结果同样错误。

### 3.2 两种修法

#### A. 插件自带阻塞式委派工具（推荐）

思路：不修宿主工具，而是由插件注册一个自己的委派工具，内部直接调服务并等待结果。

```ts
const act = await ctx.subagents.startActivation({
  provider: 'spawn',
  prompt: task,
  parent: agent,
  delivery: 'caller',
  agentOptions: { provider: fastRoute.provider, model: fastRoute.model },
  signal: execution.signal,
})
const result = await act.result   // output / structured / stopReason
```

优点：

- 保持编排单轮（SPEC §7.3 不变）。
- `done`、failure streak、workerResults、spend 全部在真实完成时发生。
- `agentOptions` 可显式钉 Fast 路由，绕开 `subagent-model-selection-settings` 的默认关闭问题。这是一次解决两个问题。
- 不依赖解析收据文本。

代价：

- 需要 `ctx.subagents` 可选依赖与工具注册。
- 需要处理工具名冲突（宿主已有 `subagent`）；建议新工具名如 `delegate`，并让 prompt 只用它。
- 需要确认服务层 `agentOptions` 是否受宿主 model-selection 策略约束。若受约束，则钉模型仍需 `/router allow-workers`；至少记账问题仍能修好。
- 需要处理子会话 cwd、preset、权限继承。
- 测试面：工具注册、等待、失败、取消、并发。

工作量：约 250–400 行 + 测试，1–2 天。

#### B. 保留宿主工具，改为跨轮编排

思路：`tools/result` 只算 dispatch；监听 `session/event` 中 `user/message` 且 `source.kind === 'subagent-settled'`；结算 `done`、失败、证据、花费；让 orchestration 状态跨轮存活，等所有 dispatch 结算后再让 CTO 收尾。

优点：

- 用宿主语义，不新建工具。
- 与 Super-agent 的"事件驱动、工单跨轮"方向一致。

代价：

- 必须改 SPEC §7.3（单轮编排）与泄露清扫逻辑。
- 需要跨轮状态、唤醒、审计时机、预算上限、用户中途插话的处理。
- 完成消息会作为用户消息进入上下文；需要识别并避免把它当新任务重新 judge。
- 工作量约 400–700 行 + 测试，2–3 天，回归面更大。

#### 建议

**先做 A，B 作为后续架构选项。** A 保留现有单轮契约，修复所有 P0 症状，且顺手解决 worker 模型钉定。B 更适合未来 `dsh-supervisor`，不适合当前插件。

无论 A 还是 B，都必须改 prompt：删掉 `run_in_background` / `job_output` 这两个 DSH 不存在的参数；换成与实现一致的说明。

### 3.3 审计与状态

- `AuditInput` 增加 `pending`；`complete = spawned === 0 || done + pending >= spawned`。
- `pending > 0` 时不要要求 CTO summary（对应上游 v1.9.0）。
- `/router status` 增加 `, N in flight`。
- 审计结论要能区分"真失败"与"还在跑"。

---

## 4. P1：编排门槛（verdict vs decisionTier）

**上游 v1.9.0 的修复：** 43/164 次编排的 `judge=fast`，但编排仍触发。原因是门槛读运行中的 tier，不是 Judge 的裁决。改为读 verdict，`orchestrate: true` 是唯一 override。

**DSH 现状：**

- `shouldOrchestrate` 要求 `decision.decisionTier === 'smart'`（`src/orchestrate.ts:353`）。
- `processRoute` 在"保持原位"时返回 `decisionTier: state.currentTier`（`src/router.ts:380`）。
- 因此：当前在 Smart 层、Judge 判 fast、但降档被 `downgradeMemory` 或缓存闸挡住时，`decisionTier` 仍是 smart → 编排触发。这就是上游的 43/164 形状。
- DSH 这样写有明确理由（SPEC §7.1）：避免"Fast 模型跑 CTO prompt"。不能简单改成纯 verdict。

**建议改法（hybrid）：**

```ts
if (decision.decisionTier !== 'smart') return false          // 本轮确实跑 Smart
const verdictSmart = judgeResult.tier === 'smart'
if (!verdictSmart && judgeOrchestrate !== true) return false // 判决支持才编排
```

即：必须跑在 Smart，且（verdict 是 smart 或 Judge 明确 orchestrate:true）。这样：

- 修掉"fast verdict 在 Smart 层误编排"。
- 不会在 Fast 运行上注入 CTO。
- 保留 DSH 的安全约束。

需要同步改 SPEC §7.1 与 R12 的决策记录，并加回归测试。

---

## 5. P1：轮预算默认值与迁移

| 项 | 上游 v1.9.0 | DSH v0.8.0 |
|---|---|---|
| 默认 maxRounds | 6 | 3（`src/types.ts:449`、`src/config.ts:106`） |
| 范围 | 1–20 | 0–100 |
| 旧默认迁移 | `3 → 6`，一条日志 | 无 |
| round 语义 | dispatch 计，reviewer 不算 | dispatch 计（已一致） |
| escalation 范围 | 1–6 | 1–100 |

建议：

- 默认改 6；范围改 1–20；`escalationThreshold` 可保持 1–100 或收窄到 1–6。
- 在 `deepMergeConfig` 之后加 `normalizeOrchestration(config)`：仅当值等于旧默认 3 时抬到 6，写一条日志。与 `normalizeJudgeMode()` 同形。
- 同步 SPEC §7.3、CHANGELOG、卡片 hint、README。
- 注意：DSH 卡片与 `/router config` 会写整份快照，用户文件里的 3 很可能只是默认值，迁移理由与上游相同。

DSH 没有 reviewer 概念：CTO 自己审查。因此"一个 round = 一个 worker"在 DSH 成立，不需要 reviewer 计轮逻辑。

---

## 6. P2：工艺与文档

1. **打包门禁两条**（半天）：
   - 断言 `dependencies` 中不得出现 `@deepseek-ai/*`（host 包只能 peer）。
   - 删除或实现 `packaged-install.test.ts:93-102` 的恒真断言。
2. **lockfile 可移植性**（半小时 + 验证）：
   - 实测：`package-lock.json` 334 条 `resolved` 全部指向 `registry.npmmirror.com`，`registry.npmjs.org` 0 条。
   - 上游 #64 的失败模式：新 npm 拒绝远端 tarball（`EALLOWREMOTE`），publish job 在 OIDC 之前挂掉。
   - 修法：`npm install --package-lock-only --registry=https://registry.npmjs.org/`；integrity 不变。
   - 与 AGENTS.md 的"本地用镜像、提交 lockfile 用官方源"一致。
3. **`/router config` 无超时**（可选）：`src/commands.ts:440-443` 顺序 `await listModels(provider)`。适配器慢时菜单会卡。可加 `Promise.race` 超时。DSH 没有上游那种 registry refresh，但适配器网络往返仍可能慢。
4. **文档漂移**：`SPEC.md:958` 仍写 route notice 的 `source.kind: 'plugin'`，实现已是 `'model-selection'`。与本次同步无关，但改 SPEC 时一并修。

---

## 7. 不可移植清单

| 上游项 | 为什么不可移植 |
|---|---|
| OpenCode 会话归属头 | DSH 的 LLM seam 由宿主适配器负责；`dsh-llm` 只发 `user-agent`，无 session 头概念 |
| pi classifier 层（53 个 decision 模型） | DSH `dsh-llm` 无 `classify` / classifier 目录 / `getModelsOfType` |
| wizard 目录后台刷新 | DSH 的 `modelCatalog()` 不做网络 refresh，没有可 await 的对象 |
| `🔄 立即刷新目录` | DSH 没有 `models.json` 手改场景 |
| management 调用（`action`） | DSH `subagent` 没有 `action` 参数；管理是独立工具 |
| pi-tui peer / 懒加载禁令 | pi 的 jiti + host alias 加载器专属；DSH 用 Cordis + tsdown |
| reviewer 命名与 `async:false` | DSH 无 `agent: 'reviewer'`；`async:false` 参数不存在 |
| 上游 receipt 文本 `Async: ... detached` | DSH 收据文本是 `started subagent <name>`；完成是 `subagent-settled` 消息 |

### effort control

- 上游 #44/#45/#46 是**纯文档**：设计记录 + G3 结论，`src/` 零改动。SPEC §9.5 自述 "designed, not implemented"。
- DSH 侧 `ReasoningEffortId` 在 `src/` 出现 0 次；但宿主已具备：
  - `dsh-llm` 的 `LlmCallControls.reasoningEffort`（`agent/request` 的返回类型）。
  - `resolveModelInfo().reasoning.efforts` 能力列表。
  - `subagent` 的 `reasoning_effort` 参数与 `agentOptions`。
- 结论：**这次没有可同步的 effort 功能。** 未来若做静态 pin，可在 `agent/request` 返回值加 `reasoningEffort`，并用能力列表过滤。建议单独立项，不混进本次同步。

---

## 8. 建议落地顺序

| 顺序 | 内容 | 工作量 | 前置 |
|---|---|---|---|
| 1 | P0-A：阻塞式 `delegate` 工具 spike（工具注册 + `startActivation` + await result） | 1–2 天 | 确认 `ctx.subagents` 注入方式与 `agentOptions` 策略 |
| 2 | P0：`done`/`pending`/失败/证据/审计/status 全部改到真实完成 | 半天 | 1 |
| 3 | P1：门槛 hybrid、默认 6、范围 1–20、迁移 | 1 天 | SPEC §7.1/§7.3 决策 |
| 4 | P2：打包门禁、lockfile、config 超时 | 半天 | 无 |
| 5 | 文档：CHANGELOG、ALIGNMENT（新 R16）、SPEC、README | 半天 | 1–4 |

总估算：3–4 天（不含真机编排验证与发布）。若要 B 方案（跨轮编排），再加 2–3 天并需改 SPEC §7.3。

---

## 9. 遗留与未验证

1. **未跑测试、未发版、未真机编排。** 所有 DSH 侧结论来自源码与类型静态核对。
2. **P0 缺陷未实机复现。** 复现方式：在 desktop profile 触发一次编排，观察 `/router status` 的 `done/spawned` 是否在派遣瞬间变成 N/N。若变，即证实。
3. **`agentOptions` 是否受宿主 model-selection 策略限制未验证。** 决定 P0-A 能否顺带解决 worker 钉模型。
4. **上游 CHANGELOG 与代码不一致：** v1.9.0 说 `subagent-notify` 会结算 spend，但代码的 notify 分支只做 `done`/失败/streak，不写账本。移植时不要照抄该描述。
5. **lockfile 的 `EALLOWREMOTE` 未在下游复现**，只确认了 334/334 镜像 URL。
6. **上游 SPEC 的版本标签错位**（v1.7.3 / v1.8.1），搜索时注意。
7. **`0.2.1-rc.2` 与 `rc.5` 的 `subagent` 配置键不同**（`modelSelectionSettings` → `modelSelection` + `modelDiscovery`）。插件不挂这个工具，影响面仅限原型评估。

---

## 10. 复现命令

```sh
# 上游版本与 diff
cd /Users/greener/project/pi-shift-router
git log v1.6.0..HEAD --oneline
git diff v1.6.0..v1.9.0 --stat
git show v1.9.0:CHANGELOG.md | head -120

# DSH 侧：收据与完成信号
cd /Users/greener/project/dsh-shift-router
grep -n "done += 1\|spawned += 1\|run_in_background\|job_output" src/index.ts src/orchestrate.ts
grep -n "done >= input.spawned" src/audit.ts

# DSH rc.5：工具返回与 settlement 消息
node - <<'EOF'
// 用 asar 读取器打印 dsh-tool-subagent / dsh-subagent 的关键片段
// （完整脚本见本次会话的 /tmp/asar_read.py）
EOF

# 打包与 lockfile
grep -c 'registry.npmmirror.com' package-lock.json
grep -c 'registry.npmjs.org' package-lock.json
sed -n '93,102p' tests/packaged-install.test.ts

# engines 匹配（顺带发现）
node -e "const s=require('semver');console.log(s.satisfies('0.2.1-rc.5','>=0.2.0-rc.2 <0.3.0-rc.0'))"
```

---

## 附录：上游 commit 地图

| commit | PR | 内容 |
|---|---|---|
| `8aeb489` | #50 | 自家调用补 OpenCode 会话头 |
| `0bf132d` | #47 | pi-tui 降为 peer，去掉 lazy import |
| `5aac26a` | #49 | 打包门禁按 host 契约 |
| `24447f8` | #52 | 向导不等 registry refresh |
| `b368c65` | #54/#55 | classifier 层 + orchestrate 传递 + `/v1` 修复 |
| `07c3d4b` | #59（闭 #57/#58） | 收据/完成分离、后台完成、预算 3→6、verdict 门槛、audit deferred、prompt |
| `98a6a88` | #60 | release v1.9.0 |
| `51284af` | #61 | OIDC 发布 |
| `65de024` | #62 | prepublish 先 build 再 test |
| `3374385` | #63 | npm 版本与诊断 |
| `bc07cfa` | #64 | lockfile 改官方源 |

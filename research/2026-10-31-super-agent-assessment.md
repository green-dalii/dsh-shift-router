# Super-agent 评估：借鉴什么，不做什么

- 评估日期：2026-11-01（文章发布于 2026-10-31 20:29 +08:00）
- 评估对象：官方文章《Super-agent 设计探索》+ 官方原型 `dsh-superagent-prototype` + 本机 DSH 运行时
- 当前项目：`dsh-shift-router` v0.8.0
- 状态：只读调研。未修改代码、未安装任何东西、未改动 profile。
- 后续：方向已拆成 GitHub issues #2–#9（跟踪 issue #9），没有代码进入本仓库。

---

## 0. 结论

1. **不移植原型。** 它是 1.5 万行、821 个用例的产品级研究代码，不是可合并的库。上游已注明"研究原型，非正式产品"。
2. **不并入 `dsh-shift-router`。** 该项目的 SPEC §0 把"跨会话持久状态"写成非目标。塞进 Super-agent 会破坏单一定位，并牵动 443 个测试、25 个测试文件和 7 份文档。
3. **值得做一款新插件，但不是现在。** 先用零代码 bundle 验证 2 周；达标后再写 2–4k 行的 `dsh-supervisor`。
4. **新插件只补两块：事件面 + 工单生命周期。** 执行层全部复用 DSH 原生能力，这是把 15k 行压到 2–4k 行的依据。
5. **`dsh-shift-router` 只吸收 3 个低风险机制**，不改架构。清单见 §6。

一句话判断：**文章真正的主张不是"多 Agent"，而是把 Agent 从"会话内函数"变成"常驻服务"。`dsh-shift-router` 已经在做"边界处的便宜决策"，只是决策轴是模型，不是任务。**

### 0.1 三条洞察

1. **产品单位要换。** Session 是 LLM API 的遗留物。Super-agent 把产品单位从"会话"换成"事件流（Thread）+ 授权工作（Ticket）"。会话退为实现细节。
2. **双层不是多 Agent。** 它的本质是把"全局序点"与"执行隔离"拆开。Router 之所以能用轻模型，是因为它被刻意限制成低维决策（长输入、短输出），不是因为它更笨。
3. **两者是拓扑对偶，不是替代。** `dsh-shift-router` 是"强规划 + 弱执行"；Super-agent 是"弱路由 + 强执行"。任务内部耦合高时选前者，任务彼此独立时选后者。

### 0.2 最小行动

| 顺序 | 动作 | 时间 |
|---|---|---|
| 1 | 不装原型，不写插件；先读本报告并确认痛点是否真实 | 10 分钟 |
| 2 | 用零代码 bundle（Agent Teams + Schedule + `gh` 只读）跑两周验证 | 2–3 天搭建 |
| 3 | 达标后只写"事件面 + 工单生命周期"；执行层复用 DSH | 2–4 周 |
| 4 | `dsh-shift-router` 只修 engines + 预留 `excludePresets` | 半天 |

---

## 1. 第一性原理：文章到底在解什么题

### 1.1 三条前提

文章没有直接给结论，而是从三个观察推下来：

1. **模型能力上升，人的注意力成为新瓶颈。** 原文："一个人通常只能同时跟进 3 到 5 个活跃 Session"（第 19 段）。
2. **Session 是 LLM API 的遗留单位。** 原文："Session 应当是系统的实现细节，而不应是用户的认知负担"（第 64 段）。
3. **单 ReAct Loop 同时做不到连续与并发。** 连续要求一个全局序点；并发要求执行隔离。两者在单会话内互斥。

### 1.2 五个模块 = 四对矛盾的解

| 矛盾 | 模块 | 解法本质 |
|---|---|---|
| 连续 vs 吞吐 | §2 双层架构 | 全局序点（Router）与执行单元（Worker）分离 |
| 被动 vs 主动 | §3 事件驱动 | 输入从"人打的提示词"换成"环境事件" |
| 阻塞 vs 交互 | §4.1 异步 ReAct | 工具调用 start/stop，结果回灌为事件 |
| 单机 vs 持久 | §5 存算分离 | 计算、状态、执行环境三者解耦 |
| 自检 vs 可靠 | §6 Watchdog | 主系统外的独立控制回路 |

四个特征（连续、高效、主动、持久）不是并列功能，而是这五条推论的产品化表述。

### 1.3 我提炼的 8 条设计不变量

这 8 条比模块名更值得借鉴：

1. **决策与执行分离。** Router 只做低维判断，所以能用轻模型；Worker 做不可逆工作，所以用强模型。
2. **确定性优先。** 稳定的高频判断写成代码（Fast Path）；只有需要语义理解的才调模型（Slow Path）。
3. **路由结果可缓存。** 订阅就是"路由决定的缓存"：已确定归属的事件不再经过 Router。
4. **上下文是缓存，不是仓库。** Inline 热数据，Spill 冷数据，用 ID 组成引用图按需召回。
5. **硬约束写在代码里，不写在提示词里。** 轮次、预算、并发、超时都由系统拒绝，而非靠模型自觉。
6. **对外只留一个人格。** 多个 Worker 不直接对人说话，Router 统一出口。
7. **人的注意力要计价。** 每条消息、每个设置、每个面板元素都要证明自己的价值，否则删掉。
8. **异常恢复必须外部化。** 陷入循环或偏离目标不是进程崩溃，主系统自己的健康检查发现不了。

### 1.4 这不是功能清单

文章的原创性不在模块名，而在**把计算机系统的经典思想搬到 Agent 系统**：批处理、Fast/Slow Path、缓存局部性、投机执行、存算分离、控制回路。原文结语自己承认："我们并没有提出全新的理论"（第 303 段）。

因此评估重点不该是"要不要抄这五个模块"，而是"这套系统不变量与当前项目是否同源"。

---

## 2. 原型实现到了哪一步（实测）

### 2.1 事实

| 项 | 实测值 | 证据 |
|---|---|---|
| 形态 | 单个 DSH bundle 插件，host 三入口 + client 面板 | `package.json`、`cordis.patch.yml` |
| 源码规模 | `src/` 约 1.5 万行（15,205 行 `.ts/.tsx`） | `wc -l` 实测 |
| 测试 | 59 个 spec 文件，821 个用例 | 原型分析统计 |
| 运行依赖 | 只有 `proper-lockfile`、`zod`；其余全部 peer | `package.json:58-86` |
| 存储 | 自建 SQLite + effect 队列 + 目录锁 | `src/app/store.ts`、`src/app/effects.ts` |
| 开发期 DSH | devDeps 钉死 `0.2.1-alpha.2`；部署文档钉 `0.2.1-rc.3` | `package.json:88-123`、`docs/006-deployment.md:76` |
| 本机宿主 | **0.2.1-rc.5**（308 个 `@deepseek-ai/*` 全部 rc.5，cordis 4.0.5） | 实测 `app.asar`、`Info.plist` |
| 版本门禁 | 通过。DSH 用 `includePrerelease:true` 判定，rc.5 满足 `^0.2.1-alpha.2` | `dsh-app-boot/lib/index.js:276-284` |
| 开源 | MIT，仓库 2026-10-31 创建，单提交，抓取时 1097 stars | GitHub 页面快照 |

### 2.2 五模块实现度

| 模块 | 判定 | 关键事实 |
|---|---|---|
| 双层 Router/Worker | **已实现** | 主 Session 是真实常驻 LLM 会话；每个 Ticket 一个 Worker Session + 一个目录 |
| 3.1 两级过滤 | **已实现** | 代码 gate（白名单/接收表/机器人名单）+ LLM assessment |
| 3.2 订阅直通 | **已实现，但挂在 Ticket 上** | 事件扇出到订阅的 Ticket，直接投递给 Worker，不经过 Router |
| 3.3 Inline & Spill | **已实现** | 明文字符预算 + `read` 指针 + 分页资源图 |
| 3.3 链式召回 | **已实现** | 每页内联下一跳对象 ID 与摘要 |
| 3.4 投机执行 | **未实现** | 全仓无 `speculat*`；只有 observe 模式记录 |
| 4.1 异步 ReAct | **部分，机制不同** | 没有 `start()/stop()`；靠宿主 jobs + `steer` 步间投递 |
| 5 存算/执行环境分离 | **未实现** | 单进程、本地 SQLite、本地目录；无端侧 daemon |
| 6 Watchdog | **未实现** | 只有健康看板、2 秒巡检和外部小时级运维检查 |

三个关键实现细节值得记住：

- **Router 不直接执行。** 主 Session 工具被限制到只读工具（skill/bash/read 等），没有写文件权限。
- **Worker 隔离靠 preset。** 两个 agent preset 写死在 bundle patch 里：worker 只留执行工具，前台命令 5 秒转后台；router 去掉 subagent、web、文件搜索。
- **"异步"是借来的。** 原文说 `start()/stop()` "已在 DSH 实现但未默认开启"（第 183 段）；原型用 5 秒转后台 + 步间投递达到近似效果。

结论：**原型证明了架构可行，也证明了它很重。** 它把"产品"该有的东西全做了：面板、设置、多语言、迁移、锁、恢复、健康、运维脚本。这些不等于架构。

### 2.3 直接试运行的成本（实测）

本机缺两样硬前置：

| 前置 | 状态 | 说明 |
|---|---|---|
| `dsh` CLI | **缺失** | `which dsh` 为空；需要 `npm i -g @deepseek-ai/dsh` |
| `tmux` | **缺失** | 原型启动脚本依赖 tmux |
| 独立 profile | 需要的 | CLI 拒绝 `desktop`：`profile "desktop" is managed exclusively by the Electron application` |
| 专用 GitHub 账号 | 需要的 | `gh` 已装（2.92.0），但需专用账号登录 |
| 端口 | 需要的 | 127.0.0.1:3082 |
| 构建 | 需要的 | 无 `lib/`，必须先 `pnpm install && pnpm build` |
| 权限 | 高危 | Worker 与主会话以 `danger-full-access`、操作者 OS 用户运行 |

还有一个实测断点：

- 早期判断有一条错误：配置键随 DSH 世代变化。`0.2.1-rc.2` 是 `modelSelectionSettings`（单一布尔）；`0.2.1-rc.5` 改为 `modelSelection` + `modelDiscovery`（README 与 `lib/index.js` 的 zod schema 均可核对）。原型面向 alpha.2/rc.5 的写法在 rc.5 正确，在 rc.2 会失效。宿主 `/model-selection-settings` 服务名与工具配置键不是一回事。
- 因此原型这两个键有效，不是断点。真正的风险是其余 alpha.2 → rc.5 的 API 漂移，未逐项验证。

**判断：** 可以试运行，但它会在机器上多出 3–4 个长期状态（全局 CLI、第二个常驻 DSH 进程、专用账号、tmux 会话）。只适合观察，不适合日常使用。

---

## 3. 与 `dsh-shift-router` 的关系：同词，不同轴

### 3.1 两者都在"路由"，但路由的对象不同

| 维度 | `dsh-shift-router` | Super-agent |
|---|---|---|
| 决策单位 | 一轮（turn） | 一个任务 / 一条事件流（Thread） |
| 选择对象 | 模型（provider/model） | 执行会话（Worker Session） |
| 优化目标 | 期望美元成本（EV） | 人的注意力 + 吞吐 |
| 决策者 | LLM Judge（一次性小调用） | 常驻 Router 会话 + 确定性 gate |
| 状态 | 每 agent 内存态，turn 末释放 | 跨任务持久化（Ticket/Thread） |
| 驱动 | 人发消息 | 环境事件 + 人 |
| 并发 | 无调度器，靠模型 fan-out | Worker 槽 + effect 队列 |
| 对外输出 | 路由通知 + `/router status` | 统一回复 + 面板 |

### 3.2 已有的雏形

`dsh-shift-router` 已经具备文章若干思想的最小版本：

- Judge ≈ 准入过滤（一次判定，不干活）。
- CTO 编排 ≈ 规划-委派-审查-验收（`orchestrate.ts`）。
- Worker ≈ 隔离执行的子会话（fresh session）。
- 硬上限 ≈ 系统层预算（`maxRounds` / `escalationThreshold` / `maxSpendUsd`）。
- 审计 ≈ 验收安全网（确定性检查 + 异步 LLM 复核）。
- 路由通知 ≈ 动作可见。

### 3.3 根本差距

- 单轮，不跨轮。编排在 `agent/pre-step` 进入，`agent/turn-stopping` 释放。
- 不创建会话。只用 harness 的 `subagent` 工具派生；插件不拥有 Worker Session。
- 没有事件源。只观测 `agent/*`、`tools/*`、`session/event`，不接外部事件。
- 没有持久队列。状态按顶层 agent 存 WeakMap。
- 没有调度。并发由 Smart 模型自己决定是否 fan-out。
- 没有主动性。只能被动等待一轮开始。

这些不是实现缺陷，是 SPEC §0 的显式选择。**把 Super-agent 塞进 `dsh-shift-router` 等于重写项目，不是加功能。**

### 3.4 一个真正有用的洞察：两者是拓扑对偶

- `dsh-shift-router` 的编排是 **强规划 + 弱执行**：Smart 当 CTO，Fast 当工程师。
- Super-agent 是 **弱路由 + 强执行**：轻量 Router 分派，强模型当 Worker。

两者都对。选择取决于任务耦合度：

| 任务形态 | 合适拓扑 | 理由 |
|---|---|---|
| 单任务内部强耦合（设计、迁移、跨文件重构） | 强规划 + 弱执行 | 需要全局一致性，顶层必须理解细节 |
| 多任务彼此独立（多个 issue、多个 PR） | 弱路由 + 强执行 | 每个任务需要最强能力，但分派决策很低维 |

推论：**智能应该放在不可逆、质量敏感的地方；廉价模型应该放在决策维度低、可回滚的地方。** 这比"Smart 做规划、Fast 做执行"更一般，也是两者可以共存的第一性原理依据。

---

## 4. 方案比较与决策

| 方案 | 工作量 | 风险 | 收益 | 结论 |
|---|---|---|---|---|
| A. 隔离 profile 试运行原型 | 0.5–1 天 | 中：CLI/tmux/账号/danger-full-access | 亲眼看到完整形态 | **可做，只观察** |
| B. 移植或复刻原型 | 4–8 周 | 高：alpha.2→rc.5 漂移、安全、双进程、维护 | 完整 GitHub 机器人 | **不做** |
| C. 并入 `dsh-shift-router` | 2–4 周 | 高：违反 SPEC §0、443 测试与 7 份文档、跨会话状态 | 复用 Judge | **不做** |
| D. 零代码 bundle 验证 | 2–3 天 | 低 | 验证价值与注意力收益 | **先做** |
| E. 新插件 `dsh-supervisor` | 2–4 周 | 中：rc 漂移、实验 API | 通用事件面 + 工单生命周期 | **D 达标后做** |

推荐路径：**A（可选）→ D → E**。B、C 拒绝。

理由：

1. 原型是"参考实现"，不是"上游依赖"。它没有发布、没有支持承诺、单提交。跟着它走等于自己维护一个 fork。
2. `dsh-shift-router` 的价值在窄。它因为窄才可审计、可测试、可发布。扩成调度器会让它同时失去这两个优点。
3. DSH 已经把文章的大部分原语商品化。新插件的增量比原型小一个数量级。

---

## 5. `dsh-supervisor`：新插件的设计草案

### 5.1 产品一句话

> 给 DSH 加一个常驻工作调度器：把事件变成工单，把工单交给隔离会话，只在需要人时说话。

不做什么：

- 不做 GitHub/Feishu 专用机器人（先做通用事件面，适配器后置）。
- 不做自建面板（先用命令 + 通知 + projection）。
- 不做自建 SQLite/迁移/锁（先用 DSH 存储域）。
- 不做投机执行、存算分离、端侧 daemon。
- 不接管用户的普通聊天。

### 5.2 架构

```text
事件源（先做本地）
  schedule 提醒 / webServer webhook / job 结束 / session 事件
        │
        ▼
Gate（纯代码，Fast Path）
  allowlist · 幂等键 · Thread 键 · 速率限制 · 静默时段
        │
        ▼
Admission（一次便宜 LLM 调用，Slow Path，可关）
  accept / ignore / observe
        │
        ▼
Ticket 存储（DSH 存储域；Trigger/Thread/Ticket/Subscription/Mandate/Report）
        │
        ├──► Worker Session（sessionController.create + preset + 钉模型）
        │        └── supervisor_report 工具 → Ticket
        │
        └──► Attention 队列 → Router 会话通知（inject）→ 人
```

关键点：

- **Router 是会话，不是进程。** 一个常驻 DSH Session，配只读工具，负责汇总与对外说话。
- **Worker 是顶层 Session，不是 subagent。** 这样才能跨轮存活、独立恢复、被面板看到。
- **订阅在 Ticket 上，不在 Session 上。** 后续同 Thread 事件直接投递，不经过 Router。这是 Fast Path。
- **人消息直达 Ticket。** 不进 Admission，避免二次判断和延迟。

### 5.3 复用 DSH 原生能力（实测存在）

| 需要 | 原生能力 | 证据 |
|---|---|---|
| 创建 Worker 会话 | `ctx.sessionController.create({sessionId, workspaceId, agentPreset})` | rc.5 `dsh-api-session-controller` 类型 |
| 每角色不同工具/提示词 | agent preset | `dsh-agent-preset` |
| 每会话钉模型 | `agent.session.append('model/selection', …)` + `agent/request` 拦截 | 原型 `role-models.ts`；rc.5 事件存在 |
| 幂等投递 | `handle.agent.followup/steer/inject` | `dsh-agent` rc.5 |
| 后台命令 | jobs + `job_output/job_list/job_kill` | 本会话工具列表已含 |
| 定时唤醒 | `dsh-schedule`（cron、持久、重启恢复） | rc.5 README |
| 长目标 | `dsh-goal`（跨轮、持久、自动续跑） | rc.5 README |
| 上下文超限外置 | `dsh-spill` | rc.5 README |
| 面板状态 | `dsh-session-projection` | rc.5 README |
| 管理 HTTP | `ctx.webServer.register` | rc.5 `dsh-host-webserver` |
| 权限 | `ctx.permissionPresets.set` | rc.5 |
| 团队/任务板（可选） | `dsh-experimental-agent-team` | rc.5，实验性 |

**DSH 没有的，正好是新插件的价值：**

1. 外部事件入口（webhook/轮询）与去重游标。
2. Thread 身份与订阅直通。
3. 准入策略（确定性 + 语义 + observe 模式）。
4. 工单生命周期（Mandate/Subscription/Attention/恢复）。
5. 独立于用户聊天的 Router 会话。

### 5.4 与 `dsh-shift-router` 的接口

两者共存需要一条明确契约，否则会互相踩：

- **Router 会话**是顶层 agent，会被 `dsh-shift-router` 正常路由。这是好事：Router 可以跑 Fast 层。
- **Worker 会话**也是顶层 agent，默认也会被路由。这不符合预期：Worker 应固定模型。
- 解决：`dsh-shift-router` 增加 `routing.excludePresets`，或由 supervisor 通过服务声明所有权。
  - 前者只用 `session.header.agentPreset`，版本风险低。
  - 后者需要跨插件服务契约，耦合更高。
- 建议前者。改动小，可单测，不破坏现有语义。

### 5.5 MVP 范围与估算

| 部分 | 估算 |
|---|---|
| core 域模型（Trigger/Thread/Ticket/Subscription/Decision） | 800–1200 行 |
| Gate + Admission + 幂等 | 400–600 行 |
| Session 工厂 + preset + 钉模型 + 投递 | 400–600 行 |
| 存储适配 + 恢复 | 300–500 行 |
| 命令 + 通知 + 最小 projection | 300–500 行 |
| 测试（30–50 个） | — |
| **合计** | **2–4k 行，2–4 周（单人 + agent）** |

先做的三个源：`schedule`、`webServer webhook`、`job 结束`。GitHub 适配器后置，且优先用轮询（桌面 webServer 只绑 127.0.0.1，外部 webhook 需要隧道）。

### 5.6 安全与注意力（照抄原型的制度设计）

原型最值得抄的不是代码，是这些规则：

- **observe 模式默认开。** 只记录"我会做什么"，不做。人确认后再开 auto。
- **允许列表按来源分开。** 不同来源不同权限，身份不跨来源映射。
- **人消息直达工单。** 不重新判断，不延迟。
- **Mandate 记录授权依据与策略版本。** 策略变了要复核，不静默继续。
- **凭据不进上下文。** 用 CLI wrapper / 执行环境变量，Worker 只拿到默认值。
- **一次只问一个问题。** 结构化提问，不写长报告。
- **单条消息 ≤100 词（IM 类信道）。** 只在需要决策或验收时说话。

### 5.7 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| DSH 版本漂移 | 0.2.1-rc.x 迭代快；Agent Teams 仍是 experimental | 只用稳定服务；engines 收窄；e2e 用 scratch profile |
| 无外部事件 API | 桌面只绑 localhost | 先轮询；webhook 后置 |
| 与 `dsh-shift-router` 冲突 | 顶层 Worker 被误路由 | `excludePresets` 契约 |
| 注意力反噬 | 通知太多，比手动更累 | observe + 静默默认 + 度量 |
| 安全 | 不可信输入进上下文 | 准入、白名单、只读 Router、独立 OS 账号 |
| 维护成本 | 两个插件、两套文档、两套门禁 | 新插件保持 2–4k 行，不复制原型 |

---

## 6. 立即可借鉴清单（按 ROI 排序）

以下都要维护者授权。按 AGENTS.md §5，`cordis.patch.yml` 与 host 集成文件属于门禁范围。

### 6.1 engines 声明有实测缺陷（建议修）

- 现状：`engines.dsh = ">=0.2.0-rc.2 <0.3.0-rc.0"`。
- 实测：`semver.satisfies('0.2.1-rc.5', range)` = **false**（默认不含预发布）。
- DSH 自己的判定用 `includePrerelease:true`，所以运行时通过；npm/pnpm 与第三方工具会看到不匹配。
- 若仍要支持 `0.2.0-rc.2`，可用复合范围：`>=0.2.0-rc.2 <0.3.0-0 || >=0.2.1-rc.2 <0.3.0-0`（实测覆盖 rc.2、rc.5，排除 0.3.0-alpha）。
- 若 0.2.0 已可放弃，`^0.2.1-rc.2` 最简。
- 影响：一次 patch 发布；需同步 CHANGELOG 与 ALIGNMENT。

### 6.2 Worker preset 与 5 秒后台阈值（候选，不急）

- 原型证明：worker preset 限制工具面 + 前台命令 5 秒转后台，可显著减少"长命令挡住新消息"。
- 但 `subagent` 工具的 preset 与模型选择是**宿主组合配置**，插件不能按调用设置。
- 结论：记录为集成候选；未经授权不改宿主组合。当前编排已用 fresh session，收益有限。

### 6.3 `routing.excludePresets`（为未来让路）

- 给 `isRoutableAgent` 增加一条：preset 在排除列表时不路由。
- 用途：未来 supervisor 的 Worker 固定模型，不被 shift-router 改写。
- 成本：一个小配置项 + 单测；不改变默认行为。

### 6.4 编排失速检测（可选增强）

- 已有：失败连击、轮次上限、预算上限、重复反馈触发接管。
- 可加：确定性"无进展"检测（连续 N 步无工具调用 / 无 worker 回报 / 花费增长但无结果）。
- 价值：对应文章的 Watchdog 思想，但只在 turn 边界工作，不引入第二个进程。
- 成本：纯模块 + 单测；需新增通知文案。

### 6.5 明确不借鉴

| 不借鉴 | 原因 |
|---|---|
| 投机执行 | 桌面单机没有多余算力；权限模型不匹配；收益无法度量 |
| 存算分离 / 端侧 daemon | 单人桌面没有云端；引入第二个进程与安全面 |
| 自建事件源（GitHub/Feishu） | 先验证价值，再写适配器 |
| 自建面板（4.4k 行） | 用命令 + 通知 + projection 起步 |
| 文章式多 Worker 并发 | `dsh-shift-router` 没有调度器；加调度器是重写 |

---

## 7. 为什么"现在还不该直接写插件"

新插件成立需要三个条件同时为真：

1. 你确实被"多任务、多会话切换"困扰，而不是偶发。
2. 有稳定的外部事件流（issue/PR/CI），且有人愿意验收。
3. 能接受"后台自主产出、人只做审查"的工作方式。

对单人桌面环境，文章的"持久在线"假设不成立：笔记本会休眠；没有 IM 频道；没有专用机器人账号；GitHub webhook 进不来。此时真正的瓶颈不是注意力上限，而是**信任与验收成本**。

所以第一版不要做"自治 PR 机器人"，要做"审查队列 + 草稿"。

### 两周验证方案（D 方案）

用零代码 bundle，不写插件：

- 一个 supervisor preset：Agent Teams + Schedule + `gh` 只读工具 + 精简提示词。
- Router 跑 Fast 层，Worker 跑 Smart 层（与 shift-router 的 CTO 模式相反）。
- 每 30 分钟 schedule 唤醒，轮询指定仓库的 issue/PR，生成"待办候选"。
- 只允许产出：分析、复现步骤、草稿 patch（不推送）。
- 人每天花 10 分钟看一次队列。

度量四个数：

| 指标 | 目标 |
|---|---|
| 人工中断次数 / 天 | 不高于手动时 |
| 有价值产出 / 周 | ≥3 |
| 被拒或回滚比例 | <20% |
| 增量 token 成本 | 可解释、可预算 |

两周后若四项达标，再写插件。不达标，说明价值不成立，省下 2–4 周。

---

## 8. 遗留与未验证

1. **原型未在 rc.5 实机启动。** 需要全局 CLI、tmux、第二 profile、专用账号；本次只读，未安装。`modelSelection` / `modelDiscovery` 两个工具配置键在 rc.5 仍存在（已核对 README 与 zod schema）；其余 alpha.2 API 漂移未逐个验证。
2. **未验证 rc.5 是否接受原型 client bundle 的插件图注册。** slot 名仍在，但 HMR/注册契约未实测。
3. **Agent Teams 仍是 experimental。** 无稳定性承诺；新插件不应把它作为硬依赖。
4. **外部资料不完整。** issue/PR/forks 数因 GitHub API 403 未取到；1097 stars 为页面快照；文章实验是合成负载（约 300 条消息 ×5 次），不能证明个人场景收益。
5. **工作量估算基于假设。** 2–4k 行 / 2–4 周按"单人 + agent、复用 DSH 原生、不做面板与外部适配器"计。
6. **未跑当前项目测试。** 只读调研；443 测试 / 25 文件的数字取自 README 与 ROADMAP。
7. **`dsh-supervisor` 名称未查重。** npm 上已有无关的 `dsh-super-agent` 包（作者 artlex），发布前必须查名。

---

## 9. 复现步骤

```sh
# 1. 读文章与原型
sed -n '1,315p' /Users/greener/WorkBuddy/2026-10-31-23-20-07/deepseek-superagent/DeepSeek-Super-agent.md
cd /Users/greener/project/dsh-superagent-prototype && git log --oneline && cat README.md

# 2. 核实宿主版本（实测 0.2.1-rc.5）
plutil -p "/Applications/DeepSeek Harness.app/Contents/Info.plist" | grep CFBundleShortVersionString

# 3. 核实 engines 匹配缺陷
cd /Users/greener/project/dsh-shift-router && node -e "
const s=require('semver');
const r='>=0.2.0-rc.2 <0.3.0-rc.0';
console.log(s.satisfies('0.2.1-rc.5',r));            // false
console.log(s.satisfies('0.2.1-rc.5',r,{includePrerelease:true})); // true
"

# 4. 试运行原型（需要维护者批准；会新增全局 CLI、tmux、第二 profile）
# npm i -g @deepseek-ai/dsh@0.2.1-rc.5
# brew install tmux
# cd /Users/greener/project/dsh-superagent-prototype && pnpm install && pnpm build
# dsh superagent --from-default-profile web      # 建 superagent profile
# dsh plugin --profile superagent add "link:$PWD"
# 直接启动；若 rc.5 有 API 漂移，按错误逐条修
```

---

## 附录 A：证据索引

| 结论 | 证据 |
|---|---|
| 文章发布于 2026-10-31 20:29 | 微信页面时间戳；文件 front-matter |
| 文章非产品说明 | 原文第 11 段、第 309 段 |
| 3–5 个 Session 上限 | 原文第 19 段 |
| Session 应是实现细节 | 原文第 64 段 |
| 异步 start/stop 已实现未默认开启 | 原文第 183 段 |
| 实验数字：P50 12.4 / P95 15.7 分钟 | 原文第 250–256 段表格 |
| 去掉直通后 token 增加约 37%（2323 万 → 3177 万） | 原文第 259 段 |
| 原型 15,205 行 / 59 spec 文件 | 本机 `wc -l`、`ls` |
| 原型 821 用例 | 原型分析统计 |
| 原型 SQLite / effect 队列 / 锁 | `src/app/runtime.ts`、`store.ts`、`effects.ts` |
| 原型需 dsh CLI + tmux + 独立 profile | `SETUP.md`、`docs/006-deployment.md` |
| 本机缺 dsh CLI 与 tmux | `which dsh`、`which tmux` 为空 |
| 本机宿主 0.2.1-rc.5 | `Info.plist`、`app.asar` 内 `/dsh/package.json` |
| 本机只有 desktop profile | `~/.dsh/profiles/` |
| rc.5 有 sessionController.create 等 | `dsh-api-session-controller` 类型与 README |
| rc.5 有 jobs/schedule/spill/projection | 对应包 README |
| 原型 agent preset 5 秒转后台 | `cordis.patch.yml:38-74` |
| shift-router 只路由顶层 agent | `src/index.ts`（`isRoutableAgent`）、SPEC §1.2 |
| shift-router 不跨会话持久化 | SPEC §0 非目标 |
| shift-router 443 测试 / 25 文件 | `README.md`、`ROADMAP.md:61` |
| engines 默认 semver 不匹配 rc.5 | 本机 `semver.satisfies` 实测 |

## 附录 B：关键原文摘录

> "一个人通常只能同时跟进 3 到 5 个活跃 Session。在这种设计下，单任务的上限取决于模型能力，多任务的上限取决于人的注意力。"（第 19 段）

> "Session 应当是系统的实现细节，而不应是用户的认知负担。"（第 64 段）

> "Router 层在设计上不直接执行具体任务，只负责人类交互与任务分派，甚至可以不配备 Bash 工具。"（第 72 段）

> "积压越多，单个决定分摊的推理时间越低。"（第 79 段）

> "浪费上下文窗口，就是浪费模型的智能。"（第 137 段）

> "异步任务机制已经在 DeepSeek Harness 中实现，但尚未默认开启。"（第 183 段）

> "很多异常并非进程崩溃，而是模型在执行中陷入无效循环或偏离目标。"（第 222 段）

> "该插件只是一种为了验证技术路线而提供的原型，并非 DeepSeek 的正式产品。"（第 309 段）

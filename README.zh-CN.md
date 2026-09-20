[English](README.md) · **简体中文**

<div align="center">

# dsh-shift-router

**面向 DeepSeek Harness 的双层模型路由器** —— 基于 LLM 裁判的自动执行/判定路由、多模型回退链、指数退避运行时故障转移，以及任务级编排。

由 [pi-shift-router](https://github.com/green-dalii/pi-shift-router) 适配到 DSH 的版本。
移植基线为上游 **v1.0.0**，对齐目标为上游 **v1.6.0** —— 逐版本对照见
[ROADMAP.md](ROADMAP.md#upstream-alignment)，契约见 [SPEC.md](SPEC.md)。

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-green)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-336%20passing-brightgreen)](#开发)
[![DSH plugin](https://img.shields.io/badge/dsh--plugin-✅-green)](https://github.com/topics/dsh-plugin)

</div>

日常对话不该花旗舰模型的钱；真正重要的对话也不该交给便宜模型。

在每个顶层 Agent 的每一轮开始之前，一个轻量的 **LLM 裁判**（运行在你的 Fast 层模型链上）会把用户消息判定为 `fast`（日常）或 `smart`（重要）。被选中的层随后通过 harness 自身的 `agent/request` 管线驱动整轮——思考、工具调用、代码编辑。裁判只做判定，从不干活。

```text
🦾 [deepseek-v4-flash] → fix the failing test
🧭 judging…
🧠 [deepseek-v4-pro]   ← "design the auth flow" → 立即升级
⚠️ deepseek-v4-flash 429 → 冷却中，改走 glm-5.2 — 1 分钟后重试
🦾 [glm-5.2]           ← 同层故障转移
```

## 特性

- **期望成本路由（EV）** —— 当且仅当 `pSmart ≥ θ` 时走 Smart，其中 `θ = 1/reworkPenalty`：这条门槛与模型价格无关，所以唯一的旋钮就是"错误降级有多痛"。升级是即时的；降回来需要 `downgradeMemory` 次**连续**的决定性 `fast` 判定。裁判不可用或判定不确信时一律**保持原位**，绝不猜测。
- **缓存感知路由** —— 当 Fast 与 Smart 共享同一 provider 时，决策门槛会除以 `sameFamilyPenalty`（默认 1.5），并在 prompt 缓存仍热时抑制降级，避免切到便宜模型反而更贵。
- **运行时故障转移** —— 429 / 402 / 5xx / 配额 / 用量上限 / 模型下线 等失败会把模型置入指数退避冷却（1m → 4m → 16m → 1h04m → 4h16m，上限 6h；客户端侧限流从 16m 起步），并在同一层内重新解析到下一个健康模型——同一轮内重试，绝不跨层。
- **任务级编排** —— 复杂任务会让 Smart 层担任 **CTO**：规划、通过 harness 的 `subagent` 工具把实现委派给 Fast 层工程师子代理、逐个审查结果并迭代。硬上限由**插件强制执行**而非仅靠提示词：每次委派计一轮、**连续**工作代理失败计一次升级，一旦触顶 `subagent` 工具会被直接拒绝、系统提示词切换为"立即收尾"通知。
- **成本遥测** —— 按层统计 token，可选的 USD 计价表（`/router status` 会显示"本次会话若全程使用 Smart 模型将花费多少"）。**吞吐速率不在此列**：DSH 原生已在消息页脚与 trajectory 面板显示 `tok/s`，且按解码时间计算，口径更准。
- **动作可见** —— 切换档位或模型时会往对话里写一条 `[shift-router] Fast → Smart · …` 通知（harness 没有给插件预留状态栏座位），所以插件启用后不会"静默地什么都没发生"。把 `ux.routerLogVerbose` 打开，则每一轮判定都会有一条通知，而不只是切换时。
- **零配置启动** —— 未配置分层前完全无操作；配置完成后路由立即生效。配置可通过 GUI 设置面板 **和** `/router config` 命令实时编辑（持久化，无需重启）。

## 安装

本包是一个 DSH **bundle**：`cordis.patch.yml` 会把插件行插入任何声明了它的 profile。下面每条通道最后都是同一条 `dsh plugin --profile <name> add …`——它在 profile 目录里转发给 pnpm。

### 从 npm 安装（推荐）

```sh
dsh plugin --profile web add dsh-shift-router
```

安装的是**预构建产物**：不会在你的机器上运行任何构建脚本，因此无需任何授权。

### 从 tarball 安装

```sh
npm pack      # 或下载 release 里的 tarball
dsh plugin --profile web add ./dsh-shift-router-0.6.0.tgz
```

同样是预构建产物；无法访问 registry 时用这条。

### 从 git 安装

```sh
dsh plugin --profile web add github:green-dalii/dsh-shift-router#v0.6.0
```

git 安装拉到的是**源码而非构建产物**，因此由包的 `prepare` 脚本构建 `dist/`。pnpm ≥ 10 默认拒绝 git 依赖的 `prepare`——若第一次 `add` 失败，把 pnpm 打印的确切包键复制进 profile 的 `pnpm-workspace.yaml` 后重新执行：

```yaml
allowBuilds:
  dsh-shift-router: true
```

> 这等于允许该包的代码在安装时于你的机器上执行，且不在 agent 沙箱内。请锁定 tag 或 commit（`…#v0.6.0`、`…#<sha>`），避免后续 push 悄悄改变你实际运行的内容。

### 从本地检出安装（开发用）

```sh
git clone https://github.com/green-dalii/dsh-shift-router.git
cd dsh-shift-router && npm install && npm run build
dsh plugin --profile web add /path/to/dsh-shift-router
```

### 确认这一层已生效

```sh
dsh --profile web --dump-config | grep -A3 'id: shift-router'
```

插件无需任何配置即可加载（所有默认值都安全）；分层模型来自设置卡片（SPEC §12）或 profile 的 patch 行。后应用的层胜出，且 patch 会替换目标行的**整个** `config` 值——覆盖本行的 patch 必须重述它需要的每一个键（SPEC §10）。

## 热重载

DeepSeek Harness 通过 `@deepseek-ai/cordis-plugin-hmr` 支持热重载，但有两点需要了解：

1. **官方 Web bundle 默认禁用了共享 HMR 行**（`packages/bundle/web-app/cordis.patch.yml` 中是 `- id: hmr, disabled: true`，上游 TODO："在 Web 的重载生命周期测试通过后重新启用共享 HMR"）。在 profile patch 中重新启用它——这是文档化的覆盖机制：

   ```yaml
   # ~/.dsh/profiles/<name>/cordis.patch.yml
   - id: hmr
     disabled: false
   ```

2. **哪些能热重载、哪些不能**（已对照当前实现实测）：
   - ✅ **配置改动** —— 编辑 profile patch（或 home patch）会以新配置重新执行受影响插件的 `apply()`，无需重启。插件自身配置也通过 settings 命名空间热生效（`/router config set` 与 GUI 卡片本来就不依赖 HMR）。
   - ❌ **模块（代码）改动** —— 当前 HMR 的 accepted 依赖图只覆盖 harness 自身模块；修改外部插件的编译产物（如 `dist/index.js`）在现行版本中不会触发重载，因此代码改动仍需重启。这正是上游 TODO 所指的未经测试的 "reload lifecycle"，不是本插件的局限。
   - ❌ **client 包元数据** —— `dsh.client` manifest 与 `exports["./client"]` 在进程内缓存，新增/修正后必须重启 profile；仅 `dist/client.js` 内容变化可走 client HMR 重建链。

   实践建议：用 `/router config` / 设置面板做配置（始终实时）；改模型就编辑 patch（开启 HMR 后实时）；只有改动插件代码时才需要重启。

## 配置

配置位于 **`shift-router`** settings 命名空间：可在 GUI 的 **设置 → 插件 → 插件配置**（「Shift-Router」卡片）中编辑、用 `/router config` 命令修改，或通过 profile patch 行配置。所有字段都有安全的默认值。

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `enabled` | `true` | 总开关 |
| `tiers.fast.models` | `[]` | Fast 层模型链（`provider/model` + `priority`）；同时也是裁判的模型链 |
| `tiers.smart.models` | `[]` | Smart 层模型链 |
| `routing.mode` | `auto` | `auto`（默认）：裁判 + 路由 + 故障转移 + 编排；`manual`：无裁判，仅显式 `/route-force` 覆盖；`off`：模型选择完全被动（命令/遥测仍可用） |
| `routing.judgeTimeout` | `5000` | 裁判调用超时（毫秒） |
| `routing.judgeMaxTokens` | `4000` | 单次裁判调用最大输出 token |
| `routing.judgePromptCap` | `6000` | 发送给裁判的最大 prompt 字符数（限制裁判成本） |
| `routing.economics.reworkPenalty` | `3` | **R** —— 一次错误降级的返工代价（以价差为倍数）。当且仅当 `pSmart ≥ θ` 时走 Smart，`θ = 1/R`：R 越大 θ 越小，越黏在 Smart |
| `routing.economics.downgradeMemory` | `2` | Smart → Fast 所需的**连续**决定性 `fast` 判定次数（hold 或 `smart` 判定都会打断连击） |
| `routing.economics.mode` | *(未设置)* | 命名档位预设，优先级高于 `reworkPenalty`：`eco`(R=2, θ=0.5) / `default`(R=3, θ≈0.33) / `sport`(R=5, θ=0.2) |
| `routing.window.size` | `5` | 决策记忆窗口大小 |
| `routing.window.threshold` | *(未设置)* | **遗留**原始 θ 覆盖值。EV 之前的默认值 `0.6` 已失效；只有不同取值才生效（并在 `/router status` 标记 `⚠ legacy`） |
| `routing.window.minConfidence` | `0.5` | 低于此置信度的判定按 **hold** 处理（不切换、不计入连击） |
| `routing.cacheAware.enabled` | `true` | 同 provider 缓存保护 |
| `routing.cacheAware.sameFamilyPenalty` | `1.5` | 两层共享 provider 时对 θ 的除数——门槛更低意味着降级更少，热缓存存活更久 |
| `routing.cacheAware.idleBoundaryMs` | `300000` | 热缓存被认为变冷前的空闲间隔 |
| `routing.cacheAware.sameFamilyThreshold` | *(未设置)* | **遗留**哨兵。EV 之前的默认值 `0.9` 已失效；不同取值等价于 `sameFamilyPenalty = 3.0` |
| `orchestration.mode` | `auto` | `auto`：复杂任务 → Smart CTO；`off`：仅普通双层路由 |
| `orchestration.maxRounds` | `3` | 委派→审查轮次硬上限（**强制执行**：每次 subagent 委派计一轮；触顶后拒绝 subagent 工具） |
| `orchestration.escalationThreshold` | `2` | **连续**工作代理失败计一次升级；工作代理成功会清零连击。达到上限后 Smart 必须亲自接管，且 subagent 工具被拒绝（**强制执行**） |
| `orchestration.maxSpendUsd` | `0` | 单个编排任务的硬预算（USD）；`0` 表示不启用。它是 `capHit` 的一部分，触顶即拒绝继续委派。需要 `pricing` 才有意义——未配置定价时花费合理地保持为 0 |
| `orchestration.workerLedgerCap` | `20` | 状态报告保留的每 worker 成本行数（超出丢最旧）。任务总额是权威值、不受影响 |
| `orchestration.audit.enabled` | `true` | 在一次**确实委派过**的运行结束后审计验收声明：每个 worker 是否都回报、是否存在 CTO 总结，以及（一次小的 Fast 档调用）声明是否有 worker 结果支撑 |
| `orchestration.audit.timeoutMs` | `5000` | 审计调用预算。免费的确定性检查总会执行 |
| `orchestration.audit.promptCap` | `6000` | 审计提示词字符上限——既是成本上限，也决定保留多少 worker 证据 |
| `failover.baseMs` | `60000` | 5xx 失败的冷却基础延迟（1 分钟） |
| `failover.maxMs` | `21600000` | 退避阶梯硬上限（6 小时） |
| `failover.startAttempts4xx` | `3` | 4xx（429/402/配额）失败从该尝试次数起步（16 分钟），客户端限流通常比服务端抖动更持久 |
| `telemetry.callLogCap` | `1000` | 基线成本计算保留的最大逐条消息归属记录数 |
| `ux.routerLogVerbose` | `false` | 把路由决策打印到本插件的 `ctx.logger`，**并**在每一轮判定后写一条路由通知（包括保持原位的轮次）。DSH 自带 profile **未挂载任何日志导出器**，所以日志只在额外挂载导出器的部署可见；通知与 `/router status` 才是始终可用的界面 |
| `ux.promptSectionOrder` | `150` | 编排器系统提示词段落的排序位置。DSH 集中分配提示词顺序（`SECTION_ORDERS`），未给第三方段落预留槽位，因此这是配置项而非常量 |
| `pricing` | `[]` | 可选 `{provider, model, input, output, cacheRead?, cacheWrite?}` 每百万 token 的 USD 计价表，用于成本遥测 |

> 所有数字字段都经 schema 范围校验（如 `window.minConfidence` 必须在 [0,1]、`window.size` 必须是正整数）；非法值在加载 / `set` 时被拒绝，绝不静默接受。

> **从 v0.5.0 升级：** 路由决策会立即发生变化（无需改配置）——决策规则从"数窗口票数"改为"权衡期望成本"，另有两个遗留旋钮的含义变更。详见 [SPEC.md §15](SPEC.md#15-migration-and-removals-v050--v060) 与 [CHANGELOG.md](CHANGELOG.md) 的 `[0.6.0]` 段。

### GUI 配置卡片

插件随包构建一个浏览器端（client）模块，在 GUI 的设置页注册一张 **「Shift-Router」** 卡片：

- **位置**：设置 → 插件 → 插件配置（该页由官方 `dsh-client-ui-settings-plugins` 提供，卡片注册进 `settings.plugin.item` 槽位）。
- **能力**：以表单编辑全部**标量**叶子字段（开关、数字、枚举）**以及两层模型链**，分七个分组（通用 / 模型 / 路由 / 编排 / 故障转移 / 遥测 / 日志与体验），路由分组下再分子组（裁判 / 决策窗口 / 缓存感知）。标量字段采用紧凑的「设置行」版式——左侧标签 + 说明，右侧同行右对齐控件——每个字段只占一行，不再上下堆叠三层。控件全部使用宿主平面设计令牌：开关用拨动开关（浅色/深色主题下对比度都清晰）、枚举用带箭头的下拉、数字输入框内嵌单位后缀（`ms`、`tokens`、`0–1` 等）、模型链用有序行编辑器——**行的顺序就是层内回退顺序**：优先命中排在最前的可用模型，其余作为后备。**provider/model 下拉自动载入 DSH 运行时模型目录**（`llm.models`，与设置页模型目录同源）：只列出当前有模型清单的 provider，无休眠目录噪音，且插件不硬编码任何模型，跟随任何部署的 DSH 实际配置。另有「自定义…」入口填写目录之外的取值。分段保存、单字段恢复默认与覆盖标记与官方卡片完全一致。
- **边界**：仅 `pricing`（可选的 USD 计价表）仍由 `/router config` 或 patch 行编辑；两层模型链都可以在卡片中直接编辑。
- **构建**：`npm run build` 会同时产出 host 产物（`dist/index.js`）与 client 产物（`dist/client.js`）。client 模块通过 `dsh.client` manifest 被 `dsh-client-modules` 扫描，**要求插件以包名（`dsh-shift-router`）挂载**——源码检出式 patch（`name: '/path/dist/index.js'`）不会提供卡片。

#### 仅旧版 harness 需要：Web 设置白名单（≤ 0.1.0-rc.x）

**0.1.0-rc.x 及更早**的 harness 会把第三方 settings 命名空间从浏览器的
`settings.describe` 响应里过滤掉，除非它出现在 `WEB_SETTINGS_NAMESPACES` 中——这正是
`scripts/expose-gui-settings.mjs` 存在的原因：它修改 profile 里已安装的
`dsh-host-apiproxy`（幂等；升级依赖后重跑）。从本项目的基线 **0.1.5-rc.2** 起，该包与白名单
**均已移除**，命名空间原生暴露，脚本会输出「不需要」并以 0 退出。该脚本不在发布包内
（`files`），只能从源码检出获得。

## 命令

| 命令 | 作用 |
|------|------|
| `/router` | 简洁状态 |
| `/router status` / `/router stats` | 完整状态：档位（R → θ）、分层、决策窗口（hold 显示为 `h`）、上一次判定及其**原因**、实际运行的模型 vs 路由器意图、切换记录、冷却、token、成本遥测 |
| `/router on` / `/router off` | 启用 / 停用（会话级） |
| `/router verbose` / `/router log` | 详细日志开关 |
| `/router orchestrate auto\|off` | 编排模式 |
| `/router allow-workers [on\|off]` | 把本插件的 Fast 链写入 harness 的 `subagent-model-selection` 白名单，使 worker 可被固定到 Fast（`off` 只撤销授权、保留路由）。会如实回报写入内容或失败原因 |
| `/router eco` / `/router default` / `/router sport` | 档位预设：设置 `routing.economics.mode`（持久化）——更省 ↔ 更黏在 Smart |
| `/router config` | 交互式编辑器：带编号的字段列表（含当前值）+ 可用 providers + 用法 |
| `/router config get <N\|path>` | 显示单个字段当前值，如 `get 4` 或 `get routing.judgeTimeout` |
| `/router config set <N\|path> <value>` | 设置单个字段（持久化），如 `set 4 8000`、`set tiers.fast.models [...]`（JSON 值自动解析） |
| `/router config unset <N\|path>` | 清除用户覆盖——字段回退到组合默认值 |
| `/router config diff` | 列出用户层当前持有的覆盖项 |
| `/router config set-fast <provider/model>` | 用单个模型替换 Fast 层模型链 |
| `/router config set-smart <provider/model>` | 用单个模型替换 Smart 层模型链 |
| `/router config reset` | 恢复组合默认值 |
| `/route-force <fast\|smart\|auto\|provider/model>` | 强制下一轮走某层/某模型（一次性） |

## 工作原理（DSH 集成）

| 能力 | DSH 机制 |
|------|----------|
| 轮次开始判定 | `agent/pre-step` waterfall（仅 `step === 1` 的顶层 Agent） |
| 模型切换 | `agent/request` waterfall（按步 provider/model 覆盖） |
| 运行时故障转移 | `agent/request-error` waterfall（冷却 + `{kind:'retry'}` 同层重试） |
| 裁判 LLM 调用 | `ctx.llm.stream()` —— 复用 harness 的适配器、凭证与 JSON 模式强制 |
| 编排指令 | `ctx.systemPrompt.section()`，编排激活时按 Agent 渲染 |
| 回合收尾 | `agent/turn-stopping`（serial）：释放一次性手动覆盖与编排状态 |
| 配置（GUI + 命令） | `dsh-settings` 命名空间 `shift-router`；`/router config` 是基于它的带编号编辑器（`settings.update` / `settings.mutate` 路径 op）；GUI 卡片是 client 模块，经 `settingsScope.bind` + `settings.plugin.item` 槽位渲染同一命名空间 |
| 用量遥测 / 冷却恢复 | `session/event` 的 `assistant/message`（TokenUsage；一次成功回复会清除该模型的冷却） |
| 命令 | `ctx.commands.register()` |
| 分层链提示词变量 | `{{shift_router_fast_chain}}` / `{{shift_router_smart_chain}}` |

吞吐速率刻意**不在**这张表里：DSH 原生已在消息页脚与 trajectory 面板按解码时间显示 `tok/s`。路由器只负责路由决策与花费，不负责速率展示。

**子代理永不参与路由。** 由 `subagent` 工具派生的工作代理带有 `session.header.origin === 'subagent'`，保持其固定的模型；路由器只驱动顶层 Agent。

### 编排与 DSH subagent 工具

原 pi 插件通过 pi-subagents 委派，使用 `agent: "worker"`、`context: "fresh"` 和每次调用固定模型——上游明确把这次调用级模型固定称为**必需项**：否则工作代理会继承父会话当前模型，而编排中途父会话正是 Smart 层，经济学前提直接崩塌。DSH 的 `subagent` 工具有一个关键差异：

- 该工具接受 `description` + `prompt`（以及 `run_in_background`）；工作代理运行在**自己的全新会话**中——prompt 就是它的整个世界。
- 每次调用的 `provider` / `model` / `reasoning_effort` **确实存在**，但受宿主白名单管控：必须启用 harness 自身的 `subagent-model-selection` 设置（默认**关闭**）并把精确路由列入 `allowedModels`。只有配置了白名单，CTO 才能把工作代理固定到 Fast 层。
- 未配置白名单时，工作代理继承父代理的模型。

因此路由器不去断言一个它无法保证的事，而是做两件事：

1. **辅助授权** —— `/router allow-workers` 代你把 Fast 链写入 harness 白名单（这是插件在组合期无法替你做的那一步）。
2. **自检** —— 当编排开启且 Fast 链非空时，报告模型可选委派不可用，指明需要启用的设置并说明后果。有两个界面，因为第一个并非总是可达：`ctx.logger` 告警（仅挂载了日志导出器的部署可见），以及 `/router status` 的 `Worker delegation:` 行（始终可见）。该白名单服务只由 `web` 组合挂载，因此在 `headless` 下该行显示 `unavailable on this harness`。
3. **如实描述** —— 编排提示词告知 CTO：工作代理的模型来自 harness 白名单，下方列出的 Fast 链是部署**应当**已授权的路由。

硬上限由路由器强制执行，不只是提示文字：编排轮次中每次 `subagent` 工具调用都会递增 `orchestration.rounds`；**连续**失败（`isError`）的 subagent 结果推进连击，达到 `orchestration.escalationThreshold` 时递增 `orchestration.escalations` 并清零连击（工作代理成功同样清零，因此偶发失败不会烧掉上限）。`capHit()` 还覆盖可选预算（`orchestration.maxSpendUsd`），并说明具体是哪一顶帽触发。一旦 `capHit()` 为真，`subagent` 工具会在 `tools/pre-execute` 被**拒绝**，编排 prompt section 切换为"立即收尾"通知。`/router status` 显示实时计数（`round x/max, esc y/threshold`）；一旦有 worker 回报，还会显示归因行 `Orchestration spend: $X · N/M workers reported`。成本取自 `pricing`；每个 worker 的花费来自**它自己**会话的用量，并按该 worker 实际运行的模型计价，因此继承了 Smart 模型的 worker 会按 Smart 计价。

硬帽能防止「跑飞」，但防不住 CTO 声称验收了却没真的核对。因此**确实委派过**的运行还会被**审计**：确定性检查总会执行（每个派出的 worker 是否回报、是否存在 CTO 总结、是否因触帽结束），并且在启用审计时用一次小的 Fast 档调用核对声明是否有 worker 结果支撑、是否对齐你的目标、是否为占位实现。审计绝不阻断或改变轮次：LLM 半分离执行，结论以 `/router status` 的 `Last audit:` 行呈现。

## 开发

```sh
npm run build       # tsc（host → dist/）+ tsc client + tsdown（client bundle → dist/client.js）
npm test            # vitest（18 个文件、336 个测试：EV 路由 / 故障转移签名 / 裁判解析与提示词契约 / 编排 / 配置 schema 与迁移 / 遥测 / 路由通知 / 配置注册表与 GUI 表单模型 + 卡片 UX + 模型目录 / 打包安装契约）
npm run typecheck
```

### 端到端测试（无需凭证）

```sh
npm run test:e2e
```

该脚本会建一个临时 `DSH_HOME`，把**本检出**作为 bundle 装进派生出的 `headless` profile，用假适配器跑一轮，并断言：

- `ROUTER-E2E: turn ran on fake/fake-smart notice=yes` —— 裁判确实跑了、EV 规则确实升级了、真的切换了上线模型到 Smart 层，并且 `[shift-router]` 路由通知确实进入了模型请求（SPEC §13.1）；
- 在 `e2e/legacy-config-overlay.yml` 下（**对齐前**配置：遗留旋钮处于旧默认值 + 已被移除的 `requireSmartModel` 键）结果相同 —— 覆盖的是**升级路径**，不只是全新安装；
- 在 `e2e/orchestration-overlay.yml` 下结果相同 —— 使用插件的**默认**编排模式（`auto`），并挂载 web 专属的 `subagent-model-selection-settings` 行，即曾经导致启动失败的那个组合；
- `shift-router` settings 命名空间能完成一次写入并读回，且 Host 模型目录确实广告出该部署配置的路由（`e2e/settings-probe.mjs`）；
- **打包产物**安装（`npm pack` → tarball → 第二个 scratch profile）能带着插件启动，浏览器端被提供给 client 模块加载器，且 profile 里**没有**任何 `@deepseek-ai/*` 副本 —— 那里没有 devDependencies，因此"运行时导入了未向消费者声明的包"会在 e2e 失败，而不是在用户机器上失败。

它不会碰你真实的 `DSH_HOME`，跑完自行清理（加 `--keep` 可保留现场）。手工复现：

```sh
DSH_HOME=/tmp/scratch dsh plugin --profile tmp add /path/to/dsh-shift-router
DSH_HOME=/tmp/scratch dsh --profile tmp --patch e2e/overlay.yml "design a migration plan"
```

## 架构

```
src/
├── index.ts        # 插件入口：事件接线、按 Agent 状态、裁判、路由通知
├── config.ts       # Schemastery schema + 深合并归一化
├── types.ts        # 共享类型 + 默认值
├── router.ts       # 纯路由引擎（升级/降级/窗口/缓存感知）
├── judge.ts        # 基于 ctx.llm.stream() 的 LLM 裁判 + 回复解析
├── failover.ts     # 指数退避冷却状态机
├── tier.ts         # 分层模型解析 + 展示
├── notice.ts       # 纯逻辑：路由通知正文与折叠行（SPEC §13.1）
├── orchestrate.ts  # 编排 prompt + 生命周期 + 上限
├── audit.ts        # 委派运行的验收审计（非阻塞，从不作为门禁）
├── stats.ts        # 遥测快照（token / 成本估算 / 节省基线）
├── commands.ts     # /router 与 /route-force
└── client/         # 浏览器端（GUI 设置卡片）
    ├── index.tsx       # client 入口：settings.plugin.item 槽位注册
    ├── controller.ts   # 暂存表单 → settings 作用域写（每 section 一次）
    ├── form-model.ts   # 纯逻辑：字段注册表 / 草稿解析 / 保存计划
    ├── card-ux.ts      # 纯逻辑：阈值推导 / 链问题 / 折叠头摘要
    ├── model-catalog.ts# Host 模型目录 → provider/model 选项
    ├── ShiftRouterCard.tsx  # 卡片组件（DSW 设计令牌）
    └── locales.ts      # zh/en 字典
```

纯逻辑（router / failover / 裁判解析 / 编排 / 审计 / 路由通知 / 表单模型、卡片 UX 与目录加载）在隔离环境中做单元测试。DSH 接线分两层验证：`tests/plugin-load.test.ts` 在**真实 Cordis 上下文**中加载插件并驱动真实的 `agent/pre-step` waterfall（未声明的服务读取、非法的提示词段顺序、缺失的路由通知都会立即失败），e2e 则启动 scratch profile —— 包括打包产物与插件的默认编排模式。

## 许可证

[MIT](LICENSE) © 2026 green-dalii and contributors.

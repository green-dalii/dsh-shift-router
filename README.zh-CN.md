[English](README.md) · **简体中文**

<div align="center">

# dsh-shift-router

**面向 DeepSeek Harness 的双层模型路由器** —— 基于 LLM 裁判的自动执行/判定路由、多模型回退链、指数退避运行时故障转移，以及任务级编排。

由 [pi-shift-router](https://github.com/green-dalii/pi-shift-router) 适配到 DSH 的版本。

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-green)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-62%20passing-brightgreen)](#development)

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

- **即时升级、趋势门控降级** —— 一次 `smart` 判定立即切到强模型；降回弱模型需要滑动窗口内的多数判定（默认 5 轮、≥60%，低置信度投票被忽略）。
- **缓存感知路由** —— 当 Fast 与 Smart 共享同一 provider 时，路由器抬高降级阈值（0.9），并在 prompt 缓存仍热时保持当前层，避免切到便宜模型反而更贵。
- **运行时故障转移** —— 429 / 5xx / 配额失败会把模型置入指数退避冷却（1m → 4m → 16m → 1h，上限 6h；客户端侧限流从 16m 起步），并在同一层内重新解析到下一个健康模型——同一轮内重试，绝不跨层。
- **任务级编排** —— 复杂任务（`smart` 判定）会让 Smart 层担任 **CTO**：规划、通过 harness 的 `subagent` 工具把实现委派给 Fast 层工程师子代理、逐个审查结果并迭代。硬上限由**插件强制执行**而非仅靠提示词：每次委派计一轮、每个失败的工作代理结果计一次升级，一旦触顶 `subagent` 工具会被直接拒绝、系统提示词切换为"立即收尾"通知。
- **成本遥测** —— 按层统计 token/吞吐，可选的 USD 计价表（`/router stats` 会显示"本次会话若全程使用 Smart 模型将花费多少"）。
- **零配置启动** —— 未配置分层前完全无操作；配置完成后路由立即生效。配置可通过 GUI 设置面板 **和** `/router config` 命令实时编辑（持久化，无需重启）。

## 安装

### 以 bundle 方式（推荐）

```sh
git clone https://github.com/green-dalii/dsh-shift-router.git
cd dsh-shift-router
npm install && npm run build
dsh plugin --profile web add /path/to/dsh-shift-router
```

bundle 的 `cordis.patch.yml` 会把插件插入任何声明了它的 profile。插件无需任何配置即可加载（所有默认值都安全）；分层模型来自设置面板或 patch 行。

从 git 安装（`dsh plugin --profile <name> add github:green-dalii/dsh-shift-router`）会通过包的 `prepare` 脚本自动构建 `dist/`。pnpm ≥ 10 默认拒绝 git 依赖的 `prepare` 脚本——若构建被跳过，需在 profile 的 `pnpm-workspace.yaml` 加以下配置后重新 `add`：

```yaml
allowBuilds:
  dsh-shift-router: true
```

> 这等于允许该包在安装时执行构建脚本。如需完全锁定的安装，改用源码检出后 `npm run build`（见下）。

### 从源码（本地开发）

把 profile 的 patch 层指向构建产物入口：

```yaml
# ~/.dsh/profiles/<name>/cordis.patch.yml
- insert:
    - id: shift-router
      name: '/absolute/path/to/dsh-shift-router/dist/index.js'
      config:
        tiers:
          fast:
            models:
              - { provider: opencode-go, model: deepseek-v4-flash, priority: 1 }
          smart:
            models:
              - { provider: opencode-go, model: deepseek-v4-pro, priority: 1 }
```

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
| `routing.window.size` | `5` | 降级滑动窗口大小 |
| `routing.window.threshold` | `0.6` | 触发降级所需的 fast 多数比例 |
| `routing.window.minConfidence` | `0.5` | 忽略低于此置信度的裁判判定 |
| `routing.cacheAware.enabled` | `true` | 同 provider 缓存保护 |
| `routing.cacheAware.sameFamilyThreshold` | `0.9` | 两层共享 provider 时的降级阈值 |
| `routing.cacheAware.idleBoundaryMs` | `300000` | 热缓存被认为变冷前的空闲间隔 |
| `orchestration.mode` | `auto` | `auto`：复杂任务 → Smart CTO；`off`：仅普通双层路由 |
| `orchestration.maxRounds` | `3` | 委派→审查轮次硬上限（**强制执行**：每次 subagent 委派计一轮；触顶后拒绝 subagent 工具） |
| `orchestration.escalationThreshold` | `2` | 失败的工作代理结果数，达到后 Smart 必须亲自接管（**强制执行**：每个 `isError` 的 subagent 结果计数） |
| `orchestration.requireSmartModel` | `true` | 无法解析 Smart 模型时跳过编排 |
| `failover.baseMs` | `60000` | 5xx 失败的冷却基础延迟（1 分钟） |
| `failover.maxMs` | `21600000` | 退避阶梯硬上限（6 小时） |
| `failover.startAttempts4xx` | `3` | 4xx（429/配额）失败从该尝试次数起步（16 分钟），客户端限流通常比服务端抖动更持久 |
| `failover.speedWindowSize` | `5` | `/router stats` 平均值保留的最近 token/秒读数数 |
| `telemetry.callLogCap` | `1000` | 基线成本计算保留的最大逐条消息归属记录数 |
| `ux.routerLogVerbose` | `false` | 把路由决策打印到 harness 日志 |
| `pricing` | `[]` | 可选 `{provider, model, input, output, cacheRead?, cacheWrite?}` 每百万 token 的 USD 计价表，用于成本遥测 |

> 所有数字字段都经 schema 范围校验（如 `window.threshold` 必须在 [0,1]、`window.size` 必须是正整数）；非法值在加载 / `set` 时被拒绝，绝不静默接受。

### GUI 配置卡片

插件随包构建一个浏览器端（client）模块，在 GUI 的设置页注册一张 **「Shift-Router」** 卡片：

- **位置**：设置 → 插件 → 插件配置（该页由官方 `dsh-client-ui-settings-plugins` 提供，卡片注册进 `settings.plugin.item` 槽位）。
- **能力**：以表单编辑全部**标量**叶子字段（开关、数字、枚举）**以及两层模型链**，分七个分组（通用 / 模型 / 路由 / 编排 / 故障转移 / 遥测 / 日志与体验），路由分组下再分子组（裁判 / 决策窗口 / 缓存感知）。标量字段采用紧凑的「设置行」版式——左侧标签 + 说明，右侧同行右对齐控件——每个字段只占一行，不再上下堆叠三层。控件全部使用宿主平面设计令牌：开关用拨动开关（浅色/深色主题下对比度都清晰）、枚举用带箭头的下拉、数字输入框内嵌单位后缀（`ms`、`tokens`、`0–1` 等）、模型链用有序行编辑器——**行的顺序就是层内回退顺序**：优先命中排在最前的可用模型，其余作为后备。**provider/model 下拉自动载入 DSH 运行时模型目录**（`llm.models`，与设置页模型目录同源）：只列出当前有模型清单的 provider，无休眠目录噪音，且插件不硬编码任何模型，跟随任何部署的 DSH 实际配置。另有「自定义…」入口填写目录之外的取值。分段保存、单字段恢复默认与覆盖标记与官方卡片完全一致。
- **边界**：仅 `pricing`（可选的 USD 计价表）仍由 `/router config` 或 patch 行编辑；两层模型链都可以在卡片中直接编辑。
- **构建**：`npm run build` 会同时产出 host 产物（`dist/index.js`）与 client 产物（`dist/client.js`）。client 模块通过 `dsh.client` manifest 被 `dsh-client-modules` 扫描，**要求插件以包名（`dsh-shift-router`）挂载**——源码检出式 patch（`name: '/path/dist/index.js'`）不会提供卡片。

#### 上游限制：Web 设置白名单（0.1.0-rc.6）

当前 Harness 的 Web API 代理（`@deepseek-ai/dsh-host-apiproxy`）**白名单**了浏览器可读写的 settings 命名空间（`WEB_SETTINGS_NAMESPACES`）；官方卡片（`shell`、`agent-loop`、`web-search-deepseek`）都在名单上，而第三方命名空间会被从浏览器的 `settings.describe` 响应中过滤掉——即使插件已在服务端注册。上游代码注释明确写着"把该决定移到 `settings.register()`（让插件自行暴露配置）是 deferred work"，且该名单不可通过配置扩展。

因此要让卡片在 Web 端可见，需要把 `shift-router` 加入名单（一次性、幂等）：

```sh
npm run build
dsh plugin --profile web add /path/to/dsh-shift-router
node scripts/expose-gui-settings.mjs --profile web   # 把 shift-router 加入白名单
# 重启 profile（client 包元数据与 apiproxy 都在进程内缓存）
```

`scripts/expose-gui-settings.mjs` 修改 profile 安装的 `dsh-host-apiproxy/lib/index.js`（幂等；升级/重装依赖后重跑即可）。

## 命令

| 命令 | 作用 |
|------|------|
| `/router` | 简洁状态 |
| `/router status` / `/router stats` | 完整状态：分层、窗口、切换记录、冷却、token、成本遥测 |
| `/router on` / `/router off` | 启用 / 停用（会话级） |
| `/router verbose` | 详细日志开关 |
| `/router orchestrate auto\|off` | 编排模式 |
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
| 配置（GUI + 命令） | `dsh-settings` 命名空间 `shift-router`；`/router config` 是基于它的带编号编辑器（`settings.update` / `settings.mutate` 路径 op）；GUI 卡片是 client 模块，经 `settingsScope.bind` + `settings.plugin.item` 槽位渲染同一命名空间 |
| 用量遥测 / 冷却恢复 | `session/event` 的 `assistant/message`（TokenUsage；一次成功回复会清除该模型的冷却） |
| 命令 | `ctx.commands.register()` |
| 分层链提示词变量 | `{{shift_router_fast_chain}}` / `{{shift_router_smart_chain}}` |

**子代理永不参与路由。** 由 `subagent` 工具派生的工作代理带有 `session.header.origin === 'subagent'`，保持其固定的模型；路由器只驱动顶层 Agent。

### 编排与 DSH subagent 工具

原 pi 插件通过 pi-subagents 委派，使用 `agent: "worker"`、`context: "fresh"` 和每次调用固定模型。DSH 的 `subagent` 工具不同：

- 该工具接受 `description` + `prompt`（以及 `run_in_background`）；工作代理运行在**自己的全新会话**中——prompt 就是它的整个世界。
- **工作代理的模型由部署配置固定**（`dsh-tool-subagent` 的 `agentOptions`），而不是由工具调用指定。默认情况下工作代理继承父代理的模型。
- 因此编排 prompt 指示 CTO 用精确的任务契约进行委派、在硬上限内审查/迭代/升级，并列出部署应在 `tool-subagent.agentOptions` 中固定 Fast 层模型链以实现成本对等。

硬上限由路由器强制执行，不只是提示文字：编排轮次中每次 `subagent` 工具调用都会递增 `orchestration.rounds`；每次失败（`isError`）的 subagent 结果递增 `orchestration.escalations`；一旦 `capHit()` 为真，`subagent` 工具会在 `tools/pre-execute` 被**拒绝**，编排 prompt section 切换为"立即收尾"通知。`/router status` 显示实时计数（`round x/max, esc y/threshold`）。

## 开发

```sh
npm run build       # tsc（host → dist/）+ tsc client + tsdown（client bundle → dist/client.js）
npm test            # vitest（95 个测试：路由 / 故障转移 / 裁判解析 / 编排 / 配置 schema / client 表单模型 / 白名单补丁逻辑）
npm run typecheck
```

### 端到端测试（无需凭证）

`e2e/` 包含一个注册了 `fake` provider 的假 LLM 适配器，因此无需任何 API key 即可演练完整路由管线：

```sh
# 先创建一个挂载本 bundle + @deepseek-ai/dsh-headless 的临时 profile：
dsh --profile <tmp> --patch e2e/overlay.yml "design a migration plan for our billing system"
# → ROUTER-E2E: turn ran on fake/fake-smart   （裁判判定 smart → 升级到 Smart 层）
```

e2e 还会验证 settings 命名空间的持久化（`e2e/settings-probe.mjs`）。

## 架构

```
src/
├── index.ts        # 插件入口：事件接线、按 Agent 状态、裁判、编排 section
├── config.ts       # Schemastery schema + 深合并归一化
├── types.ts        # 共享类型 + 默认值
├── router.ts       # 纯路由引擎（升级/降级/窗口/缓存感知）
├── judge.ts        # 基于 ctx.llm.stream() 的 LLM 裁判 + 回复解析
├── failover.ts     # 指数退避冷却状态机
├── tier.ts         # 分层模型解析 + 展示
├── orchestrate.ts  # 编排 prompt + 生命周期 + 上限
├── stats.ts        # 遥测快照（token / 吞吐 / 成本估算）
├── commands.ts     # /router 与 /route-force
└── client/         # 浏览器端（GUI 设置卡片）
    ├── index.tsx       # client 入口：settings.plugin.item 槽位注册
    ├── controller.ts   # 暂存表单 → settings 作用域写（每 section 一次）
    ├── form-model.ts   # 纯逻辑：字段注册表 / 草稿解析 / 保存计划
    ├── ShiftRouterCard.tsx  # 卡片组件（DSW 设计令牌）
    └── locales.ts      # zh/en 字典
```

纯逻辑（router / failover / 裁判解析 / 编排）在隔离环境中做单元测试；DSH 接线由 headless e2e 覆盖。

## 许可证

[MIT](LICENSE) © 2026 green-dalii and contributors.

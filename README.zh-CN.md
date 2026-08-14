[English](README.md) · **简体中文**

<div align="center">

# dsh-shift-router

**面向 DeepSeek Harness 的双层模型路由器** —— 基于 LLM 裁判的自动执行/判定路由、多模型回退链、指数退避运行时故障转移，以及任务级编排。

由 [pi-shift-router](https://github.com/green-dalii/pi-shift-router) 适配到 DSH 的版本。

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-green)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-52%20passing-brightgreen)](#development)

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
- **任务级编排** —— 复杂任务（`smart` 判定）会让 Smart 层担任 **CTO**：规划、通过 harness 的 `subagent` 工具把实现委派给 Fast 层工程师子代理、逐个审查结果并迭代——且受插件强制执行的硬上限约束。
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
   - ✅ **配置改动** —— 编辑 profile patch（或 home patch）会以新配置重新执行受影响插件的 `apply()`，无需重启。插件自身配置也通过 settings 命名空间热生效（`/router config set` 与 GUI 面板本来就不依赖 HMR）。
   - ❌ **模块（代码）改动** —— 当前 HMR 的 accepted 依赖图只覆盖 harness 自身模块；修改外部插件的编译产物（如 `dist/index.js`）在现行版本中不会触发重载，因此代码改动仍需重启。这正是上游 TODO 所指的未经测试的 "reload lifecycle"，不是本插件的局限。

   实践建议：用 `/router config` / 设置面板做配置（始终实时）；改模型就编辑 patch（开启 HMR 后实时）；只有改动插件代码时才需要重启。

## 配置

配置位于 **`shift-router`** settings 命名空间：可在 GUI（Settings → shift-router）中编辑、用 `/router config` 命令修改，或通过 profile patch 行配置。所有字段都有安全的默认值。

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `enabled` | `true` | 总开关 |
| `tiers.fast.models` | `[]` | Fast 层模型链（`provider/model` + `priority`）；同时也是裁判的模型链 |
| `tiers.smart.models` | `[]` | Smart 层模型链 |
| `routing.mode` | `auto` | `auto` / `manual` / `off`（仅信息展示；真正的开关是 `enabled`） |
| `routing.judgeTimeout` | `5000` | 裁判调用超时（毫秒） |
| `routing.window.size` | `5` | 降级滑动窗口大小 |
| `routing.window.threshold` | `0.6` | 触发降级所需的 fast 多数比例 |
| `routing.window.minConfidence` | `0.5` | 忽略低于此置信度的裁判判定 |
| `routing.cacheAware.enabled` | `true` | 同 provider 缓存保护 |
| `routing.cacheAware.sameFamilyThreshold` | `0.9` | 两层共享 provider 时的降级阈值 |
| `routing.cacheAware.idleBoundaryMs` | `300000` | 热缓存被认为变冷前的空闲间隔 |
| `orchestration.mode` | `auto` | `auto`：复杂任务 → Smart CTO；`off`：仅普通双层路由 |
| `orchestration.maxRounds` | `3` | 委派→审查轮次硬上限 |
| `orchestration.escalationThreshold` | `2` | 工作代理失败多少次后 Smart 亲自接管该阶段 |
| `orchestration.requireSmartModel` | `true` | 无法解析 Smart 模型时跳过编排 |
| `ux.quietMode` | `false` | 关闭通知 |
| `ux.routerLogVerbose` | `false` | 把路由决策打印到 harness 日志 |
| `pricing` | `[]` | 可选 `{provider, model, input, output, cacheRead?, cacheWrite?}` 每百万 token 的 USD 计价表，用于成本遥测 |

## 命令

| 命令 | 作用 |
|------|------|
| `/router` | 简洁状态 |
| `/router status` / `/router stats` | 完整状态：分层、窗口、切换记录、冷却、token、成本遥测 |
| `/router on` / `/router off` | 启用 / 停用（会话级） |
| `/router quiet` / `/router verbose` | 通知 / 详细日志开关 |
| `/router orchestrate auto\|off` | 编排模式 |
| `/router config` | 显示生效配置 + 可用 providers/models + 用法 |
| `/router config set <path> <value>` | 设置单个字段（持久化），如 `set routing.judgeTimeout 8000`、`set tiers.fast.models [...]` |
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
| 配置（GUI + 命令） | `dsh-settings` 命名空间 `shift-router`（两个入口共用同一存储） |
| 用量遥测 / 冷却恢复 | `session/event` 的 `assistant/message`（TokenUsage；一次成功回复会清除该模型的冷却） |
| 命令 | `ctx.commands.register()` |
| 分层链提示词变量 | `{{shift_router_fast_chain}}` / `{{shift_router_smart_chain}}` |

**子代理永不参与路由。** 由 `subagent` 工具派生的工作代理带有 `session.header.origin === 'subagent'`，保持其固定的模型；路由器只驱动顶层 Agent。

### 编排与 DSH subagent 工具

原 pi 插件通过 pi-subagents 委派，使用 `agent: "worker"`、`context: "fresh"` 和每次调用固定模型。DSH 的 `subagent` 工具不同：

- 该工具接受 `description` + `prompt`（以及 `run_in_background`）；工作代理运行在**自己的全新会话**中——prompt 就是它的整个世界。
- **工作代理的模型由部署配置固定**（`dsh-tool-subagent` 的 `agentOptions`），而不是由工具调用指定。默认情况下工作代理继承父代理的模型。
- 因此编排 prompt 指示 CTO 用精确的任务契约进行委派、在硬上限内审查/迭代/升级，并列出部署应在 `tool-subagent.agentOptions` 中固定 Fast 层模型链以实现成本对等。

## 开发

```sh
npm run build       # tsc → dist/
npm test            # vitest（52 个测试：路由 / 故障转移 / 裁判解析 / 编排）
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
└── commands.ts     # /router 与 /route-force
```

纯逻辑（router / failover / 裁判解析 / 编排）在隔离环境中做单元测试；DSH 接线由 headless e2e 覆盖。

## 许可证

[MIT](LICENSE) © 2026 green-dalii and contributors.

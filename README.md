<div align="center">

# dsh-shift-router

**A two-tier model router for DeepSeek Harness** — automatic execution/judgment routing with an LLM Judge, multi-model fallback chains, exponential-backoff runtime failover, and task-level orchestration.

A DSH adaptation of [pi-shift-router](https://github.com/green-dalii/pi-shift-router).

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-green)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-52%20passing-brightgreen)](#development)

</div>

Routine turns shouldn't cost flagship money. The turns that matter shouldn't be left to a cheap model.

Before every turn of a top-level agent, a small **LLM Judge** (running on your Fast-tier model chain) classifies the user's message as `fast` (routine) or `smart` (consequential). The chosen tier then drives the whole turn — thinking, tool calls, code edits — through the harness's own `agent/request` pipeline. The Judge only classifies; it never does the work.

```text
🦾 [deepseek-v4-flash] → fix the failing test
🧭 judging…
🧠 [deepseek-v4-pro]   ← "design the auth flow" → upgraded instantly
⚠️ deepseek-v4-flash 429 → cooldown, retrying on glm-5.2 — retry in 1m
🦾 [glm-5.2]           ← same-tier failover
```

## Features

- **Instant upgrades, trend-gated downgrades** — one `smart` verdict switches to the strong tier immediately; coming back down requires a sliding-window majority (default 5 turns, ≥60%, low-confidence votes ignored).
- **Cache-aware routing** — when Fast and Smart share a provider, the router raises the downgrade threshold (0.9) and holds off while the prompt cache is warm, so switching to a cheaper model never costs more than staying put.
- **Runtime failover** — 429 / 5xx / quota failures put the model into exponential-backoff cooldown (1m → 4m → 16m → 1h → 6h cap; client-side limits start at 16m) and re-resolve the same tier to the next healthy model — same-turn retry, never cross-tier.
- **Task-level orchestration** — complex tasks (a `smart` verdict) run the Smart tier as a **CTO** that plans, delegates implementation to Fast engineer subagents via the harness's `subagent` tool, reviews each result, and iterates — with plugin-enforced hard caps.
- **Cost telemetry** — per-tier token/throughput tracking and an optional USD pricing table (`/router stats` shows "what this session would have cost on the Smart model").
- **Zero-config startup** — a no-op until you configure tiers; then routing just works. Configuration is editable live via the GUI settings panel **and** `/router config` commands (persisted, no restart).

## Install

### As a bundle (recommended)

```sh
git clone https://github.com/green-dalii/dsh-shift-router.git
cd dsh-shift-router
npm install && npm run build
dsh plugin --profile web add /path/to/dsh-shift-router
```

The bundle's `cordis.patch.yml` inserts the plugin into any profile that lists it. The plugin loads without any configuration (all defaults are safe); tier models come from the settings panel or the patch row.

### From source (local development)

Point the profile's patch layer at the built entry:

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

> Note: the official Web bundle ships with shared HMR disabled, so a patch edit requires restarting `dsh web`. (Settings edits through `/router config` or the GUI apply live.)

## Configuration

Configuration lives in the **`shift-router` settings namespace**: edit it in the GUI (Settings → shift-router), with `/router config` commands, or via the profile patch row. All fields have safe defaults.

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `true` | Master switch |
| `tiers.fast.models` | `[]` | Fast-tier chain (`provider/model` + `priority`); also the Judge's model chain |
| `tiers.smart.models` | `[]` | Smart-tier chain |
| `routing.mode` | `auto` | `auto` / `manual` / `off` (informational; `enabled` is the real gate) |
| `routing.judgeTimeout` | `5000` | Judge call timeout (ms) |
| `routing.window.size` | `5` | Downgrade sliding window size |
| `routing.window.threshold` | `0.6` | Fast-majority ratio required to downgrade |
| `routing.window.minConfidence` | `0.5` | Ignore judge verdicts below this confidence |
| `routing.cacheAware.enabled` | `true` | Same-provider cache protection |
| `routing.cacheAware.sameFamilyThreshold` | `0.9` | Downgrade threshold when tiers share a provider |
| `routing.cacheAware.idleBoundaryMs` | `300000` | Idle gap before a warm cache is considered cold |
| `orchestration.mode` | `auto` | `auto`: complex → Smart CTO; `off`: plain two-tier routing |
| `orchestration.maxRounds` | `3` | Delegate→review rounds hard cap |
| `orchestration.escalationThreshold` | `2` | Worker failures before Smart takes over the phase |
| `orchestration.requireSmartModel` | `true` | Skip orchestration if the Smart model can't be resolved |
| `ux.quietMode` | `false` | Suppress notifications |
| `ux.routerLogVerbose` | `false` | Print router decisions to the harness log |
| `pricing` | `[]` | Optional `{provider, model, input, output, cacheRead?, cacheWrite?}` USD-per-1M-token table for cost telemetry |

## Commands

| Command | Effect |
|---------|--------|
| `/router` | Compact status |
| `/router status` / `/router stats` | Full status: tiers, window, transitions, cooldowns, tokens, cost telemetry |
| `/router on` / `/router off` | Enable / disable (session-scoped) |
| `/router quiet` / `/router verbose` | Notification / verbose-log toggles |
| `/router orchestrate auto\|off` | Orchestration mode |
| `/router config` | Show effective config + available providers/models + usage |
| `/router config set <path> <value>` | Set one field (persisted), e.g. `set routing.judgeTimeout 8000`, `set tiers.fast.models [...]` |
| `/router config set-fast <provider/model>` | Replace the Fast tier chain with one model |
| `/router config set-smart <provider/model>` | Replace the Smart tier chain with one model |
| `/router config reset` | Restore the composition default |
| `/route-force <fast\|smart\|auto\|provider/model>` | Force the next turn to a tier/model (one-shot) |

## How it works (DSH integration)

| Capability | DSH mechanism |
|------------|---------------|
| Turn-start classification | `agent/pre-step` waterfall (`step === 1`, top-level agents only) |
| Model switching | `agent/request` waterfall (per-step provider/model override) |
| Runtime failover | `agent/request-error` waterfall (cooldown + `{kind:'retry'}` same-tier retry) |
| Judge LLM calls | `ctx.llm.stream()` — reuses the harness's adapters, credentials, and JSON-mode enforcement |
| Orchestrator instruction | `ctx.systemPrompt.section()` rendered per agent while orchestration is active |
| Config (GUI + commands) | `dsh-settings` namespace `shift-router` (same store for both surfaces) |
| Usage telemetry / cooldown recovery | `session/event` `assistant/message` (TokenUsage; a successful message clears the model's cooldown) |
| Commands | `ctx.commands.register()` |
| Tier-chain prompt variables | `{{shift_router_fast_chain}}` / `{{shift_router_smart_chain}}` |

**Subagents are never routed.** Workers spawned by the `subagent` tool carry `session.header.origin === 'subagent'` and keep their pinned model; the router only drives top-level agents.

### Orchestration and the DSH subagent tool

The original pi plugin delegated through pi-subagents with `agent: "worker"`, `context: "fresh"`, and a per-call model pin. DSH's `subagent` tool differs:

- The tool takes `description` + `prompt` (and `run_in_background`); a worker runs in its **own fresh session** — the prompt is its world.
- **The worker model is pinned by deployment configuration** (`dsh-tool-subagent`'s `agentOptions`), not by the tool call. By default a worker inherits the parent's model.
- Therefore the orchestrator prompt instructs the CTO to delegate with precise task contracts, review/iterate/escalate within the hard caps, and lists the Fast-tier chain the deployment should have pinned in `tool-subagent.agentOptions` for cost parity.

## Development

```sh
npm run build       # tsc → dist/
npm test            # vitest (52 tests: routing / failover / judge parsing / orchestration)
npm run typecheck
```

### End-to-end test (no credentials)

`e2e/` contains a fake LLM adapter that registers the `fake` provider, so the whole routing pipeline can be exercised without any API key:

```sh
# after creating a scratch profile with this bundle + @deepseek-ai/dsh-headless:
dsh --profile <tmp> --patch e2e/overlay.yml "design a migration plan for our billing system"
# → ROUTER-E2E: turn ran on fake/fake-smart   (judge said smart → upgraded to the Smart tier)
```

The e2e also verifies the settings namespace persists (`e2e/settings-probe.mjs`).

## Architecture

```
src/
├── index.ts        # plugin entry: event wiring, per-agent state, judge, orchestration section
├── config.ts       # Schemastery schema + deep-merge normalization
├── types.ts        # shared types + defaults
├── router.ts       # pure routing engine (upgrade/downgrade/window/cache-aware)
├── judge.ts        # LLM Judge via ctx.llm.stream() + reply parsing
├── failover.ts     # exponential-backoff cooldown state machine
├── tier.ts         # tier model resolution + display
├── orchestrate.ts  # orchestrator prompt + lifecycle + caps
├── stats.ts        # telemetry snapshot (tokens / throughput / cost estimate)
└── commands.ts     # /router and /route-force
```

Pure logic (router / failover / judge parsing / orchestration) is unit-tested in isolation; DSH wiring is exercised by the headless e2e.

## License

[MIT](LICENSE) © 2026 green-dalii and contributors.

**English** · [简体中文](README.zh-CN.md)

<div align="center">

# dsh-shift-router

**A two-tier model router for DeepSeek Harness** — automatic execution/judgment routing with an LLM Judge, multi-model fallback chains, exponential-backoff runtime failover, and task-level orchestration.

A DSH adaptation of [pi-shift-router](https://github.com/green-dalii/pi-shift-router).
Ported from upstream **v1.0.0**; aligned with upstream **v1.6.0** — see
[ROADMAP.md](ROADMAP.md#upstream-alignment) for the per-version table and
[SPEC.md](SPEC.md) for the contract.

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-green)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-201%20passing-brightgreen)](#development)

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

- **Expected-cost routing** — the turn runs Smart iff `pSmart ≥ θ`, with `θ = 1/reworkPenalty`: the bar is price-independent, so the one knob is how badly a wrong downgrade hurts. Upgrades are instant; coming back down needs `downgradeMemory` **consecutive** decisive `fast` turns. A Judge outage or an unsure verdict is a **hold** — the router keeps its position instead of guessing.
- **Cache-aware routing** — when Fast and Smart share a provider, the decision bar is divided by `sameFamilyPenalty` (default 1.5) and downgrades are held off while the prompt cache is warm, so switching to a cheaper model never costs more than staying put.
- **Runtime failover** — 429 / 402 / 5xx / quota / usage-limit / unsupported-model failures put the model into exponential-backoff cooldown (1m → 4m → 16m → 1h → 6h cap; client-side limits start at 16m) and re-resolve the same tier to the next healthy model — same-turn retry, never cross-tier.
- **Task-level orchestration** — complex tasks run the Smart tier as a **CTO** that plans, delegates implementation to Fast engineer subagents via the harness's `subagent` tool, reviews each result, and iterates. The hard caps are **enforced by the plugin**, not just prompted: each delegation counts a round, consecutive worker failures count an escalation, and once a cap is hit the `subagent` tool is denied outright and the system prompt switches to a "wrap up now" notice.
- **Cost telemetry** — per-tier token tracking and an optional USD pricing table (`/router status` shows "what this session would have cost on the Smart model").
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

Installing from git (`dsh plugin --profile <name> add github:green-dalii/dsh-shift-router`) builds `dist/` automatically via the package's `prepare` script. pnpm ≥ 10 refuses git dependencies' `prepare` scripts by default — add this to the profile's `pnpm-workspace.yaml` and re-`add` if the build is skipped:

```yaml
allowBuilds:
  dsh-shift-router: true
```

> This grants the package permission to run its build script at install time. For a fully lock-down install, use `npm run build` on a source checkout (below) instead.

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

## Hot reload

DeepSeek Harness supports hot reload through `@deepseek-ai/cordis-plugin-hmr`, but two things are worth knowing:

1. **The official Web bundle ships the shared HMR row disabled** (`packages/bundle/web-app/cordis.patch.yml` has `- id: hmr, disabled: true`, upstream TODO: "Re-enable shared HMR for Web after its reload lifecycle is tested"). Re-enable it in your profile patch — this is the documented override mechanism:

   ```yaml
   # ~/.dsh/profiles/<name>/cordis.patch.yml
   - id: hmr
     disabled: false
   ```

2. **What hot-reloads and what doesn't** (verified against the current implementation):
   - ✅ **Configuration changes** — editing this profile patch (or the home patch) re-runs the affected plugin's `apply()` with the new config, no restart. The plugin's own config is also hot through the settings namespace (`/router config set` and the GUI card apply live without HMR at all).
   - ❌ **Module (code) changes** — the HMR accepted-dependency graph currently covers the harness's own modules only; editing an external plugin's compiled files (e.g. `dist/index.js`) does not trigger a reload in the current release, so code changes still require a restart. This is the untested "reload lifecycle" the upstream TODO refers to, not a limitation of this plugin.
   - ❌ **Client package metadata** — the `dsh.client` manifest and `exports["./client"]` are cached in-process; adding/fixing them requires a profile restart (only `dist/client.js` content changes ride the client HMR rebuild chain).

   In practice: configure with `/router config` / the settings panel (always live), switch models by editing the patch (live once HMR is on), and restart only when you change plugin code.

## Configuration

Configuration lives in the **`shift-router` settings namespace**: edit it in the GUI (**Settings → Plugins → Plugin configuration** — the "Shift-Router" card), with `/router config` commands, or via the profile patch row. All fields have safe defaults.

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `true` | Master switch |
| `tiers.fast.models` | `[]` | Fast-tier chain (`provider/model` + `priority`); also the Judge's model chain |
| `tiers.smart.models` | `[]` | Smart-tier chain |
| `routing.mode` | `auto` | `auto` (default): judge + routing + failover + orchestration; `manual`: no judge, only explicit `/route-force` overrides; `off`: fully passive for model selection (commands/telemetry still work) |
| `routing.judgeTimeout` | `5000` | Judge call timeout (ms) |
| `routing.judgeMaxTokens` | `4000` | Max output tokens for a single Judge call |
| `routing.judgePromptCap` | `6000` | Max prompt characters sent to the Judge (bounds Judge cost) |
| `routing.economics.reworkPenalty` | `3` | **R** — how many price-deltas a wrong downgrade costs. The turn runs Smart iff `pSmart ≥ θ`, where `θ = 1/R`: higher R → lower θ → stickier on Smart |
| `routing.economics.downgradeMemory` | `2` | Consecutive decisive `fast` turns required before Smart → Fast (a hold or a `smart` verdict resets the streak) |
| `routing.economics.mode` | *(unset)* | Named gear preset, authoritative over `reworkPenalty`: `eco` (R=2, θ=0.5) / `default` (R=3, θ≈0.33) / `sport` (R=5, θ=0.2) |
| `routing.window.size` | `5` | Decision-memory window size |
| `routing.window.threshold` | *(unset)* | **Legacy** raw-θ override. The pre-EV default `0.6` is inert; only a different value is honoured (and flagged `⚠ legacy` in `/router status`) |
| `routing.window.minConfidence` | `0.5` | Verdicts below this are treated as a **hold** (never a switch, never a streak entry) |
| `routing.cacheAware.enabled` | `true` | Same-provider cache protection |
| `routing.cacheAware.sameFamilyPenalty` | `1.5` | Divisor applied to θ when both tiers share a provider — a smaller bar means fewer downgrades, so the warm prompt cache survives longer |
| `routing.cacheAware.idleBoundaryMs` | `300000` | Idle gap before a warm cache is considered cold |
| `routing.cacheAware.sameFamilyThreshold` | *(unset)* | **Legacy** sentinel. The pre-EV default `0.9` is inert; a different value implies `sameFamilyPenalty = 3.0` |
| `orchestration.mode` | `auto` | `auto`: complex → Smart CTO; `off`: plain two-tier routing |
| `orchestration.maxRounds` | `3` | Delegate→review rounds hard cap (**enforced**: each subagent delegation counts one round; at the cap the subagent tool is denied) |
| `orchestration.escalationThreshold` | `2` | **Consecutive** worker failures that count as one escalation; a successful worker result resets the streak. At the cap Smart must take over and the subagent tool is denied (**enforced**) |
| `failover.baseMs` | `60000` | Cooldown base delay for 5xx failures (1m) |
| `failover.maxMs` | `21600000` | Hard cap on the backoff ladder (6h) |
| `failover.startAttempts4xx` | `3` | 4xx (429/402/quota) failures start at this attempt (16m), client limits usually outlive server blips |
| `telemetry.callLogCap` | `1000` | Max per-message attribution records kept for baseline cost computation |
| `ux.routerLogVerbose` | `false` | Print router decisions to the harness log |
| `pricing` | `[]` | Optional `{provider, model, input, output, cacheRead?, cacheWrite?}` USD-per-1M-token table for cost telemetry |

> All numeric fields are range-validated by the schema (e.g. `window.minConfidence` must be in [0,1], `window.size` a positive integer); invalid values are rejected at load / on `set`, never silently accepted.

> **Upgrading from v0.5.0:** routing decisions change immediately with no config
> edit — the decision rule went from counting window votes to weighing expected
> cost, and two legacy knobs changed meaning. See
> [SPEC.md §15](SPEC.md#15-migration-and-removals-v050--the-alignment-release)
> and the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md).

### GUI configuration card

The package ships a browser-side (client) module that registers a **"Shift-Router"** card in the GUI settings page:

- **Where**: Settings → Plugins → Plugin configuration (that page is provided by the official `dsh-client-ui-settings-plugins`; the card registers into the `settings.plugin.item` slot).
- **What**: a form over every scalar leaf field (booleans, numbers, enums) **plus the two tier model chains**, grouped into seven sections (General / Models / Routing / Orchestration / Failover / Telemetry / Logs & UX) with sub-groups for the routing section (Judge / Decision window / Cache-aware). Scalar fields use the compact settings-row pattern — label + hint on the left, control right-aligned on the same line — so each field is one tight row instead of three stacked lines. Controls use the host-plane design tokens: toggle switches (contrast-safe in light and dark themes), a styled select for enums, unit suffixes inside numeric inputs (`ms`, `tokens`, `0–1`, …), and an ordered row editor for model chains — the row order is the in-tier fallback order, so the first available model wins and the rest are its fallbacks. The provider/model dropdowns are auto-loaded from **DSH's runtime model catalog** (`llm.models` — the same catalog the DSH settings surface reads): only providers with a currently advertised model list appear, no dormant-directory noise, and nothing is hardcoded, so the card works with any deployment's configured models. A "Custom…" escape covers values outside the catalog. Staged saving, per-field reset to default, and override markers work exactly like the official cards.
- **Boundary**: only `pricing` (the optional USD cost table) stays with `/router config` and the profile patch; the tier model chains are editable in the card.
- **Build**: `npm run build` emits both the host artifact (`dist/index.js`) and the client bundle (`dist/client.js`). The client module is discovered through the `dsh.client` manifest by `dsh-client-modules`, which requires the plugin to be mounted **by package name (`dsh-shift-router`)** — a source-checkout patch (`name: '/path/dist/index.js'`) does not serve the card.

#### Upstream limitation: the Web settings whitelist (0.1.0-rc.6)

The current Harness Web API proxy (`@deepseek-ai/dsh-host-apiproxy`) **whitelists** which settings namespaces the browser may read and write (`WEB_SETTINGS_NAMESPACES`). The official cards (`shell`, `agent-loop`, `web-search-deepseek`) are on the list; a third-party namespace is filtered out of the browser's `settings.describe` response even though the plugin registered it server-side. The upstream comment explicitly calls moving that decision to `settings.register()` (letting a plugin self-expose) "deferred work", and the list is not configurable.

So the card needs `shift-router` added to the whitelist (one-time, idempotent):

```sh
npm run build
dsh plugin --profile web add /path/to/dsh-shift-router
node scripts/expose-gui-settings.mjs --profile web   # adds shift-router to the whitelist
# restart the profile (client package metadata and the apiproxy are cached in-process)
```

`scripts/expose-gui-settings.mjs` patches the profile's installed `dsh-host-apiproxy/lib/index.js` (idempotent; re-run after upgrading/reinstalling the dependency).

## Commands

| Command | Effect |
|---------|--------|
| `/router` | Compact status |
| `/router status` / `/router stats` | Full status: gear (R → θ), tiers, decision window (holds shown as `h`), the last decision and *why*, the model that actually ran vs the router's intent, transitions, cooldowns, tokens, cost telemetry |
| `/router on` / `/router off` | Enable / disable (session-scoped) |
| `/router verbose` / `/router log` | Toggle verbose router logging |
| `/router orchestrate auto\|off` | Orchestration mode |
| `/router eco` / `/router default` / `/router sport` | Gear presets: set `routing.economics.mode` (persisted) — cheaper ↔ stickier on Smart |
| `/router config` | Interactive editor: numbered field list with current values + available providers + usage |
| `/router config get <N\|path>` | Show one field's current value, e.g. `get 4` or `get routing.judgeTimeout` |
| `/router config set <N\|path> <value>` | Set one field (persisted), e.g. `set 4 8000`, `set tiers.fast.models [...]` (JSON values auto-parsed) |
| `/router config unset <N\|path>` | Clear a user override — the field reverts to its composition default |
| `/router config diff` | List the overrides the user layer currently holds |
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
| Judge LLM calls | `ctx.llm.stream()` — reuses the harness's adapters, credentials, and provider retry. The Judge prompt asks for a JSON reply and the parser is tolerant (JSON → loose → bare word); the plugin does **not** claim JSON-mode enforcement from the harness |
| Orchestrator instruction | `ctx.systemPrompt.section()` rendered per agent while orchestration is active |
| Turn teardown | `agent/turn-stopping` serial event (releases the one-turn manual override and orchestration state) |
| Orchestration hard caps | `tools/pre-execute` denies the `subagent` tool at the cap; `tools/result` counts worker outcomes; the prompt section switches to a "wrap up" notice |
| Config (GUI + commands) | `dsh-settings` namespace `shift-router`; `/router config` is a numbered editor over it (`settings.update` / `settings.mutate` path ops); the GUI card is a client module binding the same namespace via `settingsScope` + the `settings.plugin.item` slot |
| Usage telemetry / cooldown recovery | `session/event` `assistant/message` (TokenUsage; a successful message clears the model's cooldown) |
| Commands | `ctx.commands.register()` |
| Tier-chain prompt variables | `{{shift_router_fast_chain}}` / `{{shift_router_smart_chain}}` |

Throughput is deliberately **not** part of this table: DSH already renders `tok/s`
natively in the chat message footer and the trajectory panel, from decode time.
The router owns routing decisions and spend, not rate display.

**Subagents are never routed.** Workers spawned by the `subagent` tool carry `session.header.origin === 'subagent'` and keep their pinned model; the router only drives top-level agents.

### Orchestration and the DSH subagent tool

The original pi plugin delegated through pi-subagents with `agent: "worker"`, `context: "fresh"`, and a per-call model pin — and upstream calls that per-call pin **mandatory**, because without it a worker inherits the parent session's current model, which is Smart mid-orchestration: the economics collapse. DSH's `subagent` tool differs in a way that matters:

- The tool takes `description` + `prompt` (and `run_in_background`); a worker runs in its **own fresh session** — the prompt is its world.
- Per-call `provider` / `model` / `reasoning_effort` **do exist**, but they are gated by a host-owned allowlist: the harness's `subagent-model-selection` setting (default **off**) must be enabled and list the exact routes in `allowedModels`. Only then can the CTO pin a worker to the Fast tier.
- When that allowlist is not configured, a worker inherits the parent's model.

So the router does two things instead of asserting a guarantee it cannot keep:

1. **Startup self-check** — when orchestration is enabled and the Fast chain is non-empty, it warns if model-selectable delegation is unavailable, naming the setting to enable and stating the consequence.
2. **Factual prompt** — the orchestrator prompt tells the CTO that a worker's model comes from the harness allowlist, and that the Fast chain listed below is what the deployment should have authorised.

The caps are enforced by the router, not just described: every `subagent` tool call while an orchestration turn is active increments `orchestration.rounds`; **consecutive** failed (`isError`) subagent results advance a streak, and reaching `orchestration.escalationThreshold` increments `orchestration.escalations` and resets the streak (a successful worker result also resets it, so isolated failures do not burn the cap). Once `capHit()` is true the `subagent` tool is **denied** at `tools/pre-execute` and the orchestrator prompt section is replaced by a "wrap up now" notice. `/router status` shows the live counters (`round x/max, esc y/threshold`).

## Development

```sh
npm run build       # tsc (host → dist/) + tsc client + tsdown (client bundle → dist/client.js)
npm test            # vitest (201 tests across 12 files: EV routing / failover signatures / judge parsing + prompt contract / orchestration / config schema + migration / telemetry / config registries + GUI form model / whitelist patch)
npm run typecheck
```

### End-to-end test (no credentials)

`e2e/` contains a fake LLM adapter that registers the `fake` provider, so the whole routing pipeline can be exercised without any API key:

```sh
npm run test:e2e
```

That builds a throwaway `DSH_HOME`, installs **this checkout** as a bundle into a derived
`headless` profile, runs one turn through the fake adapter, and asserts:

- `ROUTER-E2E: turn ran on fake/fake-smart` — the Judge ran, the EV rule escalated, and the
  wire model was actually switched to the Smart tier;
- the `shift-router` settings namespace round-trips a write (`e2e/settings-probe.mjs`).

It never touches your real `DSH_HOME` and cleans up after itself (`--keep` to inspect). To run
the same thing by hand, install the bundle into a scratch profile and apply the overlay:

```sh
DSH_HOME=/tmp/scratch dsh plugin --profile tmp add /path/to/dsh-shift-router
DSH_HOME=/tmp/scratch dsh --profile tmp --patch e2e/overlay.yml "design a migration plan"
```

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
├── stats.ts        # telemetry snapshot (tokens / cost estimate / savings baseline)
├── commands.ts     # /router and /route-force
└── client/         # browser half (GUI settings card)
    ├── index.tsx       # client entry: registers into the settings.plugin.item slot
    ├── controller.ts   # staged form → settings-scope writes (one per section)
    ├── form-model.ts   # pure logic: field registry / draft parsing / save plan
    ├── ShiftRouterCard.tsx  # card component (DSW design tokens)
    └── locales.ts      # zh/en dictionaries
```

Pure logic (router / failover / judge parsing / orchestration) is unit-tested in isolation; DSH wiring is exercised by the headless e2e.

## License

[MIT](LICENSE) © 2026 green-dalii and contributors.

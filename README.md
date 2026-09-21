**English** · [简体中文](README.zh-CN.md)

<div align="center">

# dsh-shift-router

**A two-tier model router for DeepSeek Harness** — automatic execution/judgment routing with an LLM Judge, multi-model fallback chains, exponential-backoff runtime failover, and task-level orchestration.

A DSH adaptation of [pi-shift-router](https://github.com/green-dalii/pi-shift-router).
Ported from upstream **v1.0.0**; aligned with upstream **v1.6.0** — see
[ROADMAP.md](ROADMAP.md#upstream-alignment) for the per-version table and
[SPEC.md](SPEC.md) for the contract.

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-shift-router?logo=npm)](https://www.npmjs.com/package/dsh-shift-router)
[![DSH](https://img.shields.io/badge/DSH-0.1.5--rc.2-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-green)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-336%20passing-brightgreen)](#development)
[![DSH plugin](https://img.shields.io/badge/dsh--plugin-✅-green)](https://github.com/topics/dsh-plugin)

</div>

Routine turns shouldn't cost flagship money. The turns that matter shouldn't be left to a cheap model.

Before every turn of a top-level agent, a small **LLM Judge** (running on your Fast-tier model chain) classifies the user's message as `fast` (routine) or `smart` (consequential). The chosen tier then drives the whole turn — thinking, tool calls, code edits — through the harness's own `agent/request` pipeline. The Judge only classifies; it never does the work.

```text
🦾 [deepseek-flash]     → fix the failing test
🧭 judging…
🧠 [deepseek-v4-pro]    ← "design the auth flow" → upgraded instantly
⚠️ deepseek-flash 429 → cooldown, same-tier failover — retry in 1m
🦾 [deepseek-v4-flash]  ← next healthy model in the Fast chain
```

## Features

- **Expected-cost routing** — the turn runs Smart iff `pSmart ≥ θ`, with `θ = 1/reworkPenalty`: the bar is price-independent, so the one knob is how badly a wrong downgrade hurts. Upgrades are instant; coming back down needs `downgradeMemory` **consecutive** decisive `fast` turns. A Judge outage or an unsure verdict is a **hold** — the router keeps its position instead of guessing.
- **Cache-aware routing** — when Fast and Smart share a provider, the decision bar is divided by `sameFamilyPenalty` (default 1.5) and downgrades are held off while the prompt cache is warm, so switching to a cheaper model never costs more than staying put.
- **Runtime failover** — 429 / 402 / 5xx / quota / usage-limit / unsupported-model failures put the model into exponential-backoff cooldown (1m → 4m → 16m → 1h04m → 4h16m → 6h cap; client-side limits start at 16m) and re-resolve the same tier to the next healthy model — same-turn retry, never cross-tier.
- **Task-level orchestration** — complex tasks run the Smart tier as a **CTO** that plans, delegates implementation to Fast engineer subagents via the harness's `subagent` tool, reviews each result, and iterates. The hard caps are **enforced by the plugin**, not just prompted: each delegation counts a round, consecutive worker failures count an escalation, and once a cap is hit the `subagent` tool is denied outright and the system prompt switches to a "wrap up now" notice.
- **Cost telemetry** — per-tier token tracking and an optional USD pricing table (`/router status` shows "what this session would have cost on the Smart model").
- **Visible when it acts** — a tier or model switch is written into the transcript as a `[shift-router] Fast → Smart · …` notice (the harness has no status-bar seat for plugins), so an enabled router is never silently invisible. Set `ux.routerLogVerbose` to get one notice per judged turn, not just per switch.
- **Zero-config startup** — a no-op until you configure tiers; then routing just works. Configuration is editable live via the GUI settings panel **and** `/router config` commands (persisted, no restart).

## Install

This package is a DSH **bundle**: its `cordis.patch.yml` inserts the plugin row
into any profile that lists it. Every channel below ends in the same
`dsh plugin --profile <name> add …`, which forwards to pnpm inside the profile
directory.

### From npm (recommended)

```sh
dsh plugin --profile web add dsh-shift-router
```

Installs the prebuilt artifact — no build script runs on your machine, so there
is nothing to authorize.

### From a tarball

```sh
npm pack      # or download the release tarball
dsh plugin --profile web add ./dsh-shift-router-0.6.0.tgz
```

Prebuilt as well, and the option to reach for when a registry is not available.

### From git

```sh
dsh plugin --profile web add github:green-dalii/dsh-shift-router#v0.6.0
```

A git install fetches **source, not artifacts**, so the package's `prepare`
script builds `dist/`. pnpm ≥ 10 refuses a git dependency's `prepare` until you
allow it — if the first `add` fails, copy the exact key pnpm prints into the
profile's `pnpm-workspace.yaml` and re-run:

```yaml
allowBuilds:
  dsh-shift-router: true
```

> This authorizes the package's code to execute on your machine at install time,
> outside the agent sandbox. Pin a tag or commit (`…#v0.6.0`, `…#<sha>`) so a
> later push cannot change what you actually run.

### From a local checkout (development)

```sh
git clone https://github.com/green-dalii/dsh-shift-router.git
cd dsh-shift-router && npm install && npm run build
dsh plugin --profile web add /path/to/dsh-shift-router
```

### Verify the layer landed

```sh
dsh --profile web --dump-config | grep -A3 'id: shift-router'
```

The plugin loads with no configuration at all (every default is safe); tier
models come from the settings card (SPEC §12) or from the profile's patch row.
Later layers win, and a patch replaces the target row's **whole** `config` value
— a row that overrides this one must restate every key it needs (SPEC §10).

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

Tier models are the only thing you must choose: **[docs/MODELS.md](docs/MODELS.md)** covers how
to pick a Fast and a Smart model (the Fast chain also serves the Judge), what makes a good fallback,
and which models can take images.

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
| `orchestration.maxSpendUsd` | `0` | Hard budget for one orchestrated task, in USD; `0` disables it. It is part of `capHit`, so reaching it denies further delegation. Needs a `pricing` entry to be meaningful — with no pricing the spend is legitimately 0 |
| `orchestration.workerLedgerCap` | `20` | Per-worker cost rows kept for the status report (oldest dropped). The task total is authoritative and unaffected |
| `orchestration.audit.enabled` | `true` | After a run that actually delegated, audit the acceptance claim: every worker reported, a CTO summary exists, and (one small Fast-tier call) the claim is grounded in the worker results |
| `orchestration.audit.timeoutMs` | `5000` | Auditor call budget. The free deterministic checks always run |
| `orchestration.audit.promptCap` | `6000` | Character cap for the auditor prompt — the cost bound, and the cap that bounds how much worker evidence is kept |
| `failover.baseMs` | `60000` | Cooldown base delay for 5xx failures (1m) |
| `failover.maxMs` | `21600000` | Hard cap on the backoff ladder (6h) |
| `failover.startAttempts4xx` | `3` | 4xx (429/402/quota) failures start at this attempt (16m), client limits usually outlive server blips |
| `telemetry.callLogCap` | `1000` | Max per-message attribution records kept for baseline cost computation |
| `ux.routerLogVerbose` | `false` | Print router decisions to the plugin's `ctx.logger`, **and** emit a route notice on every judged turn (including one that holds position). The stock DSH profiles register **no log exporter**, so the log lines are visible only where a deployment mounts one — the notice and `/router status` are the surfaces that always work |
| `ux.promptSectionOrder` | `150` | Sort position of the orchestrator system-prompt section. DSH allocates prompt order centrally (`SECTION_ORDERS`) and reserves no slot for third-party sections, so this is a setting, not a constant |
| `pricing` | `[]` | Optional `{provider, model, input, output, cacheRead?, cacheWrite?}` USD-per-1M-token table for cost telemetry |

> All numeric fields are range-validated by the schema (e.g. `window.minConfidence` must be in [0,1], `window.size` a positive integer); invalid values are rejected at load / on `set`, never silently accepted.

> **Upgrading from v0.5.0:** routing decisions change immediately with no config
> edit — the decision rule went from counting window votes to weighing expected
> cost, and two legacy knobs changed meaning. See
> [SPEC.md §15](SPEC.md#15-migration-and-removals-v050--v060)
> and the `[0.6.0]` section of [CHANGELOG.md](CHANGELOG.md).

### GUI configuration card

The package ships a browser-side (client) module that registers a **"Shift-Router"** card in the GUI settings page:

- **Where**: Settings → Plugins → Plugin configuration (that page is provided by the official `dsh-client-ui-settings-plugins`; the card registers into the `settings.plugin.item` slot).
- **What**: a form over every scalar leaf field (booleans, numbers, enums) **plus the two tier model chains**, grouped into seven sections (General / Models / Routing / Orchestration / Failover / Telemetry / Logs & UX) with sub-groups for the routing section (Judge / Decision window / Cache-aware). Scalar fields use the compact settings-row pattern — label + hint on the left, control right-aligned on the same line — so each field is one tight row instead of three stacked lines. Controls use the host-plane design tokens: toggle switches (contrast-safe in light and dark themes), a styled select for enums, unit suffixes inside numeric inputs (`ms`, `tokens`, `0–1`, …), and an ordered row editor for model chains — the row order is the in-tier fallback order, so the first available model wins and the rest are its fallbacks. The provider/model dropdowns are auto-loaded from **DSH's runtime model catalog** (`llm.models` — the same catalog the DSH settings surface reads): only providers with a currently advertised model list appear, no dormant-directory noise, and nothing is hardcoded, so the card works with any deployment's configured models. A "Custom…" escape covers values outside the catalog. Staged saving, per-field reset to default, and override markers work exactly like the official cards.
- **Boundary**: only `pricing` (the optional USD cost table) stays with `/router config` and the profile patch; the tier model chains are editable in the card.
- **Build**: `npm run build` emits both the host artifact (`dist/index.js`) and the client bundle (`dist/client.js`). The client module is discovered through the `dsh.client` manifest by `dsh-client-modules`, which requires the plugin to be mounted **by package name (`dsh-shift-router`)** — a source-checkout patch (`name: '/path/dist/index.js'`) does not serve the card.

#### Legacy harnesses only: the Web settings whitelist (≤ 0.1.0-rc.x)

Harness builds up to **0.1.0-rc.x** filtered a third-party settings namespace out of
the browser's `settings.describe` response unless it appeared in
`WEB_SETTINGS_NAMESPACES` — which is why `scripts/expose-gui-settings.mjs` exists: it
patches the profile's installed `dsh-host-apiproxy` (idempotent; re-run after a
dependency upgrade). From **0.1.5-rc.2**, this project's baseline, that package and its
whitelist are **gone** and the namespace is exposed natively, so the script reports
"not needed" and exits 0. It is not part of the published package (`files`), so it is
only reachable from a source checkout.

## Commands

| Command | Effect |
|---------|--------|
| `/router` | Compact status |
| `/router status` / `/router stats` | Full status: gear (R → θ), tiers, decision window (holds shown as `h`), the last decision and *why*, the model that actually ran vs the router's intent, worker delegation (`Worker delegation:`), transitions, cooldowns, tokens, cost telemetry |
| `/router on` / `/router off` | Enable / disable (session-scoped) |
| `/router verbose` / `/router log` | Toggle verbose router logging |
| `/router orchestrate auto\|off` | Orchestration mode |
| `/router allow-workers [on\|off]` | Authorise this plugin's Fast-tier routes in the harness `subagent-model-selection` allowlist, so workers can be pinned to Fast (`off` revokes, keeping the routes). Reports exactly what it wrote, or why it could not |
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

The mechanism-by-mechanism mapping is normative and lives in
[SPEC.md §1.1](SPEC.md#11-dsh-integration-map). Two things are worth stating here because they are
*not* in that table:

- **Throughput is deliberately absent.** DSH renders `tok/s` natively (chat footer, trajectory panel)
  from decode time; the router owns routing decisions and spend, not rate display.
- **Subagents are never routed.** Workers spawned by the `subagent` tool carry
  `session.header.origin === 'subagent'` and keep their pinned model; the router drives top-level
  agent turns only.

### Orchestration and the DSH subagent tool

Upstream calls the per-worker model pin **mandatory**: without it a worker inherits the parent's
model — Smart mid-orchestration — and the economics collapse. In DSH that pin sits behind a
**host-owned allowlist** (`subagent-model-selection`, default off), so instead of asserting a
guarantee it cannot keep, the router:

1. writes the Fast chain into that allowlist for you (`/router allow-workers` — the one step it
   cannot take at composition time);
2. says so where you can read it when the allowlist is absent: a `Worker delegation:` line in
   `/router status` (the `ctx.logger` copy is visible only where a log exporter is mounted);
3. tells the CTO, factually, where a worker's model comes from.

The caps (`maxRounds`, consecutive-failure escalation, `maxSpendUsd`) are **enforced by the
router**, not merely prompted: at the cap the `subagent` tool is denied and the prompt section
switches to a wrap-up notice, with live counters in `/router status`. A run that actually delegated
is also audited — deterministic checks always, one detached Fast-tier review when enabled, never
blocking a turn — surfacing as `Last audit:`. Contracts: SPEC §7.3, §7.4, §7.4.1.

## Development

```sh
npm run build       # tsc (host → dist/) + tsc client + tsdown (client bundle → dist/client.js)
npm test            # vitest (336 tests across 18 files: EV routing / failover signatures / judge parsing + prompt contract / orchestration / config schema + migration / telemetry / route notices / config registries + GUI form model + card UX + model catalog / packaged-install contract)
npm run typecheck
```

### End-to-end test (no credentials)

`e2e/` contains a fake LLM adapter that registers the `fake` provider, so the whole routing pipeline can be exercised without any API key:

```sh
npm run test:e2e
```

That builds a throwaway `DSH_HOME`, installs **this checkout** as a bundle into a derived
`headless` profile, runs one turn through the fake adapter, and asserts:

- `ROUTER-E2E: turn ran on fake/fake-smart notice=yes` — the Judge ran, the EV rule escalated,
  the wire model was actually switched to the Smart tier, and the `[shift-router]` route notice
  reached the model request (SPEC §13.1);
- the same outcome under `e2e/legacy-config-overlay.yml`, a profile patched with the
  **pre-alignment** config (the legacy knobs at their old defaults plus the removed
  `requireSmartModel` key) — i.e. the upgrade path, not just a fresh install;
- the same outcome under `e2e/orchestration-overlay.yml`, which uses the plugin's
  **default** orchestration mode (`auto`) and mounts the web-only
  `subagent-model-selection-settings` row beside it — the composition that once aborted
  the boot;
- the `shift-router` settings namespace round-trips a write, and the Host model catalog
  advertises the deployment's configured routes (`e2e/settings-probe.mjs`);
- a **packed** install (`npm pack` → tarball → second scratch profile) boots with the
  plugin loaded, its browser half offered to the client module loader, and no
  `@deepseek-ai/*` copy installed into the profile — devDependencies are absent there, so a
  runtime import that is not declared for the consumer fails in the e2e instead of in a
  user's install.

It never touches your real `DSH_HOME` and cleans up after itself (`--keep` to inspect). To run
the same thing by hand, install the bundle into a scratch profile and apply the overlay:

```sh
DSH_HOME=/tmp/scratch dsh plugin --profile tmp add /path/to/dsh-shift-router
DSH_HOME=/tmp/scratch dsh --profile tmp --patch e2e/overlay.yml "design a migration plan"
```

## Architecture

Repository layout — the module-by-module map, the pure-logic/glue split and the test layering —
lives in **[CONTRIBUTING.md § Repository layout](CONTRIBUTING.md#repository-layout)**, so there is
one copy to keep accurate. In short: `src/` is the host half (pure decision modules plus DSH
wiring in `index.ts`), `src/client/` is the browser half (the settings card), `tests/` covers both,
and `e2e/` boots scratch profiles — including the packed artifact.

## See also

- **[pi-shift-router](https://github.com/green-dalii/pi-shift-router)** — the upstream project this
  plugin is adapted from: the same two-tier architecture (LLM Judge, fallback chains,
  exponential-backoff failover, task-level orchestration) for `pi-coding-agent`. Behaviour parity
  and the deliberate divergences are tracked in [ALIGNMENT.md](ALIGNMENT.md).
- **[dsh-plugin-dev-skill](https://github.com/green-dalii/dsh-plugin-dev-skill)** — the agent skill
  for building DSH plugins: tools (`defineTool`), LLM adapters, services, events, config and
  packaging, with the Cordis mental model and a verification checklist. This project follows it;
  install it in DSH, Claude Code or Codex.
- **[obsidian-llm-wiki](https://github.com/GD4AI/obsidian-llm-wiki)** — an Obsidian plugin that
  turns notes and PDFs into a linked, queryable knowledge base (entity and concept pages,
  graph-powered Q&A, local-first, no backend). Same author's other line of work.

## License

[MIT](LICENSE) © 2026 green-dalii and contributors.

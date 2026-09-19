# dsh-shift-router — Specification

> The normative contract for the DeepSeek Harness adaptation of
> [pi-shift-router](https://github.com/green-dalii/pi-shift-router).
> Implementation, tests, docs and the GUI surface all derive from this file.
>
> **Upstream alignment baseline: `pi-shift-router` v1.6.0** (`69ffb34`, 2026-09-18).
> Sections that intentionally diverge from upstream state the DSH reason inline.

---

## 0. Scope and non-goals

`dsh-shift-router` is a **decision layer**: it classifies each turn, picks the
tier, owns model selection while enabled, fails over to healthy models inside
the owning tier, and accounts for spend. It is not a presentation layer and not
a transport layer.

**Non-goals** (unchanged from upstream SPEC §0 and the project ROADMAP):

- 3-tier routing — execution vs judgment is the only meaningful axis.
- Keyword / regex / heuristic classification — the LLM Judge is the sole
  classifier. Regex appears **only** to parse the Judge's reply and to detect
  provider failure signatures.
- USD budget cap as a product feature (spend is telemetry; the orchestration
  *cap* is a loop guard, not a billing feature).
- Heuristic Judge fallback — the Judge either returns or the router holds.
- Cross-session persistent routing state — state is per-agent, in-memory.
- Local ML / ONNX inference.
- Runtime npm dependencies beyond the harness's own packages.

---

## 1. Architecture

### 1.1 DSH integration map

| Responsibility | Mechanism |
|---|---|
| Per-turn classification | `agent/pre-step` waterfall (`step === 1`), top-level agents only |
| Wire-model selection | `agent/request` waterfall (returns a replaced `LlmCallConfig`) |
| Runtime failover | `agent/request-error` waterfall (cooldown + `{ kind: 'retry' }`) |
| Turn teardown | `agent/turn-stopping` serial event |
| Orchestration caps | `tools/pre-execute` (`{ kind: 'deny' }`) + `tools/result` |
| Orchestrator instruction | `ctx.systemPrompt.section()` + `ctx.systemPrompt.variable()` |
| Telemetry | `session/event` (`assistant/message`, `assistant/chunk`) |
| Judge LLM call | `ctx.llm.stream()` |
| Configuration | `shift-router` settings namespace + `cordis.patch.yml` |
| Commands / GUI | `ctx.commands.register()`, client card in `settings.plugin.item` |

### 1.2 Routable agents

Only **top-level** agents are routed: `session.header.origin !== 'subagent'`
and `delegationDepth === 0`. Subagent workers keep the model the harness
assigned them; the router must never re-route a worker.

### 1.3 Terminology

- **step** — one model request plus its tool calls.
- **turn** — 0..n steps, ending when no tool call is outstanding.
- **tier** — `fast` (engineer / execution driver) or `smart` (CTO / judgment driver).
- **decisive** — a Judge verdict whose confidence passes `minConfidence` and
  whose source is the LLM (not a fallback).
- **hold** — the router keeps the current tier because it has no usable signal.

---

## 2. Decision pipeline

`processRoute(judgeResult, state, config, modelAvailable, now)` returns:

```ts
interface RouteDecision {
  switchTo: ResolvedModel | null
  action: 'upgrade' | 'downgrade' | 'stay' | 'manual'
  decisionTier: Tier   // the tier this turn runs at, after EV + hold + manual
  held: boolean        // the Judge was unusable; the router held position
}
```

Order of evaluation:

1. **Manual override** — `/route-force` wins. `action = 'manual'`,
   `decisionTier` = the override's tier (or the resolved model's tier).
2. **Judge usability** — if `judgeResult.source === 'fallback'`, the router
   **holds**: `decisionTier = state.currentTier`, `held = true`,
   `switchTo = null`, `action = 'stay'`. The verdict is pushed to the window as
   a **hold entry** (`hold: true`) and never counts as a fast/fast streak entry.
   *Rationale: "When the Judge is unavailable, hold position — never guess."
   Treating an outage as a decisive `fast` verdict silently downgrades a smart
   session after two outages.*
3. **EV decision** (§3) — compute `pSmart` and `θ_eff`; below
   `window.minConfidence` the verdict is likewise a hold (step 2 semantics).
4. **Immediate upgrade** — decision `smart` while `currentTier === 'fast'`:
   resolve the Smart tier's best healthy model; on success the window is
   **cleared**, `upgradeCount += 1`, `action = 'upgrade'`.
5. **Push the verdict** to the decision window and trim it to `window.size`.
6. **Gated downgrade** — decision `fast` while `currentTier === 'smart'`,
   requiring `economics.downgradeMemory` **consecutive** decisive fast
   decisions (§4) **and** `downgradeAllowedAt()` (§5). On success
   `downgradeCount += 1`, `action = 'downgrade'`.
7. Otherwise `action = 'stay'`, `switchTo = null`.

`decisionTier` is the **single** signal consumed by model switching,
orchestration entry (§7) and telemetry attribution. Consumers must not
re-derive a tier from the raw verdict.

### 2.1 Strict model authority

While the router is enabled (`enabled && routing.mode === 'auto'`), the router
**owns model selection**:

- `agent/request` re-resolves the current tier's best healthy model on **every
  step** and replaces the incoming config when it differs.
- A tier change is recorded (`state.currentTier`) even when both tiers resolve
  to the same provider/model — the tier identity, not the model id, carries the
  decision.
- `/route-force` is the escape hatch; `/router off` (or `routing.mode` `off`)
  returns control to the harness.
- The Judge's own model is never the Smart tier's model (it walks the fast
  chain; see §6.4).

---

## 3. EV economics (normative)

Replaces the pre-1.4.0 "confidence-weighted window ratio" rule.

```
R      = economics.mode ? ECONOMIC_MODE_PRESETS[mode] : economics.reworkPenalty
θ      = 1 / R
pSmart = (verdict.tier === 'smart') ? c : (1 − c)      // c = verdict.confidence ?? 1.0
θ_eff  = θ / sameFamilyThetaFactor                       // cache-aware, §5
runSmart  ⇔  pSmart ≥ θ_eff
```

`ECONOMIC_MODE_PRESETS = { eco: 2, default: 3, sport: 5 }` → θ = 0.5 / 0.333 / 0.2.

Properties that make this the right rule:

- θ is **price-independent**: the price delta cancels out of the expected-cost
  comparison, so the single knob is *how badly a wrong downgrade hurts*
  (rework multiplier R).
- Higher R → lower θ → more eager escalation (stickier on Smart).
- `pSmart` reads a `fast` verdict as evidence *against* Smart, so a decisive
  fast verdict (`c` near 1) yields `pSmart` near 0.

### 3.1 Legacy migration

- `routing.window.threshold` is **legacy**. It acts as a raw θ override **only**
  when its value differs from the legacy default `0.6`; the default value is
  inert and must not be surfaced as a user override.
- `routing.cacheAware.sameFamilyThreshold` is **legacy**. A value differing from
  its legacy default `0.9` implies `sameFamilyPenalty = 3.0`; the default value
  is inert.
- Both inert-default cases are silent; a *non-default* legacy value is honoured
  and flagged with `⚠ legacy` in `/router status`.

---

## 4. Decision memory (window)

`WindowEntry = { tier, timestamp, confidence?, hold? }`, trimmed to
`window.size` (oldest dropped). Lifecycle:

- **Decisive entries** are appended on every routed turn.
- **Hold entries** (`hold: true`) are appended and are *ignored* by the
  downgrade check; they also **break** the consecutive-fast streak.
- The window is **cleared on upgrade** (fresh start for the new tier).
- The downgrade streak counts **consecutive decisive fast** entries from the
  tail: any hold or smart entry resets it. Downgrade fires at
  `streak ≥ economics.downgradeMemory`.
- An empty window never downgrades.

`window.minConfidence` (default 0.5) is the decisive/hold boundary for
`pSmart` inputs. A missing `confidence` is read as `1.0` (backward-compatible
with prompts that omit it) — the Judge's own outage is the only "no signal"
case the router invents no value for.

---

## 5. Cache-aware routing

A prompt cache belongs to a model; crossing a model boundary is a guaranteed
miss, and cache reads bill well below base input. When the fast and smart tiers
share a provider (`shareProviderFamily()`), a mid-session downgrade forfeits the
warm cache and the cheaper model can cost more overall.

When `cacheAware.enabled` **and** the tiers share a provider:

- **Decision bar**: `θ_eff = θ / sameFamilyThetaFactor`, where the factor is
  `cacheAware.sameFamilyPenalty` (default **1.5**), or **3.0** when the legacy
  `sameFamilyThreshold` carries a non-default value (§3.1). A smaller effective
  θ is easier to satisfy → *fewer* downgrades.
- **Session gate**: `downgradeAllowedAt()` suppresses downgrades while
  `now − lastActivityAt ≤ idleBoundaryMs` (default 300 000 ms = 5 min) — the
  cache is still warm. `lastActivityAt === 0` (no completed message yet) allows
  the downgrade.

Cross-family deployments are unaffected: the factor is 1 and only the idle gate
applies is skipped.

---

## 6. LLM Judge

### 6.1 Contract

The Judge is **one** small LLM call on the fast tier chain, `temperature: 0`.

Output object (all four keys documented to the model):

| Key | Type | Meaning |
|---|---|---|
| `tier` | `"fast"` \| `"smart"` | the role that drives the **whole turn** |
| `confidence` | number ∈ [0,1] | how clearly the signals point to that tier |
| `reason` | string (3–8 words) | the deciding signal; for humans only, never read by routing |
| `orchestrate` | boolean | whether the Smart tier should delegate to Fast workers; absent = no opinion |

`orchestrate` is **optional** in parsing (older prompts / models that omit it
must keep working): absent → the caller falls back to the tier-based default.

### 6.2 Classification signals (priority order)

1. The user's explicit intent about model quality or orchestration. An explicit
   tier / gear / orchestration request is a **certainty, not a hedge**: the
   Judge must report `confidence ≥ 0.9` on it, and it is evaluated **before**
   torn-task signals.
2. Stakes + reversibility (production, security, money, irreversible actions).
3. Task content — including the doc-aware rule: document handling
   (read / check / update / format / translate / cross-doc consistency) and
   tedious bulk batches classify as `fast` **unless** the work sets direction.
4. Ambiguity — multiple valid approaches → `smart`; a clear single path → `fast`.

Explicit intent is **judged, never regex-matched**. There is no keyword gate in
the implementation; adding one would violate §0.

### 6.3 Failure policy

`classify()` walks the whole fast chain in priority order, skipping models in
cooldown. Every failed call (failover or not) tries the next model. When **all**
models fail it returns `{ tier: 'fast', source: 'fallback' }`.

- `source === 'fallback'` is a **hold**, not a verdict (§2 step 2). The returned
  `tier` value is only a type-compatible placeholder and must never be treated
  as evidence.
- Failover-worthy failures (429 / 402 / 5xx / quota / usage-limit /
  unsupported-model) call `onFailure` so the caller cools the model in the shared
  map. Network errors, timeouts, auth/config errors and 200-but-unparseable
  replies do **not** cool anything down.

### 6.4 Judge model

The Judge runs on the **fast tier chain** (never the Smart tier): it is a
one-shot classification, and paying Smart prices for it defeats the router.

### 6.5 Parsing

Tolerant, layered, pure:

- tier: JSON object → loose `tier: value` → bare word (in that order).
- confidence: JSON field → loose `confidence[:=]x`; values outside [0,1] are
  rejected (not clamped).
- reason: JSON `reason`/`why` string, collapsed to one line, capped at 120 chars.
- orchestrate: JSON boolean (`orchestrate`/`delegate`/`subagents` aliases).

---

## 7. Task-level orchestration

### 7.1 Entry

`shouldOrchestrate()` requires **all** of:

1. `config.enabled`
2. `orchestration.mode === 'auto'`
3. `decision.decisionTier === 'smart'` (post-EV, post-hold — **not** the raw
   verdict). Because `decisionTier` only reports `smart` when the router
   actually owns a resolvable Smart model for the turn (SPEC §2), entry needs no
   separate "is Smart resolvable?" precondition and there is no config knob that
   can force the orchestrator prompt onto a non-Smart run.
4. no Judge veto: `judgeResult.orchestrate !== false`
5. the `subagent` tool is available — otherwise degrade to a plain Smart run

Simple tasks never orchestrate. There is no "always" mode.

### 7.2 Prompt

The orchestrator instruction is a **dynamic system-prompt section** named
`shift-router:orchestrator` (order 150), rendered only while
`orchestration.active`. It carries: the CTO role, the subagent tool contract,
worker-model guidance (§7.4), the task-contract rules, the review rules with the
blocking-issues-only rule, the hard caps, the cooldown-filtered tier chains, and
the CTO summary output contract.

The chains are additionally exposed as prompt variables
`{{shift_router_fast_chain}}` / `{{shift_router_smart_chain}}` for deployment
personas.

### 7.3 Hard caps (enforced, not prompted)

- `rounds` increments per delegation; `maxRounds` (default 3) caps them.
- A worker failure advances `workerFailStreak`; on reaching
  `escalationThreshold` (default 2) `escalations` increments and the streak
  resets. A successful worker result resets the streak to 0.
- `capHit()` = `rounds ≥ maxRounds || escalations ≥ escalationThreshold`.
  While it holds, `tools/pre-execute` **denies** the `subagent` tool outright and
  the system-prompt section switches to the wrap-up notice.
- Orchestration is **single-turn**: state is entered at the turn that triggers it
  and released at `agent/turn-stopping`. Leaked state (a turn that never reached
  its stop boundary, e.g. an abort) is swept at the next turn's start.

### 7.4 Worker model injection (DSH-specific)

Upstream pi-spawned workers accept a per-run `model` override, and upstream
declares tier injection **mandatory** — without it a worker inherits the parent
session's current model, which is Smart mid-orchestration, so the economics
collapse.

DSH exposes the same capability under a **host-owned allowlist**: the `subagent`
tool's per-call `provider` / `model` / `reasoning_effort` fields are honoured
only when the deployment enables the harness's own `subagent-model-selection`
setting (default **off**) and lists the exact routes in `allowedModels`.
Therefore:

- The plugin **must not promise** that workers run on the Fast tier unless that
  allowlist authorises it.
- At startup, when orchestration is enabled and the Fast chain is non-empty, the
  plugin performs a self-check and **warns** when model-selectable delegation is
  not available, naming the setting to enable. The message must state the
  consequence (workers would otherwise inherit the Smart model).
- The orchestrator prompt states this condition factually instead of asserting a
  guarantee.

### 7.5 Retry interaction

DSH resolves transport retries **inside** the turn: `agent/request-error` may
return `{ kind: 'retry' }` and the loop rebuilds the request before the stop
boundary is ever reached. Consequently the upstream "delay exit/audit on a
retryable error tail" failure mode cannot occur here, and the plugin does not
implement it. The observable DSH equivalent is the **leaked-state sweep** in
§7.3.

---

## 8. Runtime failover

### 8.1 Cooldown ladder

`backoff = min(baseMs · 4^(attempts−1), maxMs)`; `baseMs` default 60 000,
`maxMs` default 6 h (21 600 000), `startAttempts4xx` default 3 → 4xx-class
failures start at 16 min. `attempts = max(prev.attempts + 1, is4xx ? startAttempts4xx : 1)`
— escalation persists across natural expiry.

### 8.2 Signatures

Failover-worthy (**trigger** cooldown + same-tier retry):

| Class | Signatures |
|---|---|
| DSH canonical codes | `RATE_LIMIT`, `SERVER`, `QUOTA` |
| HTTP status | `429`; any `5xx` |
| Rate limit / quota text | `rate limit`, `too many requests`, `quota`, `insufficient quota`, `token plan`, `用量上限`, `rate_limit_error`, `exceeded … quota` |
| **Usage-limit exhaustion** | `usage limit has been reached`, `usage_limit_reached` |
| **Insufficient balance** | HTTP `402`, `insufficient balance`, `余额不足` |
| **Model unavailable** | `unsupported_model`, `model_not_found`, `not supported` |
| Embedded status | `(error|http|status|code)… (429|402|50x|51x|52x)` |

**Never** trigger: `400`, `401`, `403`, network/timeout errors, unparseable
responses, context overflow.

The usage-limit and insufficient-balance classes are 429-class
(`code = '429'`) and therefore inherit the 16-minute 4xx start; `402` keeps
`code = '402'` and starts at the 4xx tier via `startsWith('4')`.

### 8.3 Failover scope

Failover stays **inside the tier that owns the failed model**
(`findTierForModel`). A tier with every model cooling keeps the current model
and reports it; the router never crosses tiers to escape a cooldown.
`/route-force` bypasses the cooldown. A successful assistant message on a
provider/model **clears** that model's cooldown.

### 8.4 Attribution

The failure is attributed to the exact provider/model this agent last put on the
wire (`state.lastRequestProvider/Model`, recorded in `agent/request`), falling
back to the router's current model. No transcript archaeology.

---

## 9. Telemetry and cost

- Every `assistant/message` with usage attributes tokens
  (`input`/`output`/`cacheRead`/`cacheWrite`) to the tier that **actually owns
  the model that ran** (`findTierForModel`, else the current tier) and appends a
  bounded `CallRecord` (`telemetry.callLogCap`, default 1000, oldest dropped).
- Cost is estimated from `pricing` (USD per 1M tokens). `.dsh` usage events carry
  no USD.
- **Savings baseline**: every logged call priced at the **Smart tier
  priority-1** model; `savings = baselineTotal − actualTotal`. When that model
  has no pricing entry the baseline is reported as unavailable rather than as
  zero.
- **Throughput is deliberately NOT tracked here.** Upstream renders a `tok/s`
  figure in its footer and derives it from wall-clock time between the first
  stream chunk and the message end. DSH already renders `tok/s` natively in the
  chat message footer and the trajectory panel, and derives it from **decode
  time** (`outputTokens / (decodeMs / 1000)`) — a strictly better measurement,
  because it excludes queueing and time-to-first-token. Duplicating it in this
  plugin would mean two competing figures for the same thing, one of them
  worse. The plugin therefore owns routing decisions and spend, and leaves
  throughput to the harness. (Consequence: there is no `speedWindowSize`,
  `minStreamElapsedMs`, `medianSpeed` or TPS state in this plugin.)
- **Display vs authority**: `state.currentProvider/currentModelId` is the router's
  *intended* model; `state.actualProvider/actualModel` mirrors the model that
  actually produced the last assistant message. Display must use the actual
  values when they exist, so a stale intent never masquerades as fact.
- **Last decision**: `state.lastDecision` records the verdict tier, confidence,
  reason, action, `decisionTier` and whether the router held — the input for the
  "why did it route this way" section of `/router status`.

---

## 10. Configuration reference

Every leaf has a default, so an empty config row is a working no-op. Invalid
values fail plugin load (Schemastery validation), never silently coerce.

| Key | Type / range | Default | Notes |
|---|---|---|---|
| `enabled` | boolean | `true` | master switch for routing behaviour |
| `tiers.fast.label` | string | `'Fast'` | display only |
| `tiers.fast.models` | `{provider, model, priority}[]` | `[]` | priority ascending = fallback order |
| `tiers.fast.description` | string | see `DEFAULT_CONFIG` | display only |
| `tiers.smart.*` | as fast | `[]` | |
| `routing.mode` | `auto` \| `manual` \| `off` | `auto` | `manual`: overrides only; `off`: passive |
| `routing.judgeTimeout` | int 1..120000 ms | `5000` | per Judge attempt |
| `routing.judgeMaxTokens` | int 1..100000 | `4000` | |
| `routing.judgePromptCap` | int 1..1000000 chars | `6000` | bounds Judge cost |
| `routing.economics.reworkPenalty` | number ≥ 1 | `3` | R; θ = 1/R |
| `routing.economics.downgradeMemory` | int 1..100 | `2` | consecutive decisive fast turns |
| `routing.economics.mode` | `eco` \| `default` \| `sport` (optional) | *(unset)* | preset; authoritative over `reworkPenalty` |
| `routing.window.size` | int 1..100 | `5` | |
| `routing.window.minConfidence` | 0..1 | `0.5` | decisive/hold boundary |
| `routing.window.threshold` | 0..1 | `0.6` | **legacy** raw-θ override; default inert |
| `routing.cacheAware.enabled` | boolean | `true` | |
| `routing.cacheAware.sameFamilyPenalty` | number ≥ 1 | `1.5` | θ divisor on same-family tiers |
| `routing.cacheAware.idleBoundaryMs` | int ≥ 0 | `300000` | warm-cache suppression window |
| `routing.cacheAware.sameFamilyThreshold` | 0..1 | `0.9` | **legacy**; non-default implies penalty 3.0 |
| `ux.routerLogVerbose` | boolean | `false` | diagnostics via `ctx.logger` |
| `orchestration.mode` | `auto` \| `off` | `auto` | |
| `orchestration.maxRounds` | int 0..100 | `3` | hard cap |
| `orchestration.escalationThreshold` | int 1..100 | `2` | consecutive worker failures → 1 escalation |
| `orchestration.requireSmartModel` | boolean | `true` | skip orchestration if Smart unresolvable |
| `failover.baseMs` | int ≥ 100 | `60000` | |
| `failover.maxMs` | int ≥ 1000 | `21600000` | |
| `failover.startAttempts4xx` | int 1..20 | `3` | 16 min start |
| `telemetry.callLogCap` | int 10..1000000 | `1000` | |
| `pricing` | `{provider, model, input, output, cacheRead?, cacheWrite?}[]` | `[]` | USD / 1M tokens |

Configuration layering (later wins, whole-row `config` replacement semantics):
bundles' patches → profile `cordis.patch.yml` → the `shift-router` settings
document (GUI / `/router config`).

Runtime toggles issued from commands (`/router on|off`, `/router verbose`,
`/router orchestrate …`) are **session-scoped** and do not rewrite the settings
document; durable changes go through `/router config` or `routing.economics.mode`
presets which are persisted.

---

## 11. Commands

| Command | Behaviour |
|---|---|
| `/router` | compact status line (tier, model, mode, manual flag) |
| `/router status` \| `/router stats` | full status report |
| `/router on` \| `/router off` | enable/disable routing for this session |
| `/router verbose` \| `/router log` | toggle `ux.routerLogVerbose` |
| `/router orchestrate [auto\|on\|off]` | orchestration mode |
| `/router eco` \| `/router default` \| `/router sport` | gear presets → `routing.economics.mode`, **persisted** |
| `/router config …` | numbered registry + `get` / `set` / `unset` / `diff` / `set-fast` / `set-smart` / `reset` |
| `/route-force <fast\|smart\|auto\|provider/model>` | one-turn override; `auto` clears |

`/router status` must surface: routing state and gear (R → θ → θ_eff in plain
language), the decision window, the last decision (verdict, confidence, action,
reason) when available, model health/cooldowns, the actual running model,
per-tier spend + savings baseline, and any legacy-override warning. It must not
render a throughput figure (§9).

---

## 12. GUI settings card

The card renders every scalar config leaf plus the two tier chains, grouped into
sections, with the model dropdowns sourced from the **harness's runtime catalog**
(`llm.models`) so the card shows exactly what DSH is configured with. `pricing`
is the only CLI/patch-only surface. The GUI registry and the command registry
must expose the same set of editable paths (enforced by test).

---

## 13. Diagnostics

- Diagnostics go through `ctx.logger` (`vlog()` gated by `ux.routerLogVerbose`).
  There is no file sink: DSH does not hand the terminal to a plugin, so the
  upstream reason for one (interleaved writes corrupting TUI frames) does not
  apply.
- Startup always logs: enabled state, orchestration mode; and warns on
  identical tiers, an empty fast tier, and un-authorised worker model selection
  (§7.4).

---

## 14. Testing and release gates

- Pure logic (`router.ts`, `failover.ts`, `judge.ts` parsing, `orchestrate.ts`,
  `config.ts`, `tier.ts`, `stats.ts`) is unit-tested; behaviour changes are
  TDD'd.
- Contract changes may update existing assertions only as a documented part of
  the same change.
- Gates, in order: `npm run typecheck` → `npm run build` → `npm test`. A red gate
  is never merged or released.

---

## 15. Migration and removals (v0.5.0 → the alignment release)

Config is a persisted settings document, so upgrades must be explicit about
what changes meaning and what disappears. Schemastery passes unknown keys
through untouched, so **removed keys are inert leftovers rather than load
failures** — the plugin simply stops reading them.

### Added

| Key | Default | Effect |
|---|---|---|
| `routing.economics.reworkPenalty` | `3` | θ = 1/R — the decision bar |
| `routing.economics.downgradeMemory` | `2` | consecutive decisive fast turns before smart → fast |
| `routing.economics.mode` | *(unset)* | `eco`(R=2) / `default`(R=3) / `sport`(R=5); authoritative over `reworkPenalty` |
| `routing.cacheAware.sameFamilyPenalty` | `1.5` | divisor applied to θ when both tiers share a provider |

### Changed meaning (migration)

- `routing.window.threshold` was the downgrade bar under the old
  confidence-weighted ratio. It is now a **legacy raw-θ override**, honoured
  **only** when it differs from the old default `0.6`. A config carrying the old
  default (the overwhelmingly common case, including every wizard snapshot)
  migrates silently to the EV rule.
- `routing.cacheAware.sameFamilyThreshold` was the raised downgrade threshold.
  It is now a **legacy sentinel**: a non-default value implies
  `sameFamilyPenalty = 3.0`. The old default `0.9` is inert.
- Routing decisions may therefore differ immediately after upgrade even with no
  config edit. This is the point of the change (the old rule counted votes; the
  new rule weighs expected cost) and is called out in `CHANGELOG.md`.

### Removed

| Key | Why |
|---|---|
| `orchestration.requireSmartModel` | `decisionTier` now truthfully reports whether Smart will run, so orchestration already cannot fire without a resolvable Smart model. Keeping the knob only made it possible to inject the CTO prompt onto a Fast-tier run — the upstream "CTO loop on the fast model" bug class. |
| `failover.speedWindowSize` | the plugin no longer tracks throughput (see §9) |
| `failover.minStreamElapsedMs` | never released; the plugin no longer tracks throughput |

---

## 16. Explicitly not aligned (with reasons)

| Upstream mechanism | Why it is not ported |
|---|---|
| pi-tui `StatusPanel`, footer status bar, `ui.setStatus`, `ui.custom` | presentation bound to pi's terminal renderer; semantics live in the DSH card and `/router status` |
| **Footer `tok/s` indicator, `medianSpeed`, `MIN_STREAM_ELAPSED_MS`, turn-scoped throughput fallback** | DSH renders `tok/s` natively (chat footer + trajectory) from **decode time**, which is a better measurement than upstream's wall clock. Porting it would duplicate the harness with a worse figure. The plugin's pre-existing copy of this machinery is removed (§9, §15). |
| **`orchestration.requireSmartModel`** | removing a knob that can only produce a bug beats porting it (see §15) |
| `models.json` custom providers + `expandEnv` (`$VAR`, `$$`, `$!`, `!cmd`) | DSH provides providers/credentials through its adapter and credentials seams |
| `pi.modelRegistry` API surface | only the *principle* (single source of truth) transfers; DSH uses `ctx.llm` |
| `models-store.json` / `auth.json` / three JSON config layers | host-private file layout |
| pi-subagents `runs.all`, `worktree: true`, fork-context thinking workaround | different delegation primitives in DSH |
| `pack:check` / `pi.extensions` / `minPiVersion` | pi packaging contract |
| Upstream's known doc drift (SPEC §9.1/§9.2/§7.5) | this SPEC aligns to upstream *code behaviour*, not its stale prose |

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
| Optional capabilities | `ctx.get()` probe / `ctx.inject()` subscription — **never** a bare `ctx.<name>` read (§1.4, §7.4) |

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

### 1.4 Cordis plugin invariants

Non-negotiable rules for this plugin's code. Each one has a regression in the
suite, because each one has already been violated once in a way that cost a real
user a boot.

1. **Declare what you need.** Every service read as `ctx.<name>` must appear in
   `export const inject`. A Cordis context is a proxy whose `get` trap throws
   `cannot get property "<name>" without inject` for anything undeclared that is
   not provided *at that moment*.
2. **Probe what is optional.** An optional service is read with
   `ctx.get('<name>')` (returns `undefined` when no provider is ACTIVE) or
   subscribed to with `ctx.inject([...], cb)` (fires when it attaches, disposes
   when it leaves). A structural cast (`ctx as unknown as {…}`) silences
   TypeScript but not the proxy trap — and because the read happens inside
   `apply`, the throw fails the plugin fiber and aborts the whole plugin tree.
3. **Never guess a platform constant.** `ctx.systemPrompt.getSectionOrder(name)`
   returns `undefined` for any name outside the platform's `SECTION_ORDERS`, and
   `section()` throws on a non-finite order — the same boot-abort class. A value
   the platform does not own is configuration, not a literal.
4. **Loadability is not optional.** An optional capability may change behaviour;
   it must never change whether the plugin loads.

### 1.5 Pinned SDK baseline

The plugin builds against the **same SDK the harness runs**, and the pins are a
contract, not a convenience:

| Package | Pin | Runtime |
|---|---|---|
| `@deepseek-ai/cordis` | `4.0.2` | 4.0.2 |
| `@deepseek-ai/dsh-{agent,commands,llm,session,settings,system-prompt,tools}` | `0.1.5-rc.2` | 0.1.5-rc.2 |
| `@deepseek-ai/schemastery` | `^3.18.2` | 3.18.2 |
| `@deepseek-ai/dsh-client-{locale,store,ui-settings,ui-slots,ui-renderer}` | `^0.1.5-rc.2` | browser roster |
| `@deepseek-ai/dsh-api-{remotes,session-controller}`, `dsh-client-connection` | `^0.1.5-rc.2` | type-only in the client half; the browser gets them from the platform seed |
| `@deepseek-ai/dsh-client-ui-settings-plugins` | `^0.1.5-rc.2` | type-only (declares the card's slot contract) |
| `@deepseek-ai/dsh-tool-subagent` | `^0.1.5-rc.2` | type-only |

The five packages the browser module loader must answer are listed once, in
`package.json`'s `dsh.client.inject`: `dsh-client-connection`, `dsh-client-locale`,
`dsh-client-ui-renderer`, `dsh-client-ui-settings`, `dsh-api-remotes`.

A plugin is type-checked against its own dependency tree but **executes against
the harness's**. Any gap between the two is a defect that no amount of green
local gates can see, so a baseline bump is part of the release process whenever
the target harness moves. Two consequences worth stating:

- **How a harness package is declared** (SPEC-level rule; rationale in
  ALIGNMENT §R10). A package the harness provides is a **`peerDependency`**,
  never a runtime `dependency`: the consumer must end up with exactly one
  instance. Shipping a private copy means the plugin and the host can hold two
  different module instances of the same SDK — the `createUserMessage` /
  `BlockAssembler` values this plugin imports would then come from the copy
  rather than from the host that consumes them.

  | Declared as | What goes there | Why |
  |---|---|---|
  | `peerDependencies` | every harness package the **compiled output requires at runtime**: `@deepseek-ai/cordis` (`^4.0.2`), `@deepseek-ai/dsh-llm` (`>=0.1.5-rc.2 <0.2.0`), `@deepseek-ai/schemastery` (`^3.18.2`) | the consumer supplies it, exactly once |
  | `devDependencies` | every other `@deepseek-ai/*` import — the type-only host contracts, the client roster, the test-only packages | compile-time contracts; not required at runtime |
  | `dsh.client.inject` | the browser packages the module loader must answer | the client bundle `require()`s platform seed words (§12.2) |

  The peer range is deliberately **tighter** than the community checker's
  constant (`>=0.1.2-rc.1 <0.2.0 || …`), which would admit harnesses older than
  the API this build uses; the divergence is recorded in ALIGNMENT §R10.
- Runtime **value** imports from these packages are load-bearing
  (`settingsNamespace` used to be one); a rename upstream breaks the plugin at
  boot, not at compile time.
- The client half's contracts are imported from the package that declares them —
  `ctx.slots` from `dsh-client-ui-renderer/client`, the browser `SettingsScope`
  from `dsh-client-ui-settings/client`, the card's slot from
  `dsh-client-ui-settings-plugins/client` — **type-only** where only types are
  needed, and never re-spelled locally (§12.1). `dsh-client-runtime` does **not**
  exist at this baseline.

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

1. **Manual override** — `/route-force` wins. `action = 'manual'`, and
   `decisionTier` is the override's tier if one was named, else the forced
   model's **owning** tier (`findTierForModel`), else the current tier. It is
   never taken from the raw verdict: `/route-force <provider/model>` while the
   Judge says `smart` must not report `decisionTier: 'smart'`, or an
   orchestration turn could start on a user-pinned model (§7.1).
2. **Judge usability** — if `judgeResult.source === 'fallback'`, the router
   **holds**: `decisionTier = state.currentTier`, `held = true`,
   `switchTo = null`, `action = 'stay'`. The verdict is pushed to the window as
   a **hold entry** (`hold: true`). A hold never counts toward the downgrade
   streak and never lets an earlier fast streak survive — it resets it (§4).
   *Rationale: "When the Judge is unavailable, hold position — never guess."
   Treating an outage as a decisive `fast` verdict silently downgrades a smart
   session after two outages.*
3. **EV decision** (§3) — compute `pSmart` and `θ_eff`. A verdict whose raw
   `confidence` is below `window.minConfidence` is the same hold as step 2.
4. **Immediate upgrade** — decision `smart` while `currentTier === 'fast'`:
   resolve the Smart tier's best healthy model; on success the window is
   **cleared**, `upgradeCount += 1`, `action = 'upgrade'`.
5. **Push the verdict** to the decision window and trim it to `window.size`.
   (An upgrade returns at step 4 and therefore clears the window instead of
   pushing into it.)
6. **Gated downgrade** — decision `fast` while `currentTier === 'smart'`,
   requiring `economics.downgradeMemory` **consecutive** decisive fast
   decisions (§4) **and** `downgradeAllowedAt()` (§5). On success
   `downgradeCount += 1`, `action = 'downgrade'`.
7. Otherwise `action = 'stay'`, `switchTo = null`.

`decisionTier` is the **single** signal consumed by model switching and by
orchestration entry (§7): consumers must not re-derive a tier from the raw
verdict. Spend attribution is the one exception — it attributes by the *owning
model* (`findTierForModel`), because a model can run outside the router's
decision (§9). Once the switch is applied, `state.currentTier` and
`decisionTier` are identical in every branch.

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
- The requirement **saturates at the window size**: the streak lives in the
  window, so `downgradeMemory > window.size` could never be satisfied and would
  pin the router to Smart for the rest of the session. The effective requirement
  is `min(downgradeMemory, max(1, window.size))`, and `/router status` says so
  out loud rather than leaving it silent.

`window.minConfidence` (default 0.5) is the decisive/hold boundary for the
Judge's **raw `confidence`** — it is evaluated before `pSmart` is computed, so a
verdict outside the bar is a hold regardless of which tier it names. A missing `confidence` is read as `1.0` (backward-compatible
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

Cross-family deployments are unaffected: the factor is 1 and the idle gate is
skipped.

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

The section's sort position is `ux.promptSectionOrder` (default `150`, i.e.
after `DEPLOYMENT_PERSONA_PREFIX` = 0 and before `PLAN_POLICY` = 500). DSH
allocates section order centrally in `SECTION_ORDERS` and reserves no slot for a
third-party section, so the value is configuration rather than a platform
constant (§1.4).

The chains are additionally exposed as prompt variables
`{{shift_router_fast_chain}}` / `{{shift_router_smart_chain}}` for deployment
personas.

### 7.2.1 Convergence protocol

An unstructured "not right yet" is what makes an orchestration loop spend rounds
without progressing, so the prompt states the required shape of every
re-delegation as a **contract**:

- a `## Failure report` block with exactly three parts — *what failed* (observed
  behaviour), *where* (file/line/symbol plus the error text), and *the acceptance
  test to re-run now*;
- **never re-send the same report** — the same failure for the same reason means
  the phase is not converging, and the CTO must take it over instead of spending
  another round;
- takeover after `escalationThreshold` consecutive failures on one phase — the
  same value the router enforces in §7.3, so the prompt cannot promise a
  threshold that differs from the hard cap.

### 7.3 Hard caps (enforced, not prompted)

- `rounds` increments per delegation; `maxRounds` (default 3) caps them.
- A worker failure advances `workerFailStreak`; on reaching
  `escalationThreshold` (default 2) `escalations` increments and the streak
  resets. A successful worker result resets the streak to 0.
- `capHit()` = `rounds ≥ maxRounds || escalations ≥ escalationThreshold ||
  (maxSpendUsd > 0 && spend ≥ maxSpendUsd)`. While it holds, `tools/pre-execute`
  **denies** the `subagent` tool outright and the system-prompt section switches
  to the wrap-up notice. `capReason()` words the reason once, so the deny and the
  notice cannot disagree.
- Worker accounting: `spawned` increments at dispatch, `done` at result; `spend`
  is the task's monotonic USD total (§9).
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
setting (default **off**) and lists the exact routes in `allowedModels`. That
settings owner is mounted by the `web` composition only, so on `headless` the
capability is **absent** rather than disabled. Therefore:

- The plugin **must not promise** that workers run on the Fast tier unless that
  allowlist authorises it.
- `subagentModelSelection` is an **optional service**: probe it with
  `ctx.get('subagentModelSelection')` (§1.4). Reading `ctx.subagentModelSelection`
  aborts the boot whenever the service is missing — including the ordinary window
  in which a sibling row is still mounting.
- The plugin **warns** when model-selectable delegation is not usable, naming the
  setting and stating the consequence (workers would otherwise inherit the Smart
  model). One once-only guard, two call sites:
  - a reactive `ctx.inject(['subagentModelSelection'], …)` callback — fires when
    the service attaches, whenever that is, and again if the preference is
    replaced; this absorbs boot-order races; and
  - the orchestration entry point (`enterOrchestration`) — race-free, because by
    then the tree has long settled and an absent service is a fact about the
    deployment rather than a mount-ordering artefact.
- The stock compositions export no `ctx.logger` sink (§13), so the same fact is
  also rendered by `/router status` as a `Worker delegation:` line (§11). That
  is the surface a user can actually read.
- The orchestrator prompt states this condition factually instead of asserting a
  guarantee.
- **Assisted authorisation (`/router allow-workers [off]`).** The plugin writes
  the Fast chain into the host namespace itself (`settings.update(
  'subagent-model-selection', { enabled, allowedModels })`). The settings
  provider is namespace-agnostic — `get`/`update` take the namespace — so this
  needs no ownership transfer, and `enabled: false` revokes authorisation while
  keeping the route list. The write is refused with a specific reason when the
  composition mounts no such namespace (`headless`), when the settings service is
  absent, or when the Fast chain is empty; the command reports exactly which
  routes it wrote. This is the surface that works in every profile, including
  the ones a GUI card cannot reach (§13).

### 7.4.1 Acceptance audit (safety net, never a gate)

Hard caps stop a run from flying away; they cannot stop a CTO from *claiming*
acceptance it never verified. The audit is the fallback review, and it is
**advisory by construction**:

- **Deterministic checks (free, always run):** every dispatched worker reported
  back (`done ≥ spawned`), the final assistant message carries a CTO summary,
  and the run did not end at a hard cap. All three are pure functions over
  snapshots the plugin already keeps.
- **LLM review (config-gated, one small Fast-tier call):** the auditor reads the
  goal, the CTO summary and the worker results, and flags ungrounded acceptance,
  goal drift, or placeholder work passed off as done. It runs **only** for a run
  that actually delegated (`spawned ≥ 1`), only when `orchestration.audit.enabled`,
  and only past cooldown-filtered routes — a route this turn just cooled is never
  re-burned, and with every route cooling the pass is skipped.
- **Not blocking, by design.** The deterministic half completes at the turn
  boundary; the LLM half is detached and writes `state.lastAudit` when it
  settles, because awaiting it would delay the user's turn by up to
  `audit.timeoutMs`. The audit never changes a routing decision, never blocks a
  turn, and never throws: a failure becomes a violation, because the run is
  already over and an audit can only add information.
- **Self-executed runs are outside the domain** (`spawned = 0`): the
  delegation-closure invariants never engaged, so no CTO summary is owed and no
  LLM pass runs.
- Evidence is bounded from `audit.promptCap` (≤ 8 worker results, each ≤
  cap/8 and floored at 200 chars, truncation marked) so the auditor's cost is a
  deployment decision rather than a function of transcript size.
- The result is surfaced by `/router status` as `Last audit: …` — the command
  surface, because the stock compositions export no `ctx.logger` sink (§13).

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

- Every `assistant/message` **of a routed (top-level) agent** with usage
  attributes tokens
  (`input`/`output`/`cacheRead`/`cacheWrite`) to the tier that **actually owns
  the model that ran** (`findTierForModel`, else the current tier) and appends a
  bounded `CallRecord` (`telemetry.callLogCap`, default 1000, oldest dropped).
- Cost is estimated from `pricing` (USD per 1M tokens). DSH usage events carry no
  USD, so with no pricing table the spend is legitimately 0 — the plugin never
  invents prices.
- **Per-worker attribution (C3).** A subagent worker's usage is attributed to the
  delegating task, not to the parent's per-tier ledger. Upstream read one cost
  off the subagent tool result; DSH publishes the child's own usage on the CHILD
  SESSION's `assistant/message` events, and `dsh-subagent` stamps
  `header.parentSession`, so attribution is exact rather than inferred. Each
  worker is **one** ledger row (`orchestration.workerSpends`) accumulated across
  all of its messages, priced with the model the worker actually ran.
  `orchestration.spend` is a monotonic task total; the row list is a bounded
  display window (`orchestration.workerLedgerCap`, oldest dropped) and is
  **never** the source of the total, so a dropped row cannot leak budget.
- **Budget guard (C5).** `orchestration.maxSpendUsd` (default `0` = off) is part
  of `capHit`, so reaching it denies further delegation exactly like the round
  and escalation caps. `capReason()` is the single authority for *which* cap
  fired, shared by the deny reason and the prompt's wrap-up notice.
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

**The exhaustive list of leaves, types and defaults is the schema itself**
([`src/config.ts`](src/config.ts)); [`README.md`](README.md#configuration) tables
it for users and the GUI card (§12) renders it with per-field hints. Keeping a
third copy here would only add a surface that drifts, so this section states the
*shape* of the contract instead:

- Every leaf has a default **except three that are intentionally unset** —
  `routing.window.threshold` and `routing.cacheAware.sameFamilyThreshold` (legacy
  knobs that must stay inert until a user writes a value, §15) and
  `routing.economics.mode` (a preset selector). An empty config row is still a
  working no-op.
- `tiers.<tier>.label` and `.description` are display-only strings; the tier
  chains themselves are `{provider, model, priority}[]`, priority ascending =
  fallback order.
- Invalid values fail plugin load (Schemastery validation), never silently coerce.
- Layering — later wins, and a patch replaces the target row's **whole** `config`
  value: bundles' patches → profile `cordis.patch.yml` → the `shift-router`
  settings document (GUI / `/router config`).
- Command runtime toggles (`/router on|off`, `/router verbose`,
  `/router orchestrate …`) are **session-scoped** and do not rewrite the settings
  document; durable changes go through `/router config` or the persisted
  `routing.economics.mode` presets.
- `pricing` is the one list-of-record that is patch / `/router config` only — the
  card does not render lists (§12.3).

---

## 11. Commands

| Command | Behaviour |
|---|---|
| `/router` | compact status line (tier, model, mode, manual flag) |
| `/router status` \| `/router stats` | full status report |
| `/router on` \| `/router off` | enable/disable routing for this session |
| `/router verbose` \| `/router log` | toggle `ux.routerLogVerbose`: log-ring detail **and** a route notice on every judged turn (§13.1) |
| `/router orchestrate [auto\|on\|off]` | orchestration mode |
| `/router allow-workers [on\|off]` | write/revoke the Fast chain in the host `subagent-model-selection` allowlist (C4(a)) |
| `/router eco` \| `/router default` \| `/router sport` | gear presets → `routing.economics.mode`, **persisted** |
| `/router config …` | numbered registry + `get` / `set` / `unset` / `diff` / `set-fast` / `set-smart` / `reset` |
| `/route-force <fast\|smart\|auto\|provider/model>` | one-turn override; `auto` clears |

`/router status` must surface: routing state and gear (R → θ → θ_eff in plain
language), the decision window, the last decision (verdict, confidence, action,
reason) when available, model health/cooldowns, the actual running model, the
worker-delegation situation (§7.4, `— (orchestration off)` while orchestration
is off), the orchestration spend with its worker completion counts (§9), the
last acceptance audit when one has run (§7.4.1),
per-tier spend + savings baseline, and any legacy-override **or capped-knob**
warning (an inert legacy default is silent; only a non-default legacy value, or
a `downgradeMemory` larger than the window, is reported). It must not render a
throughput figure (§9).

---

## 12. GUI settings card

The card renders every scalar config leaf plus the two tier chains, grouped into
sections. `pricing` is the only CLI/patch-only surface. The GUI registry and the
command registry must expose the same set of editable paths (enforced by test).

### 12.1 The card's slot (normative)

The card contributes to `settings.plugin.item`, a **`keyed`** slot declared by
`@deepseek-ai/dsh-client-ui-settings-plugins`. Its *Plugin configuration* tab
dispatches one key per settings namespace the Host serves, so the cell key IS
the namespace, and it must be the same literal the host half registers through
`ctx.settings.register()` (§11): `key: 'shift-router'`. An `id` is not a near
miss — `SlotCore` throws (`keyed slot "settings.plugin.item" requires
options.key`), and the tab's projection (`entry.options.key !== undefined &&
served.has(entry.options.key)`) would drop the entry anyway.

The `SlotMap` entry is imported **type-only** from that declarer rather than
re-declared here (§1.5): a local copy is enforced by the compiler instead of the
host, so a slot re-spelled as `kind: 'list'` passes every gate while rendering
nowhere (ALIGNMENT §R6).

### 12.2 Where the model lists come from (normative)

The card's provider/model controls are fed by the **Host generation's model
catalog** — `ctx.remote.session.modelCatalog()`, the same remote the `/model`
selector reads (`dsh-api-session-controller`'s `buildModelCatalog()` over the
live LLM registry). Nothing else may be a source: not a hand-kept list, not a
provider directory, and not an invented remote — a wrong guess here fails
silently, because the card's only symptom is that a dropdown is a text box
(ALIGNMENT §R7).

- The remote is read **reactively** (`ctx.inject(['remote', 'remote.session'], …)`),
  so a composition that mounts it late still gets dropdowns, and one that never
  mounts it degrades to manual entry **with a stated reason** rather than a
  silently empty control.
- The catalog is re-read on `llm/adapters-updated`, `settings/document-updated`,
  `credentials/reference-updated` and `connection/reset` — the same triggers the
  canonical selector uses — so a model configured elsewhere appears without a
  page reload.
- Provider-level failures are part of the catalog (`failures`) and are shown
  against the affected rows ("this provider could not list models: …"). A
  capability gap is never rendered as an empty dropdown.
- Manual entry survives in exactly one form: the explicit **Custom…** option, for
  a model the Host cannot enumerate. It is never the default path.

### 12.3 Card UX rules (normative)

The panel is an advanced surface, so these rules are about making consequences
visible rather than about decoration:

- **Controls carry the schema's bounds.** Numeric fields render `type="number"`
  with the `min`/`max`/`step` the config schema enforces, mirrored into
  `CARD_FIELDS` and pinned by a parity test — the client bundle cannot import the
  host schema (`@deepseek-ai/schemastery` is not a platform seed word).
- **Consequences are shown, not implied.** `reworkPenalty` displays the threshold
  it implies (θ = 1/R), the economics preset displays the penalty it applies, an
  empty chain says the tier is disabled, and duplicated routes or an identical
  Fast/Smart primary are called out inline. These are the same facts the plugin
  logs at startup, and §13 says a stock profile exports no logs — so the card is
  where they must be readable.
- **Inert fields are marked.** A `legacy` field is accepted but ignored; the card
  says so instead of presenting it as live configuration.
- **The collapsed header states the effective configuration** (enabled state,
  routing mode, chain sizes), so the panel answers "what is set?" without being
  expanded.
- **Advanced settings are collapsed by default.** The open card holds only what
  changes routing for a typical deployment: the master switch, the two tier
  chains, the routing mode, the economics knob and its preset, and the
  orchestration mode, round budget, spend cap and audit switch. Everything else —
  judge limits, window and cache tuning, failover timing, telemetry, prompt
  ordering and the legacy leftovers — sits behind ONE *Advanced* disclosure,
  closed on open, sub-grouped by the setting it belongs to. The visible-by-default
  set is pinned by a test, so clutter cannot creep back in one field at a time.
- **Copy is written from the user's side.** A label or hint answers "what does
  this do to my requests, and when would I change it?" — not how it is
  implemented. Internal vocabulary (θ, EV, ledger, ring buffer, sort position) is
  only allowed where the control itself shows it, and a consequence already
  rendered elsewhere (the θ line under the economics knob) is not re-derived in
  prose.

**Deferred** (recorded, not silently dropped): sliders for the 0–1 probability
fields; a filter for the long routing section; and runtime state on the card
(last decision, spend, audit) — which needs a browser↔host channel the card does
not have (§R4, §R6.5).

---

## 13. Diagnostics

- Diagnostics go through `ctx.logger` (`vlog()` gated by `ux.routerLogVerbose`).
  There is no file sink: DSH does not hand the terminal to a plugin, so the
  upstream reason for one (interleaved writes corrupting TUI frames) does not
  apply.
- **Where they are visible.** Cordis's logger fills a 1000-entry in-memory ring
  and hands messages to registered exporters. The shipped DSH compositions
  (`web`, `headless`, `sdk`) register **no exporter**, so a plugin's log lines
  reach neither the terminal nor the UI. That is a property of the deployment,
  not of the plugin: `ctx.logger` remains the correct channel and any deployment
  that mounts a sink sees everything. The consequence for this plugin is a rule,
  not a workaround — **anything a user must be able to read in a stock profile
  has to be surfaced by a command (§11) or a route notice (§13.1), not by a log
  line.**
- Startup logs (where a sink exists): enabled state, orchestration mode; and
  warns on identical tiers, an empty fast tier, and un-authorised worker model
  selection (§7.4).

### 13.1 Route notices (normative)

A decision that changes which model serves the conversation is a fact about the
user's own session, so it is written **into** the session, not merely beside it.
This is the answer to "the plugin is enabled and I cannot see it doing anything":
the router never changes the session's selected model (it overrides the wire
model per request, §1.1), so nothing in the stock UI would otherwise announce it.

- **Channel.** The `agent/pre-step` waterfall. The listener awaits `next()`,
  returns a `reject` decision untouched, and otherwise returns it with one extra
  message from `createUserMessage` (`@deepseek-ai/dsh-llm`):
  `source: { kind: 'plugin', plugin: 'shift-router', form: 'notice', summary }`.
  The harness's own model-selection notice uses this exact channel
  (`dsh-agent`'s `model-selection`), which is the evidence that a third-party
  plugin may write one; a rejected or aborted step never carries one.
- **The text must name the plugin.** `source.plugin` is durable, but the Chat
  client renders a `notice` through `NoticeBody`, which draws only the message
  content, and the collapsed row draws only `summary`. Nothing in the UI reads
  the `plugin` field, so an unlabelled one-liner is indistinguishable from
  harness output — the confusion this section exists to end. Every notice
  therefore starts with a literal `[shift-router]`.
- **When one is emitted.** (a) Whenever the decision moves the turn to a
  different tier or model: the switch is the interruption-worthy fact. (b) On
  every judged turn when `ux.routerLogVerbose` is set, including a turn that
  holds position. Verbose already promises "tell me every decision"; before this
  it wrote that promise into a log ring nobody reads (§13), so making it the
  per-turn notice switch is what makes the promise true at all. No notice is
  emitted for a non-routable agent, a rejected step, a disabled router or a
  non-`auto` routing mode: there is no decision to report. Nor when no model
  could be resolved at all (an empty chain, or every candidate in cooldown):
  nothing reached the wire, `initial` would be a lie by the second turn, and that
  condition is already stated once at startup and in `/router status`.
- **What it says.** One line: the plugin prefix, the tier transition with the
  configured tier labels, the model transition (`model` alone when the provider
  is unchanged, `provider/model` otherwise — the abbreviation rule the harness's
  own notice uses), the action (`upgrade`/`downgrade`/`stay`), the Judge's
  `reason` when it gave one, its confidence, and the wall time the decision took.
  Those are the fields that make a switch auditable; a notice that said only
  "switched" would be decoration.
- **`summary`.** The same transition, passed through `boundContextSummary` so it
  obeys the platform's `CONTEXT_SUMMARY_MAX_CHARS` (120) bound and the row stays
  readable while collapsed.
- **English.** The message enters the next request, so it is model-facing as well
  as user-facing; the Judge's `reason` is already an English phrase and the
  harness's own notice is English. A locale switch would have to "translate"
  model ids and Judge output, which it cannot.
- **Not covered (deferred, recorded).** A mid-turn failover switch: it happens
  inside a request attempt, where no message channel exists — the next turn's
  notice reports the model it actually runs. `/route-force`: the command itself
  is the user's own visible act, and its effect appears in the next notice.

---

## 14. Testing and release gates

- Pure logic (`router.ts`, `failover.ts`, `judge.ts` parsing, `orchestrate.ts`,
  `audit.ts`, `notice.ts`, `config.ts`, `tier.ts`, `stats.ts`, and the client's
  `form-model.ts` / `card-ux.ts` / `model-catalog.ts`) is unit-tested; behaviour
  changes are TDD'd.
- Contract changes may update existing assertions only as a documented part of
  the same change.
- **Wiring is tested against a real Cordis context.** `tests/plugin-load.test.ts`
  loads the plugin through `ctx.plugin()` with the real `inject` gate armed, so an
  undeclared service read or a non-finite prompt-section order fails in
  milliseconds instead of aborting a user's boot. Hand-written context stubs
  cannot catch that class of bug: they have no proxy trap to violate.
- **The E2E must cover the default configuration and the packaged artifact.**
  `npm run test:e2e` boots scratch profiles for a fresh install, a pre-alignment
  config, and the plugin's DEFAULT orchestration mode with the web-only
  `subagent-model-selection-settings` row mounted; it also packs the tarball,
  installs it into a second profile, boots it there (where devDependencies are
  absent) and drives a real routed turn, whose request must carry the route notice
  (§13.1). A suite that only ever runs `orchestration.mode: off` cannot see the
  default path — which is how the boot regression shipped, and `--dump-config`
  cannot substitute because it composes configuration without instantiating a
  single plugin.
- **Load safety is tested per configuration.** `tests/plugin-load.test.ts` loads
  the plugin for every configuration that changes a LOAD-TIME branch — empty row,
  routing disabled, `manual`, `off`, orchestration off, empty Fast chain, and the
  full costs/audit surface. A load failure is not "a feature is off", it is DSH
  not starting, so these are loaded for real rather than reasoned about.
- **Install isolation is a gate.** `tests/packaged-install.test.ts` reads the
  BUILT artifacts and asserts the install-time contract: every external
  specifier the host half imports is declared for the consumer — in
  `dependencies` or `peerDependencies` (§1.5), never dev-only; every specifier
  the browser half `require()`s is a platform seed word or declared in
  `dsh.client`; and `files` ships what the artifacts and READMEs need.
  `npm run test:e2e` additionally packs the tarball, installs it into a second
  scratch profile and **boots it** — where devDependencies are absent, so a
  runtime import that is not declared for the consumer fails there instead of in
  a user's install.
- **The card's slot wiring is tested against the real registry.**
  `tests/client-card-slot.test.ts` declares `settings.plugin.item` as `keyed`
  through the harness's own `SlotCore` and runs the card's real `apply()`, in
  both load orders — the card plugin is loaded long before the Settings panel
  declares the slot, and a stub registry has no kind rule to violate. The
  type-only contract (§12.1) makes `key` vs `id` a compile error as well.
- **The card's data sources are gated by shape.** `tests/model-catalog.test.ts`
  drives the mapping from the Host catalog — provider groups, provider failures,
  the `ok:false` envelope and a thrown transport error — because the defect that
  shipped was a wrong remote, and a test written against a hand-made success
  object would have blessed it just as the typechecker did.
- Gates, in order: `npm run typecheck` → `npm run build` → `npm test` →
  `npm run test:e2e`. A red gate is never merged or released.

---

## 15. Migration and removals (v0.5.0 → v0.6.0)

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
| `AGENTS.md`'s pi-specific hard-stop rules | upstream *development-process* constraints, not product behaviour |
| Counting a delegation round at the worker's **result** | counting at **dispatch** keeps `maxRounds` a true ceiling: a dispatched call has already spent budget, while a result-time count lets an aborted call slip past the cap (§7.3) |
| Upstream's known doc drift (SPEC §9.1/§9.2/§7.5) | this SPEC aligns to upstream *code behaviour*, not its stale prose |

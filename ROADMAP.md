# Roadmap

Release history and planned work for **dsh-shift-router** — the DeepSeek Harness
adaptation of [pi-shift-router](https://github.com/green-dalii/pi-shift-router).

## Upstream alignment

This project versions on its **own** line. It never claimed numeric parity with
upstream, and the earlier note that "the original's v0.x feature line maps onto
our v0.x line one-to-one" is retired: upstream has moved from v0.x through
v1.6.0 while this project's own releases continued in parallel.

- **Port baseline**: upstream **v1.0.0** (2026-08-14) — the commit date of this
  project's first commit, matching upstream's task-level-orchestration release.
- **Alignment target**: upstream **v1.6.0** (`69ffb34`, 2026-09-18).
- **Aligned through**: upstream **v1.6.0**, for the P0 (correctness) + P1
  (decision core) scope — implemented with all gates green, awaiting a version
  bump and release. P2/P3 remain open (see Planned). The delivery audit is in
  [`ALIGNMENT.md`](ALIGNMENT.md).
- The full audit, including what was deliberately **not** ported and why, lives
  in [`ALIGNMENT.md`](ALIGNMENT.md); the normative contract is
  [`SPEC.md`](SPEC.md).

| Upstream | Change | Status here |
|---|---|---|
| v0.5–v0.10 | fallback chains, runtime failover, confidence window, cost telemetry, cache-aware routing | ✅ already present (baseline) |
| v1.0.0 | task-level orchestration (Smart CTO delegates to Fast workers), hard caps | ✅ already present (baseline) |
| v1.0.1 | custom providers via `models.json`; wizard stale-list fix | ⛔ not portable (DSH owns providers); catalog refresh tracked below |
| v1.1.0 | orchestration actually triggers; full status-bar telemetry | ✅ adapted (`systemPrompt` section); status-bar half not portable |
| v1.1.1 | logging hygiene; status syncs the actually-running model | 🟡 in progress (this release) |
| v1.2.0 | convergence protocol, ghost-model cleanup, `unsupported_model` failover | 🟡 failover half in this release; convergence protocol is P2 |
| v1.3.0 | acceptance audit (`audit.ts` + auditor prompt) | ⏳ P2 (next round) |
| v1.3.1 | pi-tui runtime dependency + release gates | ⛔ packaging is host-specific; the *gate* intent is tracked below |
| v1.4.0 | **EV economics routing**, gear presets, strict model authority, doc-aware Judge, audit domain | 🟡 EV + gears + strict authority in this release; audit domain is P2 |
| v1.4.1 | failover on 402 / Insufficient Balance / 余额不足 | 🟡 in progress (this release) |
| v1.4.2 | Judge-outage **hold**, retry-aware exit, cooldown-aware audit, TPS median, actual-model sync, status dashboard, `decisionTier`, explicit-tier honoured | 🟡 hold / `decisionTier` / explicit-tier / actual-model sync in this release; audit halves are P2; **TPS deliberately not ported** (DSH renders `tok/s` natively) |
| v1.4.3 | Codex usage-limit failover | 🟡 in progress (this release) |
| v1.5.0 | per-worker cost attribution | ⏳ P2 (next round) |
| v1.5.1 | verbose logs to a file | ⛔ not needed (DSH does not hand the terminal to plugins); diagnostics use `ctx.logger` |
| v1.6.0 | model catalog from the host registry (single source of truth) | 🟡 principle adopted; the DSH-side single-source work is tracked below |

## Released

| Version | Highlights | Status |
|---------|-----------|--------|
| v0.1.0 | Initial DSH adaptation: two-tier LLM-Judge routing (agent/pre-step + agent/request), runtime failover (agent/request-error, exponential backoff, 4xx/5xx split), task-level orchestration (systemPrompt section), telemetry (session/event), `/router` commands | ✅ |
| v0.2.0 | Orchestration hard caps **enforced** (subagent deny at cap); `routing.mode` functional (auto/manual/off); schema range-validation; failover attribution + tier-billing fixes; model-availability memo invalidation | ✅ |
| v0.3.0 | Interactive `/router config` editor (numbered registry + `get`/`set`/`unset`/`diff` over the settings namespace) | ✅ |
| v0.4.0 | **GUI settings card** (client bundle, `settings.plugin.item` slot) + upstream `WEB_SETTINGS_NAMESPACES` whitelist workaround (`scripts/expose-gui-settings.mjs`) | ✅ |
| v0.5.0 | GUI card redesign per review: Shift-Router title + DSW chevron, grouped row layout, **Fast/Smart model chains in the card with DSH-catalog dropdowns**, dark-theme-safe switches, line-height normalization | ✅ |

## Next release — upstream P0+P1 alignment (in progress)

Scope agreed with the maintainer: **correctness fixes (P0) + decision-core
semantics (P1)**. EV routing **replaces** the old confidence-weighted ratio.

**P0 — correctness** (upstream already fixed these; the same defects were still
live here):

| Item | Upstream | This release |
|---|---|---|
| Judge outage must HOLD, never fabricate a fast verdict | v1.4.2 | ✅ |
| Failover signatures: 402 / insufficient balance / 余额不足 | v1.4.1 | ✅ |
| Failover signatures: usage-limit exhaustion (no HTTP status) | v1.4.3 | ✅ |
| Failover signatures: `unsupported_model` / `model_not_found` | v1.2.0 | ✅ |
| Display syncs the **actually running** model | v1.4.2 (Bug B) | ✅ |
| Strict model authority (tier change recorded even for a shared model id) | v1.4.0 | ✅ |
| Explicit tier/gear requests honoured (Judge ≥0.9 + `decisionTier`) | v1.4.2 | ✅ |
| Escalation counts **consecutive** worker failures | v1.2.0 | ✅ |
| Rounds counted at **dispatch** (`tools/pre-execute`), not at result | v1.2.0 | ✅ **deliberate divergence**: a dispatched delegation has already spent budget, so counting it keeps `maxRounds` a true ceiling on delegations attempted. Upstream counts at result, which lets an aborted call slip past the cap. |
| Orchestration state leaked by an interrupted turn is swept | v1.4.2 (B1 analogue) | ✅ (sweep at turn start; in-turn retry means the upstream "retryable tail" hazard cannot occur here) |
| ~~TPS median + 50 ms guard, turn-scoped fallback~~ | v1.4.2 | ⛔ **not ported** — DSH renders `tok/s` natively from decode time; the plugin's duplicated TPS machinery is **removed** instead |

**P1 — decision core:**

| Item | Upstream | This release |
|---|---|---|
| EV economics: θ = 1/R, `pSmart`, `downgradeMemory` (replaces the vote-counting window) | v1.4.0 | ✅ |
| `decisionTier` as the single "which tier runs this turn" signal | v1.4.2 | ✅ |
| Gear presets `/router eco|default|sport`, persisted | v1.4.0 | ✅ |
| Cache-aware as a θ divisor (`sameFamilyPenalty`) + legacy migration | v1.4.0 | ✅ |
| Judge prompt gains the 4th key `orchestrate`; explicit intent ≥0.9; doc-aware rules | v1.3.0–v1.4.2 | ✅ |
| Judge `orchestrate` signal gates orchestration entry | v1.1.0 | ✅ |
| **Worker model injection** (upstream calls tier injection mandatory) | v1.0.0+ | 🟡 documented + optional-service self-check + `/router status` line this release; GUI-assisted authorisation of the host `subagent-model-selection` allowlist is next ([decision](ALIGNMENT.md): option (a)+(b)). The self-check first shipped reading an undeclared service, which aborted the boot — corrected in the installation-verification round (ALIGNMENT §R3) |
| Removed `orchestration.requireSmartModel` | — | ✅ (deliberate divergence: `decisionTier` makes it redundant, and the knob could only force the CTO prompt onto a Fast run) |

## Installation verification round (delivered)

A real install into a `web` profile failed to boot; the round that fixed it is
recorded in [ALIGNMENT.md](ALIGNMENT.md) §R3. What it added to the engineering
baseline, permanently:

| Item | Status |
|---|---|
| Plugin loads against a **real Cordis context** with the real `inject` gate (`tests/plugin-load.test.ts`): service absent / early / late (mount race) / authorised, plus prompt-section order and variables | ✅ 8 tests |
| E2E covers the plugin's **default** orchestration mode with the web-only `subagent-model-selection-settings` row mounted | ✅ `e2e/orchestration-overlay.yml` |
| The upgrade-path fixture mirrors a **real** pre-alignment profile (it previously pinned `orchestration.mode: off`, which is how the boot bug escaped) | ✅ `e2e/legacy-config-overlay.yml` |
| Gates were **mutation-verified**: reverting the fix makes 3 unit tests and 2 E2E scenarios fail | ✅ |
| `/router status` reports the worker-delegation situation (the startup warning goes to a `ctx.logger` that stock compositions never export) | ✅ |
| `ux.promptSectionOrder` replaces a hardcoded platform-ordering literal | ✅ |
| SPEC §1.4 "Cordis plugin invariants" made normative; SPEC §13 states the log-visibility limit | ✅ |

## P2 round (delivered)

The orchestration-depth work plus the promoted SDK catch-up. Definitions and
acceptance criteria are in [ALIGNMENT.md](ALIGNMENT.md) §R4; the normative
contract is SPEC §7, §9, §13.

| Item | Upstream | Status |
|---|---|---|
| **SDK baseline catch-up** (`@deepseek-ai/*` 0.1.0-rc.6 → 0.1.5-rc.2, cordis 4.0.1 → 4.0.2) | — | ✅ build baseline = runtime baseline; three real breaks fixed (SPEC §1.5) |
| **C3** per-worker cost attribution | v1.5.0 | ✅ bounded worker ledger + `Orchestration spend: $X · N/M workers reported` (DSH form: attributed from the child session, not the tool result) |
| **C5** budget guard | (our own promise) | ✅ `orchestration.maxSpendUsd` wired into `capHit` + `capReason()` as the single authority |
| **C2** convergence protocol | v1.2.0 + v1.3.0 | ✅ structured `## Failure report` contract (what/where/acceptance) + no-repeat-then-takeover rule, sharing the enforced threshold |
| **C1** non-blocking acceptance audit | v1.3.0/v1.4.0/v1.4.2 | ✅ `src/audit.ts` + inlined auditor prompt + `Last audit:` in `/router status` (deterministic checks always; LLM pass detached, cooldown-filtered, delegation-only) |
| **C4(a)** assisted worker route authorisation | v1.0.0+ | ✅ `/router allow-workers [on\|off]` writes/revokes the Fast chain in the host `subagent-model-selection` allowlist (delivered as a command rather than a card button: it works in every profile and is unit-testable; the card edits the Fast chain, which is the input) |
| **C6** cross-turn lifecycle / parallel workers | upstream Phase 3 | ⛔ not aligned — **upstream has not shipped it either** |

## Planned

| Feature | Priority | Notes |
|---------|----------|-------|
| Orchestration acceptance audit (`audit.ts` + auditor prompt, delegated-turn domain, never blocks) | P2 | upstream v1.3.0/v1.4.0/v1.4.2 |
| Convergence protocol + escalation takeover in the orchestrator prompt | P2 | upstream v1.2.0/v1.3.0 |
| Per-worker cost attribution (`orchestration $X (N workers)`) | P2 | upstream v1.5.0 |
| GUI-assisted worker route authorisation (`subagent-model-selection`) | P2 | DSH-specific; see `ALIGNMENT.md` C4 |
| Cross-turn orchestration lifecycle / parallel specialised workers | P3 | upstream is still Phase 3 (not implemented there either) |
| Tool-result classification as a Judge input signal | P3 | upstream: TBD |
| GUI: `pricing` list-of-record editor | P3 | needs list-of-record form support |
| GUI: catalog live refresh on owner events | P3 | card dropdowns currently load once |
| Model catalog as the single source of truth for price/availability | P3 | adopts the v1.6.0 principle for DSH (`ctx.llm` instead of the hand-maintained `pricing` table) |
| Config-layer authority display | P3 | upstream v1.4.2; DSH analogue = settings namespace + patch layers |
| Examples directory (frontend / ML / cross-provider cost-saving configs) | ongoing | upstream line |
| CI + coverage thresholds (≥90% lines/functions/statements, ≥85% branches on core modules) | P3 | upstream gate |
| Packaged-install verification gate (`pack` → `dsh plugin add` → import every dist module) | P3 | DSH analogue of upstream `pack:check` + `check:isolated`. **Half delivered** by the installation-verification round: loading now happens for real (`tests/plugin-load.test.ts`) and a scratch-profile boot covers the default config; the `npm pack`→install isolation half is still open |
| Unit tests for `src/index.ts` **event-callback bodies** (sweep order, `agent/request-error` cooldown branches, `agent/request` rewrite) | P3 | the installation-verification round covered **load-time** wiring only; these run per turn |
| Decide the remaining display-only hardcodes (`stats.ts` confidence bucket at 0.7, `/router models` truncation) | P3 | recorded as acceptable in ALIGNMENT §R3.7; either make them config or show raw values |


## Explicitly excluded (by design)

Aligned with the original's non-goals (pi SPEC §0) and DSH constraints:

- **3-tier routing** — execution vs judgment is the only meaningful axis.
- **Keyword/custom rules** — the LLM Judge is the sole classifier. (Upstream
  briefly shipped an `EXPLICIT_ORCH_RE` keyword gate in v1.3.0 and removed it
  again in v1.4.2; this project never had one and will not add one.)
- **USD budget cap** — a routing layer, not a billing layer. (The orchestration
  loop guard is a cap on rounds/escalations, not a monetised budget.)
- **Heuristic Judge fallback** — the Judge either returns or holds position.
- **Cross-session persistent state** — router state stays per-agent and
  in-memory.
- **Local ML / ONNX inference** — a different design space.
- **Runtime npm dependencies** — zero runtime deps beyond DSH's own services.
- **A plugin-side throughput indicator** — DSH owns `tok/s` (see the alignment
  table above).

## See also

- [SPEC.md](SPEC.md) — the normative contract for this project
- [ALIGNMENT.md](ALIGNMENT.md) — the upstream alignment audit and work list
- [README.md](README.md) — user-facing docs (en)
- [README.zh-CN.md](README.zh-CN.md) — user-facing docs (zh)
- [CHANGELOG.md](CHANGELOG.md) — per-version change log
- [CONTRIBUTING.md](CONTRIBUTING.md) — DSH dev loop, build, and E2E notes
- [pi-shift-router ROADMAP](../pi-shift-router/ROADMAP.md) — the upstream roadmap

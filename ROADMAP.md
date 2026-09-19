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
- **Aligned through**: *in progress — see the release table below.*
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
| Escalation counts **consecutive** worker failures, rounds settle on result | v1.2.0 | ✅ |
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
| **Worker model injection** (upstream calls tier injection mandatory) | v1.0.0+ | 🟡 documented + startup self-check this release; GUI-assisted authorisation of the host `subagent-model-selection` allowlist is next ([decision](ALIGNMENT.md): option (a)+(b)) |
| Removed `orchestration.requireSmartModel` | — | ✅ (deliberate divergence: `decisionTier` makes it redundant, and the knob could only force the CTO prompt onto a Fast run) |

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
| Packaged-install verification gate (`pack` → `dsh plugin add` → import every dist module) | P3 | DSH analogue of upstream `pack:check` + `check:isolated` |
| SDK baseline catch-up (`@deepseek-ai/*` 0.1.0-rc.6 → 0.1.5-rc.2, cordis 4.0.1 → 4.0.2) | P3 | prerequisite for adopting newer harness surfaces |

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

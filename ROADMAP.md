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
  (decision core) scope plus the P2 round — **shipped in v0.6.0**. What remains is the
  GUI (card-button) form of worker-route authorisation and the v1.6.0 pricing
  single-source work (see Planned). The delivery audit is in
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
| v1.1.1 | logging hygiene; status syncs the actually-running model | ✅ shipped in v0.6.0 (route notices — R9 — replace the log ring as the user-visible surface) |
| v1.2.0 | convergence protocol, ghost-model cleanup, `unsupported_model` failover | ✅ both halves shipped in v0.6.0 (failover; convergence protocol in the P2 round) |
| v1.3.0 | acceptance audit (`audit.ts` + auditor prompt) | ✅ shipped in the P2 round (non-blocking, deterministic checks + detached LLM pass) |
| v1.3.1 | pi-tui runtime dependency + release gates | ⛔ packaging is host-specific; the *gate* intent is tracked below |
| v1.4.0 | **EV economics routing**, gear presets, strict model authority, doc-aware Judge, audit domain | ✅ all four shipped in v0.6.0 (audit domain in the P2 round) |
| v1.4.1 | failover on 402 / Insufficient Balance / 余额不足 | ✅ shipped in v0.6.0 |
| v1.4.2 | Judge-outage **hold**, retry-aware exit, cooldown-aware audit, TPS median, actual-model sync, status dashboard, `decisionTier`, explicit-tier honoured | ✅ hold / `decisionTier` / explicit-tier / actual-model sync in v0.6.0, the audit halves in the P2 round; **TPS deliberately not ported** (DSH renders `tok/s` natively) |
| v1.4.3 | Codex usage-limit failover | ✅ shipped in v0.6.0 |
| v1.5.0 | per-worker cost attribution | ✅ shipped in the P2 round (bounded worker ledger, attributed from the child session) |
| v1.5.1 | verbose logs to a file | ⛔ not needed (DSH does not hand the terminal to plugins); diagnostics use `ctx.logger` (now supplemented by route notices — see R9) |
| v1.6.0 | model catalog from the host registry (single source of truth) | ✅ principle shipped in v0.6.0 (GUI card dropdowns — R7); the DSH-side pricing replacement is ⏳ P3 |

## Released

| Version | Highlights | Status |
|---------|-----------|--------|
| v0.1.0 | Initial DSH adaptation: two-tier LLM-Judge routing (agent/pre-step + agent/request), runtime failover (agent/request-error, exponential backoff, 4xx/5xx split), task-level orchestration (systemPrompt section), telemetry (session/event), `/router` commands | ✅ |
| v0.2.0 | Orchestration hard caps **enforced** (subagent deny at cap); `routing.mode` functional (auto/manual/off); schema range-validation; failover attribution + tier-billing fixes; model-availability memo invalidation | ✅ |
| v0.3.0 | Interactive `/router config` editor (numbered registry + `get`/`set`/`unset`/`diff` over the settings namespace) | ✅ |
| v0.4.0 | **GUI settings card** (client bundle, `settings.plugin.item` slot) + upstream `WEB_SETTINGS_NAMESPACES` whitelist workaround (`scripts/expose-gui-settings.mjs`) | ✅ |
| v0.5.0 | GUI card redesign per review: Shift-Router title + DSW chevron, grouped row layout, **Fast/Smart model chains in the card with DSH-catalog dropdowns**, dark-theme-safe switches, line-height normalization | ✅ |
| v0.6.0 | **Upstream P0+P1 alignment** (EV routing, gear presets, strict model authority, doc-aware Judge, Judge-outage hold, failover on 402 / usage-limit / `unsupported_model`) + **GUI card review rounds** (R6 registration, R7 model-catalog remote + copy, R8 layout overlap + information architecture) + **runtime visibility** (R9 route notices written into the session). 336 tests / 18 files; `tsc` host + client, `tsdown` build, and `npm run test:e2e` green | ✅ |

## Installation verification round (delivered)

A real install into a `web` profile failed to boot; the round that fixed it is
recorded in [ALIGNMENT.md](ALIGNMENT.md) §R3. What it added to the engineering
baseline, permanently:

| Item | Status |
|---|---|
| Plugin loads against a **real Cordis context** with the real `inject` gate (`tests/plugin-load.test.ts`): service absent / early / late (mount race) / authorised, plus prompt-section order, variables and a driven `agent/pre-step` turn | ✅ |
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

## Post-install GUI card round (delivered)

The install succeeded and DSH booted, but the settings card never appeared in
Settings → Plugins → Plugin configuration. Root cause, evidence and the residual
uncertainty are in [ALIGNMENT.md](ALIGNMENT.md) §R6; the contract is SPEC §12.1.

| Item | Status |
|---|---|
| Card registered with `key` (the settings namespace) instead of `id` — `settings.plugin.item` is a **keyed** slot and `SlotCore` throws on anything else | ✅ |
| The slot contract is imported type-only from its declarer instead of re-spelled locally (the local copy said `list`, so `tsc` blessed the wrong call) | ✅ |
| `tests/client-card-slot.test.ts` runs the card's real `apply()` against the harness's real `SlotCore`, in both load orders; the e2e additionally reads the boot payload back from a packed install and asserts the browser half is offered to the client module loader | ✅ 4 tests |
| Mutation-verified: reverting `key` → `id` fails both that test and `npm run typecheck` | ✅ |

## Settings UX round (delivered)

The card rendered, but asked the user to type provider/model ids by hand. The
audit and the remaining gaps are in [ALIGNMENT.md](ALIGNMENT.md) §R7; the rules
are SPEC §12.2 (model source) and §12.3 (card UX).

| Item | Status |
|---|---|
| Model lists come from `ctx.remote.session.modelCatalog()` — the same catalog `/model` reads — read reactively and re-loaded on adapter/settings/credentials changes and connection reset; the e2e reads the same Host catalog back and asserts the deployment advertises its configured routes | ✅ |
| The previous source (`ctx.get('connection')?.api.llm.models()`) does not exist, which is why every model control silently degraded to a text box | ✅ |
| Provider failures, empty or duplicated chains and an identical Fast/Smart primary are surfaced in the card — they used to be startup logs that a stock profile never shows (SPEC §13) | ✅ |
| Chain rows reorder with ↑/↓; numeric controls carry the schema's `min`/`max`/`step`; `legacy` fields are marked inert; the collapsed header summarises the effective config | ✅ |
| Deferred: 0–1 sliders, a routing-section filter, runtime state on the card (needs a browser↔host channel) | recorded |

## Settings layout + information architecture round (delivered)

The card was measured in a real browser (the numbers are in
[ALIGNMENT.md](ALIGNMENT.md) §R8; the rules are SPEC §12.3): elements overlapped, and the
open card showed far too many controls at once.

| Item | Status |
|---|---|
| The model row's role badge overflowed its fixed 20px grid track onto the provider select, and every unit suffix (`ms`, `tokens`, …) sat under the spin buttons of the new number inputs | ✅ fixed (content-sized row, unit moved out of the input) |
| Advanced settings (21) moved behind one *Advanced* disclosure, closed on open; the default view keeps the 9 decisions that change routing plus the two tier chains | ✅ |
| The default-visible set is pinned by a test, so clutter cannot creep back one field at a time | ✅ |
| Every label, hint and section summary rewritten from the user's side (what it does to your requests, when to change it) in both locales | ✅ |
| `e2e/browser-check.mjs`: opt-in real-browser check — card renders, **zero** bounding-box overlaps, the deployment's providers reach the dropdown, the advanced section starts collapsed | ✅ |

## Runtime visibility round (delivered)

An enabled plugin that shows no sign of running is indistinguishable from a broken
one. The audit — including why the `[model changed: …]` line users see is *not*
this plugin — is in [ALIGNMENT.md](ALIGNMENT.md) §R9; the rules are SPEC §13.1.

| Item | Status |
|---|---|
| Route notices: a tier/model switch is written into the session as a `form: 'notice'` message (`[shift-router] …`) instead of only into a log ring no stock profile exports | ✅ |
| The notice text names the plugin, because the durable `source.plugin` field is never rendered by the Chat client | ✅ |
| `ux.routerLogVerbose` now means what it says: every judged turn gets a notice, not just every switch | ✅ |
| No status bar is invented — DSH has no statusbar/toolbar slot; the harness-proven notice channel is used instead | ✅ |

## Planned

| Feature | Priority | Notes |
|---------|----------|-------|
| Orchestration acceptance audit, convergence protocol, per-worker cost attribution | ~~P2~~ | ✅ delivered in the P2 round (see that section) |
| GUI-assisted worker route authorisation (`subagent-model-selection`) | P2 | DSH-specific; the command form shipped as `/router allow-workers`, the card-button form is open (see `ALIGNMENT.md` C4) |
| Cross-turn orchestration lifecycle / parallel specialised workers | P3 | upstream is still Phase 3 (not implemented there either) |
| Tool-result classification as a Judge input signal | P3 | upstream: TBD |
| GUI: `pricing` list-of-record editor | P3 | needs list-of-record form support |
| ~~GUI: catalog live refresh on owner events~~ | ~~P3~~ | ✅ delivered (R7): the card re-reads `ctx.remote.session.modelCatalog()` on `llm/adapters-updated`, `settings/document-updated`, `credentials/reference-updated` and `connection/reset` — the row claiming "loads once" was stale |
| Model catalog as the single source of truth for price/availability | P3 | adopts the v1.6.0 principle for DSH (`ctx.llm` instead of the hand-maintained `pricing` table) |
| Config-layer authority display | P3 | upstream v1.4.2; DSH analogue = settings namespace + patch layers |
| Examples directory (frontend / ML / cross-provider cost-saving configs) | ongoing | upstream line |
| CI + coverage thresholds (≥90% lines/functions/statements, ≥85% branches on core modules) | P3 | upstream gate |
| ~~Packaged-install verification gate~~ | ~~P3~~ | ✅ delivered: `tests/packaged-install.test.ts` (built-artifact imports ⊆ `dependencies` ∪ `peerDependencies`, browser requires ⊆ platform seed ∪ `dsh.client`, `files` completeness) + an `npm pack` → install → **boot** scenario in `npm run test:e2e` |
| Unit tests for `src/index.ts` **event-callback bodies** | P3 | the load-safety and `agent/pre-step` paths are covered; the remaining branches are the `agent/request-error` cooldown ladder and the `agent/request` rewrite |
| Decide the remaining display-only hardcodes (`stats.ts` confidence bucket at 0.7, `/router models` truncation) | P3 | recorded as acceptable in ALIGNMENT §R3.7; either make them config or show raw values |


## Explicitly excluded (by design)

The non-goals are normative and live in one place: **SPEC §0** (design non-goals)
and **SPEC §16** (upstream mechanisms deliberately not ported, each with its
reason). One is repeated here only because it is the upstream feature most likely
to be re-proposed: a **plugin-side throughput indicator** — DSH renders `tok/s`
natively from decode time, so porting it would duplicate the harness with a worse
number.

## Documentation index

- [SPEC.md](SPEC.md) — the normative contract for this project
- [ALIGNMENT.md](ALIGNMENT.md) — the upstream alignment audit and work list
- [README.md](README.md) — user-facing docs (en)
- [README.zh-CN.md](README.zh-CN.md) — user-facing docs (zh)
- [CHANGELOG.md](CHANGELOG.md) — per-version change log
- [CONTRIBUTING.md](CONTRIBUTING.md) — DSH dev loop, build, and E2E notes
- [pi-shift-router ROADMAP](../pi-shift-router/ROADMAP.md) — the upstream roadmap

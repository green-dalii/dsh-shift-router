# Roadmap

Release history and planned work for **dsh-shift-router** — the DeepSeek Harness
adaptation of [pi-shift-router](https://github.com/green-dalii/pi-shift-router).
Alignment note: the original's v0.x feature line maps onto our v0.x line one-to-one
(judge routing → failover → sliding window → cache-aware → orchestration); DSH-specific
work (GUI card, settings namespace, subagent orchestration) rides on top.

## Released

| Version | Highlights | Status |
|---------|-----------|--------|
| v0.1.0 | Initial DSH adaptation: two-tier LLM-Judge routing (agent/pre-step + agent/request), runtime failover (agent/request-error, exponential backoff, 4xx/5xx split), task-level orchestration (systemPrompt section), telemetry (session/event), `/router` commands | ✅ |
| v0.2.0 | Orchestration hard caps **enforced** (subagent deny at cap); `routing.mode` functional (auto/manual/off); schema range-validation; failover attribution + tier-billing fixes; model-availability memo invalidation | ✅ |
| v0.3.0 | Interactive `/router config` editor (numbered registry + `get`/`set`/`unset`/`diff` over the settings namespace) | ✅ |
| v0.4.0 | **GUI settings card** (client bundle, `settings.plugin.item` slot) + upstream `WEB_SETTINGS_NAMESPACES` whitelist workaround (`scripts/expose-gui-settings.mjs`) | ✅ |
| v0.5.0 | GUI card redesign per review: Shift-Router title + DSW chevron, grouped row layout (label+hint left / control right), **Fast/Smart model chains in the card with DSH-catalog dropdowns** (active providers only), dark-theme-safe switches, line-height normalization | ✅ |

## Planned

| Feature | Version | Notes |
|---------|---------|-------|
| Cost telemetry — deep view | v1.0.0 | Smart vs Fast spend breakdown + savings vs **all-turns-on-smart** baseline (pi v0.9 line). Data already collected (`tierUsage`, `callLog`); build the `/router stats` view. |
| Verbose logs to a file | TBD | `ux.routerLogVerbose` writes through `ctx.logger`; add a file sink (e.g. `~/.dsh/logs/shift-router.log`) so verbose diagnostics don't interleave with the terminal. |
| Tool-result classification | TBD | Classify tool calls (long shell output may indicate debugging, not a question) as a judge input signal — pi SPEC §9 line. |
| Cross-turn orchestration lifecycle | v1.1.0 | `orchestration.active` persists across turns while a complex task is open (entry on smart verdict, exit on sentinel completion / cap / abort) — pi Phase 3 line. |
| Multiple specialized workers | v1.1.0 | Frontend/backend/test workers derived from the Fast chain; parallel fanout via subagent runs for independent phases — pi Phase 3 line. |
| Orchestration loop hardening | v1.0.0 | Only-blocking-issues review rule, escalation-threshold takeover honored in prompts, per-worker cost attribution — pi Phase 2 line. |
| GUI: pricing editor | v1.0.0 | `pricing` (USD-per-1M-token table) currently CLI/patch-only; add a card editor once the form model grows list-of-record support. |
| GUI: catalog live refresh | v1.0.0 | Refresh the model dropdowns on `llm/adapters-updated` / `settings/document-updated` owner events instead of only at card construction. |
| Examples directory | ongoing | Sample configs (frontend / ML / cross-provider cost-saving) for documentation — pi line. |
| CI + coverage reporting | v1.0.0 | `vitest --coverage` with thresholds (pi ships ≥90% lines/functions/statements, ≥85% branches on the core modules). |

## Explicitly excluded (by design)

Aligned with the original's non-goals (pi SPEC §0) and DSH constraints:

- **3-tier routing** — execution vs judgment is the only meaningful axis.
- **Keyword/custom rules** — the LLM Judge is the sole classifier.
- **USD budget cap** — a routing layer, not a billing layer.
- **Heuristic Judge fallback** — the Judge either returns or holds position.
- **Cross-session persistent state** — router state stays session-scoped (DSH session model).
- **Local ML / ONNX inference** — a different design space.
- **Runtime npm dependencies** — zero runtime deps beyond DSH's own services.

## See also

- [README.md](README.md) — user-facing docs (en)
- [README.zh-CN.md](README.zh-CN.md) — user-facing docs (zh)
- [CHANGELOG.md](CHANGELOG.md) — per-version change log
- [CONTRIBUTING.md](CONTRIBUTING.md) — DSH dev loop, build, and E2E notes
- [pi-shift-router ROADMAP](../pi-shift-router/ROADMAP.md) — the upstream roadmap this
  project's feature line tracks

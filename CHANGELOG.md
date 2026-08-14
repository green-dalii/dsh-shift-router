# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-15

### Changed

- **Orchestration hard caps are now enforced, not just prompted**:
  - Every `subagent` delegation while an orchestration turn is active increments `orchestration.rounds` (`tools/pre-execute`); every failed (`isError`) subagent result increments `orchestration.escalations` (`tools/result`).
  - At the cap the `subagent` tool is denied outright and the orchestrator system-prompt section switches to a "wrap up now" notice (`buildCapNotice`).
- **`routing.mode` is now functional** (was display-only): `auto` = judge + routing + failover + orchestration; `manual` = only explicit `/route-force` overrides (no judge); `off` = fully passive for model selection.
- **Removed `ux.quietMode` and the `/router quiet` command** — the plugin sends no notifications, so the toggle was dead config.
- Hardcoded runtime parameters moved into `Config` (all with safe defaults, now range-validated):
  - `routing.judgeMaxTokens` (was `JUDGE_MAX_TOKENS`), `routing.judgePromptCap` (was `JUDGE_PROMPT_CAP`).
  - `failover.baseMs` / `failover.maxMs` / `failover.startAttempts4xx` / `failover.speedWindowSize` (were module constants).
  - `telemetry.callLogCap` (bounds the per-message attribution log).
- Config schema now range-constrains numeric fields (`min`/`max`/`natural`/`percent`) so invalid configuration fails loudly at load and on `/router config set` — never silently misbehaves. Dropped the `as never` nested-default hacks (leaf defaults cover missing objects).
- `agent/request-error` attributes the failure to the exact model last put on the wire (`lastRequestProvider`/`lastRequestModel`, recorded in `agent/request`) instead of scanning session events.
- Telemetry attributes each message to the tier that owns its model (`findTierForModel`) rather than the router's current tier, so manual overrides / same-provider switches are billed to the right tier.
- Model-availability memo is cleared on every config refresh, so adapter/config changes are re-probed instead of serving stale results.
- `/router config` surfaces the schema's rejection message on failed `set`/`reset` instead of a generic error.
- `scope.watch()` disposal is registered as an effect (explicit teardown on HMR reload).
- `processRoute` stamps window entries with the injected `now` (deterministic, pure).

### Added

- Packaging: `prepare` script (self-contained `tsc` build for git installs), `exports` map, `README.zh-CN.md` in `files`.
- Tests: 62 unit tests (added failover-policy, cap-enforcement, config-schema, and deterministic-timestamp cases).

### Removed

- `@deepseek-ai/dsh-scope` direct dependency (transitive only).

## [0.1.0] - 2026-08-14

### Added

- Initial release — a DeepSeek Harness adaptation of pi-shift-router.
- Two-tier (Fast ↔ Smart) LLM-Judge routing:
  - Judge runs on the Fast-tier model chain via `ctx.llm.stream()` (harness adapters/credentials; no hand-built fetch).
  - `agent/pre-step` turn-start classification; `agent/request` per-step model override.
  - Instant upgrades; confidence-weighted sliding-window downgrade gate.
  - Cache-aware routing (same-provider threshold raise + warm-cache hold).
- Runtime failover:
  - `agent/request-error` cooldown marking + `{kind:'retry'}` same-tier fallback.
  - Exponential backoff 1m → 4m → 16m → 1h → 6h (4xx starts at 16m).
  - Cooldown recovery on a successful assistant message.
- Task-level orchestration:
  - Smart verdicts escalate to a CTO run with an injected orchestrator system-prompt section.
  - Hard caps: `maxRounds` and `escalationThreshold`.
  - Adapted to the DSH `subagent` tool contract (fresh-session workers, deployment-pinned worker model).
- Configuration:
  - Schemastery `Config` schema; `shift-router` settings namespace.
  - Editable live via the GUI settings panel and `/router config set|set-fast|set-smart|reset` (persisted).
- Commands: `/router` (status/stats/on/off/quiet/verbose/orchestrate/config) and `/route-force`.
- Cost telemetry: per-tier tokens/throughput and optional pricing table; savings vs. all-turns-on-Smart baseline.
- Tests: 52 unit tests (routing engine, failover, judge parsing, orchestration) + credential-free headless e2e (fake adapter, settings persistence probe).

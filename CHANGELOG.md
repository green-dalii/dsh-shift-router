# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

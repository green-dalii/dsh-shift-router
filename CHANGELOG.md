# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-08-15

### Changed

- **GUI card redesigned for the review round** — the card now matches the
  host-plane look and interaction states exactly (native `PluginCard` chrome:
  hover border, open background, focus-visible outlines, the DSW chevron SVG
  instead of a text triangle, `label-primary` save button, disabled opacity)
  and fixes the review findings:
  - **Title is the plugin name**: the card header now reads **"Shift-Router"**
    (was "模型路由 / Model router"), consistent with the plugin's own name.
  - **Card description carries the author signature**:
    `…。作者：green-dalii` / `… Author: green-dalii` (review round 3).
  - **Line-height normalization (review round 3)** — fixes a real layout bug:
    several inline styles carried native-CSS *pixel* line-heights as React
    *unitless numbers* (`lineHeight: 17`), which CSS interprets as **17 ×
    font-size** — group headings ballooned to ~176px and override/unsaved
    badges to ~187px. All text now uses tight unitless multipliers (single
    line `1.2`, multi-line hint `1.3`), fixed-height controls drop
    line-height entirely, and field hints are clamped to 2 lines with a
    hover tooltip. Measured effect: card ~3000px → ~1900px; every element's
    computed line-height is now < 2.2× its font size.
  - **Clean, grouped layout**: seven bordered section blocks (General /
    Models / Routing / Orchestration / Failover / Telemetry / Logs & UX) with
    one-line summaries, sub-groups for the Routing section (Judge / Decision
    window / Cache-aware), and the native field-separator rhythm.
  - **Compact settings-row form** (review round 2): each scalar field is one
    grid row — label + hint on the left, control right-aligned on the same
    line — instead of three stacked lines. Measured effect: per-field height
    ~108px → ~59px, card height ~4077px → ~3000px, with controls uniformly
    right-aligned and no overflow.
  - **No more duplicated hint text**: units and ranges moved out of the
    descriptions into unit suffixes inside the numeric inputs (`ms`, `tokens`,
    `0–1`, `rounds`, `calls`), and every hint was rewritten in plain language
    (the old `快速层占比达到该值即保持快速（[0,1]）。 ([0,1])` duplication is
    gone).
- **Fast / Smart model specification + fallback order are now in the card**:
  a new Models section with an ordered row editor for `tiers.fast.models` and
  `tiers.smart.models`. The row order is the in-tier fallback order — the
  first available model wins, the rest are its fallbacks — which is exactly
  how `findBestModelForTier` / failover consume the chain. **Provider and
  model dropdowns are auto-loaded from DSH's runtime model catalog**
  (`llm.models`, the same catalog the DSH settings surface reads): only
  providers with a currently advertised model list appear — the declarative
  `llm.providers` directory (dormant routes) is intentionally not read, so
  the card shows exactly the models DSH is configured with, in any
  deployment, with nothing hardcoded. A "Custom…" escape covers values
  outside the catalog and a graceful free-text fallback covers catalog
  loading/failure. Only `pricing` remains CLI/patch-only.
- **Controls polished**: booleans render as toggle switches (`role="switch"`)
  whose ON state uses the business accent (`--dsw-alias-state-business-primary`,
  a mid-tone blue in both themes) with a static white shadowed knob — clearly
  readable in light and dark themes (the previous white-on-near-white dark
  ON state is fixed); enums as a styled select with the DSW chevron, model
  rows in the native grid layout with dashed empty state and icon remove
  buttons.
- Client form model extended: `models` field type, `ModelRow`, row-draft
  parsing (blank rows dropped, half-filled rows block save), and save-plan
  support for the tier chains (batched into one `tiers` section write,
  deep-pruned so cleared chains don't leave `{fast:{}}` shells).

### Added

- Tests: 109 unit tests (added model-chain draft parsing, tier-chain save
  plans, cleared-chain pruning, the model-catalog loader incl. the wire
  `result.ok`/`value` envelope, and updated the GUI/CLI registry parity:
  model lists are now GUI-exposed, `pricing` stays CLI-only).
- **`CONTRIBUTING.md` rewritten for the DSH environment** (review round 3):
  the DSH dev loop (live config changes / HMR for patch edits vs build +
  restart for host and client code, the in-process client-bundle cache, the
  package-name mount requirement, the settings-whitelist patch), the manual
  browser E2E recipe, registry-parity and line-height guidelines, and the
  local-review commit workflow.
- **`ROADMAP.md` added** (review round 3), modeled on the upstream
  pi-shift-router ROADMAP: released-version table (v0.1.0–v0.5.0), a
  DSH-adapted planned table (cost deep view, log-to-file, tool-result
  classification, cross-turn orchestration, multi-worker fanout, GUI pricing
  editor, catalog live refresh, CI coverage), explicit non-goals, and
  cross-links.

## [0.4.0] - 2026-08-15

### Added

- **GUI configuration card** — the package now ships a browser-side (client)
  module that registers a "Model router" card in the GUI's Settings → Plugins
  → Plugin configuration section (the `settings.plugin.item` slot of the
  official `dsh-client-ui-settings-plugins` section). The card:
  - renders every **scalar** leaf of the `shift-router` settings namespace as
    a form (booleans, numbers, enums), grouped by section, with staged saving,
    per-field reset-to-default, override markers, and a read-only notice when
    the deployment stores settings read-only;
  - writes the same namespace `/router config` edits (per-section
    `settings.mutate`-equivalent scope writes, revision-fenced), so the two
    surfaces stay consistent in real time;
  - is built by the extended `npm run build` pipeline (`tsc` host → `tsc`
    client → `tsdown` client bundle, `dist/client.js`, CJS closure-factory per
    the `packages/client/tsdown.client.ts` protocol) and discovered through
    the `dsh.client` manifest — the plugin must be mounted by package name
    (`dsh-shift-router`) for the card to be served.
  - **Upstream whitelist caveat (0.1.0-rc.6)**: the Web API proxy
    (`@deepseek-ai/dsh-host-apiproxy`) only serves settings namespaces on its
    hardcoded `WEB_SETTINGS_NAMESPACES` list to the browser; a third-party
    namespace is filtered out of `settings.describe` even when registered.
    `scripts/expose-gui-settings.mjs` adds `shift-router` to that list in the
    profile's installed copy (idempotent) — run it once per profile and
    restart; the README documents the upstream "deferred work" comment.
- Tests: 95 unit tests (added the client form model: path helpers, draft
  parsing, section-patch save plan, GUI/CLI field-registry parity against
  `CONFIG_FIELDS`, and the whitelist-patch logic).

### Changed

- `package.json`: new `dsh.client` manifest, `exports["./client"]`, and a
  two-program `build`/`typecheck` (`tsconfig.client.json` + `tsdown.config.ts`).

## [0.3.0] - 2026-08-15

### Added

- **Interactive `/router config` editor** — the command now renders a numbered
  field list with current values (one row per editable leaf, type-annotated),
  plus four editing subcommands:
  - `get <N|path>` — show one field's current value.
  - `set <N|path> <value>` — set one field by index or dotted path (JSON
    values auto-parsed); indexes are stable (registry order).
  - `unset <N|path>` — clear a single user override via the official
    `settings.mutate` path-op write (`{op:'unset'}`), so the field reverts to
    its composition default without touching the rest of the user section.
  - `diff` — list the raw user-section overrides the settings layer currently
    holds, each with its effective value.
- Tests: 72 unit tests (added `/router config` editor helpers: field registry
  integrity, index/path resolution, path reading, value formatting, leaf
  flattening).

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

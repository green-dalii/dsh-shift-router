# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

**Upstream alignment round: P0 (correctness) + P1 (decision core)** against
`pi-shift-router` v1.6.0, from this project's v1.0.0-era port baseline. The
normative contract is now [`SPEC.md`](SPEC.md); the audit — including what was
deliberately **not** ported and why — is [`ALIGNMENT.md`](ALIGNMENT.md).

> **Status: implemented, not yet released.** This section was authored
> docs-first and every item has since landed, with the gates in SPEC §14 green
> (tsc host + client, 216 tests across 12 files, tsdown build, and
> `npm run test:e2e` against a scratch profile). The delivery audit — including
> what was deliberately *not* ported and the residual gaps — is in
> [`ALIGNMENT.md`](ALIGNMENT.md). A version bump and the release itself are the
> maintainer's call.

> ⚠ **Routing behaviour changes immediately, with no config edit.** The
> decision rule is replaced (vote counting → expected cost) and two legacy
> knobs change meaning. See "Changed — routing semantics" and "Migration".

### Added

- **EV (expected-cost) routing.** The turn runs on the Smart tier iff
  `pSmart ≥ θ`, where `θ = 1 / economics.reworkPenalty` and `pSmart` is the
  Judge's confidence read as evidence for Smart (`c` for a `smart` verdict,
  `1 − c` for a `fast` verdict). θ is price-independent: the price delta cancels
  out, so the single knob is how badly a wrong downgrade hurts. Replaces the
  confidence-weighted window ratio, which counted votes instead of weighing cost.
- **`routing.economics`** config block: `reworkPenalty` (R, default 3),
  `downgradeMemory` (consecutive decisive fast turns required before
  smart → fast, default 2), and `mode`.
- **Gear presets** as top-level commands — `/router eco` (R=2, θ=0.5),
  `/router default` (R=3, θ≈0.33), `/router sport` (R=5, θ=0.2) — persisted to
  the settings namespace and tab-completable.
- **`decisionTier`** on every routing decision: the tier this turn will
  actually run at, after EV, hold and manual override. Orchestration entry and
  telemetry read this single signal instead of re-deriving a tier from the raw
  verdict.
- **`routing.cacheAware.sameFamilyPenalty`** (default 1.5): when both tiers
  share a provider, θ is divided by this factor. A smaller bar means fewer
  downgrades, so the warm prompt cache survives longer.
- **Judge `orchestrate` signal**: the Judge may now explicitly say whether the
  Smart tier should delegate to Fast workers. `false` vetoes orchestration;
  absent falls back to the tier-based default.
- **Judge prompt rules** from upstream v1.3.0–v1.4.2: an explicit tier / gear /
  orchestration request is a certainty and must be reported with
  `confidence ≥ 0.9`, evaluated before torn-task signals; document handling and
  tedious bulk batches classify as `fast` unless they set direction.
- **`lastDecision`** state (verdict, confidence, reason, action,
  `decisionTier`, held) for the "why did it route this way" section of
  `/router status`.
- **`actualProvider` / `actualModel`** state: the model that actually produced
  the last assistant message, kept separate from the router's *intended* model
  so a stale intent can never be displayed as fact.
- **Worker-model startup self-check**: when orchestration is on and the Fast
  chain is non-empty, the plugin warns if model-selectable delegation is not
  available, naming the harness setting to enable and stating the consequence
  (workers would otherwise inherit the Smart model).

### Changed — routing semantics

- **A Judge outage is now a HOLD, not a `fast` verdict.** Previously every
  Judge endpoint failing produced `{tier:'fast', source:'fallback'}`, which the
  router treated as decisive evidence and pushed into the window — two
  consecutive outages silently downgraded a Smart session. Now `source ===
  'fallback'` keeps the current tier, records a hold entry, and never extends
  (or counts as) a downgrade streak.
- **A verdict below `window.minConfidence` is likewise a hold** rather than an
  ignored sample: ignoring it let the remaining entries decide alone.
- **Downgrade now requires `downgradeMemory` consecutive decisive fast
  decisions.** Any hold or smart entry breaks the streak (upstream v1.4.0).
- **Strict model authority**: a tier change is recorded even when both tiers
  resolve to the same model id, so tier identity — not the model string —
  carries the decision.
- **Failover signatures extended** (upstream v1.2.0/v1.4.1/v1.4.3):
  - HTTP **402** and `insufficient balance` / `余额不足` — an unfunded account
    used to stay pinned, so every turn re-tried it while the router kept
    choosing it.
  - usage-limit exhaustion with no HTTP status (`The usage limit has been
    reached`, `usage_limit_reached`).
  - `unsupported_model` / `model_not_found` / a model reference adjacent to
    "not supported" — a decommissioned model now fails over instead of pinning
    the tier.
- **Explicit tier / orchestration requests are honoured**: orchestration gates
  on `decisionTier`, so the raw verdict can no longer inject the CTO prompt
  while the fast model runs the turn.
- **Escalation counts consecutive worker failures**; a successful worker
  result resets the streak, so isolated failures no longer burn the cap.
- **Orchestration state leaked by an interrupted turn is swept** at the next
  turn start (previously a turn that never reached its stop boundary left
  orchestration active, caps enforcing, and the orchestrator prompt rendered
  into every following turn).

### Removed

- **The plugin's duplicate throughput (TPS) machinery** —
  `tokensPerSecond`, `recordSpeed`, the speed window, `SPEED_WINDOW_SIZE`,
  `failover.speedWindowSize`, the `assistant/chunk` listener, the related state
  fields and the `tok/s` line in `/router status`. DeepSeek Harness already
  renders `tok/s` natively in the chat message footer and the trajectory panel,
  and derives it from **decode time** (`outputTokens / (decodeMs / 1000)`), which
  is strictly better than this plugin's wall-clock estimate. Duplicating it
  meant two competing figures for one thing, one of them worse.
  *Deliberately not ported from upstream v1.4.2.*
- **Dead code and an unused dependency** found by a reference scan:
  `jsonStr` and the never-wired `FALLBACK_PROMPT` / `judgeFallbackPrompt` in
  `judge.ts`, `formatDuration` in `stats.ts` (a duplicate of
  `failover.formatRemaining` with no caller), and the `@deepseek-ai/dsh-timeout`
  direct dependency (no source file imports it; it remains a transitive one).
- **`orchestration.requireSmartModel`** — `decisionTier` now reports truthfully
  whether the Smart tier will run, so orchestration already cannot fire without
  a resolvable Smart model. The knob's only reachable effect was injecting the
  CTO prompt onto a Fast-tier run (the upstream "CTO loop on the fast model"
  bug class).

### Fixed

- Status output now reports the model that **actually** ran, not the router's
  intent (upstream v1.4.2 Bug B).
- Orchestration no longer prompts for delegation that the router cannot honour.

### Fixed in review

An independent adversarial review (with mutation testing) audited this round
before release. Its findings, all fixed:

- **An embedded 402 in the failure text was not matched.** `failure.status`
  and the balance keywords were handled, but `"HTTP 402 Payment Required"` fell
  through to the status regex, which listed 429 and 5xx only — so exactly the
  adapters that fold the status into the message kept a dead account pinned.
- **A completed message without usage did not age the prompt cache.**
  `lastActivityAt` was set after the `if (!usage) return` early return, so the
  state still read "no message has completed yet" and the warm-cache downgrade
  gate stayed open — the cost inversion cache-aware routing exists to prevent.
- **A forced model borrowed the verdict's tier.** `/route-force <provider/model>`
  while the Judge said `smart` reported `decisionTier: 'smart'`, enough to start
  an orchestration turn on a user-pinned model. The tier now comes from the
  model itself.
- **`downgradeMemory` larger than `window.size` silently pinned the router to
  Smart.** The streak lives in the window, so the requirement now saturates at
  the window size and `/router status` reports the cap.
- **The `⚠ legacy` warning fired for the inert default.** A config carrying the
  pre-EV `sameFamilyThreshold: 0.9` was told an override was in force (and that
  the strong cache divisor applied) when neither was true.
- **The GUI hint for `minConfidence` stated the opposite of the code** about
  holds and the downgrade streak.
- **The worker-model self-check stayed silent when the harness exposes no
  `subagent-model-selection` service** — which is precisely when delegation is
  not selectable. It now warns, and the decision is a unit-tested pure function.
- Removed state and exports that nothing read: `orchestration.startedAt` and
  `remainingCooldownMs`.
- Documentation corrections: SPEC §10 no longer lists the removed knob or the
  wrong defaults for the two intentionally-unset legacy leaves; SPEC §2 and §4
  agree that a hold **breaks** the streak; telemetry scope is the routed
  top-level agent, not "every message"; the ROADMAP no longer claims rounds
  settle on result (they settle on dispatch, deliberately); the README backoff
  ladder is 1m → 4m → 16m → 1h04m → 4h16m → 6h, not "1h"; `SPEC.md`,
  `ROADMAP.md` and `ALIGNMENT.md` now ship in the npm tarball instead of being
  linked from the README but absent from the package.

The review also proved two boundaries were held by the code but not by the
suite (`pSmart >= θ` and the inclusive idle gate); both now have equality tests.
Re-running the review's mutations against the updated suite: **11/11 caught**.

### Migration

Schemastery passes unknown keys through, so removals are inert leftovers rather
than load failures. Meaning changes are the ones to watch:

| Key | Before | Now |
|---|---|---|
| `routing.window.threshold` | the downgrade bar | **legacy** raw-θ override; the old default `0.6` is inert, only a different value is honoured (and flagged `⚠ legacy` in `/router status`) |
| `routing.cacheAware.sameFamilyThreshold` | the raised downgrade bar | **legacy** sentinel: a non-default value implies `sameFamilyPenalty = 3.0`; the old default `0.9` is inert |
| `orchestration.requireSmartModel` | could force orchestration without a resolvable Smart model | removed (ignored) |
| `failover.speedWindowSize` | TPS window size | removed (ignored) |

To migrate deliberately: set `routing.economics.mode` (or `reworkPenalty`) and
leave `routing.window.threshold` unset.

### Documentation

- Added [`SPEC.md`](SPEC.md) — the normative contract (decision pipeline, EV
  rule, decision memory, cache-aware routing, Judge contract, failover
  signatures, orchestration, config reference, commands, gates).
- Added [`ALIGNMENT.md`](ALIGNMENT.md) — the upstream alignment audit and
  prioritised work list.
- `ROADMAP.md`: retired the "v0.x maps one-to-one" note, recorded the port
  baseline (upstream v1.0.0) and the alignment target (v1.6.0), and added an
  upstream-version alignment table.

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

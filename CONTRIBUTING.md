# Contributing to dsh-shift-router

Thanks for considering a contribution! This project is a **DeepSeek Harness (DSH) plugin**
adapted from [pi-shift-router](https://github.com/green-dalii/pi-shift-router): the routing
*semantics* stay compatible with the original, but the *integration surface* is DSH-native
(Cordis plugin + a browser-side settings card). A lot of "it doesn't work" moments in this
codebase come from DSH's load/cache model, so read [The DSH dev loop](#the-dsh-dev-loop)
before touching anything.

## Setup

```sh
npm install
npm run typecheck      # both programs: host (tsconfig.json) + client (tsconfig.client.json)
npm test               # vitest
npm run build          # host tsc → client tsc → tsdown client bundle
npm run test:e2e       # scratch DSH_HOME → install → boot → route (no credentials)
```

Two rules that exist because breaking them once shipped a plugin that could not load:

- **A service is read either through `inject` or through a probe.** `ctx.<name>` for an
  undeclared service throws `cannot get property "…" without inject` while that service is
  absent — including the window in which a sibling row is still mounting — and because the
  read is inside `apply`, the throw aborts the whole DSH boot. Optional services go through
  `ctx.get('<name>')` or `ctx.inject([...], cb)`. A cast (`ctx as unknown as {…}`) does not
  make it legal; `tests/plugin-load.test.ts` loads the plugin against a real context
  precisely so this fails in milliseconds instead of in a user's terminal.
- **Platform constants are not guessed.** `ctx.systemPrompt.getSectionOrder(name)` returns
  `undefined` for names outside the platform's `SECTION_ORDERS`, and `section()` throws on a
  non-finite order — the same boot-abort class. Deployment-varying values are config
  (`ux.promptSectionOrder`).

The package is **dual-face**:

- **Host half** (`src/*.ts`) — the Cordis plugin (`name: 'shift-router'`, `apply(ctx, config)`),
  all DSH wiring: `agent/pre-step`, `agent/request`, `agent/request-error`, `session/event`,
  `systemPrompt.section`/`.variable`, the `shift-router` settings namespace, `/router` commands.
- **Client half** (`src/client/*`) — the browser settings card, discovered through the
  `dsh.client` manifest in `package.json` and served as a CJS closure-factory bundle
  (`dist/client.js`) by tsdown (`tsdown.config.ts`, `deps.neverBundle` keeps the host
  runtime/react requires external).

Pure logic (router / failover / judge / orchestrate / audit / notices / stats, the form model,
the card-UX derivations, the catalog loader) lives in dependency-free modules with unit tests;
only DSH-facing glue goes into `index.ts`.

## Repository layout

The authoritative map of the code (README keeps only a pointer here):

```
src/
├── index.ts        # plugin entry: event wiring, per-agent state, judge, route notices
├── config.ts       # Schemastery schema + deep-merge normalization
├── types.ts        # shared types + defaults
├── router.ts       # pure routing engine (upgrade/downgrade/window/cache-aware)
├── judge.ts        # LLM Judge via ctx.llm.stream() + reply parsing
├── failover.ts     # exponential-backoff cooldown state machine
├── tier.ts         # tier model resolution + display
├── notice.ts       # pure: route-notice text + summary (SPEC §13.1)
├── orchestrate.ts  # orchestrator prompt + lifecycle + caps
├── audit.ts        # non-blocking acceptance audit of delegated runs
├── stats.ts        # telemetry snapshot (tokens / cost estimate / savings baseline)
├── commands.ts     # /router and /route-force
└── client/         # browser half (GUI settings card)
    ├── index.tsx       # client entry: registers into the settings.plugin.item slot
    ├── controller.ts   # staged form → settings-scope writes (one per section)
    ├── form-model.ts   # pure logic: field registry / draft parsing / save plan
    ├── card-ux.ts      # pure logic: thresholds, chain problems, header summary
    ├── model-catalog.ts# Host model catalog → provider/model options
    ├── ShiftRouterCard.tsx  # card component (DSW design tokens)
    └── locales.ts      # zh/en dictionaries
```

Pure logic (router / failover / judge / orchestrate / audit / notices / stats, the form model,
the card-UX derivations, the catalog loader) lives in dependency-free modules with unit tests;
only DSH-facing glue goes into `index.ts`. `tests/` mirrors that split, and `e2e/` boots scratch
profiles (see the browser check and the e2e notes below).

## Documentation ownership

Seven documents, seven jobs. A fact belongs to exactly one of them; the others link to it. This
table IS the rule — if you are unsure where something goes, it goes where the table says.

| Document | Owns | Must not contain |
|---|---|---|
| `README.md` / `README.zh-CN.md` | what a user does: install, configure, commands, examples, badges | normative rules; per-round rationale; the repository map |
| `docs/MODELS.md` / `.zh-CN.md` | guidance for *choosing* tier models, with sources and dates | claims about which models your deployment can call (the runtime catalog owns that) |
| `SPEC.md` | the normative contract: rules, mechanisms, gates | history, rationale, measurements, per-round narrative |
| `ALIGNMENT.md` | the audit: evidence, decisions, deliberate divergences, residual uncertainty | normative rules; status tables |
| `ROADMAP.md` | status and history: released versions, upstream alignment, what is planned | rationale detail; measurement numbers |
| `CHANGELOG.md` | per-version change lists (Keep a Changelog) | narrative; design argument |
| `CONTRIBUTING.md` | contributor workflow: dev loop, repository layout, gates, distribution, release | user-facing how-to |

Both README languages are one document in two languages: a change to one is a change to the other
in the same commit.

## The DSH dev loop

Two different change kinds have two different apply times:

### 1. Config changes — live, no restart

- **Settings namespace** (`/router config`, the GUI card, `settings.yaml`) — applies live;
  the router re-reads on every `scope.watch()` tick.
- **Profile patch edits** (`cordis.patch.yml`) — hot via the shared HMR row **when the web
  profile has it enabled** (`- id: hmr, disabled: false` in `~/.dsh/profiles/web/cordis.patch.yml`).
  The affected plugin's `apply()` re-runs with the new config, no restart.

### 2. Code changes — build + restart required

- **Host code** (`src/*.ts`): `npm run build`, then restart the profile.
- **Client code** (`src/client/*`): `npm run build` (the tsdown step), then **restart**.
  The browser bundle's *content* and the package *metadata* (`dsh.client` manifest) are
  cached in-process — bundle changes reach the served graph only through
  `ClientModuleRegistry.rebuilt`, i.e. on restart. There is **no client HMR** for this plugin.
- The plugin mounts by **package name** (`dsh-shift-router`), normally as a `link:` dependency
  of the profile (`dsh plugin --profile web add /path/to/dsh-shift-router`). A rebuild in the
  project directory is picked up by the next restart — no reinstall needed. A source-checkout
  patch row (`name: '/path/dist/index.js'`) works for the host half but does **not** serve the
  client card (the client-modules scan resolves package names only).

## Browser check (the card)

There is no DOM in the unit suite, and two defects shipped that only a layout
engine could see: the card registered into the wrong slot (invisible) and a model
row's badge covered its select. `e2e/browser-check.mjs` is the check that would
have caught the second one — it drives a real Chromium against a scratch profile
and asserts what a browser alone can answer:

- the card renders in Settings → Plugins → Plugin configuration and expands;
- **zero** bounding-box overlaps among the card's innermost visible elements
  (this is the layout gate: a fixed track around variable content, or an overlay
  over a native control, shows up here as an intersection);
- the deployment's providers actually reach the provider dropdown (the catalog
  loaded, end to end);
- the *Advanced* section starts collapsed and its controls appear when expanded.

```sh
npm i -D playwright-core            # or point PLAYWRIGHT_CORE at an existing copy
node e2e/browser-check.mjs          # scratch profile, screenshots under /tmp
node e2e/browser-check.mjs --url '<token url>'   # an already-running server
node e2e/browser-check.mjs --keep   # keep the scratch home for inspection
```

It is deliberately **not** part of `npm test` / `npm run test:e2e`: those must run
without a browser. Run it whenever you touch `ShiftRouterCard.tsx`, and look at
the screenshots it writes (light and dark themes both matter).

`e2e/fake-adapter.mjs` is the credential-free LLM adapter used by the headless router
e2e. Run it with `npm run test:e2e` (`e2e/run-e2e.mjs`): it creates a scratch `DSH_HOME`,
installs this checkout as a bundle, and runs three turns — the current config, the
pre-alignment shape (`e2e/legacy-config-overlay.yml`, i.e. the upgrade path), and the
**default** orchestration mode with the web-only `subagent-model-selection-settings` row
mounted (`e2e/orchestration-overlay.yml`). It asserts the model switch, that no row failed
to apply, that the routed turn carried the `[shift-router]` notice into the model request
(`notice=yes`), the settings round-trip, and that the Host model catalog advertises the
configured routes. Treat a red e2e as a release blocker — it is the only check that proves
the plugin loads and routes on a real harness.

`npm run test:e2e` also packs the package and boots the PACKED artifact in a
second scratch profile. That step is the install-time contract: the tarball ships no
harness package of its own (they are `peerDependencies` the deployment provides), so a
runtime import that is dev-only — or a shipped path missing from `files` — fails there
rather than in a user's install. `tests/packaged-install.test.ts` is the fast half of the
same gate.

Never pin `orchestration.mode: off` in a fixture to make an assertion simpler: the default is
`auto`, and a suite that only ever runs `off` cannot see the default path. That is exactly how
a boot-aborting defect shipped once. `--dump-config` is not a substitute either — it composes
configuration without instantiating a single plugin.

For the GUI card, the model dropdowns only show providers that currently advertise models
(`llm.models`), so a scratch profile with no registered adapter falls back to free-text
rows — that is expected, not a bug. To exercise the dropdowns, mount a small adapter that
calls `ctx.llm.registerAdapter(['some-provider'], adapter)` with `listModels`/`resolveModel`
implemented (see the fixture shape in `e2e/fake-adapter.mjs`).

## Guidelines

1. **Behavior parity with pi-shift-router where it makes sense** — but when DSH's mechanism
   differs (subagent tool, settings, events, GUI), prefer the DSH-native behavior and
   document it.
2. **Pure logic stays pure.** New routing/failover/judge behavior goes into the pure modules
   with unit tests; only DSH-facing glue goes into `index.ts`.
3. **Config changes go through the schema.** Anything two deployments may set differently
   must be a `Config` field (see `src/config.ts`), never a hardcoded constant.
4. **Keep the two field registries in sync.** `CARD_FIELDS` (GUI card) and `CONFIG_FIELDS`
   (`/router config`) are shape-parity twins; the parity tests in `tests/client-form.test.ts`
   fail if a scalar leaf drifts.
5. **React style values are unitless multipliers, not pixels.** In the card's inline styles,
   `lineHeight: 17` means `17 × font-size` (React does not append `px` to `lineHeight`) — a
   ported `17px` from native CSS balloons to ~187px. Always write unitless multipliers
   (`1.2`/`1.3`) or explicit `px` strings.
6. **Never re-spell a host contract.** Import it type-only from its declarer (SPEC §12.1) — for the
   card that means `SlotMap['settings.plugin.item']` comes from
   `@deepseek-ai/dsh-client-ui-settings-plugins`, and the registration passes `key: 'shift-router'`
   (the settings namespace), never `id`. `tests/client-card-slot.test.ts` guards it against the real
   `SlotCore`.
7. **Never guess a platform API — read the caller that already works.** The card's model list comes
   from `ctx.remote.session.modelCatalog()` (the `/model` selector's remote), and a wrong guess there
   fails *silently*: the control degrades to a text box and nothing goes red (ALIGNMENT §R7). When
   adding a card control backed by host data, copy the call from the DSH package that owns the
   surface, then pin the response shape in a test.
8. Run `npm run typecheck && npm test && npm run build && npm run test:e2e` before opening a
   PR; verify the card in the browser e2e above for layout regressions (light and dark themes).
9. **User-visible host text names the plugin.** A message the plugin writes into a session must
   start with `[shift-router]`: the `source.plugin` field is durable but the Chat client never
   renders it, so an unlabelled one-liner reads as harness output (SPEC §13.1, ALIGNMENT §R9).

## Distribution

The package is a DSH **bundle** (`dsh.bundle.patch` → `cordis.patch.yml`), so
every install channel is the same call with a different spec — `dsh plugin
--profile <name> add …` forwards to pnpm inside the profile directory:

| Channel | Spec | Build script on the user's machine? |
|---|---|---|
| npm (recommended) | `dsh-shift-router` | no — the registry holds the built artifact |
| tarball | `./dsh-shift-router-0.6.0.tgz` | no |
| git | `github:green-dalii/dsh-shift-router#v0.6.0` | **yes** — `prepare` runs, and pnpm ≥ 10 needs the user to allow it via the profile's `pnpm-workspace.yaml` `allowBuilds` |
| local checkout | `/path/to/checkout` | no (the contributor builds it) |

Two rules follow from that table:

- **`prepare` must stay self-contained and cheap.** It is the git path's build
  step, it runs in a stranger's tree, and a failure there is *their* install
  failing. `build` keeps the full type-checked pipeline for CI; `prepare` only
  emits artifacts. `prepublishOnly` runs the gates again before anything reaches
  a registry.
- **Harness packages are `peerDependencies`, never `dependencies`** (SPEC §1.5):
  the harness must be the only instance. Add a package to the peer list only
  when the compiled output requires it at runtime; a type-only import belongs in
  `devDependencies`.

Discovery follows the official ecosystem convention: the repository carries the
[`dsh-plugin`](https://github.com/topics/dsh-plugin) GitHub topic and the README
shows the matching badge. Community directories (dsh-plugin.org, dsh-plugin-shop)
crawl that topic and npm; nothing needs submitting to a private registry.

## Releasing

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry (Keep a Changelog).
2. Update the READMEs if user-facing behavior changed — including the test-count and
   Node badges at the top.
3. Run the gates (SPEC §14): `npm run typecheck && npm test && npm run build && npm run test:e2e`.
4. `npm pack --dry-run` and confirm `files` still ships the artifacts, the patch and the docs.
5. Publish: `npm publish` (runs `prepare`, then `prepublishOnly`), or hand out the tarball.
6. Tag the release (`git tag vX.Y.Z`) and push main + the tag — both READMEs pin the git
   install channel to `#vX.Y.Z`, so an untagged release leaves that channel broken.
7. Local review workflow: keep review-round changes as one local commit (amend while
   unpushed) and let the maintainer approve before pushing — see `ROADMAP.md`.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).

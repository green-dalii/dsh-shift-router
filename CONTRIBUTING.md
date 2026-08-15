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
```

The package is **dual-face**:

- **Host half** (`src/*.ts`) — the Cordis plugin (`name: 'shift-router'`, `apply(ctx, config)`),
  all DSH wiring: `agent/pre-step`, `agent/request`, `agent/request-error`, `session/event`,
  `systemPrompt.section`/`.variable`, the `shift-router` settings namespace, `/router` commands.
- **Client half** (`src/client/*`) — the browser settings card, discovered through the
  `dsh.client` manifest in `package.json` and served as a CJS closure-factory bundle
  (`dist/client.js`) by tsdown (`tsdown.config.ts`, `deps.neverBundle` keeps the host
  runtime/react requires external).

Pure logic (router/failover/judge/orchestrate/stats, the form model, the catalog loader)
lives in dependency-free modules with unit tests; only DSH-facing glue goes into `index.ts`.

## The DSH dev loop

This is the part the template CONTRIBUTING used to get wrong. Three different change kinds
have three different apply times:

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

### 3. The settings whitelist — one-time patch + restart

Upstream `dsh-host-apiproxy` (0.1.0-rc.6) only serves settings namespaces on its hardcoded
`WEB_SETTINGS_NAMESPACES` list to the browser; `shift-router` must be added:

```sh
node scripts/expose-gui-settings.mjs --profile web   # idempotent
# then restart the profile (apiproxy is cached in-process)
```

Re-run the script after upgrading/reinstalling `dsh-host-apiproxy`.

## Manual browser E2E (the card)

There is no unit test for the DOM; the card is verified in a real browser against a scratch
profile. Recipe used for every review round:

```sh
# 1. scratch home + profile (link this project + @deepseek-ai/dsh-base + dsh-web-app)
export DSH_HOME=/tmp/scratch-home
dsh plugin --profile web-e2e add /path/to/dsh-shift-router
# 2. whitelist the namespace in the scratch profile
node scripts/expose-gui-settings.mjs --profile web-e2e --home /tmp/scratch-home
# 3. boot it
dsh --profile web-e2e web --port 3199
# 4. drive Chrome (playwright-core): Settings → Plugins → Plugin configuration →
#    expand the Shift-Router card → screenshot / edit / save → assert settings.yaml
```

`e2e/fake-adapter.mjs` is the credential-free LLM adapter used by the headless router
e2e. For the GUI card, the model dropdowns only show providers that currently advertise
models (`llm.models`), so a scratch profile with no registered adapter falls back to
free-text rows — that is expected, not a bug. To exercise the dropdowns, mount a small
adapter that calls `ctx.llm.registerAdapter(['some-provider'], adapter)` with
`listModels`/`resolveModel` implemented (see the fixture shape in `e2e/fake-adapter.mjs`).

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
6. Run `npm run typecheck && npm test && npm run build` before opening a PR; verify the card
   in the browser e2e above for layout regressions (light and dark themes).

## Releasing

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry (Keep a Changelog).
2. Update the READMEs if user-facing behavior changed.
3. Local review workflow: keep review-round changes as one local commit (amend while
   unpushed) and let the maintainer approve before pushing — see `ROADMAP.md`.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).

# Contributing to dsh-shift-router

Thanks for considering a contribution! This project is a DeepSeek Harness plugin adapted from
[pi-shift-router](https://github.com/green-dalii/pi-shift-router) — the routing *semantics* stay
compatible with the original, but the *integration surface* is DSH-native.

## Development setup

```sh
npm install
npm run build        # tsc → dist/
npm run typecheck
npm test             # vitest
```

## Project layout

- `src/router.ts`, `src/failover.ts`, `src/judge.ts`, `src/orchestrate.ts`, `src/stats.ts` — pure,
  unit-tested logic. Keep them free of DSH service access; inject dependencies (e.g. `ctx.llm`)
  from `src/index.ts`.
- `src/index.ts` — the Cordis plugin entry. All DSH wiring lives here: `agent/pre-step`,
  `agent/request`, `agent/request-error`, `session/event`, `systemPrompt.section`, settings
  namespace, commands.
- `tests/` — vitest suites for the pure logic.
- `e2e/` — credential-free integration harness: a fake LLM adapter plus a settings-persistence
  probe, driven through the `dsh-headless` profile.

## Guidelines

1. **Behavior parity with pi-shift-router where it makes sense** — but when DSH's mechanism
   differs (subagent tool, settings, events), prefer the DSH-native behavior and document it.
2. **Pure logic stays pure.** New routing/failover/judge behavior goes into the pure modules
   with unit tests; only DSH-facing glue goes into `index.ts`.
3. **Config changes go through the schema.** Anything two deployments may set differently must be
   a `Config` field (see `src/config.ts`), never a hardcoded constant.
4. Run `npm run typecheck && npm test` before opening a PR.

## E2E check

```sh
# scratch profile: this bundle + @deepseek-ai/dsh-headless
dsh --profile <tmp> --patch e2e/overlay.yml "design a migration plan"
# expect: ROUTER-E2E: turn ran on fake/fake-smart
```

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).

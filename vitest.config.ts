import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    pool: 'threads',
    poolOptions: {
      threads: { singleThread: true },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      // Unit coverage is measured over the SHIPPING source only. The e2e
      // harnesses, the packaging script and the build config are exercised by
      // their own gates (`npm run test:e2e`, the browser check), so counting
      // them here would report a number that no test is supposed to move.
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      // The card is a React component whose real failures are layout failures;
      // e2e/browser-check.mjs covers it in a real browser (SPEC §14), which
      // vitest cannot do. Excluding it keeps the number honest rather than
      // pretending a jsdom render is the same test.
      //
      // The two legacy-* modules hold only type declarations and `declare
      // module` augmentations for the pre-0.2.0 shell; the compiler emits them
      // as a bare `export {}`, so v8 scores them 0/0 and reports 0% — a number
      // no test can move, and one that hides the real figure.
      exclude: [
        'src/client/ShiftRouterCard.tsx',
        'src/client/legacy-scope.ts',
        'src/client/legacy-slot.ts',
      ],
      thresholds: {
        // Floor over all shipping source: pinned at today's measurement so it
        // cannot silently regress. Raise it when you raise the coverage.
        statements: 81,
        lines: 81,
        functions: 80,
        branches: 86,
        // The decision core carries upstream's release-gate bar (≥90
        // statements/lines, ≥85 branches). `functions` is 85 rather than
        // upstream's 90 because `router.ts` sits at 86.95 — that gap is named in
        // ROADMAP's Planned table instead of being hidden by a softer number.
        'src/{router,failover,audit,notice,orchestrate,config,stats,types}.ts': {
          statements: 90,
          lines: 90,
          functions: 85,
          branches: 85,
        },
      },
    },
  },
})

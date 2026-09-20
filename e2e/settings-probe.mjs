/**
 * Settings probe for the dsh-shift-router e2e test.
 *
 * Runs inside apply() (keeping the Cordis fiber context), polls until the
 * shift-router settings namespace is registered, writes through it, and
 * verifies the write is visible on a re-resolved scope (i.e. the namespace is
 * live, not a snapshot).
 *
 * Idempotent on purpose: the probe picks a value DIFFERENT from the current
 * one instead of a fixed 7777, so re-running the e2e against a profile that
 * already carries a previous run's write still proves the round-trip. (A fixed
 * target made the second run report `before=7777 after=7777` — a false
 * failure.) The chosen value alternates between two values so repeated runs
 * keep exercising both directions.
 *
 * Set `SHIFT_ROUTER_E2E_PROBE_OUT` to change the result file location.
 */

import { writeFileSync } from 'node:fs'

export const name = 'settings-probe'
export const inject = ['settings']

// Plain literal: `settingsNamespace()` was removed in dsh-settings 0.1.5.
const NS = 'shift-router'
const OUT = process.env.SHIFT_ROUTER_E2E_PROBE_OUT ?? '/tmp/dsh-settings-probe.json'

/** Two alternating targets so consecutive runs always change the value. */
const TARGETS = [7777, 7778]

export async function apply(ctx) {
  const result = { ok: false, detail: '' }
  try {
    // Poll for the shift-router namespace (sibling mount order is concurrent).
    const deadline = Date.now() + 10_000
    let registered = false
    while (Date.now() < deadline) {
      try {
        if (ctx.settings.get(NS) !== undefined) {
          registered = true
          break
        }
      } catch {
        // not registered yet — retry
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    if (!registered) {
      result.detail = 'namespace never registered'
    } else {
      const before = ctx.settings.get(NS)
      const beforeTimeout = before?.routing?.judgeTimeout
      const target = TARGETS.find((value) => value !== beforeTimeout) ?? TARGETS[0]

      await ctx.settings.update(NS, { routing: { judgeTimeout: target } })

      // Re-read through the service (not the earlier snapshot) to prove the
      // write is observable on a re-resolved scope.
      const afterTimeout = ctx.settings.get(NS)?.routing?.judgeTimeout
      result.ok = afterTimeout === target && afterTimeout !== beforeTimeout
      result.detail = `before=${beforeTimeout} after=${afterTimeout} target=${target}`
    }
  } catch (error) {
    result.detail = `error: ${error?.message ?? String(error)}`
  }
  writeFileSync(OUT, JSON.stringify(result, null, 2))
  ctx.logger.warn(`[settings-probe] ${result.ok ? 'OK' : 'FAILED'} ${result.detail}`)
}

/**
 * Settings probe for the dsh-shift-router e2e test.
 *
 * Runs inside apply() (keeping the Cordis fiber context), polls until the
 * shift-router settings namespace appears in the Host's settings document,
 * writes through it, and verifies the write is visible on a re-read (i.e. the
 * namespace is live, not a snapshot).
 *
 * The namespace IS the loader entry id, and `@deepseek-ai/dsh-settings`
 * 0.2.0-rc.2 owns it through `SettingsForms.describe()/update()`: the
 * per-namespace `get()` binder that this probe used to call is gone (only
 * `describe()` reports values, and `update` needs the entry id).
 *
 * Idempotent on purpose: the probe picks a value DIFFERENT from the current
 * one instead of a fixed 7777, so re-running the e2e against a profile that
 * already carries a previous run's write still proves the round-trip. (A fixed
 * target made the second run report `before=7777 after=7777` — a false
 * failure.) The chosen value alternates between two values so repeated runs
 * keep exercising both directions.
 *
 * It also reads the Host model catalog the card's dropdowns come from
 * (`buildModelCatalog`, the `/model` selector's own builder) and records the
 * routes it advertises, so the e2e can assert the deployment actually answers.
 *
 * Set `SHIFT_ROUTER_E2E_PROBE_OUT` to change the result file location.
 */

import { writeFileSync } from 'node:fs'

export const name = 'settings-probe'
// `llm` is what the Host catalog builder reads; the probe injects it rather
// than borrowing a context that happens to have it.
export const inject = ['settings', 'llm']

/** How long to wait for the namespace to appear in the Host settings document. */
const REGISTRATION_BUDGET_MS = 10_000

// The loader entry id, which is the settings namespace since 0.2.0-rc.2.
const NS = 'shift-router'

/** The namespace's descriptor in the Host settings document, or undefined. */
function descriptorOf(ctx) {
  return ctx.settings.describe({}).find((row) => row.ns === NS)
}
const OUT = process.env.SHIFT_ROUTER_E2E_PROBE_OUT ?? '/tmp/dsh-settings-probe.json'
/**
 * Read the served `shift-router` namespace and record what the Host reports.
 *
 * READ-ONLY on purpose. This probe used to write the namespace, and that write
 * deadlocks a boot: the settings document IS the profile patch, so a write
 * re-composes the Loader tree — and the write is issued from inside the tree
 * that the re-composition is waiting to replace. The boot never settles, the
 * turn never starts, and the process ends up idle in `uv__io_poll` with no
 * output at all (ALIGNMENT §R15.9).
 *
 * The write path is therefore verified where it can run to completion: the
 * browser check saves a field on a real serving Host and reads the value back
 * from the profile patch. What this probe owns is the contract the CARD needs
 * from the Host — that the namespace is served, that it projects a form, and
 * that the served values are the composed ones.
 *
 * It also reads the Host model catalog the card's dropdowns come from
 * (`buildModelCatalog`, the `/model` selector's own builder) and records the
 * routes it advertises, so the e2e can assert the deployment actually answers.
 *
 * Set `SHIFT_ROUTER_E2E_PROBE_OUT` to change the result file location.
 */

export async function apply(ctx) {
  const result = { ok: false, detail: '', models: [], failures: [], served: false, tiers: [] }
  try {
    // Poll for the shift-router namespace (sibling mount order is concurrent).
    const deadline = Date.now() + REGISTRATION_BUDGET_MS
    let row = descriptorOf(ctx)
    while (row === undefined && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      row = descriptorOf(ctx)
    }
    if (row === undefined) {
      result.detail = 'namespace never appeared in the Host settings document'
    } else {
      result.served = true
      const value = row.value
      result.tiers = [
        `${value?.tiers?.fast?.models?.[0]?.provider}/${value?.tiers?.fast?.models?.[0]?.model}`,
        `${value?.tiers?.smart?.models?.[0]?.provider}/${value?.tiers?.smart?.models?.[0]?.model}`,
      ]
      // The overlay sets these; a Host that serves the namespace but not the
      // composed values is exactly the failure the card would show as empty
      // selects.
      result.ok = result.tiers[0] === 'fake/fake-fast' && result.tiers[1] === 'fake/fake-smart'
      result.detail = `ns=${row.ns} revision=${row.revision} tiers=${result.tiers.join(' ')}`

      // The card's dropdowns are fed by the Host generation catalog — the same
      // builder the `/model` selector reads. Prove the deployment answers with
      // the configured routes, so an empty catalog is caught here rather than by
      // a user staring at an empty select (ALIGNMENT §R7).
      try {
        const { buildModelCatalog } = await import('@deepseek-ai/dsh-api-session-controller')
        // The builder defaults this argument to `ctx.agentDefaultModel`, a
        // service this probe does not inject (reading it undeclared is the trap
        // that once aborted a boot). Pass the deployment's selection when it is
        // present; the fixture's own Smart route is only echoed into `default`.
        const defaults = ctx.get('agentDefaultModel')?.currentSelection?.()
        const catalog = await buildModelCatalog(ctx, defaults ?? { provider: 'fake', model: 'fake-smart' })
        result.models = catalog.groups.flatMap((group) =>
          group.models.map((model) => `${group.id}/${model.id}`),
        )
        result.failures = catalog.failures.map((failure) => `${failure.id}: ${failure.message}`)
      } catch (error) {
        result.ok = false
        result.detail += ` | catalog: ${error?.message ?? String(error)}`
      }
    }
  } catch (error) {
    result.ok = false
    result.detail = `error: ${error?.message ?? String(error)}`
  }
  writeFileSync(OUT, JSON.stringify(result, null, 2))
  ctx.logger.warn(`[settings-probe] ${result.ok ? 'OK' : 'FAILED'} ${result.detail}`)
}

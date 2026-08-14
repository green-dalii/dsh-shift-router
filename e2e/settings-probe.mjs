/**
 * Settings probe for the dsh-shift-router e2e test.
 * Runs inside apply() (keeping the Cordis fiber context), polls until the
 * shift-router settings namespace is registered, updates it, and verifies the
 * write is visible (scope re-resolution + persistence to settings.yaml).
 */

import { writeFileSync } from 'node:fs'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

export const name = 'settings-probe'
export const inject = ['settings']

const NS = settingsNamespace('shift-router')

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
      await ctx.settings.update(NS, { routing: { judgeTimeout: 7777 } })
      const after = ctx.settings.get(NS)
      const afterTimeout = after?.routing?.judgeTimeout
      result.ok = afterTimeout === 7777 && beforeTimeout !== 7777
      result.detail = `before=${beforeTimeout} after=${afterTimeout}`
    }
  } catch (error) {
    result.detail = `error: ${error?.message ?? String(error)}`
  }
  writeFileSync('/tmp/dsh-settings-probe.json', JSON.stringify(result, null, 2))
  ctx.logger.warn(`[settings-probe] ${result.ok ? 'OK' : 'FAILED'} ${result.detail}`)
}

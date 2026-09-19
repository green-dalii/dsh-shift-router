/**
 * dsh-shift-router — Config schema tests
 *
 * The schema must (a) resolve an empty/partial config to complete safe
 * defaults, and (b) reject invalid numeric values loudly so bad configuration
 * fails at load instead of silently misbehaving.
 */

import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.js'

type StandardResult =
  | { value: unknown }
  | { issues: { message: string }[] }

function validate(value: unknown): StandardResult {
  return (Config as unknown as { '~standard': { validate(v: unknown): StandardResult } })['~standard'].validate(value)
}

describe('Config schema', () => {
  it('resolves an empty config to complete defaults', () => {
    const out = validate({})
    expect('issues' in out).toBe(false)
    const cfg = (out as { value: Record<string, unknown> }).value
    expect(cfg.enabled).toBe(true)
    expect(cfg.routing).toMatchObject({
      mode: 'auto',
      judgeTimeout: 5000,
      judgeMaxTokens: 4000,
      judgePromptCap: 6000,
    })
    expect(cfg.routing.economics).toMatchObject({ reworkPenalty: 3, downgradeMemory: 2 })
    // The legacy θ override ships unset: writing the legacy default back must
    // not look like a deliberate override (SPEC §3.1).
    expect(cfg.routing.window).toMatchObject({ size: 5, minConfidence: 0.5 })
    expect(cfg.routing.window.threshold).toBeUndefined()
    expect(cfg.routing.cacheAware).toMatchObject({ enabled: true, sameFamilyPenalty: 1.5 })
    expect(cfg.routing.cacheAware.sameFamilyThreshold).toBeUndefined()
    expect(cfg.failover).toMatchObject({ baseMs: 60_000, maxMs: 6 * 60 * 60_000, startAttempts4xx: 3 })
    expect(cfg.telemetry).toMatchObject({ callLogCap: 1000 })
    expect(cfg.tiers.fast).toMatchObject({ label: '', models: [] })
    expect(cfg.tiers.smart).toMatchObject({ label: '', models: [] })
    expect(cfg.ux).toMatchObject({ routerLogVerbose: false })
    expect(cfg.orchestration).toMatchObject({ mode: 'auto', maxRounds: 3, escalationThreshold: 2 })
    expect(cfg.pricing).toEqual([])
  })

  it('resolves a partial nested config with leaf defaults', () => {
    const out = validate({ routing: { judgeTimeout: 8000 } })
    expect('issues' in out).toBe(false)
    const cfg = (out as { value: Record<string, unknown> }).value
    expect(cfg.routing.judgeTimeout).toBe(8000)
    expect(cfg.routing.judgeMaxTokens).toBe(4000)
    expect(cfg.routing.window.size).toBe(5)
  })

  it('no longer carries the removed orchestration knob', () => {
    const out = validate({})
    const cfg = (out as { value: Record<string, unknown> }).value
    expect(cfg.orchestration).not.toHaveProperty('requireSmartModel')
  })

  it('loads a pre-alignment config document without failing (removals stay inert)', () => {
    // Users upgrading from v0.5.0 have these keys persisted. Schemastery
    // passes unknown keys through rather than rejecting them, so removing a
    // key is a silent no-op and never a load failure (SPEC §15). The stale
    // value may survive in the resolved object — nothing reads it, which is
    // what "removed" means here.
    const out = validate({
      orchestration: { mode: 'auto', maxRounds: 5, escalationThreshold: 2, requireSmartModel: false },
      failover: { speedWindowSize: 9 },
      // The pre-EV legacy values must load too, and stay inert (SPEC §3.1).
      routing: { window: { size: 5, threshold: 0.6, minConfidence: 0.5 } },
    })
    expect('issues' in out).toBe(false)
    const cfg = (out as { value: Record<string, unknown> }).value
    // Live fields still take the user's values …
    expect((cfg.orchestration as Record<string, unknown>).maxRounds).toBe(5)
    expect((cfg.routing as Record<string, unknown>).window).toMatchObject({ size: 5 })
    // … and the resolved defaults never reintroduce a removed key.
    const fresh = (validate({}) as { value: Record<string, unknown> }).value
    expect(fresh.orchestration).not.toHaveProperty('requireSmartModel')
    expect(fresh.failover).not.toHaveProperty('speedWindowSize')
  })

  it('rejects invalid numeric values loudly', () => {
    const bad: unknown[] = [
      { routing: { judgeTimeout: 0 } },
      { routing: { judgeTimeout: -1 } },
      { routing: { window: { size: 0 } } },
      { routing: { window: { size: 2.5 } } },
      { routing: { window: { threshold: 1.5 } } },
      { routing: { window: { minConfidence: -0.1 } } },
      { routing: { economics: { reworkPenalty: 0 } } },
      { routing: { economics: { downgradeMemory: 0 } } },
      { routing: { economics: { mode: 'turbo' } } },
      { routing: { cacheAware: { sameFamilyPenalty: 0.5 } } },
      { routing: { cacheAware: { sameFamilyThreshold: 2 } } },
      { tiers: { fast: { models: [{ provider: 'p', model: 'm', priority: -1 }] } } },
      { orchestration: { maxRounds: -1 } },
      { orchestration: { escalationThreshold: 0 } },
      { failover: { baseMs: 0 } },
      { telemetry: { callLogCap: 1 } },
      { routing: { mode: 'sideways' } },
    ]
    for (const input of bad) {
      const out = validate(input)
      expect('issues' in out, `expected rejection for ${JSON.stringify(input)}`).toBe(true)
    }
  })

  it('accepts boundary-valid values', () => {
    const good: unknown[] = [
      { routing: { judgeTimeout: 1 } },
      { routing: { window: { size: 1, threshold: 0, minConfidence: 1 } } },
      { routing: { economics: { reworkPenalty: 1, downgradeMemory: 1, mode: 'sport' } } },
      { routing: { cacheAware: { sameFamilyPenalty: 1 } } },
      { orchestration: { maxRounds: 0 } },
      { orchestration: { escalationThreshold: 1 } },
      { telemetry: { callLogCap: 10 } },
      { failover: { baseMs: 100, startAttempts4xx: 1 } },
    ]
    for (const input of good) {
      const out = validate(input)
      expect('issues' in out, `expected acceptance for ${JSON.stringify(input)}`).toBe(false)
    }
  })
})

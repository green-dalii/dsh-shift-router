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
    expect(cfg.routing.window).toMatchObject({ size: 5, threshold: 0.6, minConfidence: 0.5 })
    expect(cfg.failover).toMatchObject({ baseMs: 60_000, maxMs: 6 * 60 * 60_000, startAttempts4xx: 3, speedWindowSize: 5 })
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

  it('rejects invalid numeric values loudly', () => {
    const bad: unknown[] = [
      { routing: { judgeTimeout: 0 } },
      { routing: { judgeTimeout: -1 } },
      { routing: { window: { size: 0 } } },
      { routing: { window: { size: 2.5 } } },
      { routing: { window: { threshold: 1.5 } } },
      { routing: { window: { minConfidence: -0.1 } } },
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

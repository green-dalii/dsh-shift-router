/**
 * dsh-shift-router — failover tests
 */

import { describe, expect, it } from 'vitest'
import {
  COOLDOWN_BASE_MS,
  COOLDOWN_MAX_MS,
  clearModelCooldown,
  cooldownPredicate,
  createCooldowns,
  detectFailoverError,
  findFailoverModel,
  findTierForModel,
  formatRemaining,
  isModelInCooldown,
  markModelFailed,
  modelKey,
  recordSpeed,
  remainingCooldownMs,
  tokensPerSecond,
} from '../src/failover.js'
import type { LlmFailure } from '@deepseek-ai/dsh-llm'
import { DEFAULT_CONFIG, type ShiftRouterConfig } from '../src/types.js'

function makeConfig(): ShiftRouterConfig {
  return structuredClone(DEFAULT_CONFIG)
}

describe('cooldown backoff', () => {
  it('applies exponential backoff 1m → 4m → 16m → capped at 6h', () => {
    const c = createCooldowns()
    const now = 0
    markModelFailed(c, 'p', 'm', now)
    expect(c.get('p/m')!.until).toBe(COOLDOWN_BASE_MS)
    markModelFailed(c, 'p', 'm', now + COOLDOWN_BASE_MS)
    expect(c.get('p/m')!.until).toBe(COOLDOWN_BASE_MS + COOLDOWN_BASE_MS * 4)
    markModelFailed(c, 'p', 'm', now + COOLDOWN_BASE_MS * 5)
    expect(c.get('p/m')!.until).toBe(COOLDOWN_BASE_MS * 5 + COOLDOWN_BASE_MS * 16)
  })

  it('starts 4xx failures at 16m', () => {
    const c = createCooldowns()
    markModelFailed(c, 'p', 'm', 0, '429')
    expect(c.get('p/m')!.until).toBe(COOLDOWN_BASE_MS * 16)
  })

  it('caps backoff at 6h', () => {
    const c = createCooldowns()
    let t = 0
    let prev = 0
    for (let i = 0; i < 10; i++) {
      markModelFailed(c, 'p', 'm', t)
      const entry = c.get('p/m')!
      prev = t
      t = entry.until
    }
    // The backoff DURATION is capped, even though the absolute `until` grows.
    expect(t - prev).toBeLessThanOrEqual(COOLDOWN_MAX_MS)
    expect(t - prev).toBe(COOLDOWN_MAX_MS)
  })

  it('expires and clears', () => {
    const c = createCooldowns()
    markModelFailed(c, 'p', 'm', 0)
    expect(isModelInCooldown(c, 'p', 'm', 1000)).toBe(true)
    expect(isModelInCooldown(c, 'p', 'm', COOLDOWN_BASE_MS + 1)).toBe(false)
    expect(remainingCooldownMs(c, 'p', 'm', 1000)).toBe(COOLDOWN_BASE_MS - 1000)
    clearModelCooldown(c, 'p', 'm')
    expect(isModelInCooldown(c, 'p', 'm', 0)).toBe(false)
  })
})

describe('cooldownPredicate', () => {
  it('returns undefined for an empty map (fast path)', () => {
    expect(cooldownPredicate(createCooldowns(), Date.now())).toBeUndefined()
  })

  it('filters models in cooldown', () => {
    const c = createCooldowns()
    markModelFailed(c, 'p', 'm', 0)
    const pred = cooldownPredicate(c, 1000)!
    expect(pred('p', 'm')).toBe(true)
    expect(pred('p', 'other')).toBe(false)
  })
})

describe('detectFailoverError', () => {
  it('recognizes DSH canonical codes', () => {
    expect(detectFailoverError({ message: 'rate limited', code: 'RATE_LIMIT' })?.code).toBe('RATE_LIMIT')
    expect(detectFailoverError({ message: 'server error', code: 'SERVER' })?.code).toBe('SERVER')
    expect(detectFailoverError({ message: 'quota', code: 'QUOTA' })?.code).toBe('QUOTA')
  })

  it('recognizes HTTP status on the failure', () => {
    expect(detectFailoverError({ message: 'x', code: 'X', status: 429 })?.code).toBe('429')
    expect(detectFailoverError({ message: 'x', code: 'X', status: 503 })?.code).toBe('503')
    expect(detectFailoverError({ message: 'x', code: 'X', status: 400 })).toBeNull()
  })

  it('recognizes message keywords', () => {
    expect(detectFailoverError({ message: 'Too many requests, slow down', code: 'UNKNOWN' })?.code).toBe('429')
    expect(detectFailoverError({ message: 'insufficient_quota', code: 'UNKNOWN' })?.code).toBe('429')
    expect(detectFailoverError({ message: 'HTTP 502 from upstream', code: 'UNKNOWN' })?.code).toBe('502')
  })

  it('returns null for auth/network/context failures', () => {
    const cases: Array<LlmFailure | null | undefined> = [
      { message: 'invalid api key', code: 'INVALID_CREDENTIAL', status: 401 },
      { message: 'fetch failed', code: 'NETWORK' },
      { message: 'context length exceeded', code: 'CONTEXT_WINDOW_EXCEEDED' },
      { message: '', code: 'EMPTY_RESPONSE' },
      undefined,
      null,
    ]
    for (const failure of cases) {
      expect(detectFailoverError(failure)).toBeNull()
    }
  })
})

describe('findFailoverModel', () => {
  it('skips the failed model and cooldown models, staying in tier', () => {
    const cfg = makeConfig()
    cfg.tiers.fast.models = [
      { provider: 'p1', model: 'a', priority: 1 },
      { provider: 'p1', model: 'b', priority: 2 },
      { provider: 'p1', model: 'c', priority: 3 },
    ]
    const cooldowns = createCooldowns()
    markModelFailed(cooldowns, 'p1', 'b', 0)
    const available = (p: string, m: string) => ['a', 'b', 'c'].includes(m)

    const m = findFailoverModel('fast', cfg, available, cooldowns, 1000, modelKey('p1', 'a'))
    expect(m).toEqual({ provider: 'p1', modelId: 'c', tier: 'fast' })
  })

  it('returns null when the tier is exhausted', () => {
    const cfg = makeConfig()
    cfg.tiers.fast.models = [{ provider: 'p1', model: 'a', priority: 1 }]
    const cooldowns = createCooldowns()
    markModelFailed(cooldowns, 'p1', 'a', 0)
    expect(findFailoverModel('fast', cfg, () => true, cooldowns, 1000, modelKey('p1', 'a'))).toBeNull()
  })
})

describe('findTierForModel', () => {
  it('resolves the owning tier and null for ambiguous/unknown', () => {
    const cfg = makeConfig()
    cfg.tiers.fast.models = [{ provider: 'p1', model: 'a', priority: 1 }]
    cfg.tiers.smart.models = [{ provider: 'p2', model: 'b', priority: 1 }]
    expect(findTierForModel(cfg, 'p1', 'a')).toBe('fast')
    expect(findTierForModel(cfg, 'p2', 'b')).toBe('smart')
    expect(findTierForModel(cfg, 'p3', 'z')).toBeNull()
    cfg.tiers.smart.models.push({ provider: 'p1', model: 'a', priority: 2 })
    expect(findTierForModel(cfg, 'p1', 'a')).toBeNull()
  })
})

describe('helpers', () => {
  it('formats remaining cooldown', () => {
    expect(formatRemaining(0)).toBe('0s')
    expect(formatRemaining(60_000)).toBe('1m0s')
    expect(formatRemaining(3_000)).toBe('3s')
  })

  it('computes tokens per second', () => {
    expect(tokensPerSecond(100, 1000)).toBe(100)
    expect(tokensPerSecond(100, 0)).toBe(0)
    expect(tokensPerSecond(0, 1000)).toBe(0)
  })

  it('keeps a sliding speed window', () => {
    const speeds: number[] = []
    for (let i = 0; i < 8; i++) recordSpeed(speeds, i)
    expect(speeds).toHaveLength(5)
    expect(speeds[0]).toBe(3)
  })
})

describe('tunable failover policy', () => {
  it('markModelFailed honors a custom baseMs ladder', () => {
    const c = createCooldowns()
    const policy = { baseMs: 10_000, maxMs: 80_000, startAttempts4xx: 1 }
    markModelFailed(c, 'p', 'm', 0, undefined, policy)
    // 5xx start: attempt 1 → baseMs * 4^0 = 10s
    expect(c.get('p/m')!.until).toBe(10_000)
    expect(c.get('p/m')!.attempts).toBe(1)
    markModelFailed(c, 'p', 'm', 10_000, undefined, policy)
    // attempt 2 → 10s * 4 = 40s
    expect(c.get('p/m')!.until).toBe(50_000)
  })

  it('markModelFailed honors custom maxMs cap and 4xx start', () => {
    const c = createCooldowns()
    const policy = { baseMs: 100, maxMs: 1000, startAttempts4xx: 3 }
    markModelFailed(c, 'p', 'm', 0, '429', policy)
    // 4xx start at attempt 3 → 100 * 4^2 = 1600 → capped at 1000
    expect(c.get('p/m')!.until).toBe(1000)
  })

  it('recordSpeed honors a custom window size', () => {
    const speeds: number[] = []
    for (let i = 0; i < 10; i++) recordSpeed(speeds, i, 3)
    expect(speeds).toHaveLength(3)
    expect(speeds[0]).toBe(7)
  })
})

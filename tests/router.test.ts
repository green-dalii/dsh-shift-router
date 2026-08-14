/**
 * dsh-shift-router — routing engine tests
 */

import { describe, expect, it } from 'vitest'
import {
  analyzeDowngrade,
  applyModelSwitch,
  createRouterState,
  downgradeAllowedAt,
  effectiveThreshold,
  processRoute,
  shareProviderFamily,
} from '../src/router.js'
import type { JudgeResult, ShiftRouterConfig } from '../src/types.js'
import { DEFAULT_CONFIG } from '../src/types.js'

function makeConfig(overrides: Partial<ShiftRouterConfig> = {}): ShiftRouterConfig {
  const cfg = structuredClone(DEFAULT_CONFIG)
  return Object.assign(cfg, overrides)
}

/** modelAvailable: a simple registry of known "provider/model" keys. */
function registry(keys: string[]): (p: string, m: string) => boolean {
  const set = new Set(keys)
  return (p, m) => set.has(`${p}/${m}`)
}

describe('processRoute', () => {
  it('upgrades instantly when the judge says smart from the fast tier', () => {
    const cfg = makeConfig()
    cfg.tiers.fast.models = [{ provider: 'p1', model: 'fast-1', priority: 1 }]
    cfg.tiers.smart.models = [{ provider: 'p2', model: 'smart-1', priority: 1 }]
    const state = createRouterState()
    state.currentTier = 'fast'

    const judge: JudgeResult = { tier: 'smart', source: 'llm' }
    const decision = processRoute(judge, state, cfg, registry(['p1/fast-1', 'p2/smart-1']))

    expect(decision.action).toBe('upgrade')
    expect(decision.switchTo).toEqual({ provider: 'p2', modelId: 'smart-1', tier: 'smart' })
    expect(state.upgradeCount).toBe(1)
    expect(state.window).toEqual([])
  })

  it('stays on fast for a fast verdict with no downgrade pressure', () => {
    const cfg = makeConfig()
    cfg.tiers.fast.models = [{ provider: 'p1', model: 'fast-1', priority: 1 }]
    const state = createRouterState()
    state.currentTier = 'fast'

    const decision = processRoute(
      { tier: 'fast', source: 'llm' },
      state,
      cfg,
      registry(['p1/fast-1']),
    )

    expect(decision.action).toBe('stay')
    expect(decision.switchTo).toBeNull()
    expect(state.window).toHaveLength(1)
  })

  it('downgrades only after the window favors fast', () => {
    const cfg = makeConfig()
    cfg.routing.window = { size: 5, threshold: 0.6, minConfidence: 0.5 }
    cfg.tiers.fast.models = [{ provider: 'p1', model: 'fast-1', priority: 1 }]
    cfg.tiers.smart.models = [{ provider: 'p2', model: 'smart-1', priority: 1 }]
    const state = createRouterState()
    state.currentTier = 'smart'
    state.currentModelId = 'smart-1'
    state.currentProvider = 'p2'
    // 4 of the last 5 verdicts are fast → ratio 0.8 ≥ 0.6
    state.window = [
      { tier: 'smart', timestamp: 1 },
      { tier: 'fast', timestamp: 2 },
      { tier: 'fast', timestamp: 3 },
      { tier: 'fast', timestamp: 4 },
      { tier: 'fast', timestamp: 5 },
    ]

    const decision = processRoute(
      { tier: 'fast', source: 'llm' },
      state,
      cfg,
      registry(['p1/fast-1', 'p2/smart-1']),
    )

    expect(decision.action).toBe('downgrade')
    expect(decision.switchTo).toEqual({ provider: 'p1', modelId: 'fast-1', tier: 'fast' })
    expect(state.downgradeCount).toBe(1)
  })

  it('does not downgrade without a window majority', () => {
    const cfg = makeConfig()
    cfg.tiers.fast.models = [{ provider: 'p1', model: 'fast-1', priority: 1 }]
    cfg.tiers.smart.models = [{ provider: 'p2', model: 'smart-1', priority: 1 }]
    const state = createRouterState()
    state.currentTier = 'smart'
    state.window = [
      { tier: 'smart', timestamp: 1 },
      { tier: 'fast', timestamp: 2 },
      { tier: 'smart', timestamp: 3 },
    ]

    const decision = processRoute(
      { tier: 'smart', source: 'llm' },
      state,
      cfg,
      registry(['p1/fast-1', 'p2/smart-1']),
    )

    expect(decision.action).toBe('stay')
  })

  it('honors a manual override with an exact model', () => {
    const cfg = makeConfig()
    const state = createRouterState()
    state.manualOverride = { active: true, provider: 'p9', modelId: 'forced-1' }

    const decision = processRoute(
      { tier: 'fast', source: 'llm' },
      state,
      cfg,
      registry([]),
    )

    expect(decision.action).toBe('manual')
    expect(decision.switchTo).toEqual({ provider: 'p9', modelId: 'forced-1', tier: 'fast' })
  })

  it('skips models in cooldown when upgrading', () => {
    const cfg = makeConfig()
    cfg.tiers.smart.models = [
      { provider: 'p2', model: 'smart-1', priority: 1 },
      { provider: 'p2', model: 'smart-2', priority: 2 },
    ]
    const state = createRouterState()
    state.currentTier = 'fast'
    // Put smart-1 (priority 1) in cooldown → must pick smart-2.
    state.modelCooldowns.set('p2/smart-1', { until: Date.now() + 60_000, attempts: 1 })

    const decision = processRoute(
      { tier: 'smart', source: 'llm' },
      state,
      cfg,
      registry(['p2/smart-1', 'p2/smart-2']),
    )

    expect(decision.switchTo?.modelId).toBe('smart-2')
  })
})

describe('applyModelSwitch', () => {
  it('records tier/provider/model', () => {
    const state = createRouterState()
    applyModelSwitch({ provider: 'p2', modelId: 'smart-1', tier: 'smart' }, state)
    expect(state.currentTier).toBe('smart')
    expect(state.currentProvider).toBe('p2')
    expect(state.currentModelId).toBe('smart-1')
  })
})

describe('shareProviderFamily / effectiveThreshold / downgradeAllowedAt', () => {
  it('detects same-provider tiers', () => {
    const cfg = makeConfig()
    cfg.tiers.fast.models = [{ provider: 'a', model: 'x', priority: 1 }]
    cfg.tiers.smart.models = [{ provider: 'a', model: 'y', priority: 1 }]
    expect(shareProviderFamily(cfg)).toBe(true)
  })

  it('returns false for cross-provider tiers or empty tiers', () => {
    const cfg = makeConfig()
    cfg.tiers.fast.models = [{ provider: 'a', model: 'x', priority: 1 }]
    cfg.tiers.smart.models = [{ provider: 'b', model: 'y', priority: 1 }]
    expect(shareProviderFamily(cfg)).toBe(false)
    expect(shareProviderFamily(makeConfig())).toBe(false)
  })

  it('raises the threshold under same-family cache-aware routing', () => {
    const cfg = makeConfig()
    cfg.tiers.fast.models = [{ provider: 'a', model: 'x', priority: 1 }]
    cfg.tiers.smart.models = [{ provider: 'a', model: 'y', priority: 1 }]
    cfg.routing.cacheAware = { enabled: true, sameFamilyThreshold: 0.9, idleBoundaryMs: 300_000 }
    expect(effectiveThreshold(cfg)).toBe(0.9)
  })

  it('keeps the configured threshold for cross-family tiers', () => {
    const cfg = makeConfig()
    cfg.tiers.fast.models = [{ provider: 'a', model: 'x', priority: 1 }]
    cfg.tiers.smart.models = [{ provider: 'b', model: 'y', priority: 1 }]
    expect(effectiveThreshold(cfg)).toBe(0.6)
  })

  it('suppresses downgrades while the cache is warm', () => {
    const cfg = makeConfig()
    cfg.tiers.fast.models = [{ provider: 'a', model: 'x', priority: 1 }]
    cfg.tiers.smart.models = [{ provider: 'a', model: 'y', priority: 1 }]
    cfg.routing.cacheAware = { enabled: true, sameFamilyThreshold: 0.9, idleBoundaryMs: 300_000 }
    const state = createRouterState()
    const now = 1_000_000
    state.lastActivityAt = now - 10_000 // 10s ago → warm
    expect(downgradeAllowedAt(state, cfg, now)).toBe(false)
    state.lastActivityAt = now - 400_000 // 400s ago → cold
    expect(downgradeAllowedAt(state, cfg, now)).toBe(true)
  })

  it('allows downgrades immediately when cache-aware is off', () => {
    const cfg = makeConfig()
    cfg.routing.cacheAware = { enabled: false, sameFamilyThreshold: 0.9, idleBoundaryMs: 300_000 }
    const state = createRouterState()
    state.lastActivityAt = Date.now()
    expect(downgradeAllowedAt(state, cfg, Date.now())).toBe(true)
  })
})

describe('analyzeDowngrade', () => {
  it('ignores low-confidence entries', () => {
    const cfg = makeConfig()
    cfg.routing.window = { size: 5, threshold: 0.6, minConfidence: 0.5 }
    const window = [
      { tier: 'fast', timestamp: 1, confidence: 0.2 }, // ignored
      { tier: 'fast', timestamp: 2, confidence: 0.9 },
      { tier: 'fast', timestamp: 3, confidence: 0.9 },
    ]
    const result = analyzeDowngrade(window, 'smart', cfg)
    expect(result.shouldDowngrade).toBe(true)
  })

  it('never downgrades from fast', () => {
    const cfg = makeConfig()
    const result = analyzeDowngrade([{ tier: 'fast', timestamp: 1 }], 'fast', cfg)
    expect(result.shouldDowngrade).toBe(false)
  })
})

describe('processRoute window timestamps', () => {
  it('stamps the window entry with the injected `now` (pure, deterministic)', () => {
    const cfg = makeConfig()
    cfg.tiers.fast.models = [{ provider: 'p1', model: 'fast-1', priority: 1 }]
    const state = createRouterState()
    state.currentTier = 'fast'

    const now = 1_234_567_890
    const decision = processRoute(
      { tier: 'fast', source: 'llm', confidence: 0.9 },
      state,
      cfg,
      registry(['p1/fast-1']),
      now,
    )

    expect(decision.action).toBe('stay')
    expect(state.window).toHaveLength(1)
    expect(state.window[0]!.timestamp).toBe(now)
  })
})

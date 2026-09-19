/**
 * dsh-shift-router — routing engine tests
 *
 * Contract: SPEC §2 (decision pipeline), §3 (EV economics), §4 (decision
 * memory), §5 (cache-aware).
 */

import { describe, expect, it } from 'vitest'
import {
  analyzeDowngrade,
  applyModelSwitch,
  createRouterState,
  downgradeAllowedAt,
  effectiveReworkPenalty,
  effectiveTheta,
  fastStreak,
  legacyThetaOverride,
  processRoute,
  pSmartOf,
  recordLastDecision,
  sameFamilyThetaFactor,
  shareProviderFamily,
} from '../src/router.js'
import type { JudgeResult, ShiftRouterConfig } from '../src/types.js'
import {
  DEFAULT_CONFIG,
  DEFAULT_SAME_FAMILY_PENALTY,
  LEGACY_SAME_FAMILY_PENALTY,
  LEGACY_THRESHOLD_DEFAULT,
} from '../src/types.js'

function makeConfig(overrides: Partial<ShiftRouterConfig> = {}): ShiftRouterConfig {
  const cfg = structuredClone(DEFAULT_CONFIG)
  return Object.assign(cfg, overrides)
}

/** modelAvailable: a simple registry of known "provider/model" keys. */
function registry(keys: string[]): (p: string, m: string) => boolean {
  const set = new Set(keys)
  return (p, m) => set.has(`${p}/${m}`)
}

/** Cross-provider tiers (so cache-aware routing never interferes). */
function crossProviderConfig(): ShiftRouterConfig {
  const cfg = makeConfig()
  cfg.tiers.fast.models = [{ provider: 'p1', model: 'fast-1', priority: 1 }]
  cfg.tiers.smart.models = [{ provider: 'p2', model: 'smart-1', priority: 1 }]
  return cfg
}

const ALL = registry(['p1/fast-1', 'p2/smart-1'])

describe('EV economics (theta = 1/R)', () => {
  it('derives theta from reworkPenalty by default', () => {
    const cfg = makeConfig()
    expect(effectiveReworkPenalty(cfg)).toBe(3)
    expect(effectiveTheta(cfg)).toBeCloseTo(1 / 3, 10)
  })

  it('lets a named preset override reworkPenalty', () => {
    const cfg = makeConfig()
    cfg.routing.economics.mode = 'eco'
    expect(effectiveReworkPenalty(cfg)).toBe(2)
    expect(effectiveTheta(cfg)).toBeCloseTo(0.5, 10)
    cfg.routing.economics.mode = 'sport'
    expect(effectiveReworkPenalty(cfg)).toBe(5)
    expect(effectiveTheta(cfg)).toBeCloseTo(0.2, 10)
    // The manual knob stays authoritative when no preset is set.
    cfg.routing.economics.mode = undefined
    cfg.routing.economics.reworkPenalty = 4
    expect(effectiveTheta(cfg)).toBeCloseTo(0.25, 10)
  })

  it('reads confidence as pSmart (fast verdicts count against smart)', () => {
    expect(pSmartOf({ tier: 'smart', source: 'llm', confidence: 0.8 })).toBeCloseTo(0.8, 10)
    expect(pSmartOf({ tier: 'fast', source: 'llm', confidence: 0.8 })).toBeCloseTo(0.2, 10)
    // Missing confidence is read as 1.0 (backward-compatible).
    expect(pSmartOf({ tier: 'fast', source: 'llm' })).toBeCloseTo(0, 10)
    expect(pSmartOf({ tier: 'smart', source: 'llm' })).toBeCloseTo(1, 10)
  })

  it('treats the legacy threshold default as inert', () => {
    const cfg = makeConfig()
    cfg.routing.window.threshold = LEGACY_THRESHOLD_DEFAULT
    expect(legacyThetaOverride(cfg)).toBeUndefined()
    expect(effectiveTheta(cfg)).toBeCloseTo(1 / 3, 10)
  })

  it('honours a non-default legacy threshold as a raw theta override', () => {
    const cfg = makeConfig()
    cfg.routing.window.threshold = 0.9
    expect(legacyThetaOverride(cfg)).toBe(0.9)
    expect(effectiveTheta(cfg)).toBeCloseTo(0.9, 10)
  })

  it('divides theta by the same-family penalty (fewer downgrades)', () => {
    const cfg = crossProviderConfig()
    cfg.tiers.smart.models = [{ provider: 'p1', model: 'smart-1', priority: 1 }]
    expect(shareProviderFamily(cfg)).toBe(true)
    expect(sameFamilyThetaFactor(cfg)).toBe(DEFAULT_SAME_FAMILY_PENALTY)
    expect(effectiveTheta(cfg)).toBeCloseTo(1 / 3 / DEFAULT_SAME_FAMILY_PENALTY, 10)
  })

  it('maps a non-default legacy sameFamilyThreshold to the strong penalty', () => {
    const cfg = crossProviderConfig()
    cfg.tiers.smart.models = [{ provider: 'p1', model: 'smart-1', priority: 1 }]
    cfg.routing.cacheAware!.sameFamilyThreshold = 0.9
    // The legacy default is inert → the configured penalty still applies.
    expect(sameFamilyThetaFactor(cfg)).toBe(DEFAULT_SAME_FAMILY_PENALTY)
    cfg.routing.cacheAware!.sameFamilyThreshold = 0.95
    expect(sameFamilyThetaFactor(cfg)).toBe(LEGACY_SAME_FAMILY_PENALTY)
  })

  it('leaves cross-family and disabled cache-aware routing at factor 1', () => {
    expect(sameFamilyThetaFactor(crossProviderConfig())).toBe(1)
    const same = crossProviderConfig()
    same.tiers.smart.models = [{ provider: 'p1', model: 'smart-1', priority: 1 }]
    same.routing.cacheAware!.enabled = false
    expect(sameFamilyThetaFactor(same)).toBe(1)
  })
})

describe('processRoute — EV decisions', () => {
  it('upgrades instantly when a decisive smart verdict clears theta', () => {
    const state = createRouterState()
    state.currentTier = 'fast'

    const decision = processRoute(
      { tier: 'smart', source: 'llm', confidence: 0.85 },
      state,
      crossProviderConfig(),
      ALL,
    )

    expect(decision.action).toBe('upgrade')
    expect(decision.decisionTier).toBe('smart')
    expect(decision.held).toBe(false)
    expect(decision.switchTo).toEqual({ provider: 'p2', modelId: 'smart-1', tier: 'smart' })
    expect(state.upgradeCount).toBe(1)
    // Upgrade clears the window (fresh start for the new tier).
    expect(state.window).toEqual([])
  })

  it('stays on fast for a decisive fast verdict', () => {
    const state = createRouterState()
    state.currentTier = 'fast'

    const decision = processRoute(
      { tier: 'fast', source: 'llm', confidence: 0.9 },
      state,
      crossProviderConfig(),
      ALL,
    )

    expect(decision.action).toBe('stay')
    expect(decision.decisionTier).toBe('fast')
    expect(decision.switchTo).toBeNull()
    expect(state.window).toHaveLength(1)
    expect(state.window[0]!.hold).toBeFalsy()
  })

  it('escalates on a weakly-confident smart verdict when pSmart still clears theta', () => {
    // c = 0.5 → pSmart = 0.5 ≥ θ = 0.333.
    const state = createRouterState()
    state.currentTier = 'fast'
    const decision = processRoute(
      { tier: 'smart', source: 'llm', confidence: 0.5 },
      state,
      crossProviderConfig(),
      ALL,
    )
    expect(decision.action).toBe('upgrade')
  })

  it('keeps the fast tier when pSmart falls below theta', () => {
    // fast verdict c = 0.9 → pSmart = 0.1 < 0.333.
    const state = createRouterState()
    state.currentTier = 'fast'
    const decision = processRoute(
      { tier: 'fast', source: 'llm', confidence: 0.9 },
      state,
      crossProviderConfig(),
      ALL,
    )
    expect(decision.decisionTier).toBe('fast')
    expect(decision.action).toBe('stay')
  })
})

describe('processRoute — judge-outage and low-confidence holds', () => {
  it('holds position when the Judge is unavailable (never fabricates a fast verdict)', () => {
    const state = createRouterState()
    state.currentTier = 'smart'
    state.currentModelId = 'smart-1'
    state.currentProvider = 'p2'

    const decision = processRoute(
      { tier: 'fast', source: 'fallback' },
      state,
      crossProviderConfig(),
      ALL,
    )

    expect(decision.held).toBe(true)
    expect(decision.action).toBe('stay')
    expect(decision.switchTo).toBeNull()
    expect(decision.decisionTier).toBe('smart')
    expect(state.window).toHaveLength(1)
    expect(state.window[0]!.hold).toBe(true)
    expect(state.downgradeCount).toBe(0)
  })

  it('never lets two consecutive outages downgrade a smart session', () => {
    const cfg = crossProviderConfig()
    const state = createRouterState()
    state.currentTier = 'smart'
    for (let i = 0; i < 5; i++) {
      processRoute({ tier: 'fast', source: 'fallback' }, state, cfg, ALL)
    }
    expect(state.currentTier).toBe('smart')
    expect(state.downgradeCount).toBe(0)
  })

  it('holds on a verdict below minConfidence', () => {
    const state = createRouterState()
    state.currentTier = 'smart'
    const decision = processRoute(
      { tier: 'fast', source: 'llm', confidence: 0.4 },
      state,
      crossProviderConfig(),
      ALL,
    )
    expect(decision.held).toBe(true)
    expect(decision.decisionTier).toBe('smart')
    expect(state.window[0]!.hold).toBe(true)
  })
})

describe('processRoute — downgrade memory', () => {
  it('requires `downgradeMemory` consecutive decisive fast turns', () => {
    const cfg = crossProviderConfig()
    const state = createRouterState()
    state.currentTier = 'smart'
    state.currentModelId = 'smart-1'
    state.currentProvider = 'p2'

    const first = processRoute({ tier: 'fast', source: 'llm', confidence: 0.9 }, state, cfg, ALL)
    expect(first.action).toBe('stay')
    expect(first.decisionTier).toBe('smart')

    const second = processRoute({ tier: 'fast', source: 'llm', confidence: 0.9 }, state, cfg, ALL)
    expect(second.action).toBe('downgrade')
    expect(second.decisionTier).toBe('fast')
    expect(second.switchTo).toEqual({ provider: 'p1', modelId: 'fast-1', tier: 'fast' })
    expect(state.downgradeCount).toBe(1)
  })

  it('honours a custom downgradeMemory', () => {
    const cfg = crossProviderConfig()
    cfg.routing.economics.downgradeMemory = 1
    const state = createRouterState()
    state.currentTier = 'smart'
    const decision = processRoute({ tier: 'fast', source: 'llm', confidence: 0.9 }, state, cfg, ALL)
    expect(decision.action).toBe('downgrade')
  })

  it('breaks the fast streak on a hold', () => {
    const cfg = crossProviderConfig()
    const state = createRouterState()
    state.currentTier = 'smart'
    processRoute({ tier: 'fast', source: 'llm', confidence: 0.9 }, state, cfg, ALL)
    expect(fastStreak(state.window)).toBe(1)
    processRoute({ tier: 'fast', source: 'fallback' }, state, cfg, ALL)
    expect(fastStreak(state.window)).toBe(0)
    const after = processRoute({ tier: 'fast', source: 'llm', confidence: 0.9 }, state, cfg, ALL)
    expect(after.action).toBe('stay')
  })

  it('resets the fast streak on a smart entry', () => {
    const cfg = crossProviderConfig()
    const state = createRouterState()
    state.currentTier = 'smart'
    processRoute({ tier: 'fast', source: 'llm', confidence: 0.9 }, state, cfg, ALL)
    processRoute({ tier: 'smart', source: 'llm', confidence: 0.9 }, state, cfg, ALL)
    expect(fastStreak(state.window)).toBe(0)
  })

  it('never downgrades from the fast tier', () => {
    const cfg = crossProviderConfig()
    const state = createRouterState()
    state.currentTier = 'fast'
    for (let i = 0; i < 5; i++) {
      const d = processRoute({ tier: 'fast', source: 'llm', confidence: 0.9 }, state, cfg, ALL)
      expect(d.action).toBe('stay')
    }
    expect(state.downgradeCount).toBe(0)
  })
})

describe('cache-aware downgrade gate', () => {
  it('suppresses downgrades while the cache is warm', () => {
    const cfg = crossProviderConfig()
    cfg.tiers.smart.models = [{ provider: 'p1', model: 'smart-1', priority: 1 }]
    cfg.routing.economics.downgradeMemory = 1
    const state = createRouterState()
    state.currentTier = 'smart'
    const now = 1_000_000
    state.lastActivityAt = now - 10_000 // warm

    const decision = processRoute(
      { tier: 'fast', source: 'llm', confidence: 0.9 },
      state,
      cfg,
      registry(['p1/fast-1', 'p1/smart-1']),
      now,
    )
    expect(decision.action).toBe('stay')
    expect(decision.decisionTier).toBe('smart')
  })

  it('reports the gate directly for warm/cold/disabled states', () => {
    const cfg = crossProviderConfig()
    cfg.tiers.smart.models = [{ provider: 'p1', model: 'smart-1', priority: 1 }]
    const state = createRouterState()
    const now = 1_000_000
    state.lastActivityAt = now - 10_000
    expect(downgradeAllowedAt(state, cfg, now)).toBe(false)
    state.lastActivityAt = now - 400_000
    expect(downgradeAllowedAt(state, cfg, now)).toBe(true)
    state.lastActivityAt = 0
    expect(downgradeAllowedAt(state, cfg, now)).toBe(true)
  })

  it('is inert when cache-aware routing is disabled', () => {
    const cfg = crossProviderConfig()
    cfg.routing.cacheAware!.enabled = false
    const state = createRouterState()
    state.lastActivityAt = Date.now()
    expect(downgradeAllowedAt(state, cfg, Date.now())).toBe(true)
  })

  it('makes the same verdict stickier on a shared provider', () => {
    // fast verdict c = 0.75 → pSmart = 0.25.
    // cross-family: 0.25 < 0.333 → fast decision (downgrade allowed).
    // same-family : θ_eff = 0.222 → 0.25 ≥ θ_eff → smart decision (stays).
    const judge: JudgeResult = { tier: 'fast', source: 'llm', confidence: 0.75 }

    const cross = crossProviderConfig()
    cross.routing.economics.downgradeMemory = 1
    const crossState = createRouterState()
    crossState.currentTier = 'smart'
    expect(processRoute(judge, crossState, cross, ALL).action).toBe('downgrade')

    const same = crossProviderConfig()
    same.tiers.smart.models = [{ provider: 'p1', model: 'smart-1', priority: 1 }]
    same.routing.economics.downgradeMemory = 1
    const sameState = createRouterState()
    sameState.currentTier = 'smart'
    expect(
      processRoute(judge, sameState, same, registry(['p1/fast-1', 'p1/smart-1'])).action,
    ).toBe('stay')
  })
})

describe('processRoute — manual override and strict model authority', () => {
  it('honors a manual override with an exact model', () => {
    const state = createRouterState()
    state.manualOverride = { active: true, provider: 'p9', modelId: 'forced-1', tier: 'smart' }

    const decision = processRoute({ tier: 'fast', source: 'llm' }, state, makeConfig(), registry([]))

    expect(decision.action).toBe('manual')
    expect(decision.decisionTier).toBe('smart')
    expect(decision.switchTo).toEqual({ provider: 'p9', modelId: 'forced-1', tier: 'smart' })
  })

  it('records the tier change even when both tiers resolve to the same model', () => {
    const cfg = makeConfig()
    cfg.tiers.fast.models = [{ provider: 'p1', model: 'shared', priority: 1 }]
    cfg.tiers.smart.models = [{ provider: 'p1', model: 'shared', priority: 1 }]
    const state = createRouterState()
    state.currentTier = 'fast'

    const decision = processRoute(
      { tier: 'smart', source: 'llm', confidence: 0.9 },
      state,
      cfg,
      registry(['p1/shared']),
    )
    expect(decision.action).toBe('upgrade')
    expect(decision.decisionTier).toBe('smart')
    applyModelSwitch(decision.switchTo!, state)
    expect(state.currentTier).toBe('smart')
  })

  it('skips models in cooldown when upgrading', () => {
    const cfg = makeConfig()
    cfg.tiers.smart.models = [
      { provider: 'p2', model: 'smart-1', priority: 1 },
      { provider: 'p2', model: 'smart-2', priority: 2 },
    ]
    const state = createRouterState()
    state.currentTier = 'fast'
    state.modelCooldowns.set('p2/smart-1', { until: Date.now() + 60_000, attempts: 1 })

    const decision = processRoute(
      { tier: 'smart', source: 'llm', confidence: 0.9 },
      state,
      cfg,
      registry(['p2/smart-1', 'p2/smart-2']),
    )
    expect(decision.switchTo?.modelId).toBe('smart-2')
  })
})

describe('recordLastDecision', () => {
  it('records verdict, action, decision tier and reason for display', () => {
    const state = createRouterState()
    state.currentTier = 'fast'
    const now = 999
    const judge: JudgeResult = { tier: 'smart', source: 'llm', confidence: 0.9, reason: 'architecture' }
    const decision = processRoute(judge, state, crossProviderConfig(), ALL, now)
    recordLastDecision(state, judge, decision, now)

    expect(state.lastDecision).toMatchObject({
      verdictTier: 'smart',
      confidence: 0.9,
      reason: 'architecture',
      action: 'upgrade',
      decisionTier: 'smart',
      held: false,
      at: now,
    })
  })

  it('marks a held decision so status can explain why nothing switched', () => {
    const state = createRouterState()
    state.currentTier = 'smart'
    const judge: JudgeResult = { tier: 'fast', source: 'fallback' }
    const decision = processRoute(judge, state, crossProviderConfig(), ALL, 1)
    recordLastDecision(state, judge, decision, 1)
    expect(state.lastDecision).toMatchObject({ held: true, decisionTier: 'smart', action: 'stay' })
    expect(state.lastDecision).not.toHaveProperty('confidence')
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

describe('analyzeDowngrade', () => {
  it('is pure and streak-based', () => {
    const cfg = crossProviderConfig()
    expect(analyzeDowngrade([], 'smart', cfg).shouldDowngrade).toBe(false)
    expect(
      analyzeDowngrade([{ tier: 'fast', timestamp: 1 }], 'smart', cfg).shouldDowngrade,
    ).toBe(false)
    expect(
      analyzeDowngrade(
        [{ tier: 'fast', timestamp: 1 }, { tier: 'fast', timestamp: 2 }],
        'smart',
        cfg,
      ).shouldDowngrade,
    ).toBe(true)
  })

  it('never downgrades from fast', () => {
    const cfg = crossProviderConfig()
    const window = [
      { tier: 'fast', timestamp: 1 },
      { tier: 'fast', timestamp: 2 },
    ]
    expect(analyzeDowngrade(window, 'fast', cfg).shouldDowngrade).toBe(false)
  })
})

describe('processRoute window timestamps', () => {
  it('stamps the window entry with the injected `now` (pure, deterministic)', () => {
    const state = createRouterState()
    state.currentTier = 'fast'
    const now = 1_234_567_890

    const decision = processRoute(
      { tier: 'fast', source: 'llm', confidence: 0.9 },
      state,
      crossProviderConfig(),
      ALL,
      now,
    )

    expect(decision.action).toBe('stay')
    expect(state.window).toHaveLength(1)
    expect(state.window[0]!.timestamp).toBe(now)
  })

  it('caps the window at window.size', () => {
    const cfg = crossProviderConfig()
    cfg.routing.window.size = 3
    cfg.routing.economics.downgradeMemory = 99
    const state = createRouterState()
    state.currentTier = 'smart'
    for (let i = 0; i < 6; i++) {
      processRoute({ tier: 'fast', source: 'llm', confidence: 0.9 }, state, cfg, ALL)
    }
    expect(state.window).toHaveLength(3)
  })
})

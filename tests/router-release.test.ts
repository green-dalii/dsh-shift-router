/**
 * dsh-shift-router — rung 3: "no routing at all" (SPEC §2 step 2, §6.3)
 *
 * The distinction this file pins is the whole point of the round: a **hold** is
 * a verdict that arrived and was too weak to act on (the router keeps the wire),
 * while a **release** is no verdict at all (the router hands the wire back).
 * Collapsing them is what let a dead judge keep a session on the Smart model
 * indefinitely on the strength of a verdict that had stopped arriving.
 */

import { describe, expect, it } from 'vitest'
import { createRouterState, planNoJudge, processRoute } from '../src/router.js'
import { DEFAULT_CONFIG, type JudgeResult, type RouterState, type ShiftRouterConfig } from '../src/types.js'

const alwaysAvailable = (): boolean => true

function state(over: Partial<RouterState> = {}): RouterState {
  return { ...createRouterState(), ...over }
}

function config(over: Partial<ShiftRouterConfig> = {}): ShiftRouterConfig {
  // Both chains populated, so an upgrade is actually resolvable and "released"
  // is not accidentally satisfied by an empty Smart chain.
  return {
    ...DEFAULT_CONFIG,
    tiers: {
      ...DEFAULT_CONFIG.tiers,
      fast: { ...DEFAULT_CONFIG.tiers.fast, models: [{ provider: 'p1', model: 'fast-1', priority: 1 }] },
      smart: { ...DEFAULT_CONFIG.tiers.smart, models: [{ provider: 'p2', model: 'smart-1', priority: 1 }] },
    },
    ...over,
  }
}

const FALLBACK: JudgeResult = { tier: 'fast', source: 'fallback' }
const WEAK: JudgeResult = { tier: 'smart', source: 'llm', confidence: 0.2 }
const STRONG: JudgeResult = { tier: 'smart', source: 'llm', confidence: 0.95 }

describe('planNoJudge', () => {
  it('releases the turn without switching anything', () => {
    const s = state({ currentTier: 'smart', currentModelId: 'm', currentProvider: 'p' })
    expect(planNoJudge(s, config(), 1000)).toEqual({
      switchTo: null,
      action: 'stay',
      decisionTier: 'smart',
      held: true,
      released: true,
    })
  })

  it('records a hold entry so a dead judge cannot extend a fast streak', () => {
    const s = state({ currentTier: 'smart' })
    planNoJudge(s, config(), 1000)
    expect(s.window).toEqual([{ tier: 'fast', timestamp: 1000, confidence: undefined, hold: true }])
  })

  it('does not resolve a Smart model even though the tier would allow it', () => {
    const s = state({ currentTier: 'fast' })
    const decision = planNoJudge(s, config(), 1000)
    expect(decision.switchTo).toBeNull()
    expect(decision.decisionTier).toBe('fast')
  })
})

describe('processRoute — release vs hold', () => {
  it('releases on a fallback verdict instead of holding', () => {
    const s = state({ currentTier: 'smart', currentModelId: 'm', currentProvider: 'p' })
    const decision = processRoute(FALLBACK, s, config(), alwaysAvailable, 1000)
    expect(decision.released).toBe(true)
    expect(decision.held).toBe(true)
    expect(decision.switchTo).toBeNull()
    expect(decision.decisionTier).toBe('smart')
  })

  it('a released turn never upgrades even when the raw verdict says smart', () => {
    // `source: 'fallback'` carries a placeholder tier; nothing may read it.
    const s = state({ currentTier: 'fast' })
    const decision = processRoute({ tier: 'smart', source: 'fallback' }, s, config(), alwaysAvailable, 1000)
    expect(decision.released).toBe(true)
    expect(decision.decisionTier).toBe('fast')
    expect(decision.switchTo).toBeNull()
  })

  it('holds — without releasing — on a verdict that is merely too weak', () => {
    const s = state({ currentTier: 'fast', currentModelId: 'm', currentProvider: 'p' })
    const decision = processRoute(WEAK, s, config(), alwaysAvailable, 1000)
    expect(decision.held).toBe(true)
    expect(decision.released).toBe(false)
    expect(decision.switchTo).toBeNull()
  })

  it('a decisive verdict is neither held nor released', () => {
    const s = state({ currentTier: 'fast' })
    const decision = processRoute(STRONG, s, config(), alwaysAvailable, 1000)
    expect(decision.released).toBe(false)
    expect(decision.held).toBe(false)
    expect(decision.action).toBe('upgrade')
  })

  it('a manual override is not a release: /route-force wins over a dead judge', () => {
    const s = state({ currentTier: 'fast' })
    s.manualOverride = { active: true, provider: 'p', modelId: 'pinned' }
    const decision = processRoute(FALLBACK, s, config(), alwaysAvailable, 1000)
    expect(decision.action).toBe('manual')
    expect(decision.released).toBe(false)
    expect(decision.switchTo?.modelId).toBe('pinned')
    // The override path must not pretend a verdict was recorded either.
    expect(s.window).toEqual([])
  })

  it('every other branch reports released: false', () => {
    const s = state({ currentTier: 'smart', currentModelId: 'm', currentProvider: 'p' })
    expect(processRoute({ tier: 'fast', source: 'llm', confidence: 0.95 }, s, config(), alwaysAvailable, 1000).released)
      .toBe(false)
  })
})

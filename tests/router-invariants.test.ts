/**
 * dsh-shift-router — routing invariants (property-style)
 *
 * The EV rule is arithmetic over a small state machine, so the example-based
 * tests in router.test.ts can all pass while some corner of the state space is
 * wrong. These tests drive long PSEUDO-RANDOM verdict sequences through
 * `processRoute` and assert invariants that must hold for every sequence,
 * whatever the confidence and tier mix — the cheapest way to catch an
 * off-by-one or an ordering bug in the window/streak/cache interaction.
 *
 * The generator is seeded and deterministic, so a failure is reproducible.
 */

import { describe, expect, it } from 'vitest'
import {
  applyModelSwitch,
  createRouterState,
  effectiveTheta,
  fastStreak,
  isDecisive,
  processRoute,
  pSmartOf,
  type RouteDecision,
} from '../src/router.js'
import { DEFAULT_CONFIG, type JudgeResult, type ShiftRouterConfig, type RouterState } from '../src/types.js'

/** xorshift32 — tiny deterministic PRNG so failures reproduce exactly. */
function rng(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13; state >>>= 0
    state ^= state >>> 17
    state ^= state << 5; state >>>= 0
    return state / 0x1_0000_0000
  }
}

function verdict(next: () => number): JudgeResult {
  const roll = next()
  // Mix of decisive, borderline and outage verdicts, both tiers.
  if (roll < 0.08) return { tier: 'fast', source: 'fallback' }
  const tier = next() < 0.5 ? 'fast' : 'smart'
  const confidence = Number((next()).toFixed(3))
  return { tier, source: 'llm', confidence }
}

interface Scenario {
  name: string
  config: ShiftRouterConfig
  /** Shared provider between tiers → cache divisor applies. */
  cacheAwareActive: boolean
}

function scenarios(): Scenario[] {
  const base = () => structuredClone(DEFAULT_CONFIG) as ShiftRouterConfig
  const cross = base()
  cross.tiers.fast.models = [{ provider: 'p1', model: 'f', priority: 1 }]
  cross.tiers.smart.models = [{ provider: 'p2', model: 's', priority: 1 }]

  const same = base()
  same.tiers.fast.models = [{ provider: 'p1', model: 'f', priority: 1 }]
  same.tiers.smart.models = [{ provider: 'p1', model: 's', priority: 1 }]

  const legacy = base()
  legacy.tiers.fast.models = [{ provider: 'p1', model: 'f', priority: 1 }]
  legacy.tiers.smart.models = [{ provider: 'p2', model: 's', priority: 1 }]
  legacy.routing.window.threshold = 0.9
  legacy.routing.economics.downgradeMemory = 1

  const tight = base()
  tight.tiers.fast.models = [{ provider: 'p1', model: 'f', priority: 1 }]
  tight.tiers.smart.models = [{ provider: 'p2', model: 's', priority: 1 }]
  tight.routing.window.size = 1
  tight.routing.economics.downgradeMemory = 1
  tight.routing.window.minConfidence = 0.99

  return [
    { name: 'cross-provider (no cache divisor)', config: cross, cacheAwareActive: false },
    { name: 'same-provider (cache divisor 1.5)', config: same, cacheAwareActive: true },
    { name: 'legacy threshold override + memory 1', config: legacy, cacheAwareActive: false },
    { name: 'window size 1, memory 1, minConfidence 0.99', config: tight, cacheAwareActive: false },
  ]
}

const ALL = (): ((p: string, m: string) => boolean) => () => true

/** Run one seeded sequence, checking invariants after every step. */
function runSequence(config: ShiftRouterConfig, seed: number, steps = 400): void {
  const next = rng(seed)
  const state: RouterState = createRouterState()
  const available = ALL()
  const now = (i: number) => 1_000_000 + i * 1000 // strictly increasing clock

  for (let i = 0; i < steps; i++) {
    const before: RouterState = structuredClone(state)
    const judge = verdict(next)
    const at = now(i)
    const decision: RouteDecision = processRoute(judge, state, config, available, at)
    // `processRoute` is a pure decision: it returns `switchTo` but does not
    // move the tier. The caller applies it (index.ts does this right after the
    // decision), so mirror that here — otherwise every later step would be
    // measured against a stale tier.
    if (decision.switchTo !== null) applyModelSwitch(decision.switchTo, state)

    // 1. The decision tier is always one the router can actually be at.
    expect(['fast', 'smart']).toContain(decision.decisionTier)

    // 2. Only a switch may change the running tier, and it must match the
    //    decision the router reported.
    if (decision.switchTo === null) {
      expect(state.currentTier, `hold/stay changed the tier at step ${i}`).toBe(before.currentTier)
      expect(decision.decisionTier).toBe(before.currentTier)
    } else {
      expect(state.currentTier).toBe(decision.switchTo.tier)
      expect(decision.decisionTier).toBe(decision.switchTo.tier)
    }

    // 3. A downgrade only ever goes smart → fast, and only a downgrade
    //    increments the counter.
    if (decision.action === 'downgrade') {
      expect(before.currentTier).toBe('smart')
      expect(state.currentTier).toBe('fast')
      expect(state.downgradeCount).toBe(before.downgradeCount + 1)
    } else {
      expect(state.downgradeCount, `step ${i}`).toBe(before.downgradeCount)
    }
    if (decision.action === 'upgrade') {
      expect(before.currentTier).toBe('fast')
      expect(state.currentTier).toBe('smart')
      expect(state.upgradeCount).toBe(before.upgradeCount + 1)
      // An upgrade clears the decision memory.
      expect(state.window).toEqual([])
    }

    // 4. A hold never switches, and is always recorded as a hold entry.
    if (decision.held) {
      expect(decision.switchTo).toBeNull()
      expect(decision.action).toBe('stay')
      expect(state.window.at(-1)?.hold).toBe(true)
    }

    // 5. The window never exceeds its configured size, and the fast streak is
    //    always bounded by it.
    expect(state.window.length).toBeLessThanOrEqual(config.routing.window.size)
    expect(fastStreak(state.window)).toBeLessThanOrEqual(config.routing.window.size)

    // 6. A downgrade requires the configured number of consecutive decisive
    //    fast entries. The incoming verdict is pushed before the check, so the
    //    condition is "this verdict was decisive-fast (completing the streak)"
    //    OR "the streak already met the requirement".
    //    The rule is read from the implementation (`isDecisive` / `pSmartOf` /
    //    `effectiveTheta`) rather than re-derived here: a hand-copied formula
    //    once made this invariant assert the opposite of the real rule.
    if (decision.action === 'downgrade') {
      const needed = config.routing.economics.downgradeMemory
      const decisiveFastBefore =
        isDecisive(judge, config)
        && judge.tier === 'fast'
        && pSmartOf(judge) < effectiveTheta(config)
      expect(decisiveFastBefore || fastStreak(before.window) >= needed, `step ${i}`).toBe(true)
    }

    // 7. Timestamps are stamped from the injected clock, never from Date.now().
    const last = state.window.at(-1)
    if (last !== undefined && decision.action !== 'upgrade') expect(last.timestamp).toBe(at)
  }
}

describe('processRoute invariants over random verdict sequences', () => {
  for (const scenario of scenarios()) {
    for (const seed of [1, 7, 12345, 0xdeadbeef]) {
      it(`${scenario.name} — seed ${seed}`, () => {
        runSequence(scenario.config, seed)
      })
    }
  }

  it('never downgrades while every verdict asks for smart', () => {
    const cfg = structuredClone(DEFAULT_CONFIG) as ShiftRouterConfig
    cfg.tiers.fast.models = [{ provider: 'p1', model: 'f', priority: 1 }]
    cfg.tiers.smart.models = [{ provider: 'p2', model: 's', priority: 1 }]
    cfg.routing.economics.downgradeMemory = 1
    const state = createRouterState()
    state.currentTier = 'smart'
    for (let i = 0; i < 50; i++) {
      processRoute({ tier: 'smart', source: 'llm', confidence: 0.95 }, state, cfg, ALL(), i)
    }
    expect(state.currentTier).toBe('smart')
    expect(state.downgradeCount).toBe(0)
  })

  it('never upgrades while every verdict is a decisive fast one', () => {
    const cfg = structuredClone(DEFAULT_CONFIG) as ShiftRouterConfig
    cfg.tiers.fast.models = [{ provider: 'p1', model: 'f', priority: 1 }]
    cfg.tiers.smart.models = [{ provider: 'p2', model: 's', priority: 1 }]
    const state = createRouterState()
    for (let i = 0; i < 50; i++) {
      processRoute({ tier: 'fast', source: 'llm', confidence: 0.99 }, state, cfg, ALL(), i)
    }
    expect(state.currentTier).toBe('fast')
    expect(state.upgradeCount).toBe(0)
  })

  it('holds forever under a permanent judge outage, whatever the starting tier', () => {
    const cfg = structuredClone(DEFAULT_CONFIG) as ShiftRouterConfig
    cfg.tiers.fast.models = [{ provider: 'p1', model: 'f', priority: 1 }]
    cfg.tiers.smart.models = [{ provider: 'p2', model: 's', priority: 1 }]
    cfg.routing.economics.downgradeMemory = 1
    for (const tier of ['fast', 'smart'] as const) {
      const state = createRouterState()
      state.currentTier = tier
      for (let i = 0; i < 50; i++) {
        const d = processRoute({ tier: 'fast', source: 'fallback' }, state, cfg, ALL(), i)
        expect(d.held).toBe(true)
        expect(d.switchTo).toBeNull()
      }
      expect(state.currentTier).toBe(tier)
      expect(state.downgradeCount).toBe(0)
      expect(state.upgradeCount).toBe(0)
    }
  })
})

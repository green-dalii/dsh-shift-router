/**
 * dsh-shift-router — telemetry tests
 *
 * The router owns spend accounting (DSH carries no USD on usage events), so
 * the savings baseline is the number users judge the plugin by. It must be
 * computed honestly: priced from the configured Smart-tier model, and reported
 * as unavailable — never as zero savings — when that model has no pricing.
 *
 * Throughput is deliberately absent: DSH renders tok/s natively (SPEC §9).
 */

import { describe, expect, it } from 'vitest'
import {
  computeCostTelemetry,
  computeStats,
  estimateCost,
  formatUsd,
  getModelPricing,
} from '../src/stats.js'
import { createRouterState } from '../src/router.js'
import { DEFAULT_CONFIG, type ShiftRouterConfig, type TokenUsage } from '../src/types.js'

function makeConfig(): ShiftRouterConfig {
  return structuredClone(DEFAULT_CONFIG)
}

const TOKENS: TokenUsage = { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 }

describe('getModelPricing / estimateCost', () => {
  it('prices per 1M tokens and sums input + output', () => {
    const cfg = makeConfig()
    cfg.pricing = [{ provider: 'p', model: 'm', input: 1, output: 2 }]
    const pricing = getModelPricing(cfg.pricing, 'p', 'm')
    expect(pricing).not.toBeNull()
    // 1000 in @ $1/M + 500 out @ $2/M = 0.001 + 0.001
    expect(estimateCost(pricing, TOKENS)).toBeCloseTo(0.002, 10)
  })

  it('returns null pricing for an unpriced model rather than guessing', () => {
    const cfg = makeConfig()
    cfg.pricing = []
    expect(getModelPricing(cfg.pricing, 'p', 'm')).toBeNull()
    expect(estimateCost(null, TOKENS)).toBe(0)
  })

  it('bills cache reads and writes at their own rates when configured', () => {
    const cfg = makeConfig()
    cfg.pricing = [{ provider: 'p', model: 'm', input: 1, output: 0, cacheRead: 0.1, cacheWrite: 1.25 }]
    const pricing = getModelPricing(cfg.pricing, 'p', 'm')!
    const tokens: TokenUsage = { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000 }
    expect(estimateCost(pricing, tokens)).toBeCloseTo(0.1 + 1.25, 10)
  })
})

describe('computeCostTelemetry', () => {
  it('reports the baseline as the Smart tier priority-1 model', () => {
    const cfg = makeConfig()
    cfg.tiers.fast.models = [{ provider: 'pfast', model: 'cheap', priority: 1 }]
    cfg.tiers.smart.models = [
      { provider: 'psmart', model: 'mid', priority: 2 },
      { provider: 'psmart', model: 'flagship', priority: 1 },
    ]
    cfg.pricing = [
      { provider: 'pfast', model: 'cheap', input: 1, output: 1 },
      { provider: 'psmart', model: 'flagship', input: 10, output: 10 },
      { provider: 'psmart', model: 'mid', input: 5, output: 5 },
    ]
    const state = createRouterState()
    // Actual spend is accumulated per tier by the telemetry listener; the call
    // log exists so the SAME calls can be re-priced against the baseline.
    state.tierUsage.fast.cost = 0.0015
    state.callLog.push({ tier: 'fast', provider: 'pfast', modelId: 'cheap', tokens: TOKENS, cost: 0.0015 })

    const telemetry = computeCostTelemetry(state, cfg)
    // Priority 1 wins, not the first entry in the array.
    expect(telemetry.baselineModel?.modelId).toBe('flagship')
    expect(telemetry.actualTotal).toBeCloseTo(0.0015, 10)
    expect(telemetry.baselineTotal).toBeCloseTo(0.015, 10)
    expect(telemetry.savings).toBeCloseTo(0.0135, 10)
  })

  it('reports an unavailable baseline (null) instead of a fake zero saving', () => {
    const cfg = makeConfig()
    cfg.tiers.smart.models = [{ provider: 'psmart', model: 'flagship', priority: 1 }]
    cfg.pricing = []
    const state = createRouterState()
    state.callLog.push({ tier: 'fast', provider: 'pfast', modelId: 'cheap', tokens: TOKENS, cost: 0 })

    const telemetry = computeCostTelemetry(state, cfg)
    expect(telemetry.baselineModel).toBeNull()
    expect(telemetry.baselineTotal).toBe(0)
    expect(telemetry.savings).toBe(0)
  })

  it('is all-zero for a session that has spent nothing', () => {
    const telemetry = computeCostTelemetry(createRouterState(), makeConfig())
    expect(telemetry.actualTotal).toBe(0)
    expect(telemetry.baselineTotal).toBe(0)
    expect(telemetry.savings).toBe(0)
  })
})

describe('computeStats', () => {
  it('buckets decision-window confidence and counts cooldowns', () => {
    const cfg = makeConfig()
    cfg.routing.window.minConfidence = 0.5
    const state = createRouterState()
    state.window = [
      { tier: 'fast', timestamp: 1, confidence: 0.9 },   // high
      { tier: 'fast', timestamp: 2, confidence: 0.6 },   // mid
      { tier: 'smart', timestamp: 3, confidence: 0.2 },  // low
      { tier: 'fast', timestamp: 4 },                    // none
      { tier: 'fast', timestamp: 5, hold: true },        // hold: no confidence signal
    ]
    const now = 1_000
    state.modelCooldowns.set('p/m', { until: now + 60_000, attempts: 1 })
    state.modelCooldowns.set('p/expired', { until: now - 1, attempts: 1 })

    const stats = computeStats(state, cfg, now)
    expect(stats.windowSize).toBe(5)
    expect(stats.confidence).toEqual({ high: 1, mid: 1, low: 1, none: 2 })
    expect(stats.cooldownCount).toBe(1)
    expect(stats.activeCooldowns[0]).toMatchObject({ provider: 'p', model: 'm' })
  })

  it('reports no throughput field — that belongs to the harness', () => {
    const stats = computeStats(createRouterState(), makeConfig(), 0)
    expect(stats).not.toHaveProperty('avgTokensPerSec')
    expect(stats).not.toHaveProperty('currentTokensPerSec')
  })

  it('counts cumulative output tokens and tier transitions', () => {
    const state = createRouterState()
    state.totalOutputTokens = 1234
    state.upgradeCount = 2
    state.downgradeCount = 1
    const stats = computeStats(state, makeConfig(), 0)
    expect(stats.totalOutputTokens).toBe(1234)
    expect(stats.upgradeCount).toBe(2)
    expect(stats.downgradeCount).toBe(1)
  })
})

describe('formatUsd', () => {
  it('scales precision to the magnitude', () => {
    expect(formatUsd(0)).toBe('$0')
    expect(formatUsd(0.0012)).toBe('$0.0012')
    expect(formatUsd(3.456)).toBe('$3.46')
  })
})

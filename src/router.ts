/**
 * dsh-shift-router — Routing engine
 *
 * Two-tier sliding window trend detection:
 *   - Upgrade (fast → smart): immediate
 *   - Downgrade (smart → fast): requires window majority
 *
 * Ported from pi-shift-router's router.ts. `modelAvailable` is the DSH-side
 * registry probe injected by index.ts (ctx.llm-backed); everything else is
 * pure and unit-testable.
 */

import type { ShiftRouterConfig, Tier, WindowEntry, RouterState, JudgeResult } from './types.js'
import { TIERS } from './types.js'
import { findBestModelForTier, type ResolvedModel } from './tier.js'
import { createCooldowns, cooldownPredicate } from './failover.js'

/** Create an initial RouterState */
export function createRouterState(): RouterState {
  return {
    currentTier: 'fast',
    currentModelId: null,
    currentProvider: null,
    window: [],
    manualOverride: { active: false },
    modelCooldowns: createCooldowns(),
    totalOutputTokens: 0,
    recentSpeeds: [],
    streamingStartTime: null,
    lastRequestProvider: null,
    lastRequestModel: null,
    upgradeCount: 0,
    downgradeCount: 0,
    lastActivityAt: 0,
    tierUsage: {
      fast: emptyTierUsage(),
      smart: emptyTierUsage(),
    },
    callLog: [],
    orchestration: {
      active: false,
      rounds: 0,
      escalations: 0,
      startedAt: null,
      spend: 0,
    },
  }
}

/** Fresh zero-valued TierUsage. */
function emptyTierUsage(): { calls: number; tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }; cost: number } {
  return {
    calls: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0,
  }
}

function tierIndex(tier: Tier): number {
  return TIERS.indexOf(tier)
}

function shouldUpgrade(current: Tier, target: Tier): boolean {
  return tierIndex(target) > tierIndex(current)
}

/**
 * Cache-aware routing.
 *
 * Detect whether the fast and smart tiers resolve to the same provider
 * family. A prompt cache belongs to a model; crossing a model boundary is a
 * guaranteed cache miss. When both tiers live under the same provider, a
 * mid-session downgrade forfeits the warm cache, so routing to a cheaper
 * model can cost more, not less.
 *
 * Returns true when both tiers have at least one model on the same provider
 * (and the router is configured to care). Pure config inspection — no IO.
 */
export function shareProviderFamily(config: ShiftRouterConfig): boolean {
  const fast = config.tiers.fast?.models ?? []
  const smart = config.tiers.smart?.models ?? []
  if (fast.length === 0 || smart.length === 0) return false
  const fastProviders = new Set(fast.map((m) => m.provider))
  return smart.some((m) => fastProviders.has(m.provider))
}

/**
 * The downgrade threshold to use at this moment. When cache-aware routing is
 * active (same provider family), the threshold is raised to
 * `cacheAware.sameFamilyThreshold` so fewer mid-session downgrades fire and
 * the warm prompt cache survives longer. Otherwise the user's configured
 * `window.threshold` applies unchanged.
 */
export function effectiveThreshold(
  config: ShiftRouterConfig,
  cacheAware: boolean = shareProviderFamily(config),
): number {
  if (cacheAware && config.routing.cacheAware?.enabled) {
    return config.routing.cacheAware.sameFamilyThreshold
  }
  return config.routing.window.threshold
}

/**
 * Session-boundary gate for cache-aware downgrades. A downgrade to another
 * model only forfeits the cache while the cache is warm — i.e. within
 * `idleBoundaryMs` of the last message. After an idle gap longer than the
 * provider's cache TTL, the cache is already cold and switching costs
 * nothing extra.
 *
 * Returns true when a downgrade should be allowed right now (cache is cold
 * or cache-aware routing is off / not applicable).
 */
export function downgradeAllowedAt(
  state: RouterState,
  config: ShiftRouterConfig,
  now: number,
  cacheAware: boolean = shareProviderFamily(config),
): boolean {
  if (!cacheAware || !config.routing.cacheAware?.enabled) return true
  const boundary = config.routing.cacheAware.idleBoundaryMs
  // lastActivityAt == 0 → no message has completed yet; nothing cached to lose.
  if (state.lastActivityAt === 0) return true
  return now - state.lastActivityAt > boundary
}

export function analyzeDowngrade(
  window: WindowEntry[],
  currentTier: Tier,
  config: ShiftRouterConfig,
  thresholdOverride?: number,
): { shouldDowngrade: boolean; targetTier: Tier | null } {
  // Can't downgrade further from fast
  if (currentTier !== 'smart') return { shouldDowngrade: false, targetTier: null }

  const { size, minConfidence } = config.routing.window
  const threshold = thresholdOverride ?? config.routing.window.threshold
  const minConf = minConfidence ?? 0.5
  if (window.length === 0) return { shouldDowngrade: false, targetTier: null }

  const relevant = window.slice(-Math.min(window.length, size))

  // Confidence-weighted ratio: entries below minConfidence are ignored.
  // weighted ratio = Σ confidence_for_fast / count_of_considered_entries
  let considered = 0
  let fastConfidenceSum = 0
  for (const e of relevant) {
    const conf = e.confidence ?? 1.0
    if (conf < minConf) continue
    considered += 1
    if (e.tier === 'fast') fastConfidenceSum += conf
  }

  // All entries below minConfidence → no signal → don't downgrade
  if (considered === 0) return { shouldDowngrade: false, targetTier: null }

  const ratio = fastConfidenceSum / considered
  if (ratio >= threshold) {
    return { shouldDowngrade: true, targetTier: 'fast' }
  }

  return { shouldDowngrade: false, targetTier: null }
}

/**
 * Core routing decision:
 * 1. Manual override → use forced model
 * 2. Judge says "smart" and current is "fast" → immediate upgrade
 * 3. Otherwise → analyze window for possible downgrade
 * 4. Push judge result to window (capped)
 */
export function processRoute(
  judgeResult: JudgeResult,
  state: RouterState,
  config: ShiftRouterConfig,
  modelAvailable: (provider: string, model: string) => boolean,
  now: number = Date.now(),
): RouteDecision {
  const { tier: targetTier } = judgeResult

  // 1. Manual override
  if (state.manualOverride.active) {
    if (state.manualOverride.modelId && state.manualOverride.provider) {
      return {
        switchTo: {
          provider: state.manualOverride.provider,
          modelId: state.manualOverride.modelId,
          tier: state.manualOverride.tier ?? targetTier,
        },
        action: 'manual',
      }
    }
    if (state.manualOverride.tier) {
      const m = findBestModelForTier(state.manualOverride.tier, config, modelAvailable)
      if (m) return { switchTo: m, action: 'manual' }
    }
  }

  // 2. Immediate upgrade: fast → smart
  if (shouldUpgrade(state.currentTier, targetTier)) {
    const m = findBestModelForTier(targetTier, config, modelAvailable, cooldownPredicate(state.modelCooldowns, now))
    if (m) {
      // Clear window on upgrade (fresh start for the new tier)
      state.window = []
      state.upgradeCount += 1
      return { switchTo: m, action: 'upgrade' }
    }
  }

  // 3. Push current judgment to window
  state.window.push({
    tier: targetTier,
    timestamp: now,
    confidence: judgeResult.confidence,
  })

  // Cap window
  const maxSize = config.routing.window.size
  if (state.window.length > maxSize) {
    state.window = state.window.slice(-maxSize)
  }

  // 4. Check downgrade. Cache-aware routing:
  //    - same provider family → raised threshold (fewer mid-session switches)
  //    - warm cache → suppress downgrade entirely until an idle boundary
  const down = analyzeDowngrade(
    state.window,
    state.currentTier,
    config,
    effectiveThreshold(config),
  )
  if (down.shouldDowngrade && down.targetTier && downgradeAllowedAt(state, config, now)) {
    const m = findBestModelForTier(down.targetTier, config, modelAvailable, cooldownPredicate(state.modelCooldowns, now))
    if (m) {
      state.downgradeCount += 1
      return { switchTo: m, action: 'downgrade' }
    }
  }

  return { switchTo: null, action: 'stay' }
}

export interface RouteDecision {
  switchTo: ResolvedModel | null
  action: 'upgrade' | 'downgrade' | 'stay' | 'manual'
}

/**
 * Apply a model switch decision to the router state. The actual wire-model
 * override happens in the `agent/request` waterfall; this only records which
 * tier/provider/model the router now owns. Returns the resolved model.
 */
export function applyModelSwitch(
  resolved: ResolvedModel,
  state: RouterState,
): ResolvedModel {
  state.currentTier = resolved.tier
  state.currentModelId = resolved.modelId
  state.currentProvider = resolved.provider
  return resolved
}

export function clearManualOverride(state: RouterState): void {
  state.manualOverride = { active: false }
}

export function setManualOverrideTier(state: RouterState, tier: Tier): void {
  state.manualOverride = { active: true, tier }
}

export function setManualOverrideModel(state: RouterState, provider: string, modelId: string): void {
  state.manualOverride = { active: true, provider, modelId }
}

/**
 * dsh-shift-router — Routing engine
 *
 * Two-tier expected-cost (EV) routing, ported from pi-shift-router's v1.4.x
 * router.ts:
 *
 *   θ      = 1 / R                  (R = economics.reworkPenalty)
 *   pSmart = c  (smart verdict) or 1 − c  (fast verdict)
 *   run smart  ⇔  pSmart ≥ θ / sameFamilyThetaFactor
 *
 *   - Upgrade (fast → smart): immediate on a decisive smart decision.
 *   - Downgrade (smart → fast): requires `economics.downgradeMemory`
 *     consecutive decisive fast decisions, and a cold cache when cache-aware
 *     routing applies.
 *   - Judge outage or a sub-`minConfidence` verdict is a HOLD: the router
 *     keeps the current tier and never fabricates evidence.
 *
 * `modelAvailable` is the DSH-side registry probe injected by index.ts
 * (ctx.llm-backed); everything else is pure and unit-testable.
 */

import type {
  JudgeResult,
  LastDecision,
  RouteAction,
  ShiftRouterConfig,
  Tier,
  WindowEntry,
  RouterState,
} from './types.js'
import {
  DEFAULT_SAME_FAMILY_PENALTY,
  LEGACY_SAME_FAMILY_PENALTY,
  LEGACY_SAME_FAMILY_THRESHOLD_DEFAULT,
  LEGACY_THRESHOLD_DEFAULT,
  TIERS,
} from './types.js'
import { findBestModelForTier, type ResolvedModel } from './tier.js'
import { createCooldowns, cooldownPredicate, findTierForModel } from './failover.js'
import { createOrchestrationState } from './orchestrate.js'

/** R (rework penalty) per named preset. Higher R → lower θ → stickier on Smart. */
export const ECONOMIC_MODE_PRESETS = { eco: 2, default: 3, sport: 5 } as const

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
    lastRequestProvider: null,
    lastRequestModel: null,
    upgradeCount: 0,
    downgradeCount: 0,
    lastActivityAt: 0,
    actualProvider: null,
    actualModel: null,
    lastDecision: null,
    lastAudit: null,
    tierUsage: {
      fast: emptyTierUsage(),
      smart: emptyTierUsage(),
    },
    callLog: [],
    orchestration: createOrchestrationState(),
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

// ─── EV economics (SPEC §3) ───────────────────────────────────────

/**
 * The effective rework penalty R. A named gear preset (`/router eco|default|
 * sport`) is authoritative over the manual `reworkPenalty` knob.
 */
export function effectiveReworkPenalty(config: ShiftRouterConfig): number {
  const mode = config.routing.economics.mode
  if (mode !== undefined) return ECONOMIC_MODE_PRESETS[mode]
  return config.routing.economics.reworkPenalty
}

/**
 * The LEGACY raw-θ override, or undefined when it is inert.
 *
 * A stored `window.threshold` equal to the pre-1.4.0 default is a wizard
 * snapshot, not a deliberate customization — reinterpreting it under the new
 * rule would silently change routing for every existing config.
 */
export function legacyThetaOverride(config: ShiftRouterConfig): number | undefined {
  const threshold = config.routing.window.threshold
  if (threshold === undefined) return undefined
  return threshold === LEGACY_THRESHOLD_DEFAULT ? undefined : threshold
}

/**
 * Cache-aware routing.
 *
 * A prompt cache belongs to a model; crossing a model boundary is a guaranteed
 * cache miss, and cache reads bill well below base input. When both tiers live
 * under the same provider, a mid-session downgrade can therefore cost more than
 * it saves.
 *
 * The penalty is expressed as a **divisor on the decision bar**: a smaller θ is
 * easier to clear, so fewer downgrades fire and the warm cache survives longer.
 * Returns 1 (inert) when the tiers are cross-family or cache-aware routing is
 * disabled.
 */
export function sameFamilyThetaFactor(
  config: ShiftRouterConfig,
  cacheAware: boolean = shareProviderFamily(config),
): number {
  if (!cacheAware) return 1
  const cache = config.routing.cacheAware
  if (!cache?.enabled) return 1
  // A non-default legacy threshold implies the strong penalty; the legacy
  // default value is inert.
  if (
    cache.sameFamilyThreshold !== undefined
    && cache.sameFamilyThreshold !== LEGACY_SAME_FAMILY_THRESHOLD_DEFAULT
  ) {
    return LEGACY_SAME_FAMILY_PENALTY
  }
  return cache.sameFamilyPenalty ?? DEFAULT_SAME_FAMILY_PENALTY
}

/** Detect whether the fast and smart tiers resolve to the same provider family. */
export function shareProviderFamily(config: ShiftRouterConfig): boolean {
  const fast = config.tiers.fast?.models ?? []
  const smart = config.tiers.smart?.models ?? []
  if (fast.length === 0 || smart.length === 0) return false
  const fastProviders = new Set(fast.map((m) => m.provider))
  return smart.some((m) => fastProviders.has(m.provider))
}

/** The decision bar for this moment: θ = 1/R, divided by the cache penalty. */
export function effectiveTheta(
  config: ShiftRouterConfig,
  cacheAware: boolean = shareProviderFamily(config),
): number {
  const base = legacyThetaOverride(config) ?? 1 / effectiveReworkPenalty(config)
  return base / sameFamilyThetaFactor(config, cacheAware)
}

/**
 * `pSmart` — the probability that this turn really needs the Smart tier.
 *
 * A `fast` verdict is evidence *against* smart, so it contributes `1 − c`:
 * a decisive fast verdict (c near 1) yields pSmart near 0. A missing
 * confidence reads as 1.0 (backward-compatible with prompts that omit it).
 */
export function pSmartOf(judgeResult: JudgeResult): number {
  const c = judgeResult.confidence ?? 1.0
  return judgeResult.tier === 'smart' ? c : 1 - c
}

/** Whether a verdict is decisive enough to act on. */
export function isDecisive(judgeResult: JudgeResult, config: ShiftRouterConfig): boolean {
  if (judgeResult.source === 'fallback') return false
  const minConfidence = config.routing.window.minConfidence ?? 0.5
  return (judgeResult.confidence ?? 1.0) >= minConfidence
}

// ─── Decision memory (SPEC §4) ────────────────────────────────────

/**
 * Consecutive decisive fast entries at the tail of the window. Any hold or
 * smart entry breaks the streak (a hold carries no signal, so it must not
 * extend — or be counted as — evidence for a downgrade).
 */
export function fastStreak(window: readonly WindowEntry[]): number {
  let streak = 0
  for (let i = window.length - 1; i >= 0; i--) {
    const entry = window[i]!
    if (entry.hold) break
    if (entry.tier !== 'fast') break
    streak += 1
  }
  return streak
}

/**
 * The downgrade requirement actually in force.
 *
 * The streak lives in the decision window, so a `downgradeMemory` larger than
 * `window.size` could never be satisfied — the router would be pinned to Smart
 * for the rest of the session with nothing saying why. The requirement
 * therefore saturates at the window size, and `downgradeMemoryCapped()` lets
 * the status output say so out loud instead of leaving a silent footgun.
 */
export function effectiveDowngradeMemory(config: ShiftRouterConfig): number {
  const configured = config.routing.economics.downgradeMemory
  const size = Math.max(1, config.routing.window.size)
  return Math.max(1, Math.min(configured, size))
}

/** True when `downgradeMemory` was capped to fit the window (worth surfacing). */
export function downgradeMemoryCapped(config: ShiftRouterConfig): boolean {
  return config.routing.economics.downgradeMemory > Math.max(1, config.routing.window.size)
}

/**
 * Downgrade gate: only from `smart`, only after
 * `effectiveDowngradeMemory()` consecutive decisive fast decisions.
 */
export function analyzeDowngrade(
  window: readonly WindowEntry[],
  currentTier: Tier,
  config: ShiftRouterConfig,
): { shouldDowngrade: boolean; targetTier: Tier | null } {
  if (currentTier !== 'smart') return { shouldDowngrade: false, targetTier: null }
  const need = effectiveDowngradeMemory(config)
  if (fastStreak(window) >= need) {
    return { shouldDowngrade: true, targetTier: 'fast' }
  }
  return { shouldDowngrade: false, targetTier: null }
}

/**
 * Session-boundary gate for cache-aware downgrades. A downgrade to another
 * model only forfeits the cache while the cache is warm — i.e. within
 * `idleBoundaryMs` of the last message. After an idle gap longer than the
 * provider's cache TTL, the cache is already cold and switching costs nothing
 * extra.
 *
 * Returns true when a downgrade is allowed right now (cache cold, or
 * cache-aware routing off / not applicable).
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

/** Push one entry and trim the window to `window.size`. */
function pushWindow(
  state: RouterState,
  entry: WindowEntry,
  config: ShiftRouterConfig,
): void {
  state.window.push(entry)
  const maxSize = config.routing.window.size
  if (state.window.length > maxSize) {
    state.window = state.window.slice(-maxSize)
  }
}

// ─── Core decision ────────────────────────────────────────────────

/**
 * Core routing decision:
 * 1. Manual override → use the forced model/tier.
 * 2. Judge unusable or non-decisive → hold position (no switch, no streak).
 * 3. EV: `pSmart ≥ θ_eff` → the turn wants Smart.
 * 4. fast → smart is immediate; the window is cleared.
 * 5. smart → fast needs `downgradeMemory` consecutive decisive fast turns and
 *    a cold cache.
 */
export function processRoute(
  judgeResult: JudgeResult,
  state: RouterState,
  config: ShiftRouterConfig,
  modelAvailable: (provider: string, model: string) => boolean,
  now: number = Date.now(),
): RouteDecision {
  // 1. Manual override
  if (state.manualOverride.active) {
    if (state.manualOverride.modelId && state.manualOverride.provider) {
      // The tier must be the forced model's OWN tier, never the raw verdict:
      // `/route-force <provider/model>` while the Judge says "smart" used to
      // report decisionTier 'smart' and could therefore start an orchestration
      // turn on a user-pinned model. Unknown models (not in any tier) fall back
      // to the current tier, which is the only thing the router can vouch for.
      const tier = state.manualOverride.tier
        ?? findTierForModel(config, state.manualOverride.provider, state.manualOverride.modelId)
        ?? state.currentTier
      const switchTo: ResolvedModel = {
        provider: state.manualOverride.provider,
        modelId: state.manualOverride.modelId,
        tier,
      }
      return { switchTo, action: 'manual', decisionTier: switchTo.tier, held: false }
    }
    if (state.manualOverride.tier) {
      const m = findBestModelForTier(state.manualOverride.tier, config, modelAvailable)
      if (m) return { switchTo: m, action: 'manual', decisionTier: m.tier, held: false }
    }
  }

  // 2. Hold: the Judge was unusable, or it is not confident enough to act.
  if (!isDecisive(judgeResult, config)) {
    pushWindow(state, {
      tier: judgeResult.tier,
      timestamp: now,
      confidence: judgeResult.confidence,
      hold: true,
    }, config)
    return { switchTo: null, action: 'stay', decisionTier: state.currentTier, held: true }
  }

  // 3. EV decision.
  const wantSmart = pSmartOf(judgeResult) >= effectiveTheta(config)

  // 4. Immediate upgrade.
  if (wantSmart && shouldUpgrade(state.currentTier, 'smart')) {
    const m = findBestModelForTier(
      'smart',
      config,
      modelAvailable,
      cooldownPredicate(state.modelCooldowns, now),
    )
    if (m) {
      // Clear the window on upgrade (fresh start for the new tier).
      state.window = []
      state.upgradeCount += 1
      return { switchTo: m, action: 'upgrade', decisionTier: 'smart', held: false }
    }
  }

  // 5. Record the decisive verdict.
  pushWindow(state, {
    tier: judgeResult.tier,
    timestamp: now,
    confidence: judgeResult.confidence,
  }, config)

  // 6. Gated downgrade. Cache-aware routing raises the bar (θ divisor) and
  //    suppresses switching entirely while the cache is still warm.
  if (!wantSmart) {
    const down = analyzeDowngrade(state.window, state.currentTier, config)
    if (down.shouldDowngrade && down.targetTier && downgradeAllowedAt(state, config, now)) {
      const m = findBestModelForTier(
        down.targetTier,
        config,
        modelAvailable,
        cooldownPredicate(state.modelCooldowns, now),
      )
      if (m) {
        state.downgradeCount += 1
        return { switchTo: m, action: 'downgrade', decisionTier: m.tier, held: false }
      }
    }
  }

  return { switchTo: null, action: 'stay', decisionTier: state.currentTier, held: false }
}

export interface RouteDecision {
  switchTo: ResolvedModel | null
  action: RouteAction
  /**
   * The tier this turn will actually run at, after EV + hold + manual
   * override. Consumers (orchestration entry, telemetry) must read this rather
   * than re-deriving a tier from the raw verdict.
   */
  decisionTier: Tier
  /** The Judge was unusable or non-decisive; the router held position. */
  held: boolean
}

/** Record a decision for display (`/router status`, GUI card). */
export function recordLastDecision(
  state: RouterState,
  judgeResult: JudgeResult,
  decision: RouteDecision,
  now: number = Date.now(),
): void {
  const last: LastDecision = {
    verdictTier: judgeResult.tier,
    action: decision.action,
    decisionTier: decision.decisionTier,
    held: decision.held,
    at: now,
  }
  if (judgeResult.confidence !== undefined) last.confidence = judgeResult.confidence
  if (judgeResult.reason !== undefined) last.reason = judgeResult.reason
  state.lastDecision = last
}

/**
 * Apply a model switch decision to the router state. The actual wire-model
 * override happens in the `agent/request` waterfall; this records which
 * tier/provider/model the router now owns — including a tier change between
 * two tiers that resolve to the same model id (strict model authority).
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

/**
 * dsh-shift-router — Router statistics snapshot
 *
 * Pure function that derives a snapshot from RouterState for the
 * `/router stats` command. No IO, no side effects.
 *
 * DSH adaptation: token counts come from assistant/message usage events;
 * USD spend is ESTIMATED from the optional `config.pricing` table because
 * DSH usage events carry no cost field. All fields stay 0 when pricing is
 * unconfigured.
 */

import type { RouterState, ShiftRouterConfig, Tier, TierUsage, TokenUsage, ModelPricing } from './types.js'

export interface CooldownInfo {
  provider: string
  model: string
  remainingMs: number
}

export interface ConfidenceBuckets {
  /** entries with confidence ≥ 0.7 */
  high: number
  /** entries with confidence ≥ minConfidence and < 0.7 */
  mid: number
  /** entries with confidence < minConfidence */
  low: number
  /** entries without a confidence value */
  none: number
}

/** Per-tier spend view exposed by `/router stats`. */
export interface TierSpendView {
  calls: number
  tokens: TokenUsage
  cost: number
}

/** Snapshot of the cost-telemetry view. */
export interface CostTelemetry {
  byTier: Record<Tier, TierSpendView>
  actualTotal: number
  /**
   * "What would this session have cost with no router — every turn running
   * on the user's configured Smart-tier model (priority 1)?"
   * = Σ over callLog of (tokens × smartModel pricing).
   * 0 when the Smart tier is unconfigured or pricing is missing.
   */
  baselineTotal: number
  savings: number
  /** Provider/model used as the baseline. null when no baseline computable. */
  baselineModel: { provider: string; modelId: string; pricing: { input: number; output: number; cacheRead?: number; cacheWrite?: number } } | null
}

export interface RouterStatsSnapshot {
  windowSize: number
  totalOutputTokens: number
  downgradeCount: number
  upgradeCount: number
  cooldownCount: number
  activeCooldowns: CooldownInfo[]
  confidence: ConfidenceBuckets
  /** Average of the last few tokens/sec readings. 0 when no readings. */
  avgTokensPerSec: number
  /** Most recent tokens/sec reading. 0 when none. */
  currentTokensPerSec: number
  cost: CostTelemetry
}

/**
 * Build a stats snapshot from the current router state.
 *
 * @param now  epoch ms used for cooldown expiry comparison (defaults to Date.now()).
 */
export function computeStats(
  state: RouterState,
  config: ShiftRouterConfig,
  now: number = Date.now(),
): RouterStatsSnapshot {
  // Confidence buckets
  const minConf = config.routing.window.minConfidence ?? 0.5
  const buckets: ConfidenceBuckets = { high: 0, mid: 0, low: 0, none: 0 }
  for (const e of state.window) {
    if (e.confidence === undefined) {
      buckets.none += 1
    } else if (e.confidence >= 0.7) {
      buckets.high += 1
    } else if (e.confidence >= minConf) {
      buckets.mid += 1
    } else {
      buckets.low += 1
    }
  }

  // Cooldowns
  const activeCooldowns: CooldownInfo[] = []
  for (const [key, entry] of state.modelCooldowns) {
    if (entry.until <= now) continue
    const [provider, ...rest] = key.split('/')
    activeCooldowns.push({
      provider: provider!,
      model: rest.join('/'),
      remainingMs: entry.until - now,
    })
  }

  // Speeds
  const speeds = state.recentSpeeds
  const currentTokensPerSec = speeds.length > 0 ? speeds[speeds.length - 1]! : 0
  const avgTokensPerSec = speeds.length > 0
    ? Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length)
    : 0

  // Cost telemetry
  const cost = computeCostTelemetry(state, config)

  return {
    windowSize: state.window.length,
    totalOutputTokens: state.totalOutputTokens,
    downgradeCount: state.downgradeCount,
    upgradeCount: state.upgradeCount,
    cooldownCount: activeCooldowns.length,
    activeCooldowns,
    confidence: buckets,
    avgTokensPerSec,
    currentTokensPerSec,
    cost,
  }
}

/**
 * Build the cost-telemetry view. Baseline = "what would this session have
 * cost with no router, every turn on the user's configured Smart-tier model
 * (priority 1)?" — the natural pre-router setup. Both actual and baseline
 * spend are estimated from `config.pricing`; without pricing both stay 0.
 */
export function computeCostTelemetry(
  state: RouterState,
  config: ShiftRouterConfig,
): CostTelemetry {
  const byTier: Record<Tier, TierSpendView> = {
    fast: cloneTierUsage(state.tierUsage.fast),
    smart: cloneTierUsage(state.tierUsage.smart),
  }

  const actualTotal = byTier.fast.cost + byTier.smart.cost

  // Baseline model = the Smart tier's highest-priority entry — the model
  // the user would have used for every turn before installing the router.
  let baseline: CostTelemetry['baselineModel'] = null
  const smartModels = [...(config.tiers?.smart?.models ?? [])].sort(
    (a, b) => a.priority - b.priority,
  )
  const ref = smartModels[0]
  if (ref) {
    const pricing = getModelPricing(config.pricing, ref.provider, ref.model)
    if (pricing) {
      baseline = { provider: ref.provider, modelId: ref.model, pricing }
    }
  }

  let baselineTotal = 0
  if (baseline) {
    for (const rec of state.callLog) {
      baselineTotal +=
        (rec.tokens.input / 1_000_000) * baseline.pricing.input +
        (rec.tokens.output / 1_000_000) * baseline.pricing.output +
        (rec.tokens.cacheRead / 1_000_000) * (baseline.pricing.cacheRead ?? 0) +
        (rec.tokens.cacheWrite / 1_000_000) * (baseline.pricing.cacheWrite ?? 0)
    }
  }

  return {
    byTier,
    actualTotal,
    baselineTotal,
    // Savings is only meaningful when we have a baseline; otherwise leave
    // it at 0 so display code can rely on "savings >= 0 ⇒ real baseline".
    savings: baseline ? baselineTotal - actualTotal : 0,
    baselineModel: baseline,
  }
}

/** Look up pricing (USD per 1M tokens) for a model in the config table. */
export function getModelPricing(
  pricing: ModelPricing[] | undefined,
  provider: string,
  modelId: string,
): { input: number; output: number; cacheRead?: number; cacheWrite?: number } | null {
  const entry = (pricing ?? []).find((p) => p.provider === provider && p.model === modelId)
  if (!entry) return null
  return {
    input: entry.input,
    output: entry.output,
    ...(entry.cacheRead !== undefined ? { cacheRead: entry.cacheRead } : {}),
    ...(entry.cacheWrite !== undefined ? { cacheWrite: entry.cacheWrite } : {}),
  }
}

/** Estimate USD for one message's token usage under a pricing row. */
export function estimateCost(
  pricing: { input: number; output: number; cacheRead?: number; cacheWrite?: number } | null,
  tokens: TokenUsage,
): number {
  if (!pricing) return 0
  return (
    (tokens.input / 1_000_000) * pricing.input +
    (tokens.output / 1_000_000) * pricing.output +
    (tokens.cacheRead / 1_000_000) * (pricing.cacheRead ?? 0) +
    (tokens.cacheWrite / 1_000_000) * (pricing.cacheWrite ?? 0)
  )
}

function cloneTierUsage(u: TierUsage): TierSpendView {
  return {
    calls: u.calls,
    tokens: {
      input: u.tokens.input,
      output: u.tokens.output,
      cacheRead: u.tokens.cacheRead,
      cacheWrite: u.tokens.cacheWrite,
    },
    cost: u.cost,
  }
}

/** Format ms as human-readable duration (e.g. "3m12s"). */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '0s'
  const totalSec = Math.ceil(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return m > 0 ? `${m}m${s}s` : `${s}s`
}

/** Format a USD spend value with adaptive precision (e.g. $0.0012 / $3.45). */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '$0'
  if (value === 0) return '$0'
  if (value < 0.01) return `$${value.toFixed(4)}`
  if (value < 1) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}

/** Format a router stats snapshot for display in `/router stats`. */
export function formatStats(
  state: RouterState,
  config: ShiftRouterConfig,
  now: number = Date.now(),
): string {
  const s = computeStats(state, config, now)
  const lines: string[] = []

  lines.push(`Tier: ${state.currentTier} / ${state.currentProvider ?? '?'}/${state.currentModelId ?? '?'}`)
  lines.push(`Judge: 🧭 ${judgeModelDisplay(config)}`)
  lines.push(`Window: ${s.windowSize} entries (confidence: high=${s.confidence.high} mid=${s.confidence.mid} low=${s.confidence.low} none=${s.confidence.none})`)
  lines.push(`Transitions: ↑upgrade=${s.upgradeCount} ↓downgrade=${s.downgradeCount}`)
  lines.push(`Tokens: total ${s.totalOutputTokens.toLocaleString()} | speed current=${s.currentTokensPerSec} avg=${s.avgTokensPerSec} tok/s`)

  // ── Cost telemetry block ────────────────────────────────────────────
  const c = s.cost
  lines.push(`Spend: fast ${formatUsd(c.byTier.fast.cost)} (${c.byTier.fast.calls} calls) · smart ${formatUsd(c.byTier.smart.cost)} (${c.byTier.smart.calls} calls) · total ${formatUsd(c.actualTotal)}`)
  if (c.baselineModel) {
    lines.push(`  baseline: all-turns-on-smart (${c.baselineModel.provider}/${c.baselineModel.modelId}) → ${formatUsd(c.baselineTotal)} · saved ${formatUsd(c.savings)}`)
  } else if (c.actualTotal > 0) {
    lines.push(`  baseline: unavailable (Smart tier unconfigured or no pricing in config)`)
  }
  const fmtTok = (t: TokenUsage) => `${t.input.toLocaleString()} in / ${t.output.toLocaleString()} out`
  lines.push(`  fast tokens: ${fmtTok(c.byTier.fast.tokens)}`)
  lines.push(`  smart tokens: ${fmtTok(c.byTier.smart.tokens)}`)

  return lines.join('\n')
}

/**
 * Human-readable Judge model line. The Judge runs on the fast tier's
 * highest-priority model; when the fast tier is empty it falls back to the
 * cheapest globally-priced model, which we can't resolve here — so we show
 * the configured fast chain instead.
 */
export function judgeModelDisplay(config: ShiftRouterConfig): string {
  const fastModels = [...(config.tiers?.fast?.models ?? [])].sort(
    (a, b) => a.priority - b.priority,
  )
  if (fastModels.length === 0) return '(fast tier empty — judge unavailable, holding fast)'
  return fastModels.map((m) => `${m.provider}/${m.model}`).join(', ')
}

/**
 * dsh-shift-router — Tier management
 *
 * Handles model lookup across tiers and priority-based fallback. The DSH
 * adaptation replaces pi's modelRegistry.find with a `modelAvailable`
 * predicate backed by ctx.llm (registered adapter + resolvable model).
 */

import type { ShiftRouterConfig, Tier } from './types.js'
import { TIERS } from './types.js'

/** Resolved model info with its tier */
export interface ResolvedModel {
  provider: string
  modelId: string
  tier: Tier
}

/**
 * Find the best available model for a given tier.
 * Searches the tier's models in priority order, skipping cooldown.
 *
 * @param modelAvailable  DSH-side registry probe (ctx.llm.resolveModelInfo in
 *   try/catch). Returns true when the provider/model route is usable.
 * @param isCooldown      Optional predicate; when provided, models for which
 *   it returns true are skipped.
 */
export function findBestModelForTier(
  tier: Tier,
  config: ShiftRouterConfig,
  modelAvailable: (provider: string, model: string) => boolean,
  isCooldown?: (provider: string, modelId: string) => boolean,
): ResolvedModel | null {
  const tierConfig = config.tiers[tier]
  if (!tierConfig?.models?.length) return null

  const sorted = [...tierConfig.models].sort((a, b) => a.priority - b.priority)

  for (const ref of sorted) {
    try {
      if (isCooldown?.(ref.provider, ref.model)) continue
      if (modelAvailable(ref.provider, ref.model)) {
        return { provider: ref.provider, modelId: ref.model, tier }
      }
    } catch {
      continue
    }
  }

  return null
}

/** Check if a tier is valid */
export function isValidTier(s: string): s is Tier {
  return TIERS.includes(s as Tier)
}

/** Get display label for a tier */
export function tierLabel(tier: Tier, config: ShiftRouterConfig): string {
  const cfg = config.tiers[tier]
  return cfg?.label || tier.charAt(0).toUpperCase() + tier.slice(1)
}

/** Get emoji for a tier */
export function tierEmoji(tier: Tier): string {
  switch (tier) {
    case 'smart':
      return '🧠'
    case 'fast':
      return '🦾'
  }
}

/** Format tier for display: "[🧠 kimi-k3]" */
export function formatTierDisplay(
  tier: Tier | null,
  modelId: string | null,
): string {
  if (!tier) return ''
  const emoji = tierEmoji(tier)
  const model = modelId?.split('/').pop() ?? '…'
  return `[${emoji} ${model}]`
}

/**
 * Like formatTierDisplay but appends a tokens-per-second indicator when positive.
 * E.g. "[🧠 kimi-k3 • 23 tok/s]".
 */
export function formatTierDisplayWithSpeed(
  tier: Tier | null,
  modelId: string | null,
  tokensPerSec: number,
): string {
  const base = formatTierDisplay(tier, modelId)
  if (!base || tokensPerSec <= 0) return base
  return `${base} • ${tokensPerSec} tok/s`
}

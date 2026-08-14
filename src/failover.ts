/**
 * dsh-shift-router — Runtime failover
 *
 * Exponential-backoff cooldown state machine for models that fail at
 * runtime (429 / 5xx / quota exhausted). When the harness's own retry layer
 * (dsh-llm-retry) gives up on a model, `agent/request-error` marks it into
 * cooldown and the next `agent/request` re-resolves the same tier to the next
 * healthy model (no cross-tier). All functions here are pure.
 *
 * Ported from pi-shift-router's failover.ts, with `detectFailoverError`
 * adapted to DSH's `LlmFailure` facts (code/status/message) instead of raw
 * HTTP bodies.
 */

import type { LlmFailure } from '@deepseek-ai/dsh-llm'
import type { ShiftRouterConfig, Tier } from './types.js'

/** Cooldown base delay: 1 minute. */
export const COOLDOWN_BASE_MS = 60_000
/** Hard cap on backoff: 6 hours. */
export const COOLDOWN_MAX_MS = 6 * 60 * 60_000
/**
 * Starting attempt count for 4xx failures (429 rate limits, quota).
 * Client-side limits typically persist far longer than transient 5xx
 * server errors, so skip the first two tiers and start at 16m instead
 * of 1m. 5xx keeps the 1m start for fast recovery.
 */
export const COOLDOWN_START_ATTEMPTS_4XX = 3 // BASE * 4^2 = 16m

/**
 * Tunable failover policy — the Config-backed replacement for the module
 * constants above. Functions accept an optional policy and fall back to the
 * constants so pure callers (and tests) keep working unchanged.
 */
export interface FailoverPolicy {
  baseMs: number
  maxMs: number
  startAttempts4xx: number
}

/** The module-constant policy, used as the default. */
export const DEFAULT_FAILOVER_POLICY: FailoverPolicy = {
  baseMs: COOLDOWN_BASE_MS,
  maxMs: COOLDOWN_MAX_MS,
  startAttempts4xx: COOLDOWN_START_ATTEMPTS_4XX,
}

/** One cooldown entry: when it expires + how many consecutive failures. */
export interface CooldownEntry {
  until: number
  attempts: number
}

/** Cooldown map: modelKey → entry. */
export type CooldownMap = Map<string, CooldownEntry>

/** Create an empty cooldown map. */
export function createCooldowns(): CooldownMap {
  return new Map()
}

/** Uniquely identify a provider/model pair. */
export function modelKey(provider: string, model: string): string {
  return `${provider}/${model}`
}

/**
 * Record a failure and apply exponential backoff:
 * backoff = base * 4^(attempts-1), capped at maxMs.
 *
 * 4xx failures (429 / quota) skip the first two tiers and start at 16m:
 * client limits usually outlive server-side blips. `code` is the failover
 * signature ("429", "503", "RATE_LIMIT", …); omitted or 5xx keeps the 1m start.
 * `policy` tunes the ladder (defaults to the module constants).
 */
export function markModelFailed(
  cooldowns: CooldownMap,
  provider: string,
  model: string,
  now: number,
  code?: string,
  policy: FailoverPolicy = DEFAULT_FAILOVER_POLICY,
): void {
  const key = modelKey(provider, model)
  const prev = cooldowns.get(key)
  const is4xx = !!code && code.startsWith('4')
  const attempts = Math.max(
    (prev?.attempts ?? 0) + 1,
    is4xx ? policy.startAttempts4xx : 1,
  )
  const backoff = Math.min(policy.baseMs * 4 ** (attempts - 1), policy.maxMs)
  cooldowns.set(key, { until: now + backoff, attempts })
}

/** True if the model is currently in cooldown (not yet expired). */
export function isModelInCooldown(
  cooldowns: CooldownMap | undefined,
  provider: string,
  model: string,
  now: number,
): boolean {
  if (!cooldowns) return false
  const e = cooldowns.get(modelKey(provider, model))
  return !!e && e.until > now
}

/** Remove a model from cooldown (recovery). */
export function clearModelCooldown(
  cooldowns: CooldownMap,
  provider: string,
  model: string,
): void {
  cooldowns.delete(modelKey(provider, model))
}

/** Milliseconds until the model's cooldown expires (0 if not cooling). */
export function remainingCooldownMs(
  cooldowns: CooldownMap,
  provider: string,
  model: string,
  now: number,
): number {
  if (!isModelInCooldown(cooldowns, provider, model, now)) return 0
  const e = cooldowns.get(modelKey(provider, model))!
  return e.until - now
}

/** DSH canonical codes that map to a failover-worthy transient failure. */
const CANONICAL_FAILOVER_CODES = new Set(['RATE_LIMIT', 'SERVER', 'QUOTA'])

/**
 * Detect whether an LlmFailure indicates a transient provider failure worth
 * failing over. Returns the detected code (for user feedback + cooldown
 * tiering) or null when the failure is not failover-worthy (auth/config
 * errors, context overflow, network, …).
 *
 * Detection order:
 *   1. DSH canonical codes (RATE_LIMIT / SERVER / QUOTA).
 *   2. HTTP status on the failure: 429 and 5xx are transient.
 *   3. Message keywords (rate limit / quota / token plan) — covers adapters
 *      that fold the provider code into the message.
 */
export function detectFailoverError(failure: LlmFailure | undefined | null): { code: string } | null {
  if (!failure) return null
  if (CANONICAL_FAILOVER_CODES.has(failure.code)) return { code: failure.code }

  const status = failure.status
  if (status !== undefined) {
    if (status === 429) return { code: '429' }
    if (status >= 500 && status < 600) return { code: String(status) }
  }

  const text = (failure.message ?? '').trim()
  if (!text) return null
  if (
    /rate[_ -]?limit/i.test(text)
    || /too many requests/i.test(text)
    || /quota/i.test(text)
    || /insufficient[_ -]?quota/i.test(text)
    || /token\s*plan/i.test(text)
    || /用量上限/i.test(text)
    || /rate_limit_error/i.test(text)
    || /exceeded[_ -]?(?:your|the)?[_ -]?(?:current)?[_ -]?quota/i.test(text)
  ) {
    return { code: '429' }
  }

  const statusMatch = text.match(
    /(?:error|http|status|code)[^\n]{0,12}\b(429|50[0-9]|51[0-9]|52[0-9])\b/i,
  )
  if (statusMatch) return { code: statusMatch[1]! }

  return null
}

/**
 * Find the next healthy model for a tier, skipping:
 *   1. the model that just failed (skipKey), and
 *   2. any model currently in cooldown.
 * Never crosses tiers.
 *
 * `modelAvailable` is the DSH-side registry probe (ctx.llm.resolveModelInfo
 * wrapped in try/catch) — mirrors pi's modelRegistry.find.
 */
export function findFailoverModel(
  tier: Tier,
  config: ShiftRouterConfig,
  modelAvailable: (provider: string, model: string) => boolean,
  cooldowns: CooldownMap | undefined,
  now: number,
  skipKey?: string,
): { provider: string; modelId: string; tier: Tier } | null {
  const tierConfig = config.tiers?.[tier]
  if (!tierConfig?.models?.length) return null

  const sorted = [...tierConfig.models].sort((a, b) => a.priority - b.priority)

  for (const ref of sorted) {
    if (ref.provider === undefined || ref.model === undefined) continue
    if (skipKey && modelKey(ref.provider, ref.model) === skipKey) continue
    if (isModelInCooldown(cooldowns, ref.provider, ref.model, now)) continue
    try {
      if (modelAvailable(ref.provider, ref.model)) {
        return { provider: ref.provider, modelId: ref.model, tier }
      }
    } catch {
      continue
    }
  }

  return null
}

/**
 * Build a cooldown-aware predicate for findBestModelForTier.
 * Returns undefined when no cooldowns are active (fast path).
 */
export function cooldownPredicate(
  cooldowns: CooldownMap | undefined,
  now: number,
): ((provider: string, model: string) => boolean) | undefined {
  if (!cooldowns || cooldowns.size === 0) return undefined
  return (provider: string, model: string) =>
    isModelInCooldown(cooldowns, provider, model, now)
}

/** Format remaining cooldown for display: "3m12s". */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return '0s'
  const totalSec = Math.ceil(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return m > 0 ? `${m}m${s}s` : `${s}s`
}

/** Max number of recent speed samples kept for averaging. */
export const SPEED_WINDOW_SIZE = 5

/**
 * Compute tokens-per-second from elapsed ms and output tokens.
 * Returns 0 when elapsed ≤ 0 or output_tokens ≤ 0.
 */
export function tokensPerSecond(outputTokens: number, elapsedMs: number): number {
  if (elapsedMs <= 0 || outputTokens <= 0) return 0
  return Math.round((outputTokens / elapsedMs) * 1000)
}

/** Push a new speed reading into the sliding window (evict oldest beyond limit). */
export function recordSpeed(speeds: number[], tps: number, windowSize: number = SPEED_WINDOW_SIZE): void {
  speeds.push(tps)
  while (speeds.length > windowSize) speeds.shift()
}

/**
 * Reverse-lookup: which tier does a provider/model belong to?
 * Returns null when ambiguous (in both tiers) or unknown.
 */
export function findTierForModel(
  config: ShiftRouterConfig,
  provider: string,
  model: string,
): Tier | null {
  const inFast = config.tiers?.fast?.models?.some(
    (m) => m.provider === provider && m.model === model,
  )
  const inSmart = config.tiers?.smart?.models?.some(
    (m) => m.provider === provider && m.model === model,
  )
  if (inFast && inSmart) return null // ambiguous — caller decides
  if (inFast) return 'fast'
  if (inSmart) return 'smart'
  return null
}

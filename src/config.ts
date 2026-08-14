/**
 * dsh-shift-router — Schemastery configuration schema
 *
 * The plugin reads its configuration from the cordis.yml row (and, when the
 * user edits it, from the GUI settings section registered at load). Every
 * field carries a default so an empty config row is a fully working no-op.
 */

import z from '@deepseek-ai/schemastery'
import type { ShiftRouterConfig } from './types.js'

/** Model reference: provider + model id + priority (lower wins). */
export const ModelRefSchema = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  priority: z.number().default(1),
})

export const TierConfigSchema = z.object({
  label: z.string().default(''),
  models: z.array(ModelRefSchema).default([]),
  description: z.string().default(''),
})

/** Deep-merge two configs (arrays replaced). */
export function deepMergeConfig(
  base: ShiftRouterConfig,
  override: Partial<ShiftRouterConfig>,
): ShiftRouterConfig {
  const merged: ShiftRouterConfig = structuredClone(base)
  applyPartial(merged as unknown as Record<string, unknown>, override as unknown as Record<string, unknown>)
  return merged
}

function applyPartial(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    const targetValue = target[key]
    if (
      value !== null
      && typeof value === 'object'
      && !Array.isArray(value)
      && targetValue !== null
      && typeof targetValue === 'object'
      && !Array.isArray(targetValue)
    ) {
      applyPartial(targetValue as Record<string, unknown>, value as Record<string, unknown>)
    } else {
      target[key] = value
    }
  }
}

/**
 * The plugin's Cordis configuration schema. Every field has a default, and the
 * schema resolves the same shape that `apply(ctx, config)` receives.
 */
export const Config: z<ShiftRouterConfig> = z.object({
  enabled: z.boolean().default(true),
  tiers: z.object({
    fast: TierConfigSchema,
    smart: TierConfigSchema,
  }).default({} as never),
  routing: z.object({
    mode: z.union(['auto', 'manual', 'off']).default('auto'),
    judgeTimeout: z.number().default(5000),
    window: z.object({
      size: z.number().default(5),
      threshold: z.number().default(0.6),
      minConfidence: z.number().default(0.5),
    }).default({} as never),
    cacheAware: z.object({
      enabled: z.boolean().default(true),
      sameFamilyThreshold: z.number().default(0.9),
      idleBoundaryMs: z.number().default(5 * 60_000),
    }).default({} as never),
  }).default({} as never),
  ux: z.object({
    quietMode: z.boolean().default(false),
    routerLogVerbose: z.boolean().default(false),
  }).default({} as never),
  orchestration: z.object({
    mode: z.union(['auto', 'off']).default('auto'),
    maxRounds: z.number().default(3),
    escalationThreshold: z.number().default(2),
    requireSmartModel: z.boolean().default(true),
  }).default({} as never),
  pricing: z.array(z.object({
    provider: z.string().required(),
    model: z.string().required(),
    input: z.number().default(0),
    output: z.number().default(0),
    cacheRead: z.number(),
    cacheWrite: z.number(),
  })).default([]),
})

/**
 * dsh-shift-router — Schemastery configuration schema
 *
 * The plugin reads its configuration from the cordis.yml row (and, when the
 * user edits it, from the GUI settings section registered at load). Every
 * field carries a default so an empty config row is a fully working no-op,
 * and numeric fields carry range constraints so invalid configuration fails
 * loudly at load instead of silently misbehaving.
 */

import z from '@deepseek-ai/schemastery'
import { DEFAULT_SAME_FAMILY_PENALTY, type ShiftRouterConfig } from './types.js'

/** Model reference: provider + model id + priority (lower wins). */
export const ModelRefSchema = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  priority: z.natural().default(1),
})

export const TierConfigSchema = z.object({
  label: z.string().default(''),
  models: z.array(ModelRefSchema).default([]),
  description: z.string().default(''),
})

const WindowSchema = z.object({
  size: z.natural().min(1).max(100).default(5),
  /**
   * LEGACY raw-θ override. Optional on purpose: an absent (or legacy-default)
   * value means θ = 1/reworkPenalty, and writing the legacy default back must
   * not look like a deliberate override.
   */
  threshold: z.percent(),
  minConfidence: z.percent().default(0.5),
})

const EconomicsSchema = z.object({
  reworkPenalty: z.number().min(1).default(3),
  downgradeMemory: z.natural().min(1).max(100).default(2),
  mode: z.union(['eco', 'default', 'sport']),
})

const CacheAwareSchema = z.object({
  enabled: z.boolean().default(true),
  sameFamilyPenalty: z.number().min(1).default(DEFAULT_SAME_FAMILY_PENALTY),
  idleBoundaryMs: z.natural().min(0).default(5 * 60_000),
  /** LEGACY: a non-default value implies the strong penalty (3.0). */
  sameFamilyThreshold: z.percent(),
})

const JudgeDecisionSchema = z.object({
  /**
   * Empty is the "not configured" state, and it must be a *value* rather than a
   * required field: the nested object always resolves (so an empty config row
   * stays a working no-op), and `decision` mode with no URL is simply unusable
   * — the ladder then uses rung 2 instead of failing the plugin load.
   */
  baseUrl: z.string().default(''),
  model: z.string().default('jev-latest'),
  /** A credential *reference* (POSIX name); `''` = ambient authentication. */
  apiKeyRef: z.string().default(''),
})

const JudgeSchema = z.object({
  /**
   * Deliberately **no default**: absence is load-bearing here. A stored
   * `models` list with no `mode` is the pre-0.7.0 shape and must be inferable as
   * `custom`; a schema default would fill `fast-chain` in and make the list
   * silently inert. `normalizeJudgeMode()` supplies the effective value
   * (`fast-chain`) for every other case, including an unknown one.
   */
  mode: z.union(['fast-chain', 'custom', 'decision']),
  models: z.array(ModelRefSchema).default([]),
  decision: JudgeDecisionSchema,
})

const RoutingSchema = z.object({
  mode: z.union(['auto', 'manual', 'off']).default('auto'),
  judgeTimeout: z.natural().min(1).max(120_000).default(5000),
  judgeMaxTokens: z.natural().min(1).max(100_000).default(4000),
  judgePromptCap: z.natural().min(1).max(1_000_000).default(6000),
  judge: JudgeSchema,
  economics: EconomicsSchema,
  window: WindowSchema,
  cacheAware: CacheAwareSchema,
})

const UXSchema = z.object({
  routerLogVerbose: z.boolean().default(false),
  // Any finite number: DSH's own section slots live in SECTION_ORDERS
  // (dsh-system-prompt) and third-party sections are not in it, so there is no
  // platform constant to default to. 150 = after the persona prefix (0),
  // before PLAN_POLICY (500).
  promptSectionOrder: z.number().default(150),
})

const AuditSchema = z.object({
  enabled: z.boolean().default(true),
  timeoutMs: z.natural().min(1).max(120_000).default(5000),
  promptCap: z.natural().min(200).max(1_000_000).default(6000),
})

const OrchestrationSchema = z.object({
  mode: z.union(['auto', 'off']).default('auto'),
  maxRounds: z.natural().min(0).max(100).default(3),
  escalationThreshold: z.natural().min(1).max(100).default(2),
  // 0 = no budget guard (the default: a routing layer must not impose a
  // monetised cap unless the deployment asks for one).
  maxSpendUsd: z.number().min(0).default(0),
  workerLedgerCap: z.natural().min(1).max(1000).default(20),
  audit: AuditSchema,
})

const FailoverSchema = z.object({
  baseMs: z.natural().min(100).default(60_000),
  maxMs: z.natural().min(1_000).default(6 * 60 * 60_000),
  startAttempts4xx: z.natural().min(1).max(20).default(3),
})

const TelemetrySchema = z.object({
  callLogCap: z.natural().min(10).max(1_000_000).default(1000),
})

const PricingSchema = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  input: z.natural().default(0),
  output: z.natural().default(0),
  cacheRead: z.natural(),
  cacheWrite: z.natural(),
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
 * The plugin's Cordis configuration schema. Every leaf carries a default, so
 * an empty config row resolves to a fully working no-op (missing nested
 * objects are filled by their leaf defaults — no `.default({})` hacks
 * needed). Numeric fields are range-constrained so bad config fails load.
 *
 * Every TOP-LEVEL field is marked `.volatile()` because that is what puts this
 * entry into the Host settings document at all: `@deepseek-ai/dsh-settings`
 * 0.2.0-rc.2 serves a namespace only when its `Config` projects a **volatile**
 * form (`volatileForm(schema)` returns undefined for a schema with no volatile
 * node, and `describe()` then omits the entry). 0.1.5-rc.x had no such
 * requirement — its `settings.register(ns, schema, { base })` made the whole
 * namespace a form — so this is the one schema change that migration needs.
 *
 * The granularity is deliberate, and it is one level, not the root and not the
 * leaves:
 *
 * - **Not the root.** A volatile root makes `entry.fiber.config` a reference
 *   instead of the config object. The loader and the session path accept that
 *   at boot — `apply` still runs to completion — but the first turn never
 *   starts: the process ends up idle with the pre-step hook untouched. See
 *   ALIGNMENT §R15.8 for the measurement.
 * - **Not the leaves.** The card writes one whole top-level section per save
 *   (`form-model.ts` builds a patch per section), and `SettingsForms.write`
 *   rejects any path whose node is not volatile
 *   (`Config field "routing" is not volatile`). A leaf-only form would carry
 *   only the leaves, so the section path would fail the check.
 * - **Sections** satisfy both: `isVolatilePath()` accepts `[section]` and
 *   everything under it, `projectForm` still projects the section's full nested
 *   object, and no volatile node sits inside another (schemastery rejects that:
 *   "volatile fields require a fixed object path without an enclosing volatile
 *   field").
 */

/**
 * Whether this schemastery can carry a volatile form at all.
 *
 * `@deepseek-ai/schemastery` grew `.volatile()` in 3.18.4, which is what the
 * 0.2.0-rc.2 carrier ships; 3.18.2, which the 0.1.5-rc.2 carrier ships, does
 * not. Calling a missing method while the module evaluates would fail the
 * WHOLE plugin tree instead of just the settings page — the packed install in
 * CI failed exactly that way, and not a single unit test or `tsc` saw it,
 * because the devDependency tree always carries the newer library.
 *
 * So probe the method and degrade: on a library without it the schema stays
 * plain. That is the right degradation, because `@deepseek-ai/dsh-settings` on
 * that generation serves no namespace unless a section is installed anyway —
 * the card's legacy surface is what covers those shells (`legacy-slot.ts`), and
 * the router itself is unaffected.
 */
/**
 * Whether a schemastery module offers `.volatile()`.
 *
 * Probing a prototype rather than assuming a version number keeps this honest
 * when the carrier moves again, and it is what makes the degradation testable:
 * {@link supportsVolatile} is a pure predicate over the object it is handed, so
 * a test can drive both branches without swapping the library.
 * @param target - the schema constructor's prototype, or anything.
 * @returns true only when the prototype really has a callable `volatile`.
 */
export function supportsVolatile(target: unknown): boolean {
  if (target === undefined || target === null) return false
  return typeof (target as { volatile?: unknown }).volatile === 'function'
}

const CAN_VOLATILE = supportsVolatile((z as unknown as { prototype?: unknown }).prototype)

/**
 * Mark one top-level SECTION volatile, or leave it plain.
 *
 * The mark is what makes `entry.fiber.config`'s field a live reference, and the
 * granularity is a section because that is what both consumers need: the Host's
 * `isVolatilePath()` accepts `[section]` and everything under it (so the card's
 * per-section writes are accepted), and `projectForm` still projects the
 * section's whole nested object (so the browser gets every field, not only the
 * leaves). Marking the ROOT instead hangs the headless first turn, and marking
 * leaves only makes the section path fail the check — both are in
 * ALIGNMENT §R15.8 with the measurements.
 *
 * A library without `.volatile()` keeps every field plain, which is the right
 * degradation: on a carrier whose `dsh-settings` serves no namespace, the card
 * falls back to its legacy surface rather than losing the plugin tree.
 */
const markVolatile = <T>(schema: T): T =>
  CAN_VOLATILE ? ((schema as unknown as { volatile(): T }).volatile() as unknown as T) : schema

export const Config = z.object({
  enabled: markVolatile(z.boolean().default(true)),
  tiers: markVolatile(z.object({
    fast: TierConfigSchema,
    smart: TierConfigSchema,
  })),
  routing: markVolatile(RoutingSchema),
  ux: markVolatile(UXSchema),
  orchestration: markVolatile(OrchestrationSchema),
  failover: markVolatile(FailoverSchema),
  telemetry: markVolatile(TelemetrySchema),
  pricing: markVolatile(z.array(PricingSchema).default([])),
})

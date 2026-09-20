/**
 * dsh-shift-router — Slash commands
 *
 * /router          — Show status, enable/disable, orchestration mode
 * /route-force     — Manual override for the next turn
 *
 * DSH adaptation: commands register through `ctx.commands.register()` (the
 * `dsh-commands` service) instead of pi's ExtensionAPI.registerCommand. The
 * TUI config wizard becomes a DSH-native interactive editor: `/router config
 * set|set-fast|set-smart|reset` persists into the `shift-router` settings
 * namespace (the same namespace renders as a form in the GUI settings panel),
 * so configuration is editable from both surfaces.
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { EconomicMode, ShiftRouterConfig, RouterState, Tier } from './types.js'
import { LEGACY_SAME_FAMILY_THRESHOLD_DEFAULT, TIERS } from './types.js'
import {
  isValidTier,
  tierEmoji,
  tierLabel,
  formatTierDisplay,
} from './tier.js'
import {
  clearManualOverride as clearOverride,
  setManualOverrideModel as setOverrideModel,
  setManualOverrideTier as setOverrideTier,
  shareProviderFamily,
  effectiveReworkPenalty,
  effectiveTheta,
  legacyThetaOverride,
  sameFamilyThetaFactor,
  effectiveDowngradeMemory,
  downgradeMemoryCapped,
} from './router.js'
import {
  resetOrchestration,
  formatWorkerModelSelection,
  formatOrchestrationSpend,
  type WorkerModelSelection,
} from './orchestrate.js'
import { formatStats } from './stats.js'
import { formatRemaining } from './failover.js'

/** Runtime surface the commands need; index.ts wires it. */
export interface CommandDeps {
  getConfig(): ShiftRouterConfig
  getState(agent: Agent): RouterState | undefined
  onConfigChanged(): void
  setManualOverrideTier(agent: Agent, tier: Tier): void
  setManualOverrideModel(agent: Agent, provider: string, model: string): void
  clearManualOverride(agent: Agent): void
  subagentAvailable(): boolean
  /**
   * What the harness reports about model-selectable subagent delegation, or
   * undefined when the composition mounts no such service (SPEC §7.4). Read
   * through a probe, never as a bare `ctx.subagentModelSelection`.
   */
  workerModelSelection(): WorkerModelSelection | undefined
  /**
   * Persist a partial patch into the shift-router settings namespace.
   * Resolves null on success, or a human-readable failure reason.
   */
  updateSettings(patch: Record<string, unknown>): Promise<string | null>
  /**
   * Reset the shift-router settings namespace to the composition base.
   * Resolves null on success, or a human-readable failure reason.
   */
  resetSettings(): Promise<string | null>
  /**
   * Apply path-addressed edits (set/unset) to the user section — the official
   * write path for clearing a single override. Resolves null on success or a
   * human-readable failure reason.
   */
  mutateSettings(ops: readonly SettingsPathOp[]): Promise<string | null>
  /**
   * The raw user section of the shift-router namespace (the overrides the
   * user actually set), or undefined while settings are unavailable or the
   * user has never written anything.
   */
  userSettings(): Record<string, unknown> | undefined
  /** Registered provider routes (ctx.llm.listProviders ids). */
  listProviders(): string[]
  /** Model ids a provider adapter advertises. */
  listModels(provider: string): Promise<string[]>
}

// ─── Editable-config field registry ────────────────────────────────
// The single source of truth for `/router config`'s numbered editor: every
// leaf the user can change, with its type (drives the value hint) and an
// optional enum/unit annotation.

export interface ConfigField {
  /** Dotted path inside the shift-router config. */
  path: string
  type: 'boolean' | 'number' | 'enum' | 'modelList' | 'pricing'
  /** Allowed values for `enum` fields. */
  enum?: readonly string[]
  /** Display hint, e.g. "ms", "[0,1]". */
  hint?: string
  /**
   * The field ships WITHOUT a value in `DEFAULT_CONFIG` — unset is its real
   * default (a preset selector that is off until chosen, or a compatibility
   * knob that must stay inert). The registry guard allows a missing value only
   * for fields flagged here.
   */
  optional?: true
  /**
   * A pre-EV knob kept so existing configs keep working. Implies `optional`,
   * and is annotated as legacy wherever the field is listed so nobody sets one
   * by accident.
   */
  legacy?: true
}

export const CONFIG_FIELDS: ConfigField[] = [
  { path: 'enabled', type: 'boolean' },
  { path: 'routing.mode', type: 'enum', enum: ['auto', 'manual', 'off'] },
  { path: 'routing.judgeTimeout', type: 'number', hint: 'ms' },
  { path: 'routing.judgeMaxTokens', type: 'number' },
  { path: 'routing.judgePromptCap', type: 'number' },
  { path: 'routing.economics.reworkPenalty', type: 'number', hint: '≥1' },
  { path: 'routing.economics.downgradeMemory', type: 'number', hint: 'turns' },
  { path: 'routing.economics.mode', type: 'enum', enum: ['eco', 'default', 'sport'], optional: true },
  { path: 'routing.window.size', type: 'number' },
  { path: 'routing.window.threshold', type: 'number', hint: '[0,1]', optional: true, legacy: true },
  { path: 'routing.window.minConfidence', type: 'number', hint: '[0,1]' },
  { path: 'routing.cacheAware.enabled', type: 'boolean' },
  { path: 'routing.cacheAware.sameFamilyPenalty', type: 'number', hint: '≥1' },
  { path: 'routing.cacheAware.sameFamilyThreshold', type: 'number', hint: '[0,1]', optional: true, legacy: true },
  { path: 'routing.cacheAware.idleBoundaryMs', type: 'number', hint: 'ms' },
  { path: 'orchestration.mode', type: 'enum', enum: ['auto', 'off'] },
  { path: 'orchestration.maxRounds', type: 'number' },
  { path: 'orchestration.escalationThreshold', type: 'number' },
  { path: 'orchestration.maxSpendUsd', type: 'number', hint: 'USD' },
  { path: 'orchestration.workerLedgerCap', type: 'number' },
  { path: 'failover.baseMs', type: 'number', hint: 'ms' },
  { path: 'failover.maxMs', type: 'number', hint: 'ms' },
  { path: 'failover.startAttempts4xx', type: 'number' },
  { path: 'telemetry.callLogCap', type: 'number' },
  { path: 'ux.routerLogVerbose', type: 'boolean' },
  { path: 'ux.promptSectionOrder', type: 'number' },
  { path: 'tiers.fast.models', type: 'modelList' },
  { path: 'tiers.smart.models', type: 'modelList' },
  { path: 'pricing', type: 'pricing' },
]

/** Read a dotted path from an object (undefined when absent). */
export function readPath(obj: unknown, path: string): unknown {
  let current: unknown = obj
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/** Human-readable display of one field's current value. */
export function formatFieldValue(value: unknown, type: ConfigField['type']): string {
  if (value === undefined || value === null) return '(unset)'
  if (type === 'modelList') {
    const list = Array.isArray(value) ? value as { provider?: string; model?: string }[] : []
    if (list.length === 0) return '(none)'
    return list.map((m) => `${m.provider}/${m.model}`).join(', ')
  }
  if (Array.isArray(value)) return JSON.stringify(value)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * Resolve a user-supplied field reference: a 1-based index into
 * {@link CONFIG_FIELDS} or an exact dotted path. Null when unmatched.
 */
export function resolveFieldSpec(input: string): ConfigField | null {
  const trimmed = input.trim()
  if (/^\d+$/.test(trimmed)) {
    const index = Number(trimmed)
    return CONFIG_FIELDS[index - 1] ?? null
  }
  return CONFIG_FIELDS.find((field) => field.path === trimmed) ?? null
}

/** Flatten a nested object to leaf `path → value` pairs (for `diff`). */
export function flattenLeaves(
  obj: Record<string, unknown>,
  prefix = '',
): { path: string; value: unknown }[] {
  const out: { path: string; value: unknown }[] = []
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      out.push(...flattenLeaves(value as Record<string, unknown>, path))
    } else {
      out.push({ path, value })
    }
  }
  return out
}

// ─── Helpers ──────────────────────────────────────────────────────

function formatWindow(window: RouterState['window']): string {
  if (window.length === 0) return '(empty)'
  const badge: Record<string, string> = { fast: 'f', smart: 's' }
  return '[' + window.map((e) => (e.hold ? 'h' : badge[e.tier] ?? '?')).join(', ') + ']'
}

function formatTierList(config: ShiftRouterConfig): string {
  return TIERS
    .map((t) => {
      const cfg = config.tiers[t]
      const models = cfg.models.map((m) => `${m.provider}/${m.model}`).join(', ') || '(none)'
      return `  ${tierEmoji(t)} ${(cfg.label || t).padEnd(14)} ${models}`
    })
    .join('\n')
}

function buildStatusText(config: ShiftRouterConfig, state: RouterState, deps: CommandDeps): string {
  const counts: Record<string, number> = { fast: 0, smart: 0 }
  let holds = 0
  for (const e of state.window) {
    if (e.hold) holds += 1
    else counts[e.tier]!++
  }

  const now = Date.now()
  const cooldownLines: string[] = []
  for (const [key, entry] of state.modelCooldowns) {
    if (entry.until <= now) continue
    const [provider, ...rest] = key.split('/')
    cooldownLines.push(
      `  ⏳ ${provider}/${rest.join('/')} — retry in ${formatRemaining(entry.until - now)}`,
    )
  }

  const stats = formatStats(state, config, now).split('\n')

  const sHeader = config.enabled ? '✅' : '⛔'
  const sMode = config.routing.mode === 'auto'
    ? 'AUTO'
    : config.routing.mode === 'manual'
      ? 'MANUAL (overrides only)'
      : 'OFF (passive)'
  const sManual = state.manualOverride.active
    ? ` ✅ ${state.manualOverride.tier ?? state.manualOverride.modelId ?? 'active'}`
    : ' ✗'
  // The spend segment is its own line: it is the per-worker cost attribution
  // (SPEC §9) and is meaningful even after the task's caps reset.
  const orchSpend = formatOrchestrationSpend(state.orchestration)
  const sOrchBudget = config.orchestration.maxSpendUsd > 0
    ? `, budget $${state.orchestration.spend.toFixed(4)}/$${config.orchestration.maxSpendUsd.toFixed(2)}`
    : ''
  const sOrch = config.orchestration.mode === 'auto'
    ? (state.orchestration.active
        ? ` 🪄 active (round ${state.orchestration.rounds}/${config.orchestration.maxRounds}, esc ${state.orchestration.escalations}/${config.orchestration.escalationThreshold}, fail streak ${state.orchestration.workerFailStreak}${sOrchBudget})`
        : ` 🪄 auto (idle)`)
    : ' ✗ (off)'
  const totalTurns = state.window.length + state.upgradeCount + state.downgradeCount

  // Gear: R → θ → θ_eff, in plain language rather than as bare math.
  const penalty = effectiveReworkPenalty(config)
  const theta = effectiveTheta(config)
  const cacheFactor = sameFamilyThetaFactor(config)
  const gearMode = config.routing.economics.mode
  const sGear = `${gearMode ? `${gearMode} ` : ''}(R=${penalty} → θ=${theta.toFixed(2)}` +
    `${cacheFactor > 1 ? ` = base ÷ cache divisor ${cacheFactor}` : ''})` +
    `${legacyThetaOverride(config) !== undefined ? '  [θ from the legacy window.threshold override]' : ''}`
  // Only a NON-default legacy value is an override; the pre-EV defaults are
  // inert, so reporting them would claim an override (and, worse, a cache
  // divisor) that is not in force.
  const legacyNotes: string[] = []
  if (legacyThetaOverride(config) !== undefined) {
    legacyNotes.push(`routing.window.threshold=${config.routing.window.threshold} overrides θ directly`)
  }
  const legacyCacheThreshold = config.routing.cacheAware?.sameFamilyThreshold
  if (legacyCacheThreshold !== undefined && legacyCacheThreshold !== LEGACY_SAME_FAMILY_THRESHOLD_DEFAULT) {
    legacyNotes.push(`routing.cacheAware.sameFamilyThreshold=${legacyCacheThreshold} implies the strong cache divisor`)
  }
  if (downgradeMemoryCapped(config)) {
    legacyNotes.push(
      `routing.economics.downgradeMemory=${config.routing.economics.downgradeMemory} exceeds routing.window.size=${config.routing.window.size}`
      + ` — capped to ${effectiveDowngradeMemory(config)}, which is the most the decision window can hold`,
    )
  }

  // The last decision explains WHY the current tier is what it is.
  const last = state.lastDecision
  const sLast = last === null
    ? '  (no decision yet this session)'
    : `  ${last.held ? '🅷 hold' : last.action} → ${last.decisionTier}` +
      ` (verdict ${last.verdictTier}` +
      (last.confidence !== undefined ? ` conf=${last.confidence.toFixed(2)}` : '') +
      `)` +
      (last.reason !== undefined ? ` — "${last.reason}"` : '')

  // Fact, not intent: what actually produced the last assistant message.
  const actual = state.actualModel === null
    ? '(none yet)'
    : `${state.actualProvider ?? '?'}/${state.actualModel}`
  const intended = `${state.currentProvider ?? '?'}/${state.currentModelId ?? '?'}`
  const drift = state.actualModel !== null && state.actualModel !== state.currentModelId
    ? '  ⚠ differs from the router intent' : ''

  return [
    `dsh-shift-router — Mode: ${sMode} ${sHeader}`,
    `Current: ${formatTierDisplay(state.currentTier, state.currentModelId)}${state.manualOverride.active ? ' (manual)' : ''}`,
    `Gear: ${sGear}`,
    ...(legacyNotes.length > 0 ? [`⚠ legacy override: ${legacyNotes.join('; ')}`] : []),
    ``,
    `Tiers:`,
    formatTierList(config),
    ``,
    `Session:`,
    `  Turns: ${totalTurns}   Upgrades: ↑${state.upgradeCount}   Downgrades: ↓${state.downgradeCount}`,
    `  Manual override:${sManual}`,
    `  Orchestration:${sOrch}`,
    ...(orchSpend === null ? [] : [`  Orchestration spend: ${orchSpend}`]),
    `  Last decision:`,
    sLast,
    `  Running model: ${actual}${drift}`,
    `  Intended model: ${intended}`,
    `  Subagent tool: ${deps.subagentAvailable() ? '✅' : '✗ (orchestration degraded — no subagent tool)'}`,
    `  Worker delegation: ${
      config.orchestration.mode === 'auto'
        ? formatWorkerModelSelection(deps.workerModelSelection())
        : '— (orchestration off)'
    }`,
    `  Cache-aware: ${shareProviderFamily(config)
      ? `🎯 same-family (θ ÷ ${config.routing.cacheAware?.enabled ? sameFamilyThetaFactor(config) : '— (disabled in config)'}, warm-cache guarded for ${Math.round((config.routing.cacheAware?.idleBoundaryMs ?? 0) / 1000)}s after the last message)`
      : '— (cross-family: no cache penalty)'}`,
    ...(cooldownLines.length > 0
      ? [`  Cooldowns (${cooldownLines.length}):`, ...cooldownLines]
      : [`  Cooldowns: none`]),
    ``,
    `Stats:`,
    ...stats.map((line) => `  ${line}`),
    ``,
    `Detail:`,
    `  Window: ${formatWindow(state.window)}  (${state.window.length} entries)`,
    `  Counts: S=${counts.smart} F=${counts.fast} H=${holds}  (H = holds — no usable Judge signal)`,
    ``,
    `Edit: Settings → shift-router, or <profile>/cordis.patch.yml`,
  ].join('\n')
}

// ─── Interactive configuration helpers ────────────────────────────

/** Parse "provider/model-id" into a model ref, or null. */
function parseModelRef(value: string): { provider: string; model: string } | null {
  const parts = value.split('/')
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { provider: parts[0], model: parts[1] }
  }
  return null
}

/**
 * Build a nested settings patch for a dotted path + raw value.
 * The value is parsed as JSON when possible (numbers/booleans/arrays),
 * otherwise treated as a plain string.
 */
function pathPatch(path: string, rawValue: string): { patch: Record<string, unknown> } | { error: string } {
  const segments = path.split('.').filter((s) => s.length > 0)
  if (segments.length === 0) return { error: `invalid path "${path}"` }
  let value: unknown
  try {
    value = JSON.parse(rawValue)
  } catch {
    value = rawValue
  }
  const patch: Record<string, unknown> = {}
  let cursor = patch
  for (let i = 0; i < segments.length - 1; i++) {
    const next: Record<string, unknown> = {}
    cursor[segments[i]!] = next
    cursor = next
  }
  cursor[segments[segments.length - 1]!] = value
  return { patch }
}

/** Human-readable config summary: numbered field list + providers + usage. */
async function configSummary(config: ShiftRouterConfig, deps: CommandDeps): Promise<string> {
  const lines: string[] = [
    'dsh-shift-router — effective configuration (editor: /router config get|set|unset <N|path>):',
  ]
  for (let i = 0; i < CONFIG_FIELDS.length; i++) {
    const field = CONFIG_FIELDS[i]!
    const value = formatFieldValue(readPath(config, field.path), field.type)
    const annotation = field.enum
      ? ` (${field.enum.join('|')})`
      : field.hint
        ? ` (${field.hint})`
        : ''
    const legacy = field.legacy === true ? '  ⚠ legacy — superseded by routing.economics' : ''
    lines.push(`  ${String(i + 1).padStart(2)}. ${field.path.padEnd(36)} = ${value}${annotation}${legacy}`)
  }
  lines.push('', 'Available providers:')
  const providers = deps.listProviders()
  if (providers.length === 0) {
    lines.push('  (none — no LLM adapter registered)')
  }
  for (const provider of providers) {
    const models = await deps.listModels(provider)
    lines.push(`  ${provider}: ${models.length > 0 ? models.slice(0, 12).join(', ') + (models.length > 12 ? ' …' : '') : '(no advertised model list)'}`)
  }
  lines.push(
    '',
    'Usage:',
    '  /router config get <N|path>      — show one field, e.g. `get 4` or `get routing.judgeTimeout`',
    '  /router config set <N|path> <v>  — set one field (JSON values auto-parsed), e.g. `set 4 8000`,',
    '                                     `set tiers.fast.models [{"provider":"opencode-go","model":"deepseek-v4-flash","priority":1}]`',
    '  /router config unset <N|path>    — clear a user override (revert to composition default)',
    '  /router config diff              — show the overrides the user layer currently holds',
    '  /router config set-fast <provider/model> — replace the Fast tier chain with one model',
    '  /router config set-smart <provider/model> — replace the Smart tier chain with one model',
    '  /router config reset             — restore the composition default (cordis.yml)',
    'Values persist to the shift-router settings namespace (the same store the GUI settings panel will bind).',
  )
  return lines.join('\n')
}

// ─── Command registration ────────────────────────────────────────

export function registerCommands(deps: CommandDeps): CommandDefinition[] {
  const router: CommandDefinition = {
    name: 'router',
    description: 'dsh-shift-router: show status, enable/disable, gear preset, orchestration mode (on|off|status|stats|verbose|config|orchestrate|eco|default|sport)',
    input: { hint: 'status | stats | on | off | verbose | config | orchestrate auto|off | eco|default|sport' },
    handler: async ({ agent, rawInput }) => {
      const config = deps.getConfig()
      const arg = rawInput.trim().toLowerCase()

      if (arg === 'orchestrate') {
        return {
          kind: 'success',
          text: '🪄 Usage: /router orchestrate auto|off — auto (default): complex tasks → Smart CTO delegates to Fast subagents (requires the subagent tool; without it, plain smart run); off: plain two-tier routing',
        }
      }
      if (arg === 'orchestrate auto' || arg === 'orchestrate on') {
        config.orchestration.mode = 'auto'
        deps.onConfigChanged()
        return { kind: 'success', text: '🪄 Orchestration AUTO — complex tasks will run as Smart-orchestrated loops, simple tasks stay on the plain router' }
      }
      if (arg === 'orchestrate off') {
        config.orchestration.mode = 'off'
        const state = deps.getState(agent)
        if (state) resetOrchestration(state)
        deps.onConfigChanged()
        return { kind: 'success', text: '🪄 Orchestration OFF — back to plain tier routing' }
      }

      // Gear presets: θ = 1/R. Persisted, because a gear is a durable
      // preference about how the session should feel, not a one-turn toggle.
      if (arg === 'eco' || arg === 'default' || arg === 'sport') {
        const mode = arg as EconomicMode
        const previousTheta = effectiveTheta(config)
        const failure = await deps.updateSettings({ routing: { economics: { mode } } })
        if (failure !== null) {
          return { kind: 'error', text: `dsh-shift-router: could not persist the gear (${failure})` }
        }
        // Report the gear from what we just wrote rather than from a read-back:
        // `settings.update` resolves through the settings service, and the
        // plugin's own config refresh rides a watch that may land later. A
        // confirmation that shows the OLD R/θ would read as "the gear did
        // nothing".
        const current = deps.getConfig()
        const applied: ShiftRouterConfig = {
          ...current,
          routing: { ...current.routing, economics: { ...current.routing.economics, mode } },
        }
        const theta = effectiveTheta(applied)
        const cacheFactor = sameFamilyThetaFactor(applied)
        const blurb = mode === 'eco'
          ? 'cheapest: only clearly-needed turns escalate'
          : mode === 'sport'
            ? 'eager: any real chance of needing Smart escalates'
            : 'balanced'
        return {
          kind: 'success',
          text: `🚗 Gear ${mode} — R=${effectiveReworkPenalty(applied)}, θ=${theta.toFixed(2)}` +
            `${cacheFactor > 1 ? ` (base ÷ cache divisor ${cacheFactor})` : ''}` +
            `, was ${previousTheta.toFixed(2)} — ${blurb}`,
        }
      }

      if (arg === 'on') {
        config.enabled = true
        deps.onConfigChanged()
        return { kind: 'success', text: 'dsh-shift-router: ✅ Enabled' }
      }
      if (arg === 'off') {
        config.enabled = false
        deps.onConfigChanged()
        return { kind: 'success', text: 'dsh-shift-router: ⛔ Disabled' }
      }
      if (arg === 'config' || arg.startsWith('config ')) {
        return handleConfig(rawInput, deps)
      }
      if (arg === 'verbose' || arg === 'log') {
        config.ux.routerLogVerbose = !config.ux.routerLogVerbose
        deps.onConfigChanged()
        return { kind: 'success', text: `dsh-shift-router: ${config.ux.routerLogVerbose ? '📝 Verbose logging ON' : '📝 Verbose logging OFF'}` }
      }
      if (arg === 'status' || arg === 'stats') {
        const state = deps.getState(agent)
        if (!state) return { kind: 'error', text: 'dsh-shift-router: no router state for this agent (subagents are not routed)' }
        return { kind: 'success', text: buildStatusText(config, state, deps) }
      }

      // Default: compact status
      const state = deps.getState(agent)
      const badge = state
        ? `${config.enabled ? '' : '⛔ '}${formatTierDisplay(state.currentTier, state.currentModelId)}${state.manualOverride.active ? ' (manual)' : ''}`
        : `${config.enabled ? '✅' : '⛔'} shift-router (no state)`
      return { kind: 'success', text: `dsh-shift-router — ${badge}` }
    },
  }

  return [router, routeForce(deps)]
}

/** `/router config ...` — show or edit configuration (persisted via settings). */
async function handleConfig(
  rawInput: string,
  deps: CommandDeps,
): Promise<{ kind: 'success'; text: string } | { kind: 'error'; text: string }> {
  const config = deps.getConfig()
  const tokens = rawInput.trim().split(/\s+/)
  const sub = (tokens[1] ?? '').toLowerCase()

  if (sub === '' || sub === 'show') {
    return { kind: 'success', text: await configSummary(config, deps) }
  }

  if (sub === 'get') {
    const field = resolveFieldSpec(tokens[2] ?? '')
    if (!field) {
      return { kind: 'error', text: 'Usage: /router config get <N|path> — e.g. `get 4` or `get routing.judgeTimeout`; use `/router config` for the numbered list' }
    }
    const value = formatFieldValue(readPath(config, field.path), field.type)
    return { kind: 'success', text: `dsh-shift-router: ${field.path} = ${value}` }
  }

  if (sub === 'unset') {
    const field = resolveFieldSpec(tokens[2] ?? '')
    if (!field) {
      return { kind: 'error', text: 'Usage: /router config unset <N|path> — e.g. `unset 4` clears the user override so the composition default applies' }
    }
    const error = await deps.mutateSettings([{ op: 'unset', path: field.path.split('.') }])
    if (error) return { kind: 'error', text: `dsh-shift-router: unset failed — ${error}` }
    deps.onConfigChanged()
    return { kind: 'success', text: `dsh-shift-router: cleared user override for ${field.path} — reverts to the composition default` }
  }

  if (sub === 'diff') {
    const user = deps.userSettings()
    if (user === undefined) {
      return { kind: 'success', text: 'dsh-shift-router: no user overrides (settings service unavailable or the user layer is empty)' }
    }
    const leaves = flattenLeaves(user)
    if (leaves.length === 0) {
      return { kind: 'success', text: 'dsh-shift-router: no user overrides — everything uses the composition defaults' }
    }
    const lines = leaves.map(({ path, value }) => {
      const field = CONFIG_FIELDS.find((f) => f.path === path)
      const effective = formatFieldValue(readPath(config, path), field?.type ?? 'pricing')
      return `  ${path.padEnd(36)} = ${JSON.stringify(value)}  (effective: ${effective})`
    })
    return {
      kind: 'success',
      text: ['dsh-shift-router — user overrides (unset <N|path> to revert):', ...lines].join('\n'),
    }
  }

  if (sub === 'reset') {
    const error = await deps.resetSettings()
    if (error) return { kind: 'error', text: `dsh-shift-router: reset failed — ${error}` }
    deps.onConfigChanged()
    return { kind: 'success', text: 'dsh-shift-router: configuration reset to the composition default (cordis.yml)' }
  }

  if (sub === 'set-fast' || sub === 'set-smart') {
    const tier = sub === 'set-fast' ? 'fast' : 'smart'
    const ref = parseModelRef(tokens[2] ?? '')
    if (!ref) return { kind: 'error', text: `Usage: /router config ${sub} <provider/model-id>` }
    const error = await deps.updateSettings({
      tiers: { [tier]: { models: [{ provider: ref.provider, model: ref.model, priority: 1 }] } },
    })
    if (error) return { kind: 'error', text: `dsh-shift-router: settings update failed — ${error}` }
    deps.onConfigChanged()
    return { kind: 'success', text: `dsh-shift-router: ${tierEmoji(tier)} ${tier} tier → ${ref.provider}/${ref.model} (persisted)` }
  }

  if (sub === 'set') {
    const spec = tokens[2] ?? ''
    const field = resolveFieldSpec(spec)
    if (!field) {
      return { kind: 'error', text: 'Usage: /router config set <N|path> <value> — e.g. `set 4 8000` or `set tiers.fast.models [...]`' }
    }
    const rawValue = tokens.slice(3).join(' ')
    if (!rawValue) {
      return { kind: 'error', text: `Usage: /router config set ${field.path} <value>` }
    }
    const built = pathPatch(field.path, rawValue)
    if ('error' in built) return { kind: 'error', text: `dsh-shift-router: ${built.error}` }
    const error = await deps.updateSettings(built.patch)
    if (error) return { kind: 'error', text: `dsh-shift-router: settings update failed — ${error}` }
    deps.onConfigChanged()
    return { kind: 'success', text: `dsh-shift-router: set ${field.path} = ${rawValue} (persisted)` }
  }

  return {
    kind: 'error',
    text: 'Usage: /router config [show] | get <N|path> | set <N|path> <value> | unset <N|path> | diff | set-fast <provider/model> | set-smart <provider/model> | reset',
  }
}

/** `/route-force` — manual override for the next turn. */
function routeForce(deps: CommandDeps): CommandDefinition {
  return {
    name: 'route-force',
    description: 'Force a specific tier or model for the next turn: /route-force <fast|smart|auto|provider/model>',
    input: { hint: 'fast | smart | auto | provider/model-id' },
    handler: ({ agent, rawInput }) => {
      const arg = rawInput.trim().toLowerCase()
      const config = deps.getConfig()

      if (!arg || arg === 'auto') {
        deps.clearManualOverride(agent)
        return { kind: 'success', text: 'dsh-shift-router: Manual override cleared' }
      }

      if (isValidTier(arg)) {
        deps.setManualOverrideTier(agent, arg)
        return { kind: 'success', text: `dsh-shift-router: ${tierEmoji(arg)} Forcing "${tierLabel(arg, config)}" tier` }
      }

      // provider/model
      const parts = arg.split('/')
      if (parts.length === 2 && parts[0] && parts[1]) {
        deps.setManualOverrideModel(agent, parts[0], parts[1])
        return { kind: 'success', text: `dsh-shift-router: 🎯 Forcing ${parts[0]}/${parts[1]}` }
      }

      return { kind: 'error', text: 'Usage: fast, smart, auto, or provider/model-id' }
    },
  }
}

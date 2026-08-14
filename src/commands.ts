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
import type { ShiftRouterConfig, RouterState, Tier } from './types.js'
import { TIERS } from './types.js'
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
} from './router.js'
import { resetOrchestration } from './orchestrate.js'
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
  /** Persist a partial patch into the shift-router settings namespace. */
  updateSettings(patch: Record<string, unknown>): Promise<boolean>
  /** Reset the shift-router settings namespace to the composition base. */
  resetSettings(): Promise<boolean>
  /** Registered provider routes (ctx.llm.listProviders ids). */
  listProviders(): string[]
  /** Model ids a provider adapter advertises. */
  listModels(provider: string): Promise<string[]>
}

// ─── Helpers ──────────────────────────────────────────────────────

function formatWindow(window: RouterState['window']): string {
  if (window.length === 0) return '(empty)'
  const badge: Record<string, string> = { fast: 'f', smart: 's' }
  return '[' + window.map((e) => badge[e.tier] ?? '?').join(', ') + ']'
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
  for (const e of state.window) counts[e.tier]!++

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
  const sManual = state.manualOverride.active
    ? ` ✅ ${state.manualOverride.tier ?? state.manualOverride.modelId ?? 'active'}`
    : ' ✗'
  const sOrch = config.orchestration.mode === 'auto'
    ? (state.orchestration.active
        ? ` 🪄 active (round ${state.orchestration.rounds}/${config.orchestration.maxRounds}, esc ${state.orchestration.escalations}/${config.orchestration.escalationThreshold})`
        : ` 🪄 auto (idle)`)
    : ' ✗ (off)'
  const totalTurns = state.window.length + state.upgradeCount + state.downgradeCount

  return [
    `dsh-shift-router — Mode: ${config.routing.mode.toUpperCase()} ${sHeader}`,
    `Current: ${formatTierDisplay(state.currentTier, state.currentModelId)}${state.manualOverride.active ? ' (manual)' : ''}`,
    ``,
    `Tiers:`,
    formatTierList(config),
    ``,
    `Session:`,
    `  Turns: ${totalTurns}   Upgrades: ↑${state.upgradeCount}   Downgrades: ↓${state.downgradeCount}`,
    `  Manual override:${sManual}`,
    `  Orchestration:${sOrch}`,
    `  Subagent tool: ${deps.subagentAvailable() ? '✅' : '✗ (orchestration degraded — no subagent tool)'}`,
    `  Cache-aware: ${shareProviderFamily(config) ? '🎯 same-family (threshold ' + (config.routing.cacheAware?.enabled ? config.routing.cacheAware.sameFamilyThreshold : config.routing.window.threshold) + ', ' + (config.routing.cacheAware?.enabled ? 'warm-cache guarded' : 'inactive — enable in config') + ')' : '— (cross-family)'}`,
    ...(cooldownLines.length > 0
      ? [`  Cooldowns (${cooldownLines.length}):`, ...cooldownLines]
      : [`  Cooldowns: none`]),
    ``,
    `Stats:`,
    ...stats.map((line) => `  ${line}`),
    ``,
    `Detail:`,
    `  Window: ${formatWindow(state.window)}  (${state.window.length} entries)`,
    `  Counts: S=${counts.smart} F=${counts.fast}`,
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

/** Human-readable config summary + available providers/models. */
async function configSummary(config: ShiftRouterConfig, deps: CommandDeps): Promise<string> {
  const lines: string[] = [
    'dsh-shift-router — effective configuration (editable here or in Settings → shift-router):',
    `  enabled: ${config.enabled}`,
    `  orchestration.mode: ${config.orchestration.mode} (maxRounds=${config.orchestration.maxRounds}, escalation=${config.orchestration.escalationThreshold})`,
    `  routing.judgeTimeout: ${config.routing.judgeTimeout}ms`,
    `  routing.window: size=${config.routing.window.size} threshold=${config.routing.window.threshold} minConfidence=${config.routing.window.minConfidence ?? 0.5}`,
    `  cacheAware: ${config.routing.cacheAware?.enabled ? 'on' : 'off'} (sameFamilyThreshold=${config.routing.cacheAware?.sameFamilyThreshold}, idleBoundaryMs=${config.routing.cacheAware?.idleBoundaryMs})`,
    `  ux: quiet=${config.ux.quietMode} verbose=${config.ux.routerLogVerbose}`,
    `  tiers.fast: ${config.tiers.fast.models.map((m) => `${m.provider}/${m.model}`).join(', ') || '(none)'}`,
    `  tiers.smart: ${config.tiers.smart.models.map((m) => `${m.provider}/${m.model}`).join(', ') || '(none)'}`,
    ``,
    'Available providers:',
  ]
  const providers = deps.listProviders()
  if (providers.length === 0) {
    lines.push('  (none — no LLM adapter registered)')
  }
  for (const provider of providers) {
    const models = await deps.listModels(provider)
    lines.push(`  ${provider}: ${models.length > 0 ? models.slice(0, 12).join(', ') + (models.length > 12 ? ' …' : '') : '(no advertised model list)'}`)
  }
  lines.push(
    ``,
    'Usage:',
    '  /router config set <path> <value>      — set one field, e.g. `set routing.judgeTimeout 8000`',
    '                                          or `set tiers.fast.models [{"provider":"opencode-go","model":"deepseek-v4-flash","priority":1}]`',
    '  /router config set-fast <provider/model>   — set the Fast tier model (replaces the chain)',
    '  /router config set-smart <provider/model>  — set the Smart tier model (replaces the chain)',
    '  /router config reset                   — restore the composition default (cordis.yml)',
    'Values persist to the shift-router settings namespace (GUI panel edits the same store).',
  )
  return lines.join('\n')
}

// ─── Command registration ────────────────────────────────────────

export function registerCommands(deps: CommandDeps): CommandDefinition[] {
  const router: CommandDefinition = {
    name: 'router',
    description: 'dsh-shift-router: show status, enable/disable, orchestration mode (on|off|status|stats|quiet|verbose|config|orchestrate)',
    input: { hint: 'status | stats | on | off | quiet | verbose | config | orchestrate auto|off' },
    handler: ({ agent, rawInput }) => {
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
      if (arg === 'quiet') {
        config.ux.quietMode = !config.ux.quietMode
        deps.onConfigChanged()
        return { kind: 'success', text: `dsh-shift-router: ${config.ux.quietMode ? '🔇 Quiet' : '🔊 Notifications'}` }
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

  if (sub === 'reset') {
    const ok = await deps.resetSettings()
    if (!ok) return { kind: 'error', text: 'dsh-shift-router: settings are unavailable (no settings service) — edit the profile cordis.patch.yml row instead' }
    deps.onConfigChanged()
    return { kind: 'success', text: 'dsh-shift-router: configuration reset to the composition default (cordis.yml)' }
  }

  if (sub === 'set-fast' || sub === 'set-smart') {
    const tier = sub === 'set-fast' ? 'fast' : 'smart'
    const ref = parseModelRef(tokens[2] ?? '')
    if (!ref) return { kind: 'error', text: `Usage: /router config ${sub} <provider/model-id>` }
    const ok = await deps.updateSettings({
      tiers: { [tier]: { models: [{ provider: ref.provider, model: ref.model, priority: 1 }] } },
    })
    if (!ok) return { kind: 'error', text: 'dsh-shift-router: settings update failed (invalid value?) — check the model id' }
    deps.onConfigChanged()
    return { kind: 'success', text: `dsh-shift-router: ${tierEmoji(tier)} ${tier} tier → ${ref.provider}/${ref.model} (persisted)` }
  }

  if (sub === 'set') {
    const path = tokens[2] ?? ''
    const rawValue = tokens.slice(3).join(' ')
    if (!path || !rawValue) {
      return { kind: 'error', text: 'Usage: /router config set <path> <value> — e.g. `set routing.judgeTimeout 8000` or `set tiers.fast.models [...]`' }
    }
    const built = pathPatch(path, rawValue)
    if ('error' in built) return { kind: 'error', text: `dsh-shift-router: ${built.error}` }
    const ok = await deps.updateSettings(built.patch)
    if (!ok) return { kind: 'error', text: 'dsh-shift-router: settings update failed — the schema rejected the value (JSON numbers/booleans/arrays are parsed automatically)' }
    deps.onConfigChanged()
    return { kind: 'success', text: `dsh-shift-router: set ${path} = ${rawValue} (persisted)` }
  }

  return {
    kind: 'error',
    text: 'Usage: /router config [show] | set <path> <value> | set-fast <provider/model> | set-smart <provider/model> | reset',
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

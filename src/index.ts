/**
 * dsh-shift-router — DeepSeek Harness plugin entry
 *
 * A two-tier model router for DeepSeek Harness (DSH), adapted from
 * pi-shift-router. Before every turn of a top-level agent, a small LLM judge
 * (running on the Fast tier chain) classifies the user's message as `fast`
 * (routine) or `smart` (consequential). The chosen tier then drives the whole
 * turn — the `agent/request` waterfall overrides the wire model per step.
 * Runtime failover marks failing models into an exponential-backoff cooldown
 * and re-resolves the same tier to the next healthy model. Task-level
 * orchestration hands complex tasks to the Smart tier as a CTO with an
 * injected orchestrator system-prompt section.
 *
 * DSH integration points (vs. pi's ExtensionAPI):
 *   - judge call        → ctx.llm.stream() (harness adapters/credentials)
 *   - per-turn hook     → `agent/pre-step` waterfall (turn-start classification)
 *   - model switching   → `agent/request` waterfall (provider/model override)
 *   - runtime failover  → `agent/request-error` waterfall (cooldown + retry)
 *   - orchestrator      → ctx.systemPrompt.section() (dynamic, per agent)
 *   - slash commands    → ctx.commands.register() (`/router`, `/route-force`)
 *   - usage telemetry   → session/event `assistant/message` (TokenUsage)
 *   - GUI configuration → dsh-settings section (`shift-router` namespace)
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision, RequestErrorAction } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type SettingsProvider from '@deepseek-ai/dsh-settings'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
// Type-only: pull in the Context augmentations (`ctx.tools`, `ctx.systemPrompt`)
// and tool-pipeline event types so the plugin compiles against the running
// harness's service surface.
import type {} from '@deepseek-ai/dsh-tools'
import type { ToolExecution, ToolExecutionResult, PreToolDecision } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { Config, deepMergeConfig } from './config.js'
import type { ShiftRouterConfig, RouterState, Tier, ResolvedModel, JudgeResult } from './types.js'
import { DEFAULT_CONFIG, TIERS } from './types.js'
import { findBestModelForTier } from './tier.js'
import {
  createRouterState,
  processRoute,
  applyModelSwitch,
  clearManualOverride,
  setManualOverrideTier,
  setManualOverrideModel,
  recordLastDecision,
} from './router.js'
import { classify, defaultJudgeStreamCall, streamAssistantText, type JudgeStreamCall } from './judge.js'
import {
  markModelFailed,
  clearModelCooldown,
  isModelInCooldown,
  cooldownPredicate,
  findTierForModel,
  findFailoverModel,
  detectFailoverError,
  modelKey,
} from './failover.js'
import {
  shouldOrchestrate,
  recordWorkerOutcome,
  recordWorkerSpend,
  capReason,
  workerModelSelectionWarning,
  readWorkerModelSelection,
  type WorkerModelSelection,
  buildOrchestratorPrompt,
  buildCapNotice,
  capHit,
  enterOrchestration,
  exitOrchestration,
  resetOrchestration,
  renderTierChain,
} from './orchestrate.js'
import { getModelPricing, estimateCost } from './stats.js'
import {
  AUDITOR_SYSTEM_PROMPT,
  appendWorkerResult,
  auditOrchestration,
  type AuditStreamCall,
} from './audit.js'
import { registerCommands } from './commands.js'

export const name = 'shift-router'

export { Config }

/** Services the router needs before apply runs. */
export const inject = ['llm', 'tools', 'commands', 'agents', 'systemPrompt'] as const

/**
 * Settings namespace shown in the GUI settings panel.
 *
 * A plain literal: since `@deepseek-ai/dsh-settings` 0.1.5 the namespace is a
 * branded string (`SettingsNamespace`) that `register()` validates, and the
 * `settingsNamespace()` constructor no longer exists.
 */
export const ROUTER_SETTINGS_NAMESPACE = 'shift-router'

/** Subagent tool name registered by dsh-tool-subagent. */
const SUBAGENT_TOOL = 'subagent'

/**
 * A top-level agent is routable; subagents (orchestration workers) keep their
 * pinned model and are never touched by the router.
 */
function isRoutableAgent(agent: Agent): boolean {
  const header = agent.session.header
  if (header.origin === 'subagent') return false
  if ((header.delegationDepth ?? 0) > 0) return false
  return true
}

/** Concatenate the text content of the claimed user messages (judge input). */
function messagesToText(messages: readonly UserMessage[], cap: number): string {
  const texts: string[] = []
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text') texts.push(block.text)
    }
  }
  return texts.join('\n').slice(0, cap)
}

export function apply(ctx: Context, rawConfig?: ShiftRouterConfig): void {
  // Normalize: whatever the loader/settings resolved (possibly undefined when
  // the row carries no config), deep-merge over the defaults so every nested
  // field exists (mirrors pi's loadConfig merge).
  const config: ShiftRouterConfig = deepMergeConfig(DEFAULT_CONFIG, rawConfig ?? {})

  // ── Effective config: cordis.yml entry + GUI settings overrides ──────
  // The loader/settings may hand us a DEEP-FROZEN config object, so commands
  // (/router on|off|...) must never mutate it. Keep a mutable working copy
  // refreshed from the config source whenever settings attach/change; runtime
  // toggles are session-scoped (they do not rewrite cordis.yml), exactly like
  // the original pi plugin's in-memory mutations.
  //
  // The settings namespace is registered manually (instead of
  // installSettingsSection) so `/router config` can edit configuration
  // through the SettingsScope handle — DSH's native, persisted config surface
  // (the same namespace renders as a form in the GUI settings panel).
  let configSource: () => ShiftRouterConfig = () => config
  let effectiveConfig: ShiftRouterConfig = structuredClone(config)
  let settingsScope: SettingsScope<ShiftRouterConfig> | undefined
  let settingsProvider: SettingsProvider | undefined
  // Model availability memo: "does a registered adapter resolve this
  // provider/model?" — checked once per config and cached. Declared before
  // the settings block because refreshConfig() clears it.
  const modelCache = new Map<string, boolean>()
  const refreshConfig = (): void => {
    effectiveConfig = structuredClone(configSource())
    // Model availability is resolved against the harness's adapter registry;
    // a config change may point tiers at providers/models that weren't
    // resolvable before (or vice versa), so drop the memoized results.
    modelCache.clear()
  }
  ctx.inject(['settings'], (sctx) => {
    settingsProvider = sctx.settings
    const scope = sctx.settings.register(ROUTER_SETTINGS_NAMESPACE, Config, { base: config })
    settingsScope = scope
    configSource = () => scope.get()
    refreshConfig()
    sctx.effect(() => () => {
      // Settings provider detached (disposal/reload): fall back to the
      // composition entry so the router keeps working exactly as composed.
      configSource = () => config
      refreshConfig()
    })
    // Watch disposal is registered as an effect so it is torn down with the
    // plugin fiber (HMR reload) instead of relying on implicit cleanup.
    sctx.effect(() => scope.watch(() => {
      refreshConfig()
      if (effectiveConfig.ux.routerLogVerbose) {
        ctx.logger.info('[shift-router] configuration changed')
      }
    }))
  })
  const getConfig = (): ShiftRouterConfig => effectiveConfig

  /**
   * Persist a partial patch into the shift-router settings namespace.
   * Returns null on success, or a human-readable failure reason (so commands
   * can surface the schema's rejection message instead of a generic error).
   */
  async function updateSettings(patch: Record<string, unknown>): Promise<string | null> {
    if (settingsScope === undefined) {
      return 'settings service is unavailable — edit the profile cordis.patch.yml row instead'
    }
    try {
      await settingsScope.update(patch)
      return null
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      ctx.logger.warn('[shift-router] settings update failed: %o', error)
      return detail
    }
  }

  /**
   * Reset the shift-router settings namespace to the composition base.
   * Returns null on success, or a human-readable failure reason.
   */
  async function resetSettings(): Promise<string | null> {
    if (settingsScope === undefined) {
      return 'settings service is unavailable — edit the profile cordis.patch.yml row instead'
    }
    try {
      await settingsScope.replace({})
      return null
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      ctx.logger.warn('[shift-router] settings reset failed: %o', error)
      return detail
    }
  }

  /**
   * Apply path-addressed edits (set/unset) to the user section — the official
   * write path for clearing a single override (`unset`) that a merge-only
   * patch cannot express. Returns null on success or a failure reason.
   */
  async function mutateSettings(ops: readonly SettingsPathOp[]): Promise<string | null> {
    if (settingsProvider === undefined) {
      return 'settings service is unavailable — edit the profile cordis.patch.yml row instead'
    }
    try {
      await settingsProvider.mutate(ROUTER_SETTINGS_NAMESPACE, ops)
      return null
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      ctx.logger.warn('[shift-router] settings mutate failed: %o', error)
      return detail
    }
  }

  /**
   * The raw user section of the shift-router namespace (the overrides the
   * user actually set, as opposed to the resolved value). Used by
   * `/router config diff`. Undefined while the settings service is absent or
   * the user has never written anything.
   */
  function userSettings(): Record<string, unknown> | undefined {
    if (settingsProvider === undefined) return undefined
    const descriptor = settingsProvider.describe({}).find((d) => d.ns === ROUTER_SETTINGS_NAMESPACE)
    if (descriptor?.user === undefined || descriptor.user === null) return undefined
    if (typeof descriptor.user !== 'object' || Array.isArray(descriptor.user)) return undefined
    return descriptor.user as Record<string, unknown>
  }

  // ── Per-agent router state ───────────────────────────────────────────
  const agentStates = new WeakMap<Agent, RouterState>()

  function stateFor(agent: Agent): RouterState | undefined {
    return agentStates.get(agent)
  }

  function ensureState(agent: Agent): RouterState {
    let state = agentStates.get(agent)
    if (state === undefined) {
      state = createRouterState()
      agentStates.set(agent, state)
    }
    return state
  }

  // ── Model availability probe (ctx.llm-backed, memoized) ─────────────
  // pi's modelRegistry.find is replaced by "does a registered adapter resolve
  // this provider/model?" — checked once per config and cached (see
  // `modelCache` above; cleared on every config refresh). The warmers
  // populate the sync set before the pure routing functions run.
  async function warmModel(provider: string, model: string): Promise<boolean> {
    const key = `${provider}/${model}`
    const cached = modelCache.get(key)
    if (cached !== undefined) return cached
    try {
      await ctx.llm.resolveModelInfo(provider, model)
      modelCache.set(key, true)
      return true
    } catch {
      modelCache.set(key, false)
      return false
    }
  }

  async function warmTier(tier: Tier): Promise<void> {
    for (const ref of getConfig().tiers[tier].models) {
      await warmModel(ref.provider, ref.model)
    }
  }

  function modelAvailable(provider: string, model: string): boolean {
    return modelCache.get(`${provider}/${model}`) === true
  }

  async function resolveBestModel(
    tier: Tier,
    state: RouterState,
  ): Promise<ResolvedModel | null> {
    await warmTier(tier)
    return findBestModelForTier(
      tier,
      getConfig(),
      modelAvailable,
      cooldownPredicate(state.modelCooldowns, Date.now()),
    )
  }

  // ── Verbose logging helper ──────────────────────────────────────────
  function vlog(message: string): void {
    if (getConfig().ux.routerLogVerbose) ctx.logger.info(`[shift-router] ${message}`)
  }

  // ── The LLM Judge (fast-tier chain walk via ctx.llm) ────────────────
  const judgeStreamCall: JudgeStreamCall = (provider, model, prompt, signal) =>
    defaultJudgeStreamCall(ctx, prompt, provider, model, signal, getConfig().routing.judgeMaxTokens)

  // ── Turn start: classify + route + (maybe) orchestrate ──────────────
  ctx.on('agent/pre-step', async (
    { agent, messages, step, signal },
    next,
  ): Promise<PreStepDecision> => {
    if (!isRoutableAgent(agent) || step !== 1) return next()
    const cfg = getConfig()

    const state = ensureState(agent)

    // Orchestration is single-turn (SPEC §7.3). If it is still active at the
    // start of a NEW turn, the previous turn never reached its stop boundary
    // (abort, crash) — sweep the leak so the caps and the CTO prompt do not
    // bleed into unrelated turns. Swept before every gate below (disabled,
    // mode) so turning routing off mid-run cannot strand an active loop.
    if (state.orchestration.active) {
      resetOrchestration(state)
      vlog('🪄 swept leaked orchestration state from an interrupted turn')
    }

    if (!cfg.enabled) return next()

    // Mode gate: `manual` skips the judge and auto-switching (only explicit
    // `/route-force` overrides apply); `off` makes the router fully passive
    // for model selection. Both still need router state for `/route-force`.
    if (cfg.routing.mode !== 'auto') return next()

    const prompt = messagesToText(messages, cfg.routing.judgePromptCap)
    if (!prompt.trim()) return next()

    const t0 = Date.now()
    vlog(`turn start — prompt: "${prompt.slice(0, 80).replace(/\n/g, ' ')}${prompt.length > 80 ? '…' : ''}"`)

    // The judge shares the cooldown map with the turn path: a judge-side
    // 429/5xx marks the model so both the next judge call and the turn path
    // skip it without re-burning the failure.
    const failoverPolicy = {
      baseMs: cfg.failover.baseMs,
      maxMs: cfg.failover.maxMs,
      startAttempts4xx: cfg.failover.startAttempts4xx,
    }
    let judgeResult: JudgeResult = { tier: 'fast', source: 'fallback' }
    try {
      judgeResult = await classify(
        prompt,
        cfg.tiers.fast.models,
        judgeStreamCall,
        cfg.routing.judgeTimeout,
        cooldownPredicate(state.modelCooldowns, Date.now()),
        (provider, model, code) => markModelFailed(state.modelCooldowns, provider, model, Date.now(), code, failoverPolicy),
        signal,
      )
    } finally {
      if (cfg.ux.routerLogVerbose) {
        const badges = { fast: 'f', smart: 's' } as const
        const window = state.window
          .map((entry) => (entry.hold ? 'h' : badges[entry.tier]))
          .join('')
        vlog(
          `judge: ${judgeResult.tier} (${judgeResult.source})` +
            (judgeResult.confidence !== undefined ? ` conf=${judgeResult.confidence.toFixed(2)}` : '') +
            (judgeResult.reason !== undefined ? ` reason=${judgeResult.reason}` : '') +
            (judgeResult.orchestrate !== undefined ? ` orchestrate=${judgeResult.orchestrate}` : '') +
            `, window=[${window}]`,
        )
      }
    }

    // Routing decision (upgrade is instant; downgrade waits for the window).
    await warmTier('fast')
    await warmTier('smart')
    const result = processRoute(judgeResult, state, cfg, modelAvailable, Date.now())
    if (result.switchTo) {
      applyModelSwitch(result.switchTo, state)
      vlog(`decision: ${result.action} → ${result.switchTo.provider}/${result.switchTo.modelId} (${Date.now() - t0}ms)`)
    } else if (!state.currentModelId && state.currentTier) {
      // First turn with no model yet — resolve one for the current tier,
      // skipping models in cooldown (mirrors pi's first-turn behavior).
      const m = await resolveBestModel(state.currentTier, state)
      if (m) {
        applyModelSwitch(m, state)
        vlog(`decision: initial → ${m.provider}/${m.modelId}`)
      }
    }
    recordLastDecision(state, judgeResult, result)
    if (result.held) {
      vlog('decision: HOLD — Judge gave no usable signal, keeping the current tier')
    }

    // Task-level orchestration gates on the DECISION tier (post-EV, post-hold),
    // never the raw verdict: reading the verdict is what used to inject the CTO
    // prompt while a Fast model ran the turn.
    const subagentAvailable = ctx.tools.get(SUBAGENT_TOOL) !== undefined
    if (shouldOrchestrate(cfg, result, subagentAvailable, judgeResult.orchestrate)) {
      // The prompt IS the task goal for the audit's goal-alignment check; it is
      // captured here because this is the moment the task starts.
      enterOrchestration(state, prompt)
      // Race-free self-check: this is the first moment the router really is
      // about to delegate, so an absent selection service is now a fact about
      // the deployment rather than a mount-ordering artefact (SPEC §7.4).
      checkWorkerModelSelection(readWorkerModelSelection(ctx))
      vlog(
        `🪄 orchestrating: decisionTier=${result.decisionTier} verdict=${judgeResult.tier}` +
          (judgeResult.orchestrate !== undefined ? ` judgeOrchestrate=${judgeResult.orchestrate}` : '') +
          ' — orchestrator prompt active',
      )
    }

    return next()
  })

  // ── Per-step model override (the actual "model switch") ─────────────
  ctx.on('agent/request', async (
    { agent },
    next,
  ): Promise<LlmCallConfig> => {
    if (!isRoutableAgent(agent)) return next()
    const cfg = getConfig()
    if (!cfg.enabled || cfg.routing.mode === 'off') return next()
    const state = stateFor(agent)
    if (!state) return next()

    const incoming = await next()

    // Record what actually goes on the wire — `agent/request-error` uses this
    // to attribute a failure to the exact model that served the request.
    const recordLastRequest = (wire: LlmCallConfig): void => {
      state.lastRequestProvider = wire.provider ?? null
      state.lastRequestModel = wire.model ?? null
    }

    // Manual override: user forced a tier/model for this turn.
    if (state.manualOverride.active) {
      let wire: LlmCallConfig = incoming
      if (state.manualOverride.provider && state.manualOverride.modelId) {
        wire = { ...incoming, provider: state.manualOverride.provider, model: state.manualOverride.modelId }
      } else if (state.manualOverride.tier) {
        const m = await resolveBestModel(state.manualOverride.tier, state)
        if (m) wire = { ...incoming, provider: m.provider, model: m.modelId }
      }
      recordLastRequest(wire)
      return wire
    }

    // Manual mode never auto-switches models; it only honors overrides.
    if (cfg.routing.mode !== 'auto') {
      recordLastRequest(incoming)
      return incoming
    }

    // Steady state: keep the router's current tier model, re-resolving for
    // cooldown health — after `agent/request-error` marks a model down, the
    // retry lands on the next healthy model in the SAME tier.
    const m = await resolveBestModel(state.currentTier, state)
    if (!m) {
      recordLastRequest(incoming)
      return incoming
    }
    if (incoming.provider === m.provider && incoming.model === m.modelId) {
      recordLastRequest(incoming)
      return incoming
    }
    vlog(`model: ${incoming.provider}/${incoming.model} → ${m.provider}/${m.modelId} (tier ${m.tier})`)
    const wire = { ...incoming, provider: m.provider, model: m.modelId }
    recordLastRequest(wire)
    return wire
  })

  // ── Runtime failover: 429/5xx → cooldown + same-tier retry ──────────
  ctx.on('agent/request-error', async (
    { agent, provider, failure },
    next,
  ): Promise<RequestErrorAction> => {
    if (!isRoutableAgent(agent)) return next()
    const cfg = getConfig()
    // Failover is an auto-mode behavior: manual mode hands control to the
    // user, off mode is fully passive.
    if (!cfg.enabled || cfg.routing.mode !== 'auto') return next()
    const state = stateFor(agent)
    if (!state) return next()
    if (state.manualOverride.active) return next() // user forced a model — don't override

    const det = detectFailoverError(failure)
    if (!det) return next() // auth/config/network — not failover-worthy

    // Attribute the failure to the exact model this agent last put on the
    // wire for the failed provider (recorded in `agent/request`), falling
    // back to the router's current model. No session-event archaeology.
    let model: string | null = null
    if (state.lastRequestProvider === provider) model = state.lastRequestModel
    if (!model && state.currentProvider === provider) model = state.currentModelId
    if (!model) return next()

    const now = Date.now()
    markModelFailed(state.modelCooldowns, provider, model, now, det.code, {
      baseMs: cfg.failover.baseMs,
      maxMs: cfg.failover.maxMs,
      startAttempts4xx: cfg.failover.startAttempts4xx,
    })

    // Fail over within the tier that owns the failed model.
    const failTier = findTierForModel(cfg, provider, model) ?? state.currentTier
    const fallback = findFailoverModel(
      failTier,
      cfg,
      modelAvailable,
      state.modelCooldowns,
      now,
      modelKey(provider, model),
    )

    if (!fallback) {
      // Tier exhausted — every model in cooldown. Keep current (the loop
      // closes the step with the failure); the next turn re-resolves.
      vlog(`⚠ ${provider}/${model} failed (${det.code}) — all ${failTier} models in cooldown, keeping current`)
      return next()
    }

    vlog(`⚠ ${provider}/${model} failed (${det.code}) → cooldown, retry on ${fallback.provider}/${fallback.modelId}`)
    // `{ kind: 'retry' }` makes the loop rebuild the request; the
    // `agent/request` waterfall above picks the fallback model.
    return { kind: 'retry' }
  })

  // ── Turn end: release one-turn state ────────────────────────────────
  ctx.on('agent/turn-stopping', async ({ agent }): Promise<void> => {
    const state = stateFor(agent)
    if (!state) return
    if (state.manualOverride.active) clearManualOverride(state)
    if (!state.orchestration.active) return

    // ── Acceptance audit (C1) ──────────────────────────────────────────
    // Snapshot the evidence BEFORE releasing the orchestration state, then run
    // the audit. The deterministic half is free and completes here; the LLM
    // half is deliberately DETACHED — awaiting an auditor call at the turn
    // boundary would delay the user's turn by up to `audit.timeoutMs`, and the
    // whole point of the audit is that it is a safety net, not a gate. The
    // result lands in `state.lastAudit` for `/router status` whenever it
    // settles, and a failure can only ever add a violation.
    const cfg = getConfig()
    const orch = state.orchestration
    const auditInput = {
      spawned: orch.spawned,
      done: orch.done,
      rounds: orch.rounds,
      maxRounds: cfg.orchestration.maxRounds,
      escalations: orch.escalations,
      escalationThreshold: cfg.orchestration.escalationThreshold,
      capReason: capReason(state, cfg),
      finalText: orch.ctoSummary ?? '',
      workerResults: orch.workerResults.join('\n\n--- worker result ---\n\n'),
      goal: orch.goal ?? undefined,
      enabled: cfg.orchestration.audit.enabled,
    }
    // The auditor runs on the Fast tier, cooldown-filtered by the same
    // predicate the router uses, so it can never re-burn a route this turn
    // just cooled down (and is skipped entirely when all of them are cooling).
    const auditEndpoints = (cfg.tiers.fast.models ?? [])
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .map((ref) => ({ provider: ref.provider, model: ref.model }))
    const now = Date.now()
    const auditOptions = {
      endpoints: auditEndpoints,
      isCool: cooldownPredicate(state.modelCooldowns, now),
      timeoutMs: cfg.orchestration.audit.timeoutMs,
      promptCap: cfg.orchestration.audit.promptCap,
    }
    const auditStreamCall: AuditStreamCall = (provider, model, prompt, signal) =>
      streamAssistantText(
        ctx,
        AUDITOR_SYSTEM_PROMPT,
        prompt,
        provider,
        model,
        signal,
        1000,
      )

    const cappedEarlier = capHit(state, cfg)
    exitOrchestration(state)
    vlog('🪄 orchestration turn ended — exited orchestrator state')
    if (cappedEarlier) {
      vlog('🪄 orchestration cap hit — turn closed, orchestrator state released')
    }

    // Detached on purpose (see above). It touches only the captured snapshot
    // plus `state.lastAudit`, so a reload mid-audit cannot break anything.
    void auditOrchestration(auditInput, auditOptions, auditStreamCall)
      .then((audit) => {
        state.lastAudit = audit
        if (audit.violations.length > 0) {
          // A stock profile has no log sink (§13), so the command surface is
          // what makes this readable — but log it too where a sink exists.
          ctx.logger.warn(
            '[shift-router] acceptance audit flagged %d issue(s): %s',
            audit.violations.length,
            audit.violations.join(' | '),
          )
        } else if (cfg.ux.routerLogVerbose) {
          vlog(`✓ acceptance audit clean (workers ${auditInput.done}/${auditInput.spawned})`)
        }
      })
      .catch((error) => {
        // Belt and braces: auditOrchestration already converts failures into
        // violations, so reaching here means a bug in the audit itself.
        ctx.logger.warn('[shift-router] acceptance audit failed: %s', String(error))
      })
  })

  // ── Orchestration hard caps (enforced, not just prompted) ──────────
  // While an orchestration turn is active, the router counts each subagent
  // delegation as one round and each failed worker result as one escalation.
  // Once `capHit()` is true the subagent tool is denied outright and the
  // system-prompt section switches to a "wrap up" notice.
  ctx.on('tools/pre-execute', async (exec: ToolExecution, next): Promise<PreToolDecision> => {
    if (exec.name !== SUBAGENT_TOOL) return next()
    const agent = exec.agent
    const state = agent ? stateFor(agent) : undefined
    if (!state?.orchestration.active) return next()
    const cfg = getConfig()
    if (!cfg.enabled || cfg.routing.mode !== 'auto') return next()
    if (capHit(state, cfg)) {
      // One authority for the reason (capReason) so this deny and the prompt's
      // wrap-up notice can never disagree about which cap fired.
      return {
        kind: 'deny',
        reason: `dsh-shift-router: ${capReason(state, cfg) ?? 'orchestration cap reached'} — stop delegating and wrap up the task now`,
      }
    }
    // Rounds count at DISPATCH (a deliberate divergence: a dispatched
    // delegation has already spent budget, so this keeps maxRounds a true
    // ceiling), and `spawned` tracks the same event for the audit's
    // completeness check.
    state.orchestration.rounds += 1
    state.orchestration.spawned += 1
    vlog(`🪄 orchestration delegation ${state.orchestration.rounds}/${cfg.orchestration.maxRounds} (subagent call)`)
    return next()
  })

  ctx.on('tools/result', (exec: ToolExecution, result: Readonly<ToolExecutionResult>): undefined => {
    if (exec.name !== SUBAGENT_TOOL) return undefined
    const agent = exec.agent
    const state = agent ? stateFor(agent) : undefined
    if (!state?.orchestration.active) return undefined
    const cfg = getConfig()
    state.orchestration.done += 1
    // Collect the worker's own words as audit evidence (C1). Bounded from the
    // audit's prompt cap, and only for orchestration runs — this is the
    // grounding the deterministic half cannot check on its own.
    appendWorkerResult(
      state.orchestration.workerResults,
      result.content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map((block) => block.text)
        .join('\n'),
      cfg.orchestration.audit.promptCap,
    )
    recordWorkerOutcome(state, cfg, !result.isError)
    if (result.isError) {
      vlog(
        `🪄 worker failed (streak ${state.orchestration.workerFailStreak}/${cfg.orchestration.escalationThreshold},` +
          ` escalations ${state.orchestration.escalations}/${cfg.orchestration.escalationThreshold})`,
      )
    } else {
      vlog('🪄 worker succeeded — failure streak reset')
    }
    return undefined
  })

  // ── Telemetry + recovery from assistant messages ────────────────────
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (event.type !== 'assistant/message') return

    // ── Worker usage → the delegating task's ledger (C3) ────────────────
    // Upstream read a worker's cost off the subagent tool result; DSH reports
    // the child's own usage on ITS session events, and `dsh-subagent` stamps
    // `header.parentSession` (`childSessionMeta`), so attribution is exact
    // rather than inferred. A worker is one ledger row, accumulated across all
    // of its messages.
    if (session.header.origin === 'subagent') {
      const usage = event.data.usage
      const parentId = session.header.parentSession
      if (!usage || parentId === undefined) return
      const parent = ctx.agents.get(parentId)
      const parentState = parent ? stateFor(parent) : undefined
      if (!parentState?.orchestration.active) return
      const workerCfg = getConfig()
      const workerTokens = {
        input: usage.inputTokens,
        output: usage.outputTokens,
        cacheRead: usage.cacheReadTokens ?? 0,
        cacheWrite: usage.cacheWriteTokens ?? 0,
      }
      const { provider: workerProvider, model: workerModel } = event.data.message.source
      const workerCost = estimateCost(
        getModelPricing(workerCfg.pricing, workerProvider, workerModel),
        workerTokens,
      )
      // Wall time the worker has been alive; the session's own creation time is
      // the spawn instant, so no separate spawn bookkeeping is needed.
      const startedAt = session.header.createdAt
      const elapsedMs = startedAt > 0 ? Date.now() - startedAt : null
      recordWorkerSpend(
        parentState.orchestration,
        session.header.id,
        workerCost,
        workerTokens.output,
        elapsedMs,
        workerCfg.orchestration.workerLedgerCap,
      )
      vlog(
        `🪄 worker ${session.header.id} spent $${workerCost.toFixed(4)}` +
          ` (task total $${parentState.orchestration.spend.toFixed(4)})`,
      )
      return
    }

    const agent = ctx.agents.get(session.id)
    const state = agent ? stateFor(agent) : undefined
    if (!agent || !state) return

    const msg = event.data.message
    const provider = msg.source.provider
    const model = msg.source.model
    const usage = event.data.usage
    const now = Date.now()

    // The acceptance audit (C1) reads the CTO's latest message as the claim it
    // must verify. Last assistant message of an ACTIVE orchestration wins:
    // earlier ones are intermediate narration, not the acceptance report.
    if (state.orchestration.active) {
      const finalText = msg.content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim()
      if (finalText.length > 0) state.orchestration.ctoSummary = finalText
    }

    // Sync what ACTUALLY ran (display only): `current*` is the router's
    // intent, these are the fact. Never lets a stale intent be shown as the
    // running model, and — deliberately — never triggers a switch.
    state.actualProvider = provider
    state.actualModel = model
    // Every completed assistant message ages the prompt cache, whether or not
    // it carried usage. Setting this only when usage exists left the state at
    // "no message has completed yet", which is what lets cache-aware routing
    // permit a downgrade while the cache is still warm.
    state.lastActivityAt = now

    // A 2xx response clears the cooldown (mirrors pi's after_provider_response).
    if (isModelInCooldown(state.modelCooldowns, provider, model, now)) {
      clearModelCooldown(state.modelCooldowns, provider, model)
      vlog(`✓ ${provider}/${model} recovered — cooldown cleared`)
    }

    if (!usage) return
    const tokens = {
      input: usage.inputTokens,
      output: usage.outputTokens,
      cacheRead: usage.cacheReadTokens ?? 0,
      cacheWrite: usage.cacheWriteTokens ?? 0,
    }
    state.totalOutputTokens += tokens.output

    // Attribute the message to the tier that actually owns this model (a
    // manual override or a same-provider switch can run a model that isn't
    // the router's current tier).
    const cfg = getConfig()
    const tier = findTierForModel(cfg, provider, model) ?? state.currentTier
    const pricing = getModelPricing(cfg.pricing, provider, model)
    const cost = estimateCost(pricing, tokens)
    const tierUsage = state.tierUsage[tier]
    tierUsage.calls += 1
    tierUsage.tokens.input += tokens.input
    tierUsage.tokens.output += tokens.output
    tierUsage.tokens.cacheRead += tokens.cacheRead
    tierUsage.tokens.cacheWrite += tokens.cacheWrite
    tierUsage.cost += cost
    state.callLog.push({
      tier,
      provider,
      modelId: model,
      tokens,
      cost,
    })
    // Bound the attribution log so very long sessions can't grow it (and the
    // `/router stats` baseline walk) without limit.
    const callLogCap = cfg.telemetry.callLogCap
    if (state.callLog.length > callLogCap) state.callLog = state.callLog.slice(-callLogCap)

    // Throughput is intentionally not tracked here: DSH renders tok/s natively
    // (chat footer + trajectory) from decode time, which is a better
    // measurement than a wall-clock estimate would be. See SPEC §9.
    vlog(`${tokens.output} tokens (total ${state.totalOutputTokens.toLocaleString()})`)
  })

  // ── Orchestrator prompt (rendered only while orchestration is active) ──
  ctx.systemPrompt.section({
    name: 'shift-router:orchestrator',
    // Configurable placement: DSH allocates section order centrally
    // (`SECTION_ORDERS` in dsh-system-prompt) and has no slot for a
    // third-party section, so this is a deployment decision, not a literal.
    order: getConfig().ux.promptSectionOrder,
    text: (context) => {
      const agent = context.agent
      if (!agent) return ''
      const state = stateFor(agent)
      if (!state?.orchestration.active) return ''
      const cfg = getConfig()
      // The prompt must mirror the gates that enforce it: the `subagent` deny
      // at `tools/pre-execute` only fires while routing is enabled and in auto
      // mode, so rendering the CTO instruction outside those conditions would
      // ask for delegation that nothing is capping.
      if (!cfg.enabled || cfg.routing.mode !== 'auto') return ''
      // Hard cap reached → replace the orchestrator instruction with a
      // "wrap up now" notice (the subagent tool is denied at the same time).
      if (capHit(state, cfg)) return buildCapNotice(cfg)
      return buildOrchestratorPrompt(cfg, cooldownPredicate(state.modelCooldowns, Date.now()))
    },
  })

  // ── Deployment-facing tier-chain prompt variables ──────────────────
  // Expose the rendered chains so a deployment persona can reference them
  // (e.g. `Workers must use a model from {{shift_router_fast_chain}}`).
  const chainVariable = (tier: Tier): ((context: { agent?: Agent }) => string) =>
    (context) => {
      const state = context.agent ? stateFor(context.agent) : undefined
      return renderTierChain(
        getConfig().tiers[tier].models,
        state ? cooldownPredicate(state.modelCooldowns, Date.now()) : undefined,
      )
    }
  ctx.systemPrompt.variable('shift_router_fast_chain', chainVariable('fast'))
  ctx.systemPrompt.variable('shift_router_smart_chain', chainVariable('smart'))

  // ── Slash commands ─────────────────────────────────────────────────
  for (const definition of registerCommands({
    getConfig,
    // Commands may run before any turn — create the router state on demand
    // for top-level agents so `/router status` works right after startup.
    getState: (agent) => isRoutableAgent(agent) ? ensureState(agent) : undefined,
    onConfigChanged: () => {
      if (getConfig().ux.routerLogVerbose) ctx.logger.info('[shift-router] config changed')
    },
    setManualOverrideTier: (agent, tier) => setManualOverrideTier(ensureState(agent), tier),
    setManualOverrideModel: (agent, provider, model) => setManualOverrideModel(ensureState(agent), provider, model),
    clearManualOverride: (agent) => {
      const state = stateFor(agent)
      if (state) clearManualOverride(state)
    },
    subagentAvailable: () => ctx.tools.get(SUBAGENT_TOOL) !== undefined,
    workerModelSelection: () => readWorkerModelSelection(ctx),
    updateSettings,
    resetSettings,
    mutateSettings,
    userSettings,
    listProviders: () => ctx.llm.listProviders().map((p) => p.id),
    listModels: async (provider) => {
      try {
        const models = await ctx.llm.listModels(provider)
        return models.map((m) => m.id)
      } catch {
        return []
      }
    },
  })) {
    ctx.commands.register(definition)
  }

  // ── Worker-model self-check (SPEC §7.4) ───────────────────────────
  // Upstream calls per-worker tier injection mandatory. In DSH the `subagent`
  // tool's per-call provider/model only takes effect inside the host-owned
  // `subagent-model-selection` allowlist (default off, and mounted by the
  // `web` composition only). We cannot enable that setting from here, so the
  // honest move is to tell the user what to turn on instead of letting workers
  // silently inherit the Smart model.
  //
  // This is an OPTIONAL dependency and must be probed, never read as
  // `ctx.subagentModelSelection`: an undeclared property read throws
  // `cannot get property "…" without inject` while the service is absent — and
  // "absent" includes the window in which a sibling row of the same include
  // group is still mounting. That throw happens inside apply and aborts the
  // whole DSH boot (regression: tests/plugin-load.test.ts).
  //
  // `ctx.inject` is the reactive half: it fires when the service attaches
  // (whenever that is), re-fires if the preference is replaced, and disposes
  // with the plugin. The `enterOrchestration` call site below is the race-free
  // half: by the time a turn actually delegates, the tree has long settled, so
  // an absent service there really does mean "this deployment has no such
  // surface" rather than "not yet".
  let workerModelWarned = false
  const checkWorkerModelSelection = (selection: WorkerModelSelection | undefined): void => {
    if (workerModelWarned) return
    if (!getConfig().enabled || getConfig().orchestration.mode !== 'auto') return
    if (getConfig().tiers.fast.models.length === 0) return
    const warning = workerModelSelectionWarning(selection)
    if (warning === null) return
    workerModelWarned = true
    ctx.logger.warn('[shift-router] %s', warning)
  }
  ctx.inject(['subagentModelSelection'], (sctx) => {
    checkWorkerModelSelection(readWorkerModelSelection(sctx))
  })

  // ── Startup diagnostics ────────────────────────────────────────────
  ctx.logger.info('[shift-router] loaded (enabled=%s, orchestration=%s)', getConfig().enabled, getConfig().orchestration.mode)
  if (getConfig().enabled) {
    const fastKeys = getConfig().tiers.fast.models.map((m) => `${m.provider}/${m.model}`).sort().join(',')
    const smartKeys = getConfig().tiers.smart.models.map((m) => `${m.provider}/${m.model}`).sort().join(',')
    if (fastKeys.length > 0 && fastKeys === smartKeys) {
      ctx.logger.warn('[shift-router] both tiers share the same models — tier routing is a no-op; configure distinct tiers')
    }
    if (getConfig().tiers.fast.models.length === 0) {
      ctx.logger.warn('[shift-router] fast tier is empty — the judge has no model chain and routing will hold position')
    }
  }

  // Warm the model availability cache in the background (never blocks boot).
  void Promise.all(TIERS.flatMap((tier) =>
    getConfig().tiers[tier].models.map((ref) => warmModel(ref.provider, ref.model)),
  )).catch(() => undefined)
}

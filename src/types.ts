/**
 * dsh-shift-router — Type definitions
 *
 * Two-tier routing: Fast (engineer) ↔ Smart (CTO).
 * Fast: execution-heavy tasks, daily coding, following patterns.
 * Smart: judgment-heavy tasks, architecture, planning, code review.
 *
 * DSH adaptation: models are plain `provider/model` references resolved
 * through the running harness's registered LLM adapters (ctx.llm) instead of
 * pi-agent's models-store.json / auth.json. Everything else mirrors the
 * original pi-shift-router semantics.
 */

/** The two routing tiers */
export type Tier = 'fast' | 'smart'

/** All tier labels */
export const TIERS: readonly Tier[] = ['fast', 'smart'] as const

/** Judge result (tier classification) */
export interface JudgeResult {
  tier: Tier
  source: 'llm' | 'fallback'
  /**
   * LLM's confidence in the tier classification, in [0, 1]. Read as `pSmart`
   * by the EV rule (SPEC §3): a `smart` verdict contributes `c`, a `fast`
   * verdict contributes `1 − c`. A missing value is read as 1.0 for
   * backward-compatibility with prompts that omit it; the only "no signal"
   * case the router invents no value for is its own outage (`source:
   * 'fallback'`), which forces a hold.
   */
  confidence?: number
  /**
   * Ultra-short human-readable reason for the classification (one phrase).
   * Emitted by the Judge as a JSON field and surfaced in verbose logs +
   * `/router status` detail — a debugging aid, never used by routing.
   */
  reason?: string
  /**
   * Judge's explicit orchestration signal. `true` = the task is large or
   * decomposable enough that the Smart tier should delegate to Fast workers
   * instead of running the turn alone. `false` = Smart runs the turn directly.
   * Absent (older prompt, or the model did not emit it) = no opinion — the
   * caller falls back to the tier-based default.
   */
  orchestrate?: boolean
}

/** A reference to a specific model in a specific provider */
export interface ModelRef {
  provider: string
  model: string
  priority: number
}

/** Configuration for one tier */
export interface TierConfig {
  label: string
  models: ModelRef[]
  description: string
}

/** UX configuration (DSH has no status bar; kept for command feedback parity). */
export interface UXConfig {
  /** Verbose logging: print router decisions, judge calls, window state. */
  routerLogVerbose: boolean
}

/**
 * Runtime failover policy. The exponential-backoff ladder is
 * `baseMs * 4^(attempts-1)`, capped at `maxMs`; 4xx-class failures (429 /
 * quota) skip the first tiers and start at `startAttempts4xx` because
 * client-side limits usually outlive server-side blips. All configurable so
 * deployments can tune recovery to their provider's throttling shape.
 */
export interface FailoverConfig {
  /** Base cooldown delay (first 5xx failure): 1 minute. */
  baseMs: number
  /** Hard cap on the backoff ladder: 6 hours. */
  maxMs: number
  /** Starting attempt count for 4xx failures (baseMs * 4^(n-1) with n = this). */
  startAttempts4xx: number
}

/** Telemetry retention / aggregation policy. */
export interface TelemetryConfig {
  /** Max per-message attribution records kept for baseline cost computation. */
  callLogCap: number
}

/**
 * Named economics presets for `/router eco|default|sport` (SPEC §3).
 * R (reworkPenalty) is the only knob a preset touches: θ = 1/R, and the turn
 * runs smart iff `pSmart ≥ θ`. Higher R → lower θ → more eager escalation.
 */
export type EconomicMode = 'eco' | 'default' | 'sport'

/**
 * Pre-1.4.0 defaults for the two LEGACY knobs. A config carrying exactly these
 * values is a wizard snapshot of the old defaults, not a deliberate
 * customization — it migrates silently to the new rule. Only a *different*
 * value is honoured as an override (and surfaced as `⚠ legacy`).
 */
export const LEGACY_THRESHOLD_DEFAULT = 0.6
export const LEGACY_SAME_FAMILY_THRESHOLD_DEFAULT = 0.9

/** Default θ divisor when both tiers share a provider family. */
export const DEFAULT_SAME_FAMILY_PENALTY = 1.5
/** Divisor implied by a non-default legacy `sameFamilyThreshold`. */
export const LEGACY_SAME_FAMILY_PENALTY = 3.0

/** Routing behaviour config */
export interface RoutingConfig {
  /**
   * `auto` (default): judge + EV routing + failover + orchestration.
   * `manual`: no judge, no auto-switching — only explicit `/route-force`
   * overrides take effect. `off`: the router is fully passive for model
   * selection (like `enabled: false`); commands and telemetry still work.
   */
  mode: 'auto' | 'manual' | 'off'
  /** LLM Judge timeout in ms */
  judgeTimeout: number
  /** Max output tokens for a single Judge call. */
  judgeMaxTokens: number
  /** Max prompt characters sent to the Judge (bounds Judge cost). */
  judgePromptCap: number
  /**
   * Expected-cost economics (SPEC §3). `reworkPenalty` encodes how many
   * price-deltas a wrong downgrade costs; θ = 1/reworkPenalty.
   * `downgradeMemory` = consecutive decisive fast decisions required before
   * smart → fast. `mode` is a named preset and, when present, is
   * authoritative over `reworkPenalty`.
   */
  economics: { reworkPenalty: number; downgradeMemory: number; mode?: EconomicMode }
  /**
   * Decision memory. Entries below `minConfidence` are holds (never switch,
   * never extend a fast streak). `threshold` is the LEGACY raw-θ override —
   * honoured only when it differs from `LEGACY_THRESHOLD_DEFAULT`.
   */
  window: { size: number; threshold?: number; minConfidence?: number }
  /**
   * Cache-aware routing. When fast and smart resolve to the same provider
   * family, a mid-session model switch forfeits the prompt cache. When
   * enabled:
   *   - the decision bar becomes `θ / sameFamilyPenalty` (a smaller bar →
   *     fewer downgrades, so the warm cache survives longer), and
   *   - downgrades are suppressed within `idleBoundaryMs` of the last
   *     message (the cache is warm) — they only fire after an idle gap long
   *     enough that the cache has already expired.
   * `sameFamilyThreshold` is the LEGACY knob; a non-default value implies the
   * strong penalty `LEGACY_SAME_FAMILY_PENALTY` (3.0).
   */
  cacheAware?: {
    enabled: boolean
    sameFamilyPenalty: number
    idleBoundaryMs: number
    sameFamilyThreshold?: number
  }
}

/**
 * Task-level orchestration. When active AND the Judge says complex, the main
 * agent runs the Smart model with an orchestrator instruction: it plans,
 * delegates implementation to Fast subagents (via the subagent tool), reviews
 * each result, and loops until clean — with plugin-side hard caps.
 */
export interface OrchestrationConfig {
  /**
   * Mode. "auto" (default): Judge-driven — simple tasks (fast verdict) keep
   * the plain router; complex tasks escalate to Smart-orchestrated execution.
   * "off": never orchestrate.
   */
  mode: 'auto' | 'off'
  /** Max review/delegate rounds before Smart takes over (hard cap). */
  maxRounds: number
  /**
   * Consecutive worker failures on one phase that count as one escalation
   * (hard cap: `escalationThreshold` escalations). A successful worker result
   * resets the streak.
   */
  escalationThreshold: number
}

/** Per-model USD pricing (per 1M tokens) for cost telemetry. */
export interface ModelPricing {
  provider: string
  model: string
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

/** Full shift-router configuration */
export interface ShiftRouterConfig {
  enabled: boolean
  tiers: {
    fast: TierConfig
    smart: TierConfig
  }
  routing: RoutingConfig
  ux: UXConfig
  orchestration: OrchestrationConfig
  /** Runtime failover policy (exponential-backoff ladder). */
  failover: FailoverConfig
  /** Telemetry retention policy. */
  telemetry: TelemetryConfig
  /**
   * Optional per-model pricing used by `/router stats` cost telemetry. DSH
   * usage events carry token counts but no USD, so the router estimates
   * spend from this table when the user fills it in. Empty by default.
   */
  pricing: ModelPricing[]
}

/** Orchestration lifecycle state (per-agent, not persisted). */
export interface OrchestrationState {
  /** Is the main agent currently running as an orchestrator? */
  active: boolean
  /** Rounds consumed this task (hard cap: maxRounds). */
  rounds: number
  /** Escalations reached this task (hard cap: escalationThreshold). */
  escalations: number
  /**
   * Consecutive worker failures. A success resets it to 0; reaching
   * `escalationThreshold` increments `escalations` and resets the streak, so
   * isolated failures do not burn the cap.
   */
  workerFailStreak: number
}

/** Default configuration */
export const DEFAULT_CONFIG: ShiftRouterConfig = {
  enabled: true,
  tiers: {
    fast: {
      label: 'Fast',
      models: [],
      description: 'Daily coding, debugging, following patterns — execution mode',
    },
    smart: {
      label: 'Smart',
      models: [],
      description: 'Architecture, planning, code review, trade-off analysis — judgment mode',
    },
  },
  routing: {
    mode: 'auto',
    judgeTimeout: 5000,
    judgeMaxTokens: 4000,
    judgePromptCap: 6000,
    economics: { reworkPenalty: 3, downgradeMemory: 2 },
    window: { size: 5, minConfidence: 0.5 },
    cacheAware: {
      enabled: true,
      sameFamilyPenalty: DEFAULT_SAME_FAMILY_PENALTY,
      idleBoundaryMs: 5 * 60_000,
    },
  },
  ux: {
    routerLogVerbose: false,
  },
  orchestration: {
    mode: 'auto',
    maxRounds: 3,
    escalationThreshold: 2,
  },
  failover: {
    baseMs: 60_000,
    maxMs: 6 * 60 * 60_000,
    startAttempts4xx: 3,
  },
  telemetry: {
    callLogCap: 1000,
  },
  pricing: [],
}

/** Window entry — one Judge result */
export interface WindowEntry {
  tier: Tier
  timestamp: number
  /**
   * Confidence of this classification (defaults to 1.0 when missing).
   * Below `window.minConfidence` the entry is a hold.
   */
  confidence?: number
  /**
   * This entry is a hold: the Judge was unusable (outage) or the verdict was
   * not decisive. Holds never extend a downgrade streak and never trigger a
   * switch — they keep the current tier.
   */
  hold?: boolean
}

/** The last routing decision, kept for display (`/router status`, GUI card). */
export interface LastDecision {
  verdictTier: Tier
  confidence?: number
  reason?: string
  action: RouteAction
  decisionTier: Tier
  held: boolean
  at: number
}

/** What the router did with one turn's verdict. */
export type RouteAction = 'upgrade' | 'downgrade' | 'stay' | 'manual'

/** Router internal state — one per routed (top-level) agent. */
export interface RouterState {
  currentTier: Tier
  currentModelId: string | null
  currentProvider: string | null
  window: WindowEntry[]
  manualOverride: {
    active: boolean
    tier?: Tier
    modelId?: string
    provider?: string
  }
  /** Models in exponential-backoff cooldown after runtime failure. */
  modelCooldowns: CooldownMap
  /** Cumulative output tokens across the session (from assistant/message usage). */
  totalOutputTokens: number
  /**
   * Provider/model the router last put on the wire for this agent. Set in
   * `agent/request`; consumed by `agent/request-error` to attribute a failure
   * to the exact model that served the failed request (no session-event
   * archaeology).
   */
  lastRequestProvider: string | null
  lastRequestModel: string | null
  /** Cumulative count of fast→smart tier transitions. */
  upgradeCount: number
  /** Cumulative count of smart→fast tier transitions. */
  downgradeCount: number
  /**
   * Epoch ms of the most recent assistant message end (any tier). Used by
   * cache-aware routing to detect whether a session boundary has passed.
   * 0 when no message has completed yet.
   */
  lastActivityAt: number
  /**
   * Provider/model that ACTUALLY produced the last assistant message, synced
   * from `session/event` (display only — never drives a switch). `current*`
   * is the router's *intent*; these are the *fact*, so a stale intent can
   * never masquerade as the running model in status output.
   */
  actualProvider: string | null
  actualModel: string | null
  /** The most recent routing decision (display only). */
  lastDecision: LastDecision | null
  /**
   * Cumulative per-tier spend. Populated from assistant/message usage
   * (token counts) plus estimated USD when the caller supplies pricing.
   */
  tierUsage: Record<Tier, TierUsage>
  /** Per-message attribution record kept for hypothetical baseline calculation. */
  callLog: CallRecord[]
  /** Task-level orchestration lifecycle. */
  orchestration: OrchestrationState
}

/** Token counts for one assistant message (DSH TokenUsage naming). */
export interface TokenUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** Cumulative spend for a single tier. */
export interface TierUsage {
  calls: number
  tokens: TokenUsage
  /** USD summed from pricing estimates. */
  cost: number
}

/** Per-message attribution record kept for hypothetical baseline calculation. */
export interface CallRecord {
  tier: Tier
  provider: string
  modelId: string
  tokens: TokenUsage
  cost: number
}

/** A resolved model reference plus its tier (mirrors pi tier.ts ResolvedModel). */
export interface ResolvedModel {
  provider: string
  modelId: string
  tier: Tier
}

/**
 * Cooldown map: modelKey ("provider/model") → entry. The runtime value comes
 * from failover.ts; this structural alias keeps types.ts free of a circular
 * import.
 */
export type CooldownMap = Map<string, { until: number; attempts: number }>

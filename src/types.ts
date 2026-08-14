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
   * LLM's confidence in the tier classification, in [0, 1].
   * Used by the confidence-weighted sliding window: entries below
   * `window.minConfidence` are ignored; weighted ratio decides downgrade.
   * Defaults to 1.0 when the Judge doesn't emit it (backward-compat).
   */
  confidence?: number
  /**
   * Ultra-short human-readable reason for the classification (one phrase).
   * Emitted by the Judge as a JSON field and surfaced in verbose logs +
   * `/router status` detail — a debugging aid, never used by routing.
   */
  reason?: string
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
  quietMode: boolean
  /** Verbose logging: print router decisions, judge calls, window state. */
  routerLogVerbose: boolean
}

/** Routing behaviour config */
export interface RoutingConfig {
  mode: 'auto' | 'manual' | 'off'
  /** LLM Judge timeout in ms */
  judgeTimeout: number
  /**
   * Sliding window for downgrade gating. Entries whose confidence is
   * below `minConfidence` are ignored. Downgrade fires when
   * `Σ confidence_for_fast / window_size` ≥ `threshold`.
   */
  window: { size: number; threshold: number; minConfidence?: number }
  /**
   * Cache-aware routing. When fast and smart resolve to the same provider
   * family, a mid-session model switch forfeits the prompt cache. When
   * enabled:
   *   - the downgrade threshold is raised to `sameFamilyThreshold`, and
   *   - downgrades are suppressed within `idleBoundaryMs` of the last
   *     message (the cache is warm); they only fire after an idle gap.
   * Auto-detection turns it on when both tiers use the same provider.
   */
  cacheAware?: {
    enabled: boolean
    sameFamilyThreshold: number
    idleBoundaryMs: number
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
   * the plain router; complex tasks (smart verdict) escalate to
   * Smart-orchestrated execution. "off": never orchestrate.
   */
  mode: 'auto' | 'off'
  /** Max review/delegate rounds before Smart takes over (hard cap). */
  maxRounds: number
  /** A worker failing ≥N times → Smart takes over the phase itself. */
  escalationThreshold: number
  /** Skip orchestration when the Smart tier model can't be resolved. */
  requireSmartModel: boolean
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
  /** Workers escalated this task (hard cap: escalationThreshold). */
  escalations: number
  /** Epoch ms when the current orchestration task started. */
  startedAt: number | null
  /** Estimated spend so far (USD) — hard budget guard (informational). */
  spend: number
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
    window: { size: 5, threshold: 0.6, minConfidence: 0.5 },
    cacheAware: {
      enabled: true,
      sameFamilyThreshold: 0.9,
      idleBoundaryMs: 5 * 60_000,
    },
  },
  ux: {
    quietMode: false,
    routerLogVerbose: false,
  },
  orchestration: {
    mode: 'auto',
    maxRounds: 3,
    escalationThreshold: 2,
    requireSmartModel: true,
  },
  pricing: [],
}

/** Window entry — one Judge result */
export interface WindowEntry {
  tier: Tier
  timestamp: number
  /**
   * Confidence of this classification (defaults to 1.0 when missing).
   * Used by the confidence-weighted sliding window.
   */
  confidence?: number
}

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
  /** Sliding window of recent tokens-per-second readings (for `/router stats`). */
  recentSpeeds: number[]
  /** Epoch ms when the current in-flight assistant message started streaming; null when none. */
  streamingStartTime: number | null
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

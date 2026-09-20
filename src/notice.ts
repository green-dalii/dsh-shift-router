/**
 * dsh-shift-router — route notices (SPEC §13.1)
 *
 * A routing decision that changes which model serves a conversation is a fact
 * about the user's session, so it is written into the session: one `form:
 * 'notice'` message on the `agent/pre-step` waterfall, the same channel the
 * harness's own model-selection notice uses.
 *
 * This module is pure formatting. Two rules carry the whole design:
 *
 * - **The text names the plugin.** `source.plugin` is durable, but the Chat
 *   client renders a notice through `NoticeBody` — which draws only the content
 *   — and the collapsed row draws only `summary`. Nothing in the UI reads the
 *   `plugin` field, so an unlabelled line is indistinguishable from harness
 *   output (ALIGNMENT §R9). Every notice therefore starts with
 *   `[shift-router]`.
 * - **The text states the auditable facts.** What changed (tier, model), what
 *   the router did (action), what the Judge said (verdict, confidence, reason),
 *   whether orchestration is entering, and how long the decision took. A notice
 *   that said only "switched" would be decoration.
 *
 * Diagnostics still go to `ctx.logger` (SPEC §13); this is the surface that a
 * stock profile can actually show.
 *
 * @module
 */

import { boundContextSummary } from '@deepseek-ai/dsh-llm'
import type { RouteAction, Tier } from './types.js'

/** Everything the notice reports, as the decision path knows it. */
export interface RouteNoticeInput {
  /** What the router did with the turn. */
  action: RouteAction
  /** The tier in force before this decision. */
  fromTier: Tier
  /** The provider in force before this decision (`null` on the first turn). */
  fromProvider: string | null
  /** The model in force before this decision (`null` on the first turn). */
  fromModel: string | null
  /** The tier this turn will actually run at. */
  toTier: Tier
  /** The provider that will serve this turn. */
  toProvider: string | null
  /** The model that will serve this turn. */
  toModel: string | null
  /** The Judge's raw verdict. */
  judgeTier: Tier
  /** `llm` when the Judge answered; `fallback` when it was unusable. */
  judgeSource: 'llm' | 'fallback'
  /** The Judge's confidence, when it gave one. */
  confidence?: number
  /** The Judge's one-phrase reason, when it gave one. */
  reason?: string
  /** The Judge gave no usable signal, so the router kept its position. */
  held: boolean
  /** The Judge asked for task-level orchestration (only `true` is news). */
  orchestrate?: boolean
  /** Wall time the classification + decision took. */
  elapsedMs: number
}

/** Tier display labels, taken from the deployment's config (never hardcoded). */
export type TierLabels = Record<Tier, string>

/** The message content and the collapsed row's one-line account. */
export interface RouteNotice {
  /** The model-facing, user-visible one-liner. */
  text: string
  /** The collapsed row's account, bounded by the platform. */
  summary: string
}

/** Whether this decision moves the session to a different route. */
export function routeChanged(input: RouteNoticeInput): boolean {
  // No route at all (an empty chain, or every model in cooldown) is not a move:
  // the router never got a model onto the wire. That condition is reported once
  // at startup and in `/router status`; restating it every turn would be noise,
  // and `initial` would be a lie on turn 9.
  if (input.toModel === null) return false
  // No previous model (first turn) is the route being established, not a move.
  if (input.fromModel === null) return true
  return (
    input.fromTier !== input.toTier ||
    input.fromProvider !== input.toProvider ||
    input.fromModel !== input.toModel
  )
}

/**
 * Name a model the way the harness names one: the bare id while the provider is
 * unchanged, `provider/model` as soon as it differs.
 */
function label(
  provider: string | null,
  model: string | null,
  otherProvider: string | null,
): string {
  if (model === null) return '(none)'
  if (provider === null || provider === otherProvider) return model
  return `${provider}/${model}`
}

/** The Judge's contribution: verdict, confidence, reason, orchestration. */
function judgeReport(input: RouteNoticeInput): string {
  let report = `judge ${input.judgeSource === 'fallback' ? 'fallback' : input.judgeTier}`
  if (input.confidence !== undefined) report += ` conf=${input.confidence.toFixed(2)}`
  if (input.reason !== undefined && input.reason !== '') report += ` "${input.reason}"`
  if (input.orchestrate === true) report += ' orchestrate'
  return report
}

/**
 * Render one decision. The shape follows the decision, because a held turn and a
 * first turn are not switches and must not be dressed as one.
 *
 * @param input - the decision, as the pre-step path knows it.
 * @param labels - the deployment's tier labels.
 * @returns the notice text and its collapsed-row summary.
 */
export function formatRouteNotice(input: RouteNoticeInput, labels: TierLabels): RouteNotice {
  const elapsed = `${Math.max(0, Math.round(input.elapsedMs))}ms`
  const report = judgeReport(input)
  const toLabel = labels[input.toTier]
  const toModel = label(input.toProvider, input.toModel, input.fromProvider)
  const fromModel = label(input.fromProvider, input.fromModel, input.toProvider)

  let body: string
  let summary: string
  if (input.fromModel === null) {
    // The route is being established; the Judge's report carries any hold.
    body = `initial → ${toLabel} · ${toModel} · ${report} · ${elapsed}`
    summary = `shift-router · initial → ${toLabel} · ${toModel}`
  } else if (input.held) {
    // Nothing moved: the Judge gave no usable signal.
    body = `hold at ${toLabel} · ${toModel} · ${report} · ${elapsed}`
    summary = `shift-router · hold at ${toLabel} · ${toModel}`
  } else if (!routeChanged(input)) {
    // Only reachable in verbose mode, where every judged turn reports.
    body = `stay on ${toLabel} · ${toModel} · ${report} · ${elapsed}`
    summary = `shift-router · stay on ${toLabel} · ${toModel}`
  } else {
    const fromLabel = labels[input.fromTier]
    const tiers = input.fromTier === input.toTier ? fromLabel : `${fromLabel} → ${toLabel}`
    body = `${tiers} · ${fromModel} → ${toModel} · ${input.action} · ${report} · ${elapsed}`
    summary = `shift-router · ${tiers} · ${fromModel} → ${toModel}`
  }

  return { text: `[shift-router] ${body}`, summary: boundContextSummary(summary) }
}

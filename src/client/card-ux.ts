/**
 * dsh-shift-router — card UX derivations (pure)
 *
 * The card is an advanced surface and a stock profile exports no plugin logs
 * (SPEC §13), so anything a user must know to configure it safely has to be
 * computed here and rendered: the threshold a penalty implies, and what is wrong
 * with a model chain. Every function is pure, so the card's statements about the
 * configuration are testable rather than asserted in JSX.
 */

import type { FieldState } from './controller.js'
import type { ModelRow } from './form-model.js'

/**
 * Rework penalty applied by each economics preset (SPEC §15). Mirrors
 * `ECONOMIC_MODE_PRESETS` in `src/config.ts` — the client bundle cannot import
 * it (`@deepseek-ai/schemastery` is not a platform seed word), so a test pins
 * the two tables together.
 */
export const ECONOMIC_MODE_PENALTIES: Record<string, number> = { eco: 2, default: 3, sport: 5 }

/** The two tier chains as the card currently shows them (staged edits included). */
export interface ChainView {
  fast: readonly ModelRow[]
  smart: readonly ModelRow[]
}

/**
 * One chain-level problem worth telling the user about. Row-level problems
 * (a repeated route, a provider that could not be listed) are rendered against
 * the row itself, so they are not repeated here.
 */
export type ChainProblem =
  | { kind: 'empty-tier'; tier: 'fast' | 'smart' }
  | { kind: 'shared-primary' }

/** The effective rows of both tier chains, as the card renders them. */
export function chainView(stateByPath: Map<string, FieldState | undefined>): ChainView {
  return {
    fast: stateByPath.get('tiers.fast.models')?.rows ?? [],
    smart: stateByPath.get('tiers.smart.models')?.rows ?? [],
  }
}

/** `provider/model` — the identity used to spot duplicates. */
function routeId(row: ModelRow): string {
  return `${row.provider}/${row.model}`
}

/**
 * The routes a chain lists more than once. A repeat never runs (the chain is
 * tried in order), so the row is marked where it stands.
 * @param rows - one tier's rows, in order.
 * @returns the duplicated `provider/model` identities.
 */
export function duplicateRoutes(rows: readonly ModelRow[]): Set<string> {
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const row of rows) {
    if (row.provider === '' || row.model === '') continue
    const route = routeId(row)
    if (seen.has(route)) repeated.add(route)
    seen.add(route)
  }
  return repeated
}

/**
 * Everything wrong with the chains that the user can still fix.
 *
 * These are the same conditions the host half warns about at startup; a stock
 * profile drops those log lines, so the card is where they become readable.
 * @param chains - the effective chains.
 * @returns one entry per problem, in report order.
 */
export function chainProblems(chains: ChainView): ChainProblem[] {
  const problems: ChainProblem[] = []
  for (const tier of ['fast', 'smart'] as const) {
    if (chains[tier].length === 0) problems.push({ kind: 'empty-tier', tier })
  }
  const fastPrimary = chains.fast[0]
  const smartPrimary = chains.smart[0]
  if (
    fastPrimary !== undefined && smartPrimary !== undefined &&
    fastPrimary.provider !== '' && fastPrimary.model !== '' &&
    routeId(fastPrimary) === routeId(smartPrimary)
  ) {
    problems.push({ kind: 'shared-primary' })
  }
  return problems
}

/**
 * The decision threshold the effective economics config implies: θ = 1/R.
 *
 * A preset wins over the raw penalty because that is what the router does;
 * an unusable value (no preset and a non-positive penalty) has no threshold.
 * @param economics - the mode as selected and the penalty as typed.
 * @returns θ, or undefined when it cannot be computed.
 */
export function effectiveThreshold(economics: { mode: string; reworkPenalty: number }): number | undefined {
  const preset = ECONOMIC_MODE_PENALTIES[economics.mode]
  const penalty = preset ?? economics.reworkPenalty
  if (!Number.isFinite(penalty) || penalty <= 0) return undefined
  return 1 / penalty
}

/** What the collapsed header states about the effective configuration. */
export interface SummaryFacts {
  enabled: boolean
  /** Routing mode value (`auto` / `manual` / `off`), or undefined while unknown. */
  mode: string | undefined
  fast: number
  smart: number
}

/**
 * Read the facts the header summarises. Rows come from the effective field
 * state, so a staged edit updates the summary before it is saved.
 * @param stateByPath - the card's per-field state.
 * @returns the header facts.
 */
export function summaryFacts(stateByPath: Map<string, FieldState | undefined>): SummaryFacts {
  const chains = chainView(stateByPath)
  const enabled = stateByPath.get('enabled')?.text
  const mode = stateByPath.get('routing.mode')?.text
  return {
    enabled: enabled !== 'false',
    mode: mode === undefined || mode === '' ? undefined : mode,
    fast: chains.fast.length,
    smart: chains.smart.length,
  }
}

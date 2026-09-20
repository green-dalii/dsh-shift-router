/**
 * dsh-shift-router — orchestration acceptance audit (C1, SPEC §9.3-style safety net)
 *
 * After an orchestrated turn, verify the CTO actually closed the loop: every
 * dispatched worker reported back, the final assistant message carries a CTO
 * summary, and — when an auditor model is reachable — the acceptance claim is
 * grounded in the worker results rather than an unchecked "done".
 *
 * Two layers, both best-effort and **never blocking the turn**:
 *
 * - **Deterministic checks** (free, always run): worker completeness,
 *   CTO-summary presence, and the hard cap that ended the run.
 * - **LLM audit** (config-gated, one small call on the Fast tier): reads the
 *   goal, the CTO summary and the worker outputs, and flags ungrounded
 *   acceptance, goal drift, and placeholder work passed off as done.
 *
 * DSH adaptations (deliberate, and different from upstream):
 *
 * - Upstream walked the finished `agent_end` transcript. DSH gives the plugin
 *   per-event streams instead, so the caller collects the evidence as it
 *   happens (`orchestration.ctoSummary`, `orchestration.workerResults`) and this
 *   module consumes those snapshots. The deterministic half is therefore a pure
 *   function over plain values — trivially testable, no transcript archaeology.
 * - Upstream read endpoints and called `fetch` itself with provider API keys.
 *   The plugin must never hold credentials: the LLM pass runs through
 *   `ctx.llm.stream()` on the Fast tier chain, exactly like the Judge, with the
 *   same cooldown filtering.
 * - Upstream's auditor prompt was a bundled `.md` file read with `readFileSync`.
 *   It is inlined here instead: the plugin ships pre-bundled, and the
 *   orchestrator prompt is inlined for the same reason.
 * - Errors are values: any audit failure degrades to a reported violation, never
 *   a throw. The turn is already over; an audit can only add information.
 *
 * The audit never mutates what it audits — it only reports.
 */

import type { OrchestrationAudit } from './types.js'
import type { StreamTextOutcome } from './judge.js'

/** One auditor route, resolved by the caller (cooldown-filtered Fast chain). */
export interface AuditEndpoint {
  provider: string
  model: string
}

/**
 * One auditor attempt. Mirrors the Judge's transport contract so both callers
 * share `streamAssistantText` and therefore identical failover semantics.
 */
export interface AuditStreamCall {
  (
    provider: string,
    model: string,
    prompt: string,
    signal: AbortSignal,
  ): Promise<StreamTextOutcome>
}

/** Everything the audit reads, as plain values (see the DSH note above). */
export interface AuditInput {
  /** Subagent calls dispatched this task. */
  spawned: number
  /** Subagent results received this task. */
  done: number
  /** Rounds consumed (delegate→review cycles). */
  rounds: number
  maxRounds: number
  escalations: number
  escalationThreshold: number
  /**
   * The cap that ended the run (from `capReason`), or null. Passed as a value
   * rather than re-derived so the audit reports the SAME reason the deny and
   * the prompt used.
   */
  capReason: string | null
  /** The CTO's final assistant message. */
  finalText: string
  /** Concatenated worker results (already truncated by the caller's cap). */
  workerResults: string
  /** The user's original prompt, when captured. */
  goal?: string
  /** Run the LLM pass at all. */
  enabled: boolean
}

/** Optional wiring for the LLM half. */
export interface AuditOptions {
  /** Routes to try, in order (already cooldown-filtered by the caller). */
  endpoints?: AuditEndpoint[]
  /** Excludes cooling routes; the audit must not re-burn what the turn just cooled. */
  isCool?: (provider: string, model: string) => boolean
  /** Per-attempt timeout in ms. */
  timeoutMs?: number
  /** Character cap for the whole auditor prompt. */
  promptCap?: number
}

// ─── Auditor prompt ───────────────────────────────────────────────

/**
 * The acceptance-auditor system prompt.
 *
 * Three checks (grounding, goal alignment, delivered quality) and an explicit
 * "do not invent issues" rule: an over-eager auditor is worse than none, because
 * a false flag trains the operator to ignore the line.
 */
export const AUDITOR_SYSTEM_PROMPT = `You are the acceptance auditor for an orchestrated coding task. A Smart-tier CTO delegated implementation chunks to Fast-tier workers and then produced a final summary claiming the task is done. Verify that claim three ways — grounding, goal alignment, and delivered quality — and flag anything that does not hold up.

Answer with ONE JSON object and nothing else:
{"verdict":"pass","issues":[]}
or
{"verdict":"flag","issues":["concrete issue tied to evidence"]}

What to check (flag only what the evidence supports):
1. Grounding — is the acceptance claim backed by actual worker results? Flag a claim of "done" that references no result, a summary that contradicts a worker failure, or ignored worker failures.
2. Goal alignment — does the delivered work address the user's original goal? Flag scope drift, work unrelated to the request, or a core ask left unanswered.
3. Delivered quality — do the worker results look complete? Flag placeholder or TODO stubs passed off as done, empty results, a worker reporting it could not finish, or a clear contradiction with the stated acceptance criteria.

Rules:
- verdict is "pass" (all three hold) or "flag" (at least one fails).
- issues is a concrete list, one sentence each, tied to evidence. Do not invent issues and do not penalise style.
- Do NOT penalise a CTO that legitimately took over a phase itself, or a task that turned out simple.
- If the goal is missing, base alignment on the summary and worker results alone; still check grounding and quality.

Output one JSON object only. No markdown fences, no prose.`

/**
 * Build the auditor's user-turn evidence block, bounded by `cap`.
 *
 * Each block is truncated independently so a huge worker transcript cannot
 * crowd out the goal (the alignment check needs it) — and the whole thing is
 * bounded because the audit runs on the Fast tier and must stay cheap.
 *
 * @param input - the audit evidence.
 * @param cap - character cap for the entire prompt.
 * @returns the assembled prompt.
 */
export function buildAuditorPrompt(input: AuditInput, cap: number): string {
  const perBlock = Math.max(200, Math.floor(cap / 3))
  const clip = (text: string, empty: string): string => {
    const trimmed = text.trim()
    if (trimmed.length === 0) return empty
    return trimmed.length > perBlock ? `${trimmed.slice(0, perBlock)}…` : trimmed
  }
  return [
    '## Goal (the user\'s original request)',
    clip(input.goal ?? '', '(not captured)'),
    '',
    '## CTO summary',
    clip(input.finalText, '(none)'),
    '',
    '## Worker results',
    clip(input.workerResults, '(none)'),
    '',
    '## Output',
    'One JSON object only: {"verdict": "pass" | "flag", "issues": [ ... ]}',
  ].join('\n')
}

/**
 * Append one worker result to the audit's evidence list, bounded.
 *
 * The capture is bounded from `promptCap` rather than by extra config knobs: the
 * cap is the deployment's cost decision, and the per-result/per-list split is
 * just how that budget is spent (≤8 results, each ≤ cap/8). Truncation is
 * marked, so the auditor can see that evidence was clipped instead of silently
 * judging a partial result as complete.
 *
 * @param results - the accumulator (mutated).
 * @param text - the worker's result text.
 * @param promptCap - the auditor prompt cap this evidence feeds.
 */
export function appendWorkerResult(results: string[], text: string, promptCap: number): void {
  const trimmed = text.trim()
  if (trimmed.length === 0) return
  const perResult = Math.max(200, Math.floor(promptCap / 8))
  results.push(trimmed.length > perResult ? `${trimmed.slice(0, perResult)}…` : trimmed)
  const maxResults = 8
  if (results.length > maxResults) results.splice(0, results.length - maxResults)
}

// ─── Deterministic half ───────────────────────────────────────────

/**
 * Does the text look like a CTO summary? The output contract ends the run with
 * "planned / delegated / reviewed+accepted / remains", so accept either the
 * marker token or at least two of its content words — models phrase the block
 * differently but rarely drop the vocabulary entirely.
 *
 * @param text - the final assistant message.
 * @returns true when the summary contract appears to be met.
 */
export function hasCtoSummary(text: string): boolean {
  if (!text) return false
  if (/\bCTO summary\b/i.test(text)) return true
  const markers = ['planned', 'delegated', 'reviewed', 'accepted', 'remains', 'remaining']
  let hits = 0
  for (const marker of markers) {
    if (new RegExp(`\\b${marker}\\b`, 'i').test(text)) hits += 1
  }
  return hits >= 2
}

/**
 * Run the deterministic half — free, always runs, pure.
 *
 * @param input - the audit evidence.
 * @returns the deterministic findings.
 */
export function deterministicAudit(
  input: AuditInput,
): Pick<OrchestrationAudit, 'complete' | 'hasCtoSummary' | 'capHit' | 'violations'> {
  const violations: string[] = []
  const complete = input.spawned === 0 || input.done >= input.spawned
  if (!complete) {
    violations.push(`worker results incomplete (done ${input.done}/${input.spawned})`)
  }
  const ctoSummary = hasCtoSummary(input.finalText)
  // The CTO-summary output contract is a DELEGATION-run requirement: only a run
  // that actually spawned workers owes an acceptance report over their results.
  // A self-executed turn ending without the marker is a normal Smart answer.
  if (input.spawned > 0 && !ctoSummary) {
    violations.push('no CTO summary in the final assistant message (acceptance not reported)')
  }
  const capHit = input.spawned > 0 && input.capReason !== null
  if (capHit) {
    violations.push(`ended at hard cap (${input.capReason})`)
  }
  return { complete, hasCtoSummary: ctoSummary, capHit, violations }
}

/**
 * One-line `/router status` rendering of an audit result.
 *
 * The status report is the surface that always works (the stock compositions
 * export no `ctx.logger` sink — SPEC §13), so the audit must be readable here,
 * not only in a log nobody sees.
 *
 * @param audit - the recorded audit.
 * @returns the line content, without the leading label.
 */
export function formatAuditLine(audit: OrchestrationAudit): string {
  if (audit.violations.length === 0) {
    const scope = audit.selfExecuted
      ? 'self-executed (deterministic checks only)'
      : `workers ${audit.done}/${audit.spawned}${audit.llm ? `, auditor ${audit.llm.verdict}` : ', deterministic only'}`
    return `✅ clean — ${scope}`
  }
  return `⛔ ${audit.violations.length} issue(s): ${audit.violations.join(' | ')}`
}

// ─── Verdict parsing ──────────────────────────────────────────────

/**
 * Parse the auditor's reply (tolerant by design — a strict parser would turn a
 * formatting quirk into a missed finding).
 *
 * @param text - raw model reply.
 * @returns the verdict, or null when nothing usable was returned.
 */
export function parseAuditorVerdict(text: string): { verdict: 'pass' | 'flag'; issues: string[] } | null {
  if (!text) return null
  const trimmed = text.trim()
  const jsonMatch = trimmed.match(/\{[^{}]*"verdict"\s*:\s*"(pass|flag)"[^{}]*\}/i)
  if (jsonMatch) {
    const block = jsonMatch[0]
    const verdict = jsonMatch[1]!.toLowerCase() as 'pass' | 'flag'
    const issues: string[] = []
    const issueMatches = block.match(/"issues"\s*:\s*\[([^\]]*)\]/i)
    if (issueMatches) {
      const items = issueMatches[1]!.match(/"((?:[^"\\]|\\.)*)"/g) ?? []
      for (const item of items) {
        const parsed = item.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, ' ').trim()
        if (parsed) issues.push(parsed)
      }
    }
    return { verdict, issues }
  }
  // Loose fallback: a bare keyword. `flag` wins only when `pass` is absent, so
  // "this does not pass" cannot be read as a pass.
  if (/\bflag\b/i.test(trimmed) && !/\bpass\b/i.test(trimmed)) return { verdict: 'flag', issues: [] }
  if (/\bpass(es|ed)?\b/i.test(trimmed)) return { verdict: 'pass', issues: [] }
  return null
}

// ─── Orchestration of the two layers ──────────────────────────────

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_PROMPT_CAP = 6000

/**
 * Audit a finished orchestration run.
 *
 * The deterministic half always runs. The LLM half runs only when enabled, when
 * at least one route is healthy, and when the run actually delegated.
 *
 * @param input - the audit evidence.
 * @param options - routes, cooldown predicate, timeout, prompt cap.
 * @param streamCall - transport; omitted or failing degrades to deterministic-only.
 * @returns the audit record (never throws).
 */
export async function auditOrchestration(
  input: AuditInput,
  options: AuditOptions = {},
  streamCall?: AuditStreamCall,
): Promise<OrchestrationAudit> {
  const base = deterministicAudit(input)
  const audit: OrchestrationAudit = {
    auditedAt: Date.now(),
    spawned: input.spawned,
    done: input.done,
    ...base,
    violations: [...base.violations],
  }
  // Self-executed turns are OUTSIDE the audit domain: the delegation-closure
  // invariants never engaged, and the grounding evidence would be the CTO's own
  // tool trail rather than worker results.
  if (input.spawned === 0) {
    audit.selfExecuted = true
    return audit
  }
  // Cooldown-aware route filter: never re-burn an endpoint the same turn just
  // cooled down; with every route cooled, skip the LLM pass entirely.
  const isCool = options.isCool
  const healthy = (options.endpoints ?? []).filter((e) => (isCool ? !isCool(e.provider, e.model) : true))
  if (!input.enabled || streamCall === undefined || healthy.length === 0) return audit

  const prompt = buildAuditorPrompt(input, options.promptCap ?? DEFAULT_PROMPT_CAP)
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  try {
    for (const endpoint of healthy) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      let outcome: StreamTextOutcome
      try {
        outcome = await streamCall(endpoint.provider, endpoint.model, prompt, controller.signal)
      } finally {
        clearTimeout(timer)
      }
      if (!outcome.ok) continue // failover-worthy or not: try the next route
      const verdict = parseAuditorVerdict(outcome.text)
      if (!verdict) return audit // 200-but-unparseable: report nothing rather than guess
      audit.llm = { verdict: verdict.verdict, issues: verdict.issues.slice(0, 10) }
      if (verdict.verdict === 'flag' && verdict.issues.length > 0) {
        audit.violations.push(`LLM audit: ${verdict.issues.join('; ')}`)
      }
      return audit
    }
    return audit
  } catch (err) {
    // Errors are values: a broken audit must never crash the turn boundary.
    audit.violations.push(`LLM audit failed: ${err instanceof Error ? err.message : String(err)}`)
    return audit
  }
}

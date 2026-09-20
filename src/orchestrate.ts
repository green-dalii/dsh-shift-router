/**
 * dsh-shift-router — Task-level orchestration
 *
 * The plugin's whole job here is (a) decide when a Judge "smart" verdict
 * becomes an orchestration run, (b) inject the orchestrator instruction with
 * the current Fast/Smart tier chains rendered in, and (c) hold the hard caps
 * (rounds, escalations, budget). The actual loop — plan, delegate via the
 * subagent tool, review, re-delegate, take over, accept — is the Smart main
 * agent's own work once the orchestrator prompt is active.
 *
 * DSH adaptation: the orchestrator prompt is rendered as a dynamic
 * system-prompt section (activated per agent while orchestration is active)
 * instead of string-splicing into pi's event.systemPrompt.
 *
 * Worker model injection (upstream calls it mandatory): DSH's `subagent` tool
 * accepts per-call `provider`/`model`, but only inside the host-owned
 * `subagent-model-selection` allowlist (default off). The prompt therefore
 * states that condition factually instead of asserting a guarantee the plugin
 * cannot keep; index.ts warns when the allowlist is not available.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ShiftRouterConfig, RouterState, ModelRef, Tier } from './types.js'

// ─── Orchestrator prompt ─────────────────────────────────────────

export const ORCHESTRATOR_PROMPT = `# Orchestrator System Prompt (dsh-shift-router)

> You are the **CTO** for this task. The router has classified this as a
> complex, high-stakes, or judgment-heavy task — too big for a single routine
> turn. You drive the *whole task* at your intelligence level, and you
> **delegate implementation** to fast engineer subagents instead of doing all
> the routine work yourself.

## Your role

You are the orchestrator of a virtual dev team. You do NOT hand off and walk
away — you own the outcome end-to-end:

1. **Plan.** Break the task into phases with clear acceptance criteria.
2. **Delegate.** Spawn Fast engineer subagents (the \`subagent\` tool) for each
   phase's implementation.
3. **Review.** Read each subagent's result against its acceptance criteria.
4. **Iterate.** Send failed work back with concrete feedback — or take over
   the phase yourself when a worker keeps failing.
5. **Accept.** Do the final acceptance pass before declaring the task done.

## The subagent tool (DeepSeek Harness)

Spawn engineer subagents with the \`subagent\` tool. Per-run contract:

- \`description\` — a short (3-5 word) label for the delegated phase.
- \`prompt\` — a self-contained task contract (see "Task contract" below).
  A worker runs in its **own fresh session**: it inherits NO conversation
  history from you, so the prompt IS its world. Do not rely on the worker
  seeing this conversation's context.
- \`run_in_background\` — when your next action depends on the result (the
  normal case for review-then-iterate), set \`run_in_background: false\` so the
  call waits and returns the worker's result. For fire-and-forget work you
  can leave it in the background and collect the result with \`job_output\`.
- For independent phases, you may fan out several subagent calls in parallel.

### Worker model — read this carefully

You can pass \`provider\` and \`model\` to the \`subagent\` tool, and you should
whenever a Fast-tier route is available — without it a worker inherits **your
own model**, and you are the Smart tier, so the cost story collapses. But the
harness only honours those fields for routes the deployment has authorised
(its \`subagent-model-selection\` allowlist). If the call is rejected on those
fields, or you are unsure whether it took effect, delegate without them and
**say so in your CTO summary** — an honest note about the worker model is
worth more than a silent assumption that it was Fast.

The "Tier configuration" section below lists the Fast-tier routes the
deployment should have authorised for delegation.

## Task contract (how to write a worker task)

Because workers are fresh-context, your task string must be engineered for
coverage without bloat. Follow these principles:

1. **Structure it as a contract**: goal, constraints, acceptance criteria
   (how to verify done), files/repos to touch, explicit out-of-scope. A
   worker should be able to finish without asking a question.
2. **Reference, don't paste.** For files > ~2k tokens, give the path and a
   1-line role summary — the worker reads them with its own tools (read/grep).
3. **Signal density over volume.** Include only facts the worker needs to
   decide correctly: relevant interfaces/APIs, naming conventions, the exact
   failure observed (with error text), the expected behavior. Omit context
   that only explains *why* a decision was made unless it changes what the
   worker should build.
4. **Acceptance criteria are executable.** "tests pass", "lint clean", "diff
   matches spec" are verifiable; "make it better" is not.
5. **Per-phase boundaries.** Each worker task references its phase inputs
   (files/APIs produced by earlier phases) without re-importing the whole
   plan.

## Review rules

- Review each worker's result against its acceptance criteria. **Only flag
  blocking issues** — a picky reviewer burns budget and demoralizes the loop.
  Non-blocking nits go in a "notes" line, not a re-delegation trigger.
- When you re-delegate, give the worker concrete feedback: what failed,
  exactly where, and what "done" means now.
- **If workers fail {{escalationThreshold}} times in a row on the same phase,
  take over that phase yourself** — implement it directly. Do not keep
  cycling. (A success resets the streak, so isolated failures are fine.)

## Hard caps (enforced by the router, not negotiable)

- You get at most **{{maxRounds}} delegate→review rounds** for this task.
  Plan accordingly — batch work, don't drip-feed.
- Escalate (take over yourself) after **{{escalationThreshold}}** consecutive
  failed attempts on one phase.
- If you hit a cap, wrap up: deliver the best current state, summarize what
  remains, and stop. Do not ask the router for more rounds.

## Tier configuration (models involved in this task)

Fast tier chain (priority order, already filtered for health/cooldown) — the
routes the deployment should have authorised for subagent delegation
(\`provider\` / \`model\` on the call):

{{fastChain}}

Smart tier (you — for the final acceptance pass and takeovers):

{{smartChain}}

## Your output contract

- End your run with a short **CTO summary**: what was planned, what was
  delegated, what you reviewed/accepted, what remains (if any).
- Do not claim completion of acceptance criteria that were never checked.
- If the task turns out to be simple after all (no real delegation needed),
  just do it yourself — orchestration is not mandatory overhead.`

// ─── Tier chain rendering ─────────────────────────────────────────

/**
 * Render one tier's model chain as `provider/model` lines in priority order,
 * skipping models currently in cooldown.
 */
export function renderTierChain(
  models: ModelRef[] | undefined,
  isCooldown: ((provider: string, model: string) => boolean) | undefined,
): string {
  if (!models || models.length === 0) return '(none — fall back to Smart for implementation)'
  const sorted = [...models].sort((a, b) => a.priority - b.priority)
  const lines: string[] = []
  let skipped = 0
  for (const ref of sorted) {
    try {
      if (isCooldown?.(ref.provider, ref.model)) {
        skipped += 1
        continue
      }
    } catch {
      // cooldown predicate must never block rendering
    }
    lines.push(`  ${lines.length + 1}. \`${ref.provider}/${ref.model}\``)
  }
  if (lines.length === 0) {
    if (skipped > 0) return '(all models in cooldown — fall back to Smart for implementation)'
    return '(none — fall back to Smart for implementation)'
  }
  return lines.join('\n')
}

/**
 * Build the full orchestrator instruction for this turn.
 *
 * Renders the Fast tier chain (cooldown-filtered) and Smart tier chain into
 * the orchestrator template. `isCooldown` is injected so the rendered chain
 * reflects *today's* health, not a stale snapshot.
 */
export function buildOrchestratorPrompt(
  config: ShiftRouterConfig,
  isCooldown: ((provider: string, model: string) => boolean) | undefined,
): string {
  const fastChain = renderTierChain(config.tiers.fast.models, isCooldown)
  const smartChain = renderTierChain(config.tiers.smart.models, isCooldown)
  return ORCHESTRATOR_PROMPT
    .replaceAll('{{fastChain}}', fastChain)
    .replaceAll('{{smartChain}}', smartChain)
    .replaceAll('{{maxRounds}}', String(config.orchestration.maxRounds))
    .replaceAll('{{escalationThreshold}}', String(config.orchestration.escalationThreshold))
}

// ─── Orchestration lifecycle ──────────────────────────────────────

/** Fresh (inactive) orchestration state. */
export function createOrchestrationState(): RouterState['orchestration'] {
  return {
    active: false,
    rounds: 0,
    escalations: 0,
    workerFailStreak: 0,
  }
}

/** Reset orchestration state to inactive. */
export function resetOrchestration(state: RouterState): void {
  state.orchestration = createOrchestrationState()
}

/**
 * Enter orchestration for this task. Idempotent: re-entering while already
 * active keeps the existing run (does not reset caps mid-task).
 */
export function enterOrchestration(state: RouterState): void {
  const orch = state.orchestration
  if (!orch.active) {
    orch.active = true
    orch.rounds = 0
    orch.escalations = 0
    orch.workerFailStreak = 0
  }
}

/** Exit orchestration (task complete, aborted, or cap hit). */
export function exitOrchestration(state: RouterState): void {
  state.orchestration = createOrchestrationState()
}

/**
 * The part of a routing decision orchestration entry depends on. Taking the
 * decision as a named object (rather than positional booleans, which are all
 * mutually assignable) is deliberate: a swapped argument here would silently
 * inject the CTO prompt onto the wrong tier.
 */
export interface OrchestrationDecisionInput {
  /** Tier the turn will actually run at (post-EV, post-hold, post-override). */
  decisionTier: Tier
  /** The Judge gave no usable signal and the router held position. */
  held: boolean
}

/**
 * Decide whether THIS turn should run as an orchestration turn.
 *
 * All conditions must hold:
 * 1. Router enabled, orchestration mode "auto".
 * 2. The decision is NOT a hold. A hold means the Judge produced no usable
 *    signal — "keep the current tier" is not evidence that the task is
 *    complex, and escalating into a delegation loop on zero evidence is the
 *    same guess the hold rule exists to refuse.
 * 3. The DECISION tier is smart — the router actually owns a resolvable Smart
 *    model for this turn. Gating on the decision (never the raw verdict) is
 *    what keeps the CTO prompt off a Fast-tier run.
 * 4. The Judge did not veto it (`orchestrate !== false`).
 * 5. The subagent tool is available — otherwise degrade to a plain Smart run.
 *
 * Pure decision — no side effects.
 */
export function shouldOrchestrate(
  config: ShiftRouterConfig,
  decision: OrchestrationDecisionInput,
  subagentToolAvailable: boolean,
  judgeOrchestrate?: boolean,
): boolean {
  if (!config.enabled) return false
  if (config.orchestration.mode !== 'auto') return false
  if (decision.held) return false
  if (decision.decisionTier !== 'smart') return false
  if (judgeOrchestrate === false) return false
  if (!subagentToolAvailable) return false
  return true
}

/** What the harness reports about model-selectable subagent delegation. */
export interface WorkerModelSelection {
  enabled: boolean
  routes: number
}

/** Structural view of the optional host service behind that preference. */
interface SubagentModelSelectionService {
  current?: () => unknown
}

/**
 * Probe the OPTIONAL `subagentModelSelection` service (skill §6, "可选依赖").
 *
 * `ctx.get` is the sanctioned way to ask "is this optional service there?" — it
 * returns `undefined` when no provider fiber is ACTIVE instead of throwing.
 * Reading `ctx.subagentModelSelection` directly is a boot-aborting bug: the
 * Cordis context is a proxy whose `get` trap throws
 * `cannot get property "…" without inject` for any service the plugin did not
 * declare, and a structural cast (`ctx as unknown as {…}`) silences TypeScript
 * but not that trap. The throw happens inside `apply`, so it fails the plugin
 * fiber and takes the whole DSH plugin tree down with it. The service is also
 * mounted by the `web` composition only, so it is genuinely optional — see
 * tests/plugin-load.test.ts, which ships the regression for this.
 *
 * @param ctx — any context in the plugin's scope.
 * @returns the observed preference, or `undefined` when the service is absent
 *          or reports nothing usable.
 */
export function readWorkerModelSelection(ctx: Context): WorkerModelSelection | undefined {
  const service = ctx.get('subagentModelSelection') as SubagentModelSelectionService | undefined
  if (service === undefined || typeof service.current !== 'function') return undefined
  try {
    const current = service.current() as { enabled?: unknown; allowedModels?: unknown } | undefined
    if (current === null || typeof current !== 'object') return undefined
    return {
      enabled: current.enabled === true,
      routes: Array.isArray(current.allowedModels) ? current.allowedModels.length : 0,
    }
  } catch {
    // A preference that cannot be read is not a reason to fail a turn.
    return undefined
  }
}

/**
 * One-line `/router status` rendering of the worker-delegation situation.
 *
 * The startup self-check is a `ctx.logger.warn`, and the shipped DSH
 * compositions register **no log exporter** — cordis's logger only fills a
 * 1000-entry memory ring, so a warning nobody exports is a warning nobody
 * reads. The command output is the surface a user actually looks at, so the
 * same fact is stated there, in the same words as the warning's consequence.
 *
 * @param selection — the probed preference, or `undefined` when absent.
 * @returns the line content, without the leading label.
 */
export function formatWorkerModelSelection(selection: WorkerModelSelection | undefined): string {
  if (selection !== undefined && selection.enabled && selection.routes > 0) {
    const routes = `${selection.routes} authorised route${selection.routes === 1 ? '' : 's'}`
    return `✅ model-selectable (${routes}) — workers can be pinned to the Fast tier`
  }
  const state = selection === undefined
    ? 'unavailable on this harness'
    : selection.enabled
      ? 'enabled but no routes authorised'
      : 'off'
  return `⚠ not model-selectable (harness "subagent-model-selection" is ${state}) `
    + `— workers inherit the Smart model`
}

/**
 * The warning to log for the worker-model self-check (SPEC §7.4), or null when
 * nothing should be said.
 *
 * `undefined` means the harness exposes no `subagent-model-selection` service.
 * That is NOT "unknown": without that service there is no model-selectable
 * delegation at all (the settings surface is mounted by the `web` composition,
 * not by `headless`), so it is precisely a case worth warning about — but only
 * once orchestration is really about to delegate, because on a composition
 * without the surface there is nothing to switch on, only a caveat to record.
 * Only a positively-confirmed enabled allowlist with at least one route is
 * silent.
 */
export function workerModelSelectionWarning(
  selection: WorkerModelSelection | undefined,
): string | null {
  if (selection !== undefined && selection.enabled && selection.routes > 0) return null
  const state = selection === undefined
    ? 'unavailable on this harness'
    : selection.enabled
      ? 'enabled but with no authorised routes'
      : 'disabled'
  return `orchestration is on but model-selectable subagent delegation is ${state} `
    + `(mount or enable the harness "subagent-model-selection" setting and list the Fast-tier routes in allowedModels) — `
    + `workers will otherwise inherit the Smart model, so delegation loses its cost advantage`
}

/**
 * Record one worker outcome and advance the escalation streak.
 *
 * Counting CONSECUTIVE failures (rather than every failure) makes the cap mean
 * "this phase is not converging" instead of "two workers failed today".
 * Reaching the threshold consumes one escalation and resets the streak; a
 * success resets it too.
 */
export function recordWorkerOutcome(
  state: RouterState,
  config: ShiftRouterConfig,
  ok: boolean,
): void {
  const orch = state.orchestration
  if (!orch.active) return
  if (ok) {
    orch.workerFailStreak = 0
    return
  }
  orch.workerFailStreak += 1
  if (orch.workerFailStreak >= config.orchestration.escalationThreshold) {
    orch.escalations += 1
    orch.workerFailStreak = 0
  }
}

// ─── Hard-cap enforcement ────────────────────────────────────────

/**
 * Rendered in place of the orchestrator prompt once the router's hard caps
 * are exhausted: the model is told delegation is blocked and to wrap up.
 * This is plugin-enforced (the subagent tool is denied at `tools/pre-execute`
 * while the cap is hit), the prompt text is the model-facing explanation.
 */
export function buildCapNotice(config: ShiftRouterConfig): string {
  return `# ⚠ ORCHESTRATION CAP REACHED (dsh-shift-router)

The router's hard caps for this task are exhausted:
- Delegate→review rounds: **${config.orchestration.maxRounds}** used up.
- Worker escalations: **${config.orchestration.escalationThreshold}** reached.

**Stop delegating now** — the \`subagent\` tool is blocked by the router for this turn.
Wrap up with the work already done: verify what exists, summarize what remains,
and deliver your final answer. Do not attempt further subagent calls.`
}

/**
 * Hard-cap guard. Returns true when the loop must stop (cap hit) regardless
 * of what the Smart agent wants. `rounds`/`escalations` are incremented by
 * the plugin from `tools/pre-execute` / `tools/result` while orchestration is
 * active, so this is an enforced limit, not just prompt guidance.
 */
export function capHit(state: RouterState, config: ShiftRouterConfig): boolean {
  const orch = state.orchestration
  if (!orch.active) return false
  if (orch.rounds >= config.orchestration.maxRounds) return true
  if (orch.escalations >= config.orchestration.escalationThreshold) return true
  return false
}

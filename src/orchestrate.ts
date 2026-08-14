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
 * instead of string-splicing into pi's event.systemPrompt. The subagent tool
 * in DSH pins the worker model through its own `agentOptions` configuration
 * rather than per-call arguments, so the rendered tier chain is guidance the
 * CTO reads; the deployment should point the harness's subagent tool at a
 * Fast-tier model.
 */

import type { ShiftRouterConfig, RouterState, ModelRef } from './types.js'

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

The harness pins a worker's model through the \`subagent\` tool's deployment
configuration (\`agentOptions\`), NOT through the tool call. By default a
worker inherits **your own model** — you are the Smart tier, they should be
Fast. Never assume a worker runs on a specific model from the tool call
alone. The "Tier configuration" section below lists the Fast-tier models the
deployment should have pinned for the subagent tool; if you have any reason
to doubt a worker used a Fast-tier model, say so in your CTO summary.

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
- **If a worker fails ≥{{escalationThreshold}} times on the same phase, take
  over that phase yourself** — implement it directly. Do not keep cycling.

## Hard caps (enforced by the router, not negotiable)

- You get at most **{{maxRounds}} delegate→review rounds** for this task.
  Plan accordingly — batch work, don't drip-feed.
- Escalate (take over yourself) after **{{escalationThreshold}}** failed
  attempts on one phase.
- If you hit a cap, wrap up: deliver the best current state, summarize what
  remains, and stop. Do not ask the router for more rounds.

## Tier configuration (models involved in this task)

Fast tier chain (priority order, already filtered for health/cooldown) — the
models the deployment should have pinned for the subagent tool's
\`agentOptions\`:

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
    startedAt: null,
    spend: 0,
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
    orch.startedAt = Date.now()
    orch.rounds = 0
    orch.escalations = 0
    orch.spend = 0
  }
}

/** Exit orchestration (task complete, aborted, or cap hit). */
export function exitOrchestration(state: RouterState): void {
  state.orchestration = createOrchestrationState()
}

/**
 * Decide whether THIS turn should run as an orchestration turn.
 *
 * All conditions must hold:
 * 1. Orchestration mode "auto".
 * 2. Router enabled.
 * 3. Judge said "smart" (complex) — simple tasks never orchestrate.
 * 4. Smart tier model is resolvable (or requireSmartModel is false).
 * 5. The subagent tool is available — otherwise degrade to today's
 *    smart-tier run.
 *
 * Pure decision — no side effects.
 */
export function shouldOrchestrate(
  config: ShiftRouterConfig,
  judgeTier: string,
  smartModelResolvable: boolean,
  subagentToolAvailable: boolean,
): boolean {
  if (!config.enabled) return false
  if (config.orchestration.mode !== 'auto') return false
  if (judgeTier !== 'smart') return false
  if (config.orchestration.requireSmartModel && !smartModelResolvable) return false
  if (!subagentToolAvailable) return false
  return true
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

/**
 * dsh-shift-router — orchestration tests
 */

import { describe, expect, it } from 'vitest'
import {
  buildCapNotice,
  buildOrchestratorPrompt,
  capHit,
  createOrchestrationState,
  enterOrchestration,
  exitOrchestration,
  capReason,
  formatOrchestrationSpend,
  formatWorkerModelSelection,
  recordWorkerSpend,
  recordWorkerOutcome,
  renderTierChain,
  resetOrchestration,
  shouldOrchestrate,
  workerModelSelectionWarning,
} from '../src/orchestrate.js'
import { createRouterState } from '../src/router.js'
import { DEFAULT_CONFIG, type ShiftRouterConfig } from '../src/types.js'

function makeConfig(): ShiftRouterConfig {
  return structuredClone(DEFAULT_CONFIG)
}

describe('renderTierChain', () => {
  it('renders models in priority order', () => {
    const rendered = renderTierChain([
      { provider: 'p1', model: 'b', priority: 2 },
      { provider: 'p1', model: 'a', priority: 1 },
    ], undefined)
    expect(rendered).toContain('1. `p1/a`')
    expect(rendered).toContain('2. `p1/b`')
  })

  it('skips models in cooldown', () => {
    const rendered = renderTierChain([
      { provider: 'p1', model: 'a', priority: 1 },
      { provider: 'p1', model: 'b', priority: 2 },
    ], (p, m) => m === 'a')
    expect(rendered).not.toContain('p1/a')
    expect(rendered).toContain('p1/b')
  })

  it('handles empty chains', () => {
    expect(renderTierChain([], undefined)).toContain('none')
    expect(renderTierChain(undefined, undefined)).toContain('none')
  })
})

describe('buildOrchestratorPrompt', () => {
  it('substitutes placeholders', () => {
    const cfg = makeConfig()
    cfg.tiers.fast.models = [{ provider: 'p1', model: 'fast-1', priority: 1 }]
    cfg.tiers.smart.models = [{ provider: 'p2', model: 'smart-1', priority: 1 }]
    cfg.orchestration.maxRounds = 3
    cfg.orchestration.escalationThreshold = 2

    const prompt = buildOrchestratorPrompt(cfg, undefined)
    expect(prompt).toContain('p1/fast-1')
    expect(prompt).toContain('p2/smart-1')
    expect(prompt).not.toContain('{{maxRounds}}')
    expect(prompt).not.toContain('{{escalationThreshold}}')
    expect(prompt).toContain('at most **3 delegate→review rounds**')
    expect(prompt).toContain('**2** consecutive')
    // The worker-model section must describe the host allowlist instead of
    // promising a pin the plugin cannot perform (SPEC §7.4).
    expect(prompt).toContain('subagent-model-selection')
    expect(prompt).not.toContain('agentOptions')
  })

  // C2 convergence protocol: an unstructured "not right yet" is what makes a
  // loop spend rounds without converging, so the required shape is part of the
  // contract — and the takeover threshold is the SAME value the hard cap uses.
  it('states the required failure-report shape on every re-delegation', () => {
    const cfg = makeConfig()
    cfg.orchestration.escalationThreshold = 4
    const prompt = buildOrchestratorPrompt(cfg, undefined)
    expect(prompt).toContain('## Failure report')
    expect(prompt).toContain('1. What failed')
    expect(prompt).toContain('2. Where')
    expect(prompt).toContain('3. Acceptance test now')
    // The prompt must not restate a threshold the router does not enforce.
    expect(prompt).toContain('**4** consecutive')
  })

  it('forbids re-sending the same report and makes takeover mandatory', () => {
    const prompt = buildOrchestratorPrompt(makeConfig(), undefined)
    expect(prompt).toMatch(/Never re-send the same failure report/i)
    expect(prompt).toMatch(/take\s+it\s+over\s+yourself/i)
  })

  it('mentions the budget cap so the wrap-up notice is not a surprise', () => {
    expect(buildOrchestratorPrompt(makeConfig(), undefined)).toContain('maxSpendUsd')
  })
})

describe('shouldOrchestrate', () => {
  const smart = { decisionTier: 'smart' as const, held: false }
  const fast = { decisionTier: 'fast' as const, held: false }
  const held = { decisionTier: 'smart' as const, held: true }

  it('requires auto mode, a smart DECISION, and the subagent tool', () => {
    const cfg = makeConfig()
    expect(shouldOrchestrate(cfg, smart, true)).toBe(true)
    expect(shouldOrchestrate(cfg, fast, true)).toBe(false)
    expect(shouldOrchestrate(cfg, smart, false)).toBe(false) // no subagent tool
    cfg.orchestration.mode = 'off'
    expect(shouldOrchestrate(cfg, smart, true)).toBe(false)
    cfg.enabled = false
    expect(shouldOrchestrate(cfg, smart, true)).toBe(false)
  })

  it('never orchestrates on a hold — "keep position" is not evidence of complexity', () => {
    const cfg = makeConfig()
    expect(shouldOrchestrate(cfg, held, true, true)).toBe(false)
  })

  it('lets the Judge veto orchestration explicitly', () => {
    const cfg = makeConfig()
    expect(shouldOrchestrate(cfg, smart, true, true)).toBe(true)
    expect(shouldOrchestrate(cfg, smart, true, false)).toBe(false)
    // Absent (older prompt) is "no opinion", not a veto.
    expect(shouldOrchestrate(cfg, smart, true, undefined)).toBe(true)
  })
})

describe('workerModelSelectionWarning (SPEC §7.4)', () => {
  it('is silent only when delegation is positively confirmed usable', () => {
    expect(workerModelSelectionWarning({ enabled: true, routes: 2 })).toBeNull()
  })

  it('warns when the harness exposes no selection service at all', () => {
    // Absent is not "unknown" — with no service there is no model-selectable
    // delegation, which is exactly the condition to warn about.
    const warning = workerModelSelectionWarning(undefined)
    expect(warning).toContain('unavailable on this harness')
    expect(warning).toContain('subagent-model-selection')
    expect(warning).toContain('inherit the Smart model')
  })

  it('warns when the allowlist is off or empty', () => {
    expect(workerModelSelectionWarning({ enabled: false, routes: 3 })).toContain('disabled')
    expect(workerModelSelectionWarning({ enabled: true, routes: 0 })).toContain('no authorised routes')
  })
})

describe('formatWorkerModelSelection (the /router status surface)', () => {
  // The warning above goes to `ctx.logger`, which the shipped compositions
  // never export, so `/router status` is where a user can actually read this.
  it('confirms a working allowlist with its route count', () => {
    expect(formatWorkerModelSelection({ enabled: true, routes: 1 })).toContain('1 authorised route)')
    expect(formatWorkerModelSelection({ enabled: true, routes: 3 })).toContain('3 authorised routes')
    expect(formatWorkerModelSelection({ enabled: true, routes: 3 })).toContain('pinned to the Fast tier')
  })

  it('states the consequence in every unusable case', () => {
    for (const selection of [undefined, { enabled: false, routes: 1 }, { enabled: true, routes: 0 }]) {
      const line = formatWorkerModelSelection(selection)
      expect(line).toContain('⚠ not model-selectable')
      expect(line).toContain('subagent-model-selection')
      expect(line).toContain('inherit the Smart model')
    }
    expect(formatWorkerModelSelection(undefined)).toContain('unavailable on this harness')
    expect(formatWorkerModelSelection({ enabled: true, routes: 0 })).toContain('no routes authorised')
  })
})

describe('recordWorkerOutcome (consecutive-failure escalation)', () => {
  it('counts only consecutive failures toward an escalation', () => {
    const cfg = makeConfig()
    cfg.orchestration.escalationThreshold = 2
    const state = createRouterState()
    enterOrchestration(state)

    recordWorkerOutcome(state, cfg, false)
    expect(state.orchestration.workerFailStreak).toBe(1)
    expect(state.orchestration.escalations).toBe(0)

    // A success resets the streak, so the earlier failure is forgotten: two
    // isolated failures must NOT burn the cap.
    recordWorkerOutcome(state, cfg, true)
    expect(state.orchestration.workerFailStreak).toBe(0)
    recordWorkerOutcome(state, cfg, false)
    expect(state.orchestration.escalations).toBe(0)

    // Two in a row is one escalation, and the streak resets.
    recordWorkerOutcome(state, cfg, false)
    expect(state.orchestration.escalations).toBe(1)
    expect(state.orchestration.workerFailStreak).toBe(0)
  })

  it('is inert while orchestration is inactive', () => {
    const cfg = makeConfig()
    const state = createRouterState()
    recordWorkerOutcome(state, cfg, false)
    expect(state.orchestration.escalations).toBe(0)
    expect(state.orchestration.workerFailStreak).toBe(0)
  })
})

describe('orchestration lifecycle', () => {
  it('reset clears a leaked run (the sweep index.ts performs at turn start)', () => {
    const state = createRouterState()
    enterOrchestration(state)
    state.orchestration.rounds = 2
    state.orchestration.workerFailStreak = 1
    resetOrchestration(state)
    expect(state.orchestration).toEqual(createOrchestrationState())
  })

  it('enters once, exits to fresh state', () => {
    const state = createRouterState()
    expect(state.orchestration.active).toBe(false)

    enterOrchestration(state)
    expect(state.orchestration.active).toBe(true)

    // Idempotent: re-entering keeps the run's counters (and does not reset the
    // caps mid-task).
    state.orchestration.rounds = 2
    enterOrchestration(state)
    expect(state.orchestration.rounds).toBe(2)

    exitOrchestration(state)
    expect(state.orchestration).toEqual(createOrchestrationState())
  })

  it('reports cap hits', () => {
    const cfg = makeConfig()
    cfg.orchestration.maxRounds = 3
    cfg.orchestration.escalationThreshold = 2
    const state = createRouterState()
    expect(capHit(state, cfg)).toBe(false)
    enterOrchestration(state)
    state.orchestration.rounds = 3
    expect(capHit(state, cfg)).toBe(true)
    state.orchestration.rounds = 0
    state.orchestration.escalations = 2
    expect(capHit(state, cfg)).toBe(true)
  })
})

describe('cap enforcement', () => {
  it('buildCapNotice states the configured caps', () => {
    const cfg = makeConfig()
    cfg.orchestration.maxRounds = 5
    cfg.orchestration.escalationThreshold = 3
    const notice = buildCapNotice(cfg)
    expect(notice).toContain('5')
    expect(notice).toContain('3')
    expect(notice).toContain('subagent')
  })

  it('capHit is false while counters are under the caps and true when reached', () => {
    const cfg = makeConfig()
    const state = createRouterState()
    enterOrchestration(state)
    state.orchestration.rounds = cfg.orchestration.maxRounds - 1
    state.orchestration.escalations = cfg.orchestration.escalationThreshold - 1
    expect(capHit(state, cfg)).toBe(false)
    state.orchestration.rounds = cfg.orchestration.maxRounds
    expect(capHit(state, cfg)).toBe(true)
    state.orchestration.rounds = 0
    state.orchestration.escalations = cfg.orchestration.escalationThreshold
    expect(capHit(state, cfg)).toBe(true)
  })
})

describe('per-worker cost attribution (C3)', () => {
  const cap = 20

  it('accumulates one row per worker across that worker\'s messages', () => {
    const state = createRouterState()
    enterOrchestration(state)
    const orch = state.orchestration
    recordWorkerSpend(orch, 'child-a', 0.01, 100, 1000, cap)
    recordWorkerSpend(orch, 'child-a', 0.02, 250, 4000, cap)
    recordWorkerSpend(orch, 'child-b', 0.005, 50, 500, cap)

    expect(orch.workerSpends).toHaveLength(2)
    const a = orch.workerSpends.find((row) => row.workerKey === 'child-a')!
    expect(a.cost).toBeCloseTo(0.03)
    expect(a.outputTokens).toBe(350)
    expect(a.elapsedMs).toBe(4000)
    // The task total is the sum of every contribution, not the ledger's sum.
    expect(orch.spend).toBeCloseTo(0.035)
  })

  it('bounds the display ledger but never the authoritative total', () => {
    const state = createRouterState()
    enterOrchestration(state)
    const orch = state.orchestration
    for (let i = 0; i < 25; i += 1) recordWorkerSpend(orch, `child-${i}`, 0.01, 10, null, cap)
    expect(orch.workerSpends).toHaveLength(cap)
    // Oldest dropped from the DISPLAY list...
    expect(orch.workerSpends.some((row) => row.workerKey === 'child-0')).toBe(false)
    expect(orch.workerSpends.at(-1)!.workerKey).toBe('child-24')
    // ...while the budget total keeps every cent.
    expect(orch.spend).toBeCloseTo(0.25)
  })

  it('keeps a known elapsed time when a later contribution has none', () => {
    const state = createRouterState()
    enterOrchestration(state)
    recordWorkerSpend(state.orchestration, 'child-a', 0, 1, 1234, cap)
    recordWorkerSpend(state.orchestration, 'child-a', 0, 1, null, cap)
    expect(state.orchestration.workerSpends[0]!.elapsedMs).toBe(1234)
  })

  it('renders spend with the reported worker count, and nothing when idle', () => {
    const state = createRouterState()
    enterOrchestration(state)
    expect(formatOrchestrationSpend(state.orchestration)).toBeNull()
    state.orchestration.spawned = 3
    state.orchestration.done = 2
    recordWorkerSpend(state.orchestration, 'child-a', 0.0123, 10, null, cap)
    expect(formatOrchestrationSpend(state.orchestration)).toBe('$0.0123 · 2/3 workers reported')
    state.orchestration.spawned = 1
    state.orchestration.done = 1
    expect(formatOrchestrationSpend(state.orchestration)).toContain('1/1 worker reported')
  })
})

describe('orchestration budget guard (C5)', () => {
  it('is off by default, so spend never trips the cap', () => {
    const cfg = makeConfig()
    const state = createRouterState()
    enterOrchestration(state)
    state.orchestration.spend = 1_000_000
    expect(cfg.orchestration.maxSpendUsd).toBe(0)
    expect(capHit(state, cfg)).toBe(false)
  })

  it('trips at the configured budget and reports the reason', () => {
    const cfg = makeConfig()
    cfg.orchestration.maxSpendUsd = 0.5
    const state = createRouterState()
    enterOrchestration(state)
    recordWorkerSpend(state.orchestration, 'child-a', 0.49, 10, null, 20)
    expect(capHit(state, cfg)).toBe(false)
    expect(capReason(state, cfg)).toBeNull()
    recordWorkerSpend(state.orchestration, 'child-a', 0.01, 10, null, 20)
    expect(capHit(state, cfg)).toBe(true)
    expect(capReason(state, cfg)).toContain('spend $0.5000/$0.50')
  })

  it('names every cap that fired, and none that did not', () => {
    const cfg = makeConfig()
    cfg.orchestration.maxRounds = 2
    cfg.orchestration.escalationThreshold = 3
    cfg.orchestration.maxSpendUsd = 1
    const state = createRouterState()
    enterOrchestration(state)
    state.orchestration.rounds = 2
    state.orchestration.escalations = 1
    state.orchestration.spend = 1
    const reason = capReason(state, cfg)!
    expect(reason).toContain('rounds 2/2')
    expect(reason).toContain('spend $1.0000/$1.00')
    expect(reason).not.toContain('escalations')
  })
})

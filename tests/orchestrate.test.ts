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

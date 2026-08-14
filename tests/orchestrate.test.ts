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
  renderTierChain,
  shouldOrchestrate,
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
    expect(prompt).toContain('after **2** failed')
  })
})

describe('shouldOrchestrate', () => {
  it('requires auto mode, smart verdict, resolvable smart model, and the subagent tool', () => {
    const cfg = makeConfig()
    expect(shouldOrchestrate(cfg, 'smart', true, true)).toBe(true)
    expect(shouldOrchestrate(cfg, 'fast', true, true)).toBe(false)
    expect(shouldOrchestrate(cfg, 'smart', false, true)).toBe(false) // requireSmartModel
    expect(shouldOrchestrate(cfg, 'smart', true, false)).toBe(false) // no subagent tool
    cfg.orchestration.mode = 'off'
    expect(shouldOrchestrate(cfg, 'smart', true, true)).toBe(false)
    cfg.enabled = false
    expect(shouldOrchestrate(cfg, 'smart', true, true)).toBe(false)
  })

  it('relaxes the smart-model requirement when requireSmartModel is false', () => {
    const cfg = makeConfig()
    cfg.orchestration.requireSmartModel = false
    expect(shouldOrchestrate(cfg, 'smart', false, true)).toBe(true)
  })
})

describe('orchestration lifecycle', () => {
  it('enters once, exits to fresh state', () => {
    const state = createRouterState()
    expect(state.orchestration.active).toBe(false)

    enterOrchestration(state)
    expect(state.orchestration.active).toBe(true)
    expect(state.orchestration.startedAt).not.toBeNull()

    enterOrchestration(state) // idempotent — keeps the run
    const startedAt = state.orchestration.startedAt
    enterOrchestration(state)
    expect(state.orchestration.startedAt).toBe(startedAt)

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

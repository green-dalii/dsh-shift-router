/**
 * dsh-shift-router — orchestration acceptance audit tests (C1)
 *
 * The audit is a *fallback* review, so the properties that matter are:
 * it never throws (errors are values), it never runs the LLM pass outside its
 * domain (self-executed turns, disabled config, all-cooled endpoints), and its
 * deterministic half always runs. Those are what these tests pin.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  appendWorkerResult,
  auditOrchestration,
  buildAuditorPrompt,
  deterministicAudit,
  formatAuditLine,
  hasCtoSummary,
  parseAuditorVerdict,
  type AuditInput,
} from '../src/audit.js'
import type { StreamTextOutcome } from '../src/judge.js'

const SUMMARY = 'CTO summary: planned 3 phases, delegated 2, reviewed and accepted phase 1, phase 2 remains.'

/** A minimal input with everything the audit reads. */
function input(overrides: Partial<AuditInput> = {}): AuditInput {
  return {
    spawned: 2,
    done: 2,
    rounds: 2,
    maxRounds: 3,
    escalations: 0,
    escalationThreshold: 2,
    capReason: null,
    finalText: SUMMARY,
    workerResults: 'worker A: done\n\n--- worker result ---\n\nworker B: done',
    enabled: true,
    ...overrides,
  }
}

const okText = (text: string) => async (): Promise<StreamTextOutcome> => ({ ok: true, text })

describe('hasCtoSummary', () => {
  it('accepts the marker token or the summary vocabulary', () => {
    expect(hasCtoSummary(SUMMARY)).toBe(true)
    expect(hasCtoSummary('CTO summary: nothing done')).toBe(true)
    expect(hasCtoSummary('We planned it, then delegated to two workers and reviewed the output.')).toBe(true)
  })

  it('rejects prose that only claims completion', () => {
    expect(hasCtoSummary('')).toBe(false)
    expect(hasCtoSummary('Done! I finished the task.')).toBe(false)
  })
})

describe('deterministicAudit (always runs, free)', () => {
  it('is clean when every dispatched worker reported and the CTO closed the loop', () => {
    const result = deterministicAudit(input())
    expect(result.complete).toBe(true)
    expect(result.hasCtoSummary).toBe(true)
    expect(result.capHit).toBe(false)
    expect(result.violations).toEqual([])
  })

  it('flags a worker that never reported back', () => {
    const result = deterministicAudit(input({ done: 1 }))
    expect(result.complete).toBe(false)
    expect(result.violations.join(' ')).toContain('worker results incomplete (done 1/2)')
  })

  it('flags a delegation run that never reported acceptance', () => {
    const result = deterministicAudit(input({ finalText: 'All good, shipped it.' }))
    expect(result.violations.join(' ')).toContain('no CTO summary')
  })

  it('does NOT demand a CTO summary from a self-executed turn', () => {
    // spawned = 0 is outside the delegation contract: the CTO owed no
    // acceptance report over worker results, and flagging it would punish a
    // turn that was simply handled directly.
    const result = deterministicAudit(input({ spawned: 0, done: 0, finalText: 'Done — fixed it inline.' }))
    expect(result.violations).toEqual([])
    expect(result.complete).toBe(true)
    expect(result.hasCtoSummary).toBe(false)
  })

  it('records the cap that ended the run', () => {
    const result = deterministicAudit(input({ capReason: 'orchestration cap reached (rounds 3/3)' }))
    expect(result.capHit).toBe(true)
    expect(result.violations.join(' ')).toContain('hard cap')
  })
})

describe('parseAuditorVerdict', () => {
  it('reads the JSON contract and its issues', () => {
    const verdict = parseAuditorVerdict('{"verdict":"flag","issues":["no worker result referenced","placeholder code"]}')
    expect(verdict).toEqual({ verdict: 'flag', issues: ['no worker result referenced', 'placeholder code'] })
  })

  it('accepts a pass with no issues', () => {
    expect(parseAuditorVerdict('{"verdict":"pass","issues":[]}')).toEqual({ verdict: 'pass', issues: [] })
  })

  it('falls back to a bare keyword, and gives up on prose', () => {
    expect(parseAuditorVerdict('flag')?.verdict).toBe('flag')
    expect(parseAuditorVerdict('I think this passes.')?.verdict).toBe('pass')
    expect(parseAuditorVerdict('unclear')).toBeNull()
    expect(parseAuditorVerdict('')).toBeNull()
  })
})

describe('buildAuditorPrompt', () => {
  it('substitutes the three evidence blocks', () => {
    const prompt = buildAuditorPrompt(input({ goal: 'ship billing v2' }), 6000)
    expect(prompt).toContain('ship billing v2')
    expect(prompt).toContain(SUMMARY)
    expect(prompt).toContain('worker A: done')
  })

  it('marks absent evidence instead of leaving a blank, and bounds the prompt', () => {
    const prompt = buildAuditorPrompt(input({ goal: undefined, workerResults: 'x'.repeat(50_000) }), 500)
    expect(prompt).toContain('(not captured)')
    expect(prompt.length).toBeLessThan(4000)
  })
})

describe('auditOrchestration', () => {
  it('never calls the LLM for a self-executed turn', async () => {
    const streamCall = vi.fn()
    const audit = await auditOrchestration(input({ spawned: 0, done: 0 }), undefined, streamCall)
    expect(audit.selfExecuted).toBe(true)
    expect(streamCall).not.toHaveBeenCalled()
    expect(audit.llm).toBeUndefined()
  })

  it('runs only the deterministic half when disabled', async () => {
    const streamCall = vi.fn()
    const audit = await auditOrchestration(input({ enabled: false }), undefined, streamCall)
    expect(streamCall).not.toHaveBeenCalled()
    expect(audit.violations).toEqual([])
  })

  it('skips the LLM pass when every route is cooling down', async () => {
    const streamCall = vi.fn()
    const endpoints = [{ provider: 'p', model: 'm' }]
    const audit = await auditOrchestration(
      input(),
      { endpoints, isCool: () => true },
      streamCall,
    )
    expect(streamCall).not.toHaveBeenCalled()
    expect(audit.llm).toBeUndefined()
  })

  it('walks the chain past a failing route and records a flag', async () => {
    const streamCall = vi.fn(async (provider: string) =>
      provider === 'dead'
        ? ({ ok: false, code: '429' } as StreamTextOutcome)
        : ({ ok: true, text: '{"verdict":"flag","issues":["claimed done with no referenced result"]}' } as StreamTextOutcome))
    const audit = await auditOrchestration(
      input(),
      { endpoints: [{ provider: 'dead', model: 'm' }, { provider: 'live', model: 'm2' }] },
      streamCall as never,
    )
    expect(streamCall).toHaveBeenCalledTimes(2)
    expect(audit.llm?.verdict).toBe('flag')
    expect(audit.violations.join(' ')).toContain('LLM audit: claimed done with no referenced result')
  })

  it('is silent when the auditor passes', async () => {
    const audit = await auditOrchestration(
      input(),
      { endpoints: [{ provider: 'p', model: 'm' }] },
      okText('{"verdict":"pass","issues":[]}') as never,
    )
    expect(audit.llm).toEqual({ verdict: 'pass', issues: [] })
    expect(audit.violations).toEqual([])
  })

  it('turns a thrown auditor into a violation, never a crash', async () => {
    // Errors are values: the turn has already finished, so a broken audit must
    // degrade to a reported finding.
    const audit = await auditOrchestration(
      input(),
      { endpoints: [{ provider: 'p', model: 'm' }] },
      (async () => { throw new Error('socket hang up') }) as never,
    )
    expect(audit.violations.join(' ')).toContain('LLM audit failed')
    expect(audit.violations.join(' ')).toContain('socket hang up')
  })

  it('reports an unparseable auditor reply without inventing a verdict', async () => {
    const audit = await auditOrchestration(
      input(),
      { endpoints: [{ provider: 'p', model: 'm' }] },
      okText('I could not decide.') as never,
    )
    expect(audit.llm).toBeUndefined()
    expect(audit.violations).toEqual([])
  })

  it('always stamps the audit time and carries the deterministic findings', async () => {
    const audit = await auditOrchestration(input({ done: 0 }), undefined, undefined)
    expect(audit.auditedAt).toBeGreaterThan(0)
    expect(audit.violations.join(' ')).toContain('worker results incomplete')
  })
})

describe('appendWorkerResult (bounded evidence capture)', () => {
  it('skips empty results and marks truncation', () => {
    const results: string[] = []
    appendWorkerResult(results, '   ', 6000)
    expect(results).toEqual([])
    // Per-result budget = cap/8, floored at 200 so the auditor always gets some
    // evidence even under a tiny prompt cap. 800/8 = 100 < 200 ⇒ floor wins.
    appendWorkerResult(results, 'x'.repeat(5000), 800)
    expect(results).toHaveLength(1)
    expect(results[0]).toHaveLength(201)
    expect(results[0]!.endsWith('…')).toBe(true)
    // Under a large cap the split dominates: 6000/8 = 750.
    appendWorkerResult(results, 'y'.repeat(5000), 6000)
    expect(results[1]).toHaveLength(751)
    // A result that fits is stored untouched.
    appendWorkerResult(results, 'short', 6000)
    expect(results[2]).toBe('short')
  })

  it('keeps the most recent results and drops the oldest', () => {
    const results: string[] = []
    for (let i = 0; i < 12; i += 1) appendWorkerResult(results, `worker ${i}`, 6000)
    expect(results).toHaveLength(8)
    expect(results[0]).toBe('worker 4')
    expect(results.at(-1)).toBe('worker 11')
  })
})

describe('formatAuditLine (the /router status surface)', () => {
  it('reports a clean delegation run with its worker counts and verdict', () => {
    const line = formatAuditLine({
      auditedAt: 1, spawned: 2, done: 2, complete: true, hasCtoSummary: true,
      capHit: false, violations: [], llm: { verdict: 'pass', issues: [] },
    })
    expect(line).toContain('✅ clean')
    expect(line).toContain('workers 2/2')
    expect(line).toContain('auditor pass')
  })

  it('says so when only the deterministic half ran', () => {
    const line = formatAuditLine({
      auditedAt: 1, spawned: 1, done: 1, complete: true, hasCtoSummary: true, capHit: false, violations: [],
    })
    expect(line).toContain('deterministic only')
  })

  it('marks a self-executed run and lists every violation', () => {
    const selfExecuted = formatAuditLine({
      auditedAt: 1, spawned: 0, done: 0, complete: true, hasCtoSummary: false, capHit: false,
      violations: [], selfExecuted: true,
    })
    expect(selfExecuted).toContain('self-executed')
    const flagged = formatAuditLine({
      auditedAt: 1, spawned: 2, done: 1, complete: false, hasCtoSummary: false, capHit: true,
      violations: ['worker results incomplete (done 1/2)', 'no CTO summary'],
    })
    expect(flagged).toContain('⛔ 2 issue(s)')
    expect(flagged).toContain('worker results incomplete (done 1/2)')
    expect(flagged).toContain('no CTO summary')
  })
})

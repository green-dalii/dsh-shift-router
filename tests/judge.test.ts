/**
 * dsh-shift-router — judge tests
 */

import { describe, expect, it } from 'vitest'
import {
  classify,
  extractTier,
  JUDGE_PROMPT,
  parseConfidenceFromText,
  parseJudgeAnswer,
  parseOrchestrateFromText,
  type JudgeCallOutcome,
} from '../src/judge.js'
import type { ModelRef } from '../src/types.js'

describe('extractTier', () => {
  it('parses strict JSON', () => {
    expect(extractTier('{"tier": "fast"}')).toBe('fast')
    expect(extractTier('{"tier": "smart", "confidence": 0.9}')).toBe('smart')
  })

  it('parses loose JSON-like text', () => {
    expect(extractTier("tier = 'smart'")).toBe('smart')
    expect(extractTier('tier: "fast"')).toBe('fast')
  })

  it('parses bare keywords', () => {
    expect(extractTier('SMART because of stakes')).toBe('smart')
    expect(extractTier('just fast, nothing else')).toBe('fast')
  })

  it('returns null for unparseable text', () => {
    expect(extractTier('')).toBeNull()
    expect(extractTier('no tier here')).toBeNull()
    expect(extractTier('{"tier": "medium"}')).toBeNull()
  })
})

describe('parseJudgeAnswer', () => {
  it('extracts confidence and reason', () => {
    const parsed = parseJudgeAnswer('{"tier":"smart","confidence":0.85,"reason":"architecture direction"}')
    expect(parsed).toEqual({ tier: 'smart', confidence: 0.85, reason: 'architecture direction' })
  })

  it('tolerates missing optional fields', () => {
    const parsed = parseJudgeAnswer('{"tier":"fast"}')
    expect(parsed).toEqual({ tier: 'fast' })
  })

  it('rejects out-of-range confidence', () => {
    expect(parseConfidenceFromText('{"tier":"fast","confidence":1.5}')).toBeUndefined()
  })
})

describe('classify', () => {
  const chain: ModelRef[] = [
    { provider: 'p1', model: 'm1', priority: 1 },
    { provider: 'p1', model: 'm2', priority: 2 },
  ]

  it('returns the first successful judge verdict', async () => {
    const calls: string[] = []
    const streamCall = async (provider: string, model: string): Promise<JudgeCallOutcome> => {
      calls.push(`${provider}/${model}`)
      if (model === 'm2') return { ok: true, result: { tier: 'smart', source: 'llm', confidence: 0.9 } }
      return { ok: false, code: null }
    }
    const result = await classify('hello', chain, streamCall, 1000)
    expect(result).toEqual({ tier: 'smart', source: 'llm', confidence: 0.9 })
    expect(calls).toEqual(['p1/m1', 'p1/m2'])
  })

  it('holds position (fast/fallback) when every model fails', async () => {
    const result = await classify('hello', chain, async () => ({ ok: false, code: '429' }), 1000)
    expect(result).toEqual({ tier: 'fast', source: 'fallback' })
  })

  it('honors the cooldown predicate', async () => {
    const calls: string[] = []
    const streamCall = async (provider: string, model: string): Promise<JudgeCallOutcome> => {
      calls.push(`${provider}/${model}`)
      return { ok: true, result: { tier: 'fast', source: 'llm' } }
    }
    await classify('hello', chain, streamCall, 1000, (p, m) => m === 'm1')
    expect(calls).toEqual(['p1/m2'])
  })

  it('invokes onFailure with the failover code', async () => {
    const failures: string[] = []
    const streamCall = async (provider: string, model: string): Promise<JudgeCallOutcome> => {
      if (model === 'm1') return { ok: false, code: '429' }
      return { ok: false, code: null } // network — no onFailure
    }
    await classify('hello', chain, streamCall, 1000, undefined, (p, m, code) => {
      failures.push(`${p}/${m}:${code}`)
    })
    expect(failures).toEqual(['p1/m1:429'])
  })

  it('sorts the chain by priority', async () => {
    const unsorted: ModelRef[] = [
      { provider: 'p1', model: 'm2', priority: 2 },
      { provider: 'p1', model: 'm1', priority: 1 },
    ]
    const calls: string[] = []
    await classify('hello', unsorted, async (p, m) => {
      calls.push(`${p}/${m}`)
      return { ok: true, result: { tier: 'fast', source: 'llm' } }
    }, 1000)
    expect(calls).toEqual(['p1/m1'])
  })

  it('falls back for an empty chain', async () => {
    const result = await classify('hello', null, async () => ({ ok: false, code: null }), 1000)
    expect(result.tier).toBe('fast')
    expect(result.source).toBe('fallback')
  })

  it('marks an all-endpoints-failed result as a fallback, never a real verdict', async () => {
    // The router reads `source === 'fallback'` as a HOLD. If this ever changed
    // to `source: 'llm'`, two judge outages would silently downgrade a smart
    // session — the exact upstream bug SPEC §2 step 2 exists to prevent.
    const chain: ModelRef[] = [
      { provider: 'p1', model: 'm1', priority: 1 },
      { provider: 'p1', model: 'm2', priority: 2 },
    ]
    const result = await classify('hello', chain, async () => ({ ok: false, code: '429' }), 1000)
    expect(result.source).toBe('fallback')
    expect(result.confidence).toBeUndefined()
  })

  it('carries the orchestrate signal through a successful call', async () => {
    const chain: ModelRef[] = [{ provider: 'p1', model: 'm1', priority: 1 }]
    const result = await classify('hello', chain, async () => ({
      ok: true,
      result: { tier: 'smart', source: 'llm', confidence: 0.9, orchestrate: true },
    }), 1000)
    expect(result.orchestrate).toBe(true)
  })
})

describe('parseOrchestrateFromText', () => {
  it('reads the documented key and tolerant aliases', () => {
    expect(parseOrchestrateFromText('{"tier":"smart","orchestrate":true}')).toBe(true)
    expect(parseOrchestrateFromText('{"tier":"smart","orchestrate": false}')).toBe(false)
    expect(parseOrchestrateFromText('orchestrate: yes')).toBe(true)
    expect(parseOrchestrateFromText('delegate = "no"')).toBe(false)
  })

  it('returns undefined when the model said nothing (no opinion, not a veto)', () => {
    expect(parseOrchestrateFromText('{"tier":"smart","confidence":0.9}')).toBeUndefined()
    expect(parseOrchestrateFromText('')).toBeUndefined()
  })

  it('is exposed through parseJudgeAnswer', () => {
    const parsed = parseJudgeAnswer('{"tier":"smart","confidence":0.95,"orchestrate":true}')
    expect(parsed).toMatchObject({ tier: 'smart', confidence: 0.95, orchestrate: true })
    const older = parseJudgeAnswer('{"tier":"fast","confidence":0.9}')
    expect(older).not.toHaveProperty('orchestrate')
  })
})

describe('JUDGE_PROMPT contract (SPEC §6)', () => {
  it('documents all four output keys', () => {
    for (const key of ['"tier"', '"confidence"', '"reason"', '"orchestrate"']) {
      expect(JUDGE_PROMPT).toContain(key)
    }
  })

  it('makes an explicit instruction a certainty rather than a hedge', () => {
    expect(JUDGE_PROMPT).toContain('certainty, not a hedge')
    expect(JUDGE_PROMPT).toContain('\u2265 0.9')
  })

  it('carries the doc-aware and bulk-batch fast rules', () => {
    expect(JUDGE_PROMPT).toContain('Document handling')
    expect(JUDGE_PROMPT).toContain('bulk batches')
  })

  it('contains no keyword/regex decision gate', () => {
    // The Judge is the sole classifier (SPEC §0). A regex gate briefly existed
    // upstream and was removed again; it must not appear here.
    expect(JUDGE_PROMPT.toLowerCase()).not.toContain('regex')
  })
})

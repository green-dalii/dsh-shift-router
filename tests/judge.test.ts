/**
 * dsh-shift-router — judge tests
 */

import { describe, expect, it } from 'vitest'
import {
  classify,
  extractTier,
  parseConfidenceFromText,
  parseJudgeAnswer,
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
})

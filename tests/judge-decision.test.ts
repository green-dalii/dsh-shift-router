/**
 * dsh-shift-router — decision-model Judge tests (SPEC §6.6, §6.3)
 *
 * The wire shapes are fixture-frozen from upstream's v1.7.0 implementation
 * (`buildDecisionRequestBody` / `parseDecisionResponse`), because the point of
 * copying a protocol instead of inventing one is that the two sides agree. The
 * load-bearing properties are: an out-of-set choice is never guessed, a failure
 * never cools a model it should not, and the ladder keeps walking.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  classify,
  createDecisionCall,
  DECISION_MIN_JUDGE_TIMEOUT_MS,
  DECISION_PROVIDER_LABEL,
  judgeApiUrl,
  JUDGE_PROMPT,
  buildDecisionRequestBody,
  parseDecisionResponse,
  resolvedModelOf,
  type DecisionCall,
  type JudgeCalls,
} from '../src/judge.js'
import type { JudgeChainEntry, JudgeResult } from '../src/types.js'

const ENTRY: JudgeChainEntry = {
  provider: DECISION_PROVIDER_LABEL,
  model: 'jev-latest',
  priority: 1,
  kind: 'decision',
}
const CHAT_ENTRY: JudgeChainEntry = { provider: 'p1', model: 'fast-1', priority: 1, kind: 'chat' }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('judgeApiUrl', () => {
  it('appends the System One path to the configured base', () => {
    expect(judgeApiUrl('https://api.example.test')).toBe('https://api.example.test/v1/systemone')
  })

  it('does not double the separator on a trailing slash', () => {
    expect(judgeApiUrl('https://api.example.test/')).toBe('https://api.example.test/v1/systemone')
    expect(judgeApiUrl('https://api.example.test///')).toBe('https://api.example.test/v1/systemone')
  })
})

describe('buildDecisionRequestBody', () => {
  it('sends the tier rubric as a choice question and orchestration as noul', () => {
    const body = buildDecisionRequestBody('jev-latest', 'fix the failing test')
    expect(body.model).toBe('jev-latest')
    expect(body.state).toBe('fix the failing test')
    const questions = body.questions as Record<string, Record<string, unknown>>
    expect(questions.tier!.type).toBe('choice')
    expect(questions.tier!.instructions).toBe(JUDGE_PROMPT)
    expect(Object.keys(questions.tier!.criteria as object)).toEqual(['fast', 'smart'])
    expect(questions.orchestrate!.type).toBe('noul')
    expect(Object.keys(questions.orchestrate!.criteria as object)).toEqual(['true', 'false'])
  })
})

describe('parseDecisionResponse', () => {
  it('reads a wrapped answers envelope', () => {
    expect(parseDecisionResponse({
      model: 'jev-1.13.0',
      answers: {
        tier: { choice: 'smart', probabilities: { fast: 0.1, smart: 0.9 } },
        orchestrate: { noul: 0.7 },
      },
    })).toEqual({ tier: 'smart', confidence: 0.9, orchestrate: true })
  })

  it('reads a bare answer map too', () => {
    expect(parseDecisionResponse({
      tier: { choice: 'fast', probabilities: { fast: 0.8, smart: 0.2 } },
    })).toEqual({ tier: 'fast', confidence: 0.8 })
  })

  it('reads the probability of the *chosen* tier, not of smart', () => {
    // A fast verdict carrying p(smart)=0.2 must yield confidence 0.8: pSmart
    // then contributes 1 − 0.8 = 0.2, which is the same evidence read twice.
    const parsed = parseDecisionResponse({ tier: { choice: 'fast', probabilities: { fast: 0.8, smart: 0.2 } } })
    expect(parsed?.confidence).toBe(0.8)
  })

  it('lower-cases the choice and rejects anything outside the set', () => {
    expect(parseDecisionResponse({ tier: { choice: 'SMART' } })?.tier).toBe('smart')
    expect(parseDecisionResponse({ tier: { choice: 'medium' } })).toBeNull()
    expect(parseDecisionResponse({ tier: { choice: 1 } })).toBeNull()
    expect(parseDecisionResponse({ tier: {} })).toBeNull()
  })

  it('never guesses a verdict out of a malformed response', () => {
    expect(parseDecisionResponse(null)).toBeNull()
    expect(parseDecisionResponse('smart')).toBeNull()
    expect(parseDecisionResponse({})).toBeNull()
    expect(parseDecisionResponse({ answers: { tier: null } })).toBeNull()
  })

  it('falls back to a numeric confidence when probabilities are absent', () => {
    expect(parseDecisionResponse({ tier: { choice: 'smart', confidence: 0.6 } })).toEqual({
      tier: 'smart',
      confidence: 0.6,
    })
  })

  it('treats noul >= 0.5 as orchestrate, and reads it bare or nested', () => {
    expect(parseDecisionResponse({ tier: { choice: 'smart' }, orchestrate: 0.5 })?.orchestrate).toBe(true)
    expect(parseDecisionResponse({ tier: { choice: 'smart' }, orchestrate: 0.49 })?.orchestrate).toBe(false)
    expect(parseDecisionResponse({ tier: { choice: 'smart' }, orchestrate: { noul: 0.9 } })?.orchestrate).toBe(true)
  })

  it('omits orchestrate when the response carries no noul at all', () => {
    const parsed = parseDecisionResponse({ tier: { choice: 'smart' } })
    expect(parsed).not.toBeNull()
    expect('orchestrate' in parsed!).toBe(false)
  })

  it('carries no reason — a decision response has no prose to carry', () => {
    const parsed = parseDecisionResponse({
      tier: { choice: 'smart', probabilities: { smart: 1 }, reason: 'should be ignored' },
    })
    expect('reason' in parsed!).toBe(false)
  })
})

describe('resolvedModelOf', () => {
  it('reports the id the endpoint resolved an alias to', () => {
    expect(resolvedModelOf({ model: 'jev-1.13.0' })).toBe('jev-1.13.0')
  })

  it('is undefined for anything that is not a non-empty string', () => {
    expect(resolvedModelOf({})).toBeUndefined()
    expect(resolvedModelOf({ model: '' })).toBeUndefined()
    expect(resolvedModelOf({ model: 7 })).toBeUndefined()
    expect(resolvedModelOf(null)).toBeUndefined()
  })
})

describe('createDecisionCall', () => {
  const okBody = {
    model: 'jev-1.13.0',
    answers: {
      tier: { choice: 'smart', probabilities: { fast: 0.05, smart: 0.95 } },
      orchestrate: { noul: 0.9 },
    },
  }

  function setup(overrides: Partial<Parameters<typeof createDecisionCall>[0]> = {}) {
    const fetchImpl = vi.fn(async () => jsonResponse(okBody))
    const resolveKey = vi.fn(async () => 'sk-test')
    const call = createDecisionCall({
      baseUrl: 'https://api.example.test',
      apiKeyRef: 'TYPESAFE_KEY',
      resolveKey,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      ...overrides,
    })
    return { call, fetchImpl, resolveKey }
  }

  it('POSTs one request carrying both questions, with the referenced key', async () => {
    const { call, fetchImpl, resolveKey } = setup()
    const outcome = await call(ENTRY, 'fix the failing test', new AbortController().signal)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.example.test/v1/systemone')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-test')
    const sent = JSON.parse(init.body as string) as Record<string, unknown>
    expect(sent.model).toBe('jev-latest')
    expect(Object.keys(sent.questions as object)).toEqual(['tier', 'orchestrate'])
    // Resolved per call, never cached across judgements.
    expect(resolveKey).toHaveBeenCalledWith('TYPESAFE_KEY')

    expect(outcome).toEqual({
      ok: true,
      result: {
        tier: 'smart',
        source: 'llm',
        confidence: 0.95,
        orchestrate: true,
        resolvedModel: 'jev-1.13.0',
      },
    })
  })

  it('omits the key header when no reference is configured', async () => {
    const { call, fetchImpl, resolveKey } = setup({ apiKeyRef: '' })
    await call(ENTRY, 'hello', new AbortController().signal)
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect('x-api-key' in (init.headers as Record<string, string>)).toBe(false)
    expect(resolveKey).not.toHaveBeenCalled()
  })

  it('does not call the network when the key cannot be resolved', async () => {
    const { call, fetchImpl } = setup({ resolveKey: async () => undefined })
    const outcome = await call(ENTRY, 'hello', new AbortController().signal)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(outcome).toEqual({ ok: false, code: null })
  })

  it('maps HTTP statuses onto the shared failover vocabulary', async () => {
    for (const [status, code] of [[429, '429'], [402, '402'], [503, '503']] as const) {
      const { call } = setup({ fetchImpl: (async () => jsonResponse({}, status)) as unknown as typeof fetch })
      expect(await call(ENTRY, 'hello', new AbortController().signal)).toEqual({ ok: false, code })
    }
  })

  it('does not cool a model for a 4xx it cannot classify, a timeout, or a bad body', async () => {
    const forbidden = setup({ fetchImpl: (async () => jsonResponse({}, 403)) as unknown as typeof fetch })
    expect(await forbidden.call(ENTRY, 'h', new AbortController().signal)).toEqual({ ok: false, code: null })

    const thrown = setup({
      fetchImpl: (async () => { throw new Error('network down') }) as unknown as typeof fetch,
    })
    expect(await thrown.call(ENTRY, 'h', new AbortController().signal)).toEqual({ ok: false, code: null })

    const notJson = setup({
      fetchImpl: (async () => new Response('<html>nope</html>', { status: 200 })) as unknown as typeof fetch,
    })
    expect(await notJson.call(ENTRY, 'h', new AbortController().signal)).toEqual({ ok: false, code: null })

    // A 200 that carries no usable choice is not a verdict and cools nothing.
    const noChoice = setup({
      fetchImpl: (async () => jsonResponse({ answers: { tier: { choice: 'medium' } } })) as unknown as typeof fetch,
    })
    expect(await noChoice.call(ENTRY, 'h', new AbortController().signal)).toEqual({ ok: false, code: null })
  })
})

describe('classify over the ladder', () => {
  const ladder: JudgeChainEntry[] = [ENTRY, CHAT_ENTRY]
  const neverDecision: DecisionCall = async () => {
    throw new Error('rung 1 must not be called')
  }

  it('returns the rung-1 verdict without touching rung 2', async () => {
    const chat = vi.fn(async (): Promise<{ ok: true; result: JudgeResult }> => ({
      ok: true,
      result: { tier: 'fast', source: 'llm' },
    }))
    const calls: JudgeCalls = {
      decision: async () => ({ ok: true, result: { tier: 'smart', source: 'llm', confidence: 0.9 } }),
      chat: chat as unknown as JudgeCalls['chat'],
    }
    const result = await classify('hello', ladder, calls, 5000)
    expect(result).toEqual({ tier: 'smart', source: 'llm', confidence: 0.9 })
    expect(chat).not.toHaveBeenCalled()
  })

  it('falls through a failing rung 1 in the same turn instead of releasing', async () => {
    const seen: string[] = []
    const calls: JudgeCalls = {
      decision: async () => ({ ok: false, code: '429' }),
      chat: async (provider, model) => {
        seen.push(`${provider}/${model}`)
        return { ok: true, result: { tier: 'fast', source: 'llm', confidence: 0.7 } }
      },
    }
    const cooled: string[] = []
    const result = await classify('hello', ladder, calls, 5000, undefined, (p, m, code) => {
      cooled.push(`${p}/${m}:${code}`)
    })
    expect(result.source).toBe('llm')
    expect(seen).toEqual(['p1/fast-1'])
    // The cooldown key is the ladder's own label for the decision endpoint.
    expect(cooled).toEqual([`${DECISION_PROVIDER_LABEL}/jev-latest:429`])
  })

  it('releases (source: fallback) only when every rung failed', async () => {
    const calls: JudgeCalls = {
      decision: async () => ({ ok: false, code: null }),
      chat: async () => ({ ok: false, code: '503' }),
    }
    expect(await classify('hello', ladder, calls, 5000)).toEqual({ tier: 'fast', source: 'fallback' })
  })

  it('skips a rung-1 entry that is in cooldown', async () => {
    const calls: JudgeCalls = {
      decision: neverDecision,
      chat: async () => ({ ok: true, result: { tier: 'fast', source: 'llm' } }),
    }
    const result = await classify('hello', ladder, calls, 5000, (provider) => provider === DECISION_PROVIDER_LABEL)
    expect(result.source).toBe('llm')
  })

  it('floors a decision attempt at the measured minimum, and leaves chat at the configured one', async () => {
    vi.useFakeTimers()
    try {
      const seen: string[] = []
      let decisionSignal: AbortSignal | undefined
      const calls: JudgeCalls = {
        decision: async (_entry, _prompt, signal) => {
          seen.push('decision')
          decisionSignal = signal
          if (signal.aborted) return { ok: false, code: null }
          return new Promise((resolve) => {
            signal.addEventListener('abort', () => resolve({ ok: false, code: null }))
          })
        },
        chat: async (provider, model) => {
          seen.push(`${provider}/${model}`)
          return { ok: true, result: { tier: 'fast', source: 'llm' } }
        },
      }

      const pending = classify('hello', ladder, calls, 5000)
      // At the configured 5 s a chat attempt would already have been aborted;
      // a decision attempt must still be in flight (measured 1.4–6.6 s).
      await vi.advanceTimersByTimeAsync(5000)
      expect(decisionSignal?.aborted).toBe(false)

      await vi.advanceTimersByTimeAsync(DECISION_MIN_JUDGE_TIMEOUT_MS)
      const result = await pending
      expect(seen).toEqual(['decision', 'p1/fast-1'])
      expect(result.source).toBe('llm')
    } finally {
      vi.useRealTimers()
    }
  })
})

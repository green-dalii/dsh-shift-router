/**
 * dsh-shift-router — Judge source and availability-ladder tests
 *
 * SPEC §6.3 (the ladder) and §6.4 (the three modes). Two properties matter
 * beyond "the right chain comes out": the migration contract must never lose a
 * user's `judge.models` list and never brick routing on a typo, and the ladder's
 * order is authoritative — a configured judge is rung 1 whatever its priority
 * says, because its priority orders it against its *own* rung only.
 */

import { describe, expect, it } from 'vitest'
import { Config, deepMergeConfig } from '../src/config.js'
import {
  DECISION_MIN_JUDGE_TIMEOUT_MS,
  judgeChainFor,
  judgeTimeoutFor,
  normalizeJudgeMode,
} from '../src/judge.js'
import { DEFAULT_CONFIG, type ShiftRouterConfig } from '../src/types.js'

const FAST = [
  { provider: 'p1', model: 'fast-1', priority: 1 },
  { provider: 'p2', model: 'fast-2', priority: 2 },
]

function cfg(judge: unknown, fast: typeof FAST = FAST): ShiftRouterConfig {
  return deepMergeConfig(DEFAULT_CONFIG, {
    tiers: { fast: { models: fast } },
    routing: { judge },
  } as never)
}

type StandardResult =
  | { value: unknown }
  | { issues: { message: string }[] }

function validate(value: unknown): StandardResult {
  return (Config as unknown as { '~standard': { validate(v: unknown): StandardResult } })['~standard'].validate(value)
}

describe('routing.judge schema', () => {
  it('resolves to a fast-chain no-op when the object is absent', () => {
    const out = validate({})
    expect('issues' in out).toBe(false)
    const routing = ((out as { value: { routing: Record<string, unknown> } }).value.routing)
    const judge = routing.judge as { mode?: unknown; models: unknown; decision: unknown }
    // `mode` stays ABSENT: filling the default in here would make a stored
    // `judge.models` list inert instead of migrating it to `custom`.
    expect(judge.mode).toBeUndefined()
    expect(normalizeJudgeMode(judge)).toBe('fast-chain')
    expect(judge.models).toEqual([])
    expect(judge.decision).toEqual({ baseUrl: '', model: 'jev-latest', apiKeyRef: '' })
  })

  it('keeps a stored models list distinguishable from an explicit mode', () => {
    const out = validate({ routing: { judge: { models: [{ provider: 'p', model: 'm', priority: 1 }] } } })
    const judge = ((out as { value: { routing: { judge: Record<string, unknown> } } }).value.routing.judge)
    expect(normalizeJudgeMode(judge)).toBe('custom')
  })

  it('carries the migration all the way to the ladder, through the schema', () => {
    // The schema→ladder path is where a default would have quietly swallowed the
    // list: `normalizeJudgeMode` alone passing does not prove the built config
    // still holds the same information.
    const out = validate({ routing: { judge: { models: [{ provider: 'jc', model: 'judge-1', priority: 1 }] } } })
    const built = (out as { value: ShiftRouterConfig }).value
    built.tiers.fast.models = [{ provider: 'p1', model: 'fast-1', priority: 1 }]
    expect(judgeChainFor(built).map((e) => `${e.provider}/${e.model}`)).toEqual(['jc/judge-1', 'p1/fast-1'])
  })

  it('builds a decision rung from a schema-validated config', () => {
    const out = validate({
      routing: {
        judge: {
          mode: 'decision',
          decision: { baseUrl: 'https://api.example.test/', model: 'jev-latest', apiKeyRef: 'TYPESAFE_KEY' },
        },
      },
    })
    const built = (out as { value: ShiftRouterConfig }).value
    built.tiers.fast.models = [{ provider: 'p1', model: 'fast-1', priority: 1 }]
    expect(judgeChainFor(built)[0]).toEqual({
      provider: 'decision',
      model: 'jev-latest',
      priority: 1,
      kind: 'decision',
    })
  })

  it('rejects an unknown mode loudly instead of coercing it', () => {
    const out = validate({ routing: { judge: { mode: 'gpt' } } })
    expect('issues' in out).toBe(true)
  })

  it('keeps the Judge budget keys flat (§10: source nested, budget not)', () => {
    const out = validate({ routing: { judgeTimeout: 9000, judge: { mode: 'custom' } } })
    const routing = ((out as { value: { routing: Record<string, unknown> } }).value.routing)
    expect(routing.judgeTimeout).toBe(9000)
    expect((routing.judge as { mode: string }).mode).toBe('custom')
  })
})

describe('normalizeJudgeMode', () => {
  it('honours the three modes', () => {
    expect(normalizeJudgeMode({ mode: 'fast-chain' })).toBe('fast-chain')
    expect(normalizeJudgeMode({ mode: 'custom' })).toBe('custom')
    expect(normalizeJudgeMode({ mode: 'decision' })).toBe('decision')
  })

  it('migrates models-without-mode to custom rather than discarding the list', () => {
    expect(normalizeJudgeMode({ models: [{ provider: 'p', model: 'm' }] })).toBe('custom')
  })

  it('reads an absent or unknown mode as the legacy fast chain', () => {
    expect(normalizeJudgeMode(undefined)).toBe('fast-chain')
    expect(normalizeJudgeMode({})).toBe('fast-chain')
    expect(normalizeJudgeMode({ mode: 'gpt' })).toBe('fast-chain')
    // An empty list is not intent — it must not migrate to `custom`.
    expect(normalizeJudgeMode({ models: [] })).toBe('fast-chain')
  })
})

describe('judgeChainFor', () => {
  it('fast-chain mode is the Fast chain alone, priority-ordered', () => {
    const chain = judgeChainFor(cfg({}, [
      { provider: 'p2', model: 'fast-2', priority: 2 },
      { provider: 'p1', model: 'fast-1', priority: 1 },
    ]))
    expect(chain).toEqual([
      { provider: 'p1', model: 'fast-1', priority: 1, kind: 'chat' },
      { provider: 'p2', model: 'fast-2', priority: 2, kind: 'chat' },
    ])
  })

  it('custom mode is rung 1 then rung 2, deduplicated', () => {
    const chain = judgeChainFor(cfg({
      mode: 'custom',
      models: [
        { provider: 'jc', model: 'judge-2', priority: 2 },
        { provider: 'jc', model: 'judge-1', priority: 1 },
        // Already in the Fast chain: the ladder must not walk it twice, and the
        // rung-1 occurrence is the one kept (it is the user's judge chain).
        { provider: 'p1', model: 'fast-1', priority: 3 },
      ],
    }))
    expect(chain.map((e) => `${e.provider}/${e.model}`)).toEqual([
      'jc/judge-1',
      'jc/judge-2',
      'p1/fast-1',
      'p2/fast-2',
    ])
  })

  it('a configured judge keeps rung 1 regardless of its priority vs the Fast chain', () => {
    const chain = judgeChainFor(cfg({
      mode: 'custom',
      models: [{ provider: 'jc', model: 'judge-1', priority: 9 }],
    }))
    expect(chain[0]).toEqual({ provider: 'jc', model: 'judge-1', priority: 9, kind: 'chat' })
    expect(chain[1]!.model).toBe('fast-1')
  })

  it('custom mode with an empty list falls straight through to the Fast chain', () => {
    const chain = judgeChainFor(cfg({ mode: 'custom', models: [] }))
    expect(chain.map((e) => e.model)).toEqual(['fast-1', 'fast-2'])
    expect(chain.every((e) => e.kind === 'chat')).toBe(true)
  })

  it('decision mode puts the decision endpoint on rung 1', () => {
    const chain = judgeChainFor(cfg({
      mode: 'decision',
      decision: { baseUrl: 'https://api.example.test/', model: 'jev-latest', apiKeyRef: 'TYPESAFE_KEY' },
    }))
    expect(chain[0]).toEqual({
      provider: 'decision',
      model: 'jev-latest',
      priority: 1,
      kind: 'decision',
    })
    expect(chain.slice(1).map((e) => e.model)).toEqual(['fast-1', 'fast-2'])
  })

  it('decision mode without a baseUrl is unusable and falls through to rung 2', () => {
    const chain = judgeChainFor(cfg({ mode: 'decision', decision: { baseUrl: '   ' } }))
    expect(chain.map((e) => e.model)).toEqual(['fast-1', 'fast-2'])
    expect(chain.some((e) => e.kind === 'decision')).toBe(false)
  })

  it('an absent judge object is the legacy chain', () => {
    expect(judgeChainFor(cfg(undefined)).map((e) => e.model)).toEqual(['fast-1', 'fast-2'])
  })
})

describe('judgeTimeoutFor', () => {
  it('leaves a chat call at the configured timeout', () => {
    expect(judgeTimeoutFor('chat', 5000)).toBe(5000)
    expect(judgeTimeoutFor('chat', 60_000)).toBe(60_000)
  })

  it('floors a decision call at the measured minimum', () => {
    // Measured 1.4–6.6 s per verdict: the 5 s default would abort most calls.
    expect(judgeTimeoutFor('decision', 5000)).toBe(DECISION_MIN_JUDGE_TIMEOUT_MS)
    expect(judgeTimeoutFor('decision', DECISION_MIN_JUDGE_TIMEOUT_MS)).toBe(DECISION_MIN_JUDGE_TIMEOUT_MS)
  })

  it('does not cap a decision call a user made longer', () => {
    expect(judgeTimeoutFor('decision', 30_000)).toBe(30_000)
  })
})

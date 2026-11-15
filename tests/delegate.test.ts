/**
 * dsh-shift-router — blocking delegation helpers
 *
 * The delegate tool is the orchestration loop's only source of a worker's real
 * result. These tests pin the two-service-shape spec, the result mapping and
 * the failure message without starting a child (SPEC §7.6).
 */

import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  DELEGATE_DESCRIPTION,
  DELEGATE_LABEL,
  DELEGATE_PARAMETERS,
  DELEGATE_TIMEOUT_MS,
  DELEGATE_TOOL,
  buildDelegateSpec,
  delegateFailureMessage,
  delegateResultText,
  delegateSucceeded,
  isDelegateRejection,
  startDelegate,
} from '../src/delegate.js'
import type { DelegateActivation, DelegateResult, DelegateSubagentService } from '../src/subagents-types.js'

const parent = { id: 'parent-agent' } as unknown as Agent
const signal = new AbortController().signal

function result(overrides: Partial<DelegateResult> = {}): DelegateResult {
  return { output: [], stopReason: 'completed', ...overrides }
}

describe('delegate constants', () => {
  it('does not shadow the asynchronous Harness tool', () => {
    expect(DELEGATE_TOOL).toBe('delegate')
    expect(DELEGATE_TOOL).not.toBe('subagent')
    expect(DELEGATE_LABEL).toBe('worker')
    expect(DELEGATE_TIMEOUT_MS).toBeGreaterThan(0)
    expect(DELEGATE_DESCRIPTION).toContain('instead of `subagent`')
    expect(DELEGATE_PARAMETERS.required).toEqual(['prompt'])
  })
})

describe('buildDelegateSpec', () => {
  it('carries both shipped service shapes in one spec', () => {
    const spec = buildDelegateSpec({ parent, prompt: 'do the thing', signal })
    // rc.5 shape
    expect(spec.provider).toBe('spawn')
    expect(spec.label).toBe('worker')
    expect(spec.delivery).toBe('caller')
    expect(spec.prompt).toBe('do the thing')
    expect(spec.parent).toBe(parent)
    expect(spec.signal).toBe(signal)
    // rc.2 shape: the prompt is ContentBlock[] and the parent lives on request.
    expect(spec.request.parent).toBe(parent)
    expect(spec.request.prompt).toEqual([{ type: 'text', text: 'do the thing' }])
  })

  it('puts a pinned route on both shapes', () => {
    const spec = buildDelegateSpec({
      parent,
      prompt: 'p',
      signal,
      agentOptions: { provider: 'fast-provider', model: 'fast-model' },
    })
    expect(spec.agentOptions).toEqual({ provider: 'fast-provider', model: 'fast-model' })
    expect(spec.request.agentOptions).toEqual({ provider: 'fast-provider', model: 'fast-model' })
  })
})

describe('delegateResultText', () => {
  it('joins text blocks and ignores non-text output', () => {
    const output: ContentBlock[] = [
      { type: 'text', text: 'first' },
      { type: 'image', attachment: {} as never },
      { type: 'text', text: 'second' },
    ]
    expect(delegateResultText(result({ output }))).toBe('first\nsecond')
  })

  it('explains a silent worker', () => {
    expect(delegateResultText(result())).toBe('The worker finished without a closing message.')
  })
})

describe('delegate outcomes', () => {
  it('counts only a completed stop reason as success', () => {
    expect(delegateSucceeded(result())).toBe(true)
    expect(delegateSucceeded(result({ stopReason: 'error' }))).toBe(false)
    expect(delegateSucceeded(result({ stopReason: 'aborted' }))).toBe(false)
    expect(delegateSucceeded(result({ stopReason: 'max-tokens' }))).toBe(false)
    expect(delegateSucceeded(result({ stopReason: 'refusal' }))).toBe(false)
  })

  it('names the stop reason and the diagnostic', () => {
    expect(delegateFailureMessage(result({ stopReason: 'error' }))).toBe('Worker ended with stop reason "error"')
    expect(delegateFailureMessage(result({ stopReason: 'error', diagnostic: 'boom' })))
      .toBe('Worker ended with stop reason "error": boom')
    expect(delegateFailureMessage(result({ stopReason: 'error', diagnostic: '   ' })))
      .toBe('Worker ended with stop reason "error"')
  })
})

describe('isDelegateRejection', () => {
  it('distinguishes denials and validation errors from worker outcomes', () => {
    expect(isDelegateRejection('dsh-shift-router: rounds 6/6 — stop delegating')).toBe(true)
    expect(isDelegateRejection('delegate: available only during an orchestrated turn')).toBe(true)
    expect(isDelegateRejection('Worker ended with stop reason "error"')).toBe(false)
    expect(isDelegateRejection('some output')).toBe(false)
  })
})

describe('startDelegate', () => {
  it('rejects a service without startActivation', async () => {
    await expect(startDelegate({} as DelegateSubagentService, { parent, prompt: 'p', signal }))
      .rejects.toThrow('does not expose startActivation')
  })

  it('forwards the dual-shape spec and returns the activation', async () => {
    const activation: DelegateActivation = {
      childId: 'child' as never,
      result: Promise.resolve(result()),
      dispose: async () => undefined,
    }
    let received: unknown
    const service: DelegateSubagentService = {
      async startActivation(spec) {
        received = spec
        return activation
      },
    }
    const got = await startDelegate(service, { parent, prompt: 'p', signal })
    expect(got).toBe(activation)
    expect(received).toMatchObject({ provider: 'spawn', label: 'worker', delivery: 'caller' })
  })
})

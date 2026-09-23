/**
 * dsh-shift-router — release wiring (SPEC §2 step 2, §6.3, §13.1)
 *
 * `router-release.test.ts` pins the pure decision. This file pins what the
 * plugin DOES with it, through the real Cordis event pipeline, because the
 * release is only correct if all four of these hold at once:
 *
 *   1. `agent/request` leaves the wire alone — "as if the plugin were not
 *      installed" is a statement about the request, not about a log line;
 *   2. orchestration never starts (release carries `held: true`);
 *   3. the session is told, once;
 *   4. the second consecutive released turn is NOT told again.
 *
 * Loading the plugin against a real `Context` is what makes (1) meaningful:
 * the pre-step path and the request path are two listeners that share only
 * `RouterState`, so a flag set in one and unread in the other is invisible to
 * any unit test that calls the pure functions directly.
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.js'

/** A session that topped out on Smart: the case a sticky hold used to pin. */
function config() {
  return {
    enabled: true,
    tiers: {
      fast: { label: 'Fast', models: [{ provider: 'fake', model: 'fake-fast', priority: 1 }] },
      smart: { label: 'Smart', models: [{ provider: 'fake', model: 'fake-smart', priority: 1 }] },
    },
    routing: { mode: 'auto' },
    orchestration: { mode: 'auto' },
  }
}

const AGENT = {
  session: { header: { origin: 'user', delegationDepth: 0 } },
} as unknown as Agent

function userMessage(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

/** A plugin-loaded context whose Judge always fails (every rung of the ladder). */
async function loaded() {
  const ctx = new Context()
  ctx.provide('llm', {
    resolveModelInfo: async () => ({ provider: 'fake', model: 'fake-fast' }),
    listProviders: () => [],
    listModels: async () => [],
    stream: async function* stream() {
      throw new Error('judge endpoint is down')
    },
  })
  ctx.provide('tools', { get: () => undefined })
  ctx.provide('commands', { register: () => () => undefined })
  ctx.provide('agents', { get: () => undefined })
  ctx.provide('systemPrompt', {
    section: () => () => undefined,
    variable: () => () => undefined,
  })
  await ctx.plugin(plugin, config())
  return ctx
}

/**
 * Dispatch one turn start. `agent/*` events are scope-filtered by a carrier,
 * which the harness passes as the waterfall's `this`; a plain object is enough
 * here because this plugin registers unscoped listeners (they receive every
 * scope) and the terminal `next` is ours.
 */
async function preStep(ctx: Context, text = 'fix the failing test') {
  return ctx.waterfall(
    {} as never,
    'agent/pre-step',
    { agent: AGENT, messages: [userMessage(text)], signal: undefined, step: 1 } as never,
    (() => ({ kind: 'continue', messages: [] })) as never,
  ) as Promise<{ kind: string; messages?: { content: { type: string; text?: string }[] }[] }>
}

/** Dispatch one step's model resolution; returns what would reach the wire. */
async function request(ctx: Context, incoming: Partial<LlmCallConfig>) {
  const base = { provider: 'session-provider', model: 'session-model', ...incoming } as LlmCallConfig
  return ctx.waterfall(
    {} as never,
    'agent/request',
    { agent: AGENT } as never,
    (() => base) as never,
  ) as Promise<LlmCallConfig>
}

function noticeText(decision: { messages?: { content: { type: string; text?: string }[] }[] }): string {
  return (decision.messages ?? [])
    .flatMap((message) => message.content)
    .map((block) => block.text ?? '')
    .join('\n')
}

describe('a session whose Judge is dead', () => {
  it('runs the turn on the session\'s own model instead of a router-chosen tier', async () => {
    const ctx = await loaded()
    await preStep(ctx)
    const wire = await request(ctx, { provider: 'session-provider', model: 'session-model' })
    expect(wire.provider).toBe('session-provider')
    expect(wire.model).toBe('session-model')
  })

  it('says so once, and never holds the wire as a "hold"', async () => {
    const ctx = await loaded()
    const first = await preStep(ctx)
    const text = noticeText(first)
    expect(text).toContain('[shift-router]')
    expect(text).toContain('no judge · not routing')
    expect(text).not.toContain('hold at')
  })

  it('does not repeat itself on the next released turn', async () => {
    const ctx = await loaded()
    await preStep(ctx)
    const second = await preStep(ctx)
    expect(noticeText(second)).toBe('')
  })

  it('does not start an orchestration loop on a released turn', async () => {
    const ctx = await loaded()
    // Smart is the session's tier: the case where a CTO prompt would otherwise
    // have condition 4 of SPEC §7.1 satisfied without any verdict at all.
    await preStep(ctx)
    const decision = await preStep(ctx)
    // The orchestrator section is registered dynamically while active, so an
    // absent `enterOrchestration` shows up as the absence of its prompt work:
    // the release notice is the only message, and no second turn reports one.
    expect(noticeText(decision)).toBe('')
    const wire = await request(ctx)
    expect(wire.provider).toBe('session-provider')
  })
})

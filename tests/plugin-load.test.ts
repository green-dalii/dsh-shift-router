/**
 * dsh-shift-router — plugin load (wiring) tests
 *
 * WHY THIS FILE EXISTS
 *
 * Every other test in this repo calls a pure function with a hand-written
 * object. That cannot catch a whole class of plugin bugs, because a Cordis
 * context is a PROXY whose `get` trap throws
 *
 *     cannot get property "<name>" without inject
 *
 * for any service the plugin did not declare in `inject`. A structural cast
 * (`ctx as unknown as { someService?: ... }`) silences TypeScript but NOT that
 * trap: the property read still throws at runtime. Because the read happened
 * inside `apply`, the throw failed the plugin fiber and aborted the entire DSH
 * boot ("plugin tree failed to load") — on the DEFAULT configuration
 * (`orchestration.mode: auto`), i.e. for every user.
 *
 * The only way to catch that is to load the plugin the way the loader does:
 * against a real context, with the real `inject` gate armed. This file does
 * exactly that, and it is deliberately the cheapest possible version of it
 * (no harness, no adapters, no turn) so it runs in milliseconds.
 *
 * The two cases mirror the two compositions that actually ship:
 *   - `web`      mounts `@deepseek-ai/dsh-tool-subagent/model-selection-settings`,
 *                so `subagentModelSelection` resolves (this is what crashed);
 *   - `headless` does not mount it, so the service must be treated as absent.
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.js'

/** The config that triggered the boot failure: orchestration on its default mode. */
function autoConfig() {
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

/** What the plugin registered on the system-prompt service during `apply`. */
interface PromptCapture {
  sections: { name: string; order: number }[]
  variables: string[]
}

/**
 * A root context with the services the plugin REQUIRES (`export const inject`),
 * and nothing else. Anything the plugin reads beyond this list must go through
 * an optional probe (`ctx.get`) or it will throw — which is the point.
 *
 * @param extra - additional services to provide beyond the required set.
 * @param llm - overrides merged over the stub `llm` (e.g. a Judge stream).
 */
function harnessContext(
  extra: Record<string, unknown> = {},
  llm: Record<string, unknown> = {},
): { ctx: Context; prompt: PromptCapture } {
  const ctx = new Context()
  const prompt: PromptCapture = { sections: [], variables: [] }
  ctx.provide('llm', {
    resolveModelInfo: async () => undefined,
    listProviders: () => [],
    listModels: async () => [],
    stream: async function* stream() {},
    ...llm,
  })
  ctx.provide('tools', { get: () => undefined })
  ctx.provide('commands', { register: () => () => undefined })
  ctx.provide('agents', { get: () => undefined })
  ctx.provide('systemPrompt', {
    section: (section: { name: string; order: number }) => {
      prompt.sections.push({ name: section.name, order: section.order })
      return () => undefined
    },
    variable: (name: string) => {
      prompt.variables.push(name)
      return () => undefined
    },
  })
  for (const [name, value] of Object.entries(extra)) ctx.provide(name, value)
  return { ctx, prompt }
}

describe('plugin load against a real Cordis context', () => {
  it('loads on a composition WITHOUT the model-selection service (headless)', async () => {
    const { ctx } = harnessContext()
    await expect(ctx.plugin(plugin, autoConfig())).resolves.toBeDefined()
  })

  it('loads on a composition WITH the model-selection service (web)', async () => {
    const { ctx } = harnessContext({
      subagentModelSelection: { current: () => ({ enabled: false, allowedModels: [] }) },
    })
    await expect(ctx.plugin(plugin, autoConfig())).resolves.toBeDefined()
  })

  it('loads when the service mounts AFTER this plugin (the boot-order race that broke web)', async () => {
    // `web` mounts this plugin and the `subagent-model-selection-settings` row
    // in the same include group, loaded concurrently. If our `apply` runs first
    // the service is momentarily absent — and an undeclared read throws, which
    // aborts the whole plugin tree. Loading it afterwards here reproduces
    // exactly that ordering.
    const { ctx } = harnessContext()
    await expect(ctx.plugin(plugin, autoConfig())).resolves.toBeDefined()
    ctx.provide('subagentModelSelection', { current: () => ({ enabled: false, allowedModels: [] }) })
  })

  it('warns once when orchestration is on and delegation is not model-selectable (SPEC §7.4)', async () => {
    const { ctx } = harnessContext({
      subagentModelSelection: { current: () => ({ enabled: false, allowedModels: [] }) },
    })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    await ctx.plugin(plugin, autoConfig())
    const warned = warn.mock.calls.map((call) => call.map(String).join(' ')).join('\n')
    expect(warned).toContain('subagent-model-selection')
    warn.mockRestore()
  })

  it('stays silent when the allowlist is enabled with routes', async () => {
    const { ctx } = harnessContext({
      subagentModelSelection: {
        current: () => ({ enabled: true, allowedModels: [{ provider: 'fake', model: 'fake-fast' }] }),
      },
    })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    await ctx.plugin(plugin, autoConfig())
    const warned = warn.mock.calls.map((call) => call.map(String).join(' ')).join('\n')
    expect(warned).not.toContain('subagent-model-selection')
    warn.mockRestore()
  })
})

describe('prompt-section placement is configuration, not a literal', () => {
  // Iron rule: can the value be changed in cordis.yml without editing code?
  // DSH allocates prompt order centrally (`SECTION_ORDERS` in dsh-system-prompt)
  // and reserves no slot for a third-party section, so this one has to be
  // settable — and it must NOT be resolved via `getSectionOrder()`, which
  // returns `undefined` for non-platform names and would make `section()` throw
  // (the same boot-abort class as an undeclared service read).
  it('registers the orchestrator section at the configured order', async () => {
    const { ctx, prompt } = harnessContext()
    const config = { ...autoConfig(), ux: { promptSectionOrder: 4321 } }
    await ctx.plugin(plugin, config)
    const section = prompt.sections.find((entry) => entry.name === 'shift-router:orchestrator')
    expect(section?.order).toBe(4321)
  })

  it('uses the documented default when the config leaves it alone', async () => {
    const { ctx, prompt } = harnessContext()
    await ctx.plugin(plugin, autoConfig())
    const section = prompt.sections.find((entry) => entry.name === 'shift-router:orchestrator')
    expect(section?.order).toBe(150)
  })

  it('exposes both tier chains as prompt variables', async () => {
    const { ctx, prompt } = harnessContext()
    await ctx.plugin(plugin, autoConfig())
    expect(prompt.variables).toContain('shift_router_fast_chain')
    expect(prompt.variables).toContain('shift_router_smart_chain')
  })
})

describe('load safety across configurations', () => {
  // The R3 boot abort lived in a config-gated branch that no gate ever ran. So
  // every configuration that changes a LOAD-TIME branch is loaded for real here,
  // not reasoned about: the plugin must load on all of them, because a load
  // failure is not "a feature is off", it is DSH not starting.
  const noRoutableConfig = { enabled: false, tiers: { fast: { models: [] }, smart: { models: [] } } }

  it('loads on an empty config row (the documented no-op)', async () => {
    const { ctx, prompt } = harnessContext()
    // SPEC §10: "an empty config row is a working no-op" — every leaf defaults.
    await expect(ctx.plugin(plugin, {})).resolves.toBeDefined()
    expect(prompt.sections.find((entry) => entry.name === 'shift-router:orchestrator')?.order).toBe(150)
  })

  it('loads with routing disabled', async () => {
    const { ctx } = harnessContext()
    await expect(ctx.plugin(plugin, { ...noRoutableConfig, enabled: false })).resolves.toBeDefined()
  })

  it('loads in manual and off routing modes', async () => {
    for (const mode of ['manual', 'off'] as const) {
      const { ctx } = harnessContext()
      await expect(ctx.plugin(plugin, { ...autoConfig(), routing: { mode } })).resolves.toBeDefined()
    }
  })

  it('loads with orchestration off and with an empty Fast chain', async () => {
    const off = harnessContext()
    await expect(
      ctxPlugin(off.ctx, { ...autoConfig(), orchestration: { mode: 'off' } }),
    ).resolves.toBeDefined()
    const empty = harnessContext()
    await expect(
      ctxPlugin(empty.ctx, { ...autoConfig(), tiers: { fast: { models: [] }, smart: { models: [] } } }),
    ).resolves.toBeDefined()
  })

  it('loads with the whole costs/audit surface configured', async () => {
    const { ctx } = harnessContext()
    await expect(ctxPlugin(ctx, {
      ...autoConfig(),
      orchestration: { mode: 'auto', maxSpendUsd: 1.5, workerLedgerCap: 5, audit: { enabled: false, timeoutMs: 100, promptCap: 200 } },
    })).resolves.toBeDefined()
  })
})

/** `ctx.plugin` needs the plugin shape; kept local so the intent reads clearly. */
function ctxPlugin(ctx: Context, config: unknown) {
  return ctx.plugin(plugin, config as never)
}

/**
 * SPEC §13.1 — a routing switch is written INTO the session.
 *
 * `tests/route-notice.test.ts` pins the formatting; this pins the wiring that
 * makes it visible at all, by driving the real `agent/pre-step` waterfall
 * through a real Cordis context: a formatter nobody appends is a formatter
 * nobody reads — the same failure mode as the `ctx.logger` lines no stock
 * profile exports (SPEC §13).
 */
describe('route notices enter the session (SPEC §13.1)', () => {
  const JUDGE_FAST = '{"tier":"fast","confidence":0.95,"reason":"small change"}'
  const JUDGE_SMART = '{"tier":"smart","confidence":0.9,"reason":"wide refactor"}'

  /** A fake agent: only `session.header` is read on this path. */
  function fakeAgent(): Agent {
    return { session: { header: { origin: 'user' } } } as unknown as Agent
  }

  /**
   * A context whose `llm.stream` answers the Judge, one verdict per call.
   * @param answers - the Judge answers, in call order (the last one repeats).
   * @param verbose - whether to configure per-turn verbose notices.
   */
  function noticeContext(answers: string[], verbose = false) {
    let call = 0
    const { ctx } = harnessContext({}, {
      stream: async function* stream() {
        const answer = answers[Math.min(call, answers.length - 1)]
        call += 1
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: answer }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    })
    const config = verbose
      ? { ...autoConfig(), ux: { routerLogVerbose: true } }
      : autoConfig()
    return { ctx, config }
  }

  /** Drive one turn start through the real waterfall. */
  async function driveTurn(ctx: Context, agent: Agent): Promise<PreStepDecision> {
    return ctx.waterfall(
      'agent/pre-step',
      {
        agent,
        messages: [createUserMessage({
          content: [{ type: 'text', text: 'refactor the router' }],
          source: { kind: 'user' },
        })],
        turn: 1,
        step: 1,
        signal: new AbortController().signal,
      },
      async () => ({ kind: 'enter', messages: [] }),
    )
  }

  /** The notices this plugin wrote into the decision. */
  function notices(decision: PreStepDecision): UserMessage[] {
    if (decision.kind !== 'enter') return []
    return decision.messages.filter(
      (message) => message.source.kind === 'plugin' && message.source.plugin === 'shift-router',
    )
  }

  it('writes a named notice when a turn establishes the route', async () => {
    const { ctx, config } = noticeContext([JUDGE_FAST])
    await ctxPlugin(ctx, config)
    const written = notices(await driveTurn(ctx, fakeAgent()))
    expect(written).toHaveLength(1)
    const [notice] = written
    expect(notice.source).toMatchObject({ form: 'notice' })
    expect(notice.content[0]).toMatchObject({ type: 'text' })
    expect((notice.content[0] as { text: string }).text).toContain('[shift-router]')
    expect((notice.content[0] as { text: string }).text).toContain('fake-fast')
    expect((notice.source as { summary: string }).summary).toContain('shift-router')
  })

  it('reports the move when a later turn switches tier, with both ends named', async () => {
    const { ctx, config } = noticeContext([JUDGE_FAST, JUDGE_SMART])
    await ctxPlugin(ctx, config)
    const agent = fakeAgent()
    await driveTurn(ctx, agent)
    const written = notices(await driveTurn(ctx, agent))
    expect(written).toHaveLength(1)
    const text = (written[0].content[0] as { text: string }).text
    expect(text).toContain('Fast → Smart')
    expect(text).toContain('fake-fast → fake-smart')
    expect(text).toContain('upgrade')
  })

  it('stays silent when nothing moved and verbose is off', async () => {
    const { ctx, config } = noticeContext([JUDGE_FAST, JUDGE_FAST])
    await ctxPlugin(ctx, config)
    const agent = fakeAgent()
    await driveTurn(ctx, agent)
    expect(notices(await driveTurn(ctx, agent))).toHaveLength(0)
  })

  it('reports every judged turn once verbose is on — the promise the log ring could not keep', async () => {
    const { ctx, config } = noticeContext([JUDGE_FAST, JUDGE_FAST], true)
    await ctxPlugin(ctx, config)
    const agent = fakeAgent()
    await driveTurn(ctx, agent)
    const written = notices(await driveTurn(ctx, agent))
    expect(written).toHaveLength(1)
    expect((written[0].content[0] as { text: string }).text).toContain('stay on')
  })
})
